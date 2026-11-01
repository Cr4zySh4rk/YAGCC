// Backup and restore of the controller's settings as a JSON file (in the spirit of GP2040-CE's
// "Data Backup and Restoration"): pick which sections to save or restore.
import { FUNCS, PIN_NONE, NUM_DIGITAL_PINS, NUM_ATILT_SRC, BOARDS, MODES, NUM_IDLE, NUM_PRESS, NUM_STAR, NUM_WFX, NUM_MODE_ROWS, MAP_ROW, NUM_SRC, EXT_PIN_NAMES, devNameValid } from './protocol.js?v=dev';
import { t, localized } from './i18n.js?v=dev';

export const BACKUP_FORMAT = 1;

export const SECTIONS = localized(() => ([
  { id: 'wiring', name: t('backup.section.wiring.name'), desc: t('backup.section.wiring.desc'),
    keys: ['pins', 'whammyCh', 'whammyInvert', 'whammyMin', 'whammyMax', 'tiltPin', 'tiltEnabled', 'tiltInvert', 'tiltFunc', 'btEnabled', 'hostPin'] },
  { id: 'tilt', name: t('common.tilt_sensors'), desc: t('backup.section.tilt.desc'),
    keys: ['atilt', 'tiltFunc', 'accelSda', 'accelScl', 'accelGate', 'accelMedian', 'accelLowpass'] },
  { id: 'ports', name: t('backup.section.ports.name'), desc: t('backup.section.ports.desc'),
    keys: ['ps2Pins', 'wiiSda', 'wiiScl'] },
  { id: 'rumble', name: t('backup.section.rumble.name'), desc: t('backup.section.rumble.desc'),
    keys: ['rumblePin', 'rumbleFlags', 'rumbleStrength'] },
  { id: 'tuning', name: t('backup.section.tuning.name'), desc: t('backup.section.tuning.desc'),
    keys: ['debounceMode', 'debounce100us', 'combinedStrum', 'whammySmooth', 'whammyDeadzone'] },
  { id: 'lights', name: t('common.lights'), desc: t('backup.section.lights.desc'),
    keys: ['rgbEnabled', 'rgbBootFlash', 'rgbPin', 'rgbBrightness', 'rgbEffect', 'rgbSpeed', 'ledMap', 'colors', 'ledType', 'ledOrder', 'ledClkPin', 'rgbStarPower',
      'noFretLeds', 'strumLeds', 'strumMap', 'strumColor', 'strumRoles', 'fretLeds', 'ledMap2',
      'zoneFrets', 'zoneStrum', 'fretPress', 'fret2Colors', 'fret2Own', 'strumLedColors', 'strumUpColor', 'strumDownColor',
      'starColor', 'starAnim', 'starZones', 'starSpeed', 'whammyFx', 'whammyZones', 'starFlash', 'sleepMin'] },
  { id: 'modes', name: t('common.modes'), desc: t('backup.section.modes.desc'),
    keys: ['usbMode', 'bootModes', 'xinputType', 'starDpadLeft', 'xinputOpts', 'keys'] },
  // firmware 0.42+: these live in the extension page (cfg.ext)
  { id: 'controls', ext: true, name: t('backup.section.controls.name'), desc: t('backup.section.controls.desc'),
    keys: ['extPins', 'stickCh', 'stickFlags', 'deadzone', 'cal'] },
  { id: 'mapping', ext: true, name: t('backup.section.mapping.name'), desc: t('backup.section.mapping.desc'),
    keys: ['map', 'curve', 'range'] },
  { id: 'btsleep', ext: true, name: t('backup.section.btsleep.name'), desc: t('backup.section.btsleep.desc'),
    keys: ['btSleep'] },
  { id: 'devname', ext: true, name: t('backup.section.devname.name'), desc: t('backup.section.devname.desc'), keys: ['devName'] },
]));

const isPin = (v) => v === PIN_NONE || (Number.isInteger(v) && v >= 0 && v < NUM_DIGITAL_PINS);
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isZone = (z) => !!z && typeof z === 'object' && isInt(z.idle, 0, NUM_IDLE - 1) && isInt(z.idleLevel, 0, 100) && isInt(z.press, 0, NUM_PRESS - 1) &&
  isInt(z.speed, 1, 10) && isInt(z.fade, 1, 10) && typeof z.same === 'boolean' && typeof z.perLed === 'boolean';
const CHECK = localized(() => ({
  pins: (v) => Array.isArray(v) && v.length === FUNCS.length && v.every(isPin),
  whammyCh: (v) => v === PIN_NONE || (Number.isInteger(v) && v >= 0 && v < 3),
  whammyMin: (v) => Number.isInteger(v) && v >= 0 && v <= 4095,
  whammyMax: (v) => Number.isInteger(v) && v >= 0 && v <= 4095,
  tiltFunc: (v) => Array.isArray(v) && v.length === 3 && v.every((f) => Number.isInteger(f) && f >= 0 && f < FUNCS.length),
  tiltPin: isPin, rgbPin: isPin, ledClkPin: isPin, hostPin: isPin,
  debounce100us: (v) => Number.isInteger(v) && v >= 0 && v <= 250,
  whammySmooth: (v) => Number.isInteger(v) && v >= 0 && v <= 6,
  whammyDeadzone: (v) => Number.isInteger(v) && v >= 0 && v <= 30,
  rgbSpeed: (v) => Number.isInteger(v) && v >= 1 && v <= 10,
  usbMode: (v) => MODES.some((m) => m.id === v),
  xinputOpts: (v) => Number.isInteger(v) && v >= 0 && v <= 7,
  ps2Pins: (v) => Array.isArray(v) && v.length === 5 && v.every(isPin), wiiSda: isPin, wiiScl: isPin,
  bootModes: (v) => Array.isArray(v) && v.length === 5 && v.every((m) => m === 255 || MODES.some((x) => x.id === m)),
  ledMap: (v) => Array.isArray(v) && v.length === 5 && new Set(v).size === 5 && v.every((p) => Number.isInteger(p) && p >= 0 && p < 18),
  ledMap2: (v) => Array.isArray(v) && v.length === 5 && v.every((p) => Number.isInteger(p) && p >= 0 && p < 18),
  fretLeds: (v) => v === 1 || v === 2,
  strumLeds: (v) => Number.isInteger(v) && v >= 0 && v <= 8,
  strumMap: (v) => Array.isArray(v) && v.length === 8 && v.every(isByte),
  strumRoles: (v) => Array.isArray(v) && v.length === 8 && v.every((r) => Number.isInteger(r) && r >= 0 && r <= 2),
  strumColor: (v) => /^#[0-9a-f]{6}$/i.test(v),
  colors: (v) => Array.isArray(v) && v.length === 5 && v.every((c) => /^#[0-9a-f]{6}$/i.test(c)),
  zoneFrets: isZone, zoneStrum: isZone,
  fretPress: (v) => Array.isArray(v) && v.length === 5 && v.every(isHex), fret2Colors: (v) => Array.isArray(v) && v.length === 5 && v.every(isHex),
  strumLedColors: (v) => Array.isArray(v) && v.length === 8 && v.every(isHex), strumUpColor: isHex, strumDownColor: isHex, starColor: isHex,
  starAnim: (v) => isInt(v, 0, NUM_STAR - 1), whammyFx: (v) => isInt(v, 0, NUM_WFX - 1), starZones: (v) => isInt(v, 0, 3), whammyZones: (v) => isInt(v, 0, 3),
  starSpeed: (v) => isInt(v, 1, 10), sleepMin: (v) => isInt(v, 0, 30), fret2Own: (v) => typeof v === 'boolean', starFlash: (v) => typeof v === 'boolean',
  keys: (v) => Array.isArray(v) && v.length === 11 && v.every(isByte),
  atilt: (v) => Array.isArray(v) && v.length === 2 && v.every((s) => s && (s.src === PIN_NONE || (Number.isInteger(s.src) && s.src >= 0 && s.src < NUM_ATILT_SRC)) &&
    (s.target === 0 || s.target === 1) && typeof s.invert === 'boolean' && Number.isInteger(s.threshold) && s.threshold >= 1 && s.threshold <= 99 &&
    [s.min, s.max].every((x) => Number.isInteger(x) && x >= 0 && x <= 4095)),
  accelSda: isPin, accelScl: isPin, rumblePin: isPin,
  rumbleFlags: (v) => Number.isInteger(v) && v >= 0 && v <= 7,
  rumbleStrength: (v) => Number.isInteger(v) && v >= 10 && v <= 100,
  accelGate: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  accelMedian: (v) => Number.isInteger(v) && v >= 0 && v <= 9,
  accelLowpass: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
}));
export const LABELS = localized(() => ({
  pins: 'button pins', whammyCh: 'whammy pin', whammyMin: 'whammy range', whammyMax: 'whammy range', whammyInvert: 'whammy direction',
  tiltPin: 'tilt pin', tiltEnabled: 'tilt switch', tiltInvert: t('backup.tilt_switch_type'), tiltFunc: t('backup.tilt_inputs_as_buttons'), btEnabled: 'Bluetooth', hostPin: t('backup.usb_host_pins'),
  debounceMode: 'debounce type', debounce100us: 'debounce time', combinedStrum: t('backup.shared_strum_lockout'), whammySmooth: 'whammy smoothing', whammyDeadzone: t('backup.whammy_dead_zone'),
  rgbEnabled: t('backup.leds_off'), rgbBootFlash: 'mode flash', rgbPin: t('backup.led_data_pin'), rgbBrightness: 'brightness', rgbEffect: 'effect', rgbSpeed: 'effect speed',
  zoneFrets: 'fret animation', zoneStrum: t('backup.strum_bar_animation'), fretPress: t('backup.fret_pressed_colours'), fret2Colors: t('backup.second_fret_led_colours'), fret2Own: t('backup.second_led_own_colour'),
  strumLedColors: t('lights.studio.strum_led_colours'), strumUpColor: t('backup.strum_up_colour'), strumDownColor: t('backup.strum_down_colour'), starColor: t('backup.star_power_colour'), starAnim: t('backup.star_power_animation'),
  starZones: t('lights.studio.star_power_zones_2'), starSpeed: t('lights.studio.star_power_speed'), whammyFx: 'whammy effect', whammyZones: 'whammy zones', starFlash: t('backup.star_power_flash'), sleepMin: t('backup.led_sleep_timer'),
  ledMap: t('common.led_order'), ledMap2: t('backup.second_fret_leds'), fretLeds: t('backup.leds_per_fret'), noFretLeds: t('backup.fret_leds_off'), strumLeds: t('backup.strum_led_count'), strumMap: t('backup.strum_led_order'), strumColor: t('backup.strum_led_colour'), strumRoles: t('backup.strum_led_roles'), colors: 'fret colours', ledType: t('common.led_type'), ledOrder: 'colour order', ledClkPin: t('backup.led_clock_pin'), rgbStarPower: t('backup.star_power_glow'),
  atilt: 'tilt sensors', rumblePin: t('backup.rumble_motor_pin'), ps2Pins: t('backup.ps2_port_pins'), wiiSda: t('backup.wii_extension_sda'), wiiScl: t('backup.wii_extension_scl'), rumbleFlags: 'rumble triggers', rumbleStrength: 'rumble strength', accelSda: t('backup.accelerometer_sda_pin'), accelScl: t('backup.accelerometer_scl_pin'), accelGate: 'gravity gate', accelMedian: 'median filter', accelLowpass: t('backup.low_pass_filter'),
  usbMode: 'default mode', bootModes: t('backup.hold_fret_modes'), xinputType: t('backup.xinput_guitar_type'), starDpadLeft: t('backup.star_power_d_pad_left'), xinputOpts: t('adv.steam_receiver_option'), keys: 'keyboard bindings',
}));
Object.assign(CHECK, {
  extPins: (v) => Array.isArray(v) && v.length === EXT_PIN_NAMES.length && v.every(isPin),
  stickCh: (v) => Array.isArray(v) && v.length === 2 && v.every((c) => c === PIN_NONE || isInt(c, 0, 2)),
  stickFlags: (v) => isInt(v, 0, 7), deadzone: (v) => isInt(v, 0, 50),
  devName: (v) => devNameValid(v),
  btSleep: (v) => v === 0 || v === 255 || isInt(v, 1, 60),
  range: (v) => Array.isArray(v) && v.length === 4 && v.every((x) => x === 0 || x === 1),
  curve: (v) => Array.isArray(v) && v.length === 3 && v.every((x) => isInt(x, -100, 100)),
  cal: (v) => Array.isArray(v) && v.length === 6 && v.every((x) => isInt(x, 0, 4095)) && v[0] < v[1] && v[1] < v[2] && v[3] < v[4] && v[4] < v[5],
  map: (v) => Array.isArray(v) && v.length === NUM_MODE_ROWS && v.every((r) => Array.isArray(r) && r.length === MAP_ROW && r.every((x, i) => (i >= NUM_SRC ? x === 255 : x === 0 || x === 255 || isInt(x, 1, 31)))),
});
Object.assign(LABELS, { extPins: t('backup.d_pad_select_home_pins'), stickCh: 'stick pins', stickFlags: 'stick direction', deadzone: t('backup.stick_dead_zone'), cal: 'stick calibration', map: 'input mapping', curve: 'response curves', range: 'stick ranges', btSleep: t('backup.bluetooth_sleep_timer'), devName: 'controller name' });
const valid = (k, v) => (CHECK[k] ? CHECK[k](v) : typeof v === 'boolean' || isByte(v));

export function makeBackup(cfg, info) {
  const settings = {};
  for (const s of SECTIONS) {
    if (s.ext && !cfg.ext) continue;   // older firmware has no extension page
    const from = s.ext ? cfg.ext : cfg;
    settings[s.id] = {};
    for (const k of s.keys) if (from[k] !== undefined) settings[s.id][k] = from[k];
  }
  return {
    app: 'YAGCC', format: BACKUP_FORMAT, created: new Date().toISOString(),
    firmware: info ? `${info.major}.${info.minor}` : null,
    board: info ? (BOARDS[info.board] ?? String(info.board)) : null,
    settings,
  };
}

export function backupFileName(info) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `yagcc-backup-${stamp}.json`;
}

// Parse and validate a backup file. Returns { meta, sections: {id: {key: value}}, skipped: [keys] }.
export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(t('backup.that_file_not_valid_json')); }
  if (!data || data.app !== 'YAGCC' || typeof data.settings !== 'object') throw new Error(t('backup.that_file_not_yagcc_backup'));
  if (data.format > BACKUP_FORMAT) throw new Error(t('backup.this_backup_was_made_by'));
  const sections = {}, skipped = [];
  for (const s of SECTIONS) {
    const src = data.settings[s.id];
    if (!src || typeof src !== 'object') continue;
    const out = {};
    for (const k of s.keys) {
      if (!(k in src)) continue;
      if (valid(k, src[k])) out[k] = src[k]; else if (!skipped.includes(LABELS[k] || k)) skipped.push(LABELS[k] || k);
    }
    if (Object.keys(out).length) sections[s.id] = out;
  }
  if (!Object.keys(sections).length) throw new Error(t('backup.backup_does_not_contain_any'));
  return { meta: { created: data.created, firmware: data.firmware, board: data.board }, sections, skipped };
}

// Apply the chosen sections onto a config. Pins that would clash with each other are dropped.
export function applyBackup(cfg, parsed, chosen) {
  const next = structuredClone(cfg);
  for (const id of chosen) {
    const sec = SECTIONS.find((x) => x.id === id);
    if (sec?.ext) { if (next.ext) Object.assign(next.ext, structuredClone(parsed.sections[id] || {})); }   // older firmware: nothing to restore into
    else Object.assign(next, structuredClone(parsed.sections[id] || {}));
  }
  const used = new Map();
  const claim = (pin, who) => { if (pin === PIN_NONE) return true; if (used.has(pin)) return false; used.set(pin, who); return true; };
  next.pins = next.pins.map((p, i) => (claim(p, 'f' + i) ? p : PIN_NONE));
  if (!claim(next.tiltPin, 'tilt')) next.tiltPin = PIN_NONE;
  if (next.rgbEnabled && !claim(next.rgbPin, 'rgb')) next.rgbPin = PIN_NONE;
  if (next.ledType === 2 && !claim(next.ledClkPin, 'clk')) next.ledClkPin = PIN_NONE;
  if (next.hostPin !== undefined && next.hostPin !== PIN_NONE && (!claim(next.hostPin, 'host') || !claim(next.hostPin + 1, 'host'))) next.hostPin = PIN_NONE;
  if (next.ext) {   // the optional pins must not clash with anything the main config uses
    next.ext.extPins = next.ext.extPins.map((p) => (claim(p, 'e') ? p : PIN_NONE));
    const bad = next.ext.stickCh.some((c, i) => c !== PIN_NONE && (c === next.whammyCh || next.ext.stickCh.indexOf(c) !== i || (next.atilt || []).some((tv) => tv.src === c)));
    if (bad) next.ext.stickCh = [PIN_NONE, PIN_NONE];
  }
  return next;
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
