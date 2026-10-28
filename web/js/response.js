// Response curve control (firmware 0.43+): a slider -100..+100, quick chips and a tiny live graph. Used by the Test page's
// mapping table and the Tune page's tilt sensor cards. The graph follows the live 0..1 value with a dot.
import { curveY } from './mapping.js?v=dev';

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
