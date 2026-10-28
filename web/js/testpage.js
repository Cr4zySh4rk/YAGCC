// The Test page (firmware 0.42+): the live guitar on top, a generic gamepad below, and a per-mode mapping table.
import { PIN_NONE, MAP_DEFAULT, MAP_NONE, NUM_SRC, MAP_ROW, emptyMapRow, isPressed } from './protocol.js?v=dev';
import {
  SOURCES, GUITAR_PART, DEFAULT_OUT, TEST_MODES, testMode, isAnalogSrc, outName, outLabel, outFull, guitarMeaning,
  OUT_GROUPS, outputSupported, computePad,
} from './mapping.js?v=dev';
import { createPad } from './gamepad.js?v=dev';
import { responseHtml, wireResponse, moveDots } from './response.js?v=dev';
import { CURVE_SRC } from './mapping.js?v=dev';
import { ATILT_SOURCES } from './protocol.js?v=dev';
import { createViz } from './vizcards.js?v=dev';

// ctx: { state, $, toast, pushCfg, makeViewer, liveSources(s, row, mode) }
export function createTestPage(ctx) {
  const t = { mode: null, picked: false, sel: -1, showAll: false, pad: null, viewer: null, rows: null, last: null };
  const cfg = () => ctx.state.cfg;
  const row = (m = t.mode) => cfg().ext.map[m];
  const wired = (s) => {
    const c = cfg(), e = c.ext;
    if (s <= 8) return c.pins[s] !== PIN_NONE;
    if (s === 9) return c.whammyCh !== PIN_NONE;
    if (s === 10) return c.tiltEnabled && c.tiltPin !== PIN_NONE;
    if (s === 11 || s === 12) return !!c.atilt && c.atilt[s - 11].src !== PIN_NONE;
    if (s <= 18) return e.extPins[s - 13] !== PIN_NONE;
    if (s === 19 || s === 20) return e.stickCh[s - 19] !== PIN_NONE;
    return e.extPins[6] !== PIN_NONE;
  };
  const defaultMode = () => {
    const s = ctx.state.status, info = ctx.state.info;
    const run = s && s.modeRow >= 0 ? s.modeRow : info?.mode;
    return testMode(run) ? run : TEST_MODES[0].id;
  };
  const modeName = () => testMode(t.mode)?.name || '';

  // ---- skeleton (built once per connection; the guitar viewer is attached by the app)
  function build() {
    const host = ctx.$('#testBody');
    if (!host) return;
    if (t.mode == null || !testMode(t.mode)) t.mode = defaultMode();
    t.sel = -1; t.last = null;
    host.innerHTML = `
      <div class="t-bar">
        <label class="t-mode"><span>Console mode</span><select id="tMode" aria-label="Console mode">${TEST_MODES.map((m) => `<option value="${m.id}" ${m.id === t.mode ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
        <span class="tag" id="tBadge"></span>
      </div>
      <div class="stage t-stage" id="testStage"></div>
      <div class="t-chips" id="tChips" aria-label="Other inputs"></div>
      <div class="t-viz">
        <div class="t-padwrap"><div class="t-pad" id="tPad"></div>
          <p class="t-hint" id="tHint" role="status"></p><p class="dim small t-padsub" id="tPadSub"></p></div>
        <div id="tCards"></div>
      </div>
      <div class="panel t-map">
        <div class="t-maphead"><div><h2>What each input does</h2><p class="dim small" id="tMapSub"></p></div>
          <div class="row t-actions">
            <button class="btn" id="tRestore" type="button"></button>
            <button class="btn" id="tCopy" type="button">Copy this mode to all modes</button></div></div>
        <div class="t-rows" id="tRows"></div>
        <div class="t-foot"><label class="x-chk"><input type="checkbox" id="tAll"> Show inputs that aren't wired</label>
          <details class="t-more"><summary>More</summary><button class="btn small quiet danger" id="tRestoreAll" type="button">Restore default mapping for all modes</button></details></div>
      </div>`;
    t.pad = createPad(onPick);
    ctx.$('#tPad').appendChild(t.pad.el);
    t.viz = createViz(ctx);
    ctx.$('#tCards').appendChild(t.viz.el);
    ctx.$('#tMode').onchange = (e) => { t.mode = +e.target.value; t.picked = true; t.sel = -1; refresh(); };
    ctx.$('#tAll').onchange = (e) => { t.showAll = e.target.checked; renderRows(); };
    ctx.$('#tRestore').onclick = restoreMode;
    ctx.$('#tCopy').onclick = copyToAll;
    ctx.$('#tRestoreAll').onclick = restoreAll;
    ctx.$('#tRows').addEventListener('change', (e) => { const s = e.target.closest('select[data-src]'); if (s) assign(+s.dataset.src, +s.value); });
    ctx.$('#tRows').addEventListener('click', (e) => {
      const n = e.target.closest('[data-pick]');
      if (n) select(t.sel === +n.dataset.pick ? -1 : +n.dataset.pick);
    });
    refresh();
  }
  function attachViewer(v) { t.viewer = v; }

  function refresh() {
    if (!ctx.$('#tMode') || !cfg()?.ext) return;
    ctx.$('#tMode').value = String(t.mode);
    t.pad.setMode(t.mode); if (t.viz) t.viz.setMode(t.mode);
    ctx.$('#tRestore').textContent = `Restore default mapping for ${modeName()}`;
    renderRows();
    hint();
  }
  const isDefaultRow = (m) => row(m).slice(0, NUM_SRC).every((v) => v === MAP_DEFAULT);

  // ---- mapping table
  function optionsFor(s) {
    const cur = row()[s], m = t.mode;
    const defOut = DEFAULT_OUT[s];
    const defTxt = defOut == null ? 'Mode default: as set on the Tune page' : `Mode default: ${s <= 9 ? outFull(defOut, m) : outName(defOut, m)}`;
    const opt = (v, label, dis = false) => `<option value="${v}" ${cur === v ? 'selected' : ''} ${dis ? 'disabled' : ''}>${label}${dis ? ' (not in this mode)' : ''}</option>`;
    let h = opt(MAP_DEFAULT, defTxt) + opt(MAP_NONE, 'Nothing');
    for (const g of OUT_GROUPS) h += `<optgroup label="${g.name}">${g.outs.map((o) => opt(o, outLabel(o, m) === outFull(o, m) ? outFull(o, m) : outFull(o, m), !outputSupported(m, o))).join('')}</optgroup>`;
    return h;
  }
  const resultText = (s) => {
    const v = row()[s];
    if (v === MAP_NONE) return 'sends nothing';
    const o = v === MAP_DEFAULT ? DEFAULT_OUT[s] : v;
    if (o == null) return 'follows the Tune page';
    return v === MAP_DEFAULT ? '' : outFull(o, t.mode);
  };
  // "(accelerometer Y)" / "(GP27 analog)": where tilt sensor i reads from
  const sensorSrc = (i) => {
    const a = cfg().atilt?.[i], d = a && ATILT_SOURCES.find((x) => x.id === a.src);
    return d ? `(${d.kind === 'adc' ? d.name.replace(' (analog)', ' analog') : d.name.replace(/^Accelerometer/, 'accelerometer')})` : '(not set up)';
  };
  // the Response control: only for an analog source mapped to an analog output (axis, half axis, trigger), firmware 0.43+
  const analogOut = (s) => { const v = row()[s], o = v === MAP_DEFAULT ? DEFAULT_OUT[s] : v; return o != null && o >= 18 && o <= 31; };
  const respFor = (s) => (ctx.fwAtLeast(43) && CURVE_SRC[s] != null && analogOut(s) && cfg().ext.curve ? responseHtml(CURVE_SRC[s], cfg().ext.curve[CURVE_SRC[s]]) : '');
  function renderRows() {
    const box = ctx.$('#tRows');
    if (!box) return;
    const r = row();
    const list = SOURCES.filter((src) => t.showAll || wired(src.id) || r[src.id] !== MAP_DEFAULT);
    ctx.$('#tMapSub').textContent = `Showing what each input sends in ${modeName()}.` + (t.showAll ? '' : ' Only wired inputs are listed.');
    const sup = (o) => outputSupported(t.mode, o);
    box.innerHTML = list.length ? list.map((src) => {
      const s = src.id, bad = r[s] > 0 && r[s] < 32 && !sup(r[s]);
      return `<div class="mrow ${t.sel === s ? 'sel' : ''} ${wired(s) ? '' : 'unwired'}" data-row="${s}">
        <button type="button" class="m-name" data-pick="${s}" aria-pressed="${t.sel === s}" title="Pick this input, then click a button on the gamepad above">
          <span class="m-live ${src.analog ? 'bar' : ''}" data-live="${s}"><i></i></span>
          <span class="m-label"${src.color ? ` style="--c:${src.color}"` : ''}>${src.name}${s === 11 || s === 12 ? ` <small class="dim">${sensorSrc(s - 11)}</small>` : ''}${wired(s) ? '' : ' <small class="dim">not wired</small>'}</span></button>
        <select data-src="${s}" aria-label="${src.name} output in ${modeName()}">${optionsFor(s)}</select>
        <span class="m-res dim small">${bad ? 'this mode cannot send that' : resultText(s)}</span>${respFor(s)}</div>`;
    }).join('') : '<p class="dim">Nothing is wired yet. Set up buttons first, or tick the box below to see every input.</p>';
    wireResponse(box, (k) => cfg().ext.curve[k], (k, c) => { cfg().ext.curve[k] = c; ctx.pushCfg(); });
    const def = isDefaultRow(t.mode);
    ctx.$('#tRestore').disabled = def;
    ctx.$('#tRestoreAll').disabled = cfg().ext.map.every((_, m) => isDefaultRow(m));
  }

  // ---- selecting a source, then clicking the gamepad
  function select(s) {
    t.sel = s;
    const part = GUITAR_PART[s];
    t.viewer?.g.setFocus(part ? [part] : []);
    renderRows();
    hint();
  }
  function hint() {
    const h = ctx.$('#tHint'), sel = t.sel;
    if (!h) return;
    t.pad?.setArmed(sel >= 0);
    h.className = 't-hint' + (sel >= 0 ? ' armed' : '');
    h.textContent = sel >= 0
      ? `${SOURCES[sel].name} is picked. Now click the gamepad button, trigger or stick direction you want it to press in ${modeName()}.`
      : 'To change something, click an input on the guitar or in the list below, then click what it should press on the gamepad.';
  }
  function onPart(name) {
    const s = name === 'whammy' ? 9 : GUITAR_PART.indexOf(name);
    if (s >= 0) select(t.sel === s ? -1 : s);
  }
  function onPick(target) {
    if (t.sel < 0) { ctx.toast('First pick an input: click it on the guitar or in the list.'); return; }
    const s = t.sel, analog = isAnalogSrc(s);
    let out;
    if (target.out) out = target.out;
    else if (target.trigger) out = (analog ? 22 : 7) + (target.trigger === 'R' ? 1 : 0);
    else {
      const horiz = target.dir === 'left' || target.dir === 'right', right = target.stick === 'R';
      if (analog) out = horiz ? (right ? 20 : 18) : (right ? 21 : 19);
      else out = (right ? 28 : 24) + (target.dir === 'left' ? 0 : target.dir === 'right' ? 1 : target.dir === 'down' ? 2 : 3);
    }
    assign(s, out, true);
  }
  function assign(s, out, fromPad = false) {
    if (!outputSupported(t.mode, out)) { ctx.toast(`${modeName()} can't send ${outName(out, t.mode)}.`); return; }
    row()[s] = out;
    ctx.pushCfg();
    if (fromPad) ctx.toast(`${SOURCES[s].name} now presses ${outFull(out, t.mode)} in ${modeName()}`, 'ok');
    t.sel = -1; t.viewer?.g.setFocus([]);
    renderRows(); hint();
  }

  // ---- reset / copy
  function restoreMode() {
    if (!confirm(`Restore the default mapping for ${modeName()}? Every input goes back to what it normally does in this mode. The other modes are not touched.`)) return;
    cfg().ext.map[t.mode] = emptyMapRow();
    ctx.pushCfg(); ctx.toast(`Default mapping restored for ${modeName()}`, 'ok'); refresh();
  }
  function restoreAll() {
    if (!confirm('Restore the default mapping for ALL modes? Every custom mapping on the guitar is wiped.')) return;
    cfg().ext.map = cfg().ext.map.map(() => emptyMapRow());
    ctx.pushCfg(); ctx.toast('Default mapping restored for all modes', 'ok'); refresh();
  }
  function copyToAll() {
    if (!confirm(`Copy the mapping of ${modeName()} to all other modes? Their own mappings are replaced.`)) return;
    const src = row().slice();
    cfg().ext.map = cfg().ext.map.map(() => src.slice());
    ctx.pushCfg(); ctx.toast(`Copied ${modeName()} to all modes`, 'ok'); refresh();
  }

  // ---- live
  function update(s) {
    if (!ctx.$('#tMode') || !cfg()?.ext) return;
    if (!t.picked && s.modeRow >= 0 && testMode(s.modeRow) && s.modeRow !== t.mode) { t.mode = s.modeRow; refresh(); }
    const m = t.mode, r = row(m);
    const live = ctx.liveSources(s, r, m);
    const fw = s.pad && s.modeRow === m;
    const pad = fw ? s.pad : computePad(r, live.v, live.tp, { mode: m, tiltStar: live.tiltStar, curve: cfg().ext.curve });
    t.pad.update(pad);
    t.viz.update(pad, { mode: modeName().replace(/ \(.*\)$/, ''), live: !!fw });
    t.pad.setLive(fw, fw ? 'The pad the guitar is sending right now in this mode.' : 'Worked out from your inputs; the guitar is not in this mode.');
    t.pad.setHeader('YAGCC ' + modeName());
    const badge = ctx.$('#tBadge');
    badge.textContent = fw ? 'Live from the guitar' : 'Preview';
    badge.className = 'tag ' + (fw ? 'live' : 'prev');
    badge.title = fw ? 'This is the pad the guitar is sending right now in this mode.' : s.modeRow >= 0 ? `The guitar is running in ${testMode(s.modeRow)?.name || 'another mode'}. This shows what ${modeName()} would send.` : 'This shows what the mode would send.';
    ctx.$('#tPadSub').textContent = fw ? 'Straight from the guitar' : 'Worked out from your inputs (the guitar is not in this mode)';
    document.querySelectorAll('#tRows [data-live]').forEach((d) => {
      const i = +d.dataset.live, v = live.v[i];
      if (isAnalogSrc(i)) { d.firstElementChild.style.width = (Math.min(1, Math.abs(v)) * 100).toFixed(0) + '%'; d.classList.toggle('on', Math.abs(v) > 0.5); }
      else d.classList.toggle('on', v > 0.5);
    });
    moveDots(ctx.$('#tRows'), { 0: live.v[9], 1: live.v[11], 2: live.v[12] });
    chips(s, live);
  }
  function chips(s, live) {
    const box = ctx.$('#tChips');
    if (!box) return;
    const c = cfg(), e = c.ext;
    const items = [];
    if (e.extPins.slice(0, 4).some((p) => p !== PIN_NONE)) items.push({ k: 'dpad', name: 'D-pad', arrows: [13, 14, 15, 16].map((i) => live.v[i] > 0.5) });
    for (const [i, n] of [[17, 'Select'], [18, 'Home'], [21, 'Stick click'], [10, 'Tilt switch']]) if (wired(i)) items.push({ k: 'b' + i, name: n, on: live.v[i] > 0.5, raw: i === 10 });
    for (const i of [11, 12]) if (wired(i)) items.push({ k: 'a' + i, name: SOURCES[i].name, val: live.v[i] });
    if (wired(19) || wired(20)) items.push({ k: 'stick', name: 'Stick', x: live.v[19], y: live.v[20] });
    const sig = items.map((i) => i.k).join();
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = items.length ? items.map((i) => `<div class="t-chip" data-k="${i.k}"><span class="t-cn">${i.name}</span>${
        i.arrows ? '<span class="t-dp"><i data-a="0">▲</i><i data-a="1">▼</i><i data-a="2">◀</i><i data-a="3">▶</i></span>'
          : i.k === 'stick' ? '<span class="t-st"><i></i></span>'
          : i.k[0] === 'a' ? '<span class="t-bar"><i></i></span>' : '<span class="t-led"></span>'}</div>`).join('')
        : '<p class="dim small">Wire a D-pad, Select, Home or a stick (Setup, More controls) and it shows up here.</p>';
    }
    for (const i of items) {
      const n = box.querySelector(`[data-k="${i.k}"]`);
      if (!n) continue;
      if (i.arrows) n.querySelectorAll('[data-a]').forEach((a) => a.classList.toggle('on', i.arrows[+a.dataset.a]));
      else if (i.k === 'stick') { const d = n.querySelector('i'); d.style.left = (50 + i.x * 40) + '%'; d.style.top = (50 - i.y * 40) + '%'; n.classList.toggle('on', Math.hypot(i.x, i.y) > 0.1); }
      else if (i.k[0] === 'a') { n.querySelector('i').style.width = (Math.min(1, i.val) * 100).toFixed(0) + '%'; n.classList.toggle('on', i.val > 0.5); }
      else n.classList.toggle('on', i.on);
    }
  }

  return { build, refresh, update, onPart, attachViewer, state: t, select, assign };
}
