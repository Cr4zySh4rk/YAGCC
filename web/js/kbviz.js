// On-screen US keyboard for the Test page's Keyboard mode: keys bound to a guitar input carry that input's name and light up
// while the input is pressed. Bindings are cfg.keys (HID usage codes, one per KEY_SLOTS entry).
import { KEYS } from './protocol.js?v=dev';

const SLOT_SHORT = ['Green', 'Red', 'Yellow', 'Blue', 'Orange', 'Strum ↑', 'Strum ↓', 'Star', 'Plus', 'Tilt', 'Whammy'];
const SLOT_COLOR = ['#22c55e', '#ef4444', '#facc15', '#3b82f6', '#fb923c', '#a78bfa', '#a78bfa', '#1cc6ff', '#94a3b8', '#1cc6ff', '#f472b6'];
export const slotShort = (i) => SLOT_SHORT[i];
export const slotColor = (i) => SLOT_COLOR[i];

const L = (c) => 0x04 + c.charCodeAt(0) - 65;   // letter -> usage
const row = (str) => [...str].map((ch) => [L(ch), ch, 4]);
const D = (n) => [0x1e + (n + 9) % 10, String(n), 4];
// [usage, legend, width in quarter units]; every main row is 60 quarter units wide
const MAIN = [
  [[0x29, 'Esc', 4], ...Array.from({ length: 12 }, (_, i) => [0x3a + i, 'F' + (i + 1), 4]), [0, '', 8]],
  [[0x35, '`', 4], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(D), [0x2d, '-', 4], [0x2e, '=', 4], [0x2a, 'Backspace', 8]],
  [[0x2b, 'Tab', 6], ...row('QWERTYUIOP'), [0x2f, '[', 4], [0x30, ']', 4], [0x31, '\\', 6]],
  [[0x39, 'Caps', 7], ...row('ASDFGHJKL'), [0x33, ';', 4], [0x34, "'", 4], [0x28, 'Enter', 9]],
  [[0xe1, 'Shift', 9], ...row('ZXCVBNM'), [0x36, ',', 4], [0x37, '.', 4], [0x38, '/', 4], [0xe5, 'Shift', 11]],
  [[0xe0, 'Ctrl', 8], [0xe2, 'Alt', 8], [0x2c, 'Space', 24], [0xe6, 'Alt', 8], [0xe4, 'Ctrl', 12]],
];
const NAV = [
  [[0x4a, 'Home'], [0x4b, 'PgUp'], [0, '']],
  [[0x4c, 'Del'], [0x4d, 'End'], [0x4e, 'PgDn']],
  [[0, ''], [0x52, '↑'], [0, '']],
  [[0x50, '←'], [0x51, '↓'], [0x4f, '→']],
];

export function createKeyboard() {
  const el = document.createElement('div');
  el.className = 'kb';
  const cap = (code, legend, span, cls = '') => (code
    ? `<div class="kc ${cls}" data-code="${code}" style="grid-column:span ${span}"><b>${legend}</b><small></small></div>`
    : `<div class="kspace" style="grid-column:span ${span}"></div>`);
  el.innerHTML = `<div class="kb-main">${MAIN.map((r) => `<div class="kb-row">${r.map(([c, g, w]) => cap(c, g, w)).join('')}</div>`).join('')}</div>
    <div class="kb-nav">${NAV.map((r) => `<div class="kb-row n3">${r.map(([c, g]) => cap(c, g, 1)).join('')}</div>`).join('')}</div>`;
  const caps = new Map([...el.querySelectorAll('.kc')].map((k) => [+k.dataset.code, k]));
  let sig = '';
  // keys: cfg.keys. Draws the labels when the bindings change.
  function setBindings(keys) {
    const s = keys.join();
    if (s === sig) return;
    sig = s;
    caps.forEach((k) => { k.classList.remove('bound', 'on'); k.querySelector('small').textContent = ''; k.style.removeProperty('--c'); k.removeAttribute('title'); delete k.dataset.slots; });
    const by = new Map();
    keys.forEach((code, slot) => { if (code) by.set(code, [...(by.get(code) || []), slot]); });
    by.forEach((slots, code) => {
      const k = caps.get(code);
      if (!k) return;
      k.classList.add('bound');
      k.dataset.slots = slots.join();
      k.style.setProperty('--c', SLOT_COLOR[slots[0]]);
      k.querySelector('small').textContent = slots.map((i) => SLOT_SHORT[i]).join(' / ');
      k.title = slots.map((i) => SLOT_SHORT[i]).join(' / ') + ' (' + (KEYS[code] || '') + ')';
    });
  }
  // pressed: boolean per slot
  function update(keys, pressed) {
    setBindings(keys);
    caps.forEach((k) => {
      const sl = k.dataset.slots;
      k.classList.toggle('on', !!sl && sl.split(',').some((i) => pressed[+i]));
    });
  }
  return { el, setBindings, update };
}
