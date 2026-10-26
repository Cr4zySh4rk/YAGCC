// Backup and restore of the controller's settings as a JSON file (in the spirit of GP2040-CE's
// "Data Backup and Restoration"): pick which sections to save or restore.
import { FUNCS, PIN_NONE, NUM_DIGITAL_PINS, NUM_ATILT_SRC, BOARDS, MODES, NUM_IDLE, NUM_PRESS, NUM_STAR, NUM_WFX } from './protocol.js?v=dev';

export const BACKUP_FORMAT = 1;

export const SECTIONS = [
  { id: 'wiring', name: 'Wiring', desc: 'Button pins, whammy calibration, tilt switch, Bluetooth, USB host port',
    keys: ['pins', 'whammyCh', 'whammyInvert', 'whammyMin', 'whammyMax', 'tiltPin', 'tiltEnabled', 'tiltInvert', 'tiltFunc', 'btEnabled', 'hostPin'] },
  { id: 'tilt', name: 'Tilt sensors', desc: 'Analog tilt sensors, accelerometer pins, calibration and filters',
    keys: ['atilt', 'tiltFunc', 'accelSda', 'accelScl', 'accelGate', 'accelMedian', 'accelLowpass'] },
  { id: 'ports', name: 'Console ports', desc: 'PS2 controller port and Wii extension pins',
    keys: ['ps2Pins', 'wiiSda', 'wiiScl'] },
  { id: 'rumble', name: 'Rumble', desc: 'Rumble motor pin, strength and what makes it buzz',
    keys: ['rumblePin', 'rumbleFlags', 'rumbleStrength'] },
  { id: 'tuning', name: 'Tuning', desc: 'Debounce, shared strum lockout, whammy smoothing and dead zone',
    keys: ['debounceMode', 'debounce100us', 'combinedStrum', 'whammySmooth', 'whammyDeadzone'] },
  { id: 'lights', name: 'Lights', desc: 'LED type and pins, colours, animations, strum bar, star power and whammy effects, brightness, LED order',
    keys: ['rgbEnabled', 'rgbBootFlash', 'rgbPin', 'rgbBrightness', 'rgbEffect', 'rgbSpeed', 'ledMap', 'colors', 'ledType', 'ledOrder', 'ledClkPin', 'rgbStarPower',
      'noFretLeds', 'strumLeds', 'strumMap', 'strumColor', 'strumRoles', 'fretLeds', 'ledMap2',
      'zoneFrets', 'zoneStrum', 'fretPress', 'fret2Colors', 'fret2Own', 'strumLedColors', 'strumUpColor', 'strumDownColor',
      'starColor', 'starAnim', 'starZones', 'starSpeed', 'whammyFx', 'whammyZones', 'starFlash', 'sleepMin'] },
  { id: 'modes', name: 'Modes', desc: 'Default mode, hold-a-fret modes, XInput type, keyboard bindings',
    keys: ['usbMode', 'bootModes', 'xinputType', 'starDpadLeft', 'xinputOpts', 'keys'] },
];

const isPin = (v) => v === PIN_NONE || (Number.isInteger(v) && v >= 0 && v < NUM_DIGITAL_PINS);
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isZone = (z) => !!z && typeof z === 'object' && isInt(z.idle, 0, NUM_IDLE - 1) && isInt(z.idleLevel, 0, 100) && isInt(z.press, 0, NUM_PRESS - 1) &&
  isInt(z.speed, 1, 10) && isInt(z.fade, 1, 10) && typeof z.same === 'boolean' && typeof z.perLed === 'boolean';
const CHECK = {
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
};
export const LABELS = {
  pins: 'button pins', whammyCh: 'whammy pin', whammyMin: 'whammy range', whammyMax: 'whammy range', whammyInvert: 'whammy direction',
  tiltPin: 'tilt pin', tiltEnabled: 'tilt switch', tiltInvert: 'tilt switch type', tiltFunc: 'tilt inputs as buttons', btEnabled: 'Bluetooth', hostPin: 'USB host pins',
  debounceMode: 'debounce type', debounce100us: 'debounce time', combinedStrum: 'shared strum lockout', whammySmooth: 'whammy smoothing', whammyDeadzone: 'whammy dead zone',
  rgbEnabled: 'LEDs on/off', rgbBootFlash: 'mode flash', rgbPin: 'LED data pin', rgbBrightness: 'brightness', rgbEffect: 'effect', rgbSpeed: 'effect speed',
  zoneFrets: 'fret animation', zoneStrum: 'strum bar animation', fretPress: 'fret pressed colours', fret2Colors: 'second fret LED colours', fret2Own: 'second LED own colour',
  strumLedColors: 'strum LED colours', strumUpColor: 'strum up colour', strumDownColor: 'strum down colour', starColor: 'star power colour', starAnim: 'star power animation',
  starZones: 'star power zones', starSpeed: 'star power speed', whammyFx: 'whammy effect', whammyZones: 'whammy zones', starFlash: 'star power flash', sleepMin: 'LED sleep timer',
  ledMap: 'LED order', ledMap2: 'second fret LEDs', fretLeds: 'LEDs per fret', noFretLeds: 'fret LEDs on/off', strumLeds: 'strum LED count', strumMap: 'strum LED order', strumColor: 'strum LED colour', strumRoles: 'strum LED roles', colors: 'fret colours', ledType: 'LED type', ledOrder: 'colour order', ledClkPin: 'LED clock pin', rgbStarPower: 'star power glow',
  atilt: 'tilt sensors', rumblePin: 'rumble motor pin', ps2Pins: 'PS2 port pins', wiiSda: 'Wii extension SDA', wiiScl: 'Wii extension SCL', rumbleFlags: 'rumble triggers', rumbleStrength: 'rumble strength', accelSda: 'accelerometer SDA pin', accelScl: 'accelerometer SCL pin', accelGate: 'gravity gate', accelMedian: 'median filter', accelLowpass: 'low pass filter',
  usbMode: 'default mode', bootModes: 'hold-a-fret modes', xinputType: 'XInput guitar type', starDpadLeft: 'star power on D-pad left', xinputOpts: 'Steam receiver option', keys: 'keyboard bindings',
};
const valid = (k, v) => (CHECK[k] ? CHECK[k](v) : typeof v === 'boolean' || isByte(v));

export function makeBackup(cfg, info) {
  const settings = {};
  for (const s of SECTIONS) {
    settings[s.id] = {};
    for (const k of s.keys) if (cfg[k] !== undefined) settings[s.id][k] = cfg[k];
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
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!data || data.app !== 'YAGCC' || typeof data.settings !== 'object') throw new Error('That file is not a YAGCC backup.');
  if (data.format > BACKUP_FORMAT) throw new Error('This backup was made by a newer version of YAGCC. Update the page and try again.');
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
  if (!Object.keys(sections).length) throw new Error('The backup does not contain any settings this version understands.');
  return { meta: { created: data.created, firmware: data.firmware, board: data.board }, sections, skipped };
}

// Apply the chosen sections onto a config. Pins that would clash with each other are dropped.
export function applyBackup(cfg, parsed, chosen) {
  const next = structuredClone(cfg);
  for (const id of chosen) Object.assign(next, structuredClone(parsed.sections[id] || {}));
  const used = new Map();
  const claim = (pin, who) => { if (pin === PIN_NONE) return true; if (used.has(pin)) return false; used.set(pin, who); return true; };
  next.pins = next.pins.map((p, i) => (claim(p, 'f' + i) ? p : PIN_NONE));
  if (!claim(next.tiltPin, 'tilt')) next.tiltPin = PIN_NONE;
  if (next.rgbEnabled && !claim(next.rgbPin, 'rgb')) next.rgbPin = PIN_NONE;
  if (next.ledType === 2 && !claim(next.ledClkPin, 'clk')) next.ledClkPin = PIN_NONE;
  if (next.hostPin !== undefined && next.hostPin !== PIN_NONE && (!claim(next.hostPin, 'host') || !claim(next.hostPin + 1, 'host'))) next.hostPin = PIN_NONE;
  return next;
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
