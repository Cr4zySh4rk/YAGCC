// Input mapping (firmware 0.42+): sources (physical inputs), outputs (a generic gamepad), per-mode labels and a JS
// engine that mirrors the firmware's rules, so the Test page can show what any mode would send. See map_spec.md.
import { NUM_SRC, MAP_DEFAULT, MAP_NONE } from './protocol.js?v=dev';

// ---- sources: index = position in a mode's map row
export const SOURCES = [
  { id: 0, name: 'Green fret', color: '#22c55e' }, { id: 1, name: 'Red fret', color: '#ef4444' }, { id: 2, name: 'Yellow fret', color: '#facc15' },
  { id: 3, name: 'Blue fret', color: '#3b82f6' }, { id: 4, name: 'Orange fret', color: '#fb923c' },
  { id: 5, name: 'Strum up' }, { id: 6, name: 'Strum down' }, { id: 7, name: 'Star power' }, { id: 8, name: 'Plus / Start' },
  { id: 9, name: 'Whammy bar', analog: true }, { id: 10, name: 'Tilt switch', tilt: true },
  { id: 11, name: 'Tilt sensor 1', analog: true, tilt: true }, { id: 12, name: 'Tilt sensor 2', analog: true, tilt: true },
  { id: 13, name: 'D-pad up' }, { id: 14, name: 'D-pad down' }, { id: 15, name: 'D-pad left' }, { id: 16, name: 'D-pad right' },
  { id: 17, name: 'Select' }, { id: 18, name: 'Home' }, { id: 19, name: 'Stick X', analog: true }, { id: 20, name: 'Stick Y', analog: true },
  { id: 21, name: 'Stick click' },
];
console.assert(SOURCES.length === NUM_SRC);
export const isAnalogSrc = (s) => !!SOURCES[s]?.analog;
export const isStickSrc = (s) => s === 19 || s === 20;
// GUITAR_PART: source -> the part name the guitar picture uses
export const GUITAR_PART = ['green', 'red', 'yellow', 'blue', 'orange', 'strumUp', 'strumDown', 'star', 'plus', 'whammy'];

// ---- outputs: 1..31 (0 = nothing, 0xFF = the mode default)
export const OUT = {
  A: 1, B: 2, X: 3, Y: 4, LB: 5, RB: 6, LT: 7, RT: 8, BACK: 9, START: 10, GUIDE: 11, L3: 12, R3: 13,
  UP: 14, DOWN: 15, LEFT: 16, RIGHT: 17, LX: 18, LY: 19, RX: 20, RY: 21, LTA: 22, RTA: 23,
  LXM: 24, LXP: 25, LYM: 26, LYP: 27, RXM: 28, RXP: 29, RYM: 30, RYP: 31,
};
export const NUM_OUT = 32;
// what a source sends when its map entry is 0xFF (same in every mode). null = the Tune page decides (tilt inputs)
export const DEFAULT_OUT = [1, 2, 4, 3, 5, 14, 15, 9, 10, 20, null, null, null, 14, 15, 16, 17, 9, 11, 18, 19, 12];
export const TILT_AXIS_MODES = [0];   // only XInput shows the tilt on the generic pad (RY); other reports keep it in a native field

// ---- modes shown on the Test page (keyboard and Auto have no map)
export const TEST_MODES = [
  { id: 0, name: 'XInput (Xbox 360 / PC)', family: 'xbox' },
  { id: 2, name: 'HID (PC)', family: 'xbox' },
  { id: 1, name: 'PS3 Guitar Hero', family: 'ps' },
  { id: 3, name: 'PS3 Rock Band', family: 'ps' },
  { id: 6, name: 'Wii Rock Band', family: 'nin' },
  { id: 5, name: 'Switch', family: 'nin' },
  { id: 8, name: 'PS4', family: 'ps' },
  { id: 11, name: 'PS5', family: 'ps' },
  { id: 9, name: 'Xbox One', family: 'xbox' },
  { id: 7, name: 'OG Xbox', family: 'xbox' },
];
export const testMode = (id) => TEST_MODES.find((m) => m.id === id);
export const modeFamily = (id) => testMode(id)?.family || 'xbox';

// ---- which outputs each mode's report can carry (bit n = output n). From the firmware's own table (map_spec.md, verified
// by its host_map probe). Everything not listed is dropped by that mode's packer, so the Test page greys it out.
export const MODE_OUTPUTS = [
  0xfffffffe,   // 0 XInput
  0xfffffffe,   // 1 PS3 Guitar Hero
  0xfffffffe,   // 2 HID
  0xfffffffe,   // 3 PS3 Rock Band
  0,            // 4 keyboard: own key map, no generic map
  0xfffffffe,   // 5 Switch
  0xfffffffe,   // 6 Wii Rock Band
  0xfffff7fe,   // 7 OG Xbox: everything except Guide
  0xfffffffe,   // 8 PS4
  0x3013f67e,   // 9 Xbox One: buttons 1-6, 9, 10, 12-17, and RX (20, 28, 29) for the whammy
  0xfffffffe,   // 10 Auto (no map of its own: defaults)
  0xfffffffe,   // 11 PS5
].map((m) => m >>> 0);
export const outputSupported = (mode, out) => out === MAP_DEFAULT || out === MAP_NONE || (out > 0 && out < 32 && ((MODE_OUTPUTS[mode] >>> out) & 1) === 1);

// ---- names
const FAMILY_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'Guide', 'LS click', 'RS click'],
  ps: ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Select', 'Start', 'PS', 'L3', 'R3'],
  nin: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'Minus', 'Plus', 'Home', 'LS click', 'RS click'],
};
const MODE_NAME_TWEAK = { 8: { 9: 'Share', 10: 'Options' }, 11: { 9: 'Create', 10: 'Options' }, 7: { 5: 'Black', 6: 'White', 9: 'Back' }, 9: { 9: 'View', 10: 'Menu' } };
export function outName(out, mode) {
  if (out === MAP_DEFAULT) return 'Mode default';
  if (out === MAP_NONE) return 'Nothing';
  const fam = FAMILY_NAMES[modeFamily(mode)];
  if (out <= 13) return MODE_NAME_TWEAK[mode]?.[out] || fam[out - 1];
  if (out <= 17) return ['D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'][out - 14];
  if (out <= 21) return ['Left stick X', 'Left stick Y', 'Right stick X', 'Right stick Y'][out - 18];
  if (out <= 23) return `${fam[out - 22 + 6]} (analog)`;
  const k = out - 24, st = k < 4 ? 'Left' : 'Right';
  return `${st} stick ${['left', 'right', 'down', 'up'][k & 3]}`;     // LX-, LX+, LY-, LY+ ... (Y+ = up)
}
// a full-press trigger and the analog one have different names so the dropdown stays unambiguous
export function outLabel(out, mode) {
  if (out === 7 || out === 8) return `${outName(out, mode)} (full press)`;
  return outName(out, mode);
}
// what the mode-default outputs mean on a guitar
const GUITAR_MEANING = { 1: 'green fret', 2: 'red fret', 3: 'blue fret', 4: 'yellow fret', 5: 'orange fret', 14: 'strum up', 15: 'strum down', 9: 'star power', 10: 'plus', 20: 'whammy', 21: 'tilt' };
export function guitarMeaning(out) { return GUITAR_MEANING[out] || ''; }
// "A (green fret)", or just "Back" when nothing guitar-ish is attached to it
export function outFull(out, mode) {
  if (out === MAP_DEFAULT || out === MAP_NONE) return outName(out, mode);
  const g = guitarMeaning(out);
  return g ? `${outName(out, mode)} (${g})` : outName(out, mode);
}
export const OUT_GROUPS = [
  { name: 'Buttons', outs: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13] },
  { name: 'D-pad', outs: [14, 15, 16, 17] },
  { name: 'Triggers', outs: [7, 8, 22, 23] },
  { name: 'Sticks', outs: [18, 19, 20, 21] },
  { name: 'Half axes', outs: [24, 25, 26, 27, 28, 29, 30, 31] },
];

// ---- engine
const AXES = ['LX', 'LY', 'RX', 'RY', 'LT', 'RT'];
// v[s]: digital 0/1; whammy and tilt sensors 0..1; stick -1..1. tp[0..1]: tilt sensors past their own threshold.
// row: 24 map bytes of the mode. opts.mode: for the tilt axis; opts.tiltStar: a tilt input is acting as star power.
export function computePad(row, v, tp = [false, false], opts = {}) {
  let buttons = 0;
  const ax = { LX: 0, LY: 0, RX: 0, RY: 0, LT: 0, RT: 0 };
  const put = (name, val) => { if (Math.abs(val) > Math.abs(ax[name])) ax[name] = val; };
  const pressed = (s) => (s === 11 || s === 12 ? !!tp[s - 11] : isAnalogSrc(s) ? Math.abs(v[s] || 0) > 0.5 : (v[s] || 0) > 0.5);
  for (let s = 0; s < NUM_SRC; s++) {
    let o = row ? row[s] : MAP_DEFAULT;
    if (o === MAP_NONE) continue;
    if (o === MAP_DEFAULT) { o = DEFAULT_OUT[s]; if (o == null) continue; }
    if (o > 31) continue;
    const analog = isAnalogSrc(s), val = v[s] || 0;
    if (o <= 17) {
      if (pressed(s)) { buttons |= 1 << (o - 1); if (o === 7) put('LT', 1); if (o === 8) put('RT', 1); }   // a digital LT / RT also fills the axis
      continue;
    }
    if (o <= 23) {
      const trig = o >= 22;
      let out;
      if (!analog) out = pressed(s) ? 1 : 0;
      else if (isStickSrc(s)) out = trig ? Math.abs(val) : val;
      else out = trig ? val : -1 + 2 * val;
      put(trig ? AXES[o - 18] : AXES[o - 18], out);
      continue;
    }
    const k = o - 24, mag = analog ? Math.abs(val) : pressed(s) ? 1 : 0;
    put(AXES[k >> 1], (k & 1 ? 1 : -1) * mag);
  }
  if (ax.LT > 0.5) buttons |= 1 << 6;      // an analog trigger past half also sets the digital bit
  if (ax.RT > 0.5) buttons |= 1 << 7;
  if (opts.tiltStar && TILT_AXIS_MODES.includes(opts.mode)) put('RY', 1);
  return { buttons, lx: ax.LX, ly: ax.LY, rx: ax.RX, ry: ax.RY, lt: ax.LT, rt: ax.RT };
}
export const padButton = (pad, out) => !!(pad.buttons & (1 << (out - 1)));
