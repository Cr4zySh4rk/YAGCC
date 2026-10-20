// Backup and restore of the controller's settings as a JSON file (in the spirit of GP2040-CE's
// "Data Backup and Restoration"): pick which sections to save or restore.
import { FUNCS, PIN_NONE, NUM_DIGITAL_PINS, BOARDS, MODES } from './protocol.js?v=dev';

export const BACKUP_FORMAT = 1;

export const SECTIONS = [
  { id: 'wiring', name: 'Wiring', desc: 'Button pins, whammy calibration, tilt switch, Bluetooth, USB host port',
    keys: ['pins', 'whammyCh', 'whammyInvert', 'whammyMin', 'whammyMax', 'tiltPin', 'tiltEnabled', 'btEnabled', 'hostPin'] },
  { id: 'tilt', name: 'Tilt sensors', desc: 'Analog tilt sensors, accelerometer pins, calibration and filters',
    keys: ['atilt', 'accelSda', 'accelScl', 'accelGate', 'accelMedian', 'accelLowpass'] },
  { id: 'tuning', name: 'Tuning', desc: 'Debounce, shared strum lockout, whammy smoothing and dead zone',
    keys: ['debounceMode', 'debounce100us', 'combinedStrum', 'whammySmooth', 'whammyDeadzone'] },
  { id: 'lights', name: 'Lights', desc: 'LED type and pins, colours, effect, brightness, LED order',
    keys: ['rgbEnabled', 'rgbBootFlash', 'rgbPin', 'rgbBrightness', 'rgbEffect', 'rgbSpeed', 'ledMap', 'colors', 'ledType', 'ledOrder', 'ledClkPin', 'rgbStarPower'] },
  { id: 'modes', name: 'Modes', desc: 'Default mode, hold-a-fret modes, XInput type, keyboard bindings',
    keys: ['usbMode', 'bootModes', 'xinputType', 'starDpadLeft', 'keys'] },
];

const isPin = (v) => v === PIN_NONE || (Number.isInteger(v) && v >= 0 && v < NUM_DIGITAL_PINS);
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
const CHECK = {
  pins: (v) => Array.isArray(v) && v.length === FUNCS.length && v.every(isPin),
  whammyCh: (v) => v === PIN_NONE || (Number.isInteger(v) && v >= 0 && v < 3),
  whammyMin: (v) => Number.isInteger(v) && v >= 0 && v <= 4095,
  whammyMax: (v) => Number.isInteger(v) && v >= 0 && v <= 4095,
  tiltPin: isPin, rgbPin: isPin, ledClkPin: isPin, hostPin: isPin,
  debounce100us: (v) => Number.isInteger(v) && v >= 0 && v <= 250,
  whammySmooth: (v) => Number.isInteger(v) && v >= 0 && v <= 6,
  whammyDeadzone: (v) => Number.isInteger(v) && v >= 0 && v <= 30,
  rgbSpeed: (v) => Number.isInteger(v) && v >= 1 && v <= 10,
  usbMode: (v) => MODES.some((m) => m.id === v),
  bootModes: (v) => Array.isArray(v) && v.length === 5 && v.every((m) => m === 255 || MODES.some((x) => x.id === m)),
  ledMap: (v) => Array.isArray(v) && v.length === 5 && [...v].sort().join() === '0,1,2,3,4',
  colors: (v) => Array.isArray(v) && v.length === 5 && v.every((c) => /^#[0-9a-f]{6}$/i.test(c)),
  keys: (v) => Array.isArray(v) && v.length === 11 && v.every(isByte),
  atilt: (v) => Array.isArray(v) && v.length === 2 && v.every((s) => s && (s.src === PIN_NONE || (Number.isInteger(s.src) && s.src >= 0 && s.src < 9)) &&
    (s.target === 0 || s.target === 1) && typeof s.invert === 'boolean' && Number.isInteger(s.threshold) && s.threshold >= 1 && s.threshold <= 99 &&
    [s.min, s.max].every((x) => Number.isInteger(x) && x >= 0 && x <= 4095)),
  accelSda: isPin, accelScl: isPin,
  accelGate: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  accelMedian: (v) => Number.isInteger(v) && v >= 0 && v <= 9,
  accelLowpass: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
};
export const LABELS = {
  pins: 'button pins', whammyCh: 'whammy pin', whammyMin: 'whammy range', whammyMax: 'whammy range', whammyInvert: 'whammy direction',
  tiltPin: 'tilt pin', tiltEnabled: 'tilt switch', btEnabled: 'Bluetooth', hostPin: 'USB host pins',
  debounceMode: 'debounce type', debounce100us: 'debounce time', combinedStrum: 'shared strum lockout', whammySmooth: 'whammy smoothing', whammyDeadzone: 'whammy dead zone',
  rgbEnabled: 'LEDs on/off', rgbBootFlash: 'mode flash', rgbPin: 'LED data pin', rgbBrightness: 'brightness', rgbEffect: 'effect', rgbSpeed: 'effect speed',
  ledMap: 'LED order', colors: 'fret colours', ledType: 'LED type', ledOrder: 'colour order', ledClkPin: 'LED clock pin', rgbStarPower: 'star power glow',
  atilt: 'tilt sensors', accelSda: 'accelerometer SDA pin', accelScl: 'accelerometer SCL pin', accelGate: 'gravity gate', accelMedian: 'median filter', accelLowpass: 'low pass filter',
  usbMode: 'default mode', bootModes: 'hold-a-fret modes', xinputType: 'XInput guitar type', starDpadLeft: 'star power on D-pad left', keys: 'keyboard bindings',
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
