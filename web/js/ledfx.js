// YAGCC LED engine v2 - JavaScript port of the firmware's per-frame LED renderer (see firmware/src/rgb.c and led_v2_spec.md),
// used by the Lights page preview. Frames are 8 ms; the look matches the firmware, exact pixels do not.
// Pure logic, no DOM: createEngine(cfg) -> { setConfig, tick(nowMs, input) -> frame }.
import { IDLE, PRESS, STAR, WFX, hexToRgb, effectZone, defaultLedV2, MAX_STRUM_LEDS } from './protocol.js?v=dev';

export const FRAME_MS = 8;
const WHITE = [255, 255, 255];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mod = (a, n) => ((a % n) + n) % n;
const tri = (t, P) => { const x = mod(t, P) / P; return x < 0.5 ? x * 2 : 2 - x * 2; };
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// hue 0..255 -> full saturation RGB
export function hueRgb(h) {
  const x = mod(h, 256) / 256 * 6, i = Math.floor(x), f = x - i;
  const [r, g, b] = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][i % 6];
  return [r * 255, g * 255, b * 255];
}
function rotateHue(c, dh) {
  const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1) return c;   // grey: no hue to rotate
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = mod(h / 6 * 256 + dh, 256);
  const out = hueRgb(h), s = d / (mx || 1);
  return scale(mix(WHITE, out, s), mx / 255);
}

// small xorshift RNG so the same state gives the same sparkles
function rng(seed = 2463534242) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// sparkle + fire state of one zone
class Noise {
  constructor(n, rand) { this.n = n; this.r = rand; this.sp = new Array(n).fill(0); this.fire = new Array(n).fill(0.5); this.tgt = new Array(n).fill(0.5); this.nextT = new Array(n).fill(0); }
  step(t, s) {
    for (let k = 0; k < this.n; k++) {
      this.sp[k] = this.r() < s / 400 ? 255 : Math.max(0, this.sp[k] - 8);
      if (t >= this.nextT[k]) { this.tgt[k] = this.r(); this.nextT[k] = t + 40 + this.r() * 40; }
      this.fire[k] += (this.tgt[k] - this.fire[k]) / 4;
    }
  }
}

// colour of an idle animation for LED k of n (before press / star / whammy)
function idleColor(kind, base, L, s, k, n, t, noise) {
  switch (kind) {
    case IDLE.OFF: return [0, 0, 0];
    case IDLE.SOLID: return scale(base, L);
    case IDLE.BREATHE: { const P = 4000 - 350 * s; return scale(base, L * (0.4 + 0.6 * tri(t + k * P / 10, P))); }
    case IDLE.HEARTBEAT: {
      const P = 1600 - 100 * s, x = mod(t + k * P / 10, P) / P;
      const beat = x < 0.12 ? Math.sin(Math.PI * x / 0.12) : x >= 0.2 && x < 0.32 ? Math.sin(Math.PI * (x - 0.2) / 0.12) : 0;
      return scale(base, L * (0.2 + 0.8 * beat));
    }
    case IDLE.RAINBOW: return scale(hueRgb(Math.floor(t * s / 40 + 40 * k) & 255), L);
    case IDLE.RAINBOW_WAVE: return scale(hueRgb(Math.floor(t * s / 40 + 256 * k / n) & 255), L);
    case IDLE.COLOR_WAVE: return scale(base, L * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t * s / 4000 - k / n)))));
    case IDLE.SPARKLE: return mix(scale(base, L * 0.25), WHITE, noise.sp[k] / 255);
    case IDLE.CHASE: {
      const head = mod(t * s / 600, n), d0 = Math.abs(k - head), d = Math.min(d0, n - d0);
      return scale(base, L * Math.max(0.15, 1 - d / 1.5));
    }
    case IDLE.FIRE: return scale(base, L * (0.45 + 0.55 * noise.fire[k]));
    case IDLE.HUE_DRIFT: return scale(rotateHue(base, Math.floor(t * s / 80) & 255), L);
    default: return scale(base, L);
  }
}

// state + rendering of one zone (the five fret positions, or the strum LEDs)
class Zone {
  constructor(name, rand) {
    this.name = name; this.rand = rand; this.n = 0;
    this.resize(name === 'frets' ? 5 : 1);
  }
  resize(n) {
    if (this.n === n && this.held) return;
    this.n = n; this.rand ||= rng();
    this.held = new Array(n).fill(false); this.dir = new Array(n).fill(1); this.pressAt = new Array(n).fill(-1e9);
    this.amt = new Array(n).fill(0); this.hue = new Array(n).fill(0);
    this.ripples = []; this.comets = [];
    this.idleNoise = new Noise(n, this.rand); this.starNoise = new Noise(n, this.rand);
  }
  // advance state by one frame: held[] is who is held now, dir[] the strum direction (1 up, -1 down)
  update(z, t, held, dir, F, starSpeed = 5) {
    const n = this.n;
    this.idleNoise.step(t, z.idle === IDLE.SPARKLE ? z.speed : 5);
    this.starNoise.step(t, starSpeed);
    for (let k = 0; k < n; k++) {
      const h = !!held[k], was = this.held[k];
      if (h && !was) this.onPress(z, k, t, dir[k] || 1, F);
      this.held[k] = h; this.dir[k] = dir[k] || 1;
      if (h) this.amt[k] = 255; else this.amt[k] = Math.max(0, this.amt[k] - 255 * FRAME_MS / F);
    }
    this.ripples = this.ripples.filter((r) => t - r.born < F + 80 * n + 200);
    this.comets = this.comets.filter((c) => t - c.born < F * 1.6 + 100);
  }
  onPress(z, k, t, dir, F) {
    this.pressAt[k] = t;
    if (z.press === PRESS.RIPPLE) { this.ripples.push({ k0: k, born: t }); if (this.ripples.length > 4) this.ripples.shift(); }
    else if (z.press === PRESS.RAINBOW) this.hue[k] = Math.floor(this.rand() * 256);
    else if (z.press === PRESS.SWEEP) {
      if (this.name === 'strum') this.comets.push({ k0: dir > 0 ? 0 : this.n - 1, dir, born: t });
      else { this.comets.push({ k0: k, dir: 1, born: t }); this.comets.push({ k0: k, dir: -1, born: t }); }
      if (this.comets.length > 6) this.comets.splice(0, this.comets.length - 6);
    }
  }
  // out[k] = colour; base[k] idle colour, pc[k] pressed colour
  render(z, t, base, pc, F, star, starCfg, out) {
    const n = this.n, L = z.idleLevel / 100;
    for (let k = 0; k < n; k++) {
      const held = this.held[k], a = this.amt[k] / 255, b = base[k] || [0, 0, 0], p = pc[k] || b;
      let c = idleColor(z.idle, b, L, z.speed, k, n, t, this.idleNoise);
      switch (z.press) {
        case PRESS.COLOR: if (held) c = p; break;
        case PRESS.FLASH_FADE: if (a > 0) c = mix(c, p, a); break;
        case PRESS.DIM: if (held) c = scale(b, 0.15); break;
        case PRESS.OFF: if (held) c = [0, 0, 0]; break;
        case PRESS.STROBE: if (held) { const half = 40 + 15 * (10 - z.speed); c = Math.floor(t / half) % 2 === 0 ? p : [0, 0, 0]; } break;
        case PRESS.RIPPLE: {
          let r = held ? 1 : 0;
          for (const rp of this.ripples) {
            const age = t - rp.born;
            if (age < F + 80 * n) r = Math.max(r, clamp01(1 - Math.abs(age - 80 * Math.abs(k - rp.k0)) / 120));
          }
          if (r > 0) c = mix(c, p, r);
          break;
        }
        case PRESS.RAINBOW: if (a > 0) c = mix(c, hueRgb(this.hue[k]), a); break;
        case PRESS.SPARK:
          if (held && t - this.pressAt[k] < 60) c = WHITE;
          else if (a > 0) c = mix(c, p, a);
          break;
        case PRESS.SWEEP: {
          let r = held ? 1 : 0;
          for (const cm of this.comets) {
            const x = (k - (cm.k0 + cm.dir * (t - cm.born) / F * n)) * -cm.dir;   // > 0: LED is behind the head
            r = Math.max(r, x < -0.5 ? 0 : x < 0.5 ? 1 : x < 1.5 ? 0.5 : x < 2.5 ? 0.2 : 0);
          }
          if (r > 0) c = mix(c, p, r);
          break;
        }
        default: break;
      }
      if (star && !held) c = this.starColor(starCfg, t, k, n);
      out[k] = c;
    }
  }
  starColor(sc, t, k, n) {
    const P = 1100 - 100 * sc.speed, col = sc.color;
    switch (sc.anim) {
      case STAR.PULSE: return scale(col, (110 + 145 * tri(t, P)) / 255);
      case STAR.SOLID: return col;
      case STAR.RAINBOW: return idleColor(IDLE.RAINBOW_WAVE, col, 1, 10, k, n, t, this.starNoise);
      case STAR.STROBE: return Math.floor(t / (P / 8)) % 2 === 0 ? col : [0, 0, 0];
      case STAR.CHASE: return idleColor(IDLE.CHASE, col, 1, 10, k, n, t, this.starNoise);
      case STAR.FIRE: return idleColor(IDLE.FIRE, col, 1, 5, k, n, t, this.starNoise);
      case STAR.SPARKLE: return mix(scale(col, 0.5), WHITE, this.starNoise.sp[k] / 255);
      default: return col;
    }
  }
}

function applyWhammy(fx, w, t, k, n, c) {
  if (!w) return fx === WFX.BRIGHT ? scale(c, 0.35) : c;
  switch (fx) {
    case WFX.BRIGHT: return scale(c, 0.35 + 0.65 * w);
    case WFX.PULSE: return scale(c, 1 - 0.6 * w * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 160)));
    case WFX.HUE: return rotateHue(c, 96 * w);
    case WFX.WAVE: return scale(c, 1 - 0.7 * w * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t / 300 - k / n))));
    default: return c;
  }
}

// the config the engine really runs: configs from firmware before 0.34 have no zones, so derive them from the old effect
export function engineConfig(c) {
  if ((c.cfgVersion ?? 0) >= 7 && c.zoneFrets && c.zoneStrum) return c;
  const d = defaultLedV2(c.colors, c.rgbEffect, c.rgbSpeed);
  return { ...c, ...d, zoneFrets: effectZone(c.rgbEffect, c.rgbSpeed), zoneStrum: effectZone(c.rgbEffect, c.rgbSpeed) };
}

export function createEngine(cfg) {
  const rand = rng();
  const zf = new Zone('frets', rand), zs = new Zone('strum', rand);
  let c = null, t = 0, last = null, acc = 0, lastInput = 0, wasStar = false, flashAt = -1e9, lastWhammy = 0, prevUp = false, prevDown = false, lastUp = true;
  const sleepOverrideMs = { v: 0 };   // tests can shorten the sleep timer
  const frame = { fret: [], fret2: [], strum: [], two: false, asleep: 0 };
  const rgb = (h) => hexToRgb(h || '#000000');
  const setConfig = (cc) => { c = engineConfig(cc); zs.resize(Math.max(1, Math.min(MAX_STRUM_LEDS, c.strumLeds || 0))); };
  setConfig(cfg);

  function step(input) {
    const F = (z) => 1100 - 100 * z.fade;
    const zFr = c.zoneFrets, zSt = c.zoneStrum, n = zs.n;
    const hasStrum = !!c.strumLeds, nS = hasStrum ? n : 0;
    const up = !!input.up, down = !!input.down;
    if (up && !prevUp) lastUp = true; else if (down && !prevDown) lastUp = false;
    prevUp = up; prevDown = down;
    if ((input.frets || []).some(Boolean) || up || down || Math.abs((input.whammy || 0) - lastWhammy) > 0.012) lastInput = t;
    lastWhammy = input.whammy || 0;
    const star = !!input.star;
    if (star && !wasStar && c.starFlash) flashAt = t;
    if (input.starPressed) { flashAt = c.starFlash ? t : flashAt; lastInput = t; }
    wasStar = star;
    // frets
    const heldF = [0, 1, 2, 3, 4].map((f) => !!(input.frets || [])[f]);
    zf.update(zFr, t, heldF, [], F(zFr), c.starSpeed || 5);
    // strum: roles decide who follows what
    const roles = c.strumRoles || [];
    const heldS = [], dirS = [];
    for (let k = 0; k < zs.n; k++) {
      const r = roles[k] || 0;
      heldS.push(r === 1 ? up : r === 2 ? down : up || down);
      dirS.push(r === 1 ? 1 : r === 2 ? -1 : (up && !down ? 1 : down && !up ? -1 : lastUp ? 1 : -1));
    }
    zs.update(zSt, t, heldS, dirS, F(zSt), c.starSpeed || 5);
    // colours
    const colors = c.colors.map(rgb), press = (c.fretPress || c.colors).map(rgb), second = c.fret2Own ? (c.fret2Colors || c.colors).map(rgb) : colors;
    // input.forceStar: the Lights page preview shows star power even while the guitar's star power glow is switched off
    const glow = c.rgbStarPower !== false || !!input.forceStar;
    const starF = star && glow && (c.starZones & 1), starS = star && glow && (c.starZones & 2);
    const sc = { color: rgb(c.starColor), anim: c.starAnim, speed: c.starSpeed || 5 };
    const pcF = zFr.same ? colors : press, pcF2 = zFr.same ? second : press;
    zf.render(zFr, t, colors, pcF, F(zFr), starF, sc, frame.fret);
    zf.render(zFr, t, second, pcF2, F(zFr), starF, sc, frame.fret2);
    const baseS = [], pcS = [];
    for (let k = 0; k < zs.n; k++) {
      const b = zSt.perLed ? rgb((c.strumLedColors || [])[k]) : rgb(c.strumColor || '#ffffff');
      baseS.push(b);
      const r = roles[k] || 0, useUp = r === 1 || (r === 0 && lastUp);
      pcS.push(zSt.same ? b : rgb(useUp ? c.strumUpColor : c.strumDownColor));
    }
    zs.render(zSt, t, baseS, pcS, F(zSt), starS, sc, frame.strum);
    // whammy
    const w = clamp01(input.whammy || 0);
    if (c.whammyFx) {
      if (c.whammyZones & 1) for (let k = 0; k < 5; k++) { frame.fret[k] = applyWhammy(c.whammyFx, w, t, k, 5, frame.fret[k]); frame.fret2[k] = applyWhammy(c.whammyFx, w, t, k, 5, frame.fret2[k]); }
      if (c.whammyZones & 2) for (let k = 0; k < nS; k++) frame.strum[k] = applyWhammy(c.whammyFx, w, t, k, nS, frame.strum[k]);
    }
    // events: star power flash, then the idle sleep fade
    const fa = t - flashAt;
    if (c.starFlash && fa >= 0 && fa < 350) {
      const a = fa < 150 ? 1 : 1 - (fa - 150) / 200;
      for (let k = 0; k < 5; k++) { frame.fret[k] = mix(frame.fret[k], WHITE, a); frame.fret2[k] = mix(frame.fret2[k], WHITE, a); }
      for (let k = 0; k < nS; k++) frame.strum[k] = mix(frame.strum[k], WHITE, a);
    }
    const sleepMs = sleepOverrideMs.v || (c.sleepMin || 0) * 60000;
    let sl = 1;
    if (sleepMs && t - lastInput > sleepMs) sl = clamp01(1 - (t - lastInput - sleepMs) / 2000);
    frame.asleep = 1 - sl;
    if (sl < 1) {
      for (let k = 0; k < 5; k++) { frame.fret[k] = scale(frame.fret[k], sl); frame.fret2[k] = scale(frame.fret2[k], sl); }
      for (let k = 0; k < nS; k++) frame.strum[k] = scale(frame.strum[k], sl);
    }
    frame.strum.length = nS;
    frame.two = c.fretLeds === 2;
    t += FRAME_MS;
  }

  return {
    setConfig,
    get time() { return t; },
    wake() { lastInput = t; },
    setSleepMs(ms) { sleepOverrideMs.v = ms; },
    // advance by real elapsed time (capped), return the latest frame; colours are 0..255 [r,g,b]
    tick(now, input) {
      if (last === null) last = now;
      acc += Math.min(now - last, 120); last = now;
      let guard = 0;
      while (acc >= FRAME_MS && guard++ < 16) { step(input); acc -= FRAME_MS; }
      if (guard === 0 && !frame.fret.length) step(input);
      return frame;
    },
    // fixed number of frames (used by tests)
    run(frames, input) { for (let i = 0; i < frames; i++) step(input); return frame; },
  };
}

export const toCss = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
