import { BT_SLEEP_CHOICES, btSleepByte, DEV_NAME_MAX, DEV_NAME_DEFAULT, devNameBadChars, checkDevName,
  FUNCS, FUNC_LABEL, PIN_NONE, NUM_DIGITAL_PINS, NUM_FRETS, MODES, MODE_NONE, BOARDS, modeName, modeBaseName,
  DEBOUNCE_MODES, defaultConfig, whammyValue, isPressed, EFFECTS, RGB_PRESETS, FRET_DEFAULT_COLORS, NUM_LEDS, MAX_STRUM_LEDS, STRUM_ROLES, ledLayout, applyLedLayout, maxBrightness, effectZone,
  LED_TYPES, LED_ORDERS, KEY_SLOTS, KEYS, KEY_PRESETS,
  MAP_DEFAULT, MAP_NONE, ATILT_SOURCES, ACCEL2_MIN_MINOR, TILT_FUNC_MIN_MINOR, FUNC_STAR, ACCEL_TYPES, i2cPinsOk, tiltSourceRaw, tiltValue,
} from './protocol.js?v=dev';
import { YaccDevice, webusbSupported } from './usb.js?v=dev';
import { PinDetector, WhammyCalibrator } from './detect.js?v=dev';
import { createGuitar } from './guitar.js?v=dev';
import { renderHardware, renderCompat } from './pages.js?v=dev';
import { buildStudio, syncStudio } from './studio.js?v=dev';
import { responseHtml, wireResponse, rangeHtml, wireRange } from './response.js?v=dev';
import { createTestPage } from './testpage.js?v=dev';
import { TEST_MODES, testMode, modeFamily, outName, outputSupported, OUT_GROUPS, RANGE_SRC, stickDir } from './mapping.js?v=dev';
import { createExtras } from './extras.js?v=dev';
import { SECTIONS, makeBackup, backupFileName, readBackup, applyBackup, download } from './backup.js?v=dev';
import { t, localized, LANGS, getLang, setLang, isPseudo, applyI18n } from './i18n.js?v=dev';

const $ = (s, r = document) => r.querySelector(s);
const diff8 = (x, y) => (x - y + 256) & 0xff;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRET_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#fb923c'];
const MODE_USE = localized(() => ({   // one line per mode: where you'd use it
  10: t('modes.use.any_console_or_computer_finds'),
  11: t('modes.use.ps5_games_needs_p5general_dongle'),
  0: t('modes.use.windows_xbox_360_clone_hero'), 3: t('modes.use.rock_band_ps3_rpcs3_rock'), 1: t('modes.use.guitar_hero_ps3_ps2_rpcs3'),
  2: t('modes.use.macos_linux_android_emulators'), 4: t('modes.use.fortnite_festival_playstation_xbox_pc'), 5: 'Nintendo Switch, Fortnite Festival',
  6: t('modes.use.rock_band_wii_wii_u'), 7: t('modes.use.original_xbox_needs_adapter_cable'),
  8: t('modes.use.rock_band_4_ps4_ps5'), 9: t('modes.use.rock_band_4_xbox_one'),
}));

// macOS has no driver for Xbox 360 (XInput) controllers, so nothing on a Mac sees XInput mode
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') && !/iphone|ipad/i.test(navigator.userAgent);
// modes this firmware has (Auto needs 0.30)
const fwAtLeast = (n) => !!state.info && (state.info.major > 0 || state.info.minor >= n);
// the digital tilt switch: normally open (pressed = pin low) or, with firmware 0.33+, normally closed (pressed = pin high)
const tiltInverted = () => !!state.cfg?.tiltInvert && fwAtLeast(33);
const tiltSwitchActive = (s, c = state.cfg) => !!c && c.tiltEnabled && c.tiltPin !== PIN_NONE && isPressed(s, c.tiltPin) !== tiltInverted();
// firmware 0.41+: each tilt input (switch, sensor 1, sensor 2) can press any function, not just star power
const tiltFuncOk = () => fwAtLeast(TILT_FUNC_MIN_MINOR);
const tiltFuncOf = (i, c = state.cfg) => (tiltFuncOk() ? c?.tiltFunc?.[i] ?? FUNC_STAR : FUNC_STAR);
// <option>s of the "Acts as" pickers: inputs grouped as Frets / Strum / Buttons (star power first, whammy optional)
function tiltFuncOptions(sel, whammy) {
  const o = (v, name) => `<option value="${v}" ${String(sel) === String(v) ? 'selected' : ''}>${name}</option>`;
  const grp = (label, ids) => `<optgroup label="${label}">${ids.map((f) => o(f, funcName(f))).join('')}</optgroup>`;
  const star = o(FUNC_STAR, t('common.star_power'));
  const more = tiltFuncOk() ? grp(t('common.frets'), [0, 1, 2, 3, 4]) + grp(t('assign.strum'), [5, 6]) + grp(t('common.buttons'), [FUNCS.indexOf('plus')]) : '';
  return (whammy ? o('w', t('common.whammy')) : '') + star + more;
}
// ---- firmware 0.42+: a tilt input can be assigned to any gamepad output (per-mode input mapping, cfg.ext.map)
const tiltMapUi = () => fwAtLeast(42) && !!state.cfg?.ext?.map;
const MAP_MODES = localized(() => (TEST_MODES.filter((m) => !m.keyboard).map((m) => m.id)));   // the modes that have a map row
const runMode = () => { const m = state.status?.modeRow >= 0 ? state.status.modeRow : state.info?.mode; return testMode(m) && !testMode(m).keyboard ? m : TEST_MODES[0].id; };
// the explicit output a tilt source (10 switch, 11 / 12 sensors) has in the running mode, or null = the Tune behaviour
const tiltMapOut = (src, c = state.cfg) => { if (!tiltMapUi()) return null; const v = c.ext.map[runMode()]?.[src]; return v == null || v === MAP_DEFAULT ? null : v; };
const PS_SHAPE = ['×', '○', '□', '△'];
const AXIS_NAME = localized(() => ({ 18: t('assign.left_stick_left_right_axis'), 19: t('assign.left_stick_up_down_axis'), 20: t('assign.right_stick_left_right_axis'), 21: t('assign.right_stick_up_down_axis') }));
function outPickLabel(o, mode) {
  if (AXIS_NAME[o]) return AXIS_NAME[o];
  const nm = outName(o, mode);
  if (o >= 1 && o <= 4 && modeFamily(mode) === 'ps') return PS_SHAPE[o - 1] + ' ' + nm;
  return o === 7 || o === 8 ? t('assign.full_press', { nm }) : nm;
}
const outIsAnalog = (o) => o >= 18;
// what a tilt source is assigned to: 'f:<func>' / 'f:w' (Tune behaviour), 'o:<output>', 'none' or 'mixed'
function assignValue(src, c = state.cfg) {
  const vals = MAP_MODES.map((m) => c.ext.map[m][src]);
  if (vals.every((v) => v === MAP_DEFAULT)) return src === 10 ? 'f:' + tiltFuncOf(0, c) : c.atilt[src - 11].target === 0 ? 'f:w' : 'f:' + tiltFuncOf(src - 10, c);
  const cand = vals.find((v) => v >= 1 && v <= 31);
  if (cand == null) return vals.every((v) => v === MAP_NONE) ? 'none' : 'mixed';
  return MAP_MODES.every((m, k) => vals[k] === cand || (!outputSupported(m, cand) && vals[k] === MAP_NONE)) ? 'o:' + cand : 'mixed';
}
function assignTilt(src, val, c = state.cfg) {
  const guitar = val.startsWith('f:'), o = guitar ? 0 : +val.slice(2);
  MAP_MODES.forEach((m) => { c.ext.map[m][src] = guitar ? MAP_DEFAULT : outputSupported(m, o) ? o : MAP_NONE; });
  c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR];
  if (src === 10) { if (guitar) c.tiltFunc[0] = +val.slice(2); return; }
  const tv = c.atilt[src - 11];
  if (!guitar) { if (tv.target === 0) tv.target = 1; }
  else if (val === 'f:w') tv.target = 0;
  else { tv.target = 1; c.tiltFunc[src - 10] = +val.slice(2); }
}
const assignKind = (v) => (v === 'f:w' ? 'w' : v.startsWith('f:') ? 'func' : v.startsWith('o:') ? (outIsAnalog(+v.slice(2)) ? 'analog' : 'digital') : v);
function assignSelect(src, label) {
  const v = assignValue(src), mode = runMode();
  const o = (val, name) => `<option value="${val}" ${v === val ? 'selected' : ''}>${name}</option>`;
  const grp = (name, items) => `<optgroup label="${name}">${items.join('')}</optgroup>`;
  const guitar = [o('f:' + FUNC_STAR, t('assign.star_power_default')), ...(src > 10 ? [o('f:w', t('common.whammy'))] : []),
    ...[0, 1, 2, 3, 4, 5, 6].map((f) => o('f:' + f, funcName(f))), o('f:' + FUNCS.indexOf('plus'), funcName(FUNCS.indexOf('plus')))];
  const any = (out) => MAP_MODES.some((m) => outputSupported(m, out));
  const pads = OUT_GROUPS.map((g) => grp(g.name, g.outs.filter(any).map((out) => o('o:' + out, outPickLabel(out, mode)))));
  const extra = v === 'mixed' ? `<option value="mixed" selected disabled>${t('assign.different_per_mode_see_test')}</option>` : v === 'none' ? `<option value="none" selected disabled>${t('assign.nothing_set_test_page')}</option>` : '';
  return `<select data-assign="${src}" aria-label="${t('assign.aria_label.assign', { label })}">${extra}${grp(t('assign.guitar'), guitar)}${pads.join('')}</select>`;
}
// firmware 0.44+: a 0..1 source (tilt switch, sensors) on a stick axis can rest at the centre or at the opposite end
const btSleepOk = () => fwAtLeast(45) && !!state.cfg?.ext;
const btSleepLabel = (v) => (v === 255 ? t('bt.never') : t('app.bt_sleep.minutes', { n: v || 2 }));
const rangeOk = () => fwAtLeast(44) && !!state.cfg?.ext?.range;
const rangeFor = (src, v) => { const d = v.startsWith('o:') ? stickDir(+v.slice(2)) : null; return rangeOk() && d ? rangeHtml(RANGE_SRC[src], state.cfg.ext.range[RANGE_SRC[src]], d) : ''; };
const assignNote = (v) => (v.startsWith('o:') || v === 'mixed') ? `<p class="dim small assign-note">${t('assign.applied_all_modes_fine_tune')}</p>` : '';
function wireAssign(root) {
  root.querySelectorAll('select[data-assign]').forEach((s) => (s.onchange = () => {
    assignTilt(+s.dataset.assign, s.value); pushCfg();
    if ($('#tiltSwBody')) buildTiltSwitch();
    tiltRebuild();
  }));
  root.querySelectorAll('[data-goto-test]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.querySelector('#nav [data-view="test"]')?.click(); }));
}
// the functions the tilt inputs hold down right now (never star power: that keeps its own tilt path), for live views
function tiltFuncSet(s, c = state.cfg) {
  const out = new Set();
  if (!c || !s || !tiltFuncOk()) return out;
  const sw = tiltFuncOf(0, c);
  if (sw !== FUNC_STAR && tiltSwitchActive(s, c) && tiltMapOut(10, c) == null) out.add(sw);
  tiltStates(s).forEach((tv) => { if (tv.press && tv.func !== FUNC_STAR) out.add(tv.func); });
  return out;
}
const availableModes = () => MODES.filter((m) => !m.min || (state.info && (state.info.major > 0 || state.info.minor >= m.min)));
// HOST_* in firmware auto_detect.h
const AUTO_HOSTS = ['', 'Windows', 'Xbox 360', 'Xbox One', 'PS3', 'PS4 / PS5', 'Switch', 'Wii', 'PS2', 'OG Xbox'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = { dev: null, info: null, cfg: null, status: null, step: 0, view: 'flash', connecting: false };

// ------------------------------------------------------------------ helpers
function toast(msg, kind = '') {
  const tv = document.createElement('div');
  tv.className = 'toast ' + kind;
  tv.textContent = msg;
  $('#toasts').appendChild(tv);
  setTimeout(() => tv.remove(), 4200);
}

function showView(v) {
  state.view = v;
  scrollTo(0, 0);
  document.querySelectorAll('.view').forEach((e) => e.classList.toggle('active', e.id === 'view-' + v));
  document.querySelectorAll('#nav [data-view]').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('active', on); if (on) { b.setAttribute('aria-current', 'page'); try { const n = b.parentElement; if (n.scrollWidth > n.clientWidth) n.scrollLeft = Math.max(0, b.offsetLeft - (n.clientWidth - b.offsetWidth) / 2); } catch { /* ignore */ } } else b.removeAttribute('aria-current'); });
  $('#helpBtn').classList.toggle('active', v === 'hardware' || v === 'compat');
  closeHelp();
  updateBar();
  if (v !== 'setup' && v !== 'lights') { stopLedTest(); if (stepCtx.timer) { clearInterval(stepCtx.timer); stepCtx.timer = 0; state.dev?.ledTest(-1).catch(() => {}); } }
  if (v === 'setup') renderStep();
  if (state.dev && state.cfg) {           // pick up anything changed on other pages
    if (v === 'tune') buildTune();
    if (v === 'lights') buildLights();
    if (v === 'modes') buildModes();
    if (v === 'test' && fwAtLeast(42)) testPage.refresh();
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

// "a, b and c" in the language's own list style (falls back to commas where Intl.ListFormat is missing)
const sectionList = (names) => { try { return new Intl.ListFormat(isPseudo() ? 'en' : getLang(), { style: 'long', type: 'conjunction' }).format(names); } catch { return names.join(', '); } };
const funcName = (i) => FUNC_LABEL[FUNCS[i]];
const hostPins = (c = state.cfg) => (c.hostPin !== undefined && c.hostPin !== PIN_NONE ? [c.hostPin, c.hostPin + 1] : []);
const portPins = (c = state.cfg) => [...(c.ps2Pins || []), c.wiiSda ?? PIN_NONE, c.wiiScl ?? PIN_NONE].filter((p) => p !== PIN_NONE);
const accelPins = (c = state.cfg) => (c.accelSda !== undefined && c.accelSda !== PIN_NONE ? [c.accelSda, c.accelScl] : []);
// firmware 0.42+: the optional D-pad / Select / Home / stick click pins live in cfg.ext
const extPinList = (c = state.cfg) => (c?.ext ? c.ext.extPins.filter((p) => p !== PIN_NONE) : []);
const assignedPins = () => [...state.cfg.pins, state.cfg.tiltPin, ...hostPins(), ...accelPins(), state.cfg.rumblePin ?? PIN_NONE, ...portPins(), ...extPinList()].filter((p) => p !== PIN_NONE);
const isConfigured = (cfg) => cfg.pins.some((p) => p !== PIN_NONE);

let pushTimer = 0;
// ---- custom controller name (firmware 0.46+, ext bytes 328..343): one field in the last Setup step, one on Tune
const nameOk = () => fwAtLeast(46) && !!state.cfg?.ext;
const escAttr = (tv) => String(tv).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function nameFieldHtml(id) {
  const n = state.cfg.ext.devName || '';
  return `<div class="namefield" data-namefield>
    <label class="field-label" for="${id}">${t('name.controller_name_optional')}</label>
    <div class="namerow"><input type="text" id="${id}" class="nameinp" maxlength="${DEV_NAME_MAX}" placeholder="${DEV_NAME_DEFAULT}" value="${escAttr(n)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="${id}Msg">
      <span class="namecnt dim" data-namecnt aria-live="off">${n.length} / ${DEV_NAME_MAX}</span></div>
    <p class="namemsg" id="${id}Msg" data-namemsg role="status" aria-live="polite" hidden></p>
    <p class="dim">${t('name.shows_up_as')}<b data-nameprev>${escAttr(t('name.guitar_controller', { name: n.trim() || DEV_NAME_DEFAULT }))}</b></p>
    <p class="dim small">${t('name.name_or_gamer_tag_instead', { name: DEV_NAME_DEFAULT, DEV_NAME_MAX })}</p>
  </div>`;
}
function wireNameField(id) {
  const inp = $('#' + id);
  if (!inp) return;
  inp.addEventListener('input', () => {
    const bad = devNameBadChars(inp.value);
    if (bad.length) inp.value = [...inp.value].filter((ch) => ch >= ' ' && ch <= '~').join('');
    const tv = checkDevName(inp.value);
    if (tv.ok && state.cfg.ext.devName !== tv.name) { state.cfg.ext.devName = tv.name; pushCfg(); }
    refreshNameFields(bad.length ? t('name.only_plain_keyboard_characters_work') : '', inp);
  });
}
function refreshNameFields(msg = '', active = null) {
  const n = state.cfg?.ext?.devName || '';
  document.querySelectorAll('[data-namefield]').forEach((f) => {
    const inp = f.querySelector('input');
    if (inp !== active && inp.value.trim() !== n) inp.value = n;
    f.querySelector('[data-namecnt]').textContent = inp.value.length + ' / ' + DEV_NAME_MAX;
    f.querySelector('[data-nameprev]').textContent = t('name.guitar_controller', { name: n || DEV_NAME_DEFAULT });
    const m = f.querySelector('[data-namemsg]');
    if (msg && inp === active) { m.textContent = msg; m.hidden = false; clearTimeout(m._t); m._t = setTimeout(() => { m.hidden = true; }, 6000); }
  });
}

function pushCfg() {
  checkDirty();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try { await state.dev?.setConfig(state.cfg); } catch (e) { toast(t('save.could_not_send_settings', { message: e.message }), 'bad'); }
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
  $('#sbText').textContent = saving ? t('save.saving') : restart ? t('save.have_unsaved_changes_guitar_saving') : t('save.have_unsaved_changes_guitar');
  $('#sbSave').textContent = restart ? t('save.save_restart') : t('save.save_guitar');
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
    if (!s.saveOk) throw new Error(t('save.flash_write_failed'));
    takeSnapshot();
    if (restart && state.view === 'modes') {
      toast(t('save.saved_restarting_controller'), 'ok');
      await state.dev.reboot(false);
    } else toast(restart ? t('save.saved_mode_changes_apply_when') : t('save.saved_guitar'), 'ok');
  } catch (e) {
    toast(t('save.save_failed', { message: e.message }), 'bad');
  } finally { saving = false; updateBar(); const b2 = $('#bSave'); if (b2) b2.disabled = false; }
}
async function undoChanges() {
  if (saving || !saved || !state.dev) return;
  clearTimeout(pushTimer);
  bpClose(false); stopLedTest();
  state.cfg = structuredClone(saved);
  try { await state.dev.setConfig(state.cfg); } catch (e) { toast(t('save.could_not_send_settings', { message: e.message }), 'bad'); }
  buildUi();
  checkDirty();
  toast(t('save.changes_undone'), 'ok');
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
    el.innerHTML = `${t('adv.more_options', { list: names.join(', ') })}<button type="button" class="linklike" data-adv-on>${t('common.turn_advanced')}</button>`;
  };
  const set = (v) => v !== undefined && v !== PIN_NONE;
  const tilt = keep('#tiltPanel', set(c.accelSda) || (c.atilt || []).some((tv) => tv.src !== PIN_NONE));
  const rumble = keep('#rumblePanel', set(c.rumblePin));
  hint('#tuneAdvHint', advOn(), [!tilt && t('adv.name_tilt_sensors'), !rumble && t('adv.name_rumble')].filter(Boolean));
  const rx = keep('#rxRow', c.xinputOpts & 4);
  const ports = keep('#portsPanel', (c.ps2Pins || []).some((p) => p !== PIN_NONE) || set(c.wiiSda) || (c.xinputOpts & 2));
  const needsHost = MODES.find((m) => m.id === c.usbMode)?.host || (c.bootModes || []).some((id) => MODES.find((m) => m.id === id)?.host);
  const host = keep('#hostPanel', set(c.hostPin) || needsHost);
  hint('#modesAdvHint', advOn(), [!rx && t('adv.steam_receiver_option'), !ports && t('adv.ps2_wii_ports'), !host && t('adv.usb_host_port')].filter(Boolean));
  const order = keep('#ledOrderRow', c.ledType === 2 || c.ledOrder !== 0);
  hint('#ledAdvHint', advOn() || order || c.ledType === 1 || !c.rgbEnabled, [t('adv.name_colour_order')]);
}
$('#advSw').addEventListener('change', (e) => {
  setAdv(e.target.checked);
  if (state.dev && state.cfg && state.view === 'lights') buildLights();   // refreshes the troubleshooting advice
  if (state.dev && state.cfg && state.view === 'setup' && ['bluetooth', 'extras'].includes(STEPS[state.step].kind)) renderStep();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-adv-on]');
  if (!b) return;
  setAdv(true);
  if (state.dev && state.cfg && state.view === 'lights') buildLights();
  if (state.dev && state.cfg && state.view === 'setup' && STEPS[state.step].kind === 'extras') renderStep();
  toast(t('app.misc.advanced_settings_are'), 'ok');
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
  const tf = tiltFuncSet(s, cfg);
  FUNCS.forEach((name, i) => {
    v.g.setMapped(name, cfg.pins[i] !== PIN_NONE || tf.has(i));
    v.g.setPressed(name, isPressed(s, cfg.pins[i]) || tf.has(i));
  });
  // tilt sensors add to the whammy (the larger wins) or press tilt, as in the firmware
  const ts = tiltStates(s);
  v.g.setWhammy(Math.max(cfg.whammyCh !== PIN_NONE ? whammyValue(s.adc[cfg.whammyCh], cfg) : 0, ...ts.map((tv) => (tv.whammy ? tv.value : 0))));
  v.g.setTilt((tiltSwitchActive(s, cfg) && tiltFuncOf(0, cfg) === FUNC_STAR && tiltMapOut(10, cfg) == null) || ts.some((tv) => tv.star));   // a tilt acting as another input lights that input instead
  if (v.pinsEl) {
    const used = new Set(assignedPins());
    [...v.pinsEl.children].forEach((d, p) => {
      d.classList.toggle('low', isPressed(s, p));
      d.classList.toggle('used', used.has(p));
    });
  }
}

// ------------------------------------------------------------------ Test page and extra controls (firmware 0.42+)
// The live value of every source (index = position in a mode's map row) for the Test page's mapping engine.
// A tilt input whose map entry is "mode default" keeps today's behaviour (presses its Tune page function, or feeds the
// whammy); one with its own entry becomes a source of its own.
const sensorOn = [false, false];
function liveSources(s, row, mode) {
  const c = state.cfg, e = c.ext, v = Array(22).fill(0), tp = [false, false];
  let tiltStar = false;
  FUNCS.forEach((_, i) => { v[i] = isPressed(s, c.pins[i]) ? 1 : 0; });
  v[9] = c.whammyCh !== PIN_NONE ? whammyValue(s.adc[c.whammyCh], c) : 0;
  for (let i = 13; i <= 18; i++) v[i] = isPressed(s, e.extPins[i - 13]) ? 1 : 0;
  v[21] = isPressed(s, e.extPins[6]) ? 1 : 0;
  if (s.stick) { v[19] = s.stick[0]; v[20] = s.stick[1]; }
  const press = (f) => { if (f === FUNC_STAR) { v[7] = 1; tiltStar = true; } else v[f] = 1; };
  const sw = tiltSwitchActive(s, c);
  if (row[10] === 0xff) { if (sw) press(tiltFuncOf(0, c)); } else v[10] = sw ? 1 : 0;
  (c.atilt || []).forEach((tv, i) => {
    const val = tiltValue(tiltSourceRaw(s, tv.src), tv);
    if (val == null) { sensorOn[i] = false; return; }
    const on = tv.threshold / 100;
    sensorOn[i] = sensorOn[i] ? val > on - 0.04 : val >= on;
    if (row[11 + i] === 0xff) {
      if (tv.target === 0) v[9] = Math.max(v[9], val < c.whammyDeadzone / 100 ? 0 : val);
      else if (sensorOn[i]) press(tiltFuncOf(1 + i, c));
    } else { v[11 + i] = val; tp[i] = sensorOn[i]; }
  });
  return { v, tp, tiltStar };
}
// keyboard mode: which of the 11 key slots (frets, strum, star power, plus, tilt, whammy past half) are held right now
function keyLive(s) {
  const c = state.cfg, out = c.pins.slice(0, 9).map((p) => isPressed(s, p));
  out[9] = tiltSwitchActive(s, c) || tiltStates(s).some((tv) => tv.press);
  out[10] = liveWhammy(s, c) > 0.5;
  return out;
}
const testPage = createTestPage({ state, $, toast, pushCfg: () => pushCfg(), makeViewer: (...a) => makeViewer(...a), liveSources, fwAtLeast, keyLive });
// ADC channels the stick can't use: the whammy's and any analog tilt sensor's
const whammyChannels = () => {
  const c = state.cfg, b = new Set();
  if (c.whammyCh !== PIN_NONE) b.add(c.whammyCh);
  (c.atilt || []).forEach((tv) => { if (tv.src < 3) b.add(tv.src); });
  return b;
};
const extras = createExtras({ state, $, toast, pushCfg: () => pushCfg(), assignedPins: () => assignedPins(), whammyChannels, advOn: () => advOn(), rerender: () => renderStep() });
const EXTRAS_STEP = localized(() => ({ kind: 'extras', title: t('setup.extras.extras.title'), prompt: t('setup.extras.extras.prompt'), focus: [] }));
const TILTSENS_STEP = localized(() => ({ kind: 'tiltsens', title: t('common.tilt_sensors'), prompt: t('setup.steps.tiltsens.prompt'), focus: ['tilt'] }));
const tiltSensOk = () => fwAtLeast(29) && (state.cfg?.cfgVersion ?? 0) >= 5 && !!state.cfg?.atilt;
function syncSteps() {
  const has = STEPS.some((st) => st.kind === 'extras'), want = fwAtLeast(42);
  if (want && !has) STEPS.splice(STEPS.findIndex((st) => st.kind === 'review'), 0, EXTRAS_STEP);
  else if (!want && has) STEPS.splice(STEPS.findIndex((st) => st.kind === 'extras'), 1);
  const hasT = STEPS.some((st) => st.kind === 'tiltsens'), wantT = tiltSensOk();
  if (wantT && !hasT) STEPS.splice(STEPS.findIndex((st) => st.kind === 'tilt') + 1, 0, TILTSENS_STEP);
  else if (!wantT && hasT) STEPS.splice(STEPS.findIndex((st) => st.kind === 'tiltsens'), 1);
}
// "accelerometer Y -> star power" for each configured tilt sensor; '' when none is set
const tiltSrcName = (src) => (src < 3 ? t('tune.tilt.analog_gp', { pin: 26 + src }) : src < 6 ? t('tune.tilt.accelerometer', { axis: 'XYZ'[src - 3] }) : src < 9 ? `LIS3DH ADC ${src - 5}` : t('tune.tilt.accelerometer_2', { axis: 'XYZ'[src - 9] }));
function tiltDestName(c, i) {
  const v = tiltMapUi() ? assignValue(11 + i, c) : c.atilt[i].target === 0 ? 'f:w' : 'f:' + tiltFuncOf(1 + i, c);
  if (v === 'f:w') return 'whammy';
  if (v.startsWith('f:')) return +v.slice(2) === FUNC_STAR ? 'star power' : funcName(+v.slice(2)).toLowerCase();
  if (v.startsWith('o:')) return outPickLabel(+v.slice(2), runMode());
  return v === 'mixed' ? 'per mode' : 'nothing';
}
const tiltSensorsSummary = (c) => (c?.atilt || []).map((tv, i) => (tv.src === PIN_NONE ? '' : `${tiltSrcName(tv.src)} \u2192 ${tiltDestName(c, i)}`)).filter(Boolean).join(' \u00b7 ');
const extrasSummary = (c) => {
  if (!c.ext) return '';
  const n = c.ext.extPins.filter((p) => p !== PIN_NONE).length, st = c.ext.stickCh.some((ch) => ch !== PIN_NONE);
  return [n ? t('app.extras_summary.pin_count', { n }) : '', st ? 'stick' : ''].filter(Boolean).join(' · ');
};

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
  banner.innerHTML = `<div class="fw-inner"><span>${t('update.firmware_update_available_guitar_runs', { major: info.major, minor: info.minor, major2: latest.major, minor2: latest.minor })}</span>
    <span class="row"><button class="btn primary small" id="fwGo">${t('update.update')}</button><button class="btn small" id="fwLater">${t('update.not_now')}</button></span></div>`;
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
    b.innerHTML = `<div class="fw-inner"><span>${t('update.configurator_was_updated_reload_page')}</span>
      <span class="row"><button class="btn primary small" id="siteReload">${t('update.reload')}</button></span></div>`;
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
    $('#connText').innerHTML = `<span class="seg-item">${BOARDS[state.info.board] ?? t('conn.board')}</span><span class="seg-item">${state.info.setupSession ? t('common.setup') : state.info.xinputFallback ? 'XInput → HID' : state.info.autoHost ? t('conn.auto', { v: AUTO_HOSTS[state.info.autoHost] || '?', v2: m ? m.short : '?' }) : m ? m.short : '?'}</span><span class="seg-item mono${state.fwOutdated ? ' old' : ''}" title="${state.fwOutdated ? t('conn.fw_newer_title') : t('conn.fw_version_title')}">v${state.info.major}.${state.info.minor}</span>`;
  } else {
    pill.classList.remove('on');
    $('#connText').textContent = state.connecting ? t('conn.connecting') : t('conn.not_connected');
  }
  const on = !!state.dev;
  document.querySelectorAll('#nav [data-needs-dev]').forEach((b) => {
    b.classList.toggle('nav-off', !on);
    if (on) b.removeAttribute('title'); else b.title = t('conn.connect_controller_first');
  });
  $('#heroConnect').hidden = on;
  $('#heroNext').hidden = !on;
  if (on && state.cfg) {
    const done = isConfigured(state.cfg);
    $('#heroNextTitle').textContent = t('conn.guitar_connected');
    $('#heroNextText').textContent = done ? t('conn.already_set_up_next_review') : t('conn.next_set_up_buttons_takes');
    $('#heroNextBtn').textContent = done ? t('conn.review_setup') : t('conn.set_up_buttons');
  }
  $('#setupGate').style.display = on ? 'none' : '';
  $('#setupMain').style.display = on ? '' : 'none';
  $('#tuneGate').style.display = on ? 'none' : '';
  $('#tuneMain').style.display = on ? '' : 'none';
  $('#backupGate').style.display = on ? 'none' : '';
  $('#backupMain').style.display = on ? '' : 'none';
  $('#lightsGate').style.display = on ? 'none' : '';
  $('#lightsMain').style.display = on ? '' : 'none';
  $('#modesGate').style.display = on ? 'none' : '';
  $('#modesMain').style.display = on ? '' : 'none';
  $('#testGate').style.display = on ? 'none' : '';
  $('#testMain').style.display = on ? '' : 'none';
  const tn = document.querySelector('#nav [data-view="test"]');
  if (tn) tn.hidden = !!(on && !fwAtLeast(42));   // the Test page needs firmware 0.42
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
    syncSteps();
    state.step = isConfigured(state.cfg) ? STEPS.length - 1 : 0;
    device.addEventListener('status', (e) => onStatus(e.detail));
    device.addEventListener('lost', onLost);
    device.startPolling();
    buildUi();
    takeSnapshot();
    updatePill();
    toast(t('conn.controller_connected'), 'ok');
    if (state.info.xinputFallback)
      toast(t('conn.this_computer_has_no_xinput'), 'ok');
    checkFirmware();
    if (navigate) showView('setup');
  } catch (e) {
    state.dev = null;
    toast(t('conn.could_not_open_controller', { message: e.message, v: navigator.userAgent.includes('Windows') ? t('conn.windows_winusb_driver_may_still') : '' }), 'bad');
  } finally {
    state.connecting = false; updatePill();
  }
}

function onLost() {
  state.dev = null; state.info = null; state.fwOutdated = false; syncSteps();
  saved = null; dirty = false; saving = false; updateBar();
  $('#fwBanner').hidden = true;
  setTimeout(scanHid, 1500);
  updatePill();
  toast(t('conn.controller_disconnected'));
}

async function pickAndConnect() {
  try {
    const d = await YaccDevice.pick();
    await connect(d, { navigate: true });
  } catch (e) {
    if (e.name !== 'NotFoundError') toast(t('conn.connection_failed', { message: e.message }), 'bad');
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
  if (state.view === 'test' && state.cfg?.ext) testPage.update(s);
  for (const v of viewers) if (v.container.offsetParent !== null) updateViewer(v, s);
  tickStep(s);
}

// ------------------------------------------------------------------ guided setup
const STEPS = localized(() => ([
  { kind: 'buttons', group: t('setup.steps.buttons.group'), title: t('common.buttons'), prompt: t('setup.steps.buttons.prompt'), focus: [] },
  { kind: 'whammy', title: t('setup.steps.whammy.title'), prompt: t('setup.steps.whammy.prompt'), focus: ['whammy'] },
  { kind: 'rgb', group: t('common.lights'), title: t('setup.steps.rgb.title'), prompt: t('setup.steps.rgb.prompt'), focus: [] },
  { kind: 'ledmap', title: t('common.led_order'), prompt: t('setup.steps.ledmap.prompt'), focus: [] },
  { kind: 'bluetooth', group: t('setup.steps.bluetooth.group'), title: 'Bluetooth', prompt: t('setup.steps.bluetooth.prompt'), focus: [] },
  { kind: 'tilt', title: t('common.tilt_switch'), prompt: t('setup.steps.tilt.prompt'), focus: ['tilt'] },
  { kind: 'review', group: t('setup.steps.review.group'), title: t('setup.steps.review.title'), prompt: t('setup.steps.review.prompt'), focus: [] },
]));

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
  if (fwAtLeast(42) && state.cfg?.ext && $('#testBody')) {
    testPage.build();
    testPage.attachViewer(makeViewer($('#testStage'), false, false, (n) => testPage.onPart(n)));
  }
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
  if (st.kind === 'rgb') return c.rgbEnabled ? [['WS2812B', 'SK6812', 'APA102'][c.ledType] || 'WS2812B', c.rgbPin === PIN_NONE ? '' : 'GP' + c.rgbPin].filter(Boolean).join(' \u00b7 ') : t('common.off');
  if (st.kind === 'ledmap') return c.rgbEnabled ? '' : 'n/a';
  if (st.kind === 'bluetooth') return c.btEnabled ? t('common.on') : t('common.off');
  if (st.kind === 'extras') return extrasSummary(c);
  if (st.kind === 'tiltsens') return c.atilt.some((tv) => tv.src !== PIN_NONE) ? c.atilt.filter((tv) => tv.src !== PIN_NONE).map((tv) => (tv.src < 3 ? 'GP' + (26 + tv.src) : 'accel')).join(' + ') : t('setup.steps.skipped');
  if (st.kind === 'tilt') return c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin + (c.tiltInvert && fwAtLeast(33) ? ' NC' : '') : t('common.off');
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
  if (step.kind !== 'tiltsens') qSlotPref = -1;
  stageViewer.g.setFocus(step.focus);
  renderStepList();
  const head = `<div class="step-count">${state.step + 1} / ${STEPS.length}</div>
    <h2 class="step-title">${step.title}</h2><p class="step-prompt">${step.prompt}</p>`;

  const nav = (extra = '') => `<div class="step-nav">
      <button class="btn quiet" id="bBack" ${state.step === 0 ? 'disabled' : ''}>${t('setup.common.back')}</button>
      <div class="row">${extra}</div></div>`;
  const wireNav = () => { $('#bBack')?.addEventListener('click', () => goStep(state.step - 1)); $('#bSkip')?.addEventListener('click', () => goStep(state.step + 1)); };

  if (step.kind === 'buttons') {
    // Nothing listens here until the user presses a Set button: every prompt is opened on purpose (see bpOpen).
    btnUndo = null;
    const draw = () => {
      const c = state.cfg, n = c.pins.filter((p) => p !== PIN_NONE).length;
      const tiles = FUNCS.map((f, i) => {
        const pin = c.pins[i], nm = btnName(i);
        return `<div class="bt ${pin !== PIN_NONE ? 'set' : ''} ${i < NUM_FRETS ? 'fret' : ''}" data-f="${i}" style="--c:${btnColor(i)}">
          <div class="bt-ic">${btnIcon(i)}</div><div class="bt-name">${nm}</div>
          <div class="bt-pin">${pin !== PIN_NONE ? `<span class="chip">GP${pin}</span>` : `<span class="dim">${t('setup.buttons.not_set')}</span>`}</div>
          <div class="bt-act"><button class="btn small" data-set aria-label="${pin !== PIN_NONE ? t('setup.buttons.aria_label.change', { nm }) : t('setup.buttons.aria_label.set', { nm })}">${pin !== PIN_NONE ? t('setup.buttons.change') : t('setup.buttons.set')}</button>${pin !== PIN_NONE ? `<button class="btn small quiet" data-clear aria-label="${t('setup.buttons.aria_label.clear', { nm })}">${t('common.clear')}</button>` : ''}</div></div>`;
      }).join('');
      const clearAll = !n ? '' : stepCtx.confirmAll
        ? `<span class="bt-confirm" role="alertdialog" aria-label="Clear all buttons?">${t('setup.buttons.clear_all', { length: FUNCS.length })}<button class="btn small danger" id="btYes">${t('setup.buttons.yes')}</button><button class="btn small quiet" id="btNo">${t('setup.buttons.no')}</button></span>`
        : `<button class="btn small quiet" id="btClearAll">${t('setup.buttons.clear_all_buttons')}</button>`;
      card.innerHTML = `${head}
        <div class="bt-top row">${t('setup.buttons.mapped', { n, length: FUNCS.length, v: n < FUNCS.length && n > 0 ? `<button class="btn primary" id="btMissing">${t('setup.buttons.map_missing_ones')}</button>` : '' })}
          <button class="btn ${n === 0 ? 'primary' : ''}" id="btAll">${t('setup.buttons.map_all_buttons')}</button>
          <span class="bt-spacer"></span>${clearAll}</div>
        <div class="bt-note" id="btNote" role="status" aria-live="polite">${btnUndo ? `${btnUndo.label} <button class="btn small" id="btUndo">${t('setup.buttons.undo')}</button>` : ''}</div>
        <div class="bt-grid">${tiles}</div>
        ${nav(`<button class="btn ${n ? 'primary' : ''}" id="bSkip">${n ? t('common.continue') : t('common.skip')}</button>`)}`;
      wireNav();
      card.querySelectorAll('.bt').forEach((tv) => {
        // hovering or focusing a tile points at that control on the guitar above
        const aim = (on) => { tv.classList.toggle('aim', on); if (!bp.open) stageViewer?.g.setFocus(on ? [FUNCS[+tv.dataset.f]] : []); };
        tv.addEventListener('mouseenter', () => aim(true)); tv.addEventListener('mouseleave', () => aim(false));
        tv.addEventListener('focusin', () => aim(true)); tv.addEventListener('focusout', () => aim(false));
        tv.querySelector('[data-set]').onclick = (e) => bpOpen(+tv.dataset.f, null, e.currentTarget);
        const cl = tv.querySelector('[data-clear]');
        if (cl) cl.onclick = () => {
          const f = +tv.dataset.f;
          btnUndo = { label: t('setup.buttons.cleared', { button: btnName(f) }), pins: { [f]: c.pins[f] } };
          c.pins[f] = PIN_NONE; pushCfg(); renderStepList(); draw();
          $(`.bt[data-f="${f}"] [data-set]`)?.focus();
        };
      });
      $('#btAll').onclick = (e) => bpOpen(0, FUNCS.map((_, i) => i), e.currentTarget);
      $('#btMissing')?.addEventListener('click', (e) => bpOpen(0, FUNCS.map((_, i) => i).filter((i) => c.pins[i] === PIN_NONE), e.currentTarget));
      $('#btClearAll')?.addEventListener('click', () => { stepCtx.confirmAll = true; draw(); $('#btNo').focus(); });
      $('#btNo')?.addEventListener('click', () => { stepCtx.confirmAll = false; draw(); $('#btClearAll')?.focus(); });
      $('#btYes')?.addEventListener('click', () => {
        btnUndo = { label: t('setup.buttons.cleared_all_buttons', { n }), pins: Object.fromEntries(c.pins.map((p, i) => [i, p]).filter(([, p]) => p !== PIN_NONE)) };
        c.pins.fill(PIN_NONE); stepCtx.confirmAll = false; pushCfg(); renderStepList(); draw(); $('#btAll').focus();
      });
      $('#btUndo')?.addEventListener('click', btnUndoNow);
    };
    btnRedraw = () => { draw(); renderStepList(); };
    draw();
  } else if (step.kind === 'whammy') {
    stepCtx.cal = new WhammyCalibrator();
    const have = state.cfg.whammyCh !== PIN_NONE;
    card.innerHTML = `${head}
      <div class="result ${have ? 'ok' : ''}" id="result">${have
        ? t('setup.whammy.calibrated_gp', { pin: 26 + state.cfg.whammyCh, whammyMin: state.cfg.whammyMin, whammyMax: state.cfg.whammyMax, v: state.cfg.whammyInvert ? t('setup.whammy.inverted') : '' })
        : `<span class="pulse"></span><span>${t('setup.whammy.waiting_bar_move')}</span>`}</div>
      <div class="dim small" style="margin-bottom:8px" id="wLabel">${have ? t('setup.whammy.live_input') : t('setup.whammy.sweeps_detected_0_2')}</div>
      <div class="bar"><i id="wBar" style="width:0"></i></div>
      <div class="adcs"><p class="adcs-note">${t('setup.whammy.raw_analog_inputs_one_bar')}</p>
        ${[0, 1, 2].map((c) => `<div class="adc-row" data-ch="${c}"><span class="chip">GP${26 + c}</span><div class="bar"><i></i></div><span class="val">0</span><button class="btn small quiet" data-use="${c}">${t('setup.whammy.use')}</button></div>`).join('')}
        <div class="row" id="wManual" style="margin-top:10px;display:none;flex-wrap:wrap">
          <span class="dim small" style="flex-basis:100%">${t('setup.whammy.manual_calibration_leave_bar_at')}</span>
          <button class="btn small" id="wCapRest">${t('setup.whammy.capture_rest')}</button><button class="btn small" id="wCapFull">${t('setup.whammy.capture_full')}</button><span class="muted" id="wCapInfo" style="font-size:12px"></span></div></div>
      ${nav(`<button class="btn quiet" id="wRedo">${t('setup.whammy.recalibrate')}</button><button class="btn ${have ? 'primary' : ''}" id="bSkip">${have ? t('common.continue') : t('common.skip')}</button>`)}`;
    wireNav();
    stepCtx.done = have;
    document.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
      stepCtx.cal.select(+b.dataset.use);
      stepCtx.done = false;
      stepCtx.manual = { ch: +b.dataset.use };
      $('#wManual').style.display = '';
      $('#wCapInfo').textContent = '';
      setResult('', `<span class="pulse"></span><span>${t('setup.whammy.using_gp_move_bar_through', { pin: 26 + +b.dataset.use })}</span>`);
    }));
    const capture = (which) => {
      const m = stepCtx.manual, s = state.status;
      if (!m || !s) return;
      m[which] = s.adc[m.ch];
      $('#wCapInfo').textContent = t('setup.whammy.rest_full', { rest: m.rest ?? '–', full: m.full ?? '–' });
      if (m.rest != null && m.full != null) {
        if (Math.abs(m.full - m.rest) < 8) { setResult('bad', t('setup.whammy.reading_barely_changed_between_rest')); return; }
        Object.assign(state.cfg, { whammyCh: m.ch, whammyMin: Math.min(m.rest, m.full), whammyMax: Math.max(m.rest, m.full), whammyInvert: m.rest > m.full });
        pushCfg();
        stepCtx.done = true;
        setResult('ok', t('setup.whammy.calibrated_gp', { pin: 26 + m.ch, whammyMin: state.cfg.whammyMin, whammyMax: state.cfg.whammyMax, v: state.cfg.whammyInvert ? t('setup.whammy.inverted') : '' }));
        const bs = $('#bSkip'); if (bs) { bs.textContent = t('common.continue'); bs.classList.add('primary'); }
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
      const pinOpts = (own, other) => `<option value="255">${t('common.choose_pin')}</option>${free.concat(own !== PIN_NONE ? [own] : []).sort((a, b) => a - b).map((p) => `<option value="${p}" ${p === own ? 'selected' : ''} ${p === other ? 'disabled' : ''}>GP${p}</option>`).join('')}`;
      const chain = ledLayout(c).chain;
      let q = '', body = '', next = '';
      if (f.sub === 'ask') {
        q = t('setup.rgb.did_wire_leds');
        body = `<p class="dim">${t('setup.rgb.addressable_leds_under_frets_or')}</p>
          <div class="led-ask"><button class="btn lg ${c.rgbEnabled ? 'primary' : ''}" id="askYes">${t('setup.rgb.yes_i_wired_leds')}</button><button class="btn lg" id="askNo">${t('setup.rgb.no_i_don_t_have')}</button></div>`;
      } else if (f.sub === 'type') {
        q = t('setup.rgb.which_leds_do_have');
        body = `${ledTypeCards(c)}<p class="dim small led-hint">${t('setup.rgb.not_sure_count_wires_going')}</p>
          ${apa && !fwApaOk() ? `<div class="notice warn">${t('setup.rgb.apa102_leds_need_firmware_0', { major: state.info.major, minor: state.info.minor })}<button type="button" class="btn small" data-led-update>${t('common.update_firmware')}</button></div>` : ''}`;
        next = `<button class="btn primary" id="lNext">${t('common.continue')}</button>`;
      } else if (f.sub === 'layout') {
        q = t('setup.rgb.where_are_leds');
        body = ledLayoutControls(c);
        next = `<button class="btn primary" id="lNext" ${chain ? '' : 'disabled'}>${t('common.continue')}</button>`;
      } else if (f.sub === 'pins') {
        q = t('setup.rgb.which_pins_are_they_wired');
        const d = c.rgbPin === PIN_NONE ? 'a pin' : 'GP' + c.rgbPin;
        const wire = apa ? t('setup.rgb.pico_first_led_s_di', { d, v: c.ledClkPin === PIN_NONE ? 'a pin' : 'GP' + c.ledClkPin })
          : t('setup.rgb.pico_first_led_s_din', { d });
        body = `<div class="opt first"><div><h3>${t('setup.rgb.data_pin')}</h3><p class="dim">${t('setup.rgb.first_led', { v: apa ? 'DI / SDI' : 'DIN' })}</p></div><select id="rgbPinSel">${pinOpts(c.rgbPin, apa ? c.ledClkPin : PIN_NONE)}</select></div>
          ${apa ? `<div class="opt"><div><h3>${t('setup.rgb.clock_pin')}</h3><p class="dim">${t('setup.rgb.ci_cki_first_led_not')}</p></div><select id="rgbClkSel">${pinOpts(c.ledClkPin, c.rgbPin)}</select></div>` : ''}
          <p class="led-wire">${wire}</p>
          <div class="slider-row"><label for="rgbBriS">${t('common.brightness')}</label><span class="val" id="rgbBriSVal">${c.rgbBrightness}</span>
            <input type="range" id="rgbBriS" min="0" max="${maxBrightness(c)}" step="1" value="${c.rgbBrightness}"></div>
          ${brightNote(c)}`;
        next = `<button class="btn primary" id="lNext" ${c.rgbPin === PIN_NONE || (apa && (c.ledClkPin === PIN_NONE || c.ledClkPin === c.rgbPin)) ? 'disabled' : ''}>${t('common.continue')}</button>`;
      } else {
        const why = ledWhyDark(c);
        q = t('setup.rgb.test_leds');
        body = `<p class="dim">${t('setup.rgb.gp_each_led_lights_white', { ledType: LED_SHORT[c.ledType], rgbPin: c.rgbPin, v: apa ? ' + GP' + c.ledClkPin : '' })}</p>
          ${why ? `<div class="notice warn">${why}</div>` : ''}
          <div class="row"><button class="btn primary lg" id="ledRun">${f.ran ? t('setup.rgb.test_again') : t('setup.rgb.light_them_up')}</button></div>
          ${f.ran ? `<h3 class="led-q2">${t('setup.rgb.did_leds_light_up')}</h3>
            <div class="led-ask"><button class="btn lg primary" id="litYes">${t('setup.rgb.yes_they_lit_up')}</button><button class="btn lg" id="litNo">${t('setup.buttons.no')}</button></div>` : ''}
          ${f.failed ? `<div class="notice warn">${t('setup.rgb.no_problem_if_wrong_type')}</div>${ledHelpHtml(c, true)}` : ''}`;
      }
      card.innerHTML = `${head}<div class="led-steps" aria-label="${t('setup.rgb.aria_label.question', { n: k + 1, length: SUBS.length })}">${SUBS.map((s, i) => `<i class="${i <= k ? 'on' : ''}"></i>`).join('')}</div>
        <h3 class="led-q">${q}</h3>${body}
        <div class="step-nav"><button class="btn quiet" id="lBack">${t('setup.common.back')}</button><div class="row">${next}</div></div>`;
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
          const ok = await ledTestButton($('#ledRun'), t('setup.rgb.test_again'));
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
      card.innerHTML = `${head}<div class="result bad"><span>${why}</span></div>
        <div class="row led-gap"><button class="btn primary" id="mBackSetup">${t('setup.ledmap.go_back_led_setup')}</button></div>
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
      return k >= 0 ? `<b>${t('setup.ledmap.strum', { n: k + 1 })}</b>` : '<b>?</b>';
    };
    const draw = () => {
      if (stepCtx.idx >= lay.chain) {
        finish();
        clearInterval(stepCtx.timer); stepCtx.timer = 0;
        state.dev?.ledTest(-1).catch(() => {});
        card.innerHTML = `${head}<div class="result ok">${t('setup.ledmap.led_order', { list: [...Array(lay.chain).keys()].map(label).join(' → ') })}</div>
          ${nav(`<button class="btn quiet" id="mRedo">${t('setup.ledmap.redo')}</button><button class="btn primary" id="bSkip">${t('common.continue')}</button>`)}`;
        wireNav();
        $('#mRedo').addEventListener('click', () => renderStep());
        return;
      }
      const dots = [...Array(lay.chain).keys()].map((i) => {
        const f = stepCtx.assign.indexOf(i) >= 0 ? stepCtx.assign.indexOf(i) : stepCtx.assign2.indexOf(i), sk = stepCtx.strumAssign.indexOf(i);
        return `<i class="${i === stepCtx.idx ? 'lit' : f >= 0 || sk >= 0 ? 'done' : ''}" style="--c:${f >= 0 ? c.colors[f] : '#fff'}"></i>`;
      }).join('');
      const what = (lay.frets && lay.strum ? t('setup.ledmap.press_fret_above_or_strum')
        : lay.frets ? t('setup.ledmap.press_fret_above') : t('setup.ledmap.strum_once')) + (lay.frets && lay.per === 2 ? t('setup.ledmap.each_fret_has_two_leds') : '');
      const noPins = lay.frets ? c.pins.slice(0, NUM_FRETS).every((p) => p === PIN_NONE) : (c.pins[5] === PIN_NONE && c.pins[6] === PIN_NONE);
      card.innerHTML = `${head}<div class="led-test">${dots}</div>
        <div class="result"><span class="pulse"></span><span>${!lay.chain ? t('setup.ledmap.no_leds_are_set_up') : noPins ? t('setup.ledmap.frets_strum_bar_are_not') : t('setup.ledmap.led_lit_white', { n: stepCtx.idx + 1, chain: lay.chain, what })}</span></div>
        <p class="led-gap"><a href="#" id="mHelp">${t('setup.ledmap.not_lighting_up')}</a></p>${stepCtx.showHelp ? ledHelpHtml(c, true) : ''}
        ${nav(`<button class="btn" id="mSkipLed">${t('setup.ledmap.skip_this_led')}</button>`)}`;
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
      ? t('setup.bluetooth.this_pico_compatible_clone_its')
      : t('setup.bluetooth.this_board_has_no_bluetooth');
    card.innerHTML = head + `
      <div class="opt first"><div><h3>Bluetooth</h3><p class="dim">${sup ? t('setup.bluetooth.pair_hold_star_power_while') : why}</p></div>
        <label class="switch"><input type="checkbox" id="btSw" ${state.cfg.btEnabled ? 'checked' : ''} ${sup ? '' : 'disabled'}><i></i></label></div>
      ${sup ? `<div class="notice">${t('setup.bluetooth.over_bluetooth_guitar_shows_up')}</div>` : ''}
      ${sup && btSleepOk() ? `<div class="opt"><div><h3>${t('setup.bluetooth.sleep_after')}</h3><p class="dim">${t('setup.bluetooth.bluetooth_with_no_usb_host')}</p></div>
        <select id="btSleepSel" aria-label="${t('setup.bluetooth.aria_label.sleep_after')}">${BT_SLEEP_CHOICES.map((v) => `<option value="${v}" ${v === state.cfg.ext.btSleep ? 'selected' : ''}>${btSleepLabel(v)}${v === 0 ? t('setup.bluetooth.default') : ''}</option>`).join('')}</select></div>` : sup ? `<p class="dim">${t('setup.bluetooth.update_firmware_0_45_or')}</p>` : ''}
      ${sup ? `<div class="opt adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}"><div><h3>${t('setup.bluetooth.debug_logging')}</h3><p class="dim">${t('setup.bluetooth.records_bluetooth_connections_guitar_s')}</p></div>
        <label class="switch"><input type="checkbox" id="btLogSw" ${state.cfg.btDebugLog ? 'checked' : ''}><i></i></label></div>
      <div class="opt adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}"><div><h3>${t('setup.bluetooth.bluetooth_log')}</h3><p class="dim">${t('setup.bluetooth.what_was_recorded_while_debug')}</p></div><span class="row"><button class="btn small" id="btLogBtn">${t('setup.bluetooth.show')}</button><button class="btn small" id="btLogClear" hidden>${t('common.clear')}</button></span></div><pre class="btlog adv ${state.cfg.btDebugLog ? 'adv-keep' : ''}" id="btLog" hidden></pre>
      <p class="adv-hint" ${state.cfg.btDebugLog ? 'hidden' : ''}>${t('setup.bluetooth.more_options_debug_logging_bluetooth')}<button type="button" class="linklike" data-adv-on>${t('common.turn_advanced')}</button></p>` : ''}
      ${nav(`<button class="btn primary" id="bSkip">${t('common.continue')}</button>`)}`;
    wireNav();
    $('#btLogBtn')?.addEventListener('click', async () => {
      const pre = $('#btLog');
      let persistent = false;
      try {
        let lines;
        try { lines = await state.dev.getBtLogFlash(); persistent = true; } catch { lines = await state.dev.getBtLog(); }
        pre.textContent = lines.length ? lines.join('\n')
          : (state.cfg.btDebugLog ? t('setup.bluetooth.nothing_recorded_yet') : t('setup.bluetooth.nothing_recorded_switch_debug_logging'));
      } catch { pre.textContent = t('setup.bluetooth.this_firmware_has_no_bluetooth'); }
      $('#btLogClear').hidden = !persistent;
      pre.hidden = false;
      if (pre.textContent.includes('power-on')) { try { await navigator.clipboard.writeText(pre.textContent); toast(t('setup.bluetooth.bluetooth_log_copied'), 'ok'); } catch { /* clipboard blocked */ } }
    });
    $('#btLogClear')?.addEventListener('click', async () => {
      try { await state.dev.clearBtLogFlash(); $('#btLog').textContent = t('setup.bluetooth.log_cleared'); toast(t('setup.bluetooth.bluetooth_log_cleared'), 'ok'); }
      catch (e) { toast(t('setup.bluetooth.could_not_clear_log', { message: e.message }), 'bad'); }
    });
    $('#btSw').addEventListener('change', (e) => { state.cfg.btEnabled = e.target.checked; pushCfg(); });
    $('#btSleepSel')?.addEventListener('change', (e) => { state.cfg.ext.btSleep = btSleepByte(+e.target.value); pushCfg(); });
    // saved straight away: the log is for power cycles, which an unsaved setting wouldn't survive
    $('#btLogSw')?.addEventListener('change', async (e) => {
      state.cfg.btDebugLog = e.target.checked;
      try { await state.dev.setConfig(state.cfg); await state.dev.save(); takeSnapshot(); toast(e.target.checked ? t('setup.bluetooth.bluetooth_debug_logging_saved') : t('setup.bluetooth.bluetooth_debug_logging_off_saved'), 'ok'); }
      catch (err) { toast(t('setup.bluetooth.could_not_save', { message: err.message }), 'bad'); }
    });
  } else if (step.kind === 'extras') {
    extras.reset();
    stepCtx.extras = true;
    extras.render(card, head, nav, wireNav);
  } else if (step.kind === 'tiltsens') {
    tsUi = { card, head, nav, wireNav };
    Object.assign(ts, { path: null, slot: -1, second: false, ana: null, prev: null });
    Object.assign(qt, { level: null, tilted: null, chosen: false, chip: 0 });
    tsRender();
  } else if (step.kind === 'tilt') {
    const renderTilt = () => {
      const c = state.cfg;
      const have = c.tiltPin !== PIN_NONE;
      stepCtx.activeSince = 0; stepCtx.rerender = renderTilt;
      stepCtx.detector = new PinDetector({ windowMs: 5000, minPresses: 2, exclude: assignedPins().filter((p) => p !== c.tiltPin) });
      card.innerHTML = `${head}
        <div class="opt first"><div><h3>${t('setup.tilt.tilt_star_power')}</h3><p class="dim">${t('setup.tilt.lifting_neck_triggers_star_power')}</p></div>
          <label class="switch"><input type="checkbox" id="tiltSw" ${c.tiltEnabled ? 'checked' : ''}><i></i></label></div>
        ${c.tiltEnabled ? `<div class="result ${have ? 'ok' : ''}" id="result" style="margin-top:12px">${have
          ? t('setup.tilt.tilt_switch_gp', { tiltPin: c.tiltPin })
          : `<span class="pulse"></span><span>${t('setup.tilt.tilt_guitar_up_twice_within')}</span>`}</div>` : ''}
        ${c.tiltEnabled ? `${tiltTypeHtml('tiltType')}
          <div class="opt"><div><h3>${t('setup.tilt.or_choose_pin_yourself')}</h3><p class="dim">${t('setup.tilt.skips_double_tilt')}</p></div>${tiltPinSelect('tiltPinSel')}</div>` : ''}
        ${c.tiltEnabled && have ? `<div class="tilt-live" id="tiltLive"><i></i>${t('setup.tilt.tilt_not_active_hold_guitar')}</div>
          <div class="notice" id="tiltSuggest" hidden><span id="tiltSuggestTxt"></span> <button type="button" class="btn small primary" id="tiltSuggestBtn">Switch</button></div>` : ''}
        ${nav(`${c.tiltEnabled && have ? `<button class="btn quiet" id="tRedo">${t('setup.tilt.re_detect')}</button>` : ''}<button class="btn primary" id="bSkip">${t('common.continue')}</button>`)}`;
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
    const act = (go, clear) => `<td class="sum-act"><button class="btn small quiet" data-go="${go}">${t('setup.common.change')}</button>${clear ? `<button class="btn small quiet" data-clr="${clear}">${t('common.clear')}</button>` : ''}</td>`;
    const pinOr = (txt, none = t('setup.buttons.not_set')) => txt ? txt : `<span class="dim">${none}</span>`;
    const rows = `${FUNCS.map((f, i) => `<tr><td>${btnName(i)}</td><td>${pinOr(c.pins[i] === PIN_NONE ? '' : 'GP' + c.pins[i])}</td>${act('b' + i, c.pins[i] !== PIN_NONE ? 'b' + i : '')}</tr>`).join('')}<tr><td>${t('common.whammy')}</td><td>${pinOr(c.whammyCh === PIN_NONE ? '' : 'GP' + (26 + c.whammyCh))}</td>${act('whammy')}</tr>
       <tr><td>${t('common.tilt_switch')}</td><td>${pinOr(c.tiltEnabled && c.tiltPin !== PIN_NONE ? 'GP' + c.tiltPin + (c.tiltInvert && fwAtLeast(33) ? t('setup.common.normally_closed') : '') : '', t('common.off'))}</td>${act('tilt', c.tiltEnabled || c.tiltPin !== PIN_NONE ? 'tilt' : '')}</tr>
       ${tiltSensOk() ? `<tr><td>${t('common.tilt_sensors')}</td><td>${tiltSensorsSummary(c) || `<span class="dim">${t('setup.common.skipped')}</span>`}</td>${act('tiltsens')}</tr>` : ''}
       ${c.ext ? `<tr><td>${t('setup.common.d_pad_select_home_stick')}</td><td>${pinOr(extrasSummary(c), t('setup.extras.not_wired'))}</td>${act('extras')}</tr>` : ''}
       <tr><td>${t('setup.review.rgb_leds')}</td><td>${pinOr(c.rgbEnabled && c.rgbPin !== PIN_NONE ? 'GP' + c.rgbPin : '', t('common.off'))}</td>${act('rgb')}</tr>
       <tr><td>Bluetooth</td><td>${c.btEnabled ? t('common.on') : t('common.off')}</td>${act('bluetooth')}</tr>`;
    card.innerHTML = `${head}<table class="sum">${rows}</table>
      ${nameOk() ? `<div class="panel-inset name-setup">${nameFieldHtml('devNameSetup')}</div>` : ''}
      <p class="dim small" style="margin-top:14px">${t('setup.common.try_every_input_guitar_lights')}</p>
      <div class="step-nav">
        <button class="btn quiet" id="bRedo">${t('setup.common.start_over')}</button>
        <button class="btn primary lg" id="bSave">${t('setup.common.save_controller')}</button></div>`;
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
    if (nameOk()) wireNameField('devNameSetup');
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
const btnName = (i) => (i < NUM_FRETS ? t('setup.buttons.fret_name.' + FUNCS[i]) : funcName(i));
// frets use the colours the guitar picture shows: the configured LED colours when the LEDs are on, else the standard ones
const btnColor = (i) => (i < NUM_FRETS ? (state.cfg?.rgbEnabled && state.cfg.colors?.[i]) || FRET_COLORS[i] : i === 7 ? '#facc15' : i === 8 ? '#38e1c6' : '#7c8cff');

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
  else { bpClose(); if (bp.queue) toast(t('setup.buttons.prompt.buttons_done'), 'ok'); }
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
  const head = t('setup.buttons.prompt.head.' + FUNCS[f], { col });      // one whole sentence per control ("Press the GREEN FRET", "Push the strum bar UP")
  const m = bp.msg;
  const last = !bp.queue || bp.qi + 1 >= bp.queue.length;
  const nextName = !last ? btnName(bp.queue[bp.qi + 1]) : '';
  let body = '', acts = '';
  if (bp.phase === 'listen') {
    body = `<p class="bp-sub">${t(f === 5 || f === 6 ? 'setup.buttons.prompt.push_twice' : 'setup.buttons.prompt.press_twice')}</p>
      <div class="bp-listen"><span class="bp-dots" aria-hidden="true"><i></i><i></i></span><span class="dim">${t('setup.buttons.prompt.listening')}</span></div>
      <p class="bp-msg ${m?.bad ? 'bad' : ''}" role="status" aria-live="polite">${m?.text || ''}</p>`;
  } else if (bp.phase === 'conflict') {
    body = `<p class="bp-msg bad" role="alert">${t('setup.buttons.prompt.gp_already', { pin: m.pin, button: btnName(m.who) })}</p>`;
    acts = `<button class="btn primary" id="bpSteal">${t('setup.buttons.prompt.use_instead', { button: btnName(f) })}</button><button class="btn" id="bpAgain">${t('setup.buttons.prompt.press_another')}</button>`;
  } else {
    body = `<p class="bp-done" role="status" style="color:${col}">${btnName(f)} <span aria-hidden="true">→</span> GP${m.pin}</p>
      ${bp.prev.stole >= 0 ? `<p class="dim small">${t('setup.buttons.prompt.now_not_set', { button: btnName(bp.prev.stole) })}</p>` : ''}`;
    acts = `<button class="btn quiet" id="bpUndo">${t('setup.buttons.undo')}</button>${bp.queue ? `<button class="btn primary" id="bpNext">${last ? t('setup.steps.review.group') : t('setup.buttons.prompt.next', { nextName })}</button>` : `<button class="btn" id="bpDone">${t('setup.buttons.prompt.done')}</button>`}`;
  }
  if (bp.phase === 'listen' && bp.queue) acts = `<button class="btn" id="bpSkip">${t('common.skip')}</button>`;
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !assignedPins().includes(p) || p === c.pins[f]);
  const keepOpen = root.querySelector('.bp-manual')?.open ?? bp.manualOpen;
  root.innerHTML = `<div class="bp-card ph-${bp.phase} ${f < NUM_FRETS ? 'fret' : ''}" role="dialog" aria-modal="true" aria-labelledby="bpTitle" tabindex="-1" style="--c:${col}">
      ${bp.queue ? `<div class="bp-count">${t('setup.buttons.prompt.button', { n: bp.qi + 1, length: bp.queue.length })}</div>` : ''}
      <div class="bp-gslot"></div>
      <h2 class="bp-title" id="bpTitle">${head}</h2>
      ${body}
      <div class="bp-acts">${acts}<span class="bp-grow"></span>${bp.queue ? `<button class="btn quiet" id="bpStop">${t('setup.buttons.prompt.stop')}</button>` : ''}<button class="btn quiet" id="bpCancel">${bp.phase === 'result' ? t('setup.buttons.prompt.close') : t('common.cancel')}</button></div>
      ${bp.phase === 'listen' ? `<details class="bp-manual" ${keepOpen ? 'open' : ''}><summary>${t('setup.buttons.prompt.choose_pin_yourself')}</summary>
        <select id="bpPin" aria-label="${t('setup.buttons.prompt.aria_label.pin', { button: btnName(f) })}"><option value="">${t('common.choose_pin')}</option>${free.map((p) => `<option value="${p}" ${p === c.pins[f] ? 'selected' : ''}>GP${p}</option>`).join('')}</select></details>` : ''}
      ${bp.queue ? `<label class="bp-auto"><input type="checkbox" id="bpAuto" ${bpAuto() ? 'checked' : ''}>${t('setup.buttons.prompt.go_next_button_by_itself')}</label>` : ''}
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
      ? { bad: 1, text: t('setup.buttons.prompt.several_inputs_moved_at_once', { list: r.ambiguous.map((p) => 'GP' + p).join(', ') }) }
      : { bad: 1, text: t('setup.buttons.prompt.gp_used_something_else_tilt', { pin: r.used[0] }) };
    const el = bp.root.querySelector('.bp-msg');
    if (el) { el.className = 'bp-msg bad'; el.innerHTML = bp.msg.text; }
  }
}

// shared by the Setup tilt step and the Tune "Tilt switch" panel
function tiltTypeHtml(id) {
  const c = state.cfg, ok = fwAtLeast(33), dis = ok ? '' : 'disabled';
  return `<div class="opt tilt-type" id="${id}"><div><h3>${t('tune.tilt_switch.which_position_counts_as_tilted')}</h3>
    <p class="dim" id="${id}Hint">${ok ? t('tune.tilt_switch.if_indicator_shows_active_while') : t('tune.tilt_switch.normally_closed_switches_need_firmware')}</p></div>
    <div class="seg" role="radiogroup" aria-label="${t('tune.tilt_switch.aria_label.which_position_counts_as_tilted')}">
      <button type="button" role="radio" data-inv="0" aria-checked="${!tiltInverted()}" class="${tiltInverted() ? '' : 'on'}" ${dis}>${t('tune.tilt_switch.switch_closed_tilted_normally_open')}</button>
      <button type="button" role="radio" data-inv="1" aria-checked="${tiltInverted()}" class="${tiltInverted() ? 'on' : ''}" ${dis}>${t('tune.tilt_switch.switch_open_tilted_normally_closed')}</button></div></div>`;
}
function tiltPinSelect(id) {
  const c = state.cfg, used = new Set(assignedPins().filter((p) => p !== c.tiltPin));
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p));
  return `<select id="${id}" aria-label="${t('tune.tilt_switch.aria_label.tilt_switch_pin')}"><option value="255" ${c.tiltPin === PIN_NONE ? 'selected' : ''}>${t('setup.buttons.not_set')}</option>${free.map((p) => `<option value="${p}" ${p === c.tiltPin ? 'selected' : ''}>GP${p}</option>`).join('')}</select>`;
}
function buildTiltSwitch() {
  const c = state.cfg, body = $('#tiltSwBody');
  if (!body) return;
  body.innerHTML = `
    <div class="opt first"><div><h3>${tiltFuncOk() ? t('common.tilt_switch') : t('tune.tilt_switch.tilt_star_power')}</h3><p class="dim">${t('tune.tilt_switch.tilt_switch_wired_free_pin', { v: tiltFuncOk() ? t('tune.tilt_switch.presses_input_when_neck_lifted') : t('tune.tilt_switch.triggers_star_power_when_neck') })}</p></div>
      <label class="switch"><input type="checkbox" id="tsOn" ${c.tiltEnabled ? 'checked' : ''}><i></i></label></div>
    ${c.tiltEnabled ? `<div class="opt"><div><h3>${t('tune.tilt_switch.switch_pin')}</h3><p class="dim">${t('tune.tilt_switch.or_use_setup_find_by')}</p></div>${tiltPinSelect('tsPin')}</div>
      ${tiltMapUi() ? `<div class="opt"><div><h3>${t('tune.tilt_switch.assign')}</h3><p class="dim">${t('tune.tilt_switch.any_guitar_or_gamepad_input')}</p></div>${assignSelect(10, t('common.tilt_switch'))}</div>${assignNote(assignValue(10))}${rangeFor(10, assignValue(10))}`
      : tiltFuncOk() ? `<div class="opt"><div><h3>${t('tune.tilt_switch.acts_as')}</h3><p class="dim">${t('tune.tilt_switch.input_tilt_presses')}</p></div><select id="tsFunc" aria-label="${t('tune.tilt_switch.aria_label.tilt_switch_acts_as')}">${tiltFuncOptions(tiltFuncOf(0), false)}</select></div>` : ''}
      ${tiltTypeHtml('tsType')}
      <div class="tilt-live" id="tsLive"><i></i>${t('tune.tilt_switch.tilt_not_active_hold_guitar')}</div>` : ''}`;
  $('#tsOn').onchange = (e) => { c.tiltEnabled = e.target.checked; if (!c.tiltEnabled) c.tiltPin = PIN_NONE; pushCfg(); buildTiltSwitch(); };
  $('#tsPin')?.addEventListener('change', (e) => { c.tiltPin = +e.target.value; pushCfg(); buildTiltSwitch(); });
  wireAssign(body);
  if (rangeOk()) wireRange(body, (k) => state.cfg.ext.range[k], (k, v) => { state.cfg.ext.range[k] = v; pushCfg(); });
  $('#tsFunc')?.addEventListener('change', (e) => { c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR]; c.tiltFunc[0] = +e.target.value; pushCfg(); });
  body.querySelectorAll('#tsType [data-inv]').forEach((b) => b.addEventListener('click', () => { c.tiltInvert = b.dataset.inv === '1'; pushCfg(); buildTiltSwitch(); }));
  if (state.status) updateTiltSwitch(state.status);
}
function updateTiltSwitch(s) {
  const live = $('#tsLive');
  if (!live) return;
  const on = tiltSwitchActive(s);
  live.classList.toggle('on', on);
  $('#tsLiveTxt').textContent = on ? t('tune.tilt_switch.tilt_active') : t('tune.tilt_switch.tilt_not_active');
}

// live "Tilt: active" indicator on the setup step, plus a suggestion when it stays on while the guitar should be level
function tickTiltLive(s) {
  const live = $('#tiltLive');
  if (!live) return;
  const on = tiltSwitchActive(s);
  live.classList.toggle('on', on);
  $('#tiltLiveTxt').textContent = on ? t('tune.tilt_switch.tilt_active') : t('tune.tilt_switch.tilt_not_active');
  const sug = $('#tiltSuggest');
  if (!sug || !fwAtLeast(33)) return;
  const now = performance.now();
  if (!on) { stepCtx.activeSince = 0; sug.hidden = true; return; }
  stepCtx.activeSince ||= now;
  if (now - stepCtx.activeSince > 1500) {
    $('#tiltSuggestTxt').textContent = state.cfg.tiltInvert ? t('tune.tilt_switch.still_active_with_guitar_level') : t('tune.tilt_switch.still_active_with_guitar_level_2');
    $('#tiltSuggestBtn').textContent = state.cfg.tiltInvert ? t('tune.tilt_switch.switch_normally_open') : t('tune.tilt_switch.switch_normally_closed');
    sug.hidden = false;
  }
}

// ------------------------------------------------------------------ Setup step: tilt sensors (firmware 0.29+)
// Asks which kind is wired, then reuses the Tune page's guided capture (quickModel / quickHtml / wireQuick).
// While it shows, the Tune page's tilt body is emptied so the shared element ids stay unique.
let tsUi = null;
const ts = { path: null, slot: -1, second: false, ana: null, prev: null };
const tsKindOf = (src) => (src === PIN_NONE ? null : src < 3 ? 'adc' : 'acc');
const tsFreeSlot = (c) => c.atilt.findIndex((tv) => tv.src === PIN_NONE);
// why an analog channel is out: the whammy bar, a stick, or the other sensor
const tsBlocked = (c, ch, slot = ts.slot) => (ch === c.whammyCh ? 'whammy' : (c.ext?.stickCh || []).includes(ch) ? 'stick' : c.atilt.some((tv, i) => i !== slot && tv.src === ch) ? 'sensor' : '');
const tsAccSecondOk = (c) => { const n = c.atilt.filter((tv) => tsKindOf(tv.src) === 'acc').length; return n === 0 || (n === 1 && tiltMapUi() && fwAtLeast(ACCEL2_MIN_MINOR) && !!state.status?.accel2Type); };
const tsAdcOk = (c, slot) => [0, 1, 2].some((ch) => !tsBlocked(c, ch, slot));
function tsEnter(path) {
  const c = state.cfg;
  ts.path = path;
  let sl = ts.second ? tsFreeSlot(c) : c.atilt.findIndex((tv) => tsKindOf(tv.src) === path);
  if (sl < 0) sl = tsFreeSlot(c);
  if (sl < 0) sl = 0;
  ts.slot = sl;
  qt.level = qt.tilted = null; qt.chosen = false; qt.chip = 0;
  if (path === 'adc') { const cur = c.atilt[sl].src; ts.ana = cur < 3 ? cur : [0, 1, 2].find((ch) => !tsBlocked(c, ch)) ?? null; }
  if (path === 'acc' && ts.second) { const used = c.atilt.find((tv) => tsKindOf(tv.src) === 'acc'); if (used) { qt.chip = used.src >= 9 ? 0 : 1; qt.chosen = true; } }
}
function tsRender() {
  if (!tsUi) return;
  const c = state.cfg, { card, head, nav, wireNav } = tsUi;
  const tb = $('#tiltBody');
  if (tb) tb.innerHTML = '';
  tiltKey = tiltKeyOf(state.status);
  qSlotPref = ts.path ? ts.slot : -1;
  renderStepList();
  const configured = c.atilt.some((tv) => tv.src !== PIN_NONE);
  if (!ts.path) {
    const cur = ts.second ? null : tsKindOf(c.atilt.find((tv) => tv.src !== PIN_NONE)?.src ?? PIN_NONE);
    const accDis = ts.second && !tsAccSecondOk(c), adcDis = ts.second && !tsAdcOk(c, tsFreeSlot(c));
    const ch = (k, title, sub, dis) => `<button type="button" class="ts-ch ${cur === k ? 'on' : ''}" data-ts="${k}" aria-pressed="${cur === k}" ${dis ? 'disabled' : ''}><b>${title}</b><span>${sub}</span></button>`;
    card.innerHTML = head + `
      <p class="ts-q" id="tsQ">${ts.second ? t('tune.tilt_switch.what_kind_second_tilt_sensor') : t('tune.tilt_switch.do_have_accelerometer_or_analog')}</p>
      <div class="ts-choices" role="group" aria-labelledby="tsQ">
        ${ch('acc', t('tune.tilt_switch.accelerometer_i2c'), accDis ? t('tune.tilt_switch.needs_second_chip_firmware_0') : t('tune.tilt_switch.adxl345_lis3dh_mpu_6050_two'), accDis)}
        ${ch('adc', t('tune.tilt_switch.analog_tilt_sensor_gp2628'), adcDis ? t('tune.tilt_switch.no_free_analog_pin') : t('tune.tilt_switch.sensor_with_analog_output'), adcDis)}
        <button type="button" class="ts-ch ts-skip" data-ts="${ts.second ? 'cancel' : 'skip'}"><b>${ts.second ? t('tune.tilt_switch.no_second_sensor') : t('tune.tilt_switch.no_skip')}</b><span>${ts.second ? t('tune.tilt_switch.keep_just_first') : t('tune.tilt_switch.nothing_changed')}</span></button>
      </div>
      ${nav(`<button class="btn quiet" id="bSkip">${configured ? t('tune.tilt_switch.next') : t('common.skip')}</button>`)}`;
    wireNav();
    card.querySelectorAll('[data-ts]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.ts;
      if (k === 'skip') goStep(state.step + 1);
      else if (k === 'cancel') { ts.second = false; tsEnter(ts.prev); tsRender(); }
      else { tsEnter(k); tsRender(); }
    }));
    return;
  }
  const acc = ts.path === 'acc', qm = quickModel(c, acc ? null : ts.ana);
  const done = qm.found && qm.stage === 'result';
  const free = tsFreeSlot(c) >= 0 && (tsAccSecondOk(c) || tsAdcOk(c, tsFreeSlot(c)));
  let top;
  if (acc) {
    top = `<div class="opt first"><div><h3>${t('tune.tilt_switch.accelerometer_pins')}</h3>${qm.found ? '' : `<p class="dim">${t('tune.tilt_switch.sda_even_pin_scl_next')}</p>`}</div>${accPinsSelect(accelPairs(c))}</div>
      <p class="acc-status" id="accStatus" role="status"></p>`;
  } else if (ts.ana == null) {
    top = `<div class="notice">${t('tune.tilt_switch.all_three_analog_pins_are')}</div>`;
  } else {
    top = done ? '' : `<div class="opt first"><div><h3>${t('tune.tilt_switch.sensor_pin')}</h3><p class="dim">${t('tune.tilt_switch.output_one_these_power_3v3')}</p></div>
      <div class="seg" id="tsCh" role="group" aria-label="${t('tune.tilt_switch.aria_label.sensor_pin')}">${[0, 1, 2].map((k) => { const why = tsBlocked(c, k); return `<button type="button" data-ch="${k}" class="${ts.ana === k ? 'on' : ''}" ${why ? 'disabled' : ''} title="${why ? t('tune.tilt_switch.used_by.' + why) : ''}">GP${26 + k}${why ? ` <small>${t('tune.tilt_switch.blocked.' + why)}</small>` : ''}</button>`; }).join('')}</div></div>`;
  }
  card.innerHTML = head + `${top}${qm.found && (acc || ts.ana != null) ? quickHtml(qm, c) : ''}
    ${nav(`<button class="btn quiet" id="tsType">${t('tune.tilt_switch.change_type')}</button>${done && !ts.second && free ? `<button class="btn" id="tsAdd">${t('tune.tilt_switch.add_second_tilt_sensor')}</button>` : ''}<button class="btn primary" id="bSkip">${done ? t('tune.tilt_switch.next') : t('common.skip')}</button>`)}`;
  wireNav();
  $('#tsType').onclick = () => { ts.path = null; tsRender(); };
  $('#tsAdd')?.addEventListener('click', () => { ts.prev = ts.path; ts.second = true; ts.path = null; tsRender(); });
  card.querySelectorAll('#tsCh [data-ch]').forEach((b) => (b.onclick = () => { ts.ana = +b.dataset.ch; qt.level = qt.tilted = null; tsRender(); }));
  if (acc) wireAccPins(card, tsRender);
  wireAssign(card);
  wireResponse(card, (k) => c.ext.curve[k], (k, v) => { c.ext.curve[k] = v; pushCfg(); });
  if (rangeOk()) wireRange(card, (k) => c.ext.range[k], (k, v) => { c.ext.range[k] = v; pushCfg(); });
  if (qm.found) wireQuick(card, qm, c, tsRender);
  if (state.status) updateTilt(state.status);
}

function tickStep(s) {
  if (state.view !== 'setup' || !state.dev) return;
  const step = STEPS[state.step];
  bpTick(s);
  if (step.kind === 'buttons') {
    // live highlight of whichever tile's button is held right now
    document.querySelectorAll('.bt').forEach((tv) => tv.classList.toggle('held', isPressed(s, state.cfg.pins[+tv.dataset.f])));
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
    $('#wLabel').textContent = p.channel < 0 ? t('setup.whammy.waiting_bar_move_2') : t('setup.whammy.sweeps_2_swing_counts', { v: Math.min(2, Math.floor(p.switches / 2)), range: p.range });
    if (p.done) {
      const r = stepCtx.cal.result();
      Object.assign(c, { whammyCh: r.channel, whammyMin: r.min, whammyMax: r.max, whammyInvert: r.invert });
      pushCfg();
      stepCtx.done = true;
      setResult('ok', t('setup.whammy.calibrated_gp_2', { pin: 26 + r.channel, min: r.min, max: r.max, v: r.invert ? t('setup.whammy.inverted') : '' }));
      $('#wLabel').textContent = t('setup.whammy.live_input_move_bar_check');
      const b = $('#bSkip'); if (b) { b.textContent = t('common.continue'); b.classList.add('primary'); }
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
  } else if (step.kind === 'extras') {
    extras.tick(s, $('#stepCard'));
  } else if (step.kind === 'tiltsens') {
    updateTilt(s);
  } else if (step.kind === 'tilt' && !stepCtx.active) {
    tickTiltLive(s);
  } else if (step.kind === 'tilt' && stepCtx.detector) {
    const r = stepCtx.detector.feed(s);
    if (!r) return;
    if (r.pin !== undefined) {
      state.cfg.tiltPin = r.pin; pushCfg(); stepCtx.active = false; renderStepList();
      stepCtx.rerender?.();
      toast(t('setup.tilt.tilt_switch_registered'), 'ok');
    } else if (r.ambiguous) setResult('bad', t('setup.tilt.several_inputs_moved_at_once'));
    else if (r.used) setResult('bad', t('setup.tilt.gp_already_used_by_another', { pin: r.used[0] }));
  }
}

// ------------------------------------------------------------------ tune
function buildTune() {
  const c = state.cfg;
  const np = $('#namePanel');
  np.hidden = !nameOk();
  if (nameOk()) { $('#namePanelBody').innerHTML = nameFieldHtml('devNameTune'); wireNameField('devNameTune'); }
  const dt = $('#debT'), ws = $('#wSmooth'), wd = $('#wDead');
  const refresh = () => {
    $('#debTVal').textContent = (c.debounce100us / 10).toFixed(1) + ' ms';
    $('#wSmoothVal').textContent = c.whammySmooth === 0 ? t('common.off') : String(c.whammySmooth);
    $('#wDeadVal').textContent = c.whammyDeadzone + ' %';
    document.querySelectorAll('#debPresets [data-deb]').forEach((b) => b.classList.toggle('on', +b.dataset.deb === c.debounce100us));
  };
  dt.value = c.debounce100us; ws.value = c.whammySmooth; wd.value = c.whammyDeadzone;
  $('#combStrum').checked = c.combinedStrum; $('#wInv').checked = c.whammyInvert;
  const PRESETS = [[t('common.off_2'), 0], [t('tune.fast'), 20], [t('tune.balanced'), 50], [t('tune.safe'), 100], [t('tune.worn_switches'), 200]];
  $('#debPresets').innerHTML = PRESETS.map(([n, v]) => `<button data-deb="${v}" title="${v / 10} ms">${n}</button>`).join('');
  const live = () => { refresh(); pushCfg(); };
  dt.oninput = () => { c.debounce100us = +dt.value; live(); };
  ws.oninput = () => { c.whammySmooth = +ws.value; live(); };
  wd.oninput = () => { c.whammyDeadzone = +wd.value; live(); };
  $('#combStrum').onchange = (e) => { c.combinedStrum = e.target.checked; live(); };
  $('#wInv').onchange = (e) => { c.whammyInvert = e.target.checked; live(); };
  $('#debPresets').onclick = (e) => { const b = e.target.closest('[data-deb]'); if (b) { c.debounce100us = +b.dataset.deb; dt.value = c.debounce100us; live(); } };
  $('#resetCfg').onclick = async () => {
    if (!confirm(t('tune.reset_every_setting_pins_whammy'))) return;
    await state.dev.defaults(); await state.dev.save(); await sleep(300);
    state.cfg = await state.dev.getConfig(); state.step = 0; buildUi(); takeSnapshot(); toast(t('tune.reset_defaults'), 'ok');
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
  if (!fw31) { body.innerHTML = `<p class="notice small">${t('modes.ports.needs_firmware_0_31_or')}</p>`; return; }
  const others = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), ...accelPins(), c.rumblePin ?? PIN_NONE, ...extPinList(c)].filter((p) => p !== PIN_NONE));
  const PS2 = [t('modes.ports.att'), 'CMD', 'DAT', 'CLK', 'ACK'];
  const ps2 = c.ps2Pins || [255, 255, 255, 255, 255];
  const pinSel = (id, val, exclude) => `<select id="${id}"><option value="255">${t('modes.ports.not_wired')}</option>${[...Array(NUM_DIGITAL_PINS).keys()]
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
        <div class="head"><h3>${t('modes.ports.ps2_controller_port')}</h3><span class="tilt-state" id="pPs2">${ps2On ? t('modes.ports.waiting') : t('common.off')}</span></div>
        <p class="dim small">${t('modes.ports.ps2_guitar_hero_guitar_guitar')}</p>
        <div class="ps2-grid">${PS2.map((n, i) => `<label>${n}${pinSel('ps2' + i, ps2[i], ps2Used)}</label>`).join('')}</div>
      </div>
      <div class="tilt-card">
        <div class="head"><h3>${t('modes.ports.wii_extension')}</h3><span class="tilt-state" id="pWii">${wiiOn ? t('modes.ports.waiting') : t('common.off')}</span></div>
        <p class="dim small">${t('modes.ports.guitar_acts_as_guitar_hero')}</p>
        <label class="field-label">SDA / SCL</label>
        <select id="wiiPins"><option value="255">${t('modes.ports.not_wired')}</option>${wiiPairs.map((p) => `<option value="${p}" ${p === c.wiiSda ? 'selected' : ''}>SDA GP${p}, SCL GP${p + 1}</option>`).join('')}</select>
      </div>
    </div>
    ${state.info.btSupported ? `
    <div class="opt" style="margin-top:12px"><div><h3>${t('modes.ports.wii_remote_over_bluetooth')}<span class="tilt-state" id="pWm">${wiimote ? t('modes.ports.waiting') : t('common.off')}</span></h3>
      <p class="dim">${t('modes.ports.pico_w_becomes_wii_remote')}</p></div>
      <label class="switch"><input type="checkbox" id="wmOn" ${wiimote ? 'checked' : ''}><i></i></label></div>` : ''}`;
  PS2.forEach((n, i) => { $('#ps2' + i).onchange = (e) => { c.ps2Pins = [...ps2]; c.ps2Pins[i] = +e.target.value; buildPorts(); }; });
  $('#wiiPins').onchange = (e) => { const p = +e.target.value; c.wiiSda = p; c.wiiScl = p === PIN_NONE ? PIN_NONE : p + 1; buildPorts(); };
  const wm = $('#wmOn');
  if (wm) wm.onchange = () => { c.xinputOpts = (c.xinputOpts & ~2) | (wm.checked ? 2 : 0); if (wm.checked) c.btEnabled = true; buildPorts(); };
}
function updatePorts(s) {
  const set = (id, on, txt) => { const el = $(id); if (el && el.textContent !== t('common.off')) { el.textContent = on ? txt : t('modes.ports.waiting'); el.classList.toggle('on', on); } };
  set('#pPs2', !!(s.ports & 1), 'PS2 connected');
  set('#pWii', !!(s.ports & 2), 'Wii Remote connected');
  set('#pWm', !!(s.ports & 4), 'Wii connected');
}

// ------------------------------------------------------------------ rumble (firmware 0.30+)
function buildRumble() {
  const c = state.cfg, body = $('#rumbleBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5 || !(state.info.major > 0 || state.info.minor >= 30)) {
    body.innerHTML = `<p class="notice small">${t('tune.rumble.rumble_needs_firmware_0_30')}</p>`;
    return;
  }
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), ...accelPins(), ...extPinList(c)].filter((p) => p !== PIN_NONE));
  const free = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !taken.has(p) || p === c.rumblePin);
  const on = c.rumblePin !== PIN_NONE;
  const sw = (bit, title, desc) => `<div class="opt"><div><h3>${title}</h3><p class="dim">${desc}</p></div>
    <label class="switch"><input type="checkbox" data-bit="${bit}" ${c.rumbleFlags & bit ? 'checked' : ''}><i></i></label></div>`;
  body.innerHTML = `
    <div class="opt first"><div><h3>${t('tune.rumble.motor_pin')}</h3><p class="dim">${t('tune.rumble.drives_transistor_s_base_through')}</p></div>
      <div class="row"><select id="rmPin"><option value="255">${t('common.none')}</option>${free.map((p) => `<option value="${p}">GP${p}</option>`).join('')}</select>
      ${on ? `<button class="btn small" id="rmTest">${t('common.test_action')}</button>` : ''}</div></div>
    ${on ? `
    <div class="slider-row"><label for="rmStr">${t('tune.rumble.strength')}</label><output class="val" id="rmStrV">${c.rumbleStrength} %</output><input type="range" id="rmStr" min="10" max="100" step="5" value="${c.rumbleStrength}"></div>
    ${sw(1, t('tune.rumble.game_rumble'), t('tune.rumble.follow_rumble_games_send_guitar'))}
    ${sw(2, t('tune.rumble.buzz_star_power'), t('tune.rumble.short_buzz_when_star_power'))}
    ${sw(4, t('tune.rumble.buzz_missed_note'), t('tune.rumble.tap_when_note_missed_games'))}` : ''}`;
  const live = () => { pushCfg(); };
  const sel = $('#rmPin');
  sel.value = String(c.rumblePin ?? PIN_NONE);
  sel.onchange = () => { c.rumblePin = +sel.value; live(); buildRumble(); };
  const st = $('#rmStr');
  if (st) st.oninput = () => { c.rumbleStrength = +st.value; $('#rmStrV').textContent = c.rumbleStrength + ' %'; live(); };
  body.querySelectorAll('[data-bit]').forEach((cb) => (cb.onchange = () => { const b = +cb.dataset.bit; c.rumbleFlags = cb.checked ? c.rumbleFlags | b : c.rumbleFlags & ~b; live(); }));
  const tv = $('#rmTest');
  if (tv) tv.onclick = async () => { try { await state.dev.setConfig(c); await state.dev.rumbleTest(500); } catch (e) { toast(t('tune.rumble.rumble_test_failed', { message: e.message }), 'bad'); } };
}

// ------------------------------------------------------------------ tilt sensors (firmware 0.29+)
// Live state of the two sensors, with the firmware's star power hysteresis (4 %)
const tiltOn = [false, false];
function tiltStates(s) {
  const c = state.cfg;
  if (!c?.atilt || (c.cfgVersion ?? 0) < 5) return [];
  return c.atilt.map((tv, i) => {
    const raw = tiltSourceRaw(s, tv.src);
    const value = tiltValue(raw, tv);
    const mo = tiltMapOut(11 + i, c);   // assigned to a gamepad output in the running mode: the Tune behaviour is off
    const func = mo != null ? -2 : tv.target === 0 ? -1 : tiltFuncOf(1 + i, c);
    if (value == null) { tiltOn[i] = false; return { raw, value: null, whammy: false, star: false, press: false, func, out: mo }; }
    if (tv.target === 1 || mo != null) {
      const on = tv.threshold / 100, off = on - 0.04;
      tiltOn[i] = tiltOn[i] ? value > off : value >= on;
    } else tiltOn[i] = false;
    const v = mo == null && tv.target === 0 && value < c.whammyDeadzone / 100 ? 0 : value;
    return { raw, value: v, whammy: mo == null && tv.target === 0, star: tiltOn[i] && func === FUNC_STAR, press: tiltOn[i], func, out: mo };
  });
}

// Quick setup: raw captures live here, never in cfg
// target: 1 star power, 0 whammy, 2 a button (func picked from a list)
const qt = { target: 1, chosen: false, chip: 0, level: null, tilted: null, func: FUNC_STAR };
let qtSlot = -1, qtBtnSlot = -1, tiltKey = '', qAna = null, qSlotPref = -1;
const isAxisSrc = (src) => (src >= 3 && src <= 5) || (src >= 9 && src <= 11);
const axisIdx = (src) => (src >= 9 ? src - 9 : src - 3);
// what a sensor slot does, as the guided setup sees it: 0 whammy, 1 star power, 2 another button
const slotMode = (c, i) => (c.atilt[i].target === 0 ? 0 : tiltFuncOf(1 + i, c) !== FUNC_STAR || i === qtBtnSlot ? 2 : 1);
const quickSlotChip = (c) => c.atilt.findIndex((tv) => isAxisSrc(tv.src) && (!qt.chip === (tv.src < 9)));
const quickSlotFor = (c, mode) => c.atilt.findIndex((tv, i) => isAxisSrc(tv.src) && slotMode(c, i) === mode);
const accStatusText = (s, on) => !on ? t('tune.tilt.pick_pins_accelerometer_wired')
  : !s?.accelType ? t('tune.tilt.looking_accelerometer_check_wiring_sda')
  : t('tune.tilt.found', { sensor: ACCEL_TYPES[s.accelType] || t('tune.tilt.accelerometer_3') });
const tiltStateText = (src, tv) => src === PIN_NONE ? t('common.off') : tv.value == null ? (tv.raw == null ? 'no reading' : 'calibrate') : tv.whammy ? t('tune.tilt.whammy', { percent: Math.round(tv.value * 100) }) : tv.star ? t('tune.tilt.star_power') : tv.press ? (tv.out != null ? t('tune.tilt.active') : funcName(tv.func).toUpperCase()) : 'level';
const pressWord = (f) => (f === FUNC_STAR ? t('common.star_power') : funcName(f));
const tiltKeyOf = (s) => `${!!s?.accelType}|${!!s?.accel2Type}`;

// accelerometer SDA/SCL pairs: even SDA, a valid I2C pair, pins in use elsewhere left out
function accelPairs(c) {
  const own = new Set(accelPins());
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...hostPins(), c.rumblePin ?? PIN_NONE, ...extPinList(c)].filter((p) => p !== PIN_NONE && !own.has(p)));
  return [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !(p & 1) && i2cPinsOk(p, p + 1) && !taken.has(p) && !taken.has(p + 1));
}
const accPinsSelect = (pairs) => `<select id="accPins" aria-label="${t('tune.tilt.aria_label.accelerometer_pins')}"><option value="255">${t('common.none')}</option>${pairs.map((p) => `<option value="${p}">SDA GP${p}, SCL GP${p + 1}</option>`).join('')}</select>`;
function wireAccPins(root, rebuild) {
  const c = state.cfg, sel = root.querySelector('#accPins');
  sel.value = String(c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl) ? c.accelSda : PIN_NONE);
  sel.onchange = () => {
    const p = +sel.value;
    c.accelSda = p; c.accelScl = p === PIN_NONE ? PIN_NONE : p + 1;
    if (p === PIN_NONE) c.atilt.forEach((tv) => { if (tv.src >= 3) tv.src = PIN_NONE; });
    pushCfg(); rebuild();
  };
}

// state of the guided capture card (shared by the Tune page and the Setup "Tilt sensors" step). ana: an analog channel 0..2, or null for the accelerometer
function quickModel(c, ana = null) {
  const st0 = state.status, two = fwAtLeast(ACCEL2_MIN_MINOR);
  const accelOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const found = ana != null || (accelOn && !!st0?.accelType);
  const found2 = ana == null && found && two && !!st0.accel2Type;
  const mapUi = tiltMapUi(), btnOk = tiltFuncOk();
  qAna = ana;
  if (!btnOk && qt.target === 2) qt.target = 1;
  if (!qt.chosen && !mapUi) {
    if (quickSlotFor(c, 1) >= 0) qt.target = 1; else if (quickSlotFor(c, 0) >= 0) qt.target = 0; else if (btnOk && quickSlotFor(c, 2) >= 0) qt.target = 2;
  }
  if (!found2) qt.chip = 0;
  else if (mapUi && !qt.chosen) { const sl = c.atilt.find((tv) => isAxisSrc(tv.src)); if (sl) qt.chip = sl.src >= 9 ? 1 : 0; }
  qtSlot = found ? (ana != null ? c.atilt.findIndex((tv) => tv.src === ana) : mapUi ? quickSlotChip(c) : quickSlotFor(c, qt.target)) : -1;
  const stage = qtSlot >= 0 ? 'result' : qt.level ? 'tilted' : 'level';
  const qs = qtSlot >= 0 ? c.atilt[qtSlot] : null;
  const qsChip = qs ? (qs.src >= 9 ? 2 : 1) : 0;
  const qAv = mapUi && qtSlot >= 0 ? assignValue(11 + qtSlot) : '', qKind = assignKind(qAv);
  const qShowThr = qtSlot >= 0 && (mapUi ? qKind === 'func' || qKind === 'digital' || qKind === 'mixed' : qt.target !== 0);
  const qResp = mapUi && qKind === 'analog' && fwAtLeast(43) && !!c.ext?.curve;
  return { ana, found, found2, mapUi, btnOk, stage, qs, qsChip, qAv, qKind, qShowThr, qResp };
}
function quickHtml(m, c) {
  if (!m.found) return '';
  const { ana, found2, mapUi, btnOk, stage, qs, qsChip, qAv, qKind, qShowThr, qResp } = m;
  return `
    <div class="tilt-quick" id="tiltQuick">
      <h3>${t('tune.tilt.guided_setup')}</h3>
      <ol class="tilt-steps">
        ${mapUi ? '' : `<li class="done"><span class="n">✓</span><div><b>${t('tune.tilt.what_should_tilting_do')}</b>
          <div class="seg" role="group" aria-label="${t('tune.tilt.aria_label.what_should_tilting_do')}"><button data-qt="1" class="${qt.target === 1 ? 'on' : ''}">${t('common.star_power')}</button><button data-qt="0" class="${qt.target === 0 ? 'on' : ''}">${t('common.whammy')}</button>${btnOk ? `<button data-qt="2" class="${qt.target === 2 ? 'on' : ''}">${t('tune.tilt.button')}</button>` : ''}</div>
          ${btnOk && qt.target === 2 ? `<div class="dim small">${t('tune.tilt.which_input')}</div><select id="qPick" aria-label="${t('tune.tilt.aria_label.which_input_should_tilting_press')}">${tiltFuncOptions(qt.func, false)}</select>` : ''}
          ${found2 ? `<div class="dim small">${t('tune.tilt.which_sensor')}</div><div class="seg" role="group" aria-label="${t('tune.tilt.aria_label.which_sensor')}"><button data-qc="0" class="${qt.chip === 0 ? 'on' : ''}">${t('tune.tilt.chip_1')}</button><button data-qc="1" class="${qt.chip === 1 ? 'on' : ''}">${t('tune.tilt.chip_2')}</button></div>` : ''}
        </div></li>`}
        <li class="${stage === 'result' || qt.level ? 'done' : 'active'}"><span class="n">${stage === 'result' || qt.level ? '✓' : mapUi ? '1' : '2'}</span><div>${t('tune.tilt.hold_guitar_level_way_play', { v: mapUi && found2 && stage !== 'result' ? `<div class="dim small">${t('tune.tilt.which_sensor')}</div><div class="seg" role="group" aria-label="${t('tune.tilt.aria_label.which_sensor')}"><button data-qc="0" class="${qt.chip === 0 ? 'on' : ''}">${t('tune.tilt.chip_1')}</button><button data-qc="1" class="${qt.chip === 1 ? 'on' : ''}">${t('tune.tilt.chip_2')}</button></div>` : '', v2: stage === 'result' ? '' : `<div><button class="btn small" id="qCapLevel">${t('tune.tilt.capture_level')}</button></div>` })}</div></li>
        <li class="${stage === 'result' ? 'done' : qt.level ? 'active' : ''}"><span class="n">${stage === 'result' ? '✓' : mapUi ? '2' : '3'}</span><div>${t('tune.tilt.tilt_neck_up', { v: mapUi ? t('tune.tilt.way_will_when_playing') : t('tune.tilt.like_would_star_power'), v2: stage === 'result' ? '' : `<div><button class="btn small" id="qCapTilt" ${qt.level ? '' : 'disabled'}>${t('tune.tilt.capture_tilted')}</button></div>` })}</div></li>
        ${stage === 'result' ? `
        <li class="done"><span class="n">✓</span><div>
          ${mapUi ? `<b>${t('tune.tilt_switch.assign')}</b><div>${assignSelect(11 + qtSlot, t('tune.tilt.guided_setup'))}</div>${t('tune.tilt.done_tilt_neck_try', { note: assignNote(qAv) })}` : `<b>${t('tune.tilt.done', { v: qt.target === 1 ? t('tune.tilt.tilt_neck_try_star_power') : qt.target === 2 ? t('tune.tilt.tilt_neck_press', { v: pressWord(tiltFuncOf(1 + qtSlot)) }) : t('tune.tilt.tilt_guitar_move_whammy') })}</b>`}
          <div class="tilt-meter"><div class="bar" id="qBar"><i></i></div>${qShowThr ? `<span class="thr" id="qThrMark" style="left:${qs.threshold}%"></span>` : ''}</div>
          <div class="tilt-readout"><span><span class="tilt-state" id="qSt">–</span></span><span id="qUsing">${ana != null ? t('tune.tilt.using_gp_analog', { pin: 26 + ana }) : t('tune.tilt.using_accelerometer_axis', { v: found2 || qsChip === 2 ? ' ' + qsChip : '', axis: 'XYZ'[axisIdx(qs.src)] })}</span></div>
          ${qShowThr ? `<div class="slider-row"><label for="qThr">${!mapUi ? (qt.target === 1 ? t('tune.tilt.star_power_at') : t('tune.tilt.press_at')) : qAv === 'f:' + FUNC_STAR ? t('tune.tilt.star_power_at') : t('tune.tilt.trigger_point')}</label><output class="val" id="qThrV">${qs.threshold} %</output><input type="range" id="qThr" min="5" max="95" step="1" value="${qs.threshold}"></div>`
            : qKind === 'analog' && (qResp || rangeOk()) ? (qResp ? responseHtml(1 + qtSlot, c.ext.curve[1 + qtSlot], t('tune.tilt.shapes_how_far_stick_or')) : '') + rangeFor(11 + qtSlot, qAv)
            : qKind === 'w' || !mapUi ? `<p class="dim small">${t('tune.tilt.adds_whammy_bar_whichever_further')}</p>` : ''}
          <div><button class="btn small" id="qRedo">${t('setup.ledmap.redo')}</button></div>
        </div></li>` : ''}
      </ol>
      ${stage === 'result' ? '' : `<div class="tilt-axes" aria-label="${t('tune.tilt.aria_label.live_reading')}">${(ana != null ? ['GP' + (26 + ana)] : ['X', 'Y', 'Z']).map((a, i) => `<div>${a} <span id="qV${i}">–</span><div class="bar"><i id="qB${i}"></i></div></div>`).join('')}</div>`}
    </div>`;
}
function wireQuick(root, m, c, rebuild) {
  const { ana, found2, mapUi } = m, live = () => pushCfg();
  const chipRaw = (st, chip) => { const r = chip ? st?.accel2Raw : st?.accelRaw; return r && r.slice(0, 3).every((v) => v !== undefined && v !== 0xffff) ? r.slice(0, 3) : null; };
  root.querySelectorAll('[data-qt]').forEach((b) => (b.onclick = () => { qt.target = +b.dataset.qt; qt.chosen = true; qtBtnSlot = -1; rebuild(); }));
  const qpick = root.querySelector('#qPick');
  if (qpick) qpick.onchange = () => {
    qt.func = +qpick.value;
    const sl = quickSlotFor(c, 2);   // already captured: the new input takes over right away
    if (sl >= 0) { qtBtnSlot = sl; c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR]; c.tiltFunc[1 + sl] = qt.func; live(); }
    rebuild();
  };
  root.querySelectorAll('[data-qc]').forEach((b) => (b.onclick = () => { qt.chip = +b.dataset.qc; qt.chosen = true; qt.level = qt.tilted = null; rebuild(); }));
  const capL = root.querySelector('#qCapLevel'), capT = root.querySelector('#qCapTilt');
  const grab = () => { const r = ana != null ? (state.status?.adc?.[ana] != null ? [state.status.adc[ana]] : null) : chipRaw(state.status, qt.chip); if (!r) toast(ana != null ? t('tune.tilt.no_reading_from_this_channel') : t('tune.tilt.no_reading_from_accelerometer_yet'), 'bad'); return r; };
  if (capL) capL.onclick = () => { const r = grab(); if (!r) return; qt.level = r; qt.tilted = null; rebuild(); };
  if (capT) capT.onclick = () => {
    const r = grab(); if (!r || !qt.level) return;
    qt.tilted = r;
    const diff = r.map((v, i) => Math.abs(v - qt.level[i]));
    const ax = ana != null ? 0 : diff.indexOf(Math.max(...diff));
    if (diff[ax] < 100) { qt.tilted = null; toast(t('tune.tilt.barely_moved_tilt_neck_further'), 'bad'); rebuild(); return; }
    const want = qt.target, srcId = ana != null ? ana : (qt.chip ? 9 : 3) + ax;
    if (mapUi) {
      let sl = ana != null ? c.atilt.findIndex((tv) => tv.src === ana) : quickSlotChip(c), fresh = false;
      if (sl < 0) { sl = qSlotPref >= 0 ? qSlotPref : c.atilt.findIndex((tv) => tv.src === PIN_NONE); fresh = true; if (sl < 0) sl = 0; }
      const lv = qt.level[ax], tl = r[ax];
      Object.assign(c.atilt[sl], { src: srcId, min: Math.min(lv, tl), max: Math.max(lv, tl), invert: lv > tl });
      if (fresh) { c.atilt[sl].target = 1; c.atilt[sl].threshold = 50; c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR]; c.tiltFunc[1 + sl] = FUNC_STAR; }
      qt.level = qt.tilted = null;
      live(); rebuild();
      return;
    }
    let slot = ana != null ? c.atilt.findIndex((tv) => tv.src === ana) : c.atilt.findIndex((tv, i) => slotMode(c, i) === want && isAxisSrc(tv.src));
    if (slot < 0) slot = qSlotPref >= 0 ? qSlotPref : c.atilt.findIndex((tv) => tv.src === PIN_NONE);
    if (slot < 0) slot = 0;
    const lv = qt.level[ax], tl = r[ax];
    // a button is a "press" target (1) whose input sits in tiltFunc; star power is the same with the star input
    Object.assign(c.atilt[slot], { src: srcId, target: want === 0 ? 0 : 1, min: Math.min(lv, tl), max: Math.max(lv, tl), invert: lv > tl });
    c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR];
    c.tiltFunc[1 + slot] = want === 2 ? qt.func : FUNC_STAR;
    qtBtnSlot = want === 2 ? slot : -1;
    if (want !== 0) c.atilt[slot].threshold = 50;
    qt.level = qt.tilted = null;
    live(); rebuild();
  };
  const redo = root.querySelector('#qRedo');
  if (redo) redo.onclick = () => { qt.level = qt.tilted = null; if (qtSlot >= 0) c.atilt[qtSlot].src = PIN_NONE; qtBtnSlot = -1; live(); rebuild(); };
  const qthr = root.querySelector('#qThr');
  if (qthr) {
    qthr.oninput = () => { const tv = c.atilt[qtSlot]; tv.threshold = +qthr.value; root.querySelector('#qThrV').textContent = tv.threshold + ' %'; root.querySelector('#qThrMark').style.left = tv.threshold + '%'; live(); };
    qthr.onchange = () => rebuild();   // refresh the fine-tune card too
  }
}

// the Tune page's builder, or the Setup step's while that is showing (both draw the same guided capture)
const tsActive = () => state.view === 'setup' && STEPS[state.step]?.kind === 'tiltsens';
const tiltRebuild = () => (tsActive() ? tsRender() : buildTilt());

function buildTilt() {
  if (tsActive()) return;   // the Setup step owns the shared element ids while it shows; Tune rebuilds when opened
  qSlotPref = -1;
  const c = state.cfg, body = $('#tiltBody');
  if (!body) return;
  if ((c.cfgVersion ?? 0) < 5) {
    body.innerHTML = `<p class="notice small">${t('tune.tilt.tilt_sensors_need_firmware_0')}</p>`;
    return;
  }
  const pairs = accelPairs(c);
  const accelOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const two = fwAtLeast(ACCEL2_MIN_MINOR);   // firmware 0.36+ finds a second accelerometer on the same bus
  const srcOpts = (i) => {
    const other = c.atilt[1 - i].src;
    return `<option value="255">${t('common.off_2')}</option>${ATILT_SOURCES.map((s) => {
      const busy = (s.kind === 'adc' && s.id === c.whammyCh) || (s.id === other && other !== PIN_NONE);
      const needs = (s.kind !== 'adc' && !accelOn) || (s.kind === 'accel2' && !two);
      if (needs && c.atilt[i].src !== s.id) return '';
      const name = two && s.kind === 'accel' ? s.name.replace('Accelerometer', 'Accelerometer 1') : s.name;
      const note = s.id === c.whammyCh ? t('tune.tilt.whammy_bar') : s.id === other ? t('tune.tilt.other_sensor') : s.kind === 'lis' ? t('tune.tilt.lis3dh_only') : '';
      return `<option value="${s.id}" ${busy ? 'disabled' : ''}>${name}${note}</option>`;
    }).join('')}`;
  };
  const restOf = (tv) => (tv.invert ? tv.max : tv.min), tiltOf = (tv) => (tv.invert ? tv.min : tv.max);
  // ---- guided capture (shared with the Setup step)
  const qm = quickModel(c); tiltKey = tiltKeyOf(state.status);
  const found = qm.found, mapUi = qm.mapUi;
  const quick = quickHtml(qm, c);
  const cav = c.atilt.map((tv, i) => (mapUi ? assignValue(11 + i) : ''));
  const ckind = cav.map(assignKind);
  const cthr = c.atilt.map((tv, i) => (mapUi ? ['func', 'digital', 'mixed'].includes(ckind[i]) : tv.target === 1));
  body.innerHTML = `
    <div class="tilt-accel">
      <div class="opt first"><div><h3>${t('tune.tilt.accelerometer_3')}</h3><p class="dim">${t('tune.tilt.i2c_module_sda_even_pin')}</p></div>
        ${accPinsSelect(pairs)}</div>
      <p class="acc-status" id="accStatus" role="status"></p>
      ${quick}
      ${found ? `<p class="dim small" style="margin:12px 0 0">${t('tune.tilt.or_set_everything_by_hand')}</p>` : ''}
      <p class="dim small" style="margin:6px 0 0" id="accTwoHint">${t('tune.tilt.two_accelerometers_wire_both_same', { v: two ? '' : t('tune.tilt.needs_firmware_0_36_or') })}</p>
      ${accelOn ? `
      <div class="tilt-readout" style="margin-top:8px">${t('tune.tilt.looking_1_g_1024_counts', { v: two ? t('tune.tilt.chip_1') : t('tune.tilt.chip'), v2: two ? t('tune.tilt.chip_2_looking') : '' })}</div>
      ${two ? `<p class="dim small" id="acc2Hint" hidden>${t('tune.tilt.chip_2_not_found_wire')}</p>` : ''}
      <div class="tilt-axes">${['X', 'Y', 'Z'].map((a, i) => `<div>${two ? '1 ' : ''}${a} <span id="accV${i}">–</span><div class="bar"><i id="accB${i}"></i></div></div>`).join('')}</div>
      ${two ? `<div class="tilt-axes" id="acc2Axes" style="margin-top:6px">${['X', 'Y', 'Z'].map((a, i) => `<div>2 ${a} <span id="acc2V${i}">–</span><div class="bar"><i id="acc2B${i}"></i></div></div>`).join('')}</div>` : ''}
      <div class="cols" style="margin-top:6px">
        <div>
          <div class="slider-row"><label for="accLp">${t('tune.tilt.low_pass')}</label><output class="val" id="accLpV"></output><input type="range" id="accLp" min="0" max="50" step="1"></div>
          <div class="slider-row"><label for="accMed">${t('tune.tilt.median')}</label><output class="val" id="accMedV"></output><input type="range" id="accMed" min="0" max="4" step="1"></div>
        </div>
        <div>
          <div class="slider-row"><label for="accGate">${t('tune.tilt.gravity_gate')}</label><output class="val" id="accGateV"></output><input type="range" id="accGate" min="0" max="50" step="1"></div>
          <p class="dim small">${t('tune.tilt.low_pass_smooths_reading_median')}</p>
        </div>
      </div>` : ''}
    </div>
    <div class="cols tilt-sensors">${c.atilt.map((tv, i) => `
      <div class="tilt-card" data-i="${i}">
        <div class="head"><h3>${t('tune.tilt.sensor', { n: i + 1 })}</h3><span class="tilt-state" id="tSt${i}">${t('common.off')}</span></div>
        <div class="opt first"><div><p class="dim">${t('tune.tilt.reads_from')}</p></div><select data-k="src">${srcOpts(i)}</select></div>
        ${tv.src !== PIN_NONE ? `
        ${mapUi ? `<div class="opt"><div><p class="dim">${t('tune.tilt_switch.assign')}</p></div>${assignSelect(11 + i, t('tune.tilt.sensor', { n: i + 1 }))}</div>${assignNote(cav[i])}`
          : `<div class="opt"><div><p class="dim">${t('tune.tilt_switch.acts_as')}</p></div><select data-k="func" aria-label="${t('tune.tilt.aria_label.sensor_acts_as', { n: i + 1 })}">${tiltFuncOptions(tv.target === 0 ? 'w' : tiltFuncOf(1 + i), true)}</select></div>`}
        ${(mapUi ? ckind[i] === 'analog' : true) && fwAtLeast(43) && c.ext?.curve ? responseHtml(1 + i, c.ext.curve[1 + i], mapUi ? t('tune.tilt.shapes_how_far_stick_or') : t('tune.tilt.used_when_this_sensor_mapped')) : ''}
        ${mapUi && ckind[i] === 'analog' ? rangeFor(11 + i, cav[i]) : ''}
        <div class="tilt-meter"><div class="bar" id="tBar${i}"><i></i></div>${cthr[i] ? `<span class="thr" style="left:${tv.threshold}%"></span>` : ''}</div>
        <div class="tilt-readout">${t('tune.tilt.reading_rest_tilted', { i, v: restOf(tv), v2: tiltOf(tv) })}</div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn small" data-cap="rest">${t('tune.tilt.set_rest_guitar_level')}</button><button class="btn small" data-cap="tilt">${t('tune.tilt.set_tilted_neck_up')}</button></div>
        ${cthr[i] ? `<div class="slider-row"><label>${(mapUi ? cav[i] === 'f:' + FUNC_STAR : tiltFuncOf(1 + i) === FUNC_STAR) ? t('tune.tilt.star_power_at') : mapUi ? t('tune.tilt.trigger_point') : t('tune.tilt.press_at')}</label><output class="val">${tv.threshold} %</output><input type="range" data-k="threshold" min="5" max="95" step="1" value="${tv.threshold}"></div>`
          : !mapUi || ckind[i] === 'w' ? `<p class="dim small" style="margin-top:8px">${t('tune.tilt.adds_whammy_bar_whichever_further_2')}</p>` : ''}` : ''}
      </div>`).join('')}
    </div>`;
  const live = () => { pushCfg(); };
  body.onchange = (e) => { if (mapUi && e.target.matches?.('[data-curve]')) buildTilt(); };   // the guided card and the sensor card show the same curve
  wireAssign(body);
  wireResponse(body, (k) => c.ext.curve[k], (k, v) => { c.ext.curve[k] = v; pushCfg(); });
  if (rangeOk()) wireRange(body, (k) => c.ext.range[k], (k, v) => { c.ext.range[k] = v; pushCfg(); });
  wireAccPins(body, buildTilt);
  if (accelOn) {
    const lp = $('#accLp'), md = $('#accMed'), gt = $('#accGate');
    const MED = [0, 3, 5, 7, 9];
    const show = () => {
      $('#accLpV').textContent = c.accelLowpass ? c.accelLowpass + ' Hz' : t('common.off');
      $('#accMedV').textContent = c.accelMedian ? t('tune.tilt.samples', { accelMedian: c.accelMedian }) : t('common.off');
      $('#accGateV').textContent = c.accelGate ? '±' + (c.accelGate / 100).toFixed(2) + ' g' : t('common.off');
    };
    lp.value = c.accelLowpass; md.value = Math.max(0, MED.indexOf(c.accelMedian)); gt.value = c.accelGate;
    lp.oninput = () => { c.accelLowpass = +lp.value; show(); live(); };
    md.oninput = () => { c.accelMedian = MED[+md.value]; show(); live(); };
    gt.oninput = () => { c.accelGate = +gt.value; show(); live(); };
    show();
  }
  body.querySelectorAll('.tilt-card').forEach((card) => {
    const i = +card.dataset.i, tv = c.atilt[i];
    const s = card.querySelector('select[data-k="src"]');
    s.value = String(tv.src);
    s.onchange = () => { tv.src = +s.value; live(); buildTilt(); };
    const fs = card.querySelector('select[data-k="func"]');
    if (fs) fs.onchange = () => {
      if (fs.value === 'w') tv.target = 0;
      else { tv.target = 1; c.tiltFunc = c.tiltFunc || [FUNC_STAR, FUNC_STAR, FUNC_STAR]; c.tiltFunc[1 + i] = +fs.value; }
      live(); buildTilt();
    };
    const th = card.querySelector('input[data-k="threshold"]');
    if (th) th.oninput = () => { tv.threshold = +th.value; th.previousElementSibling.textContent = tv.threshold + ' %'; card.querySelector('.thr').style.left = tv.threshold + '%'; live(); };
    card.querySelectorAll('[data-cap]').forEach((b) => (b.onclick = () => {
      const raw = tiltSourceRaw(state.status, tv.src);
      if (raw == null) { toast(t('tune.tilt.no_reading_from_this_sensor', { v: tv.src >= 3 ? t('tune.tilt.that_accelerometer_was_found') : '.' }), 'bad'); return; }
      let rest = restOf(tv), tilted = tiltOf(tv);
      if (b.dataset.cap === 'rest') rest = raw; else tilted = raw;
      Object.assign(tv, { min: Math.min(rest, tilted), max: Math.max(rest, tilted), invert: rest > tilted });
      if (tv.max - tv.min < 8) toast(t('tune.tilt.rest_tilted_read_almost_same'), 'bad');
      live(); buildTilt();
    }));
  });
  // ---- quick setup handlers
  wireQuick(body, qm, c, buildTilt);
  if (state.status) updateTilt(state.status);
}

function updateTilt(s) {
  const c = state.cfg;
  if (!c?.atilt || (c.cfgVersion ?? 0) < 5 || !$('#tiltBody')) return;
  if ($('#accPins') && tiltKeyOf(s) !== tiltKey) { tiltRebuild(); return; }   // chip found / lost: quick setup appears or goes
  const accOn = c.accelSda !== PIN_NONE && i2cPinsOk(c.accelSda, c.accelScl);
  const stEl = $('#accStatus');
  if (stEl) { stEl.textContent = accStatusText(s, accOn); stEl.classList.toggle('ok', accOn && !!s.accelType); }
  if ($('#qV0')) {
    const r = qAna != null ? [s.adc[qAna]] : qt.chip ? s.accel2Raw : s.accelRaw;
    for (let i = 0; i < (qAna != null ? 1 : 3); i++) {
      const v = r?.[i], ok = v !== undefined && v !== 0xffff;
      $('#qV' + i).textContent = ok ? (qAna != null ? String(v) : ((v - 2048) / 1024).toFixed(2) + ' g') : '–';
      $('#qB' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  const ty = $('#accType');
  if (ty) {
    ty.textContent = s.accelType ? ACCEL_TYPES[s.accelType] || t('tune.tilt.unknown') : t('tune.tilt.none_found_check_wiring');
    for (let i = 0; i < 3; i++) {
      const v = s.accelRaw[i], ok = v !== 0xffff;
      $('#accV' + i).textContent = ok ? ((v - 2048) / 1024).toFixed(2) + ' g' : '–';
      $('#accB' + i).style.width = ok ? (v / 40.95).toFixed(1) + '%' : '0';
    }
  }
  const ty2 = $('#acc2Type');
  if (ty2) {
    ty2.textContent = s.accel2Type ? ACCEL_TYPES[s.accel2Type] || t('tune.tilt.unknown') : t('tune.tilt.not_found');
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
    const tv = sts[qtSlot];
    qSt.textContent = tiltStateText(c.atilt[qtSlot].src, tv);
    qSt.classList.toggle('on', !!tv.press || (tv.whammy && tv.value > 0));
    if (qBar) { qBar.firstElementChild.style.width = ((tv.value ?? 0) * 100).toFixed(1) + '%'; qBar.classList.toggle('on', !!tv.press); }
  }
  sts.forEach((tv, i) => {
    const st = $('#tSt' + i), bar = $('#tBar' + i), raw = $('#tRaw' + i);
    if (!st) return;
    const src = c.atilt[i].src;
    st.textContent = tiltStateText(src, tv);
    st.classList.toggle('on', !!tv.press || (tv.whammy && tv.value > 0));
    if (raw) raw.textContent = tv.raw ?? '–';
    if (bar) { bar.firstElementChild.style.width = ((tv.value ?? 0) * 100).toFixed(1) + '%'; bar.classList.toggle('on', !!tv.press); }
  });
}

// ------------------------------------------------------------------ backup & restore
function buildBackup() {
  const box = $('#bkRestore');
  box.innerHTML = '';
  $('#bkSave').onclick = () => {
    download(backupFileName(state.info), JSON.stringify(makeBackup(state.cfg, state.info), null, 2));
    toast(t('backup.backup_downloaded'), 'ok');
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
    box.innerHTML = `<p class="bk-meta">${t('backup.made_choose_what_restore', { name: file.name, when, v: parsed.meta.board ? t('backup.on_a', { board: parsed.meta.board }) : '', v2: parsed.meta.firmware ? t('backup.firmware_v', { firmware: parsed.meta.firmware }) : '' })}</p>
      <div class="choice-list" id="bkSections">${SECTIONS.filter((sec) => !sec.ext || state.cfg.ext).map((sec) => {
        const has = !!parsed.sections[sec.id];
        return `<label class="${has ? '' : 'off'}"><input type="checkbox" value="${sec.id}" ${has ? 'checked' : 'disabled'}><div><b>${sec.name}</b><span class="dim">${has ? sec.desc : t('backup.not_this_backup')}</span></div></label>`;
      }).join('')}</div>
      ${parsed.skipped.length ? `<p class="dim small">${t('backup.some_values_were_not_valid', { list: parsed.skipped.join(', ') })}</p>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn quiet" id="bkCancel">${t('common.cancel')}</button><button class="btn primary" id="bkApply">${t('backup.restore_save')}</button></div>`;
    $('#bkCancel').onclick = () => { box.innerHTML = ''; };
    $('#bkApply').onclick = async () => {
      const chosen = [...box.querySelectorAll('#bkSections input:checked')].map((i) => i.value);
      if (!chosen.length) { toast(t('backup.pick_at_least_one_section')); return; }
      try {
        state.cfg = applyBackup(state.cfg, parsed, chosen);
        await state.dev.setConfig(state.cfg);
        await state.dev.save();
        await sleep(400);
        state.cfg = await state.dev.getConfig();
        buildUi(); takeSnapshot();
        toast(chosen.length === SECTIONS.filter((sec) => !sec.ext || state.cfg.ext).length ? t('backup.restored_all_saved_controller') : t('backup.restored_saved_controller', { list: sectionList(chosen.map((id) => SECTIONS.find((x) => x.id === id).name)) }), 'ok');
      } catch (err) { toast(t('backup.restore_failed', { message: err.message }), 'bad'); }
    };
  };
}

// ------------------------------------------------------------------ lights
function liveWhammy(s, cfg = state.cfg) {
  const ts = tiltStates(s);
  return Math.max(cfg.whammyCh !== PIN_NONE ? whammyValue(s.adc[cfg.whammyCh], cfg) : 0, ...ts.map((tv) => (tv.whammy ? tv.value : 0)));
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
  const tf = tiltFuncSet(s, c);
  const up = isPressed(s, c.pins[5]) || tf.has(5), down = isPressed(s, c.pins[6]) || tf.has(6);
  document.querySelectorAll('#mapView .led').forEach((el) => {
    if (el.dataset.strum !== undefined) {
      const role = c.strumRoles[+el.dataset.strum] || 0;
      el.classList.toggle('on', role === 1 ? up : role === 2 ? down : up || down);
      return;
    }
    el.classList.toggle('on', isPressed(s, c.pins[+el.dataset.fret]) || tf.has(+el.dataset.fret));
  });
}

// why the brightness slider stops short of 255
function brightNote(c) {
  const m = maxBrightness(c);
  if (m === 255) return '';
  const two = c.fretLeds === 2 && !c.noFretLeds;
  const kind = c.noFretLeds ? 'strum_only' : !c.strumLeds ? 'two_per_fret' : two ? 'two_per_fret_strum' : 'fret_strum';
  return `<p class="dim small">${t('lights.hw.brightness_limited.' + kind, { m })}</p>`;
}
// LED layout controls (setup wizard and Lights page): fret LEDs on / off, how many strum LEDs, wiring order
const STRUM_COUNTS = localized(() => ([t('common.none'), '1', '2', '3', '4', '5', '6', '7', '8']));
function ledLayoutControls(c, pfx = 'lay') {
  const l = ledLayout(c);
  const v6 = (c.cfgVersion ?? 0) >= 6;
  return `<div class="opt"><div><h3>${t('common.fret_leds')}</h3><p class="dim">${t('lights.hw.leds_under_five_frets')}</p></div>
      <label class="switch"><input type="checkbox" id="${pfx}Frets" ${l.frets ? 'checked' : ''}><i></i></label></div>
    ${l.frets && v6 ? `<div class="opt"><div><h3>${t('lights.hw.leds_per_fret')}</h3><p class="dim">${t('lights.hw.two_under_each_fret_light')}</p></div>
      <select id="${pfx}Per"><option value="1" ${l.per === 1 ? 'selected' : ''}>${t('lights.hw.one')}</option><option value="2" ${l.per === 2 ? 'selected' : ''}>${t('lights.hw.two')}</option></select></div>` : ''}
    <div class="opt"><div><h3>${t('common.strum_bar_leds')}</h3><p class="dim">${t('lights.hw.leds_strum_bar_same_chain')}</p></div>
      <select id="${pfx}Strum">${STRUM_COUNTS.map((tv, n) => `<option value="${n}" ${n === l.strum ? 'selected' : ''}>${tv}</option>`).join('')}</select></div>
    ${l.frets && l.strum ? `<div class="opt"><div><h3>${t('lights.hw.wiring_order')}</h3><p class="dim">${t('lights.hw.which_leds_come_first_chain')}</p></div>
      <select id="${pfx}Order"><option value="0" ${!l.strumFirst ? 'selected' : ''}>${t('lights.hw.frets_first')}</option><option value="1" ${l.strumFirst ? 'selected' : ''}>${t('lights.hw.strum_leds_first')}</option></select></div>` : ''}
    ${!l.frets && !l.strum ? `<p class="dim small">${t('lights.hw.choose_fret_leds_strum_leds')}</p>` : ''}`;
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
    return { strum: k, color: c.strumColor || '#ffffff', name: t('lights.hw.strum', { n: k + 1 }) };
  });
}

// ------------------------------------------------------------------ LED setup helpers (guided step, ledmap step, Lights page)
const fwApaOk = () => !!state.info && (state.info.major > 0 || state.info.minor >= 32);   // APA102 at 4 MHz + the SK9822 fix
const LED_SHORT = ['WS2812B', 'SK6812 RGBW', 'APA102 / SK9822'];
const LED_PICKS = localized(() => ([
  { t: 0, name: 'WS2812B / NeoPixel', wires: t('lights.hw.ws2812b_neopixel.wires'), note: t('lights.hw.ws2812b_neopixel.note') },
  { t: 1, name: 'SK6812 RGBW', wires: t('lights.hw.ws2812b_neopixel.wires'), note: t('lights.hw.sk6812_rgbw.note') },
  { t: 2, name: 'APA102 / SK9822 / DotStar', wires: t('lights.hw.apa102_sk9822_dotstar.wires'), note: t('lights.hw.apa102_sk9822_dotstar.note') },
]));
// tiny picture of the pads at the end of a strip, so the user can match it to what they soldered
function ledSvg(tv) {
  const pads = tv === 2 ? ['5V', 'DI', 'CI', 'GND'] : ['5V', 'DIN', 'GND'];
  const xs = tv === 2 ? [18, 50, 82, 114] : [22, 66, 110];
  const dots = tv === 1 ? ['#ff4d4d', '#3ddc84', '#4d8dff', '#ffffff'] : ['#ff4d4d', '#3ddc84', '#4d8dff'];
  return `<svg viewBox="0 0 132 52" aria-hidden="true"><rect x="2" y="14" width="128" height="34" rx="5" fill="none" stroke="currentColor" opacity=".35"/>
    ${pads.map((p, i) => `<rect x="${xs[i] - 6}" y="18" width="12" height="7" rx="1.5" fill="#d9a441"/><text x="${xs[i]}" y="11" text-anchor="middle" font-size="9" font-family="monospace" fill="currentColor">${p}</text>`).join('')}
    <rect x="48" y="30" width="36" height="14" rx="3" fill="#2a3144" stroke="currentColor" opacity=".9"/>
    ${dots.map((d, i) => `<circle cx="${66 + (i - (dots.length - 1) / 2) * 8}" cy="37" r="2.6" fill="${d}"/>`).join('')}</svg>`;
}
function ledTypeCards(c) {
  return `<div class="led-cards" role="group" aria-label="${t('common.led_type')}">${LED_PICKS.map((p) => `<button type="button" class="led-card ${c.ledType === p.t ? 'sel' : ''}" data-ledtype="${p.t}" aria-pressed="${c.ledType === p.t}">
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
    { ok: c.rgbEnabled, text: t('lights.hw.leds_are_switched'), bad: t('lights.hw.leds_are_switched_off'), why: t('lights.dark.off') },
    { ok: c.rgbPin !== PIN_NONE, text: t('lights.hw.data_pin_chosen_gp', { rgbPin: c.rgbPin }), bad: t('lights.hw.no_data_pin_chosen'), why: t('lights.dark.no_data_pin') },
  ];
  if (apa) r.push({ ok: c.ledClkPin !== PIN_NONE && c.ledClkPin !== c.rgbPin, text: t('lights.hw.clock_pin_chosen_gp', { ledClkPin: c.ledClkPin }), bad: c.ledClkPin === c.rgbPin && c.ledClkPin !== PIN_NONE ? t('lights.hw.clock_pin_same_as_data') : t('lights.hw.no_clock_pin_chosen_apa102'), why: t('lights.dark.no_clock_pin') });
  r.push({ ok: chain > 0, text: t('lights.led_check.layout_leds', { n: chain }), bad: t('lights.hw.no_leds_layout_choose_fret'), why: t('lights.dark.no_layout') });
  r.push({ ok: c.rgbBrightness > 0, text: t('lights.hw.brightness', { rgbBrightness: c.rgbBrightness }), bad: t('lights.hw.brightness_0_which_dark'), why: t('lights.dark.brightness_0') });
  if (apa) r.push({ ok: fwApaOk(), text: t('lights.hw.firmware_supports_apa102'), bad: t('lights.hw.firmware_v_too_old_apa102', { major: state.info?.major, minor: state.info?.minor }), why: t('lights.dark.firmware'), update: true });
  return r;
}
// one sentence for why the LEDs are dark right now, or '' when the settings are fine
const ledWhyDark = (c) => { const b = ledChecks(c).find((k) => !k.ok); return b ? b.why : ''; };
// reusable troubleshooting panel; `open` keeps it expanded
function ledHelpHtml(c, open = false) {
  const li = (ok, tv, extra = '') => `<li class="${ok ? 'ok' : 'bad'}"><i>${ok ? '✓' : '✗'}</i><span>${tv}${extra}</span></li>`;
  return `<details class="led-help" ${open ? 'open' : ''}><summary>${t('lights.hw.not_lighting_up_troubleshooting')}</summary>
    <h4>${t('lights.hw.settings')}</h4>
    <ul class="led-checks">${ledChecks(c).map((k) => li(k.ok, k.ok ? k.text : k.bad, k.update && !k.ok ? ` <button type="button" class="btn small" data-led-update>${t('common.update_firmware')}</button>` : '')).join('')}
      <li class="info">${t('lights.hw.i_led_type_set_must', { ledType: LED_SHORT[c.ledType] || LED_SHORT[0] })}</li></ul>
    <h4>${t('lights.hw.wiring')}</h4>
    <ul class="led-tips">
      <li>${t('lights.hw.data_goes_into_first_led')}</li>
      <li>${t('lights.hw.ground_shared_between_pico_leds')}</li>
      <li>${t('lights.hw.power_leds_from_vbus_5')}</li>
      ${c.ledType === 2 ? `<li>${t('lights.hw.apa102_data_clock_may_be')}</li>` : ''}
      <li>${t('lights.hw.wrong_colours_change_colour_order', { v: advOn() || c.ledType === 2 || c.ledOrder !== 0 ? '' : ` <button type="button" class="btn small" data-adv-on>${t('common.turn_advanced')}</button>` })}</li>
      <li>${t('lights.hw.flicker_or_random_colours_330')}</li>
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
  btn.disabled = true; btn.textContent = t('lights.hw.testing');
  const ok = await runLedTest();
  if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  return ok;
}

let ledHwOpen = false;   // the Lights page's "Change setup" disclosure (opens by itself while the LEDs would be dark)
function buildLights() {
  const c = state.cfg;
  const $on = $('#rgbOn'), $pin = $('#rgbPin'), $bri = $('#rgbBri'), $spd = $('#fxSpeed');
  const used = new Set(assignedPins());
  $pin.innerHTML = `<option value="255">${t('common.choose_pin')}</option>${[...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.rgbPin).map((p) => `<option value="${p}">GP${p}</option>`).join('')}`;
  $('#fxSel').innerHTML = EFFECTS.map((e) => `<option value="${e.id}">${e.name}</option>`).join('');
  $('#presets').innerHTML = RGB_PRESETS.map((p, i) => `<button class="preset" data-preset="${i}">${p.colors.map((x) => `<i style="background:${x}"></i>`).join('')}<span>${p.name}</span></button>`).join('');
  $('#colRows').innerHTML = [0, 1, 2, 3, 4].map((f) => `<div class="col-row"><span><span class="fretdot" style="background:${FRET_DEFAULT_COLORS[f]}"></span>${funcName(f)}</span>
      <input type="color" data-col="${f}"><span class="hex" data-hex="${f}"></span></div>`).join('');

  // APA102 / SK9822 send blue first: for them setting 0 is BGR and the BGR slot is GRB (see rgb.c)
  const orderNames = (tv) => LED_ORDERS.map((o, i) => (tv === 2 ? (i === 0 ? t('lights.bgr_standard') : i === 5 ? 'GRB' : o) : (i === 0 ? t('lights.grb_standard') : o)));
  $('#ledClk').innerHTML = `<option value="255">${t('common.choose_pin')}</option>${[...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === c.ledClkPin).map((p) => `<option value="${p}">GP${p}</option>`).join('')}`;
  const refresh = () => {
    $on.checked = c.rgbEnabled;
    $('#ledTypeDesc').textContent = (LED_TYPES[c.ledType] || LED_TYPES[0]).desc;
    $('#ledTypeCards').innerHTML = ledTypeCards(c);
    wireLedTypeCards($('#ledTypeCards'), c, live);
    // status line + help: say why the LEDs are dark right now; keep the panel open if the user opened it
    const why = ledWhyDark(c), st = $('#ledStatus'), n = ledLayout(c).chain;
    st.className = 'led-sum-line ' + (why ? 'bad' : 'ok');
    st.textContent = why ? why
      : t('lights.gp_brightness', { v: t('lights.led_count', { n }), ledType: LED_SHORT[c.ledType] || LED_SHORT[0], rgbPin: c.rgbPin, v2: c.ledType === 2 ? ' + GP' + c.ledClkPin : '', rgbBrightness: c.rgbBrightness });
    $('#ledTestBtn').disabled = !!why;
    $('#ledSetupGo').hidden = !why;
    // the hardware controls are tucked away while everything works, and open by themselves when the LEDs would be dark
    const open = !!why || ledHwOpen;
    $('#ledSetupBody').hidden = !open;
    $('#ledSetupBtn').hidden = !!why;
    $('#ledSetupBtn').setAttribute('aria-expanded', String(open));
    $('#ledSetupBtn').textContent = open ? t('lights.hide_setup') : t('lights.change_setup');
    const help = $('#ledHelp'), html = ledHelpHtml(c, !!help.querySelector('details[open]'));
    if (help._html !== html) { help.innerHTML = html; help._html = html; }
    $('#ledOrder').innerHTML = orderNames(c.ledType).map((o, i) => `<option value="${i}">${o}</option>`).join('');
    $('#ledOrder').value = String(c.ledOrder); $('#ledClk').value = String(c.ledClkPin);
    $('#ledOrderRow').style.display = c.ledType !== 1 ? '' : 'none';
    $('#ledOrderHint').textContent = c.ledType === 2 ? t('lights.most_apa102_sk9822_leds_are') : t('lights.if_red_shows_up_green');
    $('#ledClkRow').style.display = c.ledType === 2 ? '' : 'none';
    // the data and clock pins can't be the same GPIO
    for (const o of $('#ledClk').options) o.disabled = +o.value !== PIN_NONE && +o.value === c.rgbPin;
    for (const o of $pin.options) o.disabled = c.ledType === 2 && +o.value !== PIN_NONE && +o.value === c.ledClkPin;
    $('#ledClkRow').classList.toggle('warn', c.ledType === 2 && c.rgbEnabled && c.ledClkPin === PIN_NONE);
    $('#ledClkHint').textContent = c.ledType === 2 && c.ledClkPin === PIN_NONE ? t('lights.choose_clock_pin_apa102_leds') : t('lights.wired_first_led_s_clock');
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
      || `<p class="dim">${t('lights.no_leds_set_up_choose')}</p>`;
    applyColors();
    syncStudio();
  };
  const live = () => { refresh(); pushCfg(); };

  $on.onchange = () => { c.rgbEnabled = $on.checked; live(); };
  $pin.onchange = () => { c.rgbPin = +$pin.value; live(); };
  $('#ledSetupBtn').onclick = () => { ledHwOpen = !ledHwOpen; refresh(); };
  $('#ledSetupGo').onclick = () => { showView('setup'); goStep(STEPS.findIndex((s) => s.kind === 'rgb')); };
  $('#ledTestBtn').onclick = () => ledTestButton($('#ledTestBtn'), t('lights.test_leds'));
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
    $('#strumOpts').innerHTML = n ? `${oldFw ? `<div class="col-row"><span>${t('lights.strum_led_colour')}</span><input type="color" id="strumCol" value="${c.strumColor || '#ffffff'}"><span class="hex" id="strumHex">${(c.strumColor || '#ffffff').toUpperCase()}</span></div>` : ''}
      ${n > 1 ? `<div class="opt"><div><h3>${t('lights.how_are_they_placed')}</h3><p class="dim">${t('lights.pick_one_that_matches_build')}</p></div>
        <span class="row"><button class="btn small" data-rp="both">${t('lights.one_row_under_strum_bar')}</button><button class="btn small" data-rp="half">${t('lights.two_groups_first_half_up')}</button><button class="btn small" data-rp="alt">${t('lights.alternate_up_down')}</button></span></div>` : ''}
      ${[...Array(n).keys()].map((k) => `<div class="opt"><div><h3>${t('lights.strum_led', { n: k + 1 })}</h3><p class="dim">${t('lights.lights_up')}</p></div>
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
    whammy: (s) => liveWhammy(s), tiltFuncs: (s) => tiltFuncSet(s), turnOn: () => { c.rgbEnabled = true; live(); },
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
    ? (id === running ? `<span class="tag">${t('modes.setup_session')}</span>` : id === c.usbMode ? `<span class="tag live">${t('modes.next_plug')}</span>` : '<span></span>')
    : (id === running ? `<span class="tag live">${t('modes.running')}</span>` : '<span></span>');
  $('#modeCards').innerHTML = availableModes().map((m) => `<div class="mode-row ${c.usbMode === m.id ? 'sel' : ''}" data-mode="${m.id}" role="radio" tabindex="0" aria-checked="${c.usbMode === m.id}" title="${m.desc.replace(/"/g, '&quot;')}">
      <span class="radio"></span><div><b>${m.base || m.name}</b>${m.host ? ` <span class="tag exp">${t('modes.experimental')}</span>` : ''}<div class="dim">${MODE_USE[m.id] || ''}</div></div>
      ${modeTag(m.id)}</div>`).join('');
  $('#setupNote').hidden = !setup;
  $('#macNote').hidden = !IS_MAC;
  $('#macNote').innerHTML = IS_MAC ? t('modes.mac', { MAC_XINPUT_TIP: t('modes.mac_xinput_tip') }) : '';
  $('#setupNote').innerHTML = setup ? t('modes.guitar_one_off_setup_session', { mode: modeBaseName(c.usbMode) }) : '';
  buildHostPort();
  const pick = (row) => { c.usbMode = +row.dataset.mode; buildModes(); $(`#modeCards [data-mode="${c.usbMode}"]`)?.focus(); };
  $('#modeCards').onclick = (e) => { const row = e.target.closest('.mode-row'); if (row) pick(row); };
  $('#modeCards').onkeydown = (e) => { const row = e.target.closest('.mode-row'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(row); } };
  const opts = (sel) => `<option value="255" ${sel === MODE_NONE ? 'selected' : ''}>${t('modes.nothing_use_default')}</option>${availableModes().map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}`;
  $('#bootTable').innerHTML = [0, 1, 2, 3, 4].map((i) => `<div class="fret-row" style="--c:${FRET_COLORS[i]}"><span class="fret-key"></span><label for="boot${i}">${funcName(i)}</label>
      <select id="boot${i}" data-fret="${i}">${opts(c.bootModes[i])}</select></div>`).join('');
  $('#bootTable').onchange = (e) => { c.bootModes[+e.target.dataset.fret] = +e.target.value; buildHostPort(); };

  // XInput flavour
  const XI = [{ id: 0, name: t('modes.guitar_hero_guitar.name'), desc: t('modes.guitar_hero_guitar.desc') },
              { id: 1, name: t('modes.rock_band_guitar.name'), desc: t('modes.rock_band_guitar.desc') }];
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
  const taken = new Set([...c.pins, c.tiltPin, c.rgbPin, c.ledClkPin, ...accelPins(c), c.rumblePin ?? PIN_NONE, ...extPinList(c)].filter((p) => p !== PIN_NONE && !own.has(p)));
  const free = [...Array(NUM_DIGITAL_PINS - 1).keys()].filter((p) => !taken.has(p) && !taken.has(p + 1));
  const sel = $('#hostPin');
  sel.innerHTML = `<option value="255">${t('modes.host.off_no_host_port')}</option>${free.map((p) => `<option value="${p}">D+ GP${p}, D− GP${p + 1}</option>`).join('')}`;
  sel.value = String(free.includes(c.hostPin) ? c.hostPin : PIN_NONE);
  const show = () => {
    const on = c.hostPin !== PIN_NONE;
    $('#wDp').textContent = on ? 'GP' + c.hostPin : t('modes.host.pin_pick');
    $('#wDm').textContent = on ? 'GP' + (c.hostPin + 1) : t('modes.host.next_pin');
    $('#hostPinNote').textContent = t('modes.host.two_neighbouring_free_pins_they');
    const needs = MODES.find((m) => m.id === c.usbMode)?.host || c.bootModes.some((id) => MODES.find((m) => m.id === id)?.host);
    const w = $('#hostWarn');
    w.hidden = !(needs && !on);
    w.textContent = t('modes.host.ps4_xbox_one_mode_selected');
  };
  sel.onchange = () => { c.hostPin = +sel.value; show(); };
  show();
}

// ------------------------------------------------------------------ flash page
const BOARD_LIST = localized(() => ([
  { id: 'pico_clone', arch: 'rp2040', name: t('install.pico_clone.name'), help: t('install.pico_clone.help') },
  { id: 'pico', arch: 'rp2040', name: 'Raspberry Pi Pico', help: t('install.pico.help') },
  { id: 'pico_w', arch: 'rp2040', name: 'Raspberry Pi Pico W', help: t('install.pico_w.help') },
  { id: 'pico2', arch: 'rp2350', name: 'Raspberry Pi Pico 2', help: t('install.pico2.help') },
  { id: 'pico2_w', arch: 'rp2350', name: 'Raspberry Pi Pico 2 W', help: t('install.pico2_w.help') },
  { id: 'waveshare_rp2040_zero', arch: 'rp2040', name: t('install.waveshare_rp2040_zero.name'), help: t('install.waveshare_rp2040_zero.help') },
  { id: 'waveshare_rp2040_one', arch: 'rp2040', name: 'Waveshare RP2040-One', help: t('install.waveshare_rp2040_one.help') },
  { id: 'sparkfun_promicro', arch: 'rp2040', name: t('install.sparkfun_promicro.name'), help: t('install.sparkfun_promicro.help') },
  { id: 'adafruit_kb2040', arch: 'rp2040', name: t('install.adafruit_kb2040.name'), help: t('install.adafruit_kb2040.help') },
]));

let applyBoard = () => {};
function renderBoardList() {
  const sel = $('#boardSel');
  const keep = sel.value || store.get('yacc.board') || 'pico_clone';
  sel.innerHTML = BOARD_LIST.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  sel.value = keep;
  if (!BOARD_LIST.some((b) => b.id === sel.value)) sel.value = 'pico_clone';
  applyBoard();
}
function initFlash() {
  const sel = $('#boardSel');
  renderBoardList();
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
  sel.onchange = apply; applyBoard = apply; apply();
  // a connected guitar can jump into the bootloader itself (same as Star power + Plus at plug-in)
  const refreshBootsel = () => { const on = !!state.dev; $('#toBootsel').hidden = !on; $('#bootselNote').hidden = !on; };
  $('#toBootsel').onclick = async () => {
    try { await state.dev.reboot(true); toast(t('install.restarting_into_update_mode_copy'), 'ok'); }
    catch (e) { toast(t('install.could_not_restart', { message: e.message }), 'bad'); }
  };
  setInterval(refreshBootsel, 1000); refreshBootsel();

  if (!window.showDirectoryPicker) { $('#directFw').disabled = true; $('#directNuke').disabled = true; $('#directFw').title = t('install.needs_chrome_or_edge'); }
  if (!webusbSupported()) {
    const w = $('#browserWarn');
    w.style.display = '';
    w.innerHTML = t('install.webusb_not_available_this_browser');
  }
}

async function directFlash(url, name) {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!/RP/i.test(dir.name)) {
      if (!confirm(t('install.does_not_look_like_pico', { name: dir.name }))) return;
    }
    const buf = await (await fetch(url)).arrayBuffer();
    const fh = await dir.getFileHandle(name, { create: true });
    try {
      const w = await fh.createWritable();
      await w.write(buf);
      await w.close();
    } catch { /* the drive disappears as soon as the board reboots into the new firmware */ }
    $('#flashMsg').textContent = t('install.wrote_board_restarting_if_drive', { name });
    toast(t('install.flashed', { name }), 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') toast(t('install.direct_flash_failed', { message: e.message }), 'bad');
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
  box.innerHTML = `<div class="result"><span class="pulse"></span><span>${t('setup.gate.asking_controller_restart_setup_mode')}</span></div>`;
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
    box.innerHTML = `<div class="result bad">${t('setup.gate.could_not_talk_unplug_hold', { message: e.message })}</div>`;
    return;
  }
  await sleep(3000);
  navigator.hid.removeEventListener('disconnect', onGone);
  if (gone) {
    box.innerHTML = `<div class="result ok">${t('setup.gate.restarted_setup_mode_if_does')}</div>`;
    await sleep(1500);
    autoConnect(true);
  } else {
    box.innerHTML = `<div class="result bad" style="text-align:left">${t('setup.gate.controller_did_not_restart_probably')}</div>`;
  }
}

function showOtherMode(dev) {
  const box = $('#otherMode');
  if (!box) return;
  if (!dev || state.dev) { box.innerHTML = ''; return; }
  if (dev.vendorId === 0x0f0d) {
    box.innerHTML = `<div class="notice info" style="text-align:left">${t('setup.gate.found_controller_switch_mode_that')}</div>`;
  } else if (canRestart(dev)) {
    box.innerHTML = `<div class="notice info" style="text-align:left">
        ${t('setup.gate.found_controller_mode_that_mode', { v: dev.vendorId === 0x1bad ? 'Wii Rock Band' : dev.productId === 0x0200 ? 'PS3 Rock Band' : 'PS3 Guitar Hero' })}<div class="row" style="margin-top:10px"><button class="btn primary small" id="toSetup">${t('setup.gate.restart_setup_mode')}</button>
        <span class="muted" style="font-size:12px">${t('setup.gate.or_unplug_hold_plus_while')}</span></div></div>`;
    $('#toSetup').onclick = () => restartToSetup(dev);
  } else {
    const kb = dev.productId === 0x0003;
    box.innerHTML = `<div class="notice info" style="text-align:left">${t('setup.gate.found_controller_mode_browser_asks', { v: kb ? 'keyboard' : 'HID', v2: kb ? t('setup.gate.keyboard') : 'HID' })}</div>`;
  }
}

async function scanHid() {
  if (!('hid' in navigator) || state.dev) return showOtherMode(null);
  try { showOtherMode((await navigator.hid.getDevices()).find(isOurHid)); } catch { /* not allowed */ }
}

$('#findHid').onclick = async (e) => {
  e.preventDefault();
  if (!('hid' in navigator)) { toast(t('app.misc.this_browser_has_no_webhid'), 'bad'); return; }
  try {
    const [d] = await navigator.hid.requestDevice({ filters: HID_FILTERS });
    if (!d) { toast(t('app.misc.no_controller_ps3_or_hid')); return; }
    if (canRestart(d)) restartToSetup(d);   // you picked it to configure it: switch straight away
    else showOtherMode(d);
  } catch (err) { toast(t('app.misc.search_failed', { message: err.message }), 'bad'); }
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

// ------------------------------------------------------------------ language
// Static markup (data-i18n*) is refreshed by applyI18n(); everything the code renders is rebuilt from state, so a
// switch never reloads the page or touches the unsaved configuration.
const langSel = $('#langSel');
function syncLangPicker() {
  const pseudo = isPseudo();
  langSel.innerHTML = (pseudo ? '<option value="xx" lang="en">Pseudo (xx)</option>' : '')
    + LANGS.map((l) => `<option value="${l.code}" lang="${l.code}">${l.name}</option>`).join('');
  langSel.value = pseudo ? 'xx' : getLang();
  const cur = LANGS.find((l) => l.code === getLang()) || { name: 'Pseudo', code: 'xx' };
  $('#langCur').textContent = pseudo ? 'xx' : cur.name;
  $('#langCode').textContent = cur.code.split('-')[0].toUpperCase();
}
langSel.addEventListener('change', () => setLang(langSel.value, { persist: langSel.value !== 'xx' }));
function onLanguageChanged() {
  syncLangPicker();
  bpClose(false);                                   // a half-finished button prompt would keep the old language
  renderHardware($('#hwList'));
  renderCompat($('#compatList'));
  renderBoardList();
  syncSteps();                                      // localized() rebuilt STEPS; re-add the optional steps
  updatePill();
  if (state.dev && state.cfg) { buildUi(); updateBar(); checkFirmware(); }
  const sb = $('#siteBanner');
  if (!sb.hidden) checkSite();
}
document.addEventListener('langchange', onLanguageChanged);
syncLangPicker();
