// The Test page's generic gamepad, drawn as a "Controller Visualizer" card: header, an Xbox-style controller and a legend.
// It lights up from a generic pad ({buttons, lx, ly, rx, ry, lt, rt}), relabels per console family and reports clicks so a
// source can be assigned to the part that was clicked. Every part is a .gp-part with an aria-label (the output's name).
import { outName, outputSupported, modeFamily } from './mapping.js?v=dev';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const pt = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const clamp1 = (v) => Math.max(-1, Math.min(1, v || 0));
let uid = 0;

export function createPad(onPick) {
  const id = ++uid;
  const card = document.createElement('div');
  card.className = 'gp-card';
  card.innerHTML = `
    <div class="gp-head">
      <svg class="gp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8h11a4.5 4.5 0 0 1 4.4 5.4l-.8 4A2.6 2.6 0 0 1 16.3 18.5L15.2 17H8.8l-1.1 1.5a2.6 2.6 0 0 1-4.8-1.1l-.8-4A4.5 4.5 0 0 1 6.5 8z"/><path d="M8 11v3M6.5 12.5h3"/><circle cx="15.5" cy="11.5" r=".6"/><circle cx="17.5" cy="13.5" r=".6"/></svg>
      <div class="gp-titles"><div class="gp-title">Controller Visualizer</div><div class="gp-device" data-gp="device"></div></div>
      <span class="gp-pill" data-gp="pill"><b data-gp="pillText">P1</b><i class="gp-live-dot"></i></span>
    </div>`;
  const svg = el('svg', { viewBox: '0 0 640 452', class: 'gp-svg', role: 'img', 'aria-label': 'Generic gamepad' });
  card.appendChild(svg);
  card.insertAdjacentHTML('beforeend', '<div class="gp-legend"><span><i class="gp-key on"></i>Button pressed</span><span><i class="gp-key"></i>Waiting for input</span></div>');
  const q = (k) => card.querySelector(`[data-gp="${k}"]`);

  const parts = [];                  // {g, outs, target}
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

  // ---- body: smooth rounded Xbox shape with two grips and a seam on each
  el('path', { class: 'gp-body', d: 'M175 148 C 240 132 400 132 465 148 C 540 162 592 240 608 330 C 616 380 598 404 570 404 C 540 404 524 370 500 346 C 488 336 470 335 450 335 L 190 335 C 170 335 152 336 140 346 C 116 370 100 404 70 404 C 42 404 24 380 32 330 C 48 240 100 162 175 148 Z' }, svg);
  el('path', { class: 'gp-seam', d: 'M60 256 L 150 342 M580 256 L 490 342' }, svg);

  // ---- triggers (tall pills that fill from the bottom) with a bumper label beneath each
  const defs = el('defs', {}, svg);
  const TY = 6, TH = 104, TW = 50;
  for (const [side, x, o, oa] of [['L', 124, 7, 22], ['R', 466, 8, 23]]) {
    const clip = el('clipPath', { id: `gpclip${id}${side}` }, defs);
    el('rect', { x, y: TY, width: TW, height: TH, rx: TW / 2 }, clip);
    const r = part('trig', [o, oa], { trigger: side });
    el('rect', { class: 'gp-shape', x, y: TY, width: TW, height: TH, rx: TW / 2 }, r.g);
    const fillG = el('g', { 'clip-path': `url(#gpclip${id}${side})`, 'pointer-events': 'none' }, r.g);
    r.fillEl = el('rect', { class: 'gp-fill', x, y: TY + TH, width: TW, height: 0 }, fillG);
    r.y0 = TY; r.h = TH;
    labels[o] = el('text', { class: 'gp-lbl sm', x: x + TW / 2, y: TY + TH - 12, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
  }
  for (const [x, o] of [[108, 5], [450, 6]]) {
    const r = part('btn bump', [o], { out: o });
    el('rect', { class: 'gp-shape', x, y: 116, width: 82, height: 28, rx: 10 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl', x: x + 41, y: 135, 'text-anchor': 'middle' }, r.g);
    byOut[o] = r.g;
  }

  // ---- sticks: a light ring (four invisible click wedges), a thick disc that follows the stick, the click under it
  const sticks = {};
  for (const [side, cx, cy, click, fx, fy, R] of [['L', 165, 202, 12, 18, 19, 50], ['R', 408, 278, 13, 20, 21, 44]]) {
    const wrap = el('g', { class: 'gp-stick' }, svg);
    el('circle', { class: 'gp-ring', cx, cy, r: R, 'pointer-events': 'none' }, wrap);
    const dirs = [['right', -45, 45], ['down', 45, 135], ['left', 135, 225], ['up', 225, 315]];
    for (const [dir, a0, a1] of dirs) {
      const [x0, y0] = pt(cx, cy, R, a0), [x1, y1] = pt(cx, cy, R, a1);
      const axisOut = dir === 'left' || dir === 'right' ? fx : fy;
      const k = (side === 'L' ? 24 : 28) + (dir === 'left' ? 0 : dir === 'right' ? 1 : dir === 'down' ? 2 : 3);
      const r = part('wedge', [k, axisOut], { stick: side, dir }, wrap);
      el('path', { class: 'gp-shape', d: `M${cx} ${cy} L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z` }, r.g);
      r.dir = dir;
    }
    const dr = Math.round(R * 0.58);
    const c = part('btn click', [click], { out: click }, wrap);
    el('circle', { class: 'gp-shape click', cx, cy, r: dr }, c.g);
    byOut[click] = c.g;
    const dot = el('circle', { class: 'gp-dot', cx, cy, r: dr, 'pointer-events': 'none' }, wrap);
    dot.dataset.cx0 = cx; dot.dataset.cy0 = cy;
    sticks[side] = { dot, cx, cy, range: R - dr - 3, click: c.g };
  }

  // ---- D-pad: a plus sign in a round well
  const dc = [232, 278];
  el('circle', { class: 'gp-well', cx: dc[0], cy: dc[1], r: 40 }, svg);
  for (const [o, dx, dy] of [[14, 0, -1], [15, 0, 1], [16, -1, 0], [17, 1, 0]]) {
    const r = part('btn dpad', [o], { out: o });
    const w = dx ? 26 : 24, h = dx ? 24 : 26;
    el('rect', { class: 'gp-shape', x: dc[0] + dx * 19 - w / 2, y: dc[1] + dy * 19 - h / 2, width: w, height: h, rx: 5 }, r.g);
    const arrow = dy < 0 ? 'M0 -5 L5 3 H-5Z' : dy > 0 ? 'M0 5 L5 -3 H-5Z' : dx < 0 ? 'M-5 0 L3 -5 V5Z' : 'M5 0 L-3 -5 V5Z';
    el('path', { class: 'gp-arrow', d: arrow, transform: `translate(${dc[0] + dx * 19} ${dc[1] + dy * 19})` }, r.g);
    byOut[o] = r.g;
  }
  el('rect', { class: 'gp-shape static', x: dc[0] - 12, y: dc[1] - 12, width: 24, height: 24, 'pointer-events': 'none' }, svg);

  // ---- face buttons in a round well (Xbox positions: A bottom, B right, X left, Y top)
  const fc = [486, 196];
  el('circle', { class: 'gp-well', cx: fc[0], cy: fc[1], r: 66 }, svg);
  for (const [o, dx, dy] of [[1, 0, 1], [2, 1, 0], [3, -1, 0], [4, 0, -1]]) {
    const r = part('btn face', [o], { out: o });
    const x = fc[0] + dx * 38, y = fc[1] + dy * 38;
    el('circle', { class: 'gp-shape', cx: x, cy: y, r: 22 }, r.g);
    labels[o] = el('text', { class: 'gp-lbl', x, y: y + 5, 'text-anchor': 'middle' }, r.g);
    // PlayStation modes: geometric symbols instead of text (drawn here as plain strokes)
    const kind = ['cross', 'circle', 'square', 'triangle'][o - 1];
    const sym = el('g', { class: 'gp-sym ' + kind, transform: `translate(${x} ${y})`, 'pointer-events': 'none', display: 'none' }, r.g);
    if (kind === 'cross') el('path', { d: 'M-7.5 -7.5 L7.5 7.5 M7.5 -7.5 L-7.5 7.5' }, sym);
    else if (kind === 'circle') el('circle', { r: 8.5 }, sym);
    else if (kind === 'square') el('rect', { x: -7.5, y: -7.5, width: 15, height: 15, rx: 1.5 }, sym);
    else el('path', { d: 'M0 -9 L9 6.5 H-9 Z' }, sym);
    r.sym = sym;
    byOut[o] = r.g;
  }

  // ---- centre: Guide (house icon) above View / Menu (rectangle / hamburger icons)
  { const r = part('btn mid guide', [11], { out: 11 });
    el('circle', { class: 'gp-shape', cx: 320, cy: 184, r: 22 }, r.g);
    el('path', { class: 'gp-icn', d: 'M320 173 L311 181 H314 V191 H318.5 V185 H321.5 V191 H326 V181 H329 Z' }, r.g);
    byOut[11] = r.g; }
  { const r = part('btn mid', [9], { out: 9 });
    r.pill = el('rect', { class: 'gp-shape', x: 279, y: 223, width: 26, height: 26, rx: 13 }, r.g); r.px = 292;
    el('rect', { class: 'gp-icn line', x: 287, y: 232, width: 10, height: 8, rx: 1.5 }, r.g);
    byOut[9] = r.g; }
  { const r = part('btn mid', [10], { out: 10 });
    r.pill = el('rect', { class: 'gp-shape', x: 335, y: 223, width: 26, height: 26, rx: 13 }, r.g); r.px = 348;
    el('path', { class: 'gp-icn line', d: 'M343 232 H353 M343 236 H353 M343 240 H353' }, r.g);
    byOut[10] = r.g; }

  // the controller sits below the triggers / bumpers: everything but those moves down together
  { const top = parts.filter((r) => r.g.classList.contains('trig') || r.g.classList.contains('bump')).map((r) => r.g);
    const grp = el('g', { transform: 'translate(0 34)' });
    for (const n of [...svg.childNodes]) if (n !== defs && !top.includes(n)) grp.appendChild(n);
    svg.insertBefore(grp, defs.nextSibling);
    for (const n of top) svg.appendChild(n); }

  let mode = 0;
  const api = {
    el: card,
    svg,
    setHeader(device) { q('device').textContent = device; },
    setLive(live, tip = '') {
      q('pill').classList.toggle('live', !!live);
      q('pillText').textContent = live ? 'P1' : 'Preview';
      q('pill').title = tip;
    },
    setMode(m) {
      mode = m;
      const ps = modeFamily(m) === 'ps';
      for (const r of parts) {
        if (r.sym) { r.sym.setAttribute('display', ps ? 'inline' : 'none'); labels[r.outs[0]].setAttribute('display', ps ? 'none' : 'inline'); }
        if (r.pill) {   // Select / Start are small pills in PlayStation modes, round buttons elsewhere
          const w = ps ? 42 : 26, cx = r.px + (ps ? (r.px < 320 ? -8 : 8) : 0);
          r.pill.setAttribute('width', w); r.pill.setAttribute('x', cx - w / 2);
          r.g.querySelector('.gp-icn').setAttribute('transform', `translate(${cx - r.px} 0)`);
        }
      }
      for (const [o, t] of Object.entries(labels)) t.textContent = outName(+o, m);
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
        if (+o === 7 || +o === 8) continue;
        g.classList.toggle('on', !!(pad.buttons & (1 << (o - 1))));
      }
      const lt = pad.lt || 0, rt = pad.rt || 0;   // a digital LT / RT already fills the axis
      for (const [side, v] of [['L', lt], ['R', rt]]) {
        const r = parts.find((p) => p.target.trigger === side), f = Math.max(0, Math.min(1, v)), h = r.h * f;
        r.fillEl.setAttribute('y', (r.y0 + r.h - h).toFixed(1));
        r.fillEl.setAttribute('height', h.toFixed(1));
        r.g.classList.toggle('on', f > 0.02);
      }
      for (const [side, x, y] of [['L', pad.lx, pad.ly], ['R', pad.rx, pad.ry]]) {
        const s = sticks[side];
        s.dot.setAttribute('cx', (s.cx + clamp1(x) * s.range).toFixed(1));
        s.dot.setAttribute('cy', (s.cy - clamp1(y) * s.range).toFixed(1));   // Y+ is up
        s.dot.classList.toggle('moved', Math.hypot(x || 0, y || 0) > 0.1);
        s.dot.classList.toggle('on', s.click.classList.contains('on'));
      }
    },
  };
  return api;
}
