// YAGCC wire protocol (the on-wire magic stays 'YACC' for compatibility) - mirrors firmware/src/config.h and usb_common.h
export const VID = 0x1209;
export const PIDS = [0x0001, 0x0002, 0x0003];

export const VREQ = {
  INFO: 0x30, STATUS: 0x31, GETCFG: 0x32, SETCFG: 0x33,
  SAVE: 0x34, DEFAULTS: 0x35, REBOOT: 0x36, SETMODE: 0x37, LEDTEST: 0x38, BTLOG: 0x39, BTLOGFL: 0x3A,
};

export const FUNCS = ['green', 'red', 'yellow', 'blue', 'orange', 'strumUp', 'strumDown', 'star', 'plus'];
export const FUNC_LABEL = {
  green: 'Green', red: 'Red', yellow: 'Yellow', blue: 'Blue', orange: 'Orange',
  strumUp: 'Strum up', strumDown: 'Strum down', star: 'Star power', plus: 'Plus / Start',
};
export const NUM_FRETS = 5;
export const PIN_NONE = 0xff;
export const NUM_DIGITAL_PINS = 23;
export const MODE_NONE = 0xff;

// order = how they are listed in the UI; id = firmware MODE_* value
export const MODES = [
  { id: 0, name: 'XInput (Xbox 360)', short: 'XInput', config: true,
    desc: 'Xbox 360 guitar: Guitar Hero or Rock Band type. Plug-and-play on Windows (Clone Hero, YARG, Fortnite Festival) and on a real Xbox 360 — the console\'s security check is answered by the firmware. macOS has no XInput driver: use HID mode on a Mac.' },
  { id: 3, name: 'PS3 Rock Band', short: 'PS3 RB', config: false,
    desc: 'PS3 Rock Band guitar (12BA:0200). Rock Band on PS3, PS2 and RPCS3, and Rock Band 4 on PS4 / PS5 (legacy instruments). Also fine for Clone Hero / YARG.' },
  { id: 1, name: 'PS3 Guitar Hero', short: 'PS3 GH', config: false,
    desc: 'PS3 Guitar Hero guitar (12BA:0100). Guitar Hero on PS3 / PS2 (World Tour, GH5, Band Hero) and RPCS3 / PCSX2.' },
  { id: 2, name: 'HID Gamepad', short: 'HID', config: true,
    desc: 'Generic HID gamepad for macOS, Linux, Android and emulators. Configurable here too (the browser asks for permission once for this mode).' },
  { id: 4, name: 'Keyboard · Fortnite Festival', short: 'Keyboard', config: true,
    desc: 'Shows up as a USB keyboard with Fortnite Festival key bindings, so it works on PS4, PS5, Xbox One / Series and PC without any authentication dongle. Bindings can be changed below.' },
  { id: 6, name: 'Wii Rock Band', short: 'Wii RB', config: false,
    desc: 'Wii Rock Band guitar dongle (1BAD:0004) for Rock Band 1–3 and The Beatles: Rock Band on Wii / Wii U over USB.' },
  { id: 5, name: 'Nintendo Switch', short: 'Switch', config: false,
    desc: 'HORIPAD-compatible gamepad: works with every Switch game (Fortnite Festival, rhythm games) without pairing.' },
  { id: 7, name: 'Original Xbox', short: 'OG Xbox', config: false,
    desc: 'Original Xbox controller (XID). Needs a USB-to-Xbox-port adapter cable.' },
  { id: 8, name: 'PS4 / PS5 guitar (experimental)', short: 'PS4', config: false, host: true,
    desc: 'Rock Band 4 guitar for PS4 and PS5. The console\'s security check is passed through to a licensed PS4 controller or auth dongle plugged into the guitar\'s USB host port. Experimental: not yet tested on a console.' },
  { id: 9, name: 'Xbox One / Series guitar (experimental)', short: 'Xbox One', config: false, host: true,
    desc: 'Rock Band 4 guitar for Xbox One and Xbox Series. The console\'s security check is passed through to a licensed Xbox One / Series controller plugged into the guitar\'s USB host port. Experimental: not yet tested on a console.' },
];
export const modeName = (id) => (MODES.find((m) => m.id === id) || { name: 'Unknown' }).name;

export const BOARDS = {
  0: 'Raspberry Pi Pico', 1: 'Raspberry Pi Pico W', 2: 'Raspberry Pi Pico 2',
  3: 'Raspberry Pi Pico 2 W', 4: 'Pico-compatible clone', 5: 'Waveshare RP2040-Zero', 6: 'Waveshare RP2040-One',
  7: 'SparkFun Pro Micro RP2040', 8: 'Adafruit KB2040', 255: 'Unknown board',
};

export const DEBOUNCE_MODES = [
  { id: 0, name: 'Hold release', desc: 'Presses register instantly; a release is held for the debounce time. Lowest latency.' },
  { id: 1, name: 'Delay press', desc: 'A press registers only after being held for the debounce time; releases are instant.' },
  { id: 2, name: 'Classic', desc: 'Any change must be stable for the debounce time (adds latency both ways).' },
];

export const NUM_LEDS = 5;
export const LED_TYPES = [
  { id: 0, name: 'WS2812B / NeoPixel', desc: 'One data wire. Also WS2813, SK6812 (RGB) and most addressable strips.' },
  { id: 1, name: 'SK6812 RGBW', desc: 'One data wire, with a separate white LED in each pixel.' },
  { id: 2, name: 'APA102 / DotStar', desc: 'Data and clock wires — no timing issues, any length of wire.' },
];
export const LED_ORDERS = ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR'];

// keyboard mode: slots in firmware order, and the HID usage codes a user can pick
export const KEY_SLOTS = ['Green', 'Red', 'Yellow', 'Blue', 'Orange', 'Strum up', 'Strum down', 'Star power', 'Plus', 'Tilt', 'Whammy (past half way)'];
export const KEYS = (() => {
  const k = { 0: 'None' };
  for (let i = 0; i < 26; i++) k[0x04 + i] = String.fromCharCode(65 + i);
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((d, i) => { k[0x1e + i] = d; });
  Object.assign(k, { 0x28: 'Enter', 0x29: 'Escape', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=',
    0x2f: '[', 0x30: ']', 0x33: ';', 0x34: "'", 0x36: ',', 0x37: '.', 0x38: '/',
    0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'Page Down',
    0x4f: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up',
    0xe0: 'Left Ctrl', 0xe1: 'Left Shift', 0xe2: 'Left Alt', 0xe4: 'Right Ctrl', 0xe5: 'Right Shift', 0xe6: 'Right Alt' });
  for (let i = 0; i < 12; i++) k[0x3a + i] = 'F' + (i + 1);
  return k;
})();
export const KEY_PRESETS = [
  { name: 'Fortnite Festival · Pro guitar', keys: [0x1e, 0x1f, 0x20, 0x21, 0x22, 0xe5, 0xe4, 0x4e, 0x29, 0x4e, 0x38],
    desc: 'Frets 1–5, strum on Right Shift / Right Ctrl, overdrive (star power and tilt) on Page Down, whammy on /.' },
  { name: 'Fortnite Festival · Lead', keys: [0x07, 0x09, 0x0d, 0x0e, 0x0f, 0x52, 0x51, 0x2c, 0x29, 0x2c, 0x00],
    desc: 'Frets on D F J K L, overdrive on Space. Strum moves through menus.' },
];
export const FRET_DEFAULT_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#fb923c'];
export const EFFECTS = [
  { id: 0, name: 'Static', desc: 'Always full colour. Does not react.' },
  { id: 1, name: 'Dim on press', desc: 'Full colour at rest, dims while the fret is held.' },
  { id: 2, name: 'Off on press', desc: 'Full colour at rest, goes dark while the fret is held.' },
  { id: 3, name: 'Brighten on press', desc: 'Soft glow at rest, lights up fully while held.' },
  { id: 4, name: 'Flash & fade', desc: 'Flashes on press, then fades back to a soft glow. Speed sets the fade time.' },
  { id: 5, name: 'Breathing', desc: 'Idle LEDs breathe slowly, a press snaps to full. Speed sets the pace.' },
  { id: 6, name: 'Rainbow', desc: 'Idle LEDs cycle through colours; a press shows the fret colour.' },
];
export const RGB_PRESETS = [
  { name: 'Guitar Hero', colors: FRET_DEFAULT_COLORS },
  { name: 'Neon', colors: ['#00ffa3', '#ff2e63', '#fff200', '#00b4ff', '#ff7a00'] },
  { name: 'Ice', colors: ['#a5f3fc', '#67e8f9', '#38bdf8', '#818cf8', '#c4b5fd'] },
  { name: 'Fire', colors: ['#fde047', '#fbbf24', '#fb923c', '#ef4444', '#b91c1c'] },
  { name: 'Mono white', colors: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'] },
];

const hex2 = (n) => n.toString(16).padStart(2, '0');
export const rgbToHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

export function defaultConfig() {
  return {
    pins: Array(FUNCS.length).fill(PIN_NONE),
    whammyCh: PIN_NONE, whammyInvert: false, whammyMin: 0, whammyMax: 4095,
    tiltPin: PIN_NONE,
    btEnabled: false, tiltEnabled: false, combinedStrum: true,
    usbMode: 0, debounceMode: 0, debounce100us: 50,
    whammySmooth: 2, whammyDeadzone: 3,
    bootModes: [0, 3, 2, 1, 5],
    cfgRev: 4, hostPin: PIN_NONE,
    xinputType: 0, starDpadLeft: false, rgbStarPower: true,
    ledType: 0, ledOrder: 0, ledClkPin: PIN_NONE, keys: [0x1e, 0x1f, 0x20, 0x21, 0x22, 0xe5, 0xe4, 0x4e, 0x29, 0x4e, 0x38],
    rgbEnabled: false, rgbBootFlash: true, rgbPin: PIN_NONE, rgbBrightness: 40, rgbEffect: 3, rgbSpeed: 5,
    ledMap: [0, 1, 2, 3, 4], colors: FRET_DEFAULT_COLORS.slice(),
  };
}

export const CFG_SIZE = 96;
export const CFG_VERSION = 4;

export function parseConfig(dv) {
  if (dv.getUint32(0, true) !== 0x43434159) throw new Error('Bad config magic');
  const flags = dv.getUint8(21);
  const pins = [];
  for (let i = 0; i < FUNCS.length; i++) pins.push(dv.getUint8(5 + i));
  const bootModes = [];
  for (let i = 0; i < NUM_FRETS; i++) bootModes.push(dv.getUint8(28 + i));
  return {
    pins,
    whammyCh: dv.getUint8(14), whammyInvert: !!dv.getUint8(15),
    whammyMin: dv.getUint16(16, true), whammyMax: dv.getUint16(18, true),
    tiltPin: dv.getUint8(20),
    btEnabled: !!(flags & 1), tiltEnabled: !!(flags & 2), combinedStrum: !!(flags & 4),
    usbMode: dv.getUint8(22), debounceMode: dv.getUint8(23), debounce100us: dv.getUint16(24, true),
    whammySmooth: dv.getUint8(26), whammyDeadzone: dv.getUint8(27),
    bootModes,
    cfgRev: dv.getUint8(57),
    rgbEnabled: !!(flags & 8), rgbBootFlash: !!(flags & 16), starDpadLeft: !!(flags & 32), rgbStarPower: !!(flags & 64),
    xinputType: dv.getUint8(58), ledType: dv.getUint8(59), ledOrder: dv.getUint8(60), ledClkPin: dv.getUint8(61),
    keys: Array.from({ length: 11 }, (_, i) => dv.getUint8(62 + i)),
    hostPin: dv.getUint8(57) >= 4 ? dv.getUint8(73) : PIN_NONE,
    rgbPin: dv.getUint8(33), rgbBrightness: dv.getUint8(34), rgbEffect: dv.getUint8(35), rgbSpeed: dv.getUint8(36),
    ledMap: [0, 1, 2, 3, 4].map((i) => dv.getUint8(37 + i)),
    colors: [0, 1, 2, 3, 4].map((i) => rgbToHex(dv.getUint8(42 + i * 3), dv.getUint8(43 + i * 3), dv.getUint8(44 + i * 3))),
  };
}

export function serializeConfig(c) {
  const buf = new ArrayBuffer(CFG_SIZE);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x43434159, true);
  dv.setUint8(4, CFG_VERSION);
  c.pins.forEach((p, i) => dv.setUint8(5 + i, p));
  dv.setUint8(14, c.whammyCh);
  dv.setUint8(15, c.whammyInvert ? 1 : 0);
  dv.setUint16(16, c.whammyMin, true);
  dv.setUint16(18, c.whammyMax, true);
  dv.setUint8(20, c.tiltPin);
  dv.setUint8(21, (c.btEnabled ? 1 : 0) | (c.tiltEnabled ? 2 : 0) | (c.combinedStrum ? 4 : 0) | (c.rgbEnabled ? 8 : 0) | (c.rgbBootFlash ? 16 : 0) | (c.starDpadLeft ? 32 : 0) | (c.rgbStarPower ? 64 : 0));
  dv.setUint8(22, c.usbMode);
  dv.setUint8(23, c.debounceMode);
  dv.setUint16(24, c.debounce100us, true);
  dv.setUint8(26, c.whammySmooth);
  dv.setUint8(27, c.whammyDeadzone);
  c.bootModes.forEach((m, i) => dv.setUint8(28 + i, m));
  dv.setUint8(33, c.rgbPin);
  dv.setUint8(34, Math.max(0, Math.min(255, c.rgbBrightness)));
  dv.setUint8(35, c.rgbEffect);
  dv.setUint8(36, Math.max(1, Math.min(10, c.rgbSpeed)));
  c.ledMap.forEach((m, i) => dv.setUint8(37 + i, m));
  c.colors.forEach((col, i) => { const [r, g, b] = hexToRgb(col); dv.setUint8(42 + i * 3, r); dv.setUint8(43 + i * 3, g); dv.setUint8(44 + i * 3, b); });
  dv.setUint8(57, Math.max(4, c.cfgRev ?? 4));
  dv.setUint8(58, c.xinputType ?? 0);
  dv.setUint8(59, c.ledType ?? 0);
  dv.setUint8(60, c.ledOrder ?? 0);
  dv.setUint8(61, c.ledClkPin ?? PIN_NONE);
  (c.keys || []).forEach((k, i) => dv.setUint8(62 + i, k));
  dv.setUint8(73, c.hostPin ?? PIN_NONE);
  dv.setUint32(92, crc32(new Uint8Array(buf, 0, 92)), true);
  return buf;
}

// Bluetooth event log (firmware 0.14+): 8 byte records, oldest first
const BT_EVENTS = {
  1: (a, b) => `radio on${a & 1 ? ', pairing requested' : ''}${a & 2 ? ', after a mode change' : ''} (mode ${b})`,
  2: () => 'Bluetooth ready',
  3: (a) => `advertising${a ? ' (discoverable)' : ' (paired hosts only)'}`,
  4: (a, b) => (a === 0 ? `host connected (address type ${b})` : `connection failed, status 0x${a.toString(16)}`),
  5: (a, b) => (b === 0 && a ? 'link encrypted' : `encryption ${a ? 'on' : 'failed'}, status 0x${b.toString(16)}`),
  6: (a) => `disconnected, reason 0x${a.toString(16)}`,
  7: (a) => `pairing request ${a ? 'accepted' : 'declined (not in pairing mode)'}`,
  8: (a, b) => (a === 0 ? 'paired' : `pairing failed, status 0x${a.toString(16)}, reason 0x${b.toString(16)}`),
  9: (a) => (a ? 'host subscribed to input' : 'host unsubscribed'),
  10: (a) => (a ? 'USB host present: Bluetooth paused' : 'no USB host: Bluetooth resumed'),
  11: (a, b) => `pairing window open for ${b} s${a ? ', all hosts forgotten' : ''}`,
  12: (a) => (a === 0 ? 'reconnected with stored key' : `stored key rejected, status 0x${a.toString(16)}`),
  13: (a) => `connection parameters ${a === 0 ? 'accepted' : 'rejected'} by host`,
};
// Test firmware: log kept in flash, 16 byte records, grouped by power-on
export function parseBtLogFlash(dv) {
  const recs = [];
  for (let o = 0; o + 16 <= dv.byteLength; o += 16) {
    const seq = dv.getUint32(o, true);
    if (seq === 0xffffffff || seq === 0) continue;
    recs.push({ seq, t: dv.getUint32(o + 4, true), boot: dv.getUint16(o + 8, true), code: dv.getUint8(o + 10), a: dv.getUint8(o + 11), b: dv.getUint16(o + 12, true) });
  }
  recs.sort((x, y) => x.seq - y.seq);
  const out = []; let boot = -1;
  for (const r of recs) {
    if (r.boot !== boot) { boot = r.boot; out.push(`--- power-on #${boot} ---`); }
    const f = BT_EVENTS[r.code];
    out.push(`${(r.t / 1000).toFixed(2).padStart(8)} s  ${f ? f(r.a, r.b) : `event ${r.code} ${r.a} ${r.b}`}`);
  }
  return out;
}

export function parseBtLog(dv) {
  const out = [];
  for (let o = 0; o + 8 <= dv.byteLength; o += 8) {
    const t = dv.getUint32(o, true), code = dv.getUint8(o + 4), a = dv.getUint8(o + 5), b = dv.getUint16(o + 6, true);
    const f = BT_EVENTS[code];
    out.push(`${(t / 1000).toFixed(2).padStart(8)} s  ${f ? f(a, b) : `event ${code} ${a} ${b}`}`);
  }
  return out;
}

export function parseInfo(dv) {
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'YACC') throw new Error('Not a YAGCC device');
  return {
    major: dv.getUint8(4), minor: dv.getUint8(5), board: dv.getUint8(6),
    btSupported: !!(dv.getUint8(7) & 1), rgbSupported: !!(dv.getUint8(7) & 2),
    digitalPins: dv.getUint8(8), adcChannels: dv.getUint8(9), funcs: dv.getUint8(10),
    mode: dv.byteLength > 11 ? dv.getUint8(11) : 0,
    setupSession: dv.byteLength > 12 ? !!(dv.getUint8(12) & 1) : false,   // firmware 0.6+: one-off setup boot
  };
}

export function parseStatus(dv) {
  const mask = dv.getUint32(0, true);
  const adc = [dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint16(8, true)];
  const counts = [];
  for (let i = 0; i < NUM_DIGITAL_PINS; i++) counts.push(dv.getUint8(10 + i));
  const flags = dv.getUint8(10 + NUM_DIGITAL_PINS);
  return { t: performance.now(), mask, adc, counts, btState: flags & 3, saveOk: !!(flags & 4), savePending: !!(flags & 8) };
}

// Same maths as firmware input_whammy(): returns 0..1
export function whammyValue(raw, cfg) {
  const range = cfg.whammyMax - cfg.whammyMin;
  if (range < 8) return 0;
  let v = Math.min(Math.max(raw - cfg.whammyMin, 0), range) / range;
  if (cfg.whammyInvert) v = 1 - v;
  return v < cfg.whammyDeadzone / 100 ? 0 : v;
}

export const isPressed = (status, pin) => pin !== PIN_NONE && pin < NUM_DIGITAL_PINS && !((status.mask >>> pin) & 1);
