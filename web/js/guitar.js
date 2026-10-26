// Gibson Les Paul style Guitar Hero controller, drawn as inline SVG: lying horizontally,
// body on the left, neck and headstock to the right (like a product shot).
// Every control can be lit up live (pressed), marked as mapped, or focused (dashed ring).
import { createGuitar3D, webglAvailable } from './guitar3d.js?v=dev';
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { green: '#22c55e', red: '#ef4444', yellow: '#facc15', blue: '#3b82f6', orange: '#fb923c' };
const FRET_NAMES = ['green', 'red', 'yellow', 'blue', 'orange'];
let uidCounter = 0;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function mix(hex, to, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const T = to === 'white' ? 255 : 0;
  return '#' + c.map((v) => Math.round(v + (T - v) * t).toString(16).padStart(2, '0')).join('');
}

function grad(defs, id, kind, attrs, stops) {
  const g = el(kind, { id, ...attrs }, defs);
  for (const [o, c, op] of stops) el('stop', { offset: o, 'stop-color': c, ...(op != null ? { 'stop-opacity': op } : {}) }, g);
  return g;
}

function createGuitar2D(onPart) {
  const u = ++uidCounter;
  const id = (n) => `g${u}-${n}`;
  const url = (n) => `url(#${id(n)})`;

  const svg = el('svg', { viewBox: '0 0 1100 340', class: 'guitar', role: 'img', 'aria-label': 'Les Paul style guitar controller' });
  const defs = el('defs', {}, svg);

  // ---- gradients / filters
  grad(defs, id('sun'), 'radialGradient', { cx: 200, cy: 170, r: 270, gradientUnits: 'userSpaceOnUse' },
    [[0, '#4f7dff'], [0.35, '#2f54e6'], [0.7, '#2036a8'], [1, '#121c66']]);
  grad(defs, id('gloss'), 'linearGradient', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, '#fff', 0.2], [0.3, '#fff', 0.03], [0.5, '#fff', 0], [1, '#000', 0.22]]);
  grad(defs, id('chrome'), 'linearGradient', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, '#fbfcfe'], [0.45, '#b9c0cf'], [0.55, '#8d95a8'], [1, '#d7dce6']]);
  grad(defs, id('cream'), 'linearGradient', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, '#fbf5e2'], [1, '#d9cca4']]);
  grad(defs, id('gold'), 'radialGradient', { cx: 0.38, cy: 0.35, r: 0.8 },
    [[0, '#fff1b8'], [0.45, '#d9a93a'], [1, '#7d5612']]);
  grad(defs, id('neck'), 'linearGradient', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, '#2a2b33'], [0.12, '#1b1c22'], [0.88, '#131418'], [1, '#0b0b0e']]);
  grad(defs, id('head'), 'linearGradient', { x1: 0, y1: 0, x2: 1, y2: 1 },
    [[0, '#2b2c34'], [1, '#101116']]);
  grad(defs, id('rubber'), 'radialGradient', { cx: 0.4, cy: 0.35, r: 0.8 },
    [[0, '#3a3f4d'], [1, '#0c0e14']]);
  grad(defs, id('dial'), 'radialGradient', { cx: 0.5, cy: 0.4, r: 0.8 },
    [[0, '#202638'], [1, '#0a0d15']]);
  const capGrads = {};
  for (const n of FRET_NAMES) {
    const c = COLORS[n];
    capGrads[n] = grad(defs, id('cap-' + n), 'linearGradient', { x1: 0, y1: 0, x2: 0, y2: 1 },
      [[0, mix(c, 'white', 0.35)], [0.45, c], [1, mix(c, 'black', 0.3)]]);
  }
  const sh = el('filter', { id: id('shadow'), x: '-10%', y: '-10%', width: '125%', height: '135%' }, defs);
  el('feDropShadow', { dx: 0, dy: 10, stdDeviation: 9, 'flood-color': '#000', 'flood-opacity': 0.5 }, sh);
  const sh2 = el('filter', { id: id('shadowS'), x: '-30%', y: '-30%', width: '170%', height: '170%' }, defs);
  el('feDropShadow', { dx: 0, dy: 2, stdDeviation: 2, 'flood-color': '#000', 'flood-opacity': 0.55 }, sh2);
  // fine metallic sparkle like the printed tops in the reference photos
  const gr = el('filter', { id: id('grain'), x: 0, y: 0, width: '100%', height: '100%' }, defs);
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.85, numOctaves: 2, seed: 7, result: 'n' }, gr);
  el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2.2 -1.15' }, gr);
  const clip = el('clipPath', { id: id('bodyClip') }, defs);

  const parts = {};
  const part = (name, color) => {
    const g = el('g', { class: 'part', style: `--c:${color}` }, svg);
    parts[name] = g;
    g.dataset.part = name;
    return g;
  };
  const ring = (g, x, y, w, h, rx) => el('rect', { class: 'focus-ring', x: x - 5, y: y - 5, width: w + 10, height: h + 10, rx: rx + 4 }, g);
  const shadowS = `url(#${id('shadowS')})`;

  // ================= neck + headstock (drawn first; the body overlaps its root)
  const neck = el('g', {}, svg);
  el('path', { d: 'M958,144 L1006,136 Q1030,124 1056,128 L1074,126 Q1084,170 1074,214 L1056,212 Q1030,216 1006,204 L958,196 Z', fill: url('head'), stroke: '#08080b', 'stroke-width': 2, 'stroke-linejoin': 'round', filter: shadowS }, neck);
  el('path', { d: 'M966,148 L1006,141 Q1030,130 1056,133', fill: 'none', stroke: '#fff', 'stroke-width': 1, opacity: 0.12 }, neck);
  for (const x of [1000, 1028, 1056]) {
    for (const y of [148, 192]) {
      el('circle', { cx: x, cy: y, r: 6.5, fill: url('chrome'), stroke: '#5b6477', 'stroke-width': 1 }, neck);
      el('circle', { cx: x - 1.5, cy: y - 1.5, r: 2, fill: '#fff', opacity: 0.6 }, neck);
    }
  }
  el('rect', { x: 380, y: 136, width: 584, height: 68, rx: 6, fill: url('neck'), stroke: '#07070a', 'stroke-width': 1.5, filter: shadowS }, neck);
  el('rect', { x: 380, y: 138, width: 584, height: 3, fill: '#fff', opacity: 0.1 }, neck);
  for (let x = 452; x < 712; x += 26) {
    el('line', { x1: x, y1: 142, x2: x, y2: 198, stroke: '#000', 'stroke-width': 2.2, opacity: 0.75 }, neck);
    el('line', { x1: x + 2, y1: 142, x2: x + 2, y2: 198, stroke: '#fff', 'stroke-width': 0.8, opacity: 0.1 }, neck);
  }
  // recessed fret plate the buttons sit in
  el('rect', { x: 722, y: 139, width: 214, height: 62, rx: 6, fill: '#09090c', stroke: '#26272f', 'stroke-width': 1 }, neck);
  el('rect', { x: 950, y: 140, width: 10, height: 60, fill: '#0a0a0d' }, neck);

  // ================= body: single-cutaway Les Paul, horn under the neck
  // Outline traced (and de-skewed) from a photo of a printed Les Paul GH controller body.
  const body = 'M53.5,82.1 C51.1,87.0 49.3,91.7 47.7,96.9 C46.1,102.0 44.9,107.3 44.0,113.0 C43.1,118.7 42.4,124.8 42.1,131.1 C41.9,137.3 42.1,144.3 42.5,150.5 C42.9,156.8 43.5,161.9 44.6,168.7 C45.7,175.4 47.5,184.0 49.3,190.8 C51.1,197.6 53.3,203.8 55.5,209.6 C57.7,215.4 59.9,220.5 62.5,225.7 C65.1,230.8 67.9,235.7 71.1,240.5 C74.2,245.2 77.9,250.1 81.6,254.4 C85.2,258.6 89.1,262.6 93.1,266.2 C97.1,269.8 101.1,272.9 105.6,276.1 C110.0,279.2 115.3,282.4 119.8,284.8 C124.4,287.3 127.8,288.9 132.9,290.8 C137.9,292.7 144.6,294.8 150.1,296.2 C155.7,297.6 158.4,298.6 166.1,299.2 C173.9,299.8 188.7,300.1 196.4,299.7 C204.2,299.3 207.8,298.0 212.5,296.9 C217.1,295.8 217.8,296.5 224.4,293.3 C230.9,290.1 242.2,284.1 251.7,277.6 C261.2,271.0 274.8,258.7 281.4,254.0 C287.9,249.4 287.9,250.7 290.9,249.8 C293.9,248.8 296.0,248.3 299.2,248.2 C302.4,248.1 306.3,248.3 309.9,249.2 C313.5,250.0 313.5,248.7 320.6,253.2 C327.7,257.8 345.1,271.4 352.7,276.4 C360.2,281.4 361.2,281.4 365.7,283.2 C370.3,285.0 376.0,286.7 380.0,287.4 C383.9,288.1 386.8,287.8 389.5,287.4 C392.2,287.1 394.7,286.5 396.0,285.4 C397.3,284.3 397.4,282.1 397.2,280.7 C397.0,279.4 397.0,279.5 394.8,277.4 C392.7,275.2 387.4,271.2 384.1,268.0 C380.9,264.7 377.8,261.5 375.2,257.9 C372.7,254.3 370.5,250.2 369.0,246.5 C367.5,242.8 366.6,239.0 366.2,235.8 C365.8,232.5 366.0,229.9 366.5,227.0 C367.0,224.1 367.9,221.3 369.3,218.3 C370.8,215.3 372.9,211.7 375.2,208.9 C377.6,206.1 382.5,203.6 383.5,201.5 C384.6,199.5 382.2,204.7 381.8,196.8 C381.4,189.0 381.0,162.7 381.2,154.6 C381.4,146.4 381.7,150.3 383.0,147.9 C384.2,145.4 387.0,141.6 388.9,139.8 C390.8,138.0 385.7,137.8 394.2,137.1 C402.8,136.4 432.2,136.3 440.0,135.8 C447.8,135.2 441.2,135.7 441.2,133.8 C441.2,131.9 440.6,127.2 440.0,124.4 C439.4,121.6 439.2,120.3 437.6,117.0 C436.0,113.6 433.8,108.5 430.5,104.2 C427.1,100.0 422.4,95.3 417.4,91.5 C412.5,87.7 407.2,84.2 400.8,81.4 C394.3,78.6 386.1,75.9 378.8,74.7 C371.5,73.6 362.9,74.0 356.8,74.5 C350.8,75.0 350.9,74.7 342.6,77.5 C334.2,80.3 314.2,88.7 306.9,91.1 C299.7,93.6 302.2,92.1 299.2,92.1 C296.2,92.2 292.3,91.9 289.1,91.3 C285.9,90.7 283.5,89.9 280.2,88.5 C276.9,87.1 277.7,88.7 269.5,82.7 C261.3,76.8 240.3,59.8 230.9,52.9 C221.5,46.1 219.7,45.1 213.1,41.7 C206.4,38.2 198.6,34.6 191.1,32.1 C183.6,29.7 174.3,27.8 167.9,26.8 C161.6,25.7 159.0,25.7 153.1,25.7 C147.1,25.7 138.5,26.0 132.3,26.8 C126.1,27.5 121.2,28.5 115.7,30.2 C110.1,31.8 104.2,34.2 99.0,36.7 C93.9,39.1 89.2,41.9 84.8,45.0 C80.3,48.1 76.1,51.6 72.4,55.4 C68.6,59.1 65.4,62.9 62.3,67.3 C59.1,71.8 55.9,77.2 53.5,82.1 Z';
  el('path', { d: body }, clip);
  const b = el('g', { filter: url('shadow') }, svg);
  el('path', { d: body, fill: url('sun'), stroke: '#f3ead0', 'stroke-width': 7, 'stroke-linejoin': 'round' }, b);
  el('path', { d: body, fill: 'none', stroke: '#0c1240', 'stroke-width': 1, opacity: 0.8 }, b);
  const tex = el('g', { 'clip-path': url('bodyClip') }, svg);
  el('rect', { x: 30, y: 12, width: 430, height: 316, fill: '#fff', filter: url('grain'), opacity: 0.35 }, tex);
  el('path', { d: body, fill: url('gloss') }, tex);

  // strum slot through the middle of the body, with a cream bezel
  const pp = el('g', { filter: shadowS }, svg);
  el('rect', { x: 214, y: 130, width: 144, height: 62, rx: 16, fill: url('cream'), stroke: '#a89a70', 'stroke-width': 1.2 }, pp);
  el('rect', { x: 222, y: 139, width: 128, height: 44, rx: 12, fill: '#0b0c11', stroke: '#8e8160', 'stroke-width': 1.2 }, pp);

  // ================= strum bar: one bar along the slot, split in a down (body side) and an up (neck side) half
  const strum = (name, y, glyph) => {
    const g = part(name, '#7c8cff');
    const x = 228, w = 116, h = 18;
    el('rect', { class: 'plate', x, y, width: w, height: h, rx: 9, fill: url('chrome'), stroke: '#5b6477', 'stroke-width': 1 }, g);
    for (const xx of [x + 10, x + 15, x + 20, x + w - 20, x + w - 15, x + w - 10]) el('line', { x1: xx, y1: y + 4, x2: xx, y2: y + h - 4, stroke: '#7d8599', 'stroke-width': 1.1, opacity: 0.65 }, g);
    el('rect', { class: 'litcap', x, y, width: w, height: h, rx: 9 }, g);
    el('path', { class: 'glyph', d: glyph }, g);
    ring(g, x, y, w, h, 9);
  };
  strum('strumUp', 142, 'M278,155 L286,147 L294,155');     // upper bar = strum up
  strum('strumDown', 162, 'M278,167 L286,175 L294,167');   // lower bar = strum down

  // ================= star power & plus, lower left like the reference
  const round = (name, cx, cy, color, glyphEl) => {
    const g = part(name, color);
    el('circle', { cx, cy, r: 21, fill: url('gold'), stroke: '#5f420e', 'stroke-width': 1, filter: shadowS }, g);
    el('circle', { cx, cy, r: 16, fill: url('rubber'), stroke: '#05070b', 'stroke-width': 1.5 }, g);
    el('circle', { class: 'litcap', cx, cy, r: 16 }, g);
    glyphEl(g);
    el('circle', { class: 'focus-ring', cx, cy, r: 27 }, g);
  };
  round('star', 158, 199, '#facc15', (g) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.6 : 10;
      pts.push((158 + r * Math.cos(a)).toFixed(1) + ',' + (199 + r * Math.sin(a)).toFixed(1));
    }
    el('polygon', { class: 'glyph light fill', points: pts.join(' ') }, g);
  });
  round('plus', 120, 238, '#38e1c6', (g) => el('path', { class: 'glyph light', d: 'M112,238 H128 M120,230 V246' }, g));

  // ================= whammy: base plate below the buttons, arm sweeps out past the lower edge
  const px = 200, py = 238, rest = 34, sweep = -22, len = 104;
  const wh = el('g', {}, svg);
  parts.whammy = wh;
  el('rect', { x: 178, y: 222, width: 46, height: 32, rx: 6, fill: '#f3ead0', stroke: '#a89a70', 'stroke-width': 1, filter: shadowS }, wh);
  el('rect', { x: 184, y: 228, width: 34, height: 20, rx: 4, fill: '#0b0c11' }, wh);
  const arcA = rest * Math.PI / 180, arcB = (rest + sweep) * Math.PI / 180, ar = 56;
  const arc = `M${(px + ar * Math.cos(arcA)).toFixed(1)},${(py + ar * Math.sin(arcA)).toFixed(1)} A${ar},${ar} 0 0 0 ${(px + ar * Math.cos(arcB)).toFixed(1)},${(py + ar * Math.sin(arcB)).toFixed(1)}`;
  el('path', { class: 'wh-track', d: arc, pathLength: 100 }, wh);
  const fill = el('path', { class: 'wh-fill', d: arc, pathLength: 100, 'stroke-dasharray': '0 100' }, wh);
  const arm = el('g', { transform: `translate(${px} ${py}) rotate(${rest})` }, wh);
  el('rect', { x: 0, y: -2.5, width: len, height: 5, rx: 2.5, fill: url('chrome'), stroke: '#5b6477', 'stroke-width': 0.8, filter: shadowS }, arm);
  el('ellipse', { cx: len + 8, cy: 0, rx: 13, ry: 6, fill: url('cream'), stroke: '#a89a70', 'stroke-width': 1 }, arm);
  el('circle', { cx: px, cy: py, r: 6, fill: url('chrome'), stroke: '#5b6477', 'stroke-width': 1 }, wh);
  el('circle', { class: 'focus-ring', cx: px + 46, cy: py + 24, r: 66 }, wh);

  // ================= fret buttons: tall pads across the neck, flat edge on top, rounded end at the bottom
  FRET_NAMES.forEach((n, i) => {
    const cx = 912 - i * 42, w = 32, h = 54, x = cx - w / 2, y = 143;
    const g = part(n, COLORS[n]);
    g.classList.add('fret');   // its focus ring takes the fret's own colour (--c)
    const d = `M${x},${y + 4} Q${x},${y} ${x + 4},${y} L${x + w - 4},${y} Q${x + w},${y} ${x + w},${y + 4} L${x + w},${y + h - 15} Q${x + w},${y + h} ${x + w - 15},${y + h} L${x + 15},${y + h} Q${x},${y + h} ${x},${y + h - 15} Z`;
    el('path', { d, fill: '#000', opacity: 0.5, transform: 'translate(0 2)' }, g);
    el('path', { class: 'fretcap', d, fill: url('cap-' + n) }, g);
    el('rect', { x: x + 4, y: y + 4, width: w - 8, height: 12, rx: 3, fill: '#fff', opacity: 0.25 }, g);
    ring(g, x, y, w, h, 8);
  });

  // ================= tilt dial above the neck
  const tilt = part('tilt', '#38e1c6');
  const tx = 600, ty = 72;
  el('circle', { cx: tx, cy: ty, r: 26, fill: url('chrome'), stroke: '#5b6477', 'stroke-width': 1, filter: shadowS }, tilt);
  el('circle', { cx: tx, cy: ty, r: 21, fill: url('dial') }, tilt);
  el('circle', { class: 'litcap', cx: tx, cy: ty, r: 21, opacity: 0 }, tilt);
  for (let a = -60; a <= 60; a += 20) {
    const r = (a - 90) * Math.PI / 180;
    el('line', { x1: tx + Math.cos(r) * 15, y1: ty + Math.sin(r) * 15, x2: tx + Math.cos(r) * 19, y2: ty + Math.sin(r) * 19, stroke: '#6b7694', 'stroke-width': 1.2 }, tilt);
  }
  const needleBase = el('g', { transform: `translate(${tx} ${ty})` }, tilt);
  const needle = el('g', { class: 'needle' }, needleBase);
  el('line', { x1: 0, y1: 3, x2: 0, y2: -17, stroke: '#38e1c6', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, needle);
  el('circle', { cx: tx, cy: ty, r: 3.5, fill: '#e8ebf2' }, tilt);
  el('circle', { class: 'focus-ring', cx: tx, cy: ty, r: 33 }, tilt);

  // ================= labels
  const label = (x, y, txt, cls = 'g-label') => { const e = el('text', { class: cls, x, y }, svg); e.textContent = txt; };
  const logo = el('text', { x: 1030, y: 176, class: 'g-logo', 'text-anchor': 'middle' }, svg);
  logo.textContent = 'YAGCC';
  label(158, 169, 'Star power', 'g-label body'); label(100, 208, 'Plus', 'g-label body');
  label(286, 122, 'Strum', 'g-label body'); label(176, 276, 'Whammy', 'g-label body');
  label(600, 114, 'Tilt'); label(828, 222, 'Frets');

  // click-to-map: parts the caller can map get a pointer cursor and a hover outline (CSS .clickable)
  if (onPart) {
    for (const [k, g] of Object.entries(parts)) {
      if (k === 'tilt') continue;
      g.classList.add('clickable');
      g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', 'Map ' + k);
      g.addEventListener('click', () => onPart(k));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPart(k); } });
    }
  }
  const needleSet = (on) => { needle.style.transform = on ? 'rotate(-38deg)' : 'rotate(0deg)'; };

  return {
    el: svg,
    setPressed(name, on) { parts[name]?.classList.toggle('on', !!on); },
    setMapped(name, on) { parts[name]?.classList.toggle('mapped', !!on); },
    setFocus(names) { for (const [k, g] of Object.entries(parts)) g.classList.toggle('focus', names.includes(k)); },
    setWhammy(v) {
      const x = Math.min(1, Math.max(0, +v || 0));
      arm.setAttribute('transform', `translate(${px} ${py}) rotate(${(rest + sweep * x).toFixed(1)})`);
      fill.setAttribute('stroke-dasharray', `${(x * 100).toFixed(1)} 100`);
    },
    setFretColors(cols) {
      FRET_NAMES.forEach((n, i) => {
        const c = cols[i] || COLORS[n];
        const st = capGrads[n].children;
        st[0].setAttribute('stop-color', mix(c, 'white', 0.35));
        st[1].setAttribute('stop-color', c);
        st[2].setAttribute('stop-color', mix(c, 'black', 0.3));
        parts[n].style.setProperty('--c', c);
      });
    },
    setTilt(on) { needleSet(!!on); parts.tilt.classList.toggle('on', !!on); },
  };
}

// The live view: the 3D model when WebGL is available, the drawing until it has loaded (or if it can't).
export function createGuitar({ compact = false, onPart = null } = {}) {
  const g2 = createGuitar2D(onPart);
  const wrap = document.createElement('div');
  wrap.className = 'guitar-view' + (compact ? ' compact-3d' : '');
  wrap.appendChild(g2.el);
  const views = [g2];
  if (webglAvailable() && !/[?&]2d\b/.test(location.search)) {
    wrap.classList.add('loading-3d');   // keep the drawing's space but don't flash it while the model loads
    const g3 = createGuitar3D(wrap, {
      onPart,
      onReady: () => { wrap.classList.replace('loading-3d', 'is-3d'); },
      onFail: () => { wrap.classList.remove('loading-3d', 'is-3d'); },   // fall back to the drawing
    });
    views.push(g3);
  }
  const all = (fn) => (...a) => views.forEach((v) => v[fn]?.(...a));
  return {
    el: wrap,
    setPressed: all('setPressed'), setMapped: all('setMapped'), setFocus: all('setFocus'),
    setWhammy: all('setWhammy'), setFretColors: all('setFretColors'), setTilt: all('setTilt'),
  };
}
