import { t, localized } from './i18n.js?v=dev';
// YAGCC wire protocol (the on-wire magic stays 'YACC' for compatibility) - mirrors firmware/src/config.h and usb_common.h
export const VID = 0x1209;
export const PIDS = [0x0001, 0x0002, 0x0003, 0x0004];   // 4 = Auto mode before the host is known

export const VREQ = {
  INFO: 0x30, STATUS: 0x31, GETCFG: 0x32, SETCFG: 0x33,
  SAVE: 0x34, DEFAULTS: 0x35, REBOOT: 0x36, SETMODE: 0x37, LEDTEST: 0x38, BTLOG: 0x39, BTLOGFL: 0x3A, RUMBLE: 0x3B, LEDPREVIEW: 0x3C, GETEXT: 0x3D, SETEXT: 0x3E,
};

export const FUNCS = ['green', 'red', 'yellow', 'blue', 'orange', 'strumUp', 'strumDown', 'star', 'plus'];
export const FUNC_LABEL = localized(() => ({
  green: t('common.green'), red: t('common.red'), yellow: t('common.yellow'), blue: t('common.blue'), orange: t('common.orange'),
  strumUp: t('common.strum_up'), strumDown: t('common.strum_down'), star: t('common.star_power'), plus: t('test.source.plus_start.name'),
}));
export const NUM_FRETS = 5;
// Tilt inputs as buttons (firmware 0.41, config bytes 242..244: tilt switch, sensor 1, sensor 2). In the config
// object `tiltFunc` is [switch, sensor 1, sensor 2], each an index into FUNCS (default star power). On the wire 0 =
// star power, n = FUNCS[n - 1]. A sensor only uses it when its target is "press" (1); whammy (0) ignores it.
export const TILT_FUNC_MIN_MINOR = 41;
export const FUNC_STAR = FUNCS.indexOf('star');
export const tiltFuncFromByte = (b) => (b >= 1 && b <= FUNCS.length ? b - 1 : FUNC_STAR);
export const tiltFuncToByte = (f) => (Number.isInteger(f) && f >= 0 && f < FUNCS.length && f !== FUNC_STAR ? f + 1 : 0);
export const PIN_NONE = 0xff;
export const NUM_DIGITAL_PINS = 23;
export const MODE_NONE = 0xff;

// order = how they are listed in the UI; id = firmware MODE_* value
export const MODES = localized(() => ([
  { id: 10, name: t('compat.any_console_whatever_plugged.mode'), short: t('mode.auto_detect_console.short'), config: true, min: 30,
    desc: t('mode.auto_detect_console.desc') },
  { id: 0, name: 'XInput (Xbox 360)', short: 'XInput', config: true,
    desc: t('mode.xinput_xbox_360.desc') },
  { id: 3, name: 'PS3 Rock Band', short: 'PS3 RB', config: false,
    desc: t('mode.ps3_rock_band.desc') },
  { id: 1, name: 'PS3 Guitar Hero', short: 'PS3 GH', config: false,
    desc: t('mode.ps3_guitar_hero.desc') },
  { id: 2, name: t('mode.hid_gamepad.name'), short: 'HID', config: true,
    desc: t('mode.hid_gamepad.desc') },
  { id: 4, name: t('mode.keyboard_fortnite_festival.name'), short: t('setup.gate.keyboard'), config: true,
    desc: t('mode.keyboard_fortnite_festival.desc') },
  { id: 6, name: 'Wii Rock Band', short: 'Wii RB', config: false,
    desc: t('mode.wii_rock_band.desc') },
  { id: 5, name: 'Nintendo Switch', short: 'Switch', config: false,
    desc: t('mode.nintendo_switch.desc') },
  { id: 7, name: 'Original Xbox', short: 'OG Xbox', config: false,
    desc: t('mode.original_xbox.desc') },
  { id: 8, name: t('mode.suffix_experimental', { name: t('mode.ps4_ps5_guitar.name') }), base: t('mode.ps4_ps5_guitar.name'), short: 'PS4', config: false, host: true,
    desc: t('mode.ps4_ps5_guitar_experimental.desc') },
  { id: 11, name: t('mode.suffix_experimental', { name: t('mode.ps5_guitar.name') }), base: t('mode.ps5_guitar.name'), short: 'PS5', config: false, host: true, min: 30,
    desc: t('mode.ps5_guitar_experimental.desc') },
  { id: 9, name: t('mode.xbox_one_series_guitar.name'), short: 'Xbox One', config: false, host: true,
    desc: t('mode.xbox_one_series_guitar.desc') },
]));
export const modeBaseName = (id) => { const m = MODES.find((x) => x.id === id); return m ? m.base || m.name : t('mode.unknown.name'); };
export const modeName = (id) => (MODES.find((m) => m.id === id) || { name: t('mode.unknown.name') }).name;

export const BOARDS = localized(() => ({
  0: 'Raspberry Pi Pico', 1: 'Raspberry Pi Pico W', 2: 'Raspberry Pi Pico 2',
  3: 'Raspberry Pi Pico 2 W', 4: t('board.pico_compatible_clone'), 5: t('install.waveshare_rp2040_zero.name'), 6: 'Waveshare RP2040-One',
  7: t('install.sparkfun_promicro.name'), 8: t('install.adafruit_kb2040.name'), 255: t('board.unknown_board'),
}));

export const DEBOUNCE_MODES = localized(() => ([
  { id: 0, name: 'Hold release', desc: t('tune.debounce.hold_release.desc') },
  { id: 1, name: t('tune.debounce.delay_press.name'), desc: t('tune.debounce.delay_press.desc') },
  { id: 2, name: t('tune.debounce.classic.name'), desc: t('tune.debounce.classic.desc') },
]));

export const NUM_LEDS = 5;            // frets with LEDs (one or two LEDs each)
export const MAX_STRUM_LEDS = 8;      // strum bar LEDs
export const MAX_LEDS = 2 * NUM_LEDS + MAX_STRUM_LEDS;
export const STRUM_ROLES = localized(() => ([
  { id: 0, name: t('lights.hw.strum_role.up_down.name') },
  { id: 1, name: t('common.strum_up') },
  { id: 2, name: t('common.strum_down') },
]));
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
export const LED_TYPES = localized(() => ([
  { id: 0, name: 'WS2812B / NeoPixel', desc: t('lights.hw.led_type.ws2812b_neopixel.desc') },
  { id: 1, name: 'SK6812 RGBW', desc: t('lights.hw.led_type.sk6812_rgbw.desc') },
  { id: 2, name: 'APA102 / SK9822', desc: t('lights.hw.led_type.apa102_sk9822.desc') },
]));
export const LED_ORDERS = ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR'];

// keyboard mode: slots in firmware order, and the HID usage codes a user can pick
export const KEY_SLOTS = localized(() => ([t('common.green'), t('common.red'), t('common.yellow'), t('common.blue'), t('common.orange'), t('common.strum_up'), t('common.strum_down'), t('common.star_power'), t('common.plus'), t('common.tilt'), t('modes.keys.whammy_past_half_way')]));
export const KEYS = localized(() => ((() => {
  const k = { 0: t('common.none') };
  for (let i = 0; i < 26; i++) k[0x04 + i] = String.fromCharCode(65 + i);
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((d, i) => { k[0x1e + i] = d; });
  Object.assign(k, { 0x28: 'Enter', 0x29: 'Escape', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=',
    0x2f: '[', 0x30: ']', 0x33: ';', 0x34: "'", 0x36: ',', 0x37: '.', 0x38: '/',
    0x4a: 'Home', 0x4b: 'Page Up', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'Page Down',
    0x4f: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up',
    0xe0: 'Left Ctrl', 0xe1: 'Left Shift', 0xe2: 'Left Alt', 0xe4: 'Right Ctrl', 0xe5: 'Right Shift', 0xe6: 'Right Alt' });
  for (let i = 0; i < 12; i++) k[0x3a + i] = 'F' + (i + 1);
  return k;
})()));
export const KEY_PRESETS = localized(() => ([
  { name: t('modes.keys.fortnite_festival_pro_guitar.name'), keys: [0x1e, 0x1f, 0x20, 0x21, 0x22, 0xe5, 0xe4, 0x4e, 0x29, 0x4e, 0x38],
    desc: t('modes.keys.fortnite_festival_pro_guitar.desc') },
  { name: t('modes.keys.fortnite_festival_lead.name'), keys: [0x07, 0x09, 0x0d, 0x0e, 0x0f, 0x52, 0x51, 0x2c, 0x29, 0x2c, 0x00],
    desc: t('modes.keys.fortnite_festival_lead.desc') },
]));
export const FRET_DEFAULT_COLORS = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#fb923c'];
export const EFFECTS = localized(() => ([
  { id: 0, name: t('lights.effect.static.name'), desc: t('lights.effect.static.desc') },
  { id: 1, name: t('lights.effect.dim_press.name'), desc: t('lights.effect.dim_press.desc') },
  { id: 2, name: t('lights.effect.off_press.name'), desc: t('lights.effect.off_press.desc') },
  { id: 3, name: t('lights.effect.brighten_press.name'), desc: t('lights.effect.brighten_press.desc') },
  { id: 4, name: t('lights.effect.flash_fade.name'), desc: t('lights.effect.flash_fade.desc') },
  { id: 5, name: t('lights.effect.breathing.name'), desc: t('lights.effect.breathing.desc') },
  { id: 6, name: t('common.rainbow'), desc: t('lights.effect.rainbow.desc') },
]));
export const RGB_PRESETS = localized(() => ([
  { name: 'Guitar Hero', colors: FRET_DEFAULT_COLORS },
  { name: t('lights.theme.neon.name'), colors: ['#00ffa3', '#ff2e63', '#fff200', '#00b4ff', '#ff7a00'] },
  { name: t('lights.theme.ice.name'), colors: ['#a5f3fc', '#67e8f9', '#38bdf8', '#818cf8', '#c4b5fd'] },
  { name: t('common.fire'), colors: ['#fde047', '#fbbf24', '#fb923c', '#ef4444', '#b91c1c'] },
  { name: t('lights.theme.mono_white.name'), colors: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'] },
]));

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
export const IDLE_ANIMS = localized(() => ([
  { id: 0, name: t('common.off_2'), desc: t('lights.idle.off.desc') },
  { id: 1, name: t('lights.idle.solid.name'), desc: t('lights.idle.solid.desc') },
  { id: 2, name: t('lights.idle.breathe.name'), desc: t('lights.idle.breathe.desc'), speed: true },
  { id: 3, name: t('lights.theme.heartbeat.name'), desc: t('lights.idle.heartbeat.desc'), speed: true },
  { id: 4, name: t('common.rainbow'), desc: t('lights.idle.rainbow.desc'), speed: true, ownColor: true },
  { id: 5, name: t('lights.idle.rainbow_wave.name'), desc: t('lights.idle.rainbow_wave.desc'), speed: true, ownColor: true },
  { id: 6, name: t('lights.idle.colour_wave.name'), desc: t('lights.idle.colour_wave.desc'), speed: true },
  { id: 7, name: t('lights.idle.sparkle.name'), desc: t('lights.idle.sparkle.desc'), speed: true },
  { id: 8, name: t('lights.idle.chase.name'), desc: t('lights.idle.chase.desc'), speed: true },
  { id: 9, name: t('common.fire'), desc: t('lights.idle.fire.desc') },
  { id: 10, name: t('lights.idle.hue_drift.name'), desc: t('lights.idle.hue_drift.desc'), speed: true },
]));
export const PRESS_FX = localized(() => ([
  { id: 0, name: t('lights.press.no_reaction.name'), desc: t('lights.press.no_reaction.desc') },
  { id: 1, name: t('lights.press.light_up.name'), desc: t('lights.press.light_up.desc') },
  { id: 2, name: t('lights.effect.flash_fade.name'), desc: t('lights.press.flash_fade.desc'), fade: true },
  { id: 3, name: t('lights.press.dim.name'), desc: t('lights.press.dim.desc') },
  { id: 4, name: t('lights.press.go_dark.name'), desc: t('lights.press.go_dark.desc') },
  { id: 5, name: t('lights.press.strobe.name'), desc: t('lights.press.strobe.desc'), speed: true },
  { id: 6, name: t('lights.press.ripple.name'), desc: t('lights.press.ripple.desc'), fade: true },
  { id: 7, name: t('lights.press.random_colour.name'), desc: t('lights.press.random_colour.desc'), fade: true },
  { id: 8, name: t('lights.press.white_spark.name'), desc: t('lights.press.white_spark.desc'), fade: true },
  { id: 9, name: t('lights.press.sweep.name'), desc: t('lights.press.sweep.desc'), fade: true },
]));
export const STAR_ANIMS = localized(() => ([
  { id: 0, name: t('lights.star.pulse.name'), desc: t('lights.star.pulse.desc'), speed: true },
  { id: 1, name: t('lights.idle.solid.name'), desc: t('lights.star.solid.desc') },
  { id: 2, name: t('common.rainbow'), desc: t('lights.star.rainbow.desc'), ownColor: true },
  { id: 3, name: t('lights.press.strobe.name'), desc: t('lights.star.strobe.desc'), speed: true },
  { id: 4, name: t('lights.idle.chase.name'), desc: t('lights.star.chase.desc') },
  { id: 5, name: t('common.fire'), desc: t('lights.star.fire.desc') },
  { id: 6, name: t('lights.idle.sparkle.name'), desc: t('lights.star.sparkle.desc') },
]));
export const WHAMMY_FX = localized(() => ([
  { id: 0, name: t('common.nothing'), desc: t('lights.whammy.nothing.desc') },
  { id: 1, name: t('common.brightness'), desc: t('lights.whammy.brightness.desc') },
  { id: 2, name: t('lights.whammy.flutter.name'), desc: t('lights.whammy.flutter.desc') },
  { id: 3, name: t('lights.whammy.colour_shift.name'), desc: t('lights.whammy.colour_shift.desc') },
  { id: 4, name: t('lights.whammy.wave.name'), desc: t('lights.whammy.wave.desc') },
]));
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
    cfgVersion: CFG_VERSION, tiltFunc: [FUNC_STAR, FUNC_STAR, FUNC_STAR], ...defaultTiltSensors(),
    ...defaultLedV2(FRET_DEFAULT_COLORS, 3, 5),
  };
}

// Analog tilt sensors and the I2C accelerometer (firmware 0.29+, config version 5)
export const NUM_ATILT = 2;
export const ATILT_TARGET = { WHAMMY: 0, STAR: 1 };
// sensor sources: 0..2 analog inputs GP26..28, 3..5 accelerometer axes, 6..8 a LIS3DH's aux ADC inputs
export const ATILT_SOURCES = localized(() => ([
  { id: 0, name: t('tune.tilt.source.adc.name'), kind: 'adc' }, { id: 1, name: t('tune.tilt.source.adc.name_2'), kind: 'adc' }, { id: 2, name: t('tune.tilt.source.adc.name_3'), kind: 'adc' },
  { id: 3, name: t('tune.tilt.source.accel.name'), kind: 'accel' }, { id: 4, name: t('tune.tilt.source.accel.name_2'), kind: 'accel' }, { id: 5, name: t('tune.tilt.source.accel.name_3'), kind: 'accel' },
  { id: 6, name: 'LIS3DH ADC 1', kind: 'lis' }, { id: 7, name: 'LIS3DH ADC 2', kind: 'lis' }, { id: 8, name: 'LIS3DH ADC 3', kind: 'lis' },
  // 9..11: a second accelerometer on the same bus at another address (firmware 0.36+)
  { id: 9, name: t('tune.tilt.source.accel2.name'), kind: 'accel2' }, { id: 10, name: t('tune.tilt.source.accel2.name_2'), kind: 'accel2' }, { id: 11, name: t('tune.tilt.source.accel2.name_3'), kind: 'accel2' },
]));
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

export const CFG_SIZE = 256;      // config version 7 (firmware 0.34+, LED engine v2; 0.41 adds tilt_func at 242..244); 0.31-0.33 send 160 bytes (v6), 0.29-0.30 128 (v5), older 96 (v4)
export const CFG_SIZE_V6 = 160;
export const CFG_SIZE_V5 = 128;
export const CFG_SIZE_V4 = 96;
export const CFG_VERSION = 7;

export function parseConfig(dv) {
  if (dv.getUint32(0, true) !== 0x43434159) throw new Error(t('proto.parse_config.bad_config_magic'));
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
    tiltFunc: [0, 1, 2].map((i) => tiltFuncFromByte(v7 ? dv.getUint8(242 + i) : 0)),   // 0.41+; zero (star power) before
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
  dv.setUint8(113, (c.xinputOpts | 0) & 7);
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
  [0, 1, 2].forEach((i) => dv.setUint8(242 + i, tiltFuncToByte(c.tiltFunc?.[i])));
  dv.setUint32(252, crc32(new Uint8Array(buf, 0, 252)), true);
  return buf;
}

// Bluetooth event log (firmware 0.14+): 8 byte records, oldest first.
// Entries 21..27 (firmware 0.50+) are translated (btlog.* keys); older logs without them parse as before.
const hex = (n) => n.toString(16);
// Security Manager pairing failure reasons (Core spec, Vol 3 Part H 3.5.5) and PDU opcodes, as readable text
const smReason = (r) => ({
  1: t('btlog.reason.passkey'), 2: t('btlog.reason.oob'), 3: t('btlog.reason.authreq'), 4: t('btlog.reason.confirm'),
  5: t('btlog.reason.unsupported'), 6: t('btlog.reason.keysize'), 7: t('btlog.reason.command'), 8: t('btlog.reason.unspecified'),
  9: t('btlog.reason.repeated'), 10: t('btlog.reason.parameters'), 11: t('btlog.reason.dhkey'), 12: t('btlog.reason.numeric'),
  13: t('btlog.reason.busy'), 14: t('btlog.reason.cross'), 15: t('btlog.reason.key_rejected'),
})[r] || '';
const smOpcode = (o) => ({
  1: t('btlog.sm.request'), 2: t('btlog.sm.response'), 3: t('btlog.sm.confirm'), 4: t('btlog.sm.random'), 5: t('btlog.sm.failed'),
  6: t('btlog.sm.encryption_info'), 7: t('btlog.sm.central_id'), 8: t('btlog.sm.identity_info'), 9: t('btlog.sm.identity_address'),
  10: t('btlog.sm.signing_info'), 11: t('btlog.sm.security_request'), 12: t('btlog.sm.public_key'), 13: t('btlog.sm.dhkey_check'),
})[o] || '';
const paren = (s) => (s ? ` (${s})` : '');
const discReason = (r) => ({
  5: t('btlog.disc.auth'), 8: t('btlog.disc.timeout'), 0x13: t('btlog.disc.host_ended'), 0x14: t('btlog.disc.host_low_resources'),
  0x15: t('btlog.disc.host_power_off'), 0x16: t('btlog.disc.guitar_ended'), 0x22: t('btlog.disc.response_timeout'),
  0x28: t('btlog.disc.instant'), 0x3d: t('btlog.disc.mic'), 0x3e: t('btlog.disc.not_established'),
})[r] || '';
const BT_EVENTS = {
  1: (a, b) => `radio on${a & 1 ? ', pairing requested' : ''}${a & 2 ? ', after a mode change' : ''} (mode ${b})`,
  2: () => 'Bluetooth ready',
  3: (a, b) => `advertising${a ? ` (discoverable${b === 1 ? ', ' + t('btlog.no_bond') : ''})` : ' (paired hosts only)'}`,
  4: (a, b) => (a === 0 ? `host connected (address type ${b})` : `connection failed, status 0x${a.toString(16)}`),
  5: (a, b) => (b === 0 && a ? 'link encrypted' : `encryption ${a ? 'on' : 'failed'}, status 0x${b.toString(16)}`),
  6: (a) => `disconnected, reason 0x${a.toString(16)}${paren(discReason(a))}`,
  7: (a) => `pairing request ${a ? 'accepted' : 'declined (not in pairing mode)'}`,
  8: (a, b) => (a === 0 ? 'paired' : `pairing failed, status 0x${a.toString(16)}, reason 0x${b.toString(16)}${paren(smReason(b))}`),
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
    if (b & 0x4000) return `${from} pairing PDU 0x${a.toString(16)}${paren(smOpcode(a))}${a === 5 && (b & 0xff) ? paren(t('btlog.pair_failed_reason', { code: '0x' + hex(b & 0xff), text: smReason(b & 0xff) || '?' })) : ''}`;
    if (b & 0x2000) return `${from} L2CAP signalling 0x${a.toString(16)}`;
    const ATT = { 0x01: 'error', 0x02: 'MTU request', 0x03: 'MTU response', 0x04: 'find information', 0x05: 'find information response', 0x06: 'find by type', 0x07: 'find by type response', 0x08: 'read by type', 0x09: 'read by type response', 0x0a: 'read', 0x0b: 'read response', 0x0c: 'read blob', 0x0d: 'read blob response', 0x0e: 'read multiple', 0x10: 'read by group type', 0x11: 'read by group type response', 0x12: 'write', 0x13: 'write response', 0x16: 'prepare write', 0x18: 'execute write', 0x1b: 'notification', 0x1d: 'indication', 0x1e: 'confirmation', 0x52: 'write command' };
    if (a === 0x01 && b & 0x1000) return `${from} ATT error 0x${((b >> 8) & 0x0f).toString(16)} to ${ATT[b & 0xff] || '0x' + (b & 0xff).toString(16)}`;
    const h = b & 0x0fff;
    return `${from} ATT ${ATT[a] || '0x' + a.toString(16)}${h ? ` handle 0x${h.toString(16)}` : ''}`;
  },
  // ---- firmware 0.50+
  21: (a) => (a ? t('btlog.sm_reencrypt_started') : t('btlog.sm_pairing_started')),
  22: (a, b) => {
    const io = [t('btlog.io.display_only'), t('btlog.io.display_yes_no'), t('btlog.io.keyboard_only'), t('btlog.io.no_input_no_output'), t('btlog.io.keyboard_display')][a & 7] || '?';
    const auth = [b & 1 ? t('btlog.auth.bonding') : t('btlog.auth.no_bonding'), b & 8 ? t('btlog.auth.secure_connections') : t('btlog.auth.legacy'),
      b & 4 ? t('btlog.auth.mitm') : t('btlog.auth.no_mitm'), (b >> 8) & 1 ? t('btlog.auth.oob') : t('btlog.auth.no_oob')].join(', ');
    const who = a & 0x20 ? t('btlog.who.host') : t('btlog.who.guitar');
    return a & 0x10 ? t('btlog.pair_response', { who, io, auth }) : t('btlog.pair_request', { who, io, auth });
  },
  23: (a, b) => t('btlog.link_params', { ms: (b * 1.25).toFixed(2), latency: a }),
  24: (a, b) => t('btlog.ccc_write', { value: a, handle: '0x' + hex(b) }),
  25: (a, b) => {
    const why = [t('btlog.reset.power'), t('btlog.reset.watchdog'), t('btlog.reset.hardfault'), t('btlog.reset.stack'), t('btlog.reset.requested'), t('btlog.reset.radio')][a] || `#${a}`;
    return t('btlog.restarted', { why, n: b });
  },
  26: (a, b) => {
    const where = [t('btlog.where.connect'), t('btlog.where.pairing_started'), t('btlog.where.pairing_complete'), t('btlog.where.reencrypted'), t('btlog.where.disconnect')][a] || `#${a}`;
    return b === 0 ? t('btlog.stack_overflow', { where }) : t('btlog.stack_free', { where, bytes: b });
  },
  27: (a, b) => (a ? t('btlog.ident_ok', { index: b }) : t('btlog.ident_unknown')),
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
    const tv = dv.getUint32(o, true), code = dv.getUint8(o + 4), a = dv.getUint8(o + 5), b = dv.getUint16(o + 6, true);
    const f = BT_EVENTS[code];
    out.push(`${(tv / 1000).toFixed(2).padStart(8)} s  ${f ? f(a, b) : `event ${code} ${a} ${b}`}`);
  }
  return out;
}

export function parseInfo(dv) {
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'YACC') throw new Error(t('proto.parse_info.not_yagcc_device'));
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
  const out = { t: performance.now(), mask, adc, counts, btState: flags & 3, saveOk: !!(flags & 4), savePending: !!(flags & 8), accelType, accelRaw, ports, accel2Type, accel2Raw };
  // firmware 0.42+ (96 bytes): the running mode's map row, the generic pad it packed, the calibrated stick
  if (dv.byteLength >= STATUS_LEN_42) {
    const row = dv.getUint8(55), s16 = (o) => dv.getInt16(o, true);
    Object.assign(out, {
      modeRow: row === 0xff ? -1 : row,
      pad: { buttons: dv.getUint32(56, true) & 0x1ffff, lx: s16(60) / 32767, ly: s16(62) / 32767, rx: s16(64) / 32767, ry: s16(66) / 32767, lt: s16(68) / 32767, rt: s16(70) / 32767 },
      stick: [s16(72) / 32767, s16(74) / 32767],
      stickOn: !!(dv.getUint8(76) & 1), dpadOn: !!(dv.getUint8(76) & 2),
    });
  }
  return out;
}
export const STATUS_LEN_42 = 96;

// Same maths as firmware input_whammy(): returns 0..1
export function whammyValue(raw, cfg) {
  const range = cfg.whammyMax - cfg.whammyMin;
  if (range < 8) return 0;
  let v = Math.min(Math.max(raw - cfg.whammyMin, 0), range) / range;
  if (cfg.whammyInvert) v = 1 - v;
  return v < cfg.whammyDeadzone / 100 ? 0 : v;
}

export const isPressed = (status, pin) => pin !== PIN_NONE && pin < NUM_DIGITAL_PINS && !((status.mask >>> pin) & 1);


// ---------------------------------------------------------------- extension page (firmware 0.42+, VREQ 0x3D / 0x3E)
// 512 bytes: optional pins, analog stick, and the per-mode input map (12 modes x 24 sources). See map_spec.md.
export const EXT_MIN_MINOR = 42;
export const EXT_SIZE = 512;
export const EXT_MAGIC = 0x54584559;   // "YEXT"
export const NUM_MODE_ROWS = 12;
export const NUM_SRC = 22;
export const MAP_ROW = 24;
export const MAP_DEFAULT = 0xff;
export const MAP_NONE = 0;
// extPins order: D-pad up, down, left, right, Select, Home, stick click
export const EXT_PIN_NAMES = localized(() => ([t('common.d_pad_up'), t('common.d_pad_down'), t('common.d_pad_left'), t('common.d_pad_right'), t('common.select'), t('common.home'), t('common.stick_click')]));
export const STICK_INVERT_X = 1, STICK_INVERT_Y = 2, STICK_SWAP = 4;
export const emptyMapRow = () => Array(MAP_ROW).fill(MAP_DEFAULT);
export function defaultExt() {
  return {
    extPins: Array(7).fill(PIN_NONE), stickCh: [PIN_NONE, PIN_NONE], stickFlags: 0, deadzone: 10,
    cal: [0, 2048, 4095, 0, 2048, 4095],
    curve: [0, 0, 0],   // response curve -100..100 of the whammy, tilt sensor 1, tilt sensor 2 (firmware 0.43+, ext bytes 320..322)
    range: [0, 0, 0, 0],   // stick range of the whammy, tilt switch, sensor 1, sensor 2 (firmware 0.44+, ext bytes 323..326): 0 from centre, 1 full sweep
    devName: '',   // custom device name (firmware 0.46+, ext bytes 328..353; whole name since 0.51): up to 25 printable ASCII characters, '' = the default names
    tiltSwType: 0,   // tilt switch type (firmware 0.51+, ext byte 354): 0 = mercury / generic, 1 = SW-520D ball switch
    tiltSwFilter: 0,   // tilt switch settle time (firmware 0.51+, ext byte 355): 0 = type default (SW-520D about 40 ms), 1..250 ms
    btSleep: 0,   // Bluetooth idle sleep (firmware 0.45+, ext byte 327): 0 = 2 minutes (default), 1..60 minutes, 255 = never
    map: Array.from({ length: NUM_MODE_ROWS }, emptyMapRow),
  };
}
export const BT_SLEEP_NEVER = 255;
export const BT_SLEEP_CHOICES = [1, 0, 5, 10, 15, 30, 60, BT_SLEEP_NEVER];   // 0 is the 2 minute default
export const btSleepByte = (v) => (v === BT_SLEEP_NEVER ? BT_SLEEP_NEVER : Number.isInteger(v) && v >= 1 && v <= 60 && v !== 2 ? v : 0);
export const DEV_NAME_MAX = 25, DEV_NAME_BYTES = 26, DEV_NAME_DEFAULT = 'YAGCC Guitar Controller';
export const TILT_SW_MERCURY = 0, TILT_SW_520D = 1, TILT_SW_FILTER_MAX = 250;
// Characters outside printable ASCII in `s`, as a list (for the friendly message)
export const devNameBadChars = (s) => [...new Set([...String(s)].filter((c) => c < ' ' || c > '~'))];
// ok: stored form (trimmed, '' = default); error: why not
export function checkDevName(s) {
  const tv = String(s ?? '').trim();
  if (devNameBadChars(tv).length) return { ok: false, name: tv, error: t('name.error.only_letters_digits_spaces_basic') };
  if (tv.length > DEV_NAME_MAX) return { ok: false, name: tv, error: t('name.error.up_characters', { DEV_NAME_MAX }) };
  return { ok: true, name: tv };
}
export const devNameValid = (s) => typeof s === 'string' && checkDevName(s).ok && s === s.trim();
export function parseDevName(dv) {
  const b = Array.from({ length: DEV_NAME_BYTES }, (_, i) => dv.getUint8(328 + i));
  let n = b.indexOf(0); if (n < 0) n = DEV_NAME_BYTES;
  const s = String.fromCharCode(...b.slice(0, n));
  return devNameValid(s) ? s : '';
}
export function parseExt(dv) {
  if (dv.byteLength < EXT_SIZE) throw new Error(t('proto.parse_ext.short_extension_page'));
  if (dv.getUint32(0, true) !== EXT_MAGIC) throw new Error(t('proto.parse_ext.bad_extension_magic'));
  const u8 = new Uint8Array(dv.buffer, dv.byteOffset, EXT_SIZE);
  if (dv.getUint32(508, true) !== crc32(u8.subarray(0, 508))) throw new Error(t('proto.parse_ext.bad_extension_checksum'));
  return {
    extPins: [0, 1, 2, 3, 4, 5, 6].map((i) => dv.getUint8(8 + i)),
    stickCh: [dv.getUint8(16), dv.getUint8(17)],
    stickFlags: dv.getUint8(18) & 7, deadzone: Math.min(50, dv.getUint8(19)),
    cal: [0, 1, 2, 3, 4, 5].map((i) => dv.getUint16(20 + i * 2, true)),
    map: Array.from({ length: NUM_MODE_ROWS }, (_, m) => Array.from({ length: MAP_ROW }, (_, s) => dv.getUint8(32 + m * MAP_ROW + s))),
    curve: [0, 1, 2].map((i) => Math.max(-100, Math.min(100, dv.getInt8(320 + i)))),
    range: [0, 1, 2, 3].map((i) => (dv.getUint8(323 + i) === 1 ? 1 : 0)),
    btSleep: btSleepByte(dv.getUint8(327)),
    devName: parseDevName(dv),
    tiltSwType: dv.getUint8(354) === 1 ? 1 : 0,
    tiltSwFilter: Math.min(TILT_SW_FILTER_MAX, dv.getUint8(355)),
  };
}
export function serializeExt(e) {
  const buf = new ArrayBuffer(EXT_SIZE), dv = new DataView(buf);
  dv.setUint32(0, EXT_MAGIC, true); dv.setUint8(4, 1);
  (e.extPins || []).slice(0, 7).forEach((p, i) => dv.setUint8(8 + i, p));
  dv.setUint8(15, 0xff);
  dv.setUint8(16, e.stickCh[0]); dv.setUint8(17, e.stickCh[1]);
  dv.setUint8(18, e.stickFlags & 7); dv.setUint8(19, Math.max(0, Math.min(50, e.deadzone | 0)));
  e.cal.forEach((v, i) => dv.setUint16(20 + i * 2, Math.max(0, Math.min(4095, v | 0)), true));
  for (let m = 0; m < NUM_MODE_ROWS; m++) {
    const row = e.map[m] || emptyMapRow();
    for (let s = 0; s < MAP_ROW; s++) dv.setUint8(32 + m * MAP_ROW + s, s < NUM_SRC ? row[s] : 0xff);
  }
  (e.curve || [0, 0, 0]).slice(0, 3).forEach((c, i) => dv.setInt8(320 + i, Math.max(-100, Math.min(100, Math.round(c) | 0))));
  (e.range || [0, 0, 0, 0]).slice(0, 4).forEach((r, i) => dv.setUint8(323 + i, r === 1 ? 1 : 0));
  dv.setUint8(327, btSleepByte(e.btSleep));
  { const c = checkDevName(e.devName || ''); if (c.ok) [...c.name].forEach((ch, i) => dv.setUint8(328 + i, ch.charCodeAt(0))); }
  dv.setUint8(354, e.tiltSwType === 1 ? 1 : 0);
  dv.setUint8(355, Math.max(0, Math.min(TILT_SW_FILTER_MAX, Math.round(e.tiltSwFilter) | 0)));
  dv.setUint32(508, crc32(new Uint8Array(buf, 0, 508)), true);
  return buf;
}
