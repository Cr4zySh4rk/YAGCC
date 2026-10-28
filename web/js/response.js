// Response curve control (firmware 0.43+): a slider -100..+100, quick chips and a tiny live graph. Used by the Test page's
// mapping table and the Tune page's tilt sensor cards. The graph follows the live 0..1 value with a dot.
import { curveY } from './mapping.js?v=dev';

// ---- stick range (firmware 0.44+): where a 0..1 source rests when it drives a stick axis. k = index in ext.range (0 whammy, 1 tilt switch, 2 sensor 1, 3 sensor 2)
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// tiny stick circle: a dot where the stick rests, an arrow to where full press takes it
export function rangeSvg(v, dir) {
  const a = VEC[dir] || VEC.up, from = v ? [-a[0], -a[1]] : [0, 0], R = 11, cx = 15, cy = 15;
  const p = (q) => `${(cx + q[0] * R).toFixed(1)} ${(cy + q[1] * R).toFixed(1)}`;
  return `<svg class="rng-g" viewBox="0 0 30 30" aria-hidden="true"><circle class="rg-ring" cx="15" cy="15" r="13"/><path class="rg-arrow" d="M${p(from)}L${p(a)}"/><circle class="rg-dot" cx="${(cx + from[0] * R).toFixed(1)}" cy="${(cy + from[1] * R).toFixed(1)}" r="2.6"/><circle class="rg-end" cx="${(cx + a[0] * R).toFixed(1)}" cy="${(cy + a[1] * R).toFixed(1)}" r="1.8"/></svg>`;
}
const rangeText = (v, dir) => `${v ? OPP[dir] : 'centre'} \u2192 ${dir}`;
export function rangeHtml(k, v, dir) {
  return `<div class="rng" data-rng="${k}" data-dir="${dir}">
    <span class="resp-t">Stick rests at</span>
    <span class="seg" role="group" aria-label="Stick rests at"><button type="button" data-rv="0" class="${v ? '' : 'on'}" aria-pressed="${!v}">Centre</button><button type="button" data-rv="1" class="${v ? 'on' : ''}" aria-pressed="${!!v}">Opposite end</button></span>
    <span class="rng-fig">${rangeSvg(v, dir)}<span class="rng-t">${rangeText(v, dir)}</span></span>
    <span class="resp-n dim small">${v ? 'Rest is the opposite end; full press reaches the other end.' : 'Moves from the centre toward the chosen direction.'} Applies to all modes.</span></div>`;
}
const showRange = (n, v) => {
  const dir = n.dataset.dir;
  n.querySelectorAll('[data-rv]').forEach((b) => { const on = +b.dataset.rv === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  n.querySelector('.rng-fig').innerHTML = `${rangeSvg(v, dir)}<span class="rng-t">${rangeText(v, dir)}</span>`;
  n.querySelector('.resp-n').textContent = `${v ? 'Rest is the opposite end; full press reaches the other end.' : 'Moves from the centre toward the chosen direction.'} Applies to all modes.`;
};
// root: element holding .rng blocks; get(k) / set(k, v) read and write ext.range[k]; blocks of the same k stay in step
export function wireRange(root, get, set) {
  root.querySelectorAll('.rng').forEach((n) => {
    const k = +n.dataset.rng;
    n.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', () => {
      const v = +b.dataset.rv;
      set(k, v);
      root.querySelectorAll(`.rng[data-rng="${k}"]`).forEach((m) => showRange(m, v));
    }));
  });
}
// the sensor's trigger point (per sensor, all modes), for the Test page rows
export function triggerHtml(i, thr) {
  return `<div class="tpt" data-tpt="${i}"><span class="resp-t">Trigger point</span><input type="range" min="5" max="95" step="1" value="${thr}" aria-label="Trigger point"><output class="resp-v">${thr} %</output><span class="resp-n dim small">The tilt where it counts as pressed. Applies to all modes.</span></div>`;
}
export function wireTrigger(root, get, set) {
  root.querySelectorAll(".tpt").forEach((n) => {
    const i = +n.dataset.tpt, inp = n.querySelector('input');
    inp.value = get(i);
    inp.addEventListener('input', () => { n.querySelector('output').textContent = inp.value + ' %'; set(i, +inp.value); });
  });
}

const PTS = 24;
export const curvePath = (c) => Array.from({ length: PTS + 1 }, (_, i) => { const x = i / PTS; return `${i ? 'L' : 'M'}${(2 + x * 56).toFixed(1)} ${(38 - curveY(x, c) * 36).toFixed(1)}`; }).join('');
export const curveName = (c) => (c === 0 ? 'Linear' : c > 0 ? `Expo + ${c}` : `Expo − ${-c}`);

// k = index in ext.curve (0 whammy, 1 sensor 1, 2 sensor 2)
export function responseHtml(k, c, note = '') {
  return `<div class="resp" data-resp="${k}">
    <span class="resp-t">Response</span>
    <input type="range" min="-100" max="100" step="5" value="${c}" data-curve="${k}" aria-label="Response curve">
    <output class="resp-v" data-curve-out>${curveName(c)}</output>
    <svg class="resp-g" viewBox="0 0 60 40" aria-hidden="true"><path class="rg-diag" d="M2 38L58 2"/><path class="rg-c" d="${curvePath(c)}"/><circle class="rg-dot" r="2.6" cx="2" cy="38"/></svg>
    <span class="resp-chips"><button type="button" class="chip" data-cv="0">Linear</button><button type="button" class="chip" data-cv="50">Expo +</button><button type="button" class="chip" data-cv="-50">Expo −</button></span>
    ${note ? `<span class="resp-n dim small">${note}</span>` : ''}</div>`;
}
const show = (n, c) => {
  n.querySelector('input').value = c;
  n.querySelector('[data-curve-out]').textContent = curveName(c);
  n.querySelector('.rg-c').setAttribute('d', curvePath(c));
  n.dataset.c = c;
  n.querySelectorAll('[data-cv]').forEach((b) => b.classList.toggle('on', +b.dataset.cv === c));
};
// root: element holding .resp blocks; get(k) / set(k, c) read and write ext.curve[k]
export function wireResponse(root, get, set) {
  root.querySelectorAll('.resp').forEach((n) => {
    const k = +n.dataset.resp;
    show(n, get(k));
    n.querySelector('input').addEventListener('input', (e) => { const c = +e.target.value; show(n, c); set(k, c); });
    n.querySelectorAll('[data-cv]').forEach((b) => b.addEventListener('click', () => { const c = +b.dataset.cv; show(n, c); set(k, c); }));
  });
}
// dot follows the live raw value (0..1)
export function moveDots(root, values) {
  root.querySelectorAll('.resp').forEach((n) => {
    const v = values[+n.dataset.resp];
    if (v == null) return;
    const x = Math.max(0, Math.min(1, v)), c = +(n.dataset.c || 0);
    const d = n.querySelector('.rg-dot');
    d.setAttribute('cx', (2 + x * 56).toFixed(1)); d.setAttribute('cy', (38 - curveY(x, c) * 36).toFixed(1));
  });
}
