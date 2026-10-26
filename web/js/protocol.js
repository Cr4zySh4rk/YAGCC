// YAGCC wire protocol (the on-wire magic stays 'YACC' for compatibility) - mirrors firmware/src/config.h and usb_common.h
export const VID = 0x1209;
export const PIDS = [0x0001, 0x0002, 0x0003, 0x0004];   // 4 = Auto mode before the host is known

export const VREQ = {
  INFO: 0x30, STATUS: 0x31, GETCFG: 0x32, SETCFG: 0x33,
  SAVE: 0x34, DEFAULTS: 0x35, REBOOT: 0x36, SETMODE: 0x37, LEDTEST: 0x38, BTLOG: 0x39, BTLOGFL: 0x3A, RUMBLE: 0x3B, LEDPREVIEW: 0x3C,
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
  { id: 10, name: 'Auto (detect the console)', short: 'Auto', config: true, min: 30,
    desc: 'Works out what it is plugged into and becomes the right controller: XInput on Windows and Xbox 360, PS3 guitar on PS3 and PS2, the PS3 Rock Band guitar Rock Band 4 takes on PS4 / PS5 (or PS4 mode with an auth controller on the host port), Switch, Wii Rock Band, original Xbox, Xbox One (keyboard for Fortnite Festival without an auth controller), and the HID gamepad on macOS, Linux and Android. Same detection as Santroller. Firmware 0.30+.' },
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
  { id: 11, name: 'PS5 guitar (experimental)', short: 'PS5', config: false, host: true, min: 30,
    desc: 'Rock Band 4 guitar for PS5 games. The console\'s security check and the signing of every input report are done by a Besavior P5General dongle plugged into the guitar\'s USB host port (as Santroller does). For Rock Band 4 alone, PS3 Rock Band mode works on a PS5 with nothing extra. Experimental: not yet tested on a console.' },
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

export const NUM_LEDS = 5;            // frets with LEDs (one or two LEDs each)
export const MAX_STRUM_LEDS = 8;      // strum bar LEDs
export const MAX_LEDS = 2 * NUM_LEDS + MAX_STRUM_LEDS;
export const STRUM_ROLES = [
  { id: 0, name: 'Up and down' },
  { id: 1, name: 'Strum up' },
  { id: 2, name: 'Strum down' },
];
// LED layout helpers. Fret LEDs keep their order relative to each other; strum LEDs go before or after them.
export function ledLayout(c) {
  const frets = !c.noFretLeds, n = c.strumLeds || 0, per = c.fretLeds === 2 ? 2 : 1;
  const fretOrder = [0, 1, 2, 3, 4].sort((a, b) => c.ledMap[a] - c.ledMap[b]);
  const fretPos = per === 2 ? [...c.ledMap, ...(c.ledMap2 || [])] : c.ledMap;
  const firstFret = frets ? Math.min(...fretPos) : 99, firstStrum = n ? Math.min(...c.strumMap.slice(0, n)) : 99;
  return { frets, per, strum: n, strumFirst: firstStrum < firstFret, fretOrder, chain: (frets ? NUM_LEDS * per : 0) + n };
}
// brightness ceiling for the layout, same as the firmware's led_max_brightness
export function maxBrightness(c) {
  const two = c.fretLeds === 2 && !c.noFretLeds;
  if (!c.strumLeds) return two ? 160 : 255;
  if (c.noFretLeds) return 200;
  return two ? 110 : 150;
}
// per: LEDs under each fret. With two, the default order is each fret's pair side by side (G G R R ...); the LED
// order step teaches any other wiring (two rows, a snake ...)
export function applyLedLayout(c, { frets, strum, strumFirst, per = c.fretLeds === 2 ? 2 : 1 }) {
  const fretOrder = [0, 1, 2, 3, 4].sort((a, b) => c.ledMap[a] - c.ledMap[b]);
  const strumOrder = [...Array(MAX_STRUM_LEDS).keys()].sort((a, b) => c.strumMap[a] - c.strumMap[b]);
  c.noFretLeds = !frets;
  c.strumLeds = strum;
  c.fretLeds = per;
  const fBase = frets && strumFirst ? strum : 0, sBase = frets && !strumFirst ? NUM_LEDS * per : 0;
  fretOrder.forEach((f, k) => { c.ledMap[f] = frets ? fBase + k * per : k; });
  c.ledMap2 = [0, 1, 2, 3, 4].map((f) => (per === 2 && frets ? c.ledMap[f] + 1 : NUM_LEDS + f));
  // unused strum slots are parked past the chain (the firmware ignores slots beyond strumLeds) so they keep sorting last
  strumOrder.forEach((s, k) => { c.strumMap[s] = k < strum ? sBase + k : 200 + k; });
  c.rgbBrightness = Math.min(c.rgbBrightness, maxBrightness(c));
}
export const LED_TYPES = [
  { id: 0, name: 'WS2812B / NeoPixel', desc: 'One data wire. Also WS2813, SK6812 (RGB) and most addressable strips.' },
  { id: 1, name: 'SK6812 RGBW', desc: 'One data wire, with a separate white LED in each pixel.' },
  { id: 2, name: 'APA102 / SK9822', desc: 'APA102, SK9822 or DotStar. Data and clock wires: no timing issues on long wires, and smoother dimming. Needs a second pin for the clock.' },
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

// ---------------------------------------------------------------- LED engine v2 (config version 7, firmware 0.34+)
// Enum values match firmware/src/config.h (see led_v2_spec.md). `speed` / `fade` say which sliders a type uses.
export const IDLE = { OFF: 0, SOLID: 1, BREATHE: 2, HEARTBEAT: 3, RAINBOW: 4, RAINBOW_WAVE: 5, COLOR_WAVE: 6, SPARKLE: 7, CHASE: 8, FIRE: 9, HUE_DRIFT: 10 };
export const PRESS = { NONE: 0, COLOR: 1, FLASH_FADE: 2, DIM: 3, OFF: 4, STROBE: 5, RIPPLE: 6, RAINBOW: 7, SPARK: 8, SWEEP: 9 };
export const STAR = { PULSE: 0, SOLID: 1, RAINBOW: 2, STROBE: 3, CHASE: 4, FIRE: 5, SPARKLE: 6 };
export const WFX = { NONE: 0, BRIGHT: 1, PULSE: 2, HUE: 3, WAVE: 4 };
export const ZF_SAME = 1, ZF_PER_LED = 2;
export const LEDF_FRET2_OWN = 1, LEDF_STAR_FLASH = 2;
export const IDLE_ANIMS = [
  { id: 0, name: 'Off', desc: 'Dark until something happens.' },
  { id: 1, name: 'Solid', desc: 'A steady glow in the LED colour.' },
  { id: 2, name: 'Breathe', desc: 'Slowly swells and fades, each LED a little out of step.', speed: true },
  { id: 3, name: 'Heartbeat', desc: 'Two soft thumps, then a rest, like a pulse.', speed: true },
  { id: 4, name: 'Rainbow', desc: 'Every LED cycles through all the colours (ignores the LED colour).', speed: true, ownColor: true },
  { id: 5, name: 'Rainbow wave', desc: 'A rainbow that rolls along the row (ignores the LED colour).', speed: true, ownColor: true },
  { id: 6, name: 'Colour wave', desc: 'A wave of brightness rolls along the row in the LED colours.', speed: true },
  { id: 7, name: 'Sparkle', desc: 'A dim glow with random white twinkles. Speed sets how often.', speed: true },
  { id: 8, name: 'Chase', desc: 'A bright spot runs around the row with a soft tail.', speed: true },
  { id: 9, name: 'Fire', desc: 'Flickers like embers, every LED on its own.' },
  { id: 10, name: 'Hue drift', desc: 'The LED colours slowly slide round the colour wheel.', speed: true },
];
export const PRESS_FX = [
  { id: 0, name: 'No reaction', desc: 'Pressing changes nothing.' },
  { id: 1, name: 'Light up', desc: 'Full brightness while held, back to idle on release.' },
  { id: 2, name: 'Flash & fade', desc: 'Flashes on press, then fades back. Speed sets how quickly.', fade: true },
  { id: 3, name: 'Dim', desc: 'Dims while held.' },
  { id: 4, name: 'Go dark', desc: 'Goes dark while held.' },
  { id: 5, name: 'Strobe', desc: 'Flickers on and off while held. Speed sets how fast.', speed: true },
  { id: 6, name: 'Ripple', desc: 'A wave spreads out to the neighbouring LEDs.', fade: true },
  { id: 7, name: 'Random colour', desc: 'Each press lights a different random colour, then fades.', fade: true },
  { id: 8, name: 'White spark', desc: 'A quick white flash, then the pressed colour, fading on release.', fade: true },
  { id: 9, name: 'Sweep', desc: 'A comet shoots across the row. On the strum bar it follows the strum direction.', fade: true },
];
export const STAR_ANIMS = [
  { id: 0, name: 'Pulse', desc: 'A steady pulse in the star power colour (the classic look).', speed: true },
  { id: 1, name: 'Solid', desc: 'Held at full brightness in the star power colour.' },
  { id: 2, name: 'Rainbow', desc: 'A fast rainbow wave rolls along the LEDs.', ownColor: true },
  { id: 3, name: 'Strobe', desc: 'Quick on / off flashes.', speed: true },
  { id: 4, name: 'Chase', desc: 'A bright spot runs along the LEDs.' },
  { id: 5, name: 'Fire', desc: 'Flickering flames in the star power colour.' },
  { id: 6, name: 'Sparkle', desc: 'A soft glow with white twinkles.' },
];
export const WHAMMY_FX = [
  { id: 0, name: 'Nothing', desc: 'The whammy bar does not change the lights.' },
  { id: 1, name: 'Brightness', desc: 'The harder you push the whammy bar, the brighter the LEDs (dimmer at rest).' },
  { id: 2, name: 'Flutter', desc: 'LEDs shimmer faster the harder you push.' },
  { id: 3, name: 'Colour shift', desc: 'Colours slide round the colour wheel as you push.' },
  { id: 4, name: 'Wave', desc: 'A ripple of dimming runs along the LEDs as you push.' },
];
export const NUM_IDLE = IDLE_ANIMS.length, NUM_PRESS = PRESS_FX.length, NUM_STAR = STAR_ANIMS.length, NUM_WFX = WHAMMY_FX.length;

// old rgb_effect -> zone (both zones get it; speed = fade = rgb_speed)
export const LEGACY_ZONES = [
  { idle: IDLE.SOLID, idleLevel: 100, press: PRESS.NONE },        // STATIC
  { idle: IDLE.SOLID, idleLevel: 100, press: PRESS.DIM },         // DIM
  { idle: IDLE.SOLID, idleLevel: 100, press: PRESS.OFF },         // OFF
  { idle: IDLE.SOLID, idleLevel: 25, press: PRESS.COLOR },        // BRIGHT
  { idle: IDLE.SOLID, idleLevel: 11, press: PRESS.FLASH_FADE },   // FADE
  { idle: IDLE.BREATHE, idleLevel: 100, press: PRESS.COLOR },     // BREATHE
  { idle: IDLE.RAINBOW, idleLevel: 60, press: PRESS.COLOR },      // RAINBOW
];
export const effectZone = (efx, speed = 5) => {
  const r = LEGACY_ZONES[efx] || LEGACY_ZONES[3], s = Math.max(1, Math.min(10, speed | 0 || 5));
  return { ...r, speed: s, fade: s, same: true, perLed: false };
};
// the legacy row a fret zone matches exactly, or -1
export const zoneEffect = (z) => LEGACY_ZONES.findIndex((r) => r.idle === z.idle && r.idleLevel === z.idleLevel && r.press === z.press) >= 0 && z.same && !z.perLed
  ? LEGACY_ZONES.findIndex((r) => r.idle === z.idle && r.idleLevel === z.idleLevel && r.press === z.press) : -1;

export function defaultLedV2(colors, efx, speed) {
  const z = effectZone(efx, speed);
  return {
    zoneFrets: { ...z }, zoneStrum: { ...z },
    fretPress: colors.slice(), fret2Colors: colors.slice(), fret2Own: false,
    strumLedColors: Array(MAX_STRUM_LEDS).fill('#ffffff'), strumUpColor: '#00c8ff', strumDownColor: '#ff3cc8',
    starColor: '#40e0ff', starAnim: STAR.PULSE, starZones: 3, starSpeed: 5, whammyFx: WFX.NONE, whammyZones: 3, starFlash: false, sleepMin: 0,
  };
}
const clampInt = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
function parseZone(dv, o) {
  const f = dv.getUint8(o + 5);
  return {
    idle: Math.min(dv.getUint8(o), NUM_IDLE - 1), idleLevel: Math.min(100, dv.getUint8(o + 1)), press: Math.min(dv.getUint8(o + 2), NUM_PRESS - 1),
    speed: clampInt(dv.getUint8(o + 3), 1, 10, 5), fade: clampInt(dv.getUint8(o + 4), 1, 10, 5), same: !!(f & ZF_SAME), perLed: !!(f & ZF_PER_LED),
  };
}
const rd3 = (dv, o) => rgbToHex(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2));
function parseLedV2(dv) {
  const flags = dv.getUint8(239);
  return {
    zoneFrets: parseZone(dv, 156), zoneStrum: parseZone(dv, 164),
    fretPress: [0, 1, 2, 3, 4].map((i) => rd3(dv, 172 + i * 3)), fret2Colors: [0, 1, 2, 3, 4].map((i) => rd3(dv, 187 + i * 3)),
    strumLedColors: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rd3(dv, 202 + i * 3)),
    strumUpColor: rd3(dv, 226), strumDownColor: rd3(dv, 229), starColor: rd3(dv, 232),
    starAnim: Math.min(dv.getUint8(235), NUM_STAR - 1), starZones: dv.getUint8(236) & 3, whammyFx: Math.min(dv.getUint8(237), NUM_WFX - 1), whammyZones: dv.getUint8(238) & 3,
    fret2Own: !!(flags & LEDF_FRET2_OWN), starFlash: !!(flags & LEDF_STAR_FLASH),
    sleepMin: Math.min(30, dv.getUint8(240)), starSpeed: clampInt(dv.getUint8(241), 1, 10, 5),
  };
}
function writeZone(dv, o, z) {
  const d = effectZone(3, 5);
  dv.setUint8(o, clampInt(z.idle, 0, NUM_IDLE - 1, d.idle)); dv.setUint8(o + 1, clampInt(z.idleLevel, 0, 100, d.idleLevel)); dv.setUint8(o + 2, clampInt(z.press, 0, NUM_PRESS - 1, d.press));
  dv.setUint8(o + 3, clampInt(z.speed, 1, 10, 5)); dv.setUint8(o + 4, clampInt(z.fade, 1, 10, 5)); dv.setUint8(o + 5, (z.same ? ZF_SAME : 0) | (z.perLed ? ZF_PER_LED : 0));
}
const wr3 = (dv, o, hex) => { const [r, g, b] = hexToRgb(hex || '#000000'); dv.setUint8(o, r); dv.setUint8(o + 1, g); dv.setUint8(o + 2, b); };
function serializeLedV2(dv, c) {
  const d = defaultLedV2(c.colors, c.rgbEffect, c.rgbSpeed);
  writeZone(dv, 156, c.zoneFrets || d.zoneFrets); writeZone(dv, 164, c.zoneStrum || d.zoneStrum);
  (c.fretPress || d.fretPress).forEach((h, i) => wr3(dv, 172 + i * 3, h));
  (c.fret2Colors || d.fret2Colors).forEach((h, i) => wr3(dv, 187 + i * 3, h));
  (c.strumLedColors || d.strumLedColors).slice(0, 8).forEach((h, i) => wr3(dv, 202 + i * 3, h));
  wr3(dv, 226, c.strumUpColor ?? d.strumUpColor); wr3(dv, 229, c.strumDownColor ?? d.strumDownColor); wr3(dv, 232, c.starColor ?? d.starColor);
  dv.setUint8(235, clampInt(c.starAnim, 0, NUM_STAR - 1, 0)); dv.setUint8(236, (c.starZones ?? 3) & 3);
  dv.setUint8(237, clampInt(c.whammyFx, 0, NUM_WFX - 1, 0)); dv.setUint8(238, (c.whammyZones ?? 3) & 3);
  dv.setUint8(239, (c.fret2Own ? LEDF_FRET2_OWN : 0) | (c.starFlash ? LEDF_STAR_FLASH : 0));
  dv.setUint8(240, clampInt(c.sleepMin, 0, 30, 0)); dv.setUint8(241, clampInt(c.starSpeed, 1, 10, 5));
}

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
    tiltPin: PIN_NONE, tiltInvert: false,
    btEnabled: false, btDebugLog: false, tiltEnabled: false, combinedStrum: true,
    usbMode: 0, debounceMode: 0, debounce100us: 50,
    whammySmooth: 2, whammyDeadzone: 3,
    bootModes: [0, 3, 2, 1, 5],
    cfgRev: 4, hostPin: PIN_NONE,
    xinputType: 0, starDpadLeft: false, rgbStarPower: true,
    ledType: 0, ledOrder: 0, ledClkPin: PIN_NONE, keys: [0x1e, 0x1f, 0x20, 0x21, 0x22, 0xe5, 0xe4, 0x4e, 0x29, 0x4e, 0x38],
    rgbEnabled: false, rgbBootFlash: true, rgbPin: PIN_NONE, rgbBrightness: 40, rgbEffect: 3, rgbSpeed: 5,
    ledMap: [0, 1, 2, 3, 4], colors: FRET_DEFAULT_COLORS.slice(),
    noFretLeds: false, strumLeds: 0, strumMap: [200, 201, 202, 203, 204, 205, 206, 207], strumColor: '#ffffff', strumRoles: [0, 0, 0, 0, 0, 0, 0, 0],
    cfgVersion: CFG_VERSION, ...defaultTiltSensors(),
    ...defaultLedV2(FRET_DEFAULT_COLORS, 3, 5),
  };
}

// Analog tilt sensors and the I2C accelerometer (firmware 0.29+, config version 5)
export const NUM_ATILT = 2;
export const ATILT_TARGET = { WHAMMY: 0, STAR: 1 };
// sensor sources: 0..2 analog inputs GP26..28, 3..5 accelerometer axes, 6..8 a LIS3DH's aux ADC inputs
export const ATILT_SOURCES = [
  { id: 0, name: 'GP26 (analog)', kind: 'adc' }, { id: 1, name: 'GP27 (analog)', kind: 'adc' }, { id: 2, name: 'GP28 (analog)', kind: 'adc' },
  { id: 3, name: 'Accelerometer X', kind: 'accel' }, { id: 4, name: 'Accelerometer Y', kind: 'accel' }, { id: 5, name: 'Accelerometer Z', kind: 'accel' },
  { id: 6, name: 'LIS3DH ADC 1', kind: 'lis' }, { id: 7, name: 'LIS3DH ADC 2', kind: 'lis' }, { id: 8, name: 'LIS3DH ADC 3', kind: 'lis' },
  // 9..11: a second accelerometer on the same bus at another address (firmware 0.36+)
  { id: 9, name: 'Accelerometer 2 X', kind: 'accel2' }, { id: 10, name: 'Accelerometer 2 Y', kind: 'accel2' }, { id: 11, name: 'Accelerometer 2 Z', kind: 'accel2' },
];
export const NUM_ATILT_SRC = 12;
export const ACCEL2_MIN_MINOR = 36;
export const ACCEL_TYPES = ['none found', 'LIS3DH', 'ADXL345', 'MPU-6050', 'SC7A20', 'LIS3DSH'];
export function defaultTiltSensors() {
  return {
    atilt: [0, 1].map((i) => ({ src: PIN_NONE, target: i ? 1 : 0, invert: false, threshold: 50, min: 0, max: 4095 })),
    accelSda: PIN_NONE, accelScl: PIN_NONE, accelGate: 0, accelMedian: 3, accelLowpass: 20, xinputOpts: 0,
    rumblePin: PIN_NONE, rumbleFlags: 3, rumbleStrength: 80,
    ps2Pins: [PIN_NONE, PIN_NONE, PIN_NONE, PIN_NONE, PIN_NONE], wiiSda: PIN_NONE, wiiScl: PIN_NONE,
    fretLeds: 1, ledMap2: [5, 6, 7, 8, 9],
  };
}
// I2C pins: SDA on an even GPIO, SCL on the odd one of the same I2C block (GP4/GP5, GP2/GP3, ...)
export const i2cPinsOk = (sda, scl) => sda < NUM_DIGITAL_PINS && scl < NUM_DIGITAL_PINS && !(sda & 1) && (scl & 1) && ((sda >> 1) & 1) === ((scl >> 1) & 1);
// 12-bit reading of a source from a status poll, or null
export function tiltSourceRaw(status, src) {
  if (!status || src === PIN_NONE) return null;
  if (src < 3) return status.adc[src];
  const v = src >= 9 ? status.accel2Raw?.[src - 9] : status.accelRaw?.[src - 3];
  return v === undefined || v === 0xffff ? null : v;
}
// Same maths as firmware input_atilt(): 0 (rest) .. 1 (tilted), or null when not reading
export function tiltValue(raw, s) {
  if (raw == null || s.src === PIN_NONE) return null;
  const range = s.max - s.min;
  if (range < 8) return null;
  const v = Math.min(Math.max(raw - s.min, 0), range) / range;
  return s.invert ? 1 - v : v;
}

export const CFG_SIZE = 256;      // config version 7 (firmware 0.34+, LED engine v2); 0.31-0.33 send 160 bytes (v6), 0.29-0.30 128 (v5), older 96 (v4)
export const CFG_SIZE_V6 = 160;
export const CFG_SIZE_V5 = 128;
export const CFG_SIZE_V4 = 96;
export const CFG_VERSION = 7;

export function parseConfig(dv) {
  if (dv.getUint32(0, true) !== 0x43434159) throw new Error('Bad config magic');
  const flags = dv.getUint8(21);
  const v7 = dv.byteLength >= CFG_SIZE && dv.getUint8(4) >= 7;
  const pins = [];
  for (let i = 0; i < FUNCS.length; i++) pins.push(dv.getUint8(5 + i));
  const bootModes = [];
  for (let i = 0; i < NUM_FRETS; i++) bootModes.push(dv.getUint8(28 + i));
  const out = {
    pins,
    whammyCh: dv.getUint8(14), whammyInvert: !!dv.getUint8(15),
    whammyMin: dv.getUint16(16, true), whammyMax: dv.getUint16(18, true),
    tiltPin: dv.getUint8(20),
    btEnabled: !!(flags & 1), tiltEnabled: !!(flags & 2), combinedStrum: !!(flags & 4),
    usbMode: dv.getUint8(22), debounceMode: dv.getUint8(23), debounce100us: dv.getUint16(24, true),
    whammySmooth: dv.getUint8(26), whammyDeadzone: dv.getUint8(27),
    bootModes,
    cfgRev: dv.getUint8(57),
    rgbEnabled: !!(flags & 8), rgbBootFlash: !!(flags & 16), starDpadLeft: !!(flags & 32), rgbStarPower: !!(flags & 64), btDebugLog: !!(flags & 128),
    xinputType: dv.getUint8(58), ledType: dv.getUint8(59), ledOrder: dv.getUint8(60), ledClkPin: dv.getUint8(61),
    keys: Array.from({ length: 11 }, (_, i) => dv.getUint8(62 + i)),
    hostPin: dv.getUint8(57) >= 4 ? dv.getUint8(73) : PIN_NONE,
    rgbPin: dv.getUint8(33), rgbBrightness: dv.getUint8(34), rgbEffect: dv.getUint8(35), rgbSpeed: dv.getUint8(36),
    ledMap: [0, 1, 2, 3, 4].map((i) => dv.getUint8(37 + i)),
    colors: [0, 1, 2, 3, 4].map((i) => rgbToHex(dv.getUint8(42 + i * 3), dv.getUint8(43 + i * 3), dv.getUint8(44 + i * 3))),
    // LED layout (firmware 0.25+; zero in older configs = five fret LEDs, no strum LEDs)
    noFretLeds: !!dv.getUint8(74), strumLeds: Math.min(8, dv.getUint8(75)),
    // strum LEDs 1..4 at 76..79 / roles 83, 5..8 (firmware 0.26+) at 84..87 / roles 88
    // slots past the strum LED count are parked at 200+ (configs from 0.25 have zeros there) so re-layouts keep them last
    strumMap: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i >= Math.min(8, dv.getUint8(75)) ? 200 + i : i < 4 ? dv.getUint8(76 + i) : dv.getUint8(84 + i - 4))),
    strumColor: (dv.getUint8(80) | dv.getUint8(81) | dv.getUint8(82)) ? rgbToHex(dv.getUint8(80), dv.getUint8(81), dv.getUint8(82)) : '#ffffff',
    strumRoles: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (dv.getUint8(i < 4 ? 83 : 88) >> (2 * (i & 3))) & 3),
    cfgVersion: dv.getUint8(4),
    // tilt sensors (version 5): 2 x 8 bytes at 92, then accelerometer pins and filters at 108
    // two LEDs per fret (version 6): count at 124, second positions at 125..129
    ...(dv.byteLength >= CFG_SIZE_V6 && dv.getUint8(4) >= 6 ? {
      fretLeds: dv.getUint8(124) === 2 ? 2 : 1, ledMap2: [0, 1, 2, 3, 4].map((i) => dv.getUint8(125 + i)),
      tiltInvert: dv.getUint8(130) === 1,   // firmware 0.33: 1 = normally closed switch
    } : { fretLeds: 1, ledMap2: [5, 6, 7, 8, 9], tiltInvert: false }),
    ...(dv.byteLength >= CFG_SIZE_V5 && dv.getUint8(4) >= 5 ? {
      atilt: [0, 1].map((i) => {
        const o = 92 + i * 8;
        return { src: dv.getUint8(o), target: dv.getUint8(o + 1), invert: !!dv.getUint8(o + 2), threshold: dv.getUint8(o + 3), min: dv.getUint16(o + 4, true), max: dv.getUint16(o + 6, true) };
      }),
      accelSda: dv.getUint8(108), accelScl: dv.getUint8(109), accelGate: dv.getUint8(110), accelMedian: dv.getUint8(111), accelLowpass: dv.getUint8(112),
      xinputOpts: dv.getUint8(113),
      rumblePin: dv.getUint8(114), rumbleFlags: dv.getUint8(115), rumbleStrength: dv.getUint8(116) || 80,
      ps2Pins: [117, 118, 119, 120, 121].map((o) => dv.getUint8(o)), wiiSda: dv.getUint8(122), wiiScl: dv.getUint8(123),
    } : defaultTiltSensors()),
  };
  // LED engine v2 (version 7): older firmware has none of it, so fill in defaults and derive the zones from the old effect
  const colors = out.colors;
  Object.assign(out, v7 ? parseLedV2(dv) : defaultLedV2(colors, out.rgbEffect, out.rgbSpeed));
  return out;
}

// Written in the layout the controller sent (version 4 / 96 bytes for firmware before 0.29)
export function serializeConfig(c) {
  const ver = Math.min(CFG_VERSION, c.cfgVersion ?? CFG_VERSION);
  const v5 = ver >= 5, v6 = ver >= 6, v7 = ver >= 7;
  const buf = new ArrayBuffer(v7 ? CFG_SIZE : v6 ? CFG_SIZE_V6 : v5 ? CFG_SIZE_V5 : CFG_SIZE_V4);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x43434159, true);
  dv.setUint8(4, v7 ? 7 : v6 ? 6 : v5 ? 5 : 4);
  c.pins.forEach((p, i) => dv.setUint8(5 + i, p));
  dv.setUint8(14, c.whammyCh);
  dv.setUint8(15, c.whammyInvert ? 1 : 0);
  dv.setUint16(16, c.whammyMin, true);
  dv.setUint16(18, c.whammyMax, true);
  dv.setUint8(20, c.tiltPin);
  dv.setUint8(21, (c.btEnabled ? 1 : 0) | (c.tiltEnabled ? 2 : 0) | (c.combinedStrum ? 4 : 0) | (c.rgbEnabled ? 8 : 0) | (c.rgbBootFlash ? 16 : 0) | (c.starDpadLeft ? 32 : 0) | (c.rgbStarPower ? 64 : 0) | (c.btDebugLog ? 128 : 0));
  dv.setUint8(22, c.usbMode);
  dv.setUint8(23, c.debounceMode);
  dv.setUint16(24, c.debounce100us, true);
  dv.setUint8(26, c.whammySmooth);
  dv.setUint8(27, c.whammyDeadzone);
  c.bootModes.forEach((m, i) => dv.setUint8(28 + i, m));
  dv.setUint8(33, c.rgbPin);
  dv.setUint8(34, Math.max(0, Math.min(255, c.rgbBrightness)));
  // v7: the legacy effect row the fret zone matches exactly (so older tools still show something sensible), else unchanged
  { const ze = v7 && c.zoneFrets ? zoneEffect(c.zoneFrets) : -1; dv.setUint8(35, ze >= 0 ? ze : c.rgbEffect); }
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
  dv.setUint8(74, c.noFretLeds ? 1 : 0);
  dv.setUint8(75, c.strumLeds || 0);
  (c.strumMap || []).forEach((m, i) => dv.setUint8(i < 4 ? 76 + i : 84 + i - 4, m));
  { const [r, g, b] = hexToRgb(c.strumColor || '#ffffff'); dv.setUint8(80, r); dv.setUint8(81, g); dv.setUint8(82, b); }
  const roles = c.strumRoles || [];
  dv.setUint8(83, roles.slice(0, 4).reduce((v, role, i) => v | ((role & 3) << (2 * i)), 0));
  dv.setUint8(88, roles.slice(4, 8).reduce((v, role, i) => v | ((role & 3) << (2 * i)), 0));
  if (!v5) { dv.setUint32(92, crc32(new Uint8Array(buf, 0, 92)), true); return buf; }
  (c.atilt || defaultTiltSensors().atilt).forEach((s, i) => {
    const o = 92 + i * 8;
    dv.setUint8(o, s.src); dv.setUint8(o + 1, s.target ? 1 : 0); dv.setUint8(o + 2, s.invert ? 1 : 0);
    dv.setUint8(o + 3, Math.max(1, Math.min(99, s.threshold | 0)));
    dv.setUint16(o + 4, Math.max(0, Math.min(4095, s.min | 0)), true); dv.setUint16(o + 6, Math.max(0, Math.min(4095, s.max | 0)), true);
  });
  dv.setUint8(108, c.accelSda ?? PIN_NONE); dv.setUint8(109, c.accelScl ?? PIN_NONE);
  dv.setUint8(110, Math.min(100, c.accelGate | 0)); dv.setUint8(111, Math.min(9, c.accelMedian | 0)); dv.setUint8(112, Math.min(100, c.accelLowpass | 0));
  dv.setUint8(113, (c.xinputOpts | 0) & 3);
  dv.setUint8(114, c.rumblePin ?? PIN_NONE); dv.setUint8(115, (c.rumbleFlags ?? 3) & 7);
  dv.setUint8(116, Math.max(10, Math.min(100, c.rumbleStrength ?? 80)));
  (c.ps2Pins || []).forEach((p, i) => dv.setUint8(117 + i, p ?? PIN_NONE));
  dv.setUint8(122, c.wiiSda ?? PIN_NONE); dv.setUint8(123, c.wiiScl ?? PIN_NONE);
  if (!v6) { dv.setUint32(124, crc32(new Uint8Array(buf, 0, 124)), true); return buf; }
  dv.setUint8(124, c.fretLeds === 2 ? 2 : 1);
  (c.ledMap2 || [5, 6, 7, 8, 9]).forEach((p, i) => dv.setUint8(125 + i, Math.min(p, MAX_LEDS - 1)));
  dv.setUint8(130, c.tiltInvert ? 1 : 0);
  if (!v7) { dv.setUint32(156, crc32(new Uint8Array(buf, 0, 156)), true); return buf; }
  serializeLedV2(dv, c);
  dv.setUint32(252, crc32(new Uint8Array(buf, 0, 252)), true);
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
  11: (a, b) => `pairing window open for ${b} s${a ? ', this mode\'s hosts forgotten' : ''}`,
  12: (a) => (a === 0 ? 'reconnected with stored key' : `stored key rejected, status 0x${a.toString(16)}`),
  13: (a) => `connection parameters ${a === 0 ? 'accepted' : 'rejected'} by host`,
  14: (a, b) => (a ? `host used an old legacy key (EDIV 0x${b.toString(16)})` : 'host asked for its stored key'),
  15: (a, b) => `host address …:${[a, b >> 8, b & 255].map((x) => x.toString(16).padStart(2, '0')).join(':')}`,
  16: (a, b) => (a === 0 ? `connection interval now ${(b * 1.25).toFixed(2)} ms` : `connection update failed, status 0x${a.toString(16)}`),
  17: (a, b) => (a === 0xff ? `database changed since host ${b} last saw it: sending Service Changed` : a === 0 ? 'host confirmed Service Changed' : `Service Changed not confirmed, status 0x${a.toString(16)}`),
  18: (a, b) => `host set MTU ${b}`,
  19: (a, b) => `host read ${['?', 'input', 'output', 'feature'][a] || a} report ${b}`,
  20: (a, b) => {
    const from = b & 0x8000 ? 'host →' : '→ host';
    if (b & 0x4000) return `${from} pairing PDU 0x${a.toString(16)}`;
    if (b & 0x2000) return `${from} L2CAP signalling 0x${a.toString(16)}`;
    const ATT = { 0x01: 'error', 0x02: 'MTU request', 0x03: 'MTU response', 0x04: 'find information', 0x05: 'find information response', 0x06: 'find by type', 0x07: 'find by type response', 0x08: 'read by type', 0x09: 'read by type response', 0x0a: 'read', 0x0b: 'read response', 0x0c: 'read blob', 0x0d: 'read blob response', 0x0e: 'read multiple', 0x10: 'read by group type', 0x11: 'read by group type response', 0x12: 'write', 0x13: 'write response', 0x16: 'prepare write', 0x18: 'execute write', 0x1b: 'notification', 0x1d: 'indication', 0x1e: 'confirmation', 0x52: 'write command' };
    if (a === 0x01 && b & 0x1000) return `${from} ATT error 0x${((b >> 8) & 0x0f).toString(16)} to ${ATT[b & 0xff] || '0x' + (b & 0xff).toString(16)}`;
    const h = b & 0x0fff;
    return `${from} ATT ${ATT[a] || '0x' + a.toString(16)}${h ? ` handle 0x${h.toString(16)}` : ''}`;
  },
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
    xinputFallback: dv.byteLength > 12 ? !!(dv.getUint8(12) & 2) : false, // firmware 0.28+: XInput running as HID (host has no XInput driver)
    autoHost: dv.byteLength > 13 && (dv.getUint8(12) & 4) ? dv.getUint8(13) : 0,   // firmware 0.30+: host Auto mode found (HOST_*)
  };
}

export function parseStatus(dv) {
  const mask = dv.getUint32(0, true);
  const adc = [dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint16(8, true)];
  const counts = [];
  for (let i = 0; i < NUM_DIGITAL_PINS; i++) counts.push(dv.getUint8(10 + i));
  const flags = dv.getUint8(10 + NUM_DIGITAL_PINS);
  const o = 11 + NUM_DIGITAL_PINS;   // firmware 0.29+: accelerometer type, then X, Y, Z, LIS3DH ADC 1..3 (0xffff = none)
  const accelType = dv.byteLength > o ? dv.getUint8(o) : 0;
  const accelRaw = dv.byteLength >= o + 13 ? [0, 1, 2, 3, 4, 5].map((i) => dv.getUint16(o + 1 + i * 2, true)) : [0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff];
  const ports = dv.byteLength > o + 13 ? dv.getUint8(o + 13) : 0;   // firmware 0.31+: 1 PS2 polling, 2 Wii Remote on the extension, 4 Wii connected over Bluetooth
  // firmware 0.36+: the second accelerometer's type, then its X, Y, Z (0xffff = none)
  const accel2Type = dv.byteLength > o + 14 ? dv.getUint8(o + 14) : 0;
  const accel2Raw = dv.byteLength >= o + 21 ? [0, 1, 2].map((i) => dv.getUint16(o + 15 + i * 2, true)) : [0xffff, 0xffff, 0xffff];
  return { t: performance.now(), mask, adc, counts, btState: flags & 3, saveOk: !!(flags & 4), savePending: !!(flags & 8), accelType, accelRaw, ports, accel2Type, accel2Raw };
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
