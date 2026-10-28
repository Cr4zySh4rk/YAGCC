// The cards next to the controller on the Test page: analog sticks (position, circularity), triggers, raw data and a rumble test.
import { outName } from './mapping.js?v=dev';
import { PIN_NONE } from './protocol.js?v=dev';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
const NB = 72;                                         // angle bins for the circularity trace

const ICON = {
  sticks: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
  trig: '<svg viewBox="0 0 24 24"><path d="M5 5l4 11 2-5 5-2z"/><path d="M14 14l5 5M4 12H2M12 4V2M7 3L6 1.5M17.5 7.5L19 6"/></svg>',
  raw: '<svg viewBox="0 0 24 24"><text x="12" y="10" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="monospace">01</text><text x="12" y="19" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="monospace">10</text></svg>',
  vib: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/></svg>',
};

// rumble patterns: [on ms, off ms, on ms, ...]; each "on" is one rumbleTest(ms) call
const PATTERNS = {
  heavy: { name: 'HEAVY', seq: [900], bars: [[0, 100, 'a']] },
  light: { name: 'LIGHT', seq: [150], bars: [[0, 45, 'b']] },
  burst: { name: 'BURST', seq: [90, 90, 90, 90, 90, 90, 90], bars: [[0, 100, 'c']] },
  pulse: { name: 'PULSE', seq: [70, 180, 70, 60, 70, 180, 250], bars: [[0, 12, 'd'], [18, 12, 'd'], [36, 20, 'd'], [64, 10, 'd']] },
};

export function createViz(ctx) {
  const root = document.createElement('div');
  root.className = 'vz-cards';
  root.innerHTML = `
    <section class="vz-card vz-green" aria-label="Analog sticks">
      <header><span class="vz-ico">${ICON.sticks}</span><div class="vz-t"><h3>Analog sticks</h3><p>Position, drift &amp; circularity</p></div>
        <button type="button" class="vz-reset" data-vz="reset" title="Reset the circularity trace" aria-label="Reset circularity">${ICON.reset}</button></header>
      <div class="vz-sticks">${['L', 'R'].map((k) => `
        <div class="vz-stick" data-side="${k}">
          <svg viewBox="-54 -54 108 108" class="vz-plot" aria-label="${k === 'L' ? 'Left' : 'Right'} stick position">
            <circle r="50" class="vz-circ"/><path class="vz-trace" d=""/><path class="vz-cross" d="M-50 0H50M0 -50V50"/><circle class="vz-pdot" r="5.5" cx="0" cy="0"/></svg>
          <div class="vz-lbl">${k === 'L' ? 'Left stick' : 'Right stick'}</div>
          <div class="vz-val mono" data-v>+0.00, +0.00</div>
          <div class="vz-err mono" data-err>Err:—</div>
        </div>`).join('')}</div>
    </section>
    <section class="vz-card vz-purple" aria-label="Triggers">
      <header><span class="vz-ico">${ICON.trig}</span><div class="vz-t"><h3>Triggers</h3><p>Analog pressure (0-1)</p></div></header>
      <div class="vz-trigs">${['L', 'R'].map((k) => `
        <div class="vz-trig" data-side="${k}"><div class="vz-bar"><i data-fill></i><b class="mono" data-v>0.00</b></div><span data-name>${k === 'L' ? 'LT' : 'RT'}</span></div>`).join('')}</div>
    </section>
    <section class="vz-card vz-blue" aria-label="Raw data">
      <header><span class="vz-ico">${ICON.raw}</span><div class="vz-t"><h3>Raw data</h3><p data-src>—</p></div><span class="vz-count mono" data-count></span></header>
      <div class="vz-sec">Axes</div>
      <div class="vz-axes">${['LX', 'LY', 'RX', 'RY', 'LT', 'RT'].map((n, i) => `
        <div class="vz-ax" data-ax="${i}" title="${n}"><span class="vz-n">${i}</span><span class="vz-ab"><i></i></span><span class="vz-av mono">+0.00</span></div>`).join('')}</div>
      <div class="vz-sec">Buttons</div>
      <div class="vz-btns">${Array.from({ length: 17 }, (_, i) => `<span class="vz-b" data-b="${i + 1}">${i + 1}</span>`).join('')}</div>
    </section>
    <section class="vz-card vz-orange" aria-label="Vibration test">
      <header><span class="vz-ico">${ICON.vib}</span><div class="vz-t"><h3>Vibration test</h3><p>Rumble motor</p></div></header>
      <div class="vz-vib" data-vib></div>
    </section>`;
  const $$ = (sel) => root.querySelectorAll(sel);
  const sticks = {};
  for (const k of ['L', 'R']) {
    const n = root.querySelector(`.vz-stick[data-side="${k}"]`);
    sticks[k] = { n, dot: n.querySelector('.vz-pdot'), val: n.querySelector('[data-v]'), err: n.querySelector('[data-err]'), trace: n.querySelector('.vz-trace'), bins: new Float32Array(NB), peak: 0 };
  }
  const resetTrace = () => { for (const s of Object.values(sticks)) { s.bins.fill(0); s.trace.setAttribute('d', ''); s.err.textContent = 'Err:—'; s.err.className = 'vz-err mono'; } };
  root.querySelector('[data-vz="reset"]').onclick = resetTrace;

  function stick(k, x, y) {
    const s = sticks[k], r = Math.hypot(x, y);
    const sc = Math.min(1, 1 / Math.max(1, r));                       // keep the dot inside the plot
    s.dot.setAttribute('cx', (x * sc * 50).toFixed(1)); s.dot.setAttribute('cy', (-y * sc * 50).toFixed(1));
    s.dot.classList.toggle('edge', r > 0.98);
    s.val.textContent = `${sgn(x)}, ${sgn(y)}`;
    if (r > 0.5) {
      const a = Math.atan2(y, x), b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * NB) % NB;
      if (r > s.bins[b]) {
        s.bins[b] = r;
        let d = '', filled = 0, sum = 0;
        for (let i = 0; i < NB; i++) if (s.bins[i] > 0) { filled++; sum += s.bins[i]; }
        const m = Math.min(1.42, 1.42);
        for (let i = 0; i < NB; i++) {
          if (!(s.bins[i] > 0)) continue;
          const an = ((i + 0.5) / NB) * 2 * Math.PI - Math.PI, rr = Math.min(s.bins[i], m) * 50;
          d += (d ? 'L' : 'M') + (Math.cos(an) * rr).toFixed(1) + ' ' + (-Math.sin(an) * rr).toFixed(1);
        }
        s.trace.setAttribute('d', d + (filled > NB * 0.9 ? 'Z' : ''));
        if (filled >= NB * 0.75) {
          const mean = sum / filled; let dev = 0;
          for (let i = 0; i < NB; i++) if (s.bins[i] > 0) dev += Math.abs(s.bins[i] - mean);
          const e = (dev / filled / mean) * 100;
          s.err.textContent = `Err:${e.toFixed(1)}%`; s.err.className = 'vz-err mono ' + (e < 8 ? 'good' : e < 15 ? 'warn' : 'bad');
        } else s.err.textContent = `Err:— (${Math.round((filled / NB) * 100)}%)`;
      }
    }
  }

  let lastSig = '', rumbling = 0;
  function vibSetup() {
    const c = ctx.state.cfg, box = root.querySelector('[data-vib]');
    const has = !!c && c.rumblePin != null && c.rumblePin !== PIN_NONE;
    const sig = has ? 'on' : 'off';
    if (sig === lastSig) return;
    lastSig = sig;
    if (!has) {
      box.innerHTML = `<div class="vz-motor off" aria-hidden="true"></div><p class="vz-note" data-note>No rumble motor wired. Pick a pin for it on the <button type="button" class="linklike" data-view-go="tune">Tune page</button> (Rumble, in the advanced options).</p>`;
      return;
    }
    box.innerHTML = `<div class="vz-motor" data-motor aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="4"/><path d="M14 14a14 14 0 0 0 0 20M34 14a14 14 0 0 1 0 20M8 8a22 22 0 0 0 0 32M40 8a22 22 0 0 1 0 32"/></svg></div>
      <div class="vz-pats">${Object.entries(PATTERNS).map(([k, p]) => `<button type="button" class="vz-pat" data-pat="${k}"><span>${p.name}</span><i class="vz-pbar ${k}">${p.bars.map(([x, w]) => `<u style="left:${x}%;width:${w}%"></u>`).join('')}</i></button>`).join('')}</div>`;
    box.querySelectorAll('[data-pat]').forEach((b) => (b.onclick = () => run(b.dataset.pat)));
  }
  async function run(k) {
    const my = ++rumbling, motor = root.querySelector('[data-motor]'), dev = ctx.state.dev;
    if (!dev) return;
    motor?.classList.add('on');
    try {
      const seq = PATTERNS[k].seq;
      for (let i = 0; i < seq.length && my === rumbling; i++) {
        if (i % 2 === 0) { await dev.rumbleTest(seq[i]); await new Promise((r) => setTimeout(r, seq[i])); }
        else await new Promise((r) => setTimeout(r, seq[i]));
      }
    } catch (e) { ctx.toast('Rumble test failed: ' + e.message, 'bad'); }
    if (my === rumbling) motor?.classList.remove('on');
  }

  const axSel = [...$$('.vz-ax')].map((n) => ({ bar: n.querySelector('.vz-ab i'), val: n.querySelector('.vz-av') }));
  const btnSel = [...$$('.vz-b')];
  return {
    el: root,
    reset: resetTrace,
    setMode(m) {
      for (const [k, o] of [['L', 7], ['R', 8]]) {
        const n = outName(o, m), alt = k === 'L' ? (n === 'LT' || n === 'ZL' ? 'L2' : 'LT') : (n === 'RT' || n === 'ZR' ? 'R2' : 'RT');
        root.querySelector(`.vz-trig[data-side="${k}"] [data-name]`).textContent = `${n} / ${alt}`;
      }
      btnSel.forEach((b, i) => (b.title = outName(i + 1, m)));
    },
    update(pad, info) {
      stick('L', pad.lx || 0, pad.ly || 0); stick('R', pad.rx || 0, pad.ry || 0);
      for (const [k, v0, bit] of [['L', pad.lt, 6], ['R', pad.rt, 7]]) {
        const v = Math.max(0, Math.min(1, v0 || 0));   // the axis already reads full for a digital LT / RT; the button bit is also set past half an analog pull, so it must not force 1
        const n = root.querySelector(`.vz-trig[data-side="${k}"]`);
        n.querySelector('[data-fill]').style.height = (v * 100).toFixed(1) + '%';
        n.querySelector('[data-v]').textContent = v.toFixed(2);
        n.classList.toggle('on', v > 0.02);
      }
      const axv = [pad.lx, pad.ly, pad.rx, pad.ry, pad.lt, pad.rt];
      axv.forEach((v0, i) => {
        const v = Math.max(-1, Math.min(1, v0 || 0)), a = axSel[i];
        a.bar.style.left = (v < 0 ? 50 + v * 50 : 50) + '%'; a.bar.style.width = Math.abs(v) * 50 + '%';
        a.val.textContent = sgn(v); a.val.parentNode.classList.toggle('on', Math.abs(v) > 0.02);
      });
      let nb = 0; btnSel.forEach((b, i) => { const on = !!(pad.buttons & (1 << i)); b.classList.toggle('on', on); nb += on; });
      root.querySelector('[data-count]').textContent = `B:17 A:6`;
      root.querySelector('[data-src]').textContent = `${info.mode} · ${info.live ? 'live' : 'preview'}`;
      root.dataset.pressed = nb;
      vibSetup();
    },
  };
}
