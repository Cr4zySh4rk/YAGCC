// Lights page "Look" area (the lighting studio): live LED preview, themes and a few simple controls, with the rest under "More options".
// Needs firmware 0.34 (config version 7); on older firmware the sections are shown locked. The preview itself always runs.
import {
  IDLE, PRESS, STAR, WFX, IDLE_ANIMS, PRESS_FX, STAR_ANIMS, WHAMMY_FX, RGB_PRESETS, FRET_DEFAULT_COLORS, FUNC_LABEL, FUNCS, STRUM_ROLES,
  isPressed, hexToRgb, rgbToHex, ledLayout, MAX_STRUM_LEDS,
} from './protocol.js?v=dev';
import { createEngine, toCss } from './ledfx.js?v=dev';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const mixHex = (h, to, t) => { const a = hexToRgb(h), b = to; return rgbToHex(...a.map((v, i) => Math.round(v + (b[i] - v) * t))); };
const brighter = (h) => mixHex(h, [255, 255, 255], 0.55);
const FRET_NAMES = [0, 1, 2, 3, 4].map((i) => FUNC_LABEL[FUNCS[i]]);

// ------------------------------------------------------------------ themes
const P = RGB_PRESETS.map((p) => p.colors);   // Guitar Hero, Neon, Ice, Fire, Mono white palettes from the old colour presets
const Z = (idle, idleLevel, press, speed = 5, fade = 5, same = true) => ({ idle, idleLevel, press, speed, fade, same, perLed: false });
const RAINBOW_SW = ['#ff4d4d', '#ffd23f', '#3ddc84', '#3aa0ff', '#b25cff'];
export const THEMES = [
  { name: 'Guitar Hero classic', desc: 'Soft glow, full colour while you hold a fret.', colors: P[0], frets: Z(IDLE.SOLID, 25, PRESS.COLOR), strum: Z(IDLE.SOLID, 25, PRESS.COLOR), strumColor: '#ffffff',
    star: { color: '#40e0ff', anim: STAR.PULSE, speed: 5, zones: 3, flash: false }, whammy: { fx: WFX.NONE, zones: 3 } },
  { name: 'Rock Band', desc: 'Flash and fade, a gold strum sweep.', colors: P[0], frets: Z(IDLE.SOLID, 18, PRESS.FLASH_FADE, 5, 6), strum: Z(IDLE.SOLID, 18, PRESS.SWEEP, 6, 5, false), strumColor: '#ffb020', up: '#ff9d00', down: '#ffe27a',
    star: { color: '#ffd24a', anim: STAR.PULSE, speed: 7, zones: 3, flash: true }, whammy: { fx: WFX.BRIGHT, zones: 3 } },
  { name: 'Neon', desc: 'Breathing neon with ripples.', colors: P[1], frets: Z(IDLE.BREATHE, 70, PRESS.RIPPLE, 4, 5, false), strum: Z(IDLE.COLOR_WAVE, 70, PRESS.SWEEP, 5, 5, false), strumLeds: P[1], up: '#00ffa3', down: '#ff2e63',
    star: { color: '#ffffff', anim: STAR.SPARKLE, speed: 5, zones: 3, flash: true }, whammy: { fx: WFX.PULSE, zones: 3 } },
  { name: 'Synthwave', desc: 'Pink and cyan waves, chasing strum bar.', colors: ['#ff2e97', '#ff6ac1', '#b967ff', '#05d9e8', '#01ffc3'], frets: Z(IDLE.COLOR_WAVE, 65, PRESS.FLASH_FADE, 3, 6, false), strum: Z(IDLE.CHASE, 70, PRESS.SWEEP, 4, 5, false),
    strumLeds: ['#ff2e97', '#b967ff', '#05d9e8'], up: '#05d9e8', down: '#ff2e97', star: { color: '#ff2e97', anim: STAR.PULSE, speed: 6, zones: 3, flash: true }, whammy: { fx: WFX.WAVE, zones: 3 } },
  { name: 'Fire', desc: 'Flickering embers, sparks on press.', colors: P[3], frets: Z(IDLE.FIRE, 85, PRESS.SPARK, 5, 5, false), strum: Z(IDLE.FIRE, 85, PRESS.SWEEP, 5, 4, false), strumColor: '#fb923c', up: '#fde047', down: '#b91c1c',
    star: { color: '#fde047', anim: STAR.FIRE, speed: 5, zones: 3, flash: true }, whammy: { fx: WFX.BRIGHT, zones: 3 } },
  { name: 'Ice', desc: 'Slow breathing blues, glittering strum bar.', colors: P[2], frets: Z(IDLE.BREATHE, 60, PRESS.FLASH_FADE, 2, 8, false), strum: Z(IDLE.SPARKLE, 60, PRESS.SWEEP, 5, 6, false), strumColor: '#a5f3fc', up: '#e0f2fe', down: '#818cf8',
    star: { color: '#e0f2fe', anim: STAR.SPARKLE, speed: 5, zones: 3, flash: false }, whammy: { fx: WFX.HUE, zones: 3 } },
  { name: 'Rainbow everything', desc: 'A rolling rainbow, whammy shifts the colours.', colors: P[0], frets: Z(IDLE.RAINBOW_WAVE, 80, PRESS.COLOR, 4), strum: Z(IDLE.RAINBOW_WAVE, 80, PRESS.COLOR, 4), strumColor: '#ffffff', swatch: RAINBOW_SW,
    star: { color: '#ffffff', anim: STAR.RAINBOW, speed: 5, zones: 3, flash: true }, whammy: { fx: WFX.HUE, zones: 3 } },
  { name: 'Stealth', desc: 'Dark until you play: LEDs flash only when pressed.', colors: P[0], frets: Z(IDLE.OFF, 25, PRESS.FLASH_FADE, 5, 3), strum: Z(IDLE.OFF, 25, PRESS.SWEEP, 7, 3, false), strumColor: '#ffffff', up: '#00c8ff', down: '#ff3cc8',
    star: { color: '#40e0ff', anim: STAR.SOLID, speed: 5, zones: 3, flash: false }, whammy: { fx: WFX.NONE, zones: 3 } },
  { name: 'Club strobe', desc: 'Strobing frets, a fast chase on the strum bar.', colors: P[1], frets: Z(IDLE.SOLID, 12, PRESS.STROBE, 9), strum: Z(IDLE.CHASE, 100, PRESS.STROBE, 10), strumColor: '#ffffff',
    star: { color: '#ffffff', anim: STAR.STROBE, speed: 9, zones: 3, flash: true }, whammy: { fx: WFX.PULSE, zones: 3 } },
  { name: 'Ocean wave', desc: 'Teal and blue waves with rippling presses.', colors: ['#06b6d4', '#0ea5e9', '#3b82f6', '#14b8a6', '#67e8f9'], frets: Z(IDLE.COLOR_WAVE, 75, PRESS.RIPPLE, 3, 6, false), strum: Z(IDLE.COLOR_WAVE, 75, PRESS.SWEEP, 3, 6, false),
    strumColor: '#0ea5e9', up: '#67e8f9', down: '#1d4ed8', star: { color: '#67e8f9', anim: STAR.PULSE, speed: 3, zones: 3, flash: false }, whammy: { fx: WFX.WAVE, zones: 3 } },
  { name: 'Heartbeat', desc: 'Thumping reds, like a pulse.', colors: ['#ff2d2d', '#ff4d6d', '#ff1f5a', '#e11d48', '#ff6b6b'], frets: Z(IDLE.HEARTBEAT, 90, PRESS.FLASH_FADE), strum: Z(IDLE.HEARTBEAT, 90, PRESS.COLOR), strumColor: '#ff2d2d',
    star: { color: '#ff2d2d', anim: STAR.PULSE, speed: 8, zones: 3, flash: true }, whammy: { fx: WFX.PULSE, zones: 3 } },
  { name: 'Candy', desc: 'Pastel sparkles, a random colour on every press.', colors: ['#ff8fd0', '#ffd166', '#7ae7c7', '#8ec5ff', '#c8a2ff'], frets: Z(IDLE.SPARKLE, 55, PRESS.RAINBOW, 6, 5, false), strum: Z(IDLE.SPARKLE, 55, PRESS.SPARK, 6, 5, false),
    strumLeds: ['#ff8fd0', '#ffd166', '#7ae7c7', '#8ec5ff', '#c8a2ff'], up: '#ff8fd0', down: '#8ec5ff', star: { color: '#ffd1f0', anim: STAR.SPARKLE, speed: 5, zones: 3, flash: false }, whammy: { fx: WFX.HUE, zones: 3 } },
  { name: 'Aurora', desc: 'Colours that slowly drift round the wheel.', colors: ['#34d399', '#22d3ee', '#818cf8', '#c084fc', '#4ade80'], frets: Z(IDLE.HUE_DRIFT, 70, PRESS.FLASH_FADE, 3, 7, false), strum: Z(IDLE.HUE_DRIFT, 70, PRESS.SWEEP, 3, 6, false),
    strumColor: '#34d399', up: '#22d3ee', down: '#c084fc', star: { color: '#34d399', anim: STAR.PULSE, speed: 4, zones: 3, flash: false }, whammy: { fx: WFX.HUE, zones: 3 } },
  { name: 'Mono white', desc: 'Clean white, nothing fancy.', colors: P[4], frets: Z(IDLE.SOLID, 20, PRESS.FLASH_FADE), strum: Z(IDLE.SOLID, 20, PRESS.COLOR), strumColor: '#ffffff',
    star: { color: '#ffffff', anim: STAR.PULSE, speed: 5, zones: 3, flash: false }, whammy: { fx: WFX.BRIGHT, zones: 3 } },
];

export function applyTheme(c, t) {
  c.colors = t.colors.slice();
  c.fretPress = t.colors.map(brighter); c.fret2Colors = t.colors.slice(); c.fret2Own = false;
  c.zoneFrets = { ...t.frets, perLed: false };
  const sl = t.strumLeds, sc = t.strumColor || t.colors[0];
  c.zoneStrum = { ...t.strum, perLed: !!sl };
  c.strumColor = sc;
  c.strumLedColors = Array.from({ length: MAX_STRUM_LEDS }, (_, k) => (sl ? sl[k % sl.length] : sc));
  c.strumUpColor = t.up || '#00c8ff'; c.strumDownColor = t.down || '#ff3cc8';
  c.starColor = t.star.color; c.starAnim = t.star.anim; c.starSpeed = t.star.speed; c.starZones = t.star.zones; c.starFlash = !!t.star.flash;
  c.whammyFx = t.whammy.fx; c.whammyZones = t.whammy.zones;
}
// frets -> strum bar: the same animation and reaction, the fret palette spread along the bar
export function copyFretsToStrum(c) {
  c.zoneStrum = { ...c.zoneFrets, perLed: (c.strumLeds || 0) > 1 };
  const n = Math.max(1, c.strumLeds || 1);
  c.strumLedColors = Array.from({ length: MAX_STRUM_LEDS }, (_, k) => c.colors[n > 1 ? Math.round((Math.min(k, n - 1) * 4) / (n - 1)) : 0]);
  c.strumColor = c.colors[0];
  if (!c.zoneFrets.same) { c.strumUpColor = c.fretPress[1]; c.strumDownColor = c.fretPress[3]; }
}

// ------------------------------------------------------------------ small helpers for bound controls
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
const FMT = {
  pct: (v) => `${v} %`, ms: (v) => `${1100 - 100 * v} ms`, min: (v) => (+v ? `${v} min` : 'Never'), num: (v) => String(v),
};
const LISTS = { 'zoneFrets.idle': IDLE_ANIMS, 'zoneFrets.press': PRESS_FX, 'zoneStrum.idle': IDLE_ANIMS, 'zoneStrum.press': PRESS_FX, starAnim: STAR_ANIMS, whammyFx: WHAMMY_FX };
const MORE_KEY = 'yacc.lfxMore';
const readMore = () => { try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; } };
const writeMore = (on) => { try { localStorage.setItem(MORE_KEY, on ? '1' : '0'); } catch { /* storage blocked */ } };

let S = null;   // the studio's live state: { ctx, root, engine, manual, raf, star, ... }

const needHtml = () => '<p class="lfx-need" hidden>These options need <b>firmware 0.34</b>. <button type="button" class="btn small" data-led-update>Update firmware</button></p>';

const select = (id, path, label, list) => `<div class="lfx-field"><label for="${id}">${label}</label>
  <select id="${id}" data-b="${path}" data-num>${list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
  <p class="dim small lfx-desc" data-desc="${path}"></p></div>`;
const speedField = (id, path) => `<div class="lfx-field narrow" id="${id}"><label for="${id}In">Speed <output class="val" data-out="${path}" data-fmt="num"></output></label>
  <input type="range" id="${id}In" data-b="${path}" min="1" max="10" step="1"></div>`;
const slider = (id, path, label, min, max, fmt) => `<div class="slider-row" id="${id}"><label for="${id}In">${label}</label><output class="val" data-out="${path}" data-fmt="${fmt}"></output>
  <input type="range" id="${id}In" data-b="${path}" min="${min}" max="${max}" step="1"></div>`;
const check = (id, path, label, bit = '') => `<label class="lfx-check" id="${id}Row"><input type="checkbox" id="${id}" data-b="${path}" ${bit ? `data-bit="${bit}"` : ''}><span>${label}</span></label>`;
const picker = (path, label, extra = '') => `<input type="color" class="lfx-pick" data-b="${path}" aria-label="${esc(label)}" ${extra}>`;
const swatch = (label, path, extra = '', aria = label) => `<span class="lfx-sw"><span class="lfx-lbl">${label}</span>${picker(path, aria, extra)}</span>`;
const zoneChecks = (path, name) => `<div class="lfx-zones" role="group" aria-label="${name}">${check(path.replace(/\W/g, '') + 'F', path, 'Fret LEDs', 1)}${check(path.replace(/\W/g, '') + 'S', path, 'Strum bar LEDs', 2)}</div>`;

function previewHtml() {
  return `<h2 class="look-h">Live preview</h2>
    <div class="studio-off" id="studioOff" hidden><span>LEDs are switched off.</span> <button type="button" class="btn small primary" id="studioOn">Turn LEDs on</button></div>
    <div class="lfx-stage" id="lfxStage"><p class="dim" id="lfxNoLeds" hidden>No LEDs in the layout. Choose fret and / or strum LEDs under Change setup.</p>
      <div class="lfx-frets" id="lfxFrets" role="group" aria-label="Fret LEDs. Press and hold to preview a fret."></div>
      <div class="lfx-strum" id="lfxStrum" role="group" aria-label="Strum bar LEDs"><div class="lfx-bar" id="lfxBar"></div>
        <div class="lfx-strumbtns"><button type="button" class="btn small lfx-hold" data-hold="up"><span aria-hidden="true">&#9650;</span> Strum up</button><button type="button" class="btn small lfx-hold" data-hold="down"><span aria-hidden="true">&#9660;</span> Strum down</button></div></div></div>
    <div class="lfx-ctl"><button type="button" class="btn small lfx-starbtn" id="lfxStarBtn" aria-pressed="false"><span aria-hidden="true">&#9733;</span> Preview star power</button>
      <div class="lfx-whammy"><label for="lfxWhammy">Whammy</label><input type="range" id="lfxWhammy" min="0" max="100" value="0"></div></div>
    <div class="lfx-starnote" id="lfxStarNote" hidden><span id="lfxGlowT">Star power glow is off on the guitar — turn it on</span>
      <label class="switch"><input type="checkbox" id="lfxGlowSw" data-b="rgbStarPower" aria-labelledby="lfxGlowT"><i></i></label></div>
    <p class="dim small lfx-starnote" id="lfxZoneNote" hidden>Star power is set to show on no LEDs. Pick where under More options, Star power.</p>
    <p class="dim small" id="lfxHint">Click, tap or hold the frets and strum buttons to try your settings. It also follows the real guitar.</p>
    <p class="dim small" id="lfxFwNote" hidden></p>`;
}

function controlsHtml() {
  return `<h2>Start with a theme</h2>${needHtml()}
    <div data-v7><div class="lfx-themes" id="lfxThemes"></div></div>
    <h2 class="lfx-customise">Customise</h2>
    <div data-v7>
      <section class="lfx-grp" aria-labelledby="gFrets"><h3 id="gFrets">Frets</h3>
        <div class="lfx-fields">${select('lfxFretIdle', 'zoneFrets.idle', 'Idle', IDLE_ANIMS)}${select('lfxFretPress', 'zoneFrets.press', 'When pressed', PRESS_FX)}${speedField('lfx-frets-speed', 'zoneFrets.speed')}</div>
        <div id="lfxFretCols" class="lfx-fretcols" role="group" aria-label="Fret colours"></div>
        ${check('lfxFretSame', 'zoneFrets.same', 'Pressed = same colour')}
      </section>
      <section class="lfx-grp" aria-labelledby="gStrum"><h3 id="gStrum">Strum bar</h3>
        <p class="dim small" id="lfxStrumNone" hidden>No strum LEDs — add them in LED setup.</p>
        <div id="lfxStrumBody">
          <div class="lfx-fields">${select('lfxStrumIdle', 'zoneStrum.idle', 'Idle', IDLE_ANIMS)}${select('lfxStrumPress', 'zoneStrum.press', 'When pressed', PRESS_FX)}${speedField('lfx-strum-speed', 'zoneStrum.speed')}</div>
          <div class="lfx-swrow" id="lfxStrumCols" role="group" aria-label="Strum bar colours"></div>
          ${check('lfxStrumSame', 'zoneStrum.same', 'Pressed = same colour')}
          <p class="dim small lfx-warn" id="lfxStrumPressNote" hidden>The reaction picked above (<b>No reaction</b>, <b>Dim</b> or <b>Go dark</b>) doesn't use a pressed colour: pick <b>Light up</b>, <b>Flash &amp; fade</b> or another one to see the up / down colours.</p>
        </div>
      </section>
    </div>
    <section class="lfx-grp" aria-labelledby="gStar"><h3 id="gStar">Star power</h3>
      <label class="lfx-check" id="rgbSpRow"><input type="checkbox" id="rgbSp" data-b="rgbStarPower"><span>Glow when the game reports star power</span></label>
      <div data-v7><div class="lfx-fields">${select('lfxStarAnim', 'starAnim', 'Animation', STAR_ANIMS)}
        <div class="lfx-field narrow"><span class="lfx-lbl" id="lfxStarColT">Colour</span><span class="lfx-sw">${picker('starColor', 'Star power colour')}</span></div></div></div>
    </section>
    <details class="lfx-more" id="lfxMore" ${S.moreOpen ? 'open' : ''}><summary><span>More options</span><span class="lfx-badge" id="lfxMoreN" hidden></span></summary>
      <div class="lfx-more-body">
        <div data-v7>
        <section class="lfx-grp" aria-labelledby="mFrets"><h4 id="mFrets">Frets</h4>
          ${slider('lfx-frets-level', 'zoneFrets.idleLevel', 'Idle brightness', 0, 100, 'pct')}
          ${slider('lfx-frets-fade', 'zoneFrets.fade', 'Fade time', 1, 10, 'ms')}
          <div id="lfxFret2Wrap">${check('lfxFret2', 'fret2Own', 'Second LED has its own colour')}<div class="lfx-swrow" id="lfxFret2Cols" role="group" aria-label="Second LED colours"></div></div>
          <div class="row lfx-quick"><button type="button" class="btn small" id="lfxPressWhite">Pressed = white</button><button type="button" class="btn small" id="lfxPressBright">Pressed = brighter</button></div>
          <h5 class="lfx-sub">Colour palettes</h5><div class="presets" id="lfxPalettes"></div>
        </section>
        <section class="lfx-grp" id="lfxMoreStrum" aria-labelledby="mStrum"><h4 id="mStrum">Strum bar</h4>
          ${slider('lfx-strum-level', 'zoneStrum.idleLevel', 'Idle brightness', 0, 100, 'pct')}
          ${slider('lfx-strum-fade', 'zoneStrum.fade', 'Fade time', 1, 10, 'ms')}
          ${check('lfxPerLed', 'zoneStrum.perLed', 'Each strum LED its own colour')}
          <div class="row lfx-quick"><button type="button" class="btn small" id="lfxCopy">Copy fret settings to strum bar</button></div>
        </section>
        <section class="lfx-grp" aria-labelledby="mStar"><h4 id="mStar">Star power</h4>
          ${slider('lfx-star-speed', 'starSpeed', 'Speed', 1, 10, 'num')}
          <p class="lfx-lbl small">Show star power on</p>${zoneChecks('starZones', 'Star power zones')}
          ${check('lfxFlash', 'starFlash', 'Flash white when I activate star power')}
        </section>
        <section class="lfx-grp" aria-labelledby="mWham"><h4 id="mWham">Whammy</h4>
          <div class="lfx-fields">${select('lfxWhammyFx', 'whammyFx', 'Effect', WHAMMY_FX)}</div>
          <p class="lfx-lbl small">Show whammy on</p>${zoneChecks('whammyZones', 'Whammy zones')}
        </section>
        <section class="lfx-grp" aria-labelledby="mOther"><h4 id="mOther">Other</h4>
          <div class="slider-row" id="lfxSleepRow"><label for="lfxSleepIn">Turn LEDs off when idle</label><output class="val" data-out="sleepMin" data-fmt="min"></output>
            <input type="range" id="lfxSleepIn" data-b="sleepMin" min="0" max="30" step="1"></div>
        </section>
        </div>
        <section class="lfx-grp" aria-labelledby="mOther2"><h4 id="mOther2" class="lfx-sr">Plug-in</h4>
          ${check('rgbFlash', 'rgbBootFlash', 'Show the mode at plug-in (the fret that picks it flashes)')}
        </section>
      </div></details>`;
}

// ------------------------------------------------------------------ DOM <-> config
function readControl(el) {
  const c = S.ctx.state.cfg, p = el.dataset.b;
  if (el.type === 'checkbox') {
    if (el.dataset.bit) return (getPath(c, p) & ~(+el.dataset.bit)) | (el.checked ? +el.dataset.bit : 0);
    return el.checked;
  }
  if (el.type === 'range' || el.dataset.num !== undefined) return +el.value;
  return el.value;
}
function writeControl(el) {
  const c = S.ctx.state.cfg, v = getPath(c, el.dataset.b);
  if (el.type === 'checkbox') el.checked = el.dataset.bit ? !!(v & +el.dataset.bit) : !!v;
  else if (v === undefined) return;
  else if (el.type === 'range' || el.dataset.num !== undefined) { if (el.value !== String(v)) el.value = v; }
  else if (el.value !== v) el.value = v;
}
const v7 = () => (S.ctx.state.cfg.cfgVersion ?? 0) >= 7;
const OLD_OK = ['rgbStarPower', 'rgbBootFlash'];   // the only studio switches that work on firmware before 0.34

function changed(structural = false) {
  S.ctx.changed();
  sync(structural);
}

function wire() {
  const root = S.root;
  // the page rebuilds the studio's HTML inside the same root (reconnect, undo): delegate everything once, never per rebuild
  if (root._lfxWired) return;
  root._lfxWired = true;
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'lfxWhammy') { S.manual.whammy = +el.value / 100; S.manual.wAt = performance.now(); return; }
    if (el.dataset?.b && (el.type === 'range' || el.type === 'color')) {
      if (!v7() && !OLD_OK.includes(el.dataset.b)) return;
      const c = S.ctx.state.cfg;
      setPath(c, el.dataset.b, readControl(el));
      let flip = false;
      if (/^fretPress\./.test(el.dataset.b) && c.zoneFrets.same) { c.zoneFrets.same = false; flip = true; }
      if (/^strum(Up|Down)Color$/.test(el.dataset.b) && c.zoneStrum.same) { c.zoneStrum.same = false; flip = true; }
      changed(flip);
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.b && (el.type === 'checkbox' || el.tagName === 'SELECT')) {
      if (!v7() && !OLD_OK.includes(el.dataset.b)) return;
      setPath(S.ctx.state.cfg, el.dataset.b, readControl(el)); changed(true);
    }
  });
  root.addEventListener('click', (e) => {
    const t = e.target;
    // star power preview: a plain toggle, shown even when the guitar's star power glow is off
    if (t.closest('#lfxStarBtn')) { S.star = !S.star; if (S.star) S.manual.starPressed = true; sync(); return; }
    const th = t.closest('[data-theme]');
    if (th && v7()) { applyTheme(S.ctx.state.cfg, THEMES[+th.dataset.theme]); changed(true); S.ctx.toast?.(`Theme: ${THEMES[+th.dataset.theme].name}`, 'ok'); return; }
    const pal = t.closest('[data-palette]');
    if (pal && v7()) { const c = S.ctx.state.cfg; c.colors = RGB_PRESETS[+pal.dataset.palette].colors.slice(); c.fret2Colors = c.colors.slice(); if (c.zoneFrets.same) c.fretPress = c.colors.slice(); changed(true); return; }
    if (t.closest('#lfxCopy') && v7()) { copyFretsToStrum(S.ctx.state.cfg); changed(true); S.ctx.toast?.('Copied the fret settings to the strum bar', 'ok'); return; }
    if (t.closest('#lfxPressWhite') && v7()) { const c = S.ctx.state.cfg; c.fretPress = Array(5).fill('#ffffff'); c.zoneFrets.same = false; changed(true); return; }
    if (t.closest('#lfxPressBright') && v7()) { const c = S.ctx.state.cfg; c.fretPress = c.colors.map(brighter); c.zoneFrets.same = false; changed(true); return; }
    if (t.closest('#studioOn')) S.ctx.turnOn();
    if (t.closest('#lfxUpd')) S.ctx.goUpdate?.();
  });
  root.addEventListener('toggle', (e) => { if (e.target.id === 'lfxMore') { S.moreOpen = e.target.open; writeMore(S.moreOpen); } }, true);
  // the preview's hold buttons: pointer or keyboard, held while pressed
  const hold = (key, on) => { const now = performance.now(); S.manual.down[key] = on; if (on) S.manual.until[key] = now + 170; };
  const holdTarget = (e) => e.target.closest?.('[data-hold]')?.dataset.hold;
  root.addEventListener('pointerdown', (e) => { const k = holdTarget(e); if (k) { hold(k, true); try { e.target.closest('[data-hold]').setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } } });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(t, (e) => { const k = holdTarget(e); if (k) hold(k, false); });
  root.addEventListener('keydown', (e) => { const k = holdTarget(e); if (k && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) hold(k, true); } });
  root.addEventListener('keyup', (e) => { const k = holdTarget(e); if (k && (e.key === ' ' || e.key === 'Enter')) hold(k, false); });
  root.addEventListener('blur', (e) => { const k = holdTarget(e); if (k) hold(k, false); }, true);
}

// ------------------------------------------------------------------ sync config -> controls
const rowsKey = (c) => JSON.stringify([c.fretLeds, c.noFretLeds, c.strumLeds, c.strumRoles, c.zoneStrum?.perLed]);
function renderRows(c) {
  const key = rowsKey(c);
  if (S.rowsKey === key) return;
  S.rowsKey = key;
  const l = ledLayout(c), two = l.frets && l.per === 2;
  const R = $('#lfxFretCols', S.root);
  R.innerHTML = `<span></span>${[0, 1, 2, 3, 4].map((f) => `<span class="lfx-hd"><span class="fretdot" style="background:${FRET_DEFAULT_COLORS[f]}"></span>${esc(FRET_NAMES[f][0])}</span>`).join('')}
    <span class="lfx-lbl">Idle</span>${[0, 1, 2, 3, 4].map((f) => picker(`colors.${f}`, `${FRET_NAMES[f]} idle colour`)).join('')}
    <span class="lfx-lbl">Pressed</span>${[0, 1, 2, 3, 4].map((f) => picker(`fretPress.${f}`, `${FRET_NAMES[f]} pressed colour`, 'data-pcol')).join('')}`;
  $('#lfxFret2Cols', S.root).innerHTML = [0, 1, 2, 3, 4].map((f) => picker(`fret2Colors.${f}`, `${FRET_NAMES[f]} second LED colour`, 'data-c2')).join('');
  $('#lfxFret2Wrap', S.root).hidden = !two;
  const n = l.strum, per = !!c.zoneStrum?.perLed;
  $('#lfxStrumCols', S.root).innerHTML = (per
    ? [...Array(n).keys()].map((k) => swatch(`LED ${k + 1}`, `strumLedColors.${k}`, '', `Strum LED ${k + 1} idle colour`)).join('')
    : swatch('Idle', 'strumColor', '', 'Strum bar idle colour')) + swatch('Strum up', 'strumUpColor', 'data-pcol') + swatch('Strum down', 'strumDownColor', 'data-pcol');
  $('#lfxStrumNone', S.root).hidden = !!n;
  $('#lfxStrumBody', S.root).hidden = !n;
  $('#lfxMoreStrum', S.root).hidden = !n;
}

// settings in "More options" that are not at their default, so nothing active is ever hidden
function moreChanged(c, l) {
  const r = [], z = c.zoneFrets, s = c.zoneStrum;
  if (z.idleLevel !== 25) r.push('fret idle brightness');
  if (z.fade !== 5) r.push('fret fade time');
  if (c.fret2Own && l.frets && l.per === 2) r.push('second LED colours');
  if (l.strum) { if (s.idleLevel !== 25) r.push('strum idle brightness'); if (s.fade !== 5) r.push('strum fade time'); if (s.perLed) r.push('strum LED colours'); }
  if (c.starSpeed !== 5) r.push('star power speed');
  if (c.starZones !== 3) r.push('star power zones');
  if (c.starFlash) r.push('star flash');
  if (c.whammyFx !== WFX.NONE) r.push('whammy effect');
  if (c.whammyZones !== 3) r.push('whammy zones');
  if (c.sleepMin) r.push('sleep timer');
  if (c.rgbBootFlash === false) r.push('mode flash at plug-in');
  return r;
}

function sync() {
  if (!S) return;
  const c = S.ctx.state.cfg, root = S.root, ok = v7(), l = ledLayout(c);
  S.engine.setConfig(c);
  renderRows(c);
  $$('[data-b]', root).forEach(writeControl);
  $$('[data-out]', root).forEach((o) => { o.textContent = FMT[o.dataset.fmt || 'num'](getPath(c, o.dataset.out)); });
  $$('[data-desc]', root).forEach((p) => { p.textContent = LISTS[p.dataset.desc][getPath(c, p.dataset.desc)]?.desc || ''; });
  // locked on firmware before 0.34
  $$('.lfx-need', root).forEach((e) => { e.hidden = ok; });
  $$('[data-v7]', root).forEach((e) => { e.inert = !ok; e.classList.toggle('lfx-locked', !ok); });
  // dependent rows
  for (const zn of ['frets', 'strum']) {
    const z = c[zn === 'frets' ? 'zoneFrets' : 'zoneStrum'];
    const idle = IDLE_ANIMS[z.idle], press = PRESS_FX[z.press];
    $(`#lfx-${zn}-level`, root).hidden = z.idle === IDLE.OFF;
    $(`#lfx-${zn}-speed`, root).hidden = !(idle.speed || z.press === PRESS.STROBE);
    $(`#lfx-${zn}-fade`, root).hidden = !press.fade;
  }
  $('#lfx-star-speed', root).hidden = !(c.starAnim === STAR.PULSE || c.starAnim === STAR.STROBE);
  $$('[data-pcol]', root).forEach((e) => { e.classList.toggle('dim-col', e.dataset.b.startsWith('fretPress') ? !!c.zoneFrets.same : !!c.zoneStrum.same); });   // still clickable: picking one switches "same" off
  $$('[data-c2]', root).forEach((e) => { e.disabled = !c.fret2Own; e.classList.toggle('dim-col', !c.fret2Own); });
  $('#lfxStrumPressNote', root).hidden = ![0, 3, 4].includes(c.zoneStrum.press) || !l.strum;
  $('#lfxPerLed', root).disabled = !l.strum;
  // preview: layout, off notice, star button and its notes
  $('#studioOff', root).hidden = !!c.rgbEnabled;
  const fwn = $('#lfxFwNote', root), pok = !!S.ctx.fwPreview?.();
  if (fwn && fwn._ok !== pok) {
    fwn._ok = pok; fwn.hidden = false;
    fwn.innerHTML = pok ? 'Your guitar\'s LEDs follow the preview while you use it.' : 'Update to firmware 0.35 to see the preview on the guitar\'s LEDs too. <button type="button" class="btn small" id="lfxUpd">Update firmware</button>';
  }
  $('#lfxStarBtn', root).setAttribute('aria-pressed', S.star);
  $('#lfxStarBtn', root).classList.toggle('on', S.star);
  $('#lfxStarNote', root).hidden = !S.star || !!c.rgbStarPower;
  $('#lfxZoneNote', root).hidden = !(S.star && ok && !(c.starZones & 3));
  const sig = JSON.stringify([l.frets, l.per, l.strum]);
  if (S.stageSig !== sig) { S.stageSig = sig; drawStage(l); }
  $('#lfxNoLeds', root).hidden = !!l.chain;
  // "More options" badge
  const ch = ok ? moreChanged(c, l) : (c.rgbBootFlash === false ? ['mode flash at plug-in'] : []);
  const badge = $('#lfxMoreN', root);
  badge.hidden = !ch.length; badge.textContent = `${ch.length} changed`; badge.title = ch.join(', ');
  paintThemes(c);
}

// themes list (once) + a marker on the one that matches the colours
function paintThemes(c) {
  const box = $('#lfxThemes', S.root);
  if (!box.children.length) {
    box.innerHTML = THEMES.map((t, i) => {
      const sw = t.swatch || t.colors, up = t.up || t.strumColor || sw[0], dn = t.down || t.strumColor || sw[4];
      return `<button type="button" class="lfx-theme" data-theme="${i}" title="${esc(t.desc)}"><span class="lfx-tsw" aria-hidden="true">${sw.map((x) => `<i style="background:${x}"></i>`).join('')}<b style="background:linear-gradient(90deg,${t.swatch ? 'red,orange,yellow,lime,cyan,blue,magenta' : `${up},${dn}`})"></b></span><span class="lfx-tname">${esc(t.name)}</span></button>`;
    }).join('');
  }
  $$('.lfx-theme', box).forEach((b, i) => { const t = THEMES[i], on = JSON.stringify(t.colors) === JSON.stringify(c.colors) && t.frets.idle === c.zoneFrets.idle && t.frets.press === c.zoneFrets.press && t.strum.idle === c.zoneStrum.idle; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const pal = $('#lfxPalettes', S.root);
  if (!pal.children.length) pal.innerHTML = RGB_PRESETS.map((p, i) => `<button type="button" class="preset" data-palette="${i}">${p.colors.map((x) => `<i style="background:${x}"></i>`).join('')}<span>${p.name}</span></button>`).join('');
}

// ------------------------------------------------------------------ preview stage
function drawStage(l) {
  const frets = $('#lfxFrets', S.root), bar = $('#lfxBar', S.root);
  S.fretEls = []; S.strumEls = [];
  frets.hidden = !l.frets; $('#lfxStrum', S.root).hidden = !l.strum;
  frets.innerHTML = [0, 1, 2, 3, 4].map((f) => `<button type="button" class="lfx-fret" data-hold="f${f}" aria-label="${FRET_NAMES[f]} fret (hold to press)"><span class="lfx-leds ${l.per === 2 ? 'two' : ''}"><i class="lfx-led"></i>${l.per === 2 ? '<i class="lfx-led"></i>' : ''}</span><span class="lfx-fname">${FRET_NAMES[f][0]}</span></button>`).join('');
  $$('.lfx-fret', frets).forEach((b) => S.fretEls.push($$('.lfx-led', b)));
  bar.innerHTML = [...Array(l.strum).keys()].map((k) => `<i class="lfx-led strum" data-k="${k}"></i>`).join('');
  $$('.lfx-led', bar).forEach((e) => S.strumEls.push(e));
  S.last = {};
}
const gamma = (v) => 255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, 0.85);
function paintLed(el, px) {
  const r = gamma(px[0]), g = gamma(px[1]), b = gamma(px[2]), key = (r << 16 | g << 8 | b) >>> 0;
  if (el._k === key) return;
  el._k = key;
  const lum = Math.max(r, g, b) / 255;
  el.style.setProperty('--c', `rgb(${r | 0},${g | 0},${b | 0})`);
  el.style.setProperty('--i', lum.toFixed(2));
}

function liveInput(now) {
  const ctx = S.ctx, c = ctx.state.cfg, s = ctx.state.status, m = S.manual;
  const real = (pin) => !!s && pin !== undefined && isPressed(s, pin);
  const held = (k) => !!m.down[k] || now < (m.until[k] || 0);
  const starNow = real(c.pins[7]);
  const starPressed = (starNow && !S.prevStar) || m.starPressed;
  S.prevStar = starNow; m.starPressed = false;
  const real_w = s ? ctx.whammy(s) : 0;
  return {
    frets: [0, 1, 2, 3, 4].map((f) => held('f' + f) || real(c.pins[f])),
    up: held('up') || real(c.pins[5]), down: held('down') || real(c.pins[6]),
    star: S.star, forceStar: true, starPressed, whammy: Math.max(m.whammy, real_w),
  };
}

// The preview's own inputs mirrored to the guitar's LEDs (firmware 0.35+, VREQ_LEDPREVIEW). Changes go out at most every
// 50 ms (the latest wins), a keep-alive every 400 ms while anything is active, and one "off" when it all goes quiet.
const PV = { bits: 0, on: false, at: -1e9, busy: false };
function pvSend(bits, on, now) {
  PV.bits = bits; PV.on = on; PV.at = now; PV.busy = true;
  try { Promise.resolve(S?.ctx.preview?.(bits, on)).catch(() => {}).finally(() => { PV.busy = false; }); } catch { PV.busy = false; }
}
function pvOff() { if (PV.on) { PV.on = false; PV.bits = 0; try { Promise.resolve(S?.ctx.preview?.(0, false)).catch(() => {}); } catch { /* gone */ } } }
function pvPump(now) {
  if (!S.ctx.fwPreview?.()) { PV.on = false; return; }
  const m = S.manual, held = (k) => !!m.down[k] || now < (m.until[k] || 0);
  let bits = 0;
  for (let f = 0; f < 5; f++) if (held('f' + f)) bits |= 1 << f;
  if (held('up')) bits |= 32;
  if (held('down')) bits |= 64;
  if (S.star) bits |= 128;
  bits |= Math.round(Math.min(1, Math.max(0, m.whammy)) * 255) << 8;
  const since = now - PV.at;
  if (PV.busy && since < 2000) return;
  if (bits !== PV.bits || (bits && !PV.on)) { if (since >= 50 && (bits || PV.on)) pvSend(bits, !!bits, now); }
  else if (bits && since >= 400) pvSend(bits, true, now);
}
addEventListener('pagehide', pvOff);
document.addEventListener('visibilitychange', () => { if (document.hidden) pvOff(); });

function frameLoop(now) {
  if (!S || !S.root.isConnected || S.ctx.state.view !== 'lights') { if (S) S.raf = 0; pvOff(); return; }
  S.raf = requestAnimationFrame(frameLoop);
  pvPump(performance.now());
  const c = S.ctx.state.cfg;
  S.engine.setConfig(c);
  const f = S.engine.tick(now, liveInput(now));
  const l = ledLayout(c);
  if (l.frets) for (let k = 0; k < 5; k++) { paintLed(S.fretEls[k][0], f.fret[k]); if (S.fretEls[k][1]) paintLed(S.fretEls[k][1], f.fret2[k]); }
  for (let k = 0; k < S.strumEls.length; k++) if (f.strum[k]) paintLed(S.strumEls[k], f.strum[k]);
  $$('.lfx-fret, .lfx-hold', S.root).forEach((b) => { const k = b.dataset.hold, on = !!S.manual.down[k] || now < (S.manual.until[k] || 0); if (b._on !== on) { b._on = on; b.classList.toggle('held', on); } });
  S.frame = f;
}

// ------------------------------------------------------------------ public
export function buildStudio(ctx) {
  const root = $('#studio');
  if (!root) return;
  if (S?.raf) cancelAnimationFrame(S.raf);
  const keepStar = S?.star || false;
  S = { ctx, root, engine: createEngine(ctx.state.cfg), manual: { down: {}, until: {}, whammy: 0, starPressed: false }, star: keepStar, moreOpen: S ? S.moreOpen : readMore(), raf: 0, rowsKey: null, stageSig: null, fretEls: [], strumEls: [] };
  $('#studioPrev', root).innerHTML = previewHtml();
  $('#studioCtl', root).innerHTML = controlsHtml();
  wire();
  sync();
  S.raf = requestAnimationFrame(frameLoop);
  // test hook: the latest rendered frame
  window.__lfx = { frame: () => S?.frame, engine: () => S?.engine, star: (on) => { S.star = on; sync(); } };
}
export function syncStudio() { if (S) { sync(); if (!S.raf && S.ctx.state.view === 'lights') S.raf = requestAnimationFrame(frameLoop); } }
