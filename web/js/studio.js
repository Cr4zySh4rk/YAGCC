// Lights page "lighting studio": live LED preview, themes and the zone tabs (frets, strum bar, star power, whammy).
// Needs firmware 0.34 (config version 7); on older firmware the sections are shown locked. The preview itself always runs.
import {
  IDLE, PRESS, STAR, WFX, IDLE_ANIMS, PRESS_FX, STAR_ANIMS, WHAMMY_FX, RGB_PRESETS, FRET_DEFAULT_COLORS, FUNC_LABEL, FUNCS, STRUM_ROLES,
  isPressed, hexToRgb, rgbToHex, ledLayout, effectZone, MAX_STRUM_LEDS,
} from './protocol.js?v=dev';
import { createEngine, toCss } from './ledfx.js?v=dev';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const mixHex = (h, to, t) => { const a = hexToRgb(h), b = to; return rgbToHex(...a.map((v, i) => Math.round(v + (b[i] - v) * t))); };
const brighter = (h) => mixHex(h, [255, 255, 255], 0.55);
const FRET_NAMES = [0, 1, 2, 3, 4].map((i) => FUNC_LABEL[FUNCS[i]]);
const ROLE_TXT = ['up and down', 'up', 'down'];

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

let S = null;   // the studio's live state: { ctx, root, engine, manual, raf, tab, ... }

const needHtml = () => '<p class="lfx-need" hidden>These options need <b>firmware 0.34</b>. <button type="button" class="btn small" data-led-update>Update firmware</button></p>';
const lockWrap = (inner) => `<div data-v7>${inner}</div>`;

function cards(path, list, label) {
  return `<div class="lfx-cards" role="radiogroup" aria-label="${esc(label)}" data-cards="${path}">${list.map((e) => `<button type="button" role="radio" class="lfx-card" data-id="${e.id}" aria-checked="false" tabindex="-1">
    <span class="lfx-sw" data-sw="${path}:${e.id}" aria-hidden="true">${'<i></i>'.repeat(5)}</span><b>${esc(e.name)}</b><span class="dim">${esc(e.desc)}</span></button>`).join('')}</div>`;
}
const slider = (id, path, label, min, max, fmt, extra = '') => `<div class="slider-row" id="${id}" ${extra}><label for="${id}In">${label}</label><output class="val" data-out="${path}" data-fmt="${fmt}"></output>
  <input type="range" id="${id}In" data-b="${path}" min="${min}" max="${max}" step="1"></div>`;
const toggle = (id, path, title, desc, extra = '', bit = '') => `<div class="opt${extra.includes('data-adv') ? ' adv' : ''}" ${extra}><div><h3 id="${id}T">${title}</h3><p class="dim">${desc}</p></div>
  <label class="switch"><input type="checkbox" id="${id}" data-b="${path}" ${bit ? `data-bit="${bit}"` : ''} aria-labelledby="${id}T"><i></i></label></div>`;
const picker = (path, label, extra = '') => `<input type="color" class="lfx-pick" data-b="${path}" aria-label="${esc(label)}" ${extra}>`;
const zoneChecks = (path, name) => `<div class="lfx-zones" role="group" aria-label="${name}">
  <label class="lfx-check"><input type="checkbox" data-b="${path}" data-bit="1"><span>Fret LEDs</span></label>
  <label class="lfx-check"><input type="checkbox" data-b="${path}" data-bit="2"><span>Strum bar LEDs</span></label></div>`;

function zonePanel(zn) {
  const zk = zn === 'frets' ? 'zoneFrets' : 'zoneStrum', name = zn === 'frets' ? 'fret' : 'strum bar';
  return `${needHtml()}<div data-v7>
    <section class="lfx-sec"><h3>Idle animation</h3><p class="dim small">What the ${name} LEDs do while nothing is pressed.</p>
      ${cards(`${zk}.idle`, IDLE_ANIMS, `${name} idle animation`)}
      ${slider(`lfx-${zn}-level`, `${zk}.idleLevel`, 'Idle brightness', 0, 100, 'pct')}
      ${slider(`lfx-${zn}-speed`, `${zk}.speed`, 'Speed', 1, 10, 'num')}</section>
    <section class="lfx-sec"><h3>When pressed</h3><p class="dim small">How the ${name} LEDs react when you ${zn === 'frets' ? 'hold a fret' : 'strum'}.</p>
      ${cards(`${zk}.press`, PRESS_FX, `${name} reaction`)}
      ${slider(`lfx-${zn}-fade`, `${zk}.fade`, 'Fade time', 1, 10, 'ms')}</section>
    <section class="lfx-sec"><h3>Colours</h3>${zn === 'frets' ? fretColours() : strumColours()}</section></div>`;
}
function fretColours() {
  return `<div id="lfxFretCols" class="lfx-colgrid" role="group" aria-label="Fret colours"></div>
    ${toggle('lfxFretSame', 'zoneFrets.same', 'Pressed colour = idle colour', 'The fret keeps its own colour when pressed. Turn off to pick a different pressed colour for each fret.')}
    <div class="row lfx-quick"><button type="button" class="btn small" id="lfxPressWhite">Pressed = white</button><button type="button" class="btn small" id="lfxPressBright">Pressed = brighter</button></div>
    ${toggle('lfxFret2', 'fret2Own', 'Second LED has its own colour', 'With two LEDs per fret, give the second one a colour of its own.', 'id="lfxFret2Row" data-adv')}
    <h4 class="lfx-sub">Colour palettes</h4><div class="presets" id="lfxPalettes"></div>`;
}
function strumColours() {
  return `<p class="dim small" id="lfxStrumNone" hidden>No strum LEDs in the layout yet. Add them under <b>LED layout</b> below.</p>
    ${toggle('lfxPerLed', 'zoneStrum.perLed', 'Each strum LED its own colour', 'Pick a separate idle colour for every strum LED, or one colour for all of them.')}
    <div id="lfxStrumCols" class="lfx-colgrid" role="group" aria-label="Strum bar colours"></div>
    <div class="lfx-colgrid" role="group" aria-label="Strum pressed colours">
      <span class="lfx-lbl">Strum up colour</span>${picker('strumUpColor', 'Strum up colour')}
      <span class="lfx-lbl">Strum down colour</span>${picker('strumDownColor', 'Strum down colour')}</div>
    ${toggle('lfxStrumSame', 'zoneStrum.same', 'Pressed colour = idle colour', 'The LED keeps its idle colour when strummed. Turn off to use the up and down colours above.')}
    <p class="dim small">Which LEDs follow strum up, strum down or both is set under <b>LED layout</b> below.</p>`;
}

function buildHtml() {
  return `<div class="studio-head"><div><h2>Lighting studio</h2><p class="dim">Design how the LEDs idle, react to your playing and glow for star power and whammy. Everything is sent to the guitar as you change it; use <b>Save to guitar</b> to keep it.</p></div>
      <div class="studio-off" id="studioOff" hidden><span>LEDs are switched off.</span> <button type="button" class="btn small primary" id="studioOn">Turn LEDs on</button></div></div>
    <div class="lfx-top">
      <div class="lfx-box" id="lfxPreviewBox"><h3>Live preview</h3>
        <div class="lfx-stage" id="lfxStage"><p class="dim" id="lfxNoLeds" hidden>No LEDs in the layout. Choose fret and / or strum LEDs under LED layout.</p>
          <div class="lfx-frets" id="lfxFrets" role="group" aria-label="Fret LEDs. Press and hold to preview a fret."></div>
          <div class="lfx-strum" id="lfxStrum" role="group" aria-label="Strum bar LEDs"><div class="lfx-bar" id="lfxBar"></div>
            <div class="lfx-strumbtns"><button type="button" class="btn small lfx-hold" data-hold="up"><span aria-hidden="true">&#9650;</span> Strum up</button><button type="button" class="btn small lfx-hold" data-hold="down"><span aria-hidden="true">&#9660;</span> Strum down</button></div></div></div>
        <div class="lfx-ctl"><button type="button" class="btn small lfx-starbtn" id="lfxStarBtn" aria-pressed="false"><span aria-hidden="true">&#9733;</span> Preview star power</button>
          <div class="lfx-whammy"><label for="lfxWhammy">Whammy</label><input type="range" id="lfxWhammy" min="0" max="100" value="0"></div></div>
        <p class="dim small" id="lfxHint">Click, tap or hold the frets and strum buttons to try your settings without touching the guitar. It also follows the real guitar.</p></div>
      <div class="lfx-box" id="lfxThemeBox"><h3>Themes</h3><p class="dim small">One click sets every colour and effect. Fine-tune afterwards in the tabs below.</p>
        ${needHtml()}<div data-v7><div class="lfx-themes" id="lfxThemes"></div>
        <div class="row lfx-quick"><button type="button" class="btn small" id="lfxCopy">Copy fret settings to strum bar</button></div></div></div>
    </div>
    <div class="lfx-tabs" role="tablist" aria-label="Lighting zones">${[['frets', 'Frets'], ['strum', 'Strum bar'], ['star', 'Star power'], ['extras', 'Whammy & extras']].map(([id, t]) => `<button type="button" role="tab" id="lfxtab-${id}" data-tab="${id}" aria-controls="lfxp-${id}" aria-selected="false" tabindex="-1">${t}</button>`).join('')}</div>
    <div class="lfx-panel" role="tabpanel" id="lfxp-frets" aria-labelledby="lfxtab-frets" tabindex="0">${zonePanel('frets')}</div>
    <div class="lfx-panel" role="tabpanel" id="lfxp-strum" aria-labelledby="lfxtab-strum" tabindex="0">${zonePanel('strum')}</div>
    <div class="lfx-panel" role="tabpanel" id="lfxp-star" aria-labelledby="lfxtab-star" tabindex="0">
      ${toggle('rgbSp', 'rgbStarPower', 'Star power glow', 'The LEDs react when the game reports star power (XInput games). Turn off to ignore it.')}
      ${needHtml()}<div data-v7><section class="lfx-sec"><h3>Animation</h3>${cards('starAnim', STAR_ANIMS, 'Star power animation')}
        <div class="lfx-colgrid" role="group" aria-label="Star power colour"><span class="lfx-lbl">Colour</span>${picker('starColor', 'Star power colour')}</div>
        ${slider('lfx-star-speed', 'starSpeed', 'Speed', 1, 10, 'num')}</section>
        <section class="lfx-sec"><h3>Where</h3><p class="dim small">Which LEDs show star power (a held fret keeps its own colour).</p>${zoneChecks('starZones', 'Star power zones')}</section>
        ${toggle('lfxFlash', 'starFlash', 'Flash white when I activate star power', 'All LEDs flash white for a moment when you press star power or tilt.')}</div></div>
    <div class="lfx-panel" role="tabpanel" id="lfxp-extras" aria-labelledby="lfxtab-extras" tabindex="0">
      ${needHtml()}<div data-v7><section class="lfx-sec"><h3>Whammy bar effect</h3><p class="dim small">The LEDs change as you push the whammy bar (or tilt-whammy). Try the slider in the preview.</p>
        ${cards('whammyFx', WHAMMY_FX, 'Whammy effect')}
        <h4 class="lfx-sub">Where</h4>${zoneChecks('whammyZones', 'Whammy zones')}</section>
        ${toggle('lfxSleep', 'sleepMin', 'Turn LEDs off when idle', '', 'id="lfxSleepRow" data-adv')}</div>
      ${toggle('rgbFlash', 'rgbBootFlash', 'Show the mode at plug-in', 'The fret that picks the running mode flashes for a second.')}</div>
    <p class="adv-hint" id="lfxAdvHint" hidden></p>`;
}

// ------------------------------------------------------------------ DOM <-> config
function readControl(el) {
  const c = S.ctx.state.cfg, p = el.dataset.b;
  if (el.type === 'checkbox') {
    if (el.dataset.bit) return (getPath(c, p) & ~(+el.dataset.bit)) | (el.checked ? +el.dataset.bit : 0);
    return el.checked;
  }
  if (el.type === 'range') return +el.value;
  return el.value;
}
function writeControl(el) {
  const c = S.ctx.state.cfg, v = getPath(c, el.dataset.b);
  if (el.type === 'checkbox') el.checked = el.dataset.bit ? !!(v & +el.dataset.bit) : !!v;
  else if (el.type === 'range') { if (+el.value !== v) el.value = v; }
  else if (v !== undefined && el.value !== v) el.value = v;
}
const v7 = () => (S.ctx.state.cfg.cfgVersion ?? 0) >= 7;

function changed(structural = false) {
  S.ctx.changed();
  sync(structural);
}

function wire() {
  const root = S.root;
  $('#lfxStarBtn', root).addEventListener('click', () => { S.star = !S.star; if (S.star) S.manual.starPressed = true; sync(); });
  // the page rebuilds the studio's HTML inside the same root (reconnect, undo): delegate once, not per rebuild
  if (root._lfxWired) return;
  root._lfxWired = true;
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset?.b && (el.type === 'range' || el.type === 'color')) {
      if (!v7() && !['rgbStarPower', 'rgbBootFlash'].includes(el.dataset.b)) return;
      setPath(S.ctx.state.cfg, el.dataset.b, readControl(el)); changed();
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.b && el.type === 'checkbox') {
      if (!v7() && !['rgbStarPower', 'rgbBootFlash'].includes(el.dataset.b)) return;
      setPath(S.ctx.state.cfg, el.dataset.b, readControl(el)); changed(true);
    }
  });
  root.addEventListener('click', (e) => {
    const card = e.target.closest('.lfx-card');
    if (card && v7()) { setPath(S.ctx.state.cfg, card.parentElement.dataset.cards, +card.dataset.id); changed(true); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab, true); return; }
    const th = e.target.closest('[data-theme]');
    if (th && v7()) { applyTheme(S.ctx.state.cfg, THEMES[+th.dataset.theme]); changed(true); S.ctx.toast?.(`Theme: ${THEMES[+th.dataset.theme].name}`, 'ok'); return; }
    const pal = e.target.closest('[data-palette]');
    if (pal && v7()) { const c = S.ctx.state.cfg; c.colors = RGB_PRESETS[+pal.dataset.palette].colors.slice(); c.fret2Colors = c.colors.slice(); if (c.zoneFrets.same) c.fretPress = c.colors.slice(); changed(true); return; }
    if (e.target.closest('#lfxCopy') && v7()) { copyFretsToStrum(S.ctx.state.cfg); changed(true); S.ctx.toast?.('Copied the fret settings to the strum bar', 'ok'); return; }
    if (e.target.closest('#lfxPressWhite') && v7()) { const c = S.ctx.state.cfg; c.fretPress = Array(5).fill('#ffffff'); c.zoneFrets.same = false; changed(true); return; }
    if (e.target.closest('#lfxPressBright') && v7()) { const c = S.ctx.state.cfg; c.fretPress = c.colors.map(brighter); c.zoneFrets.same = false; changed(true); return; }
    if (e.target.closest('#studioOn')) S.ctx.turnOn();
  });
  // radio groups and tabs: arrow keys move
  root.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const card = e.target.closest('.lfx-card'), tab = e.target.closest('[data-tab]');
    if ((card || tab) && keys[e.key]) {
      const list = card ? $$('.lfx-card', card.parentElement) : $$('[data-tab]', root), i = list.indexOf(card || tab), nx = list[(i + keys[e.key] + list.length) % list.length];
      e.preventDefault(); nx.focus(); if (card && v7()) nx.click(); else if (tab) nx.click();
    }
  });
  // the preview's hold buttons: pointer or keyboard, held while pressed
  const hold = (key, on) => { const now = performance.now(); S.manual.down[key] = on; if (on) S.manual.until[key] = now + 170; };
  const holdTarget = (e) => e.target.closest('[data-hold]')?.dataset.hold;
  root.addEventListener('pointerdown', (e) => { const k = holdTarget(e); if (k) { hold(k, true); try { e.target.closest('[data-hold]').setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } } });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) root.addEventListener(t, (e) => { const k = holdTarget(e); if (k) hold(k, false); });
  root.addEventListener('keydown', (e) => { const k = holdTarget(e); if (k && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) hold(k, true); } });
  root.addEventListener('keyup', (e) => { const k = holdTarget(e); if (k && (e.key === ' ' || e.key === 'Enter')) hold(k, false); });
  root.addEventListener('blur', (e) => { const k = holdTarget(e); if (k) hold(k, false); }, true);
  $('#lfxWhammy', root).addEventListener('input', (e) => { S.manual.whammy = +e.target.value / 100; S.manual.wAt = performance.now(); });
}

function setTab(id, focus = false) {
  S.tab = id;
  $$('[data-tab]', S.root).forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  $$('.lfx-panel', S.root).forEach((p) => { p.hidden = p.id !== 'lfxp-' + id; });
}

// ------------------------------------------------------------------ sync config -> controls
function paintCards(root, c) {
  $$('[data-cards]', root).forEach((g) => {
    const cur = getPath(c, g.dataset.cards);
    $$('.lfx-card', g).forEach((b) => { const on = +b.dataset.id === cur; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; b.classList.toggle('sel', on); });
  });
}
const rowsKey = (c) => JSON.stringify([c.fretLeds, c.noFretLeds, c.strumLeds, c.strumRoles, c.zoneStrum?.perLed]);
function renderRows(c) {
  const key = rowsKey(c);
  if (S.rowsKey === key) return;
  S.rowsKey = key;
  const l = ledLayout(c), two = l.frets && l.per === 2;
  $('#lfxFretCols', S.root).style.setProperty('--cols', two ? 3 : 2);
  $('#lfxFretCols', S.root).innerHTML = `<span class="lfx-lbl head"></span><span class="lfx-hd">Idle</span><span class="lfx-hd" data-pcol>Pressed</span>${two ? '<span class="lfx-hd" data-c2>2nd LED</span>' : ''}` +
    [0, 1, 2, 3, 4].map((f) => `<span class="lfx-lbl"><span class="fretdot" style="background:${FRET_DEFAULT_COLORS[f]}"></span>${FRET_NAMES[f]}</span>${picker(`colors.${f}`, `${FRET_NAMES[f]} idle colour`)}${picker(`fretPress.${f}`, `${FRET_NAMES[f]} pressed colour`, 'data-pcol')}${two ? picker(`fret2Colors.${f}`, `${FRET_NAMES[f]} second LED colour`, 'data-c2') : ''}`).join('');
  const n = l.strum, per = !!c.zoneStrum?.perLed;
  $('#lfxStrumCols', S.root).style.setProperty('--cols', 1);
  $('#lfxStrumCols', S.root).innerHTML = !n ? '' : per
    ? [...Array(n).keys()].map((k) => `<span class="lfx-lbl">Strum LED ${k + 1} <span class="dim">(${ROLE_TXT[c.strumRoles[k] || 0]})</span></span>${picker(`strumLedColors.${k}`, `Strum LED ${k + 1} idle colour`)}`).join('')
    : `<span class="lfx-lbl">Idle colour</span>${picker('strumColor', 'Strum bar idle colour')}`;
  $('#lfxStrumNone', S.root).hidden = !!n;
  S.dirtyRows = true;
}
function sync(structural = false) {
  if (!S) return;
  const c = S.ctx.state.cfg, root = S.root, ok = v7(), l = ledLayout(c);
  S.engine.setConfig(c);
  renderRows(c);
  $$('[data-b]', root).forEach(writeControl);
  $$('[data-out]', root).forEach((o) => { o.textContent = FMT[o.dataset.fmt || 'num'](getPath(c, o.dataset.out)); });
  paintCards(root, c);
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
  $$('[data-pcol]', root).forEach((e) => { e.disabled = !!c.zoneFrets.same; e.classList.toggle('dim-col', !!c.zoneFrets.same); });
  $$('[data-c2]', root).forEach((e) => { e.disabled = !c.fret2Own; e.classList.toggle('dim-col', !c.fret2Own); });
  $('#lfxFret2Row', root).hidden = !(l.frets && l.per === 2);
  $('#lfxFret2Row', root).classList.toggle('adv-keep', !!c.fret2Own);
  const sleepRow = $('#lfxSleepRow', root);
  sleepRow.hidden = false; sleepRow.classList.toggle('adv-keep', !!c.sleepMin);
  if (!sleepRow.dataset.built) {
    sleepRow.dataset.built = 1;
    sleepRow.innerHTML = `<div><h3 id="lfxSleepT">Turn LEDs off when idle</h3><p class="dim">The LEDs fade out after this many minutes without any button or whammy input, and wake on the next press. 0 keeps them on.</p></div>
      <div class="lfx-sleep"><output class="val" data-out="sleepMin" data-fmt="min"></output><input type="range" id="lfxSleepIn" data-b="sleepMin" min="0" max="30" step="1" aria-labelledby="lfxSleepT"></div>`;
    sync(); return;
  }
  $('#lfxStrumSame', root).disabled = !(l.strum);
  $$('#lfxStrumCols input, #lfxPerLed, #lfxStrumSame', root).forEach((e) => { if (!l.strum) e.disabled = true; });
  $$('[data-b="strumUpColor"], [data-b="strumDownColor"]', root).forEach((e) => { e.disabled = !!c.zoneStrum.same || !l.strum; });
  // preview: layout, off notice, star button
  $('#studioOff', root).hidden = !!c.rgbEnabled;
  $('#lfxStarBtn', root).setAttribute('aria-pressed', S.star);
  $('#lfxStarBtn', root).classList.toggle('on', S.star);
  const sig = JSON.stringify([l.frets, l.per, l.strum]);
  if (S.stageSig !== sig) { S.stageSig = sig; drawStage(l); }
  $('#lfxNoLeds', root).hidden = !!l.chain;
  S.dirtyRows = false;
  paintThemes(c); retintSwatches(c);
  S.ctx.advRefresh?.();
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
    star: S.star, starPressed, whammy: Math.max(m.whammy, real_w),
  };
}

// ---- tiny animated swatches on the option cards
function swatchCfg(kind, id, c) {
  const pal = swatchPalette(kind, c), hot = pal.map(brighter);
  const base = { cfgVersion: 7, colors: pal, fretPress: hot, fret2Colors: pal, fret2Own: false, strumLeds: 0, fretLeds: 1, strumLedColors: [], strumRoles: [], rgbStarPower: true, strumColor: '#ffffff',
    starColor: c.starColor, starAnim: 0, starZones: 3, starSpeed: c.starSpeed, whammyFx: 0, whammyZones: 3, starFlash: false, sleepMin: 0, strumUpColor: '#00c8ff', strumDownColor: '#ff3cc8' };
  const zk = kind.split('.')[0], zone = c[zk] || c.zoneFrets;
  if (kind.endsWith('.idle')) base.zoneFrets = { idle: id, idleLevel: 100, press: 0, speed: zone.speed, fade: 5, same: true, perLed: false };
  else if (kind.endsWith('.press')) base.zoneFrets = { idle: IDLE.SOLID, idleLevel: 28, press: id, speed: zone.speed, fade: zone.fade, same: false, perLed: false };
  else base.zoneFrets = { idle: IDLE.SOLID, idleLevel: 30, press: 0, speed: 5, fade: 5, same: true, perLed: false };
  if (kind === 'starAnim') base.starAnim = id;
  if (kind === 'whammyFx') base.whammyFx = id;
  base.zoneStrum = base.zoneFrets;
  return base;
}
function swatchPalette(kind, c) {
  if (kind === 'starAnim') return Array(5).fill(c.starColor);
  if (kind.startsWith('zoneStrum')) { const n = Math.max(1, c.strumLeds || 1); return [0, 1, 2, 3, 4].map((k) => (c.zoneStrum.perLed ? c.strumLedColors[k % n] : c.strumColor) || '#ffffff'); }
  return c.colors;
}
function buildSwatches() {
  S.sw = $$('[data-sw]', S.root).map((el) => {
    const [kind, id] = el.dataset.sw.split(':');
    return { el, kind, id: +id, dots: $$('i', el), engine: null, tab: el.closest('.lfx-panel').id.replace('lfxp-', '') };
  });
  retintSwatches(S.ctx.state.cfg, true);
}
function retintSwatches(c, force = false) {
  if (!S?.sw) return;
  const sig = JSON.stringify([c.colors, c.strumColor, c.strumLedColors, c.zoneStrum.perLed, c.starColor, c.zoneFrets.speed, c.zoneFrets.fade, c.zoneStrum.speed, c.zoneStrum.fade, c.starSpeed, c.strumLeds]);
  if (!force && S.swSig === sig) return;
  S.swSig = sig;
  for (const w of S.sw) { w.cfg = swatchCfg(w.kind, w.id, c); if (w.engine) w.engine.setConfig(w.cfg); else w.engine = createEngine(w.cfg); }
}
function tickSwatches(now) {
  for (const w of S.sw || []) {
    if (w.tab !== S.tab || !w.engine) continue;
    const ph = now % 1500, step = Math.floor(now / 1500) % 5;
    const inp = { frets: [0, 1, 2, 3, 4].map((f) => f === step && ph < 650), whammy: w.kind === 'whammyFx' ? 0.5 - 0.5 * Math.cos(now / 700) : 0, star: w.kind === 'starAnim', up: false, down: false };
    const f = w.engine.tick(now, inp);
    for (let k = 0; k < 5; k++) { const px = f.fret[k]; w.dots[k].style.background = `rgb(${gamma(px[0]) | 0},${gamma(px[1]) | 0},${gamma(px[2]) | 0})`; }
  }
}

function frameLoop(now) {
  if (!S || !S.root.isConnected || S.ctx.state.view !== 'lights') { if (S) S.raf = 0; return; }
  S.raf = requestAnimationFrame(frameLoop);
  const c = S.ctx.state.cfg;
  S.engine.setConfig(c);
  const f = S.engine.tick(now, liveInput(now));
  const l = ledLayout(c);
  if (l.frets) for (let k = 0; k < 5; k++) { paintLed(S.fretEls[k][0], f.fret[k]); if (S.fretEls[k][1]) paintLed(S.fretEls[k][1], f.fret2[k]); }
  for (let k = 0; k < S.strumEls.length; k++) if (f.strum[k]) paintLed(S.strumEls[k], f.strum[k]);
  $$('.lfx-fret, .lfx-hold', S.root).forEach((b) => { const k = b.dataset.hold, on = !!S.manual.down[k] || now < (S.manual.until[k] || 0); if (b._on !== on) { b._on = on; b.classList.toggle('held', on); } });
  tickSwatches(now);
  S.frame = f;
}

// ------------------------------------------------------------------ public
export function buildStudio(ctx) {
  const root = $('#studio');
  if (!root) return;
  if (S?.raf) cancelAnimationFrame(S.raf);
  const keepTab = S?.tab || 'frets', keepStar = S?.star || false;
  S = { ctx, root, engine: createEngine(ctx.state.cfg), manual: { down: {}, until: {}, whammy: 0, starPressed: false }, star: keepStar, tab: keepTab, raf: 0, sw: null, rowsKey: null, stageSig: null, fretEls: [], strumEls: [] };
  root.innerHTML = buildHtml();
  wire();
  buildSwatches();
  setTab(keepTab);
  sync();
  S.raf = requestAnimationFrame(frameLoop);
  // test hook: the latest rendered frame
  window.__lfx = { frame: () => S?.frame, engine: () => S?.engine, star: (on) => { S.star = on; sync(); } };
}
export function syncStudio() { if (S) { sync(); if (!S.raf && S.ctx.state.view === 'lights') S.raf = requestAnimationFrame(frameLoop); } }
export function studioAdvNames() {
  if (!S) return [];
  const c = S.ctx.state.cfg, l = ledLayout(c);
  return [!c.sleepMin && 'LED sleep timer', l.frets && l.per === 2 && !c.fret2Own && 'second LED colours'].filter(Boolean);
}
