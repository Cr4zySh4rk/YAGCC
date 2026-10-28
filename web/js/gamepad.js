// A clean SVG gamepad for the Test page: lights up from a generic pad ({buttons, lx, ly, rx, ry, lt, rt}),
// relabels per console family and reports clicks so a source can be assigned to the part that was clicked.
import { outName, outputSupported } from './mapping.js?v=dev';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const pt = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];

export function createPad(onPick) {
  const svg = el('svg', { viewBox: '0 0 640 330', class: 'gp-svg', role: 'img', 'aria-label': 'Generic gamepad' });
  const parts = [];                  // {g, outs, label?}
  const byOut = {};                  // output -> element (digital highlight)
  const labels = {};                 // output -> text element
  const part = (cls, outs, target, parent = svg) => {
    const g = el('g', { class: 'gp-part ' + cls, tabindex: 0, role: 'button' }, parent);
    const rec = { g, outs, target };
    parts.push(rec);
    const pick = () => onPick && onPick(target);
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return rec;
  };

  // body
  el('path', { class: 'gp-body', d: 'M150 70 C 110 70 60 110 40 200 C 28 255 40 292 78 292 C 108 292 120 262 150 244 L 490 244 C 520 262 532 292 562 292 C 600 292 612 255 600 200 C 580 110 530 70 490 70 Z' }, svg);

  // triggers (bars that fill) and bumpers
  const trig = {};
  for (const [side, x, o, oa] of [['L', 96, 7, 22], ['R', 444, 8, 23]]) {
    const r = part('trig', [o, oa], { trigger: side });
    el('rect', { class: 'gp-shape', x, y: 6, width: 100, height: 30, rx: 8 }, r.g);
    trig[side] = el('rect', { class: 'gp-fill', x: x + 3, y: 9, width: 0, height: 24, rx: 6 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl', x: x + 50, y: 26, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
    r.fillEl = trig[side]; r.x = x;
  }
  for (const [x, o] of [[96, 5], [444, 6]]) {
    const r = part('btn bump', [o], { out: o });
    el('rect', { class: 'gp-shape', x, y: 42, width: 100, height: 22, rx: 8 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl', x: x + 50, y: 58, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
  }

  // sticks
  const sticks = {};
  for (const [side, cx, cy, click, fx, fy] of [['L', 168, 134, 12, 18, 19], ['R', 400, 218, 13, 20, 21]]) {
    const wrap = el('g', { class: 'gp-stick' }, svg);
    const R = 46, ri = 17;
    const dirs = [['right', -45, 45, 'x', 1], ['down', 45, 135, 'y', -1], ['left', 135, 225, 'x', -1], ['up', 225, 315, 'y', 1]];
    for (const [dir, a0, a1] of dirs) {
      const [x0, y0] = pt(cx, cy, R, a0), [x1, y1] = pt(cx, cy, R, a1);
      const axisOut = dir === 'left' || dir === 'right' ? fx : fy;
      const k = (side === 'L' ? 24 : 28) + (dir === 'left' ? 0 : dir === 'right' ? 1 : dir === 'down' ? 2 : 3);
      const r = part('wedge', [k, axisOut], { stick: side, dir }, wrap);
      el('path', { class: 'gp-shape', d: `M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z` }, r.g);
      r.dir = dir;
    }
    const c = part('btn click', [click], { out: click }, wrap);
    el('circle', { class: 'gp-shape', cx, cy, r: ri }, c.g);
    labels[click] = el('text', { class: 'gp-lbl sm', x: cx, y: cy + 4, 'text-anchor': 'middle' }, c.g);
    byOut[click] = c.g;
    el('circle', { class: 'gp-ring', cx, cy, r: R, 'pointer-events': 'none' }, wrap);
    const dot = el('circle', { class: 'gp-dot', cx, cy, r: 11, 'pointer-events': 'none' }, wrap);
    sticks[side] = { dot, cx, cy, wrap, range: R - 13 };
  }

  // D-pad
  const dc = [250, 218], dp = [[14, 0, -1], [15, 0, 1], [16, -1, 0], [17, 1, 0]];
  for (const [o, dx, dy] of dp) {
    const r = part('btn dpad', [o], { out: o });
    const w = dx ? 30 : 26, h = dx ? 26 : 30;
    el('rect', { class: 'gp-shape', x: dc[0] + dx * 28 - w / 2, y: dc[1] + dy * 28 - h / 2, width: w, height: h, rx: 5 }, r.g);
    const arrow = dy < 0 ? 'M0 -6 L6 4 H-6Z' : dy > 0 ? 'M0 6 L6 -4 H-6Z' : dx < 0 ? 'M-6 0 L4 -6 V6Z' : 'M6 0 L-4 -6 V6Z';
    el('path', { class: 'gp-arrow', d: arrow, transform: `translate(${dc[0] + dx * 28} ${dc[1] + dy * 28})` }, r.g);
    byOut[o] = r.g;
  }
  el('rect', { class: 'gp-shape static', x: dc[0] - 14, y: dc[1] - 14, width: 28, height: 28, 'pointer-events': 'none' }, svg);

  // face buttons (Xbox positions: A bottom, B right, X left, Y top)
  const fc = [488, 138];
  for (const [o, dx, dy] of [[1, 0, 1], [2, 1, 0], [3, -1, 0], [4, 0, -1]]) {
    const r = part('btn face', [o], { out: o });
    const x = fc[0] + dx * 36, y = fc[1] + dy * 36;
    el('circle', { class: 'gp-shape', cx: x, cy: y, r: 20 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl', x, y: y + 5, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
  }

  // centre buttons
  for (const [o, x, y, w] of [[9, 268, 128, 44], [11, 320, 80, 0], [10, 372, 128, 44]]) {
    const r = part('btn mid', [o], { out: o });
    if (o === 11) el('circle', { class: 'gp-shape', cx: x, cy: y, r: 19 }, r.g);
    else el('rect', { class: 'gp-shape', x: x - w / 2, y: y - 11, width: w, height: 22, rx: 11 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl sm', x, y: y + 4, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
  }

  let mode = 0;
  const api = {
    el: svg,
    setMode(m) {
      mode = m;
      for (const [o, t] of Object.entries(labels)) t.textContent = +o === 12 || +o === 13 ? '' : outName(+o, m);   // the stick dot sits on top of the click circle
      for (const r of parts) r.g.classList.toggle('na', !r.outs.some((o) => outputSupported(m, o)));
      const names = (o) => outName(o, m);
      for (const r of parts) {
        const t = r.target;
        r.g.setAttribute('aria-label', t.out ? names(t.out) : t.trigger ? names(t.trigger === 'L' ? 7 : 8) : `${t.stick === 'L' ? 'Left' : 'Right'} stick ${t.dir}`);
      }
    },
    setArmed(on) { svg.classList.toggle('armed', !!on); },
    update(pad) {
      for (const [o, g] of Object.entries(byOut)) {
        if (+o === 7) continue;
        if (+o === 8) continue;
        g.classList.toggle('on', !!(pad.buttons & (1 << (o - 1))));
      }
      const lt = Math.max(pad.lt || 0, pad.buttons & (1 << 6) ? 1 : 0), rt = Math.max(pad.rt || 0, pad.buttons & (1 << 7) ? 1 : 0);
      for (const [side, v, o] of [['L', lt, 7], ['R', rt, 8]]) {
        const r = parts.find((p) => p.target.trigger === side);
        r.fillEl.setAttribute('width', (94 * Math.max(0, Math.min(1, v))).toFixed(1));
        r.g.classList.toggle('on', v > 0.02);
      }
      for (const [side, x, y] of [['L', pad.lx, pad.ly], ['R', pad.rx, pad.ry]]) {
        const s = sticks[side];
        s.dot.setAttribute('cx', (s.cx + Math.max(-1, Math.min(1, x)) * s.range).toFixed(1));
        s.dot.setAttribute('cy', (s.cy - Math.max(-1, Math.min(1, y)) * s.range).toFixed(1));   // Y+ is up
        s.dot.classList.toggle('moved', Math.hypot(x, y) > 0.1);
      }
    },
  };
  return api;
}
