import {
  FUNCS, FUNC_LABEL, PIN_NONE, NUM_DIGITAL_PINS, NUM_FRETS, MODES, MODE_NONE, BOARDS, modeName,
  DEBOUNCE_MODES, defaultConfig, whammyValue, isPressed, EFFECTS, RGB_PRESETS, FRET_DEFAULT_COLORS, NUM_LEDS, MAX_STRUM_LEDS, STRUM_ROLES, ledLayout, applyLedLayout, maxBrightness,
  LED_TYPES, LED_ORDERS, KEY_SLOTS, KEYS, KEY_PRESETS,
  ATILT_SOURCES, ACCEL_TYPES, i2cPinsOk, tiltSourceRaw, tiltValue,
} from './protocol.js?v=dev';
import { YaccDevice, webusbSupported } from './usb.js?v=dev';
import { PinDetector, WhammyCalibrator } from './detect.js?v=dev';
import { createGuitar } from './guitar.js?v=dev';
import { renderHardware, renderCompat } from './pages.js?v=dev';
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
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'setup') renderStep();
  if (state.dev && state.cfg) {           // pick up anything changed on other pages
    if (v === 'tune') buildTune();
    if (v === 'lights') buildLights();
    if (v === 'modes') buildModes();
  }
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });

const funcName = (i) => FUNC_LABEL[FUNCS[i]];
const hostPins = (c = state.cfg) => (c.hostPin !== undefined && c.hostPin !== PIN_NONE ? [c.hostPin, c.hostPin + 1] : []);
const accelPins = (c = state.cfg) => (c.accelSda !== undefined && c.accelSda !== PIN_NONE ? [c.accelSda, c.accelScl] : []);
const assignedPins = () => [...state.cfg.pins, state.cfg.tiltPin, ...hostPins(), ...accelPins(), state.cfg.rumblePin ?? PIN_NONE].filter((p) => p !== PIN_NONE);
const isConfigured = (cfg) => cfg.pins.some((p) => p !== PIN_NONE);

let pushTimer = 0;
function pushCfg() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await state.dev?.setConfig(state.cfg); } catch (e) { toast('Could not send settings: ' + e.message, 'bad'); }
  }, 80);
}

// ------------------------------------------------------------------ live guitar viewers
const viewers = [];
function makeViewer(container, withPins = false, compact = false) {
  const g = createGuitar({ compact });
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
  v.g.setTilt((cfg.tiltEnabled && isPressed(s, cfg.tiltPin)) || ts.some((t) => t.star));
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
  if (state.view === 'tune') updateTilt(s);
  for (const v of viewers) if (v.container.offsetParent !== null) updateViewer(v, s);
  tickStep(s);
}

// ------------------------------------------------------------------ guided setup
const STEPS = [
  ...[0, 1, 2, 3, 4].map((i) => ({ kind: 'button', func: i, title: funcName(i) + ' fret', prompt: `Press the ${funcName(i).toLowerCase()} fret twice within one second.`, focus: [FUNCS[i]] })),
  { kind: 'button', func: 5, title: 'Strum up', prompt: 'Push the strum bar up twice within one second.', focus: ['strumUp'] },
  { kind: 'button', func: 6, title: 'Strum down', prompt: 'Push the strum bar down twice within one second.', focus: ['strumDown'] },
  { kind: 'button', func: 7, title: 'Star power', prompt: 'Press the star power button twice within one second.', focus: ['star'] },
  { kind: 'button', func: 8, title: 'Plus / Start', prompt: 'Press the plus button twice within one second.', focus: ['plus'] },
  { kind: 'whammy', title: 'Whammy bar', prompt: 'Move the whammy bar all the way down and back up, twice.', focus: ['whammy'] },
  { kind: 'rgb', title: 'RGB lighting', prompt: 'Did you wire addressable LEDs under the frets or on the strum bar?', focus: [] },
  { kind: 'ledmap', title: 'LED order', prompt: 'Teach YAGCC which LED sits under which fret or on the strum bar.', focus: [] },
  { kind: 'bluetooth', title: 'Bluetooth', prompt: 'Go wireless?', focus: [] },
  { kind: 'tilt', title: 'Tilt switch', prompt: 'Use a tilt switch as a star power shortcut?', focus: ['tilt'] },
  { kind: 'review', title: 'All done', prompt: 'Check everything, then save it to the controller.', focus: [] },
];

let stageViewer = null;
let stepCtx = {};    // per-step transient state

function buildUi() {
  viewers.length = 0;
  $('#stage').innerHTML = '';
  stageViewer = makeViewer($('#stage'), true);
  $('#tuneStage').innerHTML = '';
  makeViewer($('#tuneStage'), false, true);
  $('#lightsStage').innerHTML = '';
  makeViewer($('#lightsStage'), false, true);
  buildTune();
  buildBackup();
  buildLights();
  buildModes();
  renderStep();
}

function stepValue(st) {
  const c = state.cfg;
  if (st.kind === 'button') return c.pins[st.func] === PIN_NONE ? '' : 'GP' + c.pins[st.func];
  if (st.kind === 'whammy') return c.whammyCh === PIN_NONE ? '' : 'GP' + (26 + c.whammyCh);
  if (st.kind === 'rgb') return c.rgbEnabled ? (c.rgbPin === PIN_NONE ? 'on' : 'GP' + c.rgbPin) : 'off';
  if (st.kind === 'ledmap') return c.rgbEnabled ? '' : 'n/a';
  if (st.kind === 'bluetooth') return c.btEnabled ? 'on' : 'off';
  if (st.kind === 'tilt') return c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin : 'off';
  return '';
}
function isStepDone(st, i) {
  if (st.kind === 'button') return state.cfg.pins[st.func] !== PIN_NONE;
  if (st.kind === 'whammy') return state.cfg.whammyCh !== PIN_NONE;
  if (st.kind === 'review') return false;
  return i < state.step;
}
function renderStepList() {
  const ol = $('#stepList');
  if (!ol) return;
  ol.innerHTML = STEPS.map((st, i) => {
    const sw = st.kind === 'button' && st.func < NUM_FRETS ? `<span class="sw" style="background:${FRET_COLORS[st.func]}"></span>` : '';
    return `<li class="${i === state.step ? 'cur' : ''} ${isStepDone(st, i) ? 'done' : ''}"><button data-step="${i}"><span class="mark"></span><span>${sw}${st.title}</span><span class="v">${stepValue(st)}</span></button></li>`;
  }).join('');
  ol.onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) goStep(+b.dataset.step); };
}

function goStep(i) {
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
  stepCtx = {};
  stageViewer.g.setFocus(step.focus);
  renderStepList();
  const head = `<div class="step-count">${state.step + 1} / ${STEPS.length}</div>
    <h2 class="step-title">${step.title}</h2><p class="step-prompt">${step.prompt}</p>`;

  const nav = (extra = '') => `<div class="step-nav">
      <button class="btn quiet" id="bBack" ${state.step === 0 ? 'disabled' : ''}>Back</button>
      <div class="row">${extra}</div></div>`;
  const wireNav = () => { $('#bBack')?.addEventListener('click', () => goStep(state.step - 1)); $('#bSkip')?.addEventListener('click', () => goStep(state.step + 1)); };

  if (step.kind === 'button') {
    const exclude = assignedPins().filter((p) => p !== state.cfg.pins[step.func]);
    stepCtx.detector = new PinDetector({ windowMs: 1000, minPresses: 2, exclude });
    const cur = state.cfg.pins[step.func];
    const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !exclude.includes(p));
    card.innerHTML = head + `
      <div class="result ${cur !== PIN_NONE ? 'ok' : ''}" id="result">${cur !== PIN_NONE
        ? `Assigned to <span class="chip">GP${cur}</span>. Press it twice again to re-detect.`
        : '<span class="pulse"></span><span>Waiting for two presses…</span>'}</div>
      <div class="manual"><label for="manual">Or choose the pin yourself</label>
        <select id="manual"><option value="">Choose pin…</option>${free.map((p) => `<option value="${p}">GP${p}</option>`).join('')}</select></div>
      ${nav('<button class="btn ' + (cur !== PIN_NONE ? 'primary' : '') + '" id="bSkip">' + (cur !== PIN_NONE ? 'Next' : 'Skip') + '</button>')}`;
    wireNav();
    $('#manual').addEventListener('change', (e) => { if (e.target.value !== '') assignButton(step, +e.target.value); });
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
    const renderRgb = () => {
      const c = state.cfg;
      const used = new Set(assignedPins());
      const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.rgbPin);
      card.innerHTML = head + `
        <div class="opt first"><div><h3>Addressable LEDs</h3><p class="dim">WS2812, SK6812 or APA102 LEDs on one chain: one under each fret, and optionally up to eight on the strum bar.</p></div>
          <label class="switch"><input type="checkbox" id="rgbSw" ${c.rgbEnabled ? 'checked' : ''}><i></i></label></div>
        ${c.rgbEnabled ? `${ledLayoutControls(c)}
          <div class="opt"><div><h3>Data pin</h3><p class="dim">Wired to the first LED's data input.</p></div>
            <select id="rgbPinSel"><option value="255">Choose pin…</option>${free.map((p) => `<option value="${p}" ${p === c.rgbPin ? 'selected' : ''}>GP${p}</option>`).join('')}</select></div>
          <div class="slider-row"><label for="rgbBriS">Brightness</label><span class="val" id="rgbBriSVal">${c.rgbBrightness}</span>
            <input type="range" id="rgbBriS" min="0" max="${maxBrightness(c)}" step="1" value="${c.rgbBrightness}"></div>
          ${brightNote(c)}
          <p class="dim small">Colours, effects and the LED type are on the Lights page.</p>` : ''}
        ${nav(`<button class="btn primary" id="bSkip" ${c.rgbEnabled && c.rgbPin === PIN_NONE ? 'disabled' : ''}>${c.rgbEnabled ? 'Continue' : 'Skip, no LEDs'}</button>`)}`;
      wireNav();
      $('#rgbSw').addEventListener('change', (e) => { c.rgbEnabled = e.target.checked; applyColors(); pushCfg(); renderRgb(); });
      wireLedLayout(c, () => { pushCfg(); renderRgb(); });
      $('#rgbPinSel')?.addEventListener('change', (e) => { c.rgbPin = +e.target.value; pushCfg(); renderRgb(); });
      $('#rgbBriS')?.addEventListener('input', (e) => { c.rgbBrightness = +e.target.value; $('#rgbBriSVal').textContent = c.rgbBrightness; pushCfg(); });
    };
    renderRgb();
  } else if (step.kind === 'ledmap') {
    const c = state.cfg;
    const lay = ledLayout(c);
    stepCtx.chain = lay.chain;
    stepCtx.idx = 0;
    stepCtx.assign = [-1, -1, -1, -1, -1];     // fret -> chain position
    stepCtx.strumAssign = [];                  // chain positions of the strum LEDs, in the order found
    stepCtx.base = null;
    stepCtx.lockUntil = 0;
    const finish = () => {
      // LEDs that were skipped take whatever positions are left, in order
      const taken = new Set([...stepCtx.assign.filter((p) => p >= 0), ...stepCtx.strumAssign]);
      const left = [...Array(lay.chain).keys()].filter((p) => !taken.has(p));
      if (lay.frets) c.ledMap = stepCtx.assign.map((p) => (p >= 0 ? p : left.shift()));
      for (let k = 0; k < MAX_STRUM_LEDS; k++) c.strumMap[k] = k < lay.strum ? (stepCtx.strumAssign[k] ?? left.shift()) : 200 + k;
      pushCfg();
    };
    const label = (pos) => {
      const f = lay.frets ? c.ledMap.indexOf(pos) : -1;
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
        const f = stepCtx.assign.indexOf(i), sk = stepCtx.strumAssign.indexOf(i);
        return `<i class="${i === stepCtx.idx ? 'lit' : f >= 0 || sk >= 0 ? 'done' : ''}" style="--c:${f >= 0 ? c.colors[f] : '#fff'}"></i>`;
      }).join('');
      const what = lay.frets && lay.strum ? 'Press the fret above it, or strum if it is on the strum bar.'
        : lay.frets ? 'Press the fret above it.' : 'Strum once.';
      const noPins = lay.frets ? c.pins.slice(0, NUM_FRETS).every((p) => p === PIN_NONE) : (c.pins[5] === PIN_NONE && c.pins[6] === PIN_NONE);
      card.innerHTML = head + `<div class="led-test">${dots}</div>
        <div class="result"><span class="pulse"></span><span>${!lay.chain ? 'No LEDs are set up. Go back and choose fret and / or strum LEDs.' : noPins ? 'The frets / strum bar are not assigned yet. Go back and map them first.' : `LED ${stepCtx.idx + 1} of ${lay.chain} is lit white. ${what}`}</span></div>
        ${nav('<button class="btn" id="mSkipLed">Skip this LED</button>')}`;
      wireNav();
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
      ${sup ? `<div class="opt"><div><h3>Debug logging</h3><p class="dim">Records Bluetooth connections in the guitar's memory, kept across power cycles until cleared, to track down connection problems. Off by default; leave it off for normal use.</p></div>
        <label class="switch"><input type="checkbox" id="btLogSw" ${state.cfg.btDebugLog ? 'checked' : ''}><i></i></label></div>
      <div class="opt"><div><h3>Bluetooth log</h3><p class="dim">What was recorded while debug logging was on.</p></div><span class="row"><button class="btn small" id="btLogBtn">Show</button><button class="btn small" id="btLogClear" hidden>Clear</button></span></div><pre class="btlog" id="btLog" hidden></pre>` : ''}
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
      try { await state.dev.setConfig(state.cfg); await state.dev.save(); toast(e.target.checked ? 'Bluetooth debug logging on (saved)' : 'Bluetooth debug logging off (saved)', 'ok'); }
      catch (err) { toast('Could not save: ' + err.message, 'bad'); }
    });
  } else if (step.kind === 'tilt') {
    const renderTilt = () => {
      const c = state.cfg;
      const have = c.tiltPin !== PIN_NONE;
      stepCtx.detector = new PinDetector({ windowMs: 5000, minPresses: 2, exclude: assignedPins().filter((p) => p !== c.tiltPin) });
      card.innerHTML = head + `
        <div class="opt first"><div><h3>Tilt for star power</h3><p class="dim">Lifting the neck triggers star power, like on a real controller.</p></div>
          <label class="switch"><input type="checkbox" id="tiltSw" ${c.tiltEnabled ? 'checked' : ''}><i></i></label></div>
        ${c.tiltEnabled ? `<div class="result ${have ? 'ok' : ''}" id="result" style="margin-top:12px">${have
          ? `Tilt switch on <span class="chip">GP${c.tiltPin}</span>`
          : '<span class="pulse"></span><span>Tilt the guitar up twice within 5 seconds.</span>'}</div>` : ''}
        ${nav(`${c.tiltEnabled && have ? '<button class="btn quiet" id="tRedo">Re-detect</button>' : ''}<button class="btn primary" id="bSkip">Continue</button>`)}`;
      wireNav();
      stepCtx.active = c.tiltEnabled && !have;
      $('#tiltSw').addEventListener('change', (e) => { c.tiltEnabled = e.target.checked; if (!c.tiltEnabled) c.tiltPin = PIN_NONE; pushCfg(); renderTilt(); });
      $('#tRedo')?.addEventListener('click', () => { c.tiltPin = PIN_NONE; pushCfg(); renderTilt(); });
    };
    renderTilt();
  } else {
    const c = state.cfg;
    const rows = FUNCS.map((f, i) => `<tr><td>${funcName(i)}</td><td>${c.pins[i] === PIN_NONE ? '<span class="dim">not set</span>' : 'GP' + c.pins[i]}</td></tr>`).join('') +
      `<tr><td>Whammy</td><td>${c.whammyCh === PIN_NONE ? '<span class="dim">not set</span>' : 'GP' + (26 + c.whammyCh)}</td></tr>
       <tr><td>Tilt switch</td><td>${c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin : '<span class="dim">off</span>'}</td></tr>
       <tr><td>RGB LEDs</td><td>${c.rgbEnabled && c.rgbPin !== PIN_NONE ? 'GP' + c.rgbPin : '<span class="dim">off</span>'}</td></tr>
       <tr><td>Bluetooth</td><td>${c.btEnabled ? 'on' : 'off'}</td></tr>`;
    card.innerHTML = head + `<table class="sum">${rows}</table>
      <p class="dim small" style="margin-top:14px">Try every input: the guitar above lights up as you press. Debounce and whammy feel are on the Tune page.</p>
      <div class="step-nav">
        <button class="btn quiet" id="bRedo">Start over</button>
        <button class="btn primary lg" id="bSave">Save to controller</button></div>`;
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

function assignButton(step, pin) {
  if (stepCtx.locked) return;
  stepCtx.locked = true;
  state.cfg.pins[step.func] = pin;
  pushCfg();
  setResult('ok', `${step.title} is on <span class="chip">GP${pin}</span>`);
  renderStepList();
  setTimeout(() => { if (STEPS[state.step] === step) goStep(state.step + 1); }, 850);
}

function tickStep(s) {
  if (state.view !== 'setup' || !state.dev) return;
  const step = STEPS[state.step];
  if (step.kind === 'button' && stepCtx.detector && !stepCtx.locked) {
    const r = stepCtx.detector.feed(s);
    if (!r) return;
    if (r.pin !== undefined) assignButton(step, r.pin);
    else if (r.ambiguous) setResult('bad', `Several inputs moved at once (${r.ambiguous.map((p) => 'GP' + p).join(', ')}). Press only the ${step.title.toLowerCase()}.`);
    else if (r.used) {
      const who = state.cfg.pins.findIndex((p) => p === r.used[0]);
      setResult('bad', `<span class="chip">GP${r.used[0]}</span> is already ${who >= 0 ? 'the ' + funcName(who).toLowerCase() : 'in use'}. Press a different control.`);
    }
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
      if (stepCtx.assign[f] >= 0 || !hit(state.cfg.pins[f])) continue;
      stepCtx.assign[f] = stepCtx.idx;
      next();
      break;
    }
  } else if (step.kind === 'tilt' && stepCtx.active && stepCtx.detector) {
    const r = stepCtx.detector.feed(s);
    if (!r) return;
    if (r.pin !== undefined) {
      state.cfg.tiltPin = r.pin; pushCfg(); stepCtx.active = false;
      setResult('ok', `Tilt switch on <span class="chip">GP${r.pin}</span>`);
      toast('Tilt switch registered', 'ok');
    } else if (r.ambiguous) setResult('bad', 'Several inputs moved at once. Tilt only the guitar.');
    else if (r.used) setResult('bad', `<span class="chip">GP${r.used[0]}</span> is already used by another control.`);
  }
}

async function saveToController() {
  const b = $('#bSave');
  try {
    if (b) b.disabled = true;
    await state.dev.setConfig(state.cfg);
    await state.dev.save();
    await sleep(400);
    const s = await state.dev.getStatus();
    if (!s.saveOk) throw new Error('flash write failed');
    toast('Saved to the controller', 'ok');
  } catch (e) {
    toast('Save failed: ' + e.message, 'bad');
  } finally { if (b) b.disabled = false; }
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
  const live = () => { refresh(); $('#tuneState').textContent = 'Live changes, not saved yet.'; pushCfg(); };
  dt.oninput = () => { c.debounce100us = +dt.value; live(); };
  ws.oninput = () => { c.whammySmooth = +ws.value; live(); };
  wd.oninput = () => { c.whammyDeadzone = +wd.value; live(); };
  $('#combStrum').onchange = (e) => { c.combinedStrum = e.target.checked; live(); };
  $('#wInv').onchange = (e) => { c.whammyInvert = e.target.checked; live(); };
  $('#debPresets').onclick = (e) => { const b = e.target.closest('[data-deb]'); if (b) { c.debounce100us = +b.dataset.deb; dt.value = c.debounce100us; live(); } };
  $('#saveTune').onclick = async () => { await saveToController(); $('#tuneState').textContent = 'Saved to the controller.'; };
  $('#resetCfg').onclick = async () => {
    if (!confirm('Reset every setting (pins, whammy, tuning, lights and modes) to factory defaults?')) return;
    await state.dev.defaults(); await state.dev.save(); await sleep(300);
    state.cfg = await state.dev.getConfig(); state.step = 0; buildUi(); toast('Reset to defaults', 'ok');
  };
  refresh();
  buildTilt();
  buildRumble();
}

// ------------------------------------------------------------------ rumble (firmware 0.30+)
function buildRumble() {
  const c = state.cfg, body = $('#rumbleBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5 || !(state.info.major > 0 || state.info.minor >= 30)) {
    body.innerHTML = '<p class="notice small">Rumble needs firmware 0.30 or newer. Update the firmware on the Flash page.</p>';
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
  const live = () => { $('#tuneState').textContent = 'Live changes, not saved yet.'; pushCfg(); };
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

function buildTilt() {
  const c = state.cfg, body = $('#tiltBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5) {
    body.innerHTML = '<p class="notice small">Tilt sensors need firmware 0.29 or newer. Update the firmware on the Flash page.</p>';
    return;
  }
  const own = new Set(accelPins());
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), c.rumblePin ?? PIN_NONE].filter((p) => p !== PIN_NONE && !own.has(p)));
  const pairs = [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !(p & 1) && i2cPinsOk(p, p + 1) && !taken.has(p) && !taken.has(p + 1));
  const accelOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const srcOpts = (i) => {
    const other = c.atilt[1 - i].src;
    return '<option value="255">Off</option>' + ATILT_SOURCES.map((s) => {
      const busy = (s.kind === 'adc' && s.id === c.whammyCh) || (s.id === other && other !== PIN_NONE);
      const needs = s.kind !== 'adc' && !accelOn;
      if (needs && c.atilt[i].src !== s.id) return '';
      const note = s.id === c.whammyCh ? ' (whammy bar)' : s.id === other ? ' (other sensor)' : s.kind === 'lis' ? ' (LIS3DH only)' : '';
      return `<option value="${s.id}" ${busy ? 'disabled' : ''}>${s.name}${note}</option>`;
    }).join('');
  };
  const restOf = (t) => (t.invert ? t.max : t.min), tiltOf = (t) => (t.invert ? t.min : t.max);
  body.innerHTML = `
    <div class="tilt-accel">
      <div class="opt first"><div><h3>Accelerometer</h3><p class="dim">I²C module: SDA on the even pin, SCL on the next one, VCC to 3V3(OUT), GND to GND.</p></div>
        <select id="accPins"><option value="255">None</option>${pairs.map((p) => `<option value="${p}">SDA GP${p}, SCL GP${p + 1}</option>`).join('')}</select></div>
      ${accelOn ? `
      <div class="tilt-readout" style="margin-top:8px"><span>Chip: <b id="accType">looking…</b></span><span class="dim">1 g = 1024 counts, 2048 = level</span></div>
      <div class="tilt-axes">${['X', 'Y', 'Z'].map((a, i) => `<div>${a} <span id="accV${i}">–</span><div class="bar"><i id="accB${i}"></i></div></div>`).join('')}</div>
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
  const live = () => { $('#tuneState').textContent = 'Live changes, not saved yet.'; pushCfg(); };
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
  if (state.status) updateTilt(state.status);
}

function updateTilt(s) {
  const c = state.cfg;
  if (!c?.atilt || (c.cfgVersion ?? 0) < 5 || !$('#tiltBody')) return;
  const ty = $('#accType');
  if (ty) {
    ty.textContent = s.accelType ? ACCEL_TYPES[s.accelType] || 'unknown' : 'none found, check the wiring';
    for (let i = 0; i < 3; i++) {
      const v = s.accelRaw[i], ok = v !== 0xffff;
      $('#accV' + i).textContent = ok ? ((v - 2048) / 1024).toFixed(2) + ' g' : '–';
      $('#accB' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  tiltStates(s).forEach((t, i) => {
    const st = $('#tSt' + i), bar = $('#tBar' + i), raw = $('#tRaw' + i);
    if (!st) return;
    const src = c.atilt[i].src;
    st.textContent = src === PIN_NONE ? 'off' : t.value == null ? (t.raw == null ? 'no reading' : 'calibrate') : t.whammy ? 'whammy ' + Math.round(t.value * 100) + ' %' : t.star ? 'STAR POWER' : 'level';
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
        buildUi();
        toast(`Restored ${chosen.length === SECTIONS.length ? 'all settings' : chosen.map((id) => SECTIONS.find((x) => x.id === id).name.toLowerCase()).join(', ')} and saved to the controller`, 'ok');
      } catch (err) { toast('Restore failed: ' + err.message, 'bad'); }
    };
  };
}

// ------------------------------------------------------------------ lights
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
  return `<p class="dim small">Brightness is limited to ${m} with ${c.noFretLeds ? 'strum LEDs only' : 'fret and strum LEDs together'}, to keep the current the LED chain draws in check.</p>`;
}
// LED layout controls (setup wizard and Lights page): fret LEDs on / off, how many strum LEDs, wiring order
const STRUM_COUNTS = ['None', '1', '2 (1 per side)', '3', '4 (corners)', '5', '6', '7', '8 (4 per side)'];
function ledLayoutControls(c, pfx = 'lay') {
  const l = ledLayout(c);
  return `<div class="opt"><div><h3>Fret LEDs</h3><p class="dim">One LED under each of the five frets.</p></div>
      <label class="switch"><input type="checkbox" id="${pfx}Frets" ${l.frets ? 'checked' : ''}><i></i></label></div>
    <div class="opt"><div><h3>Strum bar LEDs</h3><p class="dim">LEDs on the strum bar, on the same chain. They light up when you strum.</p></div>
      <select id="${pfx}Strum">${STRUM_COUNTS.map((t, n) => `<option value="${n}" ${n === l.strum ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${l.frets && l.strum ? `<div class="opt"><div><h3>Wiring order</h3><p class="dim">Which LEDs come first on the chain, starting from the data pin.</p></div>
      <select id="${pfx}Order"><option value="0" ${!l.strumFirst ? 'selected' : ''}>Frets first</option><option value="1" ${l.strumFirst ? 'selected' : ''}>Strum LEDs first</option></select></div>` : ''}
    ${!l.frets && !l.strum ? '<p class="dim small">Choose fret LEDs, strum LEDs or both.</p>' : ''}`;
}
function wireLedLayout(c, changed, pfx = 'lay') {
  const set = (patch) => { const l = ledLayout(c); applyLedLayout(c, { frets: l.frets, strum: l.strum, strumFirst: l.strumFirst, ...patch }); changed(); };
  $(`#${pfx}Frets`)?.addEventListener('change', (e) => set({ frets: e.target.checked }));
  $(`#${pfx}Strum`)?.addEventListener('change', (e) => set({ strum: +e.target.value }));
  $(`#${pfx}Order`)?.addEventListener('change', (e) => set({ strumFirst: e.target.value === '1' }));
}
// chain position -> what sits there
function chainLabels(c) {
  const l = ledLayout(c);
  return [...Array(l.chain).keys()].map((p) => {
    const f = l.frets ? c.ledMap.indexOf(p) : -1;
    if (f >= 0) return { fret: f, color: c.colors[f], name: funcName(f) };
    const k = c.strumMap.slice(0, l.strum).indexOf(p);
    return { strum: k, color: c.strumColor || '#ffffff', name: `Strum ${k + 1}` };
  });
}

function buildLights() {
  const c = state.cfg;
  const $on = $('#rgbOn'), $pin = $('#rgbPin'), $bri = $('#rgbBri'), $spd = $('#fxSpeed');
  const used = new Set(assignedPins());
  $pin.innerHTML = '<option value="255">Choose pin…</option>' +
    [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.rgbPin).map((p) => `<option value="${p}">GP${p}</option>`).join('');
  $('#fxList').innerHTML = EFFECTS.map((e) => `<label><input type="radio" name="fx" value="${e.id}"><div><b>${e.name}</b><span class="dim">${e.desc}</span></div></label>`).join('');
  $('#presets').innerHTML = RGB_PRESETS.map((p, i) => `<button class="preset" data-preset="${i}">${p.colors.map((x) => `<i style="background:${x}"></i>`).join('')}<span>${p.name}</span></button>`).join('');
  $('#colRows').innerHTML = [0, 1, 2, 3, 4].map((f) => `<div class="col-row"><span><span class="fretdot" style="background:${FRET_DEFAULT_COLORS[f]}"></span>${funcName(f)}</span>
      <input type="color" data-col="${f}"><span class="hex" data-hex="${f}"></span></div>`).join('');

  $('#ledType').innerHTML = LED_TYPES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#ledOrder').innerHTML = LED_ORDERS.map((o, i) => `<option value="${i}">${o}</option>`).join('');
  $('#ledClk').innerHTML = '<option value="255">Choose pin…</option>' +
    [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.ledClkPin).map((p) => `<option value="${p}">GP${p}</option>`).join('');
  const refresh = () => {
    $on.checked = c.rgbEnabled;
    $('#ledType').value = String(c.ledType); $('#ledTypeDesc').textContent = (LED_TYPES[c.ledType] || LED_TYPES[0]).desc;
    $('#ledOrder').value = String(c.ledOrder); $('#ledClk').value = String(c.ledClkPin);
    $('#ledOrderRow').style.display = c.ledType === 0 ? '' : 'none';
    $('#ledClkRow').style.display = c.ledType === 2 ? '' : 'none';
    $('#rgbSp').checked = !!c.rgbStarPower;
    $pin.value = String(c.rgbPin);
    $bri.max = maxBrightness(c); c.rgbBrightness = Math.min(c.rgbBrightness, maxBrightness(c));
    $bri.value = c.rgbBrightness; $('#rgbBriVal').textContent = c.rgbBrightness;
    $('#rgbBriNote').innerHTML = brightNote(c);
    $('#rgbFlash').checked = c.rgbBootFlash;
    $spd.value = c.rgbSpeed; $('#fxSpeedVal').textContent = c.rgbSpeed;
    document.querySelectorAll('input[name=fx]').forEach((r) => { r.checked = +r.value === c.rgbEffect; });
    document.querySelectorAll('[data-col]').forEach((i) => { i.value = c.colors[+i.dataset.col]; $(`[data-hex="${i.dataset.col}"]`).textContent = c.colors[+i.dataset.col].toUpperCase(); });
    for (const id of ['#rgbOpts', '#fxCard', '#colCard', '#mapCard', '#strumCard']) $(id).classList.toggle('rgb-disabled', !c.rgbEnabled);
    $('#colCard').classList.toggle('rgb-disabled', !c.rgbEnabled || !!c.noFretLeds);
    $('#mapView').innerHTML = chainLabels(c).map((l, p) => `${p ? '<span class="arrow">→</span>' : ''}<div class="led" ${l.fret !== undefined ? `data-fret="${l.fret}"` : `data-strum="${l.strum}"`} style="--c:${l.color}"><b style="background:${l.color}"></b>LED ${p + 1}<br>${l.name}</div>`).join('')
      || '<p class="dim">No LEDs set up: choose fret and / or strum LEDs under LED layout.</p>';
    applyColors();
  };
  const live = () => { refresh(); $('#lightsState').textContent = 'Live changes, not saved yet.'; pushCfg(); };

  $on.onchange = () => { c.rgbEnabled = $on.checked; live(); };
  $pin.onchange = () => { c.rgbPin = +$pin.value; live(); };
  $('#ledType').onchange = (e) => { c.ledType = +e.target.value; live(); };
  $('#ledOrder').onchange = (e) => { c.ledOrder = +e.target.value; live(); };
  $('#ledClk').onchange = (e) => { c.ledClkPin = +e.target.value; live(); };
  $('#rgbSp').onchange = (e) => { c.rgbStarPower = e.target.checked; live(); };
  $bri.oninput = () => { c.rgbBrightness = +$bri.value; live(); };
  $('#rgbFlash').onchange = (e) => { c.rgbBootFlash = e.target.checked; live(); };
  $spd.oninput = () => { c.rgbSpeed = +$spd.value; live(); };
  $('#fxList').onchange = (e) => { c.rgbEffect = +e.target.value; live(); };
  $('#colRows').oninput = (e) => { const f = e.target.dataset.col; if (f !== undefined) { c.colors[+f] = e.target.value; live(); } };
  $('#presets').onclick = (e) => { const b = e.target.closest('[data-preset]'); if (b) { c.colors = RGB_PRESETS[+b.dataset.preset].colors.slice(); live(); } };
  $('#mapWizard').onclick = () => { showView('setup'); goStep(STEPS.findIndex((s) => s.kind === 'ledmap')); };
  // LED layout: fret / strum LEDs, wiring order, strum colour and what each strum LED follows
  const drawLayout = () => {
    $('#layoutOpts').innerHTML = ledLayoutControls(c, 'lt');
    wireLedLayout(c, () => { drawLayout(); live(); }, 'lt');
    const n = c.strumLeds || 0;
    $('#strumOpts').innerHTML = n ? `<div class="col-row"><span>Strum LED colour</span><input type="color" id="strumCol" value="${c.strumColor || '#ffffff'}"><span class="hex" id="strumHex">${(c.strumColor || '#ffffff').toUpperCase()}</span></div>
      ${n > 1 ? `<div class="opt"><div><h3>Quick setup</h3><p class="dim">What the strum LEDs light up on. Fine-tune each one below.</p></div>
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
  $('#saveLights').onclick = async () => { await saveToController(); $('#lightsState').textContent = 'Saved to the controller.'; };
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
  $('#rxRow').hidden = (c.cfgVersion ?? 0) < 5 || !(state.info.major > 0 || state.info.minor >= 30);
  $('#xiRx').checked = !(c.xinputOpts & 1);
  $('#xiRx').onchange = (e) => { c.xinputOpts = (c.xinputOpts & ~1) | (e.target.checked ? 0 : 1); };

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
  $('#saveModes').onclick = async () => {
    try {
      await state.dev.setConfig(c); await state.dev.save(); await sleep(400);
      toast('Saved. Restarting the controller.', 'ok');
      await state.dev.reboot(false);
    } catch (e) { toast('Failed: ' + e.message, 'bad'); }
  };
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
      flash the latest <b>yagcc-…uf2</b> from the Flash page, or unplug it and hold <b>Plus</b> while plugging it back in.</div>`;
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
