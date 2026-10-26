import {
  FUNCS, FUNC_LABEL, PIN_NONE, NUM_DIGITAL_PINS, NUM_FRETS, MODES, MODE_NONE, BOARDS, modeName,
  DEBOUNCE_MODES, defaultConfig, whammyValue, isPressed, EFFECTS, RGB_PRESETS, FRET_DEFAULT_COLORS, NUM_LEDS, MAX_STRUM_LEDS, STRUM_ROLES, ledLayout, applyLedLayout, maxBrightness, effectZone,
  LED_TYPES, LED_ORDERS, KEY_SLOTS, KEYS, KEY_PRESETS,
  ATILT_SOURCES, ACCEL2_MIN_MINOR, ACCEL_TYPES, i2cPinsOk, tiltSourceRaw, tiltValue,
} from './protocol.js?v=dev';
import { YaccDevice, webusbSupported } from './usb.js?v=dev';
import { PinDetector, WhammyCalibrator } from './detect.js?v=dev';
import { createGuitar } from './guitar.js?v=dev';
import { renderHardware, renderCompat } from './pages.js?v=dev';
import { buildStudio, syncStudio } from './studio.js?v=dev';
import { SECTIONS, makeBackup, backupFileName, readBackup, applyBackup, download } from './backup.js?v=dev';

const $ = (s, r = document) => r.querySelector(s);
const diff8 = (x, y) => (x - y + 256) & 0xff;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRET_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#fb923c'];
const MODE_USE = {   // one line per mode: where you'd use it
  10: 'Any console or computer: finds out which and switches itself',
  11: 'PS5 games (needs a P5General dongle on the host port)',
  0: 'Windows, Xbox 360, Clone Hero, YARG (not macOS)', 3: 'Rock Band on PS3, RPCS3, Rock Band 4 on PS4 / PS5', 1: 'Guitar Hero on PS3, PS2, RPCS3',
  2: 'macOS, Linux, Android, emulators', 4: 'Fortnite Festival on PlayStation, Xbox, PC', 5: 'Nintendo Switch, Fortnite Festival',
  6: 'Rock Band on Wii and Wii U', 7: 'Original Xbox (needs an adapter cable)',
  8: 'Rock Band 4 on PS4 / PS5 (needs a controller on the host port)', 9: 'Rock Band 4 on Xbox One / Series (needs a controller on the host port)',
};

// macOS has no driver for Xbox 360 (XInput) controllers, so nothing on a Mac sees XInput mode
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') && !/iphone|ipad/i.test(navigator.userAgent);
// modes this firmware has (Auto needs 0.30)
const fwAtLeast = (n) => !!state.info && (state.info.major > 0 || state.info.minor >= n);
// the digital tilt switch: normally open (pressed = pin low) or, with firmware 0.33+, normally closed (pressed = pin high)
const tiltInverted = () => !!state.cfg?.tiltInvert && fwAtLeast(33);
const tiltSwitchActive = (s, c = state.cfg) => !!c && c.tiltEnabled && c.tiltPin !== PIN_NONE && isPressed(s, c.tiltPin) !== tiltInverted();
const availableModes = () => MODES.filter((m) => !m.min || (state.info && (state.info.major > 0 || state.info.minor >= m.min)));
// HOST_* in firmware auto_detect.h
const AUTO_HOSTS = ['', 'Windows', 'Xbox 360', 'Xbox One', 'PS3', 'PS4 / PS5', 'Switch', 'Wii', 'PS2', 'OG Xbox'];
const MAC_XINPUT_TIP = 'macOS has no driver for Xbox 360 controllers. In <b>XInput</b> mode the guitar notices this and switches itself to the <b>HID gamepad</b> a few seconds after plugging in, so Clone Hero and YARG still see it (firmware 0.28 or newer).';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = { dev: null, info: null, cfg: null, status: null, step: 0, view: 'flash', connecting: false };

// ------------------------------------------------------------------ helpers
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function showView(v) {
  state.view = v;
  scrollTo(0, 0);
  document.querySelectorAll('.view').forEach((e) => e.classList.toggle('active', e.id === 'view-' + v));
  document.querySelectorAll('#nav [data-view]').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#helpBtn').classList.toggle('active', v === 'hardware' || v === 'compat');
  closeHelp();
  updateBar();
  if (v !== 'setup' && v !== 'lights') { stopLedTest(); if (stepCtx.timer) { clearInterval(stepCtx.timer); stepCtx.timer = 0; state.dev?.ledTest(-1).catch(() => {}); } }
  if (v === 'setup') renderStep();
  if (state.dev && state.cfg) {           // pick up anything changed on other pages
    if (v === 'tune') buildTune();
    if (v === 'lights') buildLights();
    if (v === 'modes') buildModes();
    advRefresh();
  }
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view); });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-view-go]'); if (b) showView(b.dataset.viewGo); });

// Help menu: Wiring & hardware, Compatibility
function closeHelp(focus = false) {
  const m = $('#helpMenu'), b = $('#helpBtn');
  if (!m || m.hidden) return;
  m.hidden = true; b.setAttribute('aria-expanded', 'false');
  if (focus) b.focus();
}
function openHelp(focusFirst = false) {
  $('#helpMenu').hidden = false; $('#helpBtn').setAttribute('aria-expanded', 'true');
  if (focusFirst) $('#helpMenu [role=menuitem]').focus();
}
$('#helpBtn').addEventListener('click', () => { if ($('#helpMenu').hidden) openHelp(); else closeHelp(); });
$('#helpBtn').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openHelp(true); } });
$('#helpMenu').addEventListener('keydown', (e) => {
  const items = [...document.querySelectorAll('#helpMenu [role=menuitem]')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Tab') closeHelp();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.nav-help')) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#helpMenu').hidden) { e.stopPropagation(); closeHelp(true); } }, true);

const funcName = (i) => FUNC_LABEL[FUNCS[i]];
const hostPins = (c = state.cfg) => (c.hostPin !== undefined && c.hostPin !== PIN_NONE ? [c.hostPin, c.hostPin + 1] : []);
const portPins = (c = state.cfg) => [...(c.ps2Pins || []), c.wiiSda ?? PIN_NONE, c.wiiScl ?? PIN_NONE].filter((p) => p !== PIN_NONE);
const accelPins = (c = state.cfg) => (c.accelSda !== undefined && c.accelSda !== PIN_NONE ? [c.accelSda, c.accelScl] : []);
const assignedPins = () => [...state.cfg.pins, state.cfg.tiltPin, ...hostPins(), ...accelPins(), state.cfg.rumblePin ?? PIN_NONE, ...portPins()].filter((p) => p !== PIN_NONE);
const isConfigured = (cfg) => cfg.pins.some((p) => p !== PIN_NONE);

let pushTimer = 0;
function pushCfg() {
  checkDirty();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await state.dev?.setConfig(state.cfg); } catch (e) { toast('Could not send settings: ' + e.message, 'bad'); }
  }, 80);
}

// ------------------------------------------------------------------ unsaved changes (one shared bar)
// state.cfg is pushed to the guitar live; `saved` is the last config known to be in its flash.
let saved = null, savedJson = '', dirty = false, saving = false;
const MODE_KEYS = ['usbMode', 'bootModes', 'keys', 'xinputType', 'starDpadLeft', 'xinputOpts', 'hostPin', 'ps2Pins', 'wiiSda', 'wiiScl'];
const modesChanged = () => !!saved && MODE_KEYS.some((k) => JSON.stringify(state.cfg[k]) !== JSON.stringify(saved[k]));
function takeSnapshot() {
  saved = state.cfg ? structuredClone(state.cfg) : null;
  savedJson = JSON.stringify(saved);
  dirty = false; updateBar();
}
function checkDirty() {
  dirty = !!(state.dev && state.cfg && saved) && JSON.stringify(state.cfg) !== savedJson;
  updateBar();
}
function updateBar() {
  const bar = $('#saveBar');
  if (!bar) return;
  const show = dirty && !!state.dev;
  bar.hidden = !show;
  document.body.classList.toggle('has-savebar', show);
  if (!show) return;
  const restart = state.view === 'modes' && modesChanged();
  $('#sbText').textContent = saving ? 'Saving…' : restart ? 'You have unsaved changes on the guitar. Saving restarts it to apply the new modes.' : 'You have unsaved changes on the guitar';
  $('#sbSave').textContent = restart ? 'Save and restart' : 'Save to guitar';
  $('#sbSave').disabled = $('#sbUndo').disabled = saving;
}
async function saveToController() {
  if (saving || !state.dev) return;
  saving = true; updateBar();
  const b = $('#bSave'); if (b) b.disabled = true;
  try {
    const restart = modesChanged();
    await state.dev.setConfig(state.cfg);
    await state.dev.save();
    await sleep(400);
    const s = await state.dev.getStatus();
    if (!s.saveOk) throw new Error('flash write failed');
    takeSnapshot();
    if (restart && state.view === 'modes') {
      toast('Saved. Restarting the controller.', 'ok');
      await state.dev.reboot(false);
    } else toast(restart ? 'Saved. Mode changes apply when you unplug and replug the guitar.' : 'Saved to the guitar', 'ok');
  } catch (e) {
    toast('Save failed: ' + e.message, 'bad');
  } finally { saving = false; updateBar(); const b2 = $('#bSave'); if (b2) b2.disabled = false; }
}
async function undoChanges() {
  if (saving || !saved || !state.dev) return;
  clearTimeout(pushTimer);
  bpClose(false); stopLedTest();
  state.cfg = structuredClone(saved);
  try { await state.dev.setConfig(state.cfg); } catch (e) { toast('Could not send settings: ' + e.message, 'bad'); }
  buildUi();
  checkDirty();
  toast('Changes undone', 'ok');
}
$('#sbSave').onclick = saveToController;
$('#sbUndo').onclick = undoChanges;
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
// pages that don't push live (Modes) still change state.cfg: re-check after any edit
document.querySelector('main').addEventListener('input', () => setTimeout(checkDirty, 0));
document.querySelector('main').addEventListener('change', () => setTimeout(checkDirty, 0));
document.querySelector('main').addEventListener('click', () => setTimeout(checkDirty, 0));

// ------------------------------------------------------------------ advanced settings (expert options hidden by default)
// Anything set to a non-default value stays visible (class adv-keep) so no active setting is ever hidden.
const advOn = () => document.body.classList.contains('show-adv');
function setAdv(on, persist = true) {
  document.body.classList.toggle('show-adv', on);
  $('#advSw').checked = on;
  if (persist) store.set('yacc.adv', on ? '1' : '0');
  advRefresh();
}
function advRefresh() {
  const c = state.cfg;
  if (!c) return;
  const keep = (sel, k) => { $(sel)?.classList.toggle('adv-keep', !!k); return !!k; };
  const hint = (sel, hidden, names) => {
    const el = $(sel); if (!el) return;
    el.hidden = hidden || !names.length;
    el.innerHTML = `More options (${names.join(', ')}). <button type="button" class="linklike" data-adv-on>Turn on Advanced</button>`;
  };
  const set = (v) => v !== undefined && v !== PIN_NONE;
  const tilt = keep('#tiltPanel', set(c.accelSda) || (c.atilt || []).some((t) => t.src !== PIN_NONE));
  const rumble = keep('#rumblePanel', set(c.rumblePin));
  hint('#tuneAdvHint', advOn(), [!tilt && 'tilt sensors', !rumble && 'rumble'].filter(Boolean));
  const rx = keep('#rxRow', c.xinputOpts & 4);
  const ports = keep('#portsPanel', (c.ps2Pins || []).some((p) => p !== PIN_NONE) || set(c.wiiSda) || (c.xinputOpts & 2));
  const needsHost = MODES.find((m) => m.id === c.usbMode)?.host || (c.bootModes || []).some((id) => MODES.find((m) => m.id === id)?.host);
  const host = keep('#hostPanel', set(c.hostPin) || needsHost);
  hint('#modesAdvHint', advOn(), [!rx && 'Steam receiver option', !ports && 'PS2 / Wii ports', !host && 'USB host port'].filter(Boolean));
  const order = keep('#ledOrderRow', c.ledType === 2 || c.ledOrder !== 0);
  hint('#ledAdvHint', advOn() || order || c.ledType === 1 || !c.rgbEnabled, ['colour order']);
}
$('#advSw').addEventListener('change', (e) => {
  setAdv(e.target.checked);
  if (state.dev && state.cfg && state.view === 'lights') buildLights();   // refreshes the troubleshooting advice
  if (state.dev && state.cfg && state.view === 'setup' && STEPS[state.step].kind === 'bluetooth') renderStep();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-adv-on]');
  if (!b) return;
  setAdv(true);
  if (state.dev && state.cfg && state.view === 'lights') buildLights();
  toast('Advanced settings are on', 'ok');
});
setAdv(store.get('yacc.adv') === '1', false);

// the sticky setup guitar sits right under the (sticky) header, whose height changes when it wraps on phones
{
  const hdr = document.querySelector('header.top');
  if (hdr) new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', hdr.offsetHeight + 'px')).observe(hdr);
}
// the fixed unsaved-changes bar: Setup (desktop) reserves exactly its height so nothing hides behind it
{
  const ub = document.getElementById('saveBar');
  if (ub) new ResizeObserver(() => document.documentElement.style.setProperty('--ubh', (ub.hidden ? 0 : ub.offsetHeight) + 'px')).observe(ub);
}

// ------------------------------------------------------------------ live guitar viewers
const viewers = [];
function makeViewer(container, withPins = false, compact = false, onPart = null) {
  const g = createGuitar({ compact, onPart });
  container.appendChild(g.el);
  let pinsEl = null;
  if (withPins) {
    pinsEl = document.createElement('div');
    pinsEl.className = 'pins';
    for (let p = 0; p < NUM_DIGITAL_PINS; p++) { const d = document.createElement('div'); d.textContent = 'GP' + p; pinsEl.appendChild(d); }
    container.appendChild(pinsEl);
  }
  const v = { g, pinsEl, container };
  viewers.push(v);
  return v;
}

function updateViewer(v, s) {
  const cfg = state.cfg;
  if (!cfg || !s) return;
  FUNCS.forEach((name, i) => {
    v.g.setMapped(name, cfg.pins[i] !== PIN_NONE);
    v.g.setPressed(name, isPressed(s, cfg.pins[i]));
  });
  // tilt sensors add to the whammy (the larger wins) or press tilt, as in the firmware
  const ts = tiltStates(s);
  v.g.setWhammy(Math.max(cfg.whammyCh !== PIN_NONE ? whammyValue(s.adc[cfg.whammyCh], cfg) : 0, ...ts.map((t) => (t.whammy ? t.value : 0))));
  v.g.setTilt(tiltSwitchActive(s, cfg) || ts.some((t) => t.star));
  if (v.pinsEl) {
    const used = new Set(assignedPins());
    [...v.pinsEl.children].forEach((d, p) => {
      d.classList.toggle('low', isPressed(s, p));
      d.classList.toggle('used', used.has(p));
    });
  }
}

// ------------------------------------------------------------------ firmware updates
// web/firmware.json holds the version the site ships (CI writes it from firmware/CMakeLists.txt)
const BOARD_KEYS = { 0: 'pico', 1: 'pico_w', 2: 'pico2', 3: 'pico2_w', 4: 'pico_clone', 5: 'waveshare_rp2040_zero',
  6: 'waveshare_rp2040_one', 7: 'sparkfun_promicro', 8: 'adafruit_kb2040' };
let latestFw = null;
const fwLatest = () => (latestFw ||= fetch('firmware.json?v=dev', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
const fwOlder = (i, l) => i.major < l.major || (i.major === l.major && i.minor < l.minor);

async function checkFirmware() {
  const banner = $('#fwBanner');
  const info = state.info;
  const latest = await fwLatest();
  state.fwOutdated = !!(info && latest && fwOlder(info, latest));
  updatePill();
  if (!state.fwOutdated || store.get('yacc.fwSkip') === `${latest.major}.${latest.minor}`) { banner.hidden = true; return; }
  banner.innerHTML = `<div class="fw-inner"><span><b>Firmware update available.</b> Your guitar runs v${info.major}.${info.minor}; v${latest.major}.${latest.minor} is out with fixes and new features.</span>
    <span class="row"><button class="btn primary small" id="fwGo">Update</button><button class="btn small" id="fwLater">Not now</button></span></div>`;
  banner.hidden = false;
  $('#fwGo').onclick = () => goUpdate();
  $('#fwLater').onclick = () => { store.set('yacc.fwSkip', `${latest.major}.${latest.minor}`); banner.hidden = true; };
}

// ------------------------------------------------------------------ configurator updates
// GitHub Pages lets browsers keep the page for up to 10 minutes after a deploy. Each deploy writes version.json
// (and stamps this page's build into the yagcc-build meta tag), so a page older than the live one offers a reload.
const SITE_BUILD = document.querySelector('meta[name="yagcc-build"]')?.content || '';
async function checkSite() {
  if (!SITE_BUILD || SITE_BUILD.endsWith('=dev')) return;   // local copy
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const v = r.ok ? await r.json() : null;
    if (!v?.build || v.build === SITE_BUILD) return;
    const b = $('#siteBanner');
    b.innerHTML = `<div class="fw-inner"><span><b>The configurator was updated.</b> Reload the page to get the newest version.</span>
      <span class="row"><button class="btn primary small" id="siteReload">Reload</button></span></div>`;
    b.hidden = false;
    $('#siteReload').onclick = () => location.reload();
  } catch { /* offline */ }
}
checkSite();
setInterval(checkSite, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSite(); });

function goUpdate() {
  const key = BOARD_KEYS[state.info?.board];
  const sel = $('#boardSel');
  if (key && sel) { sel.value = key; sel.dispatchEvent(new Event('change')); }
  showView('flash');
  setTimeout(() => $('#install')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

// ------------------------------------------------------------------ connection
function updatePill() {
  const pill = $('#connPill');
  if (state.dev && state.info) {
    pill.classList.add('on');
    const m = MODES.find((x) => x.id === state.info.mode);
    $('#connText').innerHTML = `<span class="seg-item">${BOARDS[state.info.board] ?? 'Board'}</span><span class="seg-item">${state.info.setupSession ? 'Setup' : state.info.xinputFallback ? 'XInput → HID' : state.info.autoHost ? `Auto: ${AUTO_HOSTS[state.info.autoHost] || '?'} → ${m ? m.short : '?'}` : m ? m.short : '?'}</span><span class="seg-item mono${state.fwOutdated ? ' old' : ''}" title="${state.fwOutdated ? 'A newer firmware is available' : 'Firmware version'}">v${state.info.major}.${state.info.minor}</span>`;
  } else {
    pill.classList.remove('on');
    $('#connText').textContent = state.connecting ? 'Connecting…' : 'Not connected';
  }
  const on = !!state.dev;
  document.querySelectorAll('#nav [data-needs-dev]').forEach((b) => {
    b.classList.toggle('nav-off', !on);
    if (on) b.removeAttribute('title'); else b.title = 'Connect a controller first';
  });
  $('#heroConnect').hidden = on;
  $('#heroNext').hidden = !on;
  if (on && state.cfg) {
    const done = isConfigured(state.cfg);
    $('#heroNextTitle').textContent = 'Your guitar is connected';
    $('#heroNextText').textContent = done ? 'Already set up. Next: review it, or press buttons to try them.' : 'Next: set up the buttons. It takes about a minute.';
    $('#heroNextBtn').textContent = done ? 'Review the setup \u2192' : 'Set up the buttons \u2192';
  }
  $('#setupGate').style.display = on ? 'none' : '';
  $('#setupMain').style.display = on ? '' : 'none';
  $('#tuneGate').style.display = on ? 'none' : '';
  $('#tuneMain').style.display = on ? '' : 'none';
  $('#lightsGate').style.display = on ? 'none' : '';
  $('#lightsMain').style.display = on ? '' : 'none';
  $('#modesGate').style.display = on ? 'none' : '';
  $('#modesMain').style.display = on ? '' : 'none';
}

async function connect(device, { navigate = false } = {}) {
  if (state.connecting || state.dev) return;
  state.connecting = true; updatePill();
  try {
    let lastErr;
    for (let i = 0; i < 4; i++) {
      try { state.info = await device.open(); lastErr = null; break; } catch (e) { lastErr = e; await sleep(400); try { await device.close(); } catch { /* */ } }
    }
    if (lastErr) throw lastErr;
    state.cfg = await device.getConfig();
    state.dev = device;
    state.step = isConfigured(state.cfg) ? STEPS.length - 1 : 0;
    device.addEventListener('status', (e) => onStatus(e.detail));
    device.addEventListener('lost', onLost);
    device.startPolling();
    buildUi();
    takeSnapshot();
    updatePill();
    toast('Controller connected', 'ok');
    if (state.info.xinputFallback)
      toast('This computer has no XInput driver, so the guitar is running as a HID gamepad. Games see it as usual.', 'ok');
    checkFirmware();
    if (navigate) showView('setup');
  } catch (e) {
    state.dev = null;
    toast('Could not open the controller: ' + e.message + (navigator.userAgent.includes('Windows') ? '. On Windows the WinUSB driver may still be installing: unplug, plug back in and try again.' : ''), 'bad');
  } finally {
    state.connecting = false; updatePill();
  }
}

function onLost() {
  state.dev = null; state.info = null; state.fwOutdated = false;
  saved = null; dirty = false; saving = false; updateBar();
  $('#fwBanner').hidden = true;
  setTimeout(scanHid, 1500);
  updatePill();
  toast('Controller disconnected');
}

async function pickAndConnect() {
  try {
    const d = await YaccDevice.pick();
    await connect(d, { navigate: true });
  } catch (e) {
    if (e.name !== 'NotFoundError') toast('Connection failed: ' + e.message, 'bad');
  }
}

async function autoConnect(navigate) {
  if (!webusbSupported() || state.dev || state.connecting) return;
  const list = await YaccDevice.authorised();
  if (list.length) await connect(list[0], { navigate });
}

// ------------------------------------------------------------------ status stream
function onStatus(s) {
  state.status = s;
  if (state.view === 'lights') updateLedPreview(s);
  if (state.view === 'tune') { updateTilt(s); updateTiltSwitch(s); }
  if (state.view === 'modes') updatePorts(s);
  for (const v of viewers) if (v.container.offsetParent !== null) updateViewer(v, s);
  tickStep(s);
}

// ------------------------------------------------------------------ guided setup
const STEPS = [
  { kind: 'buttons', group: 'Controls', title: 'Buttons', prompt: 'Click Set next to a button (or click it on the guitar), then press that button on your guitar. Or map them all in order.', focus: [] },
  { kind: 'whammy', title: 'Whammy bar', prompt: 'Move the whammy bar all the way down and back up, twice.', focus: ['whammy'] },
  { kind: 'rgb', group: 'Lights', title: 'RGB lighting', prompt: 'A few quick questions about your LEDs, then a test.', focus: [] },
  { kind: 'ledmap', title: 'LED order', prompt: 'Teach YAGCC which LED sits under which fret or on the strum bar.', focus: [] },
  { kind: 'bluetooth', group: 'Extras', title: 'Bluetooth', prompt: 'Go wireless?', focus: [] },
  { kind: 'tilt', title: 'Tilt switch', prompt: 'Use a tilt switch as a star power shortcut?', focus: ['tilt'] },
  { kind: 'review', group: 'Finish', title: 'All done', prompt: 'Check everything, then save it to the controller.', focus: [] },
];

let stageViewer = null;
let stepCtx = {};    // per-step transient state
let ledFlow = null;  // sub-step of the guided LED question flow (kept while on that step)

function buildUi() {
  viewers.length = 0;
  bp.viewer = null;
  $('#stage').innerHTML = '';
  stageViewer = makeViewer($('#stage'), true, false, onGuitarPart);
  $('#tuneStage').innerHTML = '';
  makeViewer($('#tuneStage'), false, true);
  if ($('#lightsStage')) { $('#lightsStage').innerHTML = ''; makeViewer($('#lightsStage'), false, true); }   // the Lights page has no compact viewer any more (the live preview replaces it)
  buildTune();
  buildBackup();
  buildLights();
  buildModes();
  renderStep();
  advRefresh();
}

function stepValue(st) {
  const c = state.cfg;
  if (st.kind === 'buttons') return c.pins.filter((p) => p !== PIN_NONE).length + ' / ' + FUNCS.length;
  if (st.kind === 'whammy') return c.whammyCh === PIN_NONE ? '' : 'GP' + (26 + c.whammyCh);
  if (st.kind === 'rgb') return c.rgbEnabled ? [['WS2812B', 'SK6812', 'APA102'][c.ledType] || 'WS2812B', c.rgbPin === PIN_NONE ? '' : 'GP' + c.rgbPin].filter(Boolean).join(' \u00b7 ') : 'off';
  if (st.kind === 'ledmap') return c.rgbEnabled ? '' : 'n/a';
  if (st.kind === 'bluetooth') return c.btEnabled ? 'on' : 'off';
  if (st.kind === 'tilt') return c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin + (c.tiltInvert && fwAtLeast(33) ? ' NC' : '') : 'off';
  return '';
}
function isStepDone(st, i) {
  if (st.kind === 'buttons') return state.cfg.pins.every((p) => p !== PIN_NONE);
  if (st.kind === 'whammy') return state.cfg.whammyCh !== PIN_NONE;
  if (st.kind === 'review') return false;
  return i < state.step;
}
function renderStepList() {
  const ol = $('#stepList');
  if (!ol) return;
  ol.innerHTML = STEPS.map((st, i) => {
    const sw = '';
    return `<li class="${i === state.step ? 'cur' : ''} ${isStepDone(st, i) ? 'done' : ''} ${st.group ? 'has-grp' : ''}">${st.group ? `<span class="grp">${st.group}</span>` : ''}<button data-step="${i}"><span class="mark"></span><span>${sw}${st.title}</span><span class="v">${stepValue(st)}</span></button></li>`;
  }).join('');
  ol.onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) goStep(+b.dataset.step); };
}

function goStep(i) {
  bpClose(false);
  const dir = i < state.step ? -1 : 1;
  i = Math.max(0, Math.min(STEPS.length - 1, i));
  while (STEPS[i].kind === 'ledmap' && !state.cfg.rgbEnabled && i > 0 && i < STEPS.length - 1) i += dir;   // nothing to map without RGB
  state.step = i;
  renderStep();
}

function renderStep() {
  if (!state.dev || !stageViewer) return;
  const step = STEPS[state.step];
  const card = $('#stepCard');
  if (stepCtx.timer) { clearInterval(stepCtx.timer); state.dev?.ledTest(-1).catch(() => {}); }
  stopLedTest();
  if (step.kind !== 'rgb') ledFlow = null;   // the LED questions restart next time
  stepCtx = {};
  stageViewer.g.setFocus(step.focus);
  renderStepList();
  const head = `<div class="step-count">${state.step + 1} / ${STEPS.length}</div>
    <h2 class="step-title">${step.title}</h2><p class="step-prompt">${step.prompt}</p>`;

  const nav = (extra = '') => `<div class="step-nav">
      <button class="btn quiet" id="bBack" ${state.step === 0 ? 'disabled' : ''}>Back</button>
      <div class="row">${extra}</div></div>`;
  const wireNav = () => { $('#bBack')?.addEventListener('click', () => goStep(state.step - 1)); $('#bSkip')?.addEventListener('click', () => goStep(state.step + 1)); };

  if (step.kind === 'buttons') {
    // Nothing listens here until the user presses a Set button: every prompt is opened on purpose (see bpOpen).
    btnUndo = null;
    const draw = () => {
      const c = state.cfg, n = c.pins.filter((p) => p !== PIN_NONE).length;
      const tiles = FUNCS.map((f, i) => {
        const pin = c.pins[i], nm = btnName(i);
        return `<div class="bt ${pin !== PIN_NONE ? 'set' : ''}" data-f="${i}" style="--c:${btnColor(i)}">
          <div class="bt-ic">${btnIcon(i)}</div><div class="bt-name">${nm}</div>
          <div class="bt-pin">${pin !== PIN_NONE ? `<span class="chip">GP${pin}</span>` : '<span class="dim">Not set</span>'}</div>
          <div class="bt-act"><button class="btn small" data-set aria-label="${pin !== PIN_NONE ? 'Change' : 'Set'} ${nm}">${pin !== PIN_NONE ? 'Change' : 'Set'}</button>${pin !== PIN_NONE ? `<button class="btn small quiet" data-clear aria-label="Clear ${nm}">Clear</button>` : ''}</div></div>`;
      }).join('');
      const clearAll = !n ? '' : stepCtx.confirmAll
        ? `<span class="bt-confirm" role="alertdialog" aria-label="Clear all buttons?">Clear all ${FUNCS.length}? <button class="btn small danger" id="btYes">Yes</button><button class="btn small quiet" id="btNo">No</button></span>`
        : '<button class="btn small quiet" id="btClearAll">Clear all buttons</button>';
      card.innerHTML = head + `
        <div class="bt-top row"><span class="dim small bt-count">${n} of ${FUNCS.length} mapped</span>
          ${n < FUNCS.length && n > 0 ? '<button class="btn primary" id="btMissing">Map the missing ones</button>' : ''}
          <button class="btn ${n === 0 ? 'primary' : ''}" id="btAll">Map all buttons</button>
          <span class="bt-spacer"></span>${clearAll}</div>
        <div class="bt-note" id="btNote" role="status" aria-live="polite">${btnUndo ? `${btnUndo.label} <button class="btn small" id="btUndo">Undo</button>` : ''}</div>
        <div class="bt-grid">${tiles}</div>
        ${nav(`<button class="btn ${n ? 'primary' : ''}" id="bSkip">${n ? 'Continue' : 'Skip'}</button>`)}`;
      wireNav();
      card.querySelectorAll('.bt').forEach((t) => {
        // hovering or focusing a tile points at that control on the guitar above
        const aim = (on) => { if (!bp.open) stageViewer?.g.setFocus(on ? [FUNCS[+t.dataset.f]] : []); };
        t.addEventListener('mouseenter', () => aim(true)); t.addEventListener('mouseleave', () => aim(false));
        t.addEventListener('focusin', () => aim(true)); t.addEventListener('focusout', () => aim(false));
        t.querySelector('[data-set]').onclick = (e) => bpOpen(+t.dataset.f, null, e.currentTarget);
        const cl = t.querySelector('[data-clear]');
        if (cl) cl.onclick = () => {
          const f = +t.dataset.f;
          btnUndo = { label: `Cleared ${btnName(f)}.`, pins: { [f]: c.pins[f] } };
          c.pins[f] = PIN_NONE; pushCfg(); renderStepList(); draw();
          $(`.bt[data-f="${f}"] [data-set]`)?.focus();
        };
      });
      $('#btAll').onclick = (e) => bpOpen(0, FUNCS.map((_, i) => i), e.currentTarget);
      $('#btMissing')?.addEventListener('click', (e) => bpOpen(0, FUNCS.map((_, i) => i).filter((i) => c.pins[i] === PIN_NONE), e.currentTarget));
      $('#btClearAll')?.addEventListener('click', () => { stepCtx.confirmAll = true; draw(); $('#btNo').focus(); });
      $('#btNo')?.addEventListener('click', () => { stepCtx.confirmAll = false; draw(); $('#btClearAll')?.focus(); });
      $('#btYes')?.addEventListener('click', () => {
        btnUndo = { label: `Cleared all ${n} buttons.`, pins: Object.fromEntries(c.pins.map((p, i) => [i, p]).filter(([, p]) => p !== PIN_NONE)) };
        c.pins.fill(PIN_NONE); stepCtx.confirmAll = false; pushCfg(); renderStepList(); draw(); $('#btAll').focus();
      });
      $('#btUndo')?.addEventListener('click', btnUndoNow);
    };
    btnRedraw = () => { draw(); renderStepList(); };
    draw();
  } else if (step.kind === 'whammy') {
    stepCtx.cal = new WhammyCalibrator();
    const have = state.cfg.whammyCh !== PIN_NONE;
    card.innerHTML = head + `
      <div class="result ${have ? 'ok' : ''}" id="result">${have
        ? `Calibrated on <span class="chip">GP${26 + state.cfg.whammyCh}</span> (${state.cfg.whammyMin}–${state.cfg.whammyMax}${state.cfg.whammyInvert ? ', inverted' : ''})`
        : '<span class="pulse"></span><span>Waiting for the bar to move…</span>'}</div>
      <div class="dim small" style="margin-bottom:8px" id="wLabel">${have ? 'Live input' : 'Sweeps detected: 0 / 2'}</div>
      <div class="bar"><i id="wBar" style="width:0"></i></div>
      <div class="adcs"><p class="adcs-note">Raw analog inputs. The one your bar is wired to should swing. If the wrong one gets picked, press <b>Use</b> next to the right pin.</p>
        ${[0, 1, 2].map((c) => `<div class="adc-row" data-ch="${c}"><span class="chip">GP${26 + c}</span><div class="bar"><i></i></div><span class="val">0</span><button class="btn small quiet" data-use="${c}">Use</button></div>`).join('')}
        <div class="row" id="wManual" style="margin-top:10px;display:none;flex-wrap:wrap">
          <span class="dim small" style="flex-basis:100%">Manual calibration: leave the bar at rest and press <b>Capture rest</b>, then hold it all the way down and press <b>Capture full</b>.</span>
          <button class="btn small" id="wCapRest">Capture rest</button><button class="btn small" id="wCapFull">Capture full</button><span class="muted" id="wCapInfo" style="font-size:12px"></span></div></div>
      ${nav(`<button class="btn quiet" id="wRedo">Recalibrate</button><button class="btn ${have ? 'primary' : ''}" id="bSkip">${have ? 'Continue' : 'Skip'}</button>`)}`;
    wireNav();
    stepCtx.done = have;
    document.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
      stepCtx.cal.select(+b.dataset.use);
      stepCtx.done = false;
      stepCtx.manual = { ch: +b.dataset.use };
      $('#wManual').style.display = '';
      $('#wCapInfo').textContent = '';
      setResult('', `<span class="pulse"></span><span>Using <span class="chip">GP${26 + +b.dataset.use}</span>. Move the bar through two full sweeps.</span>`);
    }));
    const capture = (which) => {
      const m = stepCtx.manual, s = state.status;
      if (!m || !s) return;
      m[which] = s.adc[m.ch];
      $('#wCapInfo').textContent = `rest ${m.rest ?? '–'} · full ${m.full ?? '–'}`;
      if (m.rest != null && m.full != null) {
        if (Math.abs(m.full - m.rest) < 8) { setResult('bad', 'The reading barely changed between rest and full. Check the whammy wiring.'); return; }
        Object.assign(state.cfg, { whammyCh: m.ch, whammyMin: Math.min(m.rest, m.full), whammyMax: Math.max(m.rest, m.full), whammyInvert: m.rest > m.full });
        pushCfg();
        stepCtx.done = true;
        setResult('ok', `Calibrated on <span class="chip">GP${26 + m.ch}</span> (${state.cfg.whammyMin}–${state.cfg.whammyMax}${state.cfg.whammyInvert ? ', inverted' : ''})`);
        const bs = $('#bSkip'); if (bs) { bs.textContent = 'Continue'; bs.classList.add('primary'); }
      }
    };
    $('#wCapRest').addEventListener('click', () => capture('rest'));
    $('#wCapFull').addEventListener('click', () => capture('full'));
    $('#wRedo').addEventListener('click', () => {
      state.cfg.whammyCh = PIN_NONE; pushCfg(); stepCtx.cal.reset(); stepCtx.done = false; renderStep();
    });
  } else if (step.kind === 'rgb') {
    // one question per screen: Did you wire LEDs? > which type > layout > pins > test
    const SUBS = ['ask', 'type', 'layout', 'pins', 'test'];
    ledFlow ||= { sub: 'ask', ran: false, failed: false };
    const leave = () => { stopLedTest(); goStep(state.step + 1); };
    const renderRgb = () => {
      const c = state.cfg, f = ledFlow, k = SUBS.indexOf(f.sub), apa = c.ledType === 2;
      renderStepList();   // the list shows the LED type and pin
      const used = new Set(assignedPins());
      const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p));
      const pinOpts = (own, other) => `<option value="255">Choose pin…</option>${free.concat(own !== PIN_NONE ? [own] : []).sort((a, b) => a - b).map((p) => `<option value="${p}" ${p === own ? 'selected' : ''} ${p === other ? 'disabled' : ''}>GP${p}</option>`).join('')}`;
      const chain = ledLayout(c).chain;
      let q = '', body = '', next = '';
      if (f.sub === 'ask') {
        q = 'Did you wire LEDs?';
        body = `<p class="dim">Addressable LEDs under the frets or on the strum bar.</p>
          <div class="led-ask"><button class="btn lg ${c.rgbEnabled ? 'primary' : ''}" id="askYes">Yes, I wired LEDs</button><button class="btn lg" id="askNo">No, I don't have LEDs</button></div>`;
      } else if (f.sub === 'type') {
        q = 'Which LEDs do you have?';
        body = `${ledTypeCards(c)}<p class="dim small led-hint">Not sure? Count the wires going into the first LED: <b>3</b> means WS2812B, <b>4</b> means APA102.</p>
          ${apa && !fwApaOk() ? `<div class="notice warn">APA102 LEDs need firmware 0.32 or newer. Yours is v${state.info.major}.${state.info.minor}. <button type="button" class="btn small" data-led-update>Update firmware</button></div>` : ''}`;
        next = '<button class="btn primary" id="lNext">Continue</button>';
      } else if (f.sub === 'layout') {
        q = 'Where are the LEDs?';
        body = ledLayoutControls(c);
        next = `<button class="btn primary" id="lNext" ${chain ? '' : 'disabled'}>Continue</button>`;
      } else if (f.sub === 'pins') {
        q = 'Which pins are they wired to?';
        const d = c.rgbPin === PIN_NONE ? 'a pin' : 'GP' + c.rgbPin;
        const wire = apa ? `Pico ${d} → first LED's DI (SDI), Pico ${c.ledClkPin === PIN_NONE ? 'a pin' : 'GP' + c.ledClkPin} → its CI (CKI). LED 5V → VBUS, GND → GND.`
          : `Pico ${d} → first LED's DIN (the arrow on the strip points away from the Pico). LED 5V → VBUS, GND → GND.`;
        body = `<div class="opt first"><div><h3>Data pin</h3><p class="dim">${apa ? 'DI / SDI' : 'DIN'} of the first LED.</p></div><select id="rgbPinSel">${pinOpts(c.rgbPin, apa ? c.ledClkPin : PIN_NONE)}</select></div>
          ${apa ? `<div class="opt"><div><h3>Clock pin</h3><p class="dim">CI / CKI of the first LED. Not the same pin as data.</p></div><select id="rgbClkSel">${pinOpts(c.ledClkPin, c.rgbPin)}</select></div>` : ''}
          <p class="led-wire">${wire}</p>
          <div class="slider-row"><label for="rgbBriS">Brightness</label><span class="val" id="rgbBriSVal">${c.rgbBrightness}</span>
            <input type="range" id="rgbBriS" min="0" max="${maxBrightness(c)}" step="1" value="${c.rgbBrightness}"></div>
          ${brightNote(c)}`;
        next = `<button class="btn primary" id="lNext" ${c.rgbPin === PIN_NONE || (apa && (c.ledClkPin === PIN_NONE || c.ledClkPin === c.rgbPin)) ? 'disabled' : ''}>Continue</button>`;
      } else {
        const why = ledWhyDark(c);
        q = 'Test the LEDs';
        body = `<p class="dim">${LED_SHORT[c.ledType]} on GP${c.rgbPin}${apa ? ' + GP' + c.ledClkPin : ''}. Each LED lights white in turn.</p>
          ${why ? `<div class="notice warn">They would stay dark: ${why}.</div>` : ''}
          <div class="row"><button class="btn primary lg" id="ledRun">${f.ran ? 'Test again' : 'Light them up'}</button></div>
          ${f.ran ? `<h3 class="led-q2">Did the LEDs light up?</h3>
            <div class="led-ask"><button class="btn lg primary" id="litYes">Yes, they lit up</button><button class="btn lg" id="litNo">No</button></div>` : ''}
          ${f.failed ? `<div class="notice warn">No problem. If it is the wrong type, <a href="#" id="chgType">pick the LED type again</a>. Otherwise work through this list.</div>${ledHelpHtml(c, true)}` : ''}`;
      }
      card.innerHTML = head + `<div class="led-steps" aria-label="Question ${k + 1} of ${SUBS.length}">${SUBS.map((s, i) => `<i class="${i <= k ? 'on' : ''}"></i>`).join('')}</div>
        <h3 class="led-q">${q}</h3>${body}
        <div class="step-nav"><button class="btn quiet" id="lBack">Back</button><div class="row">${next}</div></div>`;
      const go = (sub) => { stopLedTest(); ledFlow = { ...ledFlow, sub, failed: false }; renderRgb(); };
      $('#lBack').onclick = () => (k === 0 ? (state.step === 0 ? null : goStep(state.step - 1)) : go(SUBS[k - 1]));
      if (k === 0 && state.step === 0) $('#lBack').disabled = true;
      $('#lNext')?.addEventListener('click', () => go(SUBS[k + 1]));
      $('#askYes')?.addEventListener('click', () => { c.rgbEnabled = true; applyColors(); pushCfg(); go('type'); });
      $('#askNo')?.addEventListener('click', () => { c.rgbEnabled = false; applyColors(); pushCfg(); leave(); });
      if (f.sub === 'type') wireLedTypeCards(card, c, () => { pushCfg(); renderRgb(); });
      if (f.sub === 'layout') wireLedLayout(c, () => { pushCfg(); renderRgb(); });
      if (f.sub === 'pins') {
        $('#rgbPinSel').addEventListener('change', (e) => { c.rgbPin = +e.target.value; pushCfg(); renderRgb(); });
        $('#rgbClkSel')?.addEventListener('change', (e) => { c.ledClkPin = +e.target.value; pushCfg(); renderRgb(); });
        $('#rgbBriS').addEventListener('input', (e) => { c.rgbBrightness = +e.target.value; $('#rgbBriSVal').textContent = c.rgbBrightness; pushCfg(); });
      }
      if (f.sub === 'test') {
        $('#ledRun').onclick = async () => {
          const ok = await ledTestButton($('#ledRun'), 'Test again');
          if (ok && ledFlow === f && state.step === STEPS.indexOf(step)) { f.ran = true; renderRgb(); }
        };
        $('#litYes')?.addEventListener('click', leave);
        $('#litNo')?.addEventListener('click', () => { f.failed = true; renderRgb(); });
        $('#chgType')?.addEventListener('click', (e) => { e.preventDefault(); go('type'); });
      }
    };
    renderRgb();
  } else if (step.kind === 'ledmap') {
    const c = state.cfg;
    const lay = ledLayout(c);
    const why = ledWhyDark(c);
    if (why) {    // nothing would light, so don't start the wizard (and keep stepCtx empty so tickStep stays idle)
      card.innerHTML = head + `<div class="result bad"><span>The LEDs can't light up yet: ${why}.</span></div>
        <div class="row led-gap"><button class="btn primary" id="mBackSetup">Go back to LED setup</button></div>
        ${ledHelpHtml(c)}${nav('')}`;
      wireNav();
      $('#mBackSetup').addEventListener('click', () => {
        ledFlow = { sub: c.rgbEnabled ? (c.ledType === 2 && !fwApaOk() ? 'type' : lay.chain ? 'pins' : 'layout') : 'ask', ran: false, failed: false };
        goStep(STEPS.findIndex((s) => s.kind === 'rgb'));
      });
      return;
    }
    stepCtx.chain = lay.chain;
    stepCtx.idx = 0;
    stepCtx.assign = [-1, -1, -1, -1, -1];     // fret -> chain position
    stepCtx.assign2 = [-1, -1, -1, -1, -1];    // fret -> its second LED (two per fret)
    stepCtx.strumAssign = [];                  // chain positions of the strum LEDs, in the order found
    stepCtx.base = null;
    stepCtx.lockUntil = 0;
    const finish = () => {
      // LEDs that were skipped take whatever positions are left, in order
      const taken = new Set([...stepCtx.assign.filter((p) => p >= 0), ...stepCtx.assign2.filter((p) => p >= 0), ...stepCtx.strumAssign]);
      const left = [...Array(lay.chain).keys()].filter((p) => !taken.has(p));
      if (lay.frets) c.ledMap = stepCtx.assign.map((p) => (p >= 0 ? p : left.shift()));
      if (lay.frets && lay.per === 2) c.ledMap2 = stepCtx.assign2.map((p) => (p >= 0 ? p : left.shift()));
      for (let k = 0; k < MAX_STRUM_LEDS; k++) c.strumMap[k] = k < lay.strum ? (stepCtx.strumAssign[k] ?? left.shift()) : 200 + k;
      pushCfg();
    };
    const label = (pos) => {
      let f = lay.frets ? c.ledMap.indexOf(pos) : -1;
      if (f < 0 && lay.frets && lay.per === 2) f = (c.ledMap2 || []).indexOf(pos);
      if (f >= 0) return `<b style="color:${c.colors[f]}">${funcName(f)}</b>`;
      const k = c.strumMap.slice(0, lay.strum).indexOf(pos);
      return k >= 0 ? `<b>Strum ${k + 1}</b>` : '<b>?</b>';
    };
    const draw = () => {
      if (stepCtx.idx >= lay.chain) {
        finish();
        clearInterval(stepCtx.timer); stepCtx.timer = 0;
        state.dev?.ledTest(-1).catch(() => {});
        card.innerHTML = head + `<div class="result ok">LED order: ${[...Array(lay.chain).keys()].map(label).join(' → ')}</div>
          ${nav('<button class="btn quiet" id="mRedo">Redo</button><button class="btn primary" id="bSkip">Continue</button>')}`;
        wireNav();
        $('#mRedo').addEventListener('click', () => renderStep());
        return;
      }
      const dots = [...Array(lay.chain).keys()].map((i) => {
        const f = stepCtx.assign.indexOf(i) >= 0 ? stepCtx.assign.indexOf(i) : stepCtx.assign2.indexOf(i), sk = stepCtx.strumAssign.indexOf(i);
        return `<i class="${i === stepCtx.idx ? 'lit' : f >= 0 || sk >= 0 ? 'done' : ''}" style="--c:${f >= 0 ? c.colors[f] : '#fff'}"></i>`;
      }).join('');
      const what = (lay.frets && lay.strum ? 'Press the fret above it, or strum if it is on the strum bar.'
        : lay.frets ? 'Press the fret above it.' : 'Strum once.') + (lay.frets && lay.per === 2 ? ' Each fret has two LEDs, so you press every fret twice in all.' : '');
      const noPins = lay.frets ? c.pins.slice(0, NUM_FRETS).every((p) => p === PIN_NONE) : (c.pins[5] === PIN_NONE && c.pins[6] === PIN_NONE);
      card.innerHTML = head + `<div class="led-test">${dots}</div>
        <div class="result"><span class="pulse"></span><span>${!lay.chain ? 'No LEDs are set up. Go back and choose fret and / or strum LEDs.' : noPins ? 'The frets / strum bar are not assigned yet. Go back and map them first.' : `LED ${stepCtx.idx + 1} of ${lay.chain} is lit white. ${what}`}</span></div>
        <p class="led-gap"><a href="#" id="mHelp">Not lighting up?</a></p>${stepCtx.showHelp ? ledHelpHtml(c, true) : ''}
        ${nav('<button class="btn" id="mSkipLed">Skip this LED</button>')}`;
      wireNav();
      $('#mHelp').addEventListener('click', (e) => { e.preventDefault(); stepCtx.showHelp = !stepCtx.showHelp; draw(); });
      $('#mSkipLed').addEventListener('click', () => { stepCtx.idx++; stepCtx.base = null; draw(); sendTest(); });
    };
    const sendTest = () => { if (stepCtx.idx < lay.chain) state.dev?.ledTest(stepCtx.idx).catch(() => {}); };
    stepCtx.redraw = () => { draw(); sendTest(); };
    stepCtx.redraw();
    stepCtx.timer = setInterval(sendTest, 1000);
  } else if (step.kind === 'bluetooth') {
    const sup = state.info.btSupported;
    const why = state.info.board === 4
      ? 'This is a Pico-compatible clone. Its ESP8285 chip only does Wi-Fi, so there is no Bluetooth radio to use.'
      : 'This board has no Bluetooth radio. Only the Pico W and Pico 2 W can go wireless.';
    card.innerHTML = head + `
      <div class="opt first"><div><h3>Bluetooth</h3><p class="dim">${sup ? 'To pair, hold <b>Star power</b> while plugging in or switching on (or hold <b>Star power + Plus</b> for 5 s). The frets double-blink blue until it connects, then the guitar reconnects by itself every time it is switched on. Each mode is its own Bluetooth device (\u201cYAGCC PS3 GH\u201d, \u201cYAGCC XInput\u201d, \u2026), paired once; Star power at power-on forgets only the mode it starts in.' : why}</p></div>
        <label class="switch"><input type="checkbox" id="btSw" ${state.cfg.btEnabled ? 'checked' : ''} ${sup ? '' : 'disabled'}><i></i></label></div>
      ${sup ? '<div class="notice">Over Bluetooth the guitar shows up as the same controller as over USB in its current mode (XInput and Xbox modes use the standard gamepad). Hold <b>Star power + a fret</b> for 3 s to switch modes wirelessly. Plugging it into a PC or console switches Bluetooth off until it is unplugged; a charger doesn\u2019t.</div>' : ''}
      ${sup ? `<div class="opt adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}"><div><h3>Debug logging</h3><p class="dim">Records Bluetooth connections in the guitar's memory, kept across power cycles until cleared, to track down connection problems. Off by default; leave it off for normal use.</p></div>
        <label class="switch"><input type="checkbox" id="btLogSw" ${state.cfg.btDebugLog ? 'checked' : ''}><i></i></label></div>
      <div class="opt adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}"><div><h3>Bluetooth log</h3><p class="dim">What was recorded while debug logging was on.</p></div><span class="row"><button class="btn small" id="btLogBtn">Show</button><button class="btn small" id="btLogClear" hidden>Clear</button></span></div><pre class="btlog adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}" id="btLog" hidden></pre>
      <p class="adv-hint" ${state.cfg.btDebugLog ? 'hidden' : ''}>More options (debug logging, Bluetooth log). <button type="button" class="linklike" data-adv-on>Turn on Advanced</button></p>` : ''}
      ${nav('<button class="btn primary" id="bSkip">Continue</button>')}`;
    wireNav();
    $('#btLogBtn')?.addEventListener('click', async () => {
      const pre = $('#btLog');
      let persistent = false;
      try {
        let lines;
        try { lines = await state.dev.getBtLogFlash(); persistent = true; } catch { lines = await state.dev.getBtLog(); }
        pre.textContent = lines.length ? lines.join('\n')
          : (state.cfg.btDebugLog ? 'Nothing recorded yet.' : 'Nothing recorded. Switch on debug logging, then reproduce the problem.');
      } catch { pre.textContent = 'This firmware has no Bluetooth log. Update to the latest firmware.'; }
      $('#btLogClear').hidden = !persistent;
      pre.hidden = false;
      if (pre.textContent.includes('power-on')) { try { await navigator.clipboard.writeText(pre.textContent); toast('Bluetooth log copied', 'ok'); } catch { /* clipboard blocked */ } }
    });
    $('#btLogClear')?.addEventListener('click', async () => {
      try { await state.dev.clearBtLogFlash(); $('#btLog').textContent = 'Log cleared.'; toast('Bluetooth log cleared', 'ok'); }
      catch (e) { toast('Could not clear the log: ' + e.message, 'bad'); }
    });
    $('#btSw').addEventListener('change', (e) => { state.cfg.btEnabled = e.target.checked; pushCfg(); });
    // saved straight away: the log is for power cycles, which an unsaved setting wouldn't survive
    $('#btLogSw')?.addEventListener('change', async (e) => {
      state.cfg.btDebugLog = e.target.checked;
      try { await state.dev.setConfig(state.cfg); await state.dev.save(); takeSnapshot(); toast(e.target.checked ? 'Bluetooth debug logging on (saved)' : 'Bluetooth debug logging off (saved)', 'ok'); }
      catch (err) { toast('Could not save: ' + err.message, 'bad'); }
    });
  } else if (step.kind === 'tilt') {
    const renderTilt = () => {
      const c = state.cfg;
      const have = c.tiltPin !== PIN_NONE;
      stepCtx.activeSince = 0; stepCtx.rerender = renderTilt;
      stepCtx.detector = new PinDetector({ windowMs: 5000, minPresses: 2, exclude: assignedPins().filter((p) => p !== c.tiltPin) });
      card.innerHTML = head + `
        <div class="opt first"><div><h3>Tilt for star power</h3><p class="dim">Lifting the neck triggers star power, like on a real controller.</p></div>
          <label class="switch"><input type="checkbox" id="tiltSw" ${c.tiltEnabled ? 'checked' : ''}><i></i></label></div>
        ${c.tiltEnabled ? `<div class="result ${have ? 'ok' : ''}" id="result" style="margin-top:12px">${have
          ? `Tilt switch on <span class="chip">GP${c.tiltPin}</span>`
          : '<span class="pulse"></span><span>Tilt the guitar up twice within 5 seconds.</span>'}</div>` : ''}
        ${c.tiltEnabled ? `${tiltTypeHtml('tiltType')}
          <div class="opt"><div><h3>Or choose the pin yourself</h3><p class="dim">Skips the double tilt.</p></div>${tiltPinSelect('tiltPinSel')}</div>` : ''}
        ${c.tiltEnabled && have ? `<div class="tilt-live" id="tiltLive"><i></i><span id="tiltLiveTxt">Tilt: not active</span><span class="dim small">Hold the guitar level, then tilt it up to check.</span></div>
          <div class="notice" id="tiltSuggest" hidden><span id="tiltSuggestTxt"></span> <button type="button" class="btn small primary" id="tiltSuggestBtn">Switch</button></div>` : ''}
        ${nav(`${c.tiltEnabled && have ? '<button class="btn quiet" id="tRedo">Re-detect</button>' : ''}<button class="btn primary" id="bSkip">Continue</button>`)}`;
      wireNav();
      stepCtx.active = c.tiltEnabled && !have;
      $('#tiltSw').addEventListener('change', (e) => { c.tiltEnabled = e.target.checked; if (!c.tiltEnabled) c.tiltPin = PIN_NONE; pushCfg(); renderTilt(); });
      $('#tRedo')?.addEventListener('click', () => { c.tiltPin = PIN_NONE; pushCfg(); renderTilt(); });
      card.querySelectorAll('#tiltType [data-inv]').forEach((b) => b.addEventListener('click', () => { c.tiltInvert = b.dataset.inv === '1'; pushCfg(); renderTilt(); }));
      $('#tiltPinSel')?.addEventListener('change', (e) => { c.tiltPin = +e.target.value; pushCfg(); stepCtx.active = false; renderStepList(); renderTilt(); });
      $('#tiltSuggestBtn')?.addEventListener('click', () => { c.tiltInvert = !c.tiltInvert; pushCfg(); renderTilt(); });
    };
    renderTilt();
  } else {
    const c = state.cfg;
    const act = (go, clear) => `<td class="sum-act"><button class="btn small quiet" data-go="${go}">Change</button>${clear ? `<button class="btn small quiet" data-clr="${clear}">Clear</button>` : ''}</td>`;
    const pinOr = (txt, none = 'not set') => txt ? txt : `<span class="dim">${none}</span>`;
    const rows = FUNCS.map((f, i) => `<tr><td>${btnName(i)}</td><td>${pinOr(c.pins[i] === PIN_NONE ? '' : 'GP' + c.pins[i])}</td>${act('b' + i, c.pins[i] !== PIN_NONE ? 'b' + i : '')}</tr>`).join('') +
      `<tr><td>Whammy</td><td>${pinOr(c.whammyCh === PIN_NONE ? '' : 'GP' + (26 + c.whammyCh))}</td>${act('whammy')}</tr>
       <tr><td>Tilt switch</td><td>${pinOr(c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin + (c.tiltInvert && fwAtLeast(33) ? ' \u00b7 normally closed' : '') : '', 'off')}</td>${act('tilt', c.tiltEnabled || c.tiltPin !== PIN_NONE ? 'tilt' : '')}</tr>
       <tr><td>RGB LEDs</td><td>${pinOr(c.rgbEnabled && c.rgbPin !== PIN_NONE ? 'GP' + c.rgbPin : '', 'off')}</td>${act('rgb')}</tr>
       <tr><td>Bluetooth</td><td>${c.btEnabled ? 'on' : 'off'}</td>${act('bluetooth')}</tr>`;
    card.innerHTML = head + `<table class="sum">${rows}</table>
      <p class="dim small" style="margin-top:14px">Try every input: the guitar lights up as you press. Debounce and whammy feel are on the Tune page.</p>
      <div class="step-nav">
        <button class="btn quiet" id="bRedo">Start over</button>
        <button class="btn primary lg" id="bSave">Save to controller</button></div>`;
    btnRedraw = () => renderStep();
    card.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const g = b.dataset.go;
      if (g[0] === 'b' && g !== 'bluetooth') bpOpen(+g.slice(1), null, b);
      else goStep(STEPS.findIndex((st) => st.kind === g));
    }));
    card.querySelectorAll('[data-clr]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.clr === 'tilt') { c.tiltEnabled = false; c.tiltPin = PIN_NONE; } else c.pins[+b.dataset.clr.slice(1)] = PIN_NONE;
      pushCfg(); renderStep();
    }));
    $('#bRedo').addEventListener('click', () => { state.cfg.pins.fill(PIN_NONE); state.cfg.whammyCh = PIN_NONE; state.cfg.tiltPin = PIN_NONE; pushCfg(); goStep(0); });
    $('#bSave').addEventListener('click', saveToController);
  }
}

function setResult(kind, html) {
  const r = $('#result');
  if (!r) return;
  r.className = 'result ' + kind;
  r.innerHTML = html;
}

// ---- button mapping: tiles + the "Press the GREEN FRET" prompt (Clone Hero style)
// Nothing listens until the user opens a prompt, so a stray press can never change a mapping.
let btnUndo = null;        // {label, pins:{func:pin}} - what "Undo" restores after a Clear
let btnRedraw = () => {};  // re-renders whatever shows the mapping (Buttons tiles or the review table)
const btnName = (i) => (i < NUM_FRETS ? funcName(i) + ' fret' : funcName(i));
const btnColor = (i) => (i < NUM_FRETS ? FRET_COLORS[i] : i === 7 ? '#facc15' : i === 8 ? '#38e1c6' : '#7c8cff');

// Simple icons of each control (48x48), used on the tiles and big in the prompt
function btnIcon(i) {
  const c = btnColor(i);
  let g;
  if (i < NUM_FRETS) g = `<rect x="14" y="5" width="20" height="38" rx="9" fill="${c}"/><rect x="18" y="9" width="12" height="7" rx="3.5" fill="#fff" opacity=".35"/>`;
  else if (i === 5 || i === 6) {
    const up = i === 5;
    g = `<rect x="5" y="${up ? 26 : 16}" width="38" height="8" rx="4" fill="#aab3c5"/><path d="M${up ? '24 5 L14 17 H34' : '24 43 L14 31 H34'} Z" fill="${c}"/>`;
  } else if (i === 7) {
    const pts = [...Array(10).keys()].map((k) => { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 9 : 20; return (24 + r * Math.cos(a)).toFixed(1) + ',' + (25 + r * Math.sin(a)).toFixed(1); }).join(' ');
    g = `<polygon points="${pts}" fill="${c}" stroke="${c}" stroke-linejoin="round" stroke-width="2"/>`;
  } else g = `<circle cx="24" cy="24" r="19" fill="#1b2030" stroke="${c}" stroke-width="2.5"/><path d="M14 24 H34 M24 14 V34" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">${g}</svg>`;
}

const BP_AUTO_KEY = 'yagcc.btnAuto';
const bp = { open: false, func: 0, queue: null, qi: 0, phase: 'listen', detector: null, timer: 0, prev: 0, msg: null, root: null, opener: null, restore: '', manualOpen: false };
const bpAuto = () => store.get(BP_AUTO_KEY) !== '0';   // on unless the user switched it off

function btnUndoNow() {
  if (!btnUndo) return;
  const c = state.cfg;
  for (const [f, pin] of Object.entries(btnUndo.pins)) if (!c.pins.includes(pin)) c.pins[f] = pin;   // skip a pin taken in the meantime
  btnUndo = null; pushCfg(); btnRedraw();
}

// the guitar picture was clicked (2D drawing or 3D model)
function onGuitarPart(name) {
  if (state.view !== 'setup' || !state.dev || bp.open) return;
  if (name === 'whammy') { goStep(STEPS.findIndex((s) => s.kind === 'whammy')); return; }
  const i = FUNCS.indexOf(name);
  if (i < 0) return;
  const kind = STEPS[state.step].kind;
  if (kind !== 'buttons' && kind !== 'review') goStep(0);
  bpOpen(i, null, document.activeElement);
}

// pins that belong to something other than the nine buttons (tilt, host, ports...) can't be taken here
const bpOtherPins = () => { const b = new Set(state.cfg.pins); return assignedPins().filter((p) => !b.has(p)); };

function bpOpen(func, queue, opener) {
  bpClose(false);
  Object.assign(bp, { open: true, func, queue, qi: 0, opener: opener || null, msg: null, manualOpen: false });
  bp.restore = opener?.closest?.('[data-f]') ? `.bt[data-f="${opener.closest('[data-f]').dataset.f}"] [data-set]` : opener?.id ? '#' + opener.id : '';
  bp.root = document.createElement('div');
  bp.root.className = 'bp-back';
  bp.root.addEventListener('mousedown', (e) => { if (e.target === bp.root) bpClose(); });
  bp.root.addEventListener('keydown', bpKey);
  document.body.appendChild(bp.root);
  document.body.classList.add('bp-lock');
  bpListen();
}

function bpListen() {
  clearTimeout(bp.timer);
  bp.phase = 'listen'; bp.msg = null;
  bp.detector = new PinDetector({ windowMs: 1000, minPresses: 2, exclude: bpOtherPins() });
  stageViewer?.g.setFocus([FUNCS[bp.func]]);
  bpRender();
}

function bpClose(restoreFocus = true) {
  if (!bp.open) return;
  clearTimeout(bp.timer);
  bp.open = false;
  bp.root?.remove(); bp.root = null;
  bp.viewer?.container.remove();
  document.body.classList.remove('bp-lock');
  stageViewer?.g.setFocus(STEPS[state.step]?.focus || []);
  if (restoreFocus) (document.querySelector(bp.restore || '#_none') || (bp.opener?.isConnected ? bp.opener : null))?.focus();
}

function bpNext() {
  clearTimeout(bp.timer);
  if (bp.queue && bp.qi + 1 < bp.queue.length) { bp.qi++; bp.func = bp.queue[bp.qi]; bpListen(); }
  else { bpClose(); if (bp.queue) toast('Buttons done', 'ok'); }
}

// the control was detected (or chosen by hand) on `pin`
function bpPin(pin) {
  const c = state.cfg, f = bp.func;
  const who = c.pins.findIndex((p, i) => p === pin && i !== f);
  if (who >= 0) { bp.phase = 'conflict'; bp.msg = { pin, who }; bpRender(); return; }
  bpAssign(pin);
}

function bpAssign(pin, steal = -1) {
  const c = state.cfg, f = bp.func;
  bp.prev = { pin: c.pins[f], stole: steal >= 0 ? steal : -1 };
  if (steal >= 0) c.pins[steal] = PIN_NONE;
  c.pins[f] = pin;
  pushCfg();
  bp.phase = 'result'; bp.msg = { pin };
  btnRedraw();
  bpRender();
  clearTimeout(bp.timer);
  // a single Set closes by itself; "map all" waits for Next unless the user asked it not to
  if (!bp.queue) bp.timer = setTimeout(bpClose, 900);
  else if (bpAuto()) bp.timer = setTimeout(bpNext, 900);
}

function bpUndo() {
  const c = state.cfg;
  c.pins[bp.func] = bp.prev.pin;
  if (bp.prev.stole >= 0) c.pins[bp.prev.stole] = bp.msg.pin;
  pushCfg(); btnRedraw(); bpListen();
}

function bpRender() {
  const f = bp.func, c = state.cfg, col = btnColor(f), root = bp.root;
  if (!root) return;
  stageViewer?.g.setFocus([FUNCS[f]]);   // dashed ring on the guitar picture behind the dialog
  const verb = f === 5 || f === 6 ? 'Push' : 'Press';
  const what = f < NUM_FRETS ? `the <span class="bp-c" style="color:${col}">${funcName(f).toUpperCase()} FRET</span>`
    : f === 5 ? 'the strum bar <span class="bp-c">UP</span>' : f === 6 ? 'the strum bar <span class="bp-c">DOWN</span>'
    : f === 7 ? '<span class="bp-c">STAR POWER</span>' : '<span class="bp-c">PLUS</span>';
  const m = bp.msg;
  const last = !bp.queue || bp.qi + 1 >= bp.queue.length;
  const nextName = !last ? btnName(bp.queue[bp.qi + 1]) : '';
  let body = '', acts = '';
  if (bp.phase === 'listen') {
    body = `<p class="bp-sub">${f === 5 || f === 6 ? 'Push' : 'Press'} it twice</p>
      <div class="bp-listen"><span class="bp-dots" aria-hidden="true"><i></i><i></i></span><span class="dim">Listening…</span></div>
      <p class="bp-msg ${m?.bad ? 'bad' : ''}" role="status" aria-live="polite">${m?.text || ''}</p>`;
  } else if (bp.phase === 'conflict') {
    body = `<p class="bp-msg bad" role="alert"><span class="chip">GP${m.pin}</span> is already <b>${btnName(m.who)}</b>.</p>`;
    acts = `<button class="btn primary" id="bpSteal">Use it for ${funcName(f)} instead</button><button class="btn" id="bpAgain">Press another</button>`;
  } else {
    body = `<p class="bp-done" role="status" style="color:${col}">${btnName(f)} <span aria-hidden="true">→</span> GP${m.pin}</p>
      ${bp.prev.stole >= 0 ? `<p class="dim small">${btnName(bp.prev.stole)} is now not set.</p>` : ''}`;
    acts = `<button class="btn quiet" id="bpUndo">Undo</button>` + (bp.queue ? `<button class="btn primary" id="bpNext">${last ? 'Finish' : 'Next: ' + nextName + ' →'}</button>` : '<button class="btn" id="bpDone">Done</button>');
  }
  if (bp.phase === 'listen' && bp.queue) acts = `<button class="btn" id="bpSkip">Skip</button>`;
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !assignedPins().includes(p) || p === c.pins[f]);
  const keepOpen = root.querySelector('.bp-manual')?.open ?? bp.manualOpen;
  root.innerHTML = `<div class="bp-card ph-${bp.phase}" role="dialog" aria-modal="true" aria-labelledby="bpTitle" tabindex="-1" style="--c:${col}">
      ${bp.queue ? `<div class="bp-count">Button ${bp.qi + 1} of ${bp.queue.length}</div>` : ''}
      <div class="bp-gslot"></div>
      <h2 class="bp-title" id="bpTitle">${verb} ${what}</h2>
      ${body}
      <div class="bp-acts">${acts}<span class="bp-grow"></span>${bp.queue ? '<button class="btn quiet" id="bpStop">Stop</button>' : ''}<button class="btn quiet" id="bpCancel">${bp.phase === 'result' ? 'Close' : 'Cancel'}</button></div>
      ${bp.phase === 'listen' ? `<details class="bp-manual" ${keepOpen ? 'open' : ''}><summary>Choose the pin yourself</summary>
        <select id="bpPin" aria-label="Pin for ${btnName(f)}"><option value="">Choose pin…</option>${free.map((p) => `<option value="${p}" ${p === c.pins[f] ? 'selected' : ''}>GP${p}</option>`).join('')}</select></details>` : ''}
      ${bp.queue ? `<label class="bp-auto"><input type="checkbox" id="bpAuto" ${bpAuto() ? 'checked' : ''}> Go to the next button by itself</label>` : ''}
    </div>`;
  const q = (id) => root.querySelector(id);
  // the guitar picture lives in the dialog: one lazily built viewer, moved into each fresh render
  if (!bp.viewer) {
    const holder = document.createElement('div');
    holder.className = 'stage compact bp-guitar';
    bp.viewer = makeViewer(holder, false, true);
    bp.viewer.g.setFretColors(c.rgbEnabled ? c.colors : FRET_DEFAULT_COLORS);
  }
  q('.bp-gslot').appendChild(bp.viewer.container);
  bp.viewer.g.setFocus([FUNCS[f]]);
  if (state.status) updateViewer(bp.viewer, state.status);
  q('#bpCancel').onclick = () => bpClose();
  q('#bpStop')?.addEventListener('click', () => bpClose());
  q('#bpSkip')?.addEventListener('click', bpNext);
  q('#bpNext')?.addEventListener('click', bpNext);
  q('#bpDone')?.addEventListener('click', () => bpClose());
  q('#bpUndo')?.addEventListener('click', bpUndo);
  q('#bpAgain')?.addEventListener('click', bpListen);
  q('#bpSteal')?.addEventListener('click', () => bpAssign(m.pin, m.who));
  q('#bpPin')?.addEventListener('change', (e) => { if (e.target.value !== '') { bp.manualOpen = true; bpPin(+e.target.value); } });
  q('.bp-manual')?.addEventListener('toggle', (e) => { bp.manualOpen = e.target.open; });
  q('#bpAuto')?.addEventListener('change', (e) => {
    store.set(BP_AUTO_KEY, e.target.checked ? '1' : '0');
    if (e.target.checked && bp.phase === 'result') { clearTimeout(bp.timer); bp.timer = setTimeout(bpNext, 900); } else if (!e.target.checked) clearTimeout(bp.timer);
  });
  // focus: the primary action when there is one, else the dialog itself (so a screen reader reads the title)
  (q('#bpSteal') || q('#bpNext') || q('#bpDone') || q('.bp-card')).focus({ preventScroll: true });
}

// Esc cancels; Tab stays inside the dialog
function bpKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); bpClose(); return; }
  if (e.key !== 'Tab') return;
  const els = [...bp.root.querySelectorAll('button, select, summary, input, [tabindex="-1"]')].filter((x) => x.offsetParent !== null && !x.disabled && (x.tabIndex >= 0 || x.matches('summary')));
  if (!els.length) { e.preventDefault(); return; }
  const first = els[0], last = els[els.length - 1], a = document.activeElement;
  if (e.shiftKey && (a === first || a === bp.root.querySelector('.bp-card'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  else if (!bp.root.contains(a)) { e.preventDefault(); first.focus(); }
}

// each status report while a prompt is listening
function bpTick(s) {
  if (!bp.open || bp.phase !== 'listen') return;
  const r = bp.detector.feed(s);
  if (!r) return;
  if (r.pin !== undefined) bpPin(r.pin);
  else {
    bp.msg = r.ambiguous
      ? { bad: 1, text: `Several inputs moved at once (${r.ambiguous.map((p) => 'GP' + p).join(', ')}). Press only the ${btnName(bp.func).toLowerCase()}.` }
      : { bad: 1, text: `<span class="chip">GP${r.used[0]}</span> is used for something else (tilt, LEDs, ports...). Press a different control.` };
    const el = bp.root.querySelector('.bp-msg');
    if (el) { el.className = 'bp-msg bad'; el.innerHTML = bp.msg.text; }
  }
}

// shared by the Setup tilt step and the Tune "Tilt switch" panel
function tiltTypeHtml(id) {
  const c = state.cfg, ok = fwAtLeast(33), dis = ok ? '' : 'disabled';
  return `<div class="opt tilt-type" id="${id}"><div><h3>Which position counts as tilted?</h3>
    <p class="dim" id="${id}Hint">${ok ? 'If the indicator shows active while the guitar is level, pick the other one.' : 'Normally closed switches need firmware 0.33 or newer.'}</p></div>
    <div class="seg" role="radiogroup" aria-label="Which position counts as tilted?">
      <button type="button" role="radio" data-inv="0" aria-checked="${!tiltInverted()}" class="${tiltInverted() ? '' : 'on'}" ${dis}>Switch closed = tilted<small> normally open</small></button>
      <button type="button" role="radio" data-inv="1" aria-checked="${tiltInverted()}" class="${tiltInverted() ? 'on' : ''}" ${dis}>Switch open = tilted<small> normally closed</small></button></div></div>`;
}
function tiltPinSelect(id) {
  const c = state.cfg, used = new Set(assignedPins().filter((p) => p !== c.tiltPin));
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p));
  return `<select id="${id}" aria-label="Tilt switch pin"><option value="255" ${c.tiltPin === PIN_NONE ? 'selected' : ''}>Not set</option>${free.map((p) => `<option value="${p}" ${p === c.tiltPin ? 'selected' : ''}>GP${p}</option>`).join('')}</select>`;
}
function buildTiltSwitch() {
  const c = state.cfg, body = $('#tiltSwBody');
  if (!body) return;
  body.innerHTML = `
    <div class="opt first"><div><h3>Tilt for star power</h3><p class="dim">A tilt switch wired to a free pin triggers star power when the neck is lifted.</p></div>
      <label class="switch"><input type="checkbox" id="tsOn" ${c.tiltEnabled ? 'checked' : ''}><i></i></label></div>
    ${c.tiltEnabled ? `<div class="opt"><div><h3>Switch pin</h3><p class="dim">Or use Setup to find it by tilting twice.</p></div>${tiltPinSelect('tsPin')}</div>
      ${tiltTypeHtml('tsType')}
      <div class="tilt-live" id="tsLive"><i></i><span id="tsLiveTxt">Tilt: not active</span><span class="dim small">Hold the guitar level, then tilt it up to check.</span></div>` : ''}`;
  $('#tsOn').onchange = (e) => { c.tiltEnabled = e.target.checked; if (!c.tiltEnabled) c.tiltPin = PIN_NONE; pushCfg(); buildTiltSwitch(); };
  $('#tsPin')?.addEventListener('change', (e) => { c.tiltPin = +e.target.value; pushCfg(); buildTiltSwitch(); });
  body.querySelectorAll('#tsType [data-inv]').forEach((b) => b.addEventListener('click', () => { c.tiltInvert = b.dataset.inv === '1'; pushCfg(); buildTiltSwitch(); }));
  if (state.status) updateTiltSwitch(state.status);
}
function updateTiltSwitch(s) {
  const live = $('#tsLive');
  if (!live) return;
  const on = tiltSwitchActive(s);
  live.classList.toggle('on', on);
  $('#tsLiveTxt').textContent = on ? 'Tilt: active' : 'Tilt: not active';
}

// live "Tilt: active" indicator on the setup step, plus a suggestion when it stays on while the guitar should be level
function tickTiltLive(s) {
  const live = $('#tiltLive');
  if (!live) return;
  const on = tiltSwitchActive(s);
  live.classList.toggle('on', on);
  $('#tiltLiveTxt').textContent = on ? 'Tilt: active' : 'Tilt: not active';
  const sug = $('#tiltSuggest');
  if (!sug || !fwAtLeast(33)) return;
  const now = performance.now();
  if (!on) { stepCtx.activeSince = 0; sug.hidden = true; return; }
  stepCtx.activeSince ||= now;
  if (now - stepCtx.activeSince > 1500) {
    $('#tiltSuggestTxt').textContent = state.cfg.tiltInvert ? 'Still active with the guitar level? This may be a normally open switch.' : 'Still active with the guitar level? This looks like a normally closed switch.';
    $('#tiltSuggestBtn').textContent = state.cfg.tiltInvert ? 'Switch to normally open' : 'Switch to normally closed';
    sug.hidden = false;
  }
}

function tickStep(s) {
  if (state.view !== 'setup' || !state.dev) return;
  const step = STEPS[state.step];
  bpTick(s);
  if (step.kind === 'buttons') {
    // live highlight of whichever tile's button is held right now
    document.querySelectorAll('.bt').forEach((t) => t.classList.toggle('held', isPressed(s, state.cfg.pins[+t.dataset.f])));
  } else if (step.kind === 'whammy' && stepCtx.cal) {
    const c = state.cfg;
    document.querySelectorAll('.adc-row').forEach((row) => {
      const v = s.adc[+row.dataset.ch];
      row.querySelector('i').style.width = ((v / 4095) * 100).toFixed(1) + '%';
      row.querySelector('.val').textContent = v;
      row.classList.toggle('sel', (stepCtx.done ? c.whammyCh : stepCtx.cal.ch) === +row.dataset.ch);
    });
    if (stepCtx.done) {
      const el = $('#wBar');
      if (el && c.whammyCh !== PIN_NONE) el.style.width = (whammyValue(s.adc[c.whammyCh], c) * 100).toFixed(1) + '%';
      return;
    }
    const p = stepCtx.cal.feed(s);
    $('#wBar').style.width = (p.fraction * 100).toFixed(0) + '%';
    $('#wLabel').textContent = p.channel < 0 ? 'Waiting for the bar to move' : `Sweeps: ${Math.min(2, Math.floor(p.switches / 2))} of 2, swing ${p.range} counts` + (p.range && p.range < 200 ? '. That is very small; a healthy whammy swings several hundred. Check that the outer legs of the pot go to 3V3(OUT) and GND.' : '');
    if (p.done) {
      const r = stepCtx.cal.result();
      Object.assign(c, { whammyCh: r.channel, whammyMin: r.min, whammyMax: r.max, whammyInvert: r.invert });
      pushCfg();
      stepCtx.done = true;
      setResult('ok', `Calibrated on <span class="chip">GP${26 + r.channel}</span> (${r.min}–${r.max}${r.invert ? ', inverted' : ''})`);
      $('#wLabel').textContent = 'Live input: move the bar to check it';
      const b = $('#bSkip'); if (b) { b.textContent = 'Continue'; b.classList.add('primary'); }
    }
  } else if (step.kind === 'ledmap' && stepCtx.assign && stepCtx.idx < stepCtx.chain) {
    if (!stepCtx.base) { stepCtx.base = s.counts.slice(); return; }
    if (performance.now() < stepCtx.lockUntil) { stepCtx.base = s.counts.slice(); return; }
    const lay = ledLayout(state.cfg);
    const hit = (pin) => pin !== PIN_NONE && diff8(s.counts[pin], stepCtx.base[pin]) >= 1;
    const next = () => { stepCtx.idx++; stepCtx.base = s.counts.slice(); stepCtx.lockUntil = performance.now() + 500; stepCtx.redraw(); };
    if (lay.strum && stepCtx.strumAssign.length < lay.strum && (hit(state.cfg.pins[5]) || hit(state.cfg.pins[6]))) {
      stepCtx.strumAssign.push(stepCtx.idx);    // a strum: this LED is the next strum LED
      next();
      return;
    }
    if (!lay.frets) return;
    for (let f = 0; f < NUM_FRETS; f++) {
      if (!hit(state.cfg.pins[f])) continue;
      if (stepCtx.assign[f] < 0) stepCtx.assign[f] = stepCtx.idx;
      else if (lay.per === 2 && stepCtx.assign2[f] < 0) stepCtx.assign2[f] = stepCtx.idx;
      else continue;
      next();
      break;
    }
  } else if (step.kind === 'tilt' && !stepCtx.active) {
    tickTiltLive(s);
  } else if (step.kind === 'tilt' && stepCtx.detector) {
    const r = stepCtx.detector.feed(s);
    if (!r) return;
    if (r.pin !== undefined) {
      state.cfg.tiltPin = r.pin; pushCfg(); stepCtx.active = false; renderStepList();
      stepCtx.rerender?.();
      toast('Tilt switch registered', 'ok');
    } else if (r.ambiguous) setResult('bad', 'Several inputs moved at once. Tilt only the guitar.');
    else if (r.used) setResult('bad', `<span class="chip">GP${r.used[0]}</span> is already used by another control.`);
  }
}

// ------------------------------------------------------------------ tune
function buildTune() {
  const c = state.cfg;
  const dt = $('#debT'), ws = $('#wSmooth'), wd = $('#wDead');
  const refresh = () => {
    $('#debTVal').textContent = (c.debounce100us / 10).toFixed(1) + ' ms';
    $('#wSmoothVal').textContent = c.whammySmooth === 0 ? 'off' : String(c.whammySmooth);
    $('#wDeadVal').textContent = c.whammyDeadzone + ' %';
    document.querySelectorAll('#debPresets [data-deb]').forEach((b) => b.classList.toggle('on', +b.dataset.deb === c.debounce100us));
  };
  dt.value = c.debounce100us; ws.value = c.whammySmooth; wd.value = c.whammyDeadzone;
  $('#combStrum').checked = c.combinedStrum; $('#wInv').checked = c.whammyInvert;
  const PRESETS = [['Off', 0], ['Fast', 20], ['Balanced', 50], ['Safe', 100], ['Worn switches', 200]];
  $('#debPresets').innerHTML = PRESETS.map(([n, v]) => `<button data-deb="${v}" title="${v / 10} ms">${n}</button>`).join('');
  const live = () => { refresh(); pushCfg(); };
  dt.oninput = () => { c.debounce100us = +dt.value; live(); };
  ws.oninput = () => { c.whammySmooth = +ws.value; live(); };
  wd.oninput = () => { c.whammyDeadzone = +wd.value; live(); };
  $('#combStrum').onchange = (e) => { c.combinedStrum = e.target.checked; live(); };
  $('#wInv').onchange = (e) => { c.whammyInvert = e.target.checked; live(); };
  $('#debPresets').onclick = (e) => { const b = e.target.closest('[data-deb]'); if (b) { c.debounce100us = +b.dataset.deb; dt.value = c.debounce100us; live(); } };
  $('#resetCfg').onclick = async () => {
    if (!confirm('Reset every setting (pins, whammy, tuning, lights and modes) to factory defaults?')) return;
    await state.dev.defaults(); await state.dev.save(); await sleep(300);
    state.cfg = await state.dev.getConfig(); state.step = 0; buildUi(); takeSnapshot(); toast('Reset to defaults', 'ok');
  };
  refresh();
  buildTiltSwitch();
  buildTilt();
  buildRumble();
}

// ------------------------------------------------------------------ console ports and Wii Remote (firmware 0.31+)
function buildPorts() {
  const c = state.cfg, body = $('#portsBody');
  if (!body) return;
  const fw31 = (c.cfgVersion ?? 0) >= 5 && (state.info.major > 0 || state.info.minor >= 31);
  $('#portsPanel').hidden = false;
  if (!fw31) { body.innerHTML = '<p class="notice small">Needs firmware 0.31 or newer. Update the firmware on the Install page.</p>'; return; }
  const others = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), ...accelPins(), c.rumblePin ?? PIN_NONE].filter((p) => p !== PIN_NONE));
  const PS2 = ['ATT', 'CMD', 'DAT', 'CLK', 'ACK'];
  const ps2 = c.ps2Pins || [255, 255, 255, 255, 255];
  const pinSel = (id, val, exclude) => `<select id="${id}"><option value="255">Not wired</option>${[...Array(NUM_DIGITAL_PINS).keys()]
    .filter((p) => !others.has(p) && (!exclude.has(p) || p === val)).map((p) => `<option value="${p}" ${p === val ? 'selected' : ''}>GP${p}</option>`).join('')}</select>`;
  const ps2Used = new Set([...ps2, c.wiiSda, c.wiiScl].filter((p) => p !== PIN_NONE));
  const accelBlock = c.accelSda !== PIN_NONE && c.accelSda !== undefined ? (c.accelSda >> 1) & 1 : -1;
  const wiiPairs = [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !(p & 1) && ((p >> 1) & 1) !== accelBlock &&
    ((!others.has(p) && !others.has(p + 1) && !ps2.includes(p) && !ps2.includes(p + 1)) || p === c.wiiSda));
  const ps2On = ps2.every((p) => p !== PIN_NONE), wiiOn = c.wiiSda !== PIN_NONE;
  const wiimote = !!(c.xinputOpts & 2);
  body.innerHTML = `
    <div class="cols">
      <div class="tilt-card">
        <div class="head"><h3>PS2 controller port</h3><span class="tilt-state" id="pPs2">${ps2On ? 'waiting' : 'off'}</span></div>
        <p class="dim small">A PS2 Guitar Hero guitar for Guitar Hero 1, 2, III and 80s on a stock PS2 (or a PS1). Cut a PS2 extension cable and wire its lines to five free pins; power the board from the cable's 3.6 V (pin 5) through a diode to VSYS. Not with the USB host port (both need PIO1).</p>
        <div class="ps2-grid">${PS2.map((n, i) => `<label>${n}${pinSel('ps2' + i, ps2[i], ps2Used)}</label>`).join('')}</div>
      </div>
      <div class="tilt-card">
        <div class="head"><h3>Wii extension</h3><span class="tilt-state" id="pWii">${wiiOn ? 'waiting' : 'off'}</span></div>
        <p class="dim small">The guitar acts as a Guitar Hero guitar <b>extension</b>: plug a Wii Remote's extension cable in, like the original Wii guitars. SDA and SCL of the extension plug to the pins below, its 3.3 V detect line to 3V3, GND to GND.</p>
        <label class="field-label">SDA / SCL</label>
        <select id="wiiPins"><option value="255">Not wired</option>${wiiPairs.map((p) => `<option value="${p}" ${p === c.wiiSda ? 'selected' : ''}>SDA GP${p}, SCL GP${p + 1}</option>`).join('')}</select>
      </div>
    </div>
    ${state.info.btSupported ? `
    <div class="opt" style="margin-top:12px"><div><h3>Wii Remote over Bluetooth <span class="tilt-state" id="pWm">${wiimote ? 'waiting' : 'off'}</span></h3>
      <p class="dim">The Pico W becomes a Wii Remote with a Guitar Hero guitar plugged in: Guitar Hero, Band Hero and DJ Hero on a stock Wii or Wii U, no Wii Remote needed. Press SYNC on the console; after that it reconnects by itself. Replaces the Bluetooth LE gamepad while on.</p></div>
      <label class="switch"><input type="checkbox" id="wmOn" ${wiimote ? 'checked' : ''}><i></i></label></div>` : ''}`;
  PS2.forEach((n, i) => { $('#ps2' + i).onchange = (e) => { c.ps2Pins = [...ps2]; c.ps2Pins[i] = +e.target.value; buildPorts(); }; });
  $('#wiiPins').onchange = (e) => { const p = +e.target.value; c.wiiSda = p; c.wiiScl = p === PIN_NONE ? PIN_NONE : p + 1; buildPorts(); };
  const wm = $('#wmOn');
  if (wm) wm.onchange = () => { c.xinputOpts = (c.xinputOpts & ~2) | (wm.checked ? 2 : 0); if (wm.checked) c.btEnabled = true; buildPorts(); };
}
function updatePorts(s) {
  const set = (id, on, txt) => { const el = $(id); if (el && el.textContent !== 'off') { el.textContent = on ? txt : 'waiting'; el.classList.toggle('on', on); } };
  set('#pPs2', !!(s.ports & 1), 'PS2 connected');
  set('#pWii', !!(s.ports & 2), 'Wii Remote connected');
  set('#pWm', !!(s.ports & 4), 'Wii connected');
}

// ------------------------------------------------------------------ rumble (firmware 0.30+)
function buildRumble() {
  const c = state.cfg, body = $('#rumbleBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5 || !(state.info.major > 0 || state.info.minor >= 30)) {
    body.innerHTML = '<p class="notice small">Rumble needs firmware 0.30 or newer. Update the firmware on the Install page.</p>';
    return;
  }
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), ...accelPins()].filter((p) => p !== PIN_NONE));
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !taken.has(p) || p === c.rumblePin);
  const on = c.rumblePin !== PIN_NONE;
  const sw = (bit, title, desc) => `<div class="opt"><div><h3>${title}</h3><p class="dim">${desc}</p></div>
    <label class="switch"><input type="checkbox" data-bit="${bit}" ${c.rumbleFlags & bit ? 'checked' : ''}><i></i></label></div>`;
  body.innerHTML = `
    <div class="opt first"><div><h3>Motor pin</h3><p class="dim">Drives the transistor's base (through about 1 kΩ) or the MOSFET's gate.</p></div>
      <div class="row"><select id="rmPin"><option value="255">None</option>${free.map((p) => `<option value="${p}">GP${p}</option>`).join('')}</select>
      ${on ? '<button class="btn small" id="rmTest">Test</button>' : ''}</div></div>
    ${on ? `
    <div class="slider-row"><label for="rmStr">Strength</label><output class="val" id="rmStrV">${c.rumbleStrength} %</output><input type="range" id="rmStr" min="10" max="100" step="5" value="${c.rumbleStrength}"></div>
    ${sw(1, 'Game rumble', 'Follow the rumble games send. On a guitar, Clone Hero and YARG use the rumble channel for stage kit and star power messages: those are recognised and left out.')}
    ${sw(2, 'Buzz on star power', 'A short buzz when star power / overdrive starts, in games that report it (YARG, Clone Hero, RB3 Enhanced over XInput).')}
    ${sw(4, 'Buzz on a missed note', 'A tap when a note is missed, in games that report it.')}` : ''}`;
  const live = () => { pushCfg(); };
  const sel = $('#rmPin');
  sel.value = String(c.rumblePin ?? PIN_NONE);
  sel.onchange = () => { c.rumblePin = +sel.value; live(); buildRumble(); };
  const st = $('#rmStr');
  if (st) st.oninput = () => { c.rumbleStrength = +st.value; $('#rmStrV').textContent = c.rumbleStrength + ' %'; live(); };
  body.querySelectorAll('[data-bit]').forEach((cb) => (cb.onchange = () => { const b = +cb.dataset.bit; c.rumbleFlags = cb.checked ? c.rumbleFlags | b : c.rumbleFlags & ~b; live(); }));
  const t = $('#rmTest');
  if (t) t.onclick = async () => { try { await state.dev.setConfig(c); await state.dev.rumbleTest(500); } catch (e) { toast('Rumble test failed: ' + e.message, 'bad'); } };
}

// ------------------------------------------------------------------ tilt sensors (firmware 0.29+)
// Live state of the two sensors, with the firmware's star power hysteresis (4 %)
const tiltOn = [false, false];
function tiltStates(s) {
  const c = state.cfg;
  if (!c?.atilt || (c.cfgVersion ?? 0) < 5) return [];
  return c.atilt.map((t, i) => {
    const raw = tiltSourceRaw(s, t.src);
    const value = tiltValue(raw, t);
    if (value == null) { tiltOn[i] = false; return { raw, value: null, whammy: false, star: false }; }
    if (t.target === 1) {
      const on = t.threshold / 100, off = on - 0.04;
      tiltOn[i] = tiltOn[i] ? value > off : value >= on;
    } else tiltOn[i] = false;
    const v = t.target === 0 && value < c.whammyDeadzone / 100 ? 0 : value;
    return { raw, value: v, whammy: t.target === 0, star: tiltOn[i] };
  });
}

// Quick setup: raw captures live here, never in cfg
const qt = { target: 1, chosen: false, chip: 0, level: null, tilted: null };
let qtSlot = -1, tiltKey = '';
const isAxisSrc = (src) => (src >= 3 && src <= 5) || (src >= 9 && src <= 11);
const axisIdx = (src) => (src >= 9 ? src - 9 : src - 3);
const quickSlotFor = (c, target) => c.atilt.findIndex((t) => isAxisSrc(t.src) && t.target === target);
const accStatusText = (s, on) => !on ? 'Pick the pins your accelerometer is wired to.'
  : !s?.accelType ? 'Looking for the accelerometer… check the wiring (SDA/SCL, power, CS to 3V3).'
  : '✓ ' + (ACCEL_TYPES[s.accelType] || 'Accelerometer') + ' found';
const tiltStateText = (src, t) => src === PIN_NONE ? 'off' : t.value == null ? (t.raw == null ? 'no reading' : 'calibrate') : t.whammy ? 'whammy ' + Math.round(t.value * 100) + ' %' : t.star ? 'STAR POWER' : 'level';
const tiltKeyOf = (s) => `${!!s?.accelType}|${!!s?.accel2Type}`;

function buildTilt() {
  const c = state.cfg, body = $('#tiltBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5) {
    body.innerHTML = '<p class="notice small">Tilt sensors need firmware 0.29 or newer. Update the firmware on the Install page.</p>';
    return;
  }
  const own = new Set(accelPins());
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), c.rumblePin ?? PIN_NONE].filter((p) => p !== PIN_NONE && !own.has(p)));
  const pairs = [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !(p & 1) && i2cPinsOk(p, p + 1) && !taken.has(p) && !taken.has(p + 1));
  const accelOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const two = fwAtLeast(ACCEL2_MIN_MINOR);   // firmware 0.36+ finds a second accelerometer on the same bus
  const srcOpts = (i) => {
    const other = c.atilt[1 - i].src;
    return '<option value="255">Off</option>' + ATILT_SOURCES.map((s) => {
      const busy = (s.kind === 'adc' && s.id === c.whammyCh) || (s.id === other && other !== PIN_NONE);
      const needs = (s.kind !== 'adc' && !accelOn) || (s.kind === 'accel2' && !two);
      if (needs && c.atilt[i].src !== s.id) return '';
      const name = two && s.kind === 'accel' ? s.name.replace('Accelerometer', 'Accelerometer 1') : s.name;
      const note = s.id === c.whammyCh ? ' (whammy bar)' : s.id === other ? ' (other sensor)' : s.kind === 'lis' ? ' (LIS3DH only)' : '';
      return `<option value="${s.id}" ${busy ? 'disabled' : ''}>${name}${note}</option>`;
    }).join('');
  };
  const restOf = (t) => (t.invert ? t.max : t.min), tiltOf = (t) => (t.invert ? t.min : t.max);
  // ---- quick setup state
  const st0 = state.status;
  tiltKey = tiltKeyOf(st0);
  const found = accelOn && !!st0?.accelType;
  const found2 = found && two && !!st0.accel2Type;
  if (!qt.chosen) {
    if (quickSlotFor(c, 1) >= 0) qt.target = 1; else if (quickSlotFor(c, 0) >= 0) qt.target = 0;
  }
  if (!found2) qt.chip = 0;
  qtSlot = found ? quickSlotFor(c, qt.target) : -1;
  const stage = qtSlot >= 0 ? 'result' : qt.level ? 'tilted' : 'level';
  const qs = qtSlot >= 0 ? c.atilt[qtSlot] : null;
  const qsChip = qs ? (qs.src >= 9 ? 2 : 1) : 0;
  const quick = !found ? '' : `
    <div class="tilt-quick" id="tiltQuick">
      <h3>Guided setup</h3>
      <ol class="tilt-steps">
        <li class="done"><span class="n">✓</span><div><b>What should tilting do?</b>
          <div class="seg" role="group" aria-label="What should tilting do"><button data-qt="1" class="${qt.target === 1 ? 'on' : ''}">Star power</button><button data-qt="0" class="${qt.target === 0 ? 'on' : ''}">Whammy</button></div>
          ${found2 ? `<div class="dim small">Which sensor?</div><div class="seg" role="group" aria-label="Which sensor"><button data-qc="0" class="${qt.chip === 0 ? 'on' : ''}">Chip 1</button><button data-qc="1" class="${qt.chip === 1 ? 'on' : ''}">Chip 2</button></div>` : ''}
        </div></li>
        <li class="${stage === 'result' || qt.level ? 'done' : 'active'}"><span class="n">${stage === 'result' || qt.level ? '✓' : '2'}</span><div><b>Hold the guitar level, the way you play</b>
          ${stage === 'result' ? '' : '<div><button class="btn small" id="qCapLevel">Capture level</button></div>'}</div></li>
        <li class="${stage === 'result' ? 'done' : qt.level ? 'active' : ''}"><span class="n">${stage === 'result' ? '✓' : '3'}</span><div><b>Tilt the neck up, like you would for star power</b>
          ${stage === 'result' ? '' : `<div><button class="btn small" id="qCapTilt" ${qt.level ? '' : 'disabled'}>Capture tilted</button></div>`}</div></li>
        ${stage === 'result' ? `
        <li class="done"><span class="n">✓</span><div>
          <b>Done. ${qt.target === 1 ? 'Tilt the neck to try star power.' : 'Tilt the guitar to move the whammy.'}</b>
          <div class="tilt-meter"><div class="bar" id="qBar"><i></i></div>${qt.target === 1 ? `<span class="thr" id="qThrMark" style="left:${qs.threshold}%"></span>` : ''}</div>
          <div class="tilt-readout"><span><span class="tilt-state" id="qSt">–</span></span><span id="qUsing">Using Accelerometer${found2 || qsChip === 2 ? ' ' + qsChip : ''} ${'XYZ'[axisIdx(qs.src)]} axis.</span></div>
          ${qt.target === 1 ? `<div class="slider-row"><label for="qThr">Star power at</label><output class="val" id="qThrV">${qs.threshold} %</output><input type="range" id="qThr" min="5" max="95" step="1" value="${qs.threshold}"></div>` : '<p class="dim small">Adds to the whammy bar: whichever is further wins.</p>'}
          <div><button class="btn small" id="qRedo">Redo</button></div>
        </div></li>` : ''}
      </ol>
      ${stage === 'result' ? '' : `<div class="tilt-axes" aria-label="Live reading">${['X', 'Y', 'Z'].map((a, i) => `<div>${a} <span id="qV${i}">–</span><div class="bar"><i id="qB${i}"></i></div></div>`).join('')}</div>`}
    </div>`;
  body.innerHTML = `
    <div class="tilt-accel">
      <div class="opt first"><div><h3>Accelerometer</h3><p class="dim">I²C module: SDA on the even pin, SCL on the next one, VCC to 3V3(OUT), GND to GND.</p></div>
        <select id="accPins"><option value="255">None</option>${pairs.map((p) => `<option value="${p}">SDA GP${p}, SCL GP${p + 1}</option>`).join('')}</select></div>
      <p class="acc-status" id="accStatus" role="status"></p>
      ${quick}
      ${found ? '<p class="dim small" style="margin:12px 0 0">Or set everything by hand below.</p>' : ''}
      <p class="dim small" style="margin:6px 0 0" id="accTwoHint">Two accelerometers: wire both to the same SDA / SCL / 3V3 / GND; give the second a different address (ADXL345: SDO to 3V3 → 0x1D, the first SDO to GND → 0x53; LIS3DH: SA0/SDO high → 0x19; MPU-6050: AD0 high → 0x69).${two ? '' : ' Needs firmware 0.36 or newer.'}</p>
      ${accelOn ? `
      <div class="tilt-readout" style="margin-top:8px"><span>${two ? 'Chip 1' : 'Chip'}: <b id="accType">looking…</b>${two ? ' · Chip 2: <b id="acc2Type">looking…</b>' : ''}</span><span class="dim">1 g = 1024 counts, 2048 = level</span></div>
      ${two ? '<p class="dim small" id="acc2Hint" hidden>Chip 2: not found. Wire its SDO to 3V3 for address 0x1D (ADXL345), SA0 high for 0x19 (LIS3DH) or AD0 high for 0x69 (MPU-6050).</p>' : ''}
      <div class="tilt-axes">${['X', 'Y', 'Z'].map((a, i) => `<div>${two ? '1 ' : ''}${a} <span id="accV${i}">–</span><div class="bar"><i id="accB${i}"></i></div></div>`).join('')}</div>
      ${two ? `<div class="tilt-axes" id="acc2Axes" style="margin-top:6px">${['X', 'Y', 'Z'].map((a, i) => `<div>2 ${a} <span id="acc2V${i}">–</span><div class="bar"><i id="acc2B${i}"></i></div></div>`).join('')}</div>` : ''}
      <div class="cols" style="margin-top:6px">
        <div>
          <div class="slider-row"><label for="accLp">Low pass</label><output class="val" id="accLpV"></output><input type="range" id="accLp" min="0" max="50" step="1"></div>
          <div class="slider-row"><label for="accMed">Median</label><output class="val" id="accMedV"></output><input type="range" id="accMed" min="0" max="4" step="1"></div>
        </div>
        <div>
          <div class="slider-row"><label for="accGate">Gravity gate</label><output class="val" id="accGateV"></output><input type="range" id="accGate" min="0" max="50" step="1"></div>
          <p class="dim small">Low pass smooths the reading, the median drops single spikes, and the gravity gate ignores moments when the guitar is being shaken (a hard strum) instead of tilted. Each is off at 0, as in Santroller.</p>
        </div>
      </div>` : ''}
    </div>
    <div class="cols tilt-sensors">${c.atilt.map((t, i) => `
      <div class="tilt-card" data-i="${i}">
        <div class="head"><h3>Sensor ${i + 1}</h3><span class="tilt-state" id="tSt${i}">off</span></div>
        <div class="opt first"><div><p class="dim">Reads from</p></div><select data-k="src">${srcOpts(i)}</select></div>
        ${t.src !== PIN_NONE ? `
        <div class="seg" role="group" aria-label="Sensor ${i + 1} use"><button data-k="target" data-v="0" class="${t.target === 0 ? 'on' : ''}">Whammy</button><button data-k="target" data-v="1" class="${t.target === 1 ? 'on' : ''}">Star power</button></div>
        <div class="tilt-meter"><div class="bar" id="tBar${i}"><i></i></div>${t.target === 1 ? `<span class="thr" style="left:${t.threshold}%"></span>` : ''}</div>
        <div class="tilt-readout"><span>reading <b id="tRaw${i}">–</b></span><span>rest ${restOf(t)} · tilted ${tiltOf(t)}</span></div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn small" data-cap="rest">Set rest (guitar level)</button><button class="btn small" data-cap="tilt">Set tilted (neck up)</button></div>
        ${t.target === 1 ? `<div class="slider-row"><label>Star power at</label><output class="val">${t.threshold} %</output><input type="range" data-k="threshold" min="5" max="95" step="1" value="${t.threshold}"></div>`
          : '<p class="dim small" style="margin-top:8px">Adds to the whammy bar: whichever is further wins. The whammy dead zone above applies.</p>'}` : ''}
      </div>`).join('')}
    </div>`;
  const live = () => { pushCfg(); };
  const sel = $('#accPins');
  sel.value = String(accelOn ? c.accelSda : PIN_NONE);
  sel.onchange = () => {
    const p = +sel.value;
    c.accelSda = p; c.accelScl = p === PIN_NONE ? PIN_NONE : p + 1;
    if (p === PIN_NONE) c.atilt.forEach((t) => { if (t.src >= 3) t.src = PIN_NONE; });
    live(); buildTilt();
  };
  if (accelOn) {
    const lp = $('#accLp'), md = $('#accMed'), gt = $('#accGate');
    const MED = [0, 3, 5, 7, 9];
    const show = () => {
      $('#accLpV').textContent = c.accelLowpass ? c.accelLowpass + ' Hz' : 'off';
      $('#accMedV').textContent = c.accelMedian ? c.accelMedian + ' samples' : 'off';
      $('#accGateV').textContent = c.accelGate ? '±' + (c.accelGate / 100).toFixed(2) + ' g' : 'off';
    };
    lp.value = c.accelLowpass; md.value = Math.max(0, MED.indexOf(c.accelMedian)); gt.value = c.accelGate;
    lp.oninput = () => { c.accelLowpass = +lp.value; show(); live(); };
    md.oninput = () => { c.accelMedian = MED[+md.value]; show(); live(); };
    gt.oninput = () => { c.accelGate = +gt.value; show(); live(); };
    show();
  }
  body.querySelectorAll('.tilt-card').forEach((card) => {
    const i = +card.dataset.i, t = c.atilt[i];
    const s = card.querySelector('select[data-k="src"]');
    s.value = String(t.src);
    s.onchange = () => { t.src = +s.value; live(); buildTilt(); };
    card.querySelectorAll('button[data-k="target"]').forEach((b) => (b.onclick = () => { t.target = +b.dataset.v; live(); buildTilt(); }));
    const th = card.querySelector('input[data-k="threshold"]');
    if (th) th.oninput = () => { t.threshold = +th.value; th.previousElementSibling.textContent = t.threshold + ' %'; card.querySelector('.thr').style.left = t.threshold + '%'; live(); };
    card.querySelectorAll('[data-cap]').forEach((b) => (b.onclick = () => {
      const raw = tiltSourceRaw(state.status, t.src);
      if (raw == null) { toast('No reading from this sensor yet. Check the wiring' + (t.src >= 3 ? ' and that the accelerometer was found.' : '.'), 'bad'); return; }
      let rest = restOf(t), tilted = tiltOf(t);
      if (b.dataset.cap === 'rest') rest = raw; else tilted = raw;
      Object.assign(t, { min: Math.min(rest, tilted), max: Math.max(rest, tilted), invert: rest > tilted });
      if (t.max - t.min < 8) toast('Rest and tilted read almost the same. Tilt further before setting the other end.', 'bad');
      live(); buildTilt();
    }));
  });
  // ---- quick setup handlers
  const chipRaw = (st, chip) => { const r = chip ? st?.accel2Raw : st?.accelRaw; return r && r.slice(0, 3).every((v) => v !== undefined && v !== 0xffff) ? r.slice(0, 3) : null; };
  body.querySelectorAll('[data-qt]').forEach((b) => (b.onclick = () => { qt.target = +b.dataset.qt; qt.chosen = true; buildTilt(); }));
  body.querySelectorAll('[data-qc]').forEach((b) => (b.onclick = () => { qt.chip = +b.dataset.qc; qt.level = qt.tilted = null; buildTilt(); }));
  const capL = $('#qCapLevel'), capT = $('#qCapTilt');
  const grab = () => { const r = chipRaw(state.status, qt.chip); if (!r) toast('No reading from the accelerometer yet. Check the wiring.', 'bad'); return r; };
  if (capL) capL.onclick = () => { const r = grab(); if (!r) return; qt.level = r; qt.tilted = null; buildTilt(); };
  if (capT) capT.onclick = () => {
    const r = grab(); if (!r || !qt.level) return;
    qt.tilted = r;
    const diff = r.map((v, i) => Math.abs(v - qt.level[i]));
    const ax = diff.indexOf(Math.max(...diff));
    if (diff[ax] < 100) { qt.tilted = null; toast('Barely moved. Tilt the neck further and capture again.', 'bad'); buildTilt(); return; }
    const want = qt.target, srcId = (qt.chip ? 9 : 3) + ax;
    let slot = c.atilt.findIndex((t) => t.target === want && t.src !== PIN_NONE);
    if (slot < 0) slot = c.atilt.findIndex((t) => t.src === PIN_NONE);
    if (slot < 0) slot = 0;
    const lv = qt.level[ax], tl = r[ax];
    Object.assign(c.atilt[slot], { src: srcId, target: want, min: Math.min(lv, tl), max: Math.max(lv, tl), invert: lv > tl });
    if (want === 1) c.atilt[slot].threshold = 50;
    qt.level = qt.tilted = null;
    live(); buildTilt();
  };
  const redo = $('#qRedo');
  if (redo) redo.onclick = () => { qt.level = qt.tilted = null; if (qtSlot >= 0) c.atilt[qtSlot].src = PIN_NONE; live(); buildTilt(); };
  const qthr = $('#qThr');
  if (qthr) {
    qthr.oninput = () => { const t = c.atilt[qtSlot]; t.threshold = +qthr.value; $('#qThrV').textContent = t.threshold + ' %'; $('#qThrMark').style.left = t.threshold + '%'; live(); };
    qthr.onchange = () => buildTilt();   // refresh the fine-tune card too
  }
  if (state.status) updateTilt(state.status);
}

function updateTilt(s) {
  const c = state.cfg;
  if (!c?.atilt || (c.cfgVersion ?? 0) < 5 || !$('#tiltBody')) return;
  if ($('#accPins') && tiltKeyOf(s) !== tiltKey) { buildTilt(); return; }   // chip found / lost: quick setup appears or goes
  const accOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const stEl = $('#accStatus');
  if (stEl) { stEl.textContent = accStatusText(s, accOn); stEl.classList.toggle('ok', accOn && !!s.accelType); }
  if ($('#qV0')) {
    const r = qt.chip ? s.accel2Raw : s.accelRaw;
    for (let i = 0; i < 3; i++) {
      const v = r?.[i], ok = v !== undefined && v !== 0xffff;
      $('#qV' + i).textContent = ok ? ((v - 2048) / 1024).toFixed(2) + ' g' : '–';
      $('#qB' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  const ty = $('#accType');
  if (ty) {
    ty.textContent = s.accelType ? ACCEL_TYPES[s.accelType] || 'unknown' : 'none found, check the wiring';
    for (let i = 0; i < 3; i++) {
      const v = s.accelRaw[i], ok = v !== 0xffff;
      $('#accV' + i).textContent = ok ? ((v - 2048) / 1024).toFixed(2) + ' g' : '–';
      $('#accB' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  const ty2 = $('#acc2Type');
  if (ty2) {
    ty2.textContent = s.accel2Type ? ACCEL_TYPES[s.accel2Type] || 'unknown' : 'not found';
    const hint = $('#acc2Hint');
    if (hint) hint.hidden = !!s.accel2Type || !s.accelType;   // only once chip 1 is up: chip 2 is searched after it
    for (let i = 0; i < 3; i++) {
      const v = s.accel2Raw[i], ok = v !== 0xffff;
      $('#acc2V' + i).textContent = ok ? ((v - 2048) / 1024).toFixed(2) + ' g' : '–';
      $('#acc2B' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  const sts = tiltStates(s);
  const qSt = $('#qSt'), qBar = $('#qBar');
  if (qSt && qtSlot >= 0 && sts[qtSlot]) {
    const t = sts[qtSlot];
    qSt.textContent = tiltStateText(c.atilt[qtSlot].src, t);
    qSt.classList.toggle('on', !!t.star || (t.whammy && t.value > 0));
    if (qBar) { qBar.firstElementChild.style.width = ((t.value ?? 0) * 100).toFixed(1) + '%'; qBar.classList.toggle('on', !!t.star); }
  }
  sts.forEach((t, i) => {
    const st = $('#tSt' + i), bar = $('#tBar' + i), raw = $('#tRaw' + i);
    if (!st) return;
    const src = c.atilt[i].src;
    st.textContent = tiltStateText(src, t);
    st.classList.toggle('on', !!t.star || (t.whammy && t.value > 0));
    if (raw) raw.textContent = t.raw ?? '–';
    if (bar) { bar.firstElementChild.style.width = ((t.value ?? 0) * 100).toFixed(1) + '%'; bar.classList.toggle('on', !!t.star); }
  });
}

// ------------------------------------------------------------------ backup & restore
function buildBackup() {
  const box = $('#bkRestore');
  box.innerHTML = '';
  $('#bkSave').onclick = () => {
    download(backupFileName(state.info), JSON.stringify(makeBackup(state.cfg, state.info), null, 2));
    toast('Backup downloaded', 'ok');
  };
  const pickLabel = document.querySelector('label[for=bkFile]');
  pickLabel.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#bkFile').click(); } };
  $('#bkFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try { parsed = readBackup(await file.text()); } catch (err) { toast(err.message, 'bad'); return; }
    const when = parsed.meta.created ? new Date(parsed.meta.created).toLocaleString() : 'unknown date';
    box.innerHTML = `<p class="bk-meta">${file.name}: made ${when}${parsed.meta.board ? ` on a ${parsed.meta.board}` : ''}${parsed.meta.firmware ? `, firmware <b>v${parsed.meta.firmware}</b>` : ''}. Choose what to restore.</p>
      <div class="choice-list" id="bkSections">${SECTIONS.map((sec) => {
        const has = !!parsed.sections[sec.id];
        return `<label class="${has ? '' : 'off'}"><input type="checkbox" value="${sec.id}" ${has ? 'checked' : 'disabled'}><div><b>${sec.name}</b><span class="dim">${has ? sec.desc : 'Not in this backup'}</span></div></label>`;
      }).join('')}</div>
      ${parsed.skipped.length ? `<p class="dim small">Some values were not valid and will be left as they are: ${parsed.skipped.join(', ')}.</p>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn quiet" id="bkCancel">Cancel</button><button class="btn primary" id="bkApply">Restore and save</button></div>`;
    $('#bkCancel').onclick = () => { box.innerHTML = ''; };
    $('#bkApply').onclick = async () => {
      const chosen = [...box.querySelectorAll('#bkSections input:checked')].map((i) => i.value);
      if (!chosen.length) { toast('Pick at least one section to restore.'); return; }
      try {
        state.cfg = applyBackup(state.cfg, parsed, chosen);
        await state.dev.setConfig(state.cfg);
        await state.dev.save();
        await sleep(400);
        state.cfg = await state.dev.getConfig();
        buildUi(); takeSnapshot();
        toast(`Restored ${chosen.length === SECTIONS.length ? 'all settings' : chosen.map((id) => SECTIONS.find((x) => x.id === id).name.toLowerCase()).join(', ')} and saved to the controller`, 'ok');
      } catch (err) { toast('Restore failed: ' + err.message, 'bad'); }
    };
  };
}

// ------------------------------------------------------------------ lights
function liveWhammy(s, cfg = state.cfg) {
  const ts = tiltStates(s);
  return Math.max(cfg.whammyCh !== PIN_NONE ? whammyValue(s.adc[cfg.whammyCh], cfg) : 0, ...ts.map((t) => (t.whammy ? t.value : 0)));
}
// colours of the LED order chips follow the config
function refreshChain() {
  const c = state.cfg;
  document.querySelectorAll('#mapView .led').forEach((el) => {
    const col = el.dataset.fret !== undefined ? c.colors[+el.dataset.fret] : c.zoneStrum?.perLed ? c.strumLedColors[+el.dataset.strum] : c.strumColor;
    el.style.setProperty('--c', col); el.querySelector('b').style.background = col;
  });
}
function applyColors() {
  const cols = state.cfg.rgbEnabled ? state.cfg.colors : FRET_DEFAULT_COLORS;
  for (const v of viewers) v.g.setFretColors(cols);
}

function updateLedPreview(s) {
  const c = state.cfg;
  if (!c) return;
  const up = isPressed(s, c.pins[5]), down = isPressed(s, c.pins[6]);
  document.querySelectorAll('#mapView .led').forEach((el) => {
    if (el.dataset.strum !== undefined) {
      const role = c.strumRoles[+el.dataset.strum] || 0;
      el.classList.toggle('on', role === 1 ? up : role === 2 ? down : up || down);
      return;
    }
    el.classList.toggle('on', isPressed(s, c.pins[+el.dataset.fret]));
  });
}

// why the brightness slider stops short of 255
function brightNote(c) {
  const m = maxBrightness(c);
  if (m === 255) return '';
  const two = c.fretLeds === 2 && !c.noFretLeds;
  const what = c.noFretLeds ? 'strum LEDs only' : !c.strumLeds ? 'two LEDs under each fret' : two ? 'two LEDs per fret and strum LEDs' : 'fret and strum LEDs together';
  return `<p class="dim small">Brightness is limited to ${m} with ${what}, to keep the current the LED chain draws in check.</p>`;
}
// LED layout controls (setup wizard and Lights page): fret LEDs on / off, how many strum LEDs, wiring order
const STRUM_COUNTS = ['None', '1', '2 (1 per side)', '3', '4 (corners)', '5', '6', '7', '8 (4 per side)'];
function ledLayoutControls(c, pfx = 'lay') {
  const l = ledLayout(c);
  const v6 = (c.cfgVersion ?? 0) >= 6;
  return `<div class="opt"><div><h3>Fret LEDs</h3><p class="dim">LEDs under the five frets.</p></div>
      <label class="switch"><input type="checkbox" id="${pfx}Frets" ${l.frets ? 'checked' : ''}><i></i></label></div>
    ${l.frets && v6 ? `<div class="opt"><div><h3>LEDs per fret</h3><p class="dim">Two under each fret light together, in the fret's colour.</p></div>
      <select id="${pfx}Per"><option value="1" ${l.per === 1 ? 'selected' : ''}>One</option><option value="2" ${l.per === 2 ? 'selected' : ''}>Two</option></select></div>` : ''}
    <div class="opt"><div><h3>Strum bar LEDs</h3><p class="dim">LEDs on the strum bar, on the same chain. They light up when you strum.</p></div>
      <select id="${pfx}Strum">${STRUM_COUNTS.map((t, n) => `<option value="${n}" ${n === l.strum ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${l.frets && l.strum ? `<div class="opt"><div><h3>Wiring order</h3><p class="dim">Which LEDs come first on the chain, starting from the data pin.</p></div>
      <select id="${pfx}Order"><option value="0" ${!l.strumFirst ? 'selected' : ''}>Frets first</option><option value="1" ${l.strumFirst ? 'selected' : ''}>Strum LEDs first</option></select></div>` : ''}
    ${!l.frets && !l.strum ? '<p class="dim small">Choose fret LEDs, strum LEDs or both.</p>' : ''}`;
}
function wireLedLayout(c, changed, pfx = 'lay') {
  const set = (patch) => { const l = ledLayout(c); applyLedLayout(c, { frets: l.frets, strum: l.strum, strumFirst: l.strumFirst, per: l.per, ...patch }); changed(); };
  $(`#${pfx}Frets`)?.addEventListener('change', (e) => set({ frets: e.target.checked }));
  $(`#${pfx}Strum`)?.addEventListener('change', (e) => set({ strum: +e.target.value }));
  $(`#${pfx}Order`)?.addEventListener('change', (e) => set({ strumFirst: e.target.value === '1' }));
  $(`#${pfx}Per`)?.addEventListener('change', (e) => set({ per: +e.target.value }));
}
// chain position -> what sits there
function chainLabels(c) {
  const l = ledLayout(c);
  return [...Array(l.chain).keys()].map((p) => {
    let f = l.frets ? c.ledMap.indexOf(p) : -1;
    if (f < 0 && l.frets && l.per === 2) f = (c.ledMap2 || []).indexOf(p);
    if (f >= 0) return { fret: f, color: c.colors[f], name: funcName(f) };
    const k = c.strumMap.slice(0, l.strum).indexOf(p);
    return { strum: k, color: c.strumColor || '#ffffff', name: `Strum ${k + 1}` };
  });
}

// ------------------------------------------------------------------ LED setup helpers (guided step, ledmap step, Lights page)
const fwApaOk = () => !!state.info && (state.info.major > 0 || state.info.minor >= 32);   // APA102 at 4 MHz + the SK9822 fix
const LED_SHORT = ['WS2812B', 'SK6812 RGBW', 'APA102 / SK9822'];
const LED_PICKS = [
  { t: 0, name: 'WS2812B / NeoPixel', wires: '3 wires: 5V, GND, DIN', note: 'The most common' },
  { t: 1, name: 'SK6812 RGBW', wires: '3 wires: 5V, GND, DIN', note: 'Has an extra white LED' },
  { t: 2, name: 'APA102 / SK9822 / DotStar', wires: '4 wires: 5V, GND, DI, CI', note: 'Often used in Santroller builds' },
];
// tiny picture of the pads at the end of a strip, so the user can match it to what they soldered
function ledSvg(t) {
  const pads = t === 2 ? ['5V', 'DI', 'CI', 'GND'] : ['5V', 'DIN', 'GND'];
  const xs = t === 2 ? [18, 50, 82, 114] : [22, 66, 110];
  const dots = t === 1 ? ['#ff4d4d', '#3ddc84', '#4d8dff', '#ffffff'] : ['#ff4d4d', '#3ddc84', '#4d8dff'];
  return `<svg viewBox="0 0 132 52" aria-hidden="true"><rect x="2" y="14" width="128" height="34" rx="5" fill="none" stroke="currentColor" opacity=".35"/>
    ${pads.map((p, i) => `<rect x="${xs[i] - 6}" y="18" width="12" height="7" rx="1.5" fill="#d9a441"/><text x="${xs[i]}" y="11" text-anchor="middle" font-size="9" font-family="monospace" fill="currentColor">${p}</text>`).join('')}
    <rect x="48" y="30" width="36" height="14" rx="3" fill="#2a3144" stroke="currentColor" opacity=".9"/>
    ${dots.map((d, i) => `<circle cx="${66 + (i - (dots.length - 1) / 2) * 8}" cy="37" r="2.6" fill="${d}"/>`).join('')}</svg>`;
}
function ledTypeCards(c) {
  return `<div class="led-cards" role="group" aria-label="LED type">${LED_PICKS.map((p) => `<button type="button" class="led-card ${c.ledType === p.t ? 'sel' : ''}" data-ledtype="${p.t}" aria-pressed="${c.ledType === p.t}">
    ${ledSvg(p.t)}<b>${p.name}</b><span class="dim">${p.wires}</span><span class="tag">${p.note}</span></button>`).join('')}</div>`;
}
function wireLedTypeCards(root, c, changed) {
  root.querySelectorAll('[data-ledtype]').forEach((b) => b.addEventListener('click', () => {
    c.ledType = +b.dataset.ledtype;
    if (c.ledType !== 2) c.ledClkPin = PIN_NONE;   // only APA102 uses it; free the pin again
    changed();
  }));
}
// what the firmware needs before any LED can light, in the order a user should fix it
function ledChecks(c) {
  const apa = c.ledType === 2, chain = ledLayout(c).chain;
  const r = [
    { ok: c.rgbEnabled, text: 'LEDs are switched on', bad: 'LEDs are switched off', why: 'the LEDs are switched off' },
    { ok: c.rgbPin !== PIN_NONE, text: `Data pin chosen (GP${c.rgbPin})`, bad: 'No data pin chosen', why: 'no data pin is chosen' },
  ];
  if (apa) r.push({ ok: c.ledClkPin !== PIN_NONE && c.ledClkPin !== c.rgbPin, text: `Clock pin chosen (GP${c.ledClkPin})`, bad: c.ledClkPin === c.rgbPin && c.ledClkPin !== PIN_NONE ? 'Clock pin is the same as the data pin' : 'No clock pin chosen (APA102 LEDs stay dark without it)', why: 'APA102 LEDs need a clock pin as well' });
  r.push({ ok: chain > 0, text: `${chain} LED${chain === 1 ? '' : 's'} in the layout`, bad: 'No LEDs in the layout (choose fret and / or strum LEDs)', why: 'no fret or strum LEDs are chosen in the layout' });
  r.push({ ok: c.rgbBrightness > 0, text: `Brightness is ${c.rgbBrightness}`, bad: 'Brightness is 0, which is dark', why: 'the brightness is 0' });
  if (apa) r.push({ ok: fwApaOk(), text: 'Firmware supports APA102', bad: `Firmware v${state.info?.major}.${state.info?.minor} is too old for APA102 (needs 0.32+)`, why: 'the firmware is too old for APA102 LEDs', update: true });
  return r;
}
// one sentence for why the LEDs are dark right now, or '' when the settings are fine
const ledWhyDark = (c) => { const b = ledChecks(c).find((k) => !k.ok); return b ? b.why : ''; };
// reusable troubleshooting panel; `open` keeps it expanded
function ledHelpHtml(c, open = false) {
  const li = (ok, t, extra = '') => `<li class="${ok ? 'ok' : 'bad'}"><i>${ok ? '✓' : '✗'}</i><span>${t}${extra}</span></li>`;
  return `<details class="led-help" ${open ? 'open' : ''}><summary>Not lighting up? Troubleshooting</summary>
    <h4>Your settings</h4>
    <ul class="led-checks">${ledChecks(c).map((k) => li(k.ok, k.ok ? k.text : k.bad, k.update && !k.ok ? ' <button type="button" class="btn small" data-led-update>Update firmware</button>' : '')).join('')}
      <li class="info"><i>i</i><span>LED type is set to <b>${LED_SHORT[c.ledType] || LED_SHORT[0]}</b>. It must match what you wired: 3 wires into the first LED means WS2812B, 4 wires means APA102.</span></li></ul>
    <h4>Your wiring</h4>
    <ul class="led-tips">
      <li>Data goes into the <b>first LED's input</b> (DIN, or DI), not its output (DOUT). Follow the arrow on the strip: it points away from the Pico.</li>
      <li><b>Ground is shared</b> between the Pico and the LEDs.</li>
      <li>Power the LEDs from <b>VBUS (5 V)</b>, not 3V3, once there are more than a couple of them.</li>
      ${c.ledType === 2 ? '<li>APA102: <b>data and clock may be swapped</b>. Try swapping the two pins in the configurator.</li>' : ''}
      <li>Wrong colours? Change the <b>colour order</b> on the Lights page.${advOn() || c.ledType === 2 || c.ledOrder !== 0 ? '' : ' <button type="button" class="btn small" data-adv-on>Turn on Advanced</button>'}</li>
      <li>Flicker or random colours: a 330 Ω resistor in the data line and short wires help.</li>
    </ul></details>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-led-update]')) goUpdate(); });

// LED test chase: LED 1..n, 300 ms each, twice, then off. Cancellable; true when it ran to the end.
let ledRun = 0, ledBusy = false;
const ledWait = (ms) => new Promise((r) => setTimeout(r, ms));
function stopLedTest() { if (!ledBusy) return; ledRun++; ledBusy = false; state.dev?.ledTest(-1).catch(() => {}); }
async function runLedTest() {
  const id = ++ledRun, n = ledLayout(state.cfg).chain || 1;
  ledBusy = true;
  try {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        if (id !== ledRun) return false;
        await state.dev.ledTest(i);
        await ledWait(300);
      }
    }
    if (id !== ledRun) return false;
    await state.dev.ledTest(-1);
    return true;
  } catch { return false; } finally { if (id === ledRun) ledBusy = false; }
}
// run the chase from a button: disables it while running
async function ledTestButton(btn, label) {
  btn.disabled = true; btn.textContent = 'Testing…';
  const ok = await runLedTest();
  if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  return ok;
}

let ledHwOpen = false;   // the Lights page's "Change setup" disclosure (opens by itself while the LEDs would be dark)
function buildLights() {
  const c = state.cfg;
  const $on = $('#rgbOn'), $pin = $('#rgbPin'), $bri = $('#rgbBri'), $spd = $('#fxSpeed');
  const used = new Set(assignedPins());
  $pin.innerHTML = '<option value="255">Choose pin…</option>' +
    [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.rgbPin).map((p) => `<option value="${p}">GP${p}</option>`).join('');
  $('#fxSel').innerHTML = EFFECTS.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
  $('#presets').innerHTML = RGB_PRESETS.map((p, i) => `<button class="preset" data-preset="${i}">${p.colors.map((x) => `<i style="background:${x}"></i>`).join('')}<span>${p.name}</span></button>`).join('');
  $('#colRows').innerHTML = [0, 1, 2, 3, 4].map((f) => `<div class="col-row"><span><span class="fretdot" style="background:${FRET_DEFAULT_COLORS[f]}"></span>${funcName(f)}</span>
      <input type="color" data-col="${f}"><span class="hex" data-hex="${f}"></span></div>`).join('');

  // APA102 / SK9822 send blue first: for them setting 0 is BGR and the BGR slot is GRB (see rgb.c)
  const orderNames = (t) => LED_ORDERS.map((o, i) => (t === 2 ? (i === 0 ? 'BGR (standard)' : i === 5 ? 'GRB' : o) : (i === 0 ? 'GRB (standard)' : o)));
  $('#ledClk').innerHTML = '<option value="255">Choose pin…</option>' +
    [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.ledClkPin).map((p) => `<option value="${p}">GP${p}</option>`).join('');
  const refresh = () => {
    $on.checked = c.rgbEnabled;
    $('#ledTypeDesc').textContent = (LED_TYPES[c.ledType] || LED_TYPES[0]).desc;
    $('#ledTypeCards').innerHTML = ledTypeCards(c);
    wireLedTypeCards($('#ledTypeCards'), c, live);
    // status line + help: say why the LEDs are dark right now; keep the panel open if the user opened it
    const why = ledWhyDark(c), st = $('#ledStatus'), n = ledLayout(c).chain;
    st.className = 'led-sum-line ' + (why ? 'bad' : 'ok');
    st.textContent = why ? `The LEDs stay dark because ${why}.`
      : `\u2713 ${n} LED${n === 1 ? '' : 's'} \u00b7 ${LED_SHORT[c.ledType] || LED_SHORT[0]} on GP${c.rgbPin}${c.ledType === 2 ? ' + GP' + c.ledClkPin : ''} \u00b7 brightness ${c.rgbBrightness}`;
    $('#ledTestBtn').disabled = !!why;
    $('#ledSetupGo').hidden = !why;
    // the hardware controls are tucked away while everything works, and open by themselves when the LEDs would be dark
    const open = !!why || ledHwOpen;
    $('#ledSetupBody').hidden = !open;
    $('#ledSetupBtn').hidden = !!why;
    $('#ledSetupBtn').setAttribute('aria-expanded', String(open));
    $('#ledSetupBtn').textContent = open ? 'Hide setup' : 'Change setup';
    const help = $('#ledHelp'), html = ledHelpHtml(c, !!help.querySelector('details[open]'));
    if (help._html !== html) { help.innerHTML = html; help._html = html; }
    $('#ledOrder').innerHTML = orderNames(c.ledType).map((o, i) => `<option value="${i}">${o}</option>`).join('');
    $('#ledOrder').value = String(c.ledOrder); $('#ledClk').value = String(c.ledClkPin);
    $('#ledOrderRow').style.display = c.ledType !== 1 ? '' : 'none';
    $('#ledOrderHint').textContent = c.ledType === 2 ? 'Most APA102 and SK9822 LEDs are BGR. If red shows up blue, try RGB.' : 'If red shows up green, try RGB.';
    $('#ledClkRow').style.display = c.ledType === 2 ? '' : 'none';
    // the data and clock pins can't be the same GPIO
    for (const o of $('#ledClk').options) o.disabled = +o.value !== PIN_NONE && +o.value === c.rgbPin;
    for (const o of $pin.options) o.disabled = c.ledType === 2 && +o.value !== PIN_NONE && +o.value === c.ledClkPin;
    $('#ledClkRow').classList.toggle('warn', c.ledType === 2 && c.rgbEnabled && c.ledClkPin === PIN_NONE);
    $('#ledClkHint').textContent = c.ledType === 2 && c.ledClkPin === PIN_NONE ? 'Choose the clock pin: APA102 LEDs stay dark without it.' : "Wired to the first LED's clock input (CI / CKI).";
    $pin.value = String(c.rgbPin);
    $bri.max = maxBrightness(c); c.rgbBrightness = Math.min(c.rgbBrightness, maxBrightness(c));
    $bri.value = c.rgbBrightness; $('#rgbBriVal').textContent = c.rgbBrightness;
    $('#rgbBriNote').innerHTML = brightNote(c);
    $spd.value = c.rgbSpeed; $('#fxSpeedVal').textContent = c.rgbSpeed;
    $('#fxSel').value = String(c.rgbEffect); $('#fxDesc').textContent = EFFECTS.find((e) => e.id === c.rgbEffect)?.desc || '';
    document.querySelectorAll('[data-col]').forEach((i) => { i.value = c.colors[+i.dataset.col]; $(`[data-hex="${i.dataset.col}"]`).textContent = c.colors[+i.dataset.col].toUpperCase(); });
    for (const id of ['#rgbOpts', '#mapCard', '#strumCard']) $(id).classList.toggle('rgb-disabled', !c.rgbEnabled);
    $('#legacyCard').hidden = (c.cfgVersion ?? 0) >= 7;
    $('#mapView').innerHTML = chainLabels(c).map((l, p) => `${p ? '<span class="arrow">→</span>' : ''}<div class="led" ${l.fret !== undefined ? `data-fret="${l.fret}"` : `data-strum="${l.strum}"`} style="--c:${l.color}"><b style="background:${l.color}"></b>LED ${p + 1}<br>${l.name}</div>`).join('')
      || '<p class="dim">No LEDs set up: choose fret and / or strum LEDs under LED layout above.</p>';
    applyColors();
    syncStudio();
  };
  const live = () => { refresh(); pushCfg(); };

  $on.onchange = () => { c.rgbEnabled = $on.checked; live(); };
  $pin.onchange = () => { c.rgbPin = +$pin.value; live(); };
  $('#ledSetupBtn').onclick = () => { ledHwOpen = !ledHwOpen; refresh(); };
  $('#ledSetupGo').onclick = () => { showView('setup'); goStep(STEPS.findIndex((s) => s.kind === 'rgb')); };
  $('#ledTestBtn').onclick = () => ledTestButton($('#ledTestBtn'), 'Test LEDs');
  $('#ledOrder').onchange = (e) => { c.ledOrder = +e.target.value; live(); };
  $('#ledClk').onchange = (e) => { c.ledClkPin = +e.target.value; if (c.ledClkPin === c.rgbPin) c.ledClkPin = PIN_NONE; live(); };
  $bri.oninput = () => { c.rgbBrightness = +$bri.value; live(); };
  // firmware before 0.34: one effect for everything (the preview and a later upgrade derive the zones from it)
  const legacyZones = () => { c.zoneFrets = effectZone(c.rgbEffect, c.rgbSpeed); c.zoneStrum = effectZone(c.rgbEffect, c.rgbSpeed); };
  $spd.oninput = () => { c.rgbSpeed = +$spd.value; legacyZones(); live(); };
  $('#fxSel').onchange = (e) => { c.rgbEffect = +e.target.value; legacyZones(); live(); };
  $('#colRows').oninput = (e) => { const f = e.target.dataset.col; if (f !== undefined) { c.colors[+f] = e.target.value; c.fretPress[+f] = e.target.value; c.fret2Colors[+f] = e.target.value; live(); } };
  $('#presets').onclick = (e) => { const b = e.target.closest('[data-preset]'); if (b) { c.colors = RGB_PRESETS[+b.dataset.preset].colors.slice(); c.fretPress = c.colors.slice(); c.fret2Colors = c.colors.slice(); live(); } };
  $('#mapWizard').onclick = () => { showView('setup'); goStep(STEPS.findIndex((s) => s.kind === 'ledmap')); };
  // LED layout: fret / strum LEDs, wiring order, strum colour and what each strum LED follows
  const drawLayout = () => {
    $('#layoutOpts').innerHTML = ledLayoutControls(c, 'lt');
    wireLedLayout(c, () => { drawLayout(); live(); }, 'lt');
    const n = c.strumLeds || 0;
    const oldFw = (c.cfgVersion ?? 0) < 7;   // firmware 0.34+ sets the strum colours in the lighting studio
    $('#strumOpts').innerHTML = n ? `${oldFw ? `<div class="col-row"><span>Strum LED colour</span><input type="color" id="strumCol" value="${c.strumColor || '#ffffff'}"><span class="hex" id="strumHex">${(c.strumColor || '#ffffff').toUpperCase()}</span></div>` : ''}
      ${n > 1 ? `<div class="opt"><div><h3>Guided setup</h3><p class="dim">What the strum LEDs light up on. Fine-tune each one below.</p></div>
        <span class="row"><button class="btn small" data-rp="both">All: up and down</button><button class="btn small" data-rp="half">First half up, second half down</button><button class="btn small" data-rp="alt">Alternate up / down</button></span></div>` : ''}
      ${[...Array(n).keys()].map((k) => `<div class="opt"><div><h3>Strum LED ${k + 1}</h3><p class="dim">Lights up on</p></div>
        <select data-role="${k}">${STRUM_ROLES.map((r) => `<option value="${r.id}" ${c.strumRoles[k] === r.id ? 'selected' : ''}>${r.name}</option>`).join('')}</select></div>`).join('')}` : '';
    $('#strumCol')?.addEventListener('input', (e) => { c.strumColor = e.target.value; $('#strumHex').textContent = c.strumColor.toUpperCase(); live(); });
    $('#strumOpts').onchange = (e) => { const k = e.target.dataset.role; if (k !== undefined) { c.strumRoles[+k] = +e.target.value; live(); } };
    // presets, in chain order of the strum LEDs (so "first half" means the first ones along the wire)
    $('#strumOpts').onclick = (e) => {
      const p = e.target.closest('[data-rp]')?.dataset.rp;
      if (!p) return;
      const order = [...Array(n).keys()].sort((a, b) => c.strumMap[a] - c.strumMap[b]);
      order.forEach((k, j) => { c.strumRoles[k] = p === 'both' ? 0 : p === 'half' ? (j < Math.ceil(n / 2) ? 1 : 2) : (j % 2 ? 2 : 1); });
      drawLayout(); live();
    };
  };
  drawLayout();
  buildStudio({
    state, changed: () => { applyColors(); refreshChain(); pushCfg(); }, toast, advRefresh,
    whammy: (s) => liveWhammy(s), turnOn: () => { c.rgbEnabled = true; live(); },
    fwPreview: () => fwAtLeast(35), preview: (bits, on) => state.dev?.ledPreview(bits, on), goUpdate: () => goUpdate(),
  });
  refresh();
}

// ------------------------------------------------------------------ modes
function buildModes() {
  const c = state.cfg;
  const running = state.info.mode;
  const setup = !!state.info.setupSession;
  const modeTag = (id) => setup
    ? (id === running ? '<span class="tag">Setup session</span>' : id === c.usbMode ? '<span class="tag live">Next plug-in</span>' : '<span></span>')
    : (id === running ? '<span class="tag live">Running</span>' : '<span></span>');
  $('#modeCards').innerHTML = availableModes().map((m) => `<div class="mode-row ${c.usbMode === m.id ? 'sel' : ''}" data-mode="${m.id}" role="radio" tabindex="0" aria-checked="${c.usbMode === m.id}" title="${m.desc.replace(/"/g, '&quot;')}">
      <span class="radio"></span><div><b>${m.name.replace(/ \(experimental\)$/, '')}</b>${m.host ? ' <span class="tag exp">Experimental</span>' : ''}<div class="dim">${MODE_USE[m.id] || ''}</div></div>
      ${modeTag(m.id)}</div>`).join('');
  $('#setupNote').hidden = !setup;
  $('#macNote').hidden = !IS_MAC;
  $('#macNote').innerHTML = IS_MAC ? `<b>On a Mac:</b> ${MAC_XINPUT_TIP}` : '';
  $('#setupNote').innerHTML = setup ? `The guitar is in a one-off <b>setup session</b> (XInput with configuration), which is why it can talk to this page. Unplug it and plug it back in to return to <b>${modeName(c.usbMode).replace(/ \(experimental\)$/, '')}</b>.` : '';
  buildHostPort();
  const pick = (row) => { c.usbMode = +row.dataset.mode; buildModes(); $(`#modeCards [data-mode="${c.usbMode}"]`)?.focus(); };
  $('#modeCards').onclick = (e) => { const row = e.target.closest('.mode-row'); if (row) pick(row); };
  $('#modeCards').onkeydown = (e) => { const row = e.target.closest('.mode-row'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(row); } };
  const opts = (sel) => `<option value="255" ${sel === MODE_NONE ? 'selected' : ''}>Nothing (use the default)</option>` +
    availableModes().map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  $('#bootTable').innerHTML = [0, 1, 2, 3, 4].map((i) => `<div class="fret-row" style="--c:${FRET_COLORS[i]}"><span class="fret-key"></span><label for="boot${i}">${funcName(i)}</label>
      <select id="boot${i}" data-fret="${i}">${opts(c.bootModes[i])}</select></div>`).join('');
  $('#bootTable').onchange = (e) => { c.bootModes[+e.target.dataset.fret] = +e.target.value; buildHostPort(); };

  // XInput flavour
  const XI = [{ id: 0, name: 'Guitar Hero guitar', desc: 'Like the Xbox 360 Les Paul and World Tour guitars.' },
              { id: 1, name: 'Rock Band guitar', desc: 'Like the Xbox 360 Rock Band Stratocaster.' }];
  $('#xiType').innerHTML = XI.map((x) => `<label><input type="radio" name="xi" value="${x.id}" ${c.xinputType === x.id ? 'checked' : ''}><div><b>${x.name}</b><span class="dim">${x.desc}</span></div></label>`).join('');
  $('#xiType').onchange = (e) => { c.xinputType = +e.target.value; };
  $('#starLeft').checked = !!c.starDpadLeft;
  $('#starLeft').onchange = (e) => { c.starDpadLeft = e.target.checked; };
  $('#rxRow').hidden = (c.cfgVersion ?? 0) < 5 || !(state.info.major > 0 || state.info.minor >= 38);
  $('#xiRx').checked = !!(c.xinputOpts & 4);
  $('#xiRx').onchange = (e) => { c.xinputOpts = (c.xinputOpts & ~5) | (e.target.checked ? 4 : 0); };
  buildPorts();

  // keyboard bindings
  const keyOpts = (sel) => Object.entries(KEYS).sort((x, y) => (+x[0] === 0 ? -1 : +y[0] === 0 ? 1 : 0))
    .map(([code, name]) => `<option value="${code}" ${+code === sel ? 'selected' : ''}>${name}</option>`).join('');
  const drawKeys = () => {
    $('#keyMap').innerHTML = KEY_SLOTS.map((slot, i) => `<label for="key${i}">${slot}</label><select id="key${i}" data-key="${i}">${keyOpts(c.keys[i])}</select>`).join('');
  };
  const markKp = () => document.querySelectorAll('#keyPresets [data-kp]').forEach((b) => b.classList.toggle('on', KEY_PRESETS[+b.dataset.kp].keys.every((k, j) => k === c.keys[j])));
  $('#keyPresets').innerHTML = KEY_PRESETS.map((p, i) => `<button data-kp="${i}" title="${p.desc}">${p.name.replace(/^Fortnite Festival · /, '')}</button>`).join('');
  $('#keyPresets').onclick = (e) => { const b = e.target.closest('[data-kp]'); if (b) { c.keys = KEY_PRESETS[+b.dataset.kp].keys.slice(); drawKeys(); markKp(); } };
  $('#keyMap').onchange = (e) => { const i = e.target.dataset.key; if (i !== undefined) c.keys[+i] = +e.target.value; markKp(); };
  drawKeys(); markKp();
}

// USB host port for PS4 / Xbox One authentication passthrough
function buildHostPort() {
  const c = state.cfg;
  if (c.hostPin === undefined) c.hostPin = PIN_NONE;
  const own = new Set(hostPins());
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...accelPins(c), c.rumblePin ?? PIN_NONE].filter((p) => p !== PIN_NONE && !own.has(p)));
  const free = [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !taken.has(p) && !taken.has(p + 1));
  const sel = $('#hostPin');
  sel.innerHTML = '<option value="255">Off (no host port)</option>' +
    free.map((p) => `<option value="${p}">D+ GP${p}, D− GP${p + 1}</option>`).join('');
  sel.value = String(free.includes(c.hostPin) ? c.hostPin : PIN_NONE);
  const show = () => {
    const on = c.hostPin !== PIN_NONE;
    $('#wDp').textContent = on ? 'GP' + c.hostPin : 'the pin you pick';
    $('#wDm').textContent = on ? 'GP' + (c.hostPin + 1) : 'the next pin';
    $('#hostPinNote').textContent = 'Two neighbouring free pins. They can\'t be used for buttons while the port is on.';
    const needs = MODES.find((m) => m.id === c.usbMode)?.host || c.bootModes.some((id) => MODES.find((m) => m.id === id)?.host);
    const w = $('#hostWarn');
    w.hidden = !(needs && !on);
    w.textContent = 'A PS4 / Xbox One mode is selected but the host port is off, so the console will reject the guitar.';
  };
  sel.onchange = () => { c.hostPin = +sel.value; show(); };
  show();
}

// ------------------------------------------------------------------ flash page
const BOARD_LIST = [
  { id: 'pico_clone', arch: 'rp2040', name: 'Pico-compatible clone (ESP8285 / “Pico W-style” boards)', help: 'Uses the slower, safer flash settings these clone boards need. Pick this if your board is not an official Raspberry Pi one.' },
  { id: 'pico', arch: 'rp2040', name: 'Raspberry Pi Pico', help: 'Official Pico (RP2040).' },
  { id: 'pico_w', arch: 'rp2040', name: 'Raspberry Pi Pico W', help: 'Official Pico W with the CYW43 radio (Bluetooth capable).' },
  { id: 'pico2', arch: 'rp2350', name: 'Raspberry Pi Pico 2', help: 'Official Pico 2 (RP2350).' },
  { id: 'pico2_w', arch: 'rp2350', name: 'Raspberry Pi Pico 2 W', help: 'Official Pico 2 W (RP2350, Bluetooth capable).' },
  { id: 'waveshare_rp2040_zero', arch: 'rp2040', name: 'Waveshare RP2040-Zero', help: 'Tiny USB-C board; fits inside guitar bodies. Its onboard RGB LED is on GP16, so keep that pin free.' },
  { id: 'waveshare_rp2040_one', arch: 'rp2040', name: 'Waveshare RP2040-One', help: 'USB-A plug board with the same pinout as the Zero.' },
  { id: 'sparkfun_promicro', arch: 'rp2040', name: 'SparkFun Pro Micro RP2040', help: 'Drop-in replacement footprint for old ATmega32U4 Pro Micro builds. Onboard RGB LED on GP25.' },
  { id: 'adafruit_kb2040', arch: 'rp2040', name: 'Adafruit KB2040', help: 'Pro Micro footprint with USB-C. Onboard NeoPixel on GP17.' },
];

function initFlash() {
  const sel = $('#boardSel');
  sel.innerHTML = BOARD_LIST.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  sel.value = store.get('yacc.board') || 'pico_clone';
  if (!BOARD_LIST.some((b) => b.id === sel.value)) sel.value = 'pico_clone';
  const apply = () => {
    const b = BOARD_LIST.find((x) => x.id === sel.value);
    store.set('yacc.board', b.id);
    $('#boardHelp').textContent = b.help;
    const fw = `downloads/yagcc-${b.id}.uf2`, nk = `downloads/yagcc-nuke-${b.arch}.uf2`;
    $('#dlFw').href = fw; $('#dlFw').setAttribute('download', `yagcc-${b.id}.uf2`);
    $('#dlNuke').href = nk; $('#dlNuke').setAttribute('download', `yagcc-nuke-${b.arch}.uf2`);
    $('#directFw').onclick = () => directFlash(fw, `yagcc-${b.id}.uf2`);
    $('#directNuke').onclick = () => directFlash(nk, `yagcc-nuke-${b.arch}.uf2`);
  };
  sel.onchange = apply; apply();
  // a connected guitar can jump into the bootloader itself (same as Star power + Plus at plug-in)
  const refreshBootsel = () => { const on = !!state.dev; $('#toBootsel').hidden = !on; $('#bootselNote').hidden = !on; };
  $('#toBootsel').onclick = async () => {
    try { await state.dev.reboot(true); toast('Restarting into update mode. Copy the firmware to the drive that appears.', 'ok'); }
    catch (e) { toast('Could not restart it: ' + e.message, 'bad'); }
  };
  setInterval(refreshBootsel, 1000); refreshBootsel();

  if (!window.showDirectoryPicker) { $('#directFw').disabled = true; $('#directNuke').disabled = true; $('#directFw').title = 'Needs Chrome or Edge'; }
  if (!webusbSupported()) {
    const w = $('#browserWarn');
    w.style.display = '';
    w.innerHTML = '<b>WebUSB is not available in this browser.</b> Open YAGCC in Chrome, Edge or another Chromium browser to configure the controller. Downloading firmware works everywhere.';
  }
}

async function directFlash(url, name) {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!/RP/i.test(dir.name)) {
      if (!confirm(`“${dir.name}” does not look like the Pico's bootloader drive (usually RPI-RP2 or RP2350). Write the file anyway?`)) return;
    }
    const buf = await (await fetch(url)).arrayBuffer();
    const fh = await dir.getFileHandle(name, { create: true });
    try {
      const w = await fh.createWritable();
      await w.write(buf);
      await w.close();
    } catch { /* the drive disappears as soon as the board reboots into the new firmware */ }
    $('#flashMsg').textContent = `Wrote ${name}. The board is restarting; if the drive disappeared, it worked.`;
    toast('Flashed ' + name, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') toast('Direct flash failed: ' + e.message, 'bad');
  }
}

// ------------------------------------------------------------------ boot
// ------------------------------------------------------------------ controllers running in PS3 / HID mode
// PS3 mode must look exactly like a real PS3 guitar, so it has no WebUSB config interface; HID mode has one
// but the browser asks for permission separately for each mode. WebHID lets us find both and help out.
const HID_FILTERS = [{ vendorId: 0x12ba, productId: 0x0100 }, { vendorId: 0x12ba, productId: 0x0200 }, { vendorId: 0x1bad, productId: 0x0004 },
  { vendorId: 0x0f0d, productId: 0x0092 }, { vendorId: 0x1209, productId: 0x0002 }, { vendorId: 0x1209, productId: 0x0003 }];
const canRestart = (d) => d.vendorId === 0x12ba || d.vendorId === 0x1bad;   // modes whose HID descriptor has the feature report
const isOurHid = (d) => HID_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId);

async function restartToSetup(dev) {
  const box = $('#otherMode');
  box.innerHTML = '<div class="result"><span class="pulse"></span><span>Asking the controller to restart in setup mode…</span></div>';
  let gone = false;
  const onGone = (ev) => { if (ev.device === dev) gone = true; };
  navigator.hid.addEventListener('disconnect', onGone);
  try {
    if (!dev.opened) await dev.open();
    const data = new Uint8Array(32);
    data.set([...'YAGCC!'].map((ch) => ch.charCodeAt(0)));
    await dev.sendFeatureReport(0, data);
  } catch (e) {
    navigator.hid.removeEventListener('disconnect', onGone);
    box.innerHTML = `<div class="result bad">Could not talk to it (${e.message}). Unplug it and hold <b>Plus</b> while plugging it back in instead.</div>`;
    return;
  }
  await sleep(3000);
  navigator.hid.removeEventListener('disconnect', onGone);
  if (gone) {
    box.innerHTML = '<div class="result ok">Restarted in setup mode. If it does not connect by itself in a moment, press <b>Connect controller</b> and pick <b>YAGCC Guitar Controller</b>.</div>';
    await sleep(1500);
    autoConnect(true);
  } else {
    box.innerHTML = `<div class="result bad" style="text-align:left">The controller did not restart. It is probably still running older firmware without this feature:
      flash the latest <b>yagcc-…uf2</b> from the Install page, or unplug it and hold <b>Plus</b> while plugging it back in.</div>`;
  }
}

function showOtherMode(dev) {
  const box = $('#otherMode');
  if (!box) return;
  if (!dev || state.dev) { box.innerHTML = ''; return; }
  if (dev.vendorId === 0x0f0d) {
    box.innerHTML = `<div class="notice info" style="text-align:left"><b>Found your controller in Switch mode.</b>
        That mode has no configuration channel. Unplug it and hold <b>Plus</b> while plugging it back in to configure it.</div>`;
  } else if (canRestart(dev)) {
    box.innerHTML = `<div class="notice info" style="text-align:left">
        <b>Found your controller in ${dev.vendorId === 0x1bad ? 'Wii Rock Band' : dev.productId === 0x0200 ? 'PS3 Rock Band' : 'PS3 Guitar Hero'} mode.</b> That mode has no configuration channel, because it has to look exactly like a real PS3 guitar.
        <div class="row" style="margin-top:10px"><button class="btn primary small" id="toSetup">Restart it in setup mode</button>
        <span class="muted" style="font-size:12px">or unplug it and hold <b>Plus</b> while plugging it back in</span></div></div>`;
    $('#toSetup').onclick = () => restartToSetup(dev);
  } else {
    const kb = dev.productId === 0x0003;
    box.innerHTML = `<div class="notice info" style="text-align:left"><b>Found your controller in ${kb ? 'keyboard' : 'HID'} mode.</b>
        The browser asks for permission once per mode: press <b>Connect controller</b> and pick <b>YAGCC Guitar (${kb ? 'Keyboard' : 'HID'})</b>.</div>`;
  }
}

async function scanHid() {
  if (!('hid' in navigator) || state.dev) return showOtherMode(null);
  try { showOtherMode((await navigator.hid.getDevices()).find(isOurHid)); } catch { /* not allowed */ }
}

$('#findHid').onclick = async (e) => {
  e.preventDefault();
  if (!('hid' in navigator)) { toast('This browser has no WebHID. Use Chrome or Edge.', 'bad'); return; }
  try {
    const [d] = await navigator.hid.requestDevice({ filters: HID_FILTERS });
    if (!d) { toast('No controller in PS3 or HID mode was picked.'); return; }
    if (canRestart(d)) restartToSetup(d);   // you picked it to configure it: switch straight away
    else showOtherMode(d);
  } catch (err) { toast('Search failed: ' + err.message, 'bad'); }
};
if ('hid' in navigator) {
  navigator.hid.addEventListener('connect', () => scanHid());
  navigator.hid.addEventListener('disconnect', () => scanHid());
  scanHid();
}

renderHardware($('#hwList'));
renderCompat($('#compatList'));
document.querySelectorAll('[data-connect]').forEach((b) => { b.onclick = pickAndConnect; });
document.querySelector('[data-goto]').onclick = (e) => { e.preventDefault(); showView('flash'); scrollTo(0, 0); };
initFlash();
updatePill();

if (webusbSupported()) {
  navigator.usb.addEventListener('connect', async () => { await sleep(700); autoConnect(!state.dev); });
  navigator.usb.addEventListener('disconnect', () => { if (state.dev) { state.dev.stopPolling(); onLost(); } });
  autoConnect(true);   // already-authorised controller -> straight to setup
}
