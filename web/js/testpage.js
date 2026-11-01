// The Test page (firmware 0.42+): the live guitar on top, a generic gamepad below, and a per-mode mapping table.
import { PIN_NONE, MAP_DEFAULT, MAP_NONE, NUM_SRC, MAP_ROW, emptyMapRow, isPressed } from './protocol.js?v=dev';
import {
  SOURCES, GUITAR_PART, DEFAULT_OUT, TEST_MODES, testMode, isAnalogSrc, outName, outLabel, outFull, guitarMeaning,
  OUT_GROUPS, outputSupported, computePad,
} from './mapping.js?v=dev';
import { createPadAuto as createPad } from './gamepad3d.js?v=dev';
import { responseHtml, wireResponse, moveDots, rangeHtml, wireRange, triggerHtml, wireTrigger } from './response.js?v=dev';
import { CURVE_SRC, RANGE_SRC, stickDir } from './mapping.js?v=dev';
import { ATILT_SOURCES } from './protocol.js?v=dev';
import { createViz } from './vizcards.js?v=dev';
import { KEY_SLOTS, KEYS, KEY_PRESETS } from './protocol.js?v=dev';
import { createKeyboard, slotColor } from './kbviz.js?v=dev';
import { t } from './i18n.js?v=dev';

// ctx: { state, $, toast, pushCfg, makeViewer, liveSources(s, row, mode) }
export function createTestPage(ctx) {
  const tv = { mode: null, picked: false, sel: -1, showAll: false, pad: null, viewer: null, rows: null, last: null };
  const cfg = () => ctx.state.cfg;
  const row = (m = tv.mode) => cfg().ext.map[m];
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
  const modeName = () => testMode(tv.mode)?.name || '';
  const isKb = () => !!testMode(tv.mode)?.keyboard;

  // ---- skeleton (built once per connection; the guitar viewer is attached by the app)
  function build() {
    const host = ctx.$('#testBody');
    if (!host) return;
    if (tv.mode == null || !testMode(tv.mode)) tv.mode = defaultMode();
    tv.sel = -1; tv.last = null;
    host.innerHTML = `
      <div class="t-bar">
        <label class="t-mode"><span>${t('test.console_mode')}</span><select id="tMode" aria-label="${t('test.aria_label.console_mode')}">${TEST_MODES.map((m) => `<option value="${m.id}" ${m.id === tv.mode ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
        <span class="tag" id="tBadge"></span>
      </div>
      <div class="stage t-stage" id="testStage"></div>
      <div class="t-chips" id="tChips" aria-label="${t('test.aria_label.other_inputs')}"></div>
      <div class="t-viz">
        <div class="t-padwrap"><div class="t-pad" id="tPad"></div>
          <p class="t-hint" id="tHint" role="status"></p><p class="dim small t-padsub" id="tPadSub"></p></div>
        <div id="tCards"></div>
      </div>
      <div class="t-kb" id="tKb" style="display:none"></div>
      <div class="panel t-map">
        <div class="t-maphead"><div><h2>${t('test.what_each_input_does')}</h2><p class="dim small" id="tMapSub"></p></div>
          <div class="row t-actions">
            <button class="btn" id="tRestore" type="button"></button>
            <button class="btn" id="tCopy" type="button">${t('test.copy_this_mode_all_modes')}</button></div></div>
        <div class="t-rows" id="tRows"></div>
        <div class="t-foot"><label class="x-chk"><input type="checkbox" id="tAll">${t('test.show_inputs_that_aren_t')}</label>
          <details class="t-more"><summary>${t('test.more')}</summary><button class="btn small quiet danger" id="tRestoreAll" type="button">${t('test.restore_default_mapping_all_modes')}</button></details></div>
      </div>`;
    tv.pad = createPad(onPick);
    ctx.$('#tPad').appendChild(tv.pad.el);
    tv.viz = createViz(ctx);
    ctx.$('#tCards').appendChild(tv.viz.el);
    tv.kb = createKeyboard();
    ctx.$('#tKb').appendChild(tv.kb.el);
    ctx.$('#tMode').onchange = (e) => { tv.mode = +e.target.value; tv.picked = true; tv.sel = -1; refresh(); };
    ctx.$('#tAll').onchange = (e) => { tv.showAll = e.target.checked; renderRows(); };
    ctx.$('#tRestore').onclick = restoreMode;
    ctx.$('#tCopy').onclick = copyToAll;
    ctx.$('#tRestoreAll').onclick = restoreAll;
    ctx.$('#tRows').addEventListener('change', (e) => {
      const s = e.target.closest('select[data-src]'); if (s) assign(+s.dataset.src, +s.value);
      const k = e.target.closest('select[data-key]'); if (k) { cfg().keys[+k.dataset.key] = +k.value; ctx.pushCfg(); markPresets(); }
    });
    ctx.$('#tRows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kp]');
      if (b) { cfg().keys = KEY_PRESETS[+b.dataset.kp].keys.slice(); ctx.pushCfg(); renderKeyRows(); }
    });
    ctx.$('#tRows').addEventListener('click', (e) => {
      const n = e.target.closest('[data-pick]');
      if (n) select(tv.sel === +n.dataset.pick ? -1 : +n.dataset.pick);
    });
    refresh();
  }
  function attachViewer(v) { tv.viewer = v; }

  function refresh() {
    if (!ctx.$('#tMode') || !cfg()?.ext) return;
    ctx.$('#tMode').value = String(tv.mode);
    const kb = isKb();
    ctx.$('.t-viz').style.display = kb ? 'none' : '';
    ctx.$('#tChips').style.display = kb ? 'none' : '';
    ctx.$('#tKb').style.display = kb ? '' : 'none';
    ctx.$('.t-actions').style.display = kb ? 'none' : '';
    ctx.$('.t-foot').style.display = kb ? 'none' : '';
    ctx.$('.t-map h2').textContent = kb ? t('test.which_key_each_input_presses') : t('test.what_each_input_does');
    if (!kb) {
      tv.pad.setMode(tv.mode); if (tv.viz) tv.viz.setMode(tv.mode);
      ctx.$('#tRestore').textContent = t('test.restore_default_mapping', { mode: modeName() });
    }
    renderRows();
    hint();
  }
  const isDefaultRow = (m) => row(m).slice(0, NUM_SRC).every((v) => v === MAP_DEFAULT);

  // ---- mapping table
  function optionsFor(s) {
    const cur = row()[s], m = tv.mode;
    const defOut = DEFAULT_OUT[s];
    const defTxt = defOut == null ? t('test.mode_default_as_set_tune') : t('test.mode_default', { v: s <= 9 ? outFull(defOut, m) : outName(defOut, m) });
    const opt = (v, label, dis = false) => `<option value="${v}" ${cur === v ? 'selected' : ''} ${dis ? 'disabled' : ''}>${label}${dis ? t('test.not_this_mode') : ''}</option>`;
    let h = opt(MAP_DEFAULT, defTxt) + opt(MAP_NONE, t('common.nothing'));
    for (const g of OUT_GROUPS) h += `<optgroup label="${g.name}">${g.outs.map((o) => opt(o, outLabel(o, m) === outFull(o, m) ? outFull(o, m) : outFull(o, m), !outputSupported(m, o))).join('')}</optgroup>`;
    return h;
  }
  const resultText = (s) => {
    const v = row()[s];
    if (v === MAP_NONE) return 'sends nothing';
    const o = v === MAP_DEFAULT ? DEFAULT_OUT[s] : v;
    if (o == null) return t('test.follows_tune_page');
    return v === MAP_DEFAULT ? '' : outFull(o, tv.mode);
  };
  // "(accelerometer Y)" / "(GP27 analog)": where tilt sensor i reads from
  const sensorSrc = (i) => {
    const a = cfg().atilt?.[i], d = a && ATILT_SOURCES.find((x) => x.id === a.src);
    return d ? `(${d.kind === 'adc' ? d.name.replace(' (analog)', ' analog') : d.name.replace(/^Accelerometer/, 'accelerometer')})` : t('test.not_set_up');
  };
  // the Response control: only for an analog source mapped to an analog output (axis, half axis, trigger), firmware 0.43+
  const analogOut = (s) => { const v = row()[s], o = v === MAP_DEFAULT ? DEFAULT_OUT[s] : v; return o != null && o >= 18 && o <= 31; };
  const respFor = (s) => (ctx.fwAtLeast(43) && CURVE_SRC[s] != null && analogOut(s) && cfg().ext.curve ? responseHtml(CURVE_SRC[s], cfg().ext.curve[CURVE_SRC[s]]) : '');
  // firmware 0.44+: a tilt sensor / switch / whammy mapped to a digital output shows the sensor's Trigger point; on a stick axis or direction the 'Stick rests at' choice (applies to all modes)
  const explicitOut = (s) => { const v = row()[s]; return v >= 1 && v <= 31 ? v : null; };
  const rangeFor = (s) => { const o = explicitOut(s), d = o != null && RANGE_SRC[s] != null && cfg().ext.range ? stickDir(o) : null; return ctx.fwAtLeast(44) && d ? rangeHtml(RANGE_SRC[s], cfg().ext.range[RANGE_SRC[s]], d) : ''; };
  const trigFor = (s) => { const o = explicitOut(s); return ctx.fwAtLeast(44) && (s === 11 || s === 12) && o != null && o <= 17 && cfg().atilt?.[s - 11] ? triggerHtml(s - 11, cfg().atilt[s - 11].threshold) : ''; };
  function renderRows() {
    const box = ctx.$('#tRows');
    if (!box) return;
    if (isKb()) { renderKeyRows(); return; }
    const r = row();
    const list = SOURCES.filter((src) => tv.showAll || wired(src.id) || r[src.id] !== MAP_DEFAULT);
    ctx.$('#tMapSub').textContent = t('test.showing_what_each_input_sends', { mode: modeName(), v: tv.showAll ? '' : t('test.only_wired_inputs_are_listed') });
    const sup = (o) => outputSupported(tv.mode, o);
    box.innerHTML = list.length ? list.map((src) => {
      const s = src.id, bad = r[s] > 0 && r[s] < 32 && !sup(r[s]);
      return `<div class="mrow ${tv.sel === s ? 'sel' : ''} ${wired(s) ? '' : 'unwired'}" data-row="${s}">
        <button type="button" class="m-name" data-pick="${s}" aria-pressed="${tv.sel === s}" title="${t('test.title.pick_this_input_then_click')}">
          <span class="m-live ${src.analog ? 'bar' : ''}" data-live="${s}"><i></i></span>
          <span class="m-label"${src.color ? ` style="--c:${src.color}"` : ''}>${src.name}${s === 11 || s === 12 ? ` <small class="dim">${sensorSrc(s - 11)}</small>` : ''}${wired(s) ? '' : ` <small class="dim">${t('setup.extras.not_wired')}</small>`}</span></button>
        <select data-src="${s}" aria-label="${t('test.aria_label.output', { name: src.name, mode: modeName() })}">${optionsFor(s)}</select>
        <span class="m-res dim small">${bad ? t('test.this_mode_cannot_send_that') : resultText(s)}</span>${respFor(s)}${rangeFor(s)}${trigFor(s)}</div>`;
    }).join('') : `<p class="dim">${t('test.nothing_wired_yet_set_up')}</p>`;
    wireResponse(box, (k) => cfg().ext.curve[k], (k, c) => { cfg().ext.curve[k] = c; ctx.pushCfg(); });
    if (cfg().ext.range) wireRange(box, (k) => cfg().ext.range[k], (k, v) => { cfg().ext.range[k] = v; ctx.pushCfg(); });
    wireTrigger(box, (i) => cfg().atilt[i].threshold, (i, v) => { cfg().atilt[i].threshold = v; ctx.pushCfg(); });
    const def = isDefaultRow(tv.mode);
    ctx.$('#tRestore').disabled = def;
    ctx.$('#tRestoreAll').disabled = cfg().ext.map.every((_, m) => isDefaultRow(m));
  }

  // ---- keyboard mode: the key bindings (cfg.keys), same list as the Modes page
  const keyOpts = (sel) => Object.entries(KEYS).sort((x, y) => (+x[0] === 0 ? -1 : +y[0] === 0 ? 1 : 0))
    .map(([code, name]) => `<option value="${code}" ${+code === sel ? 'selected' : ''}>${name}</option>`).join('');
  const markPresets = () => document.querySelectorAll('#tRows [data-kp]').forEach((b) => b.classList.toggle('on', KEY_PRESETS[+b.dataset.kp].keys.every((k, j) => k === cfg().keys[j])));
  function renderKeyRows() {
    const box = ctx.$('#tRows'), keys = cfg().keys;
    ctx.$('#tMapSub').textContent = t('test.keyboard_mode_types_keys_instead');
    box.innerHTML = `<div class="seg kb-presets" role="group" aria-label="${t('test.aria_label.key_presets')}">${KEY_PRESETS.map((p, i) => `<button type="button" data-kp="${i}" title="${p.desc}">${p.name.replace(/^Fortnite Festival \u00b7 /, '')}</button>`).join('')}</div>${KEY_SLOTS.map((name, i) => `<div class="mrow" data-krow="${i}">
        <span class="m-name"><span class="m-live" data-klive="${i}"><i></i></span><span class="m-label" style="--c:${slotColor(i)}">${name}</span></span>
        <select data-key="${i}" id="tKey${i}" aria-label="${t('test.aria_label.key', { name })}">${keyOpts(keys[i])}</select><span class="m-res dim small"></span></div>`).join('')}`;
    markPresets();
  }

  // ---- selecting a source, then clicking the gamepad
  function select(s) {
    tv.sel = s;
    const part = GUITAR_PART[s];
    tv.viewer?.g.setFocus(part ? [part] : []);
    renderRows();
    hint();
  }
  function hint() {
    const h = ctx.$('#tHint'), sel = tv.sel;
    if (!h || isKb()) return;
    tv.pad?.setArmed(sel >= 0);
    h.className = 't-hint' + (sel >= 0 ? ' armed' : '');
    h.textContent = sel >= 0
      ? t('test.picked_now_click_gamepad_button', { name: SOURCES[sel].name, mode: modeName() })
      : t('test.change_something_click_input_guitar');
  }
  function onPart(name) {
    if (isKb()) return;
    const s = name === 'whammy' ? 9 : GUITAR_PART.indexOf(name);
    if (s >= 0) select(tv.sel === s ? -1 : s);
  }
  function onPick(target) {
    if (tv.sel < 0) { ctx.toast(t('test.first_pick_input_click_guitar')); return; }
    const s = tv.sel, analog = isAnalogSrc(s);
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
    if (!outputSupported(tv.mode, out)) { ctx.toast(t('test.can_t_send', { mode: modeName(), output: outName(out, tv.mode) })); return; }
    row()[s] = out;
    ctx.pushCfg();
    if (fromPad) ctx.toast(t('test.now_presses', { name: SOURCES[s].name, output: outFull(out, tv.mode), mode: modeName() }), 'ok');
    tv.sel = -1; tv.viewer?.g.setFocus([]);
    renderRows(); hint();
  }

  // ---- reset / copy
  function restoreMode() {
    if (!confirm(t('test.restore_default_mapping_every_input', { mode: modeName() }))) return;
    cfg().ext.map[tv.mode] = emptyMapRow();
    ctx.pushCfg(); ctx.toast(t('test.default_mapping_restored', { mode: modeName() }), 'ok'); refresh();
  }
  function restoreAll() {
    if (!confirm(t('test.restore_default_mapping_all_modes_2'))) return;
    cfg().ext.map = cfg().ext.map.map(() => emptyMapRow());
    ctx.pushCfg(); ctx.toast(t('test.default_mapping_restored_all_modes'), 'ok'); refresh();
  }
  function copyToAll() {
    if (!confirm(t('test.copy_mapping_all_other_modes', { mode: modeName() }))) return;
    const src = row().slice();
    cfg().ext.map = cfg().ext.map.map(() => src.slice());
    ctx.pushCfg(); ctx.toast(t('test.copied_all_modes', { mode: modeName() }), 'ok'); refresh();
  }

  // ---- live
  function update(s) {
    if (!ctx.$('#tMode') || !cfg()?.ext) return;
    if (!tv.picked && s.modeRow >= 0 && testMode(s.modeRow) && s.modeRow !== tv.mode) { tv.mode = s.modeRow; refresh(); }
    else if (!tv.picked && s.modeRow < 0 && ctx.state.info?.mode === 4 && !isKb()) { tv.mode = 4; refresh(); }   // running as a keyboard: no map row
    if (isKb()) {
      const pressed = ctx.keyLive(s);
      tv.kb.update(cfg().keys, pressed);
      document.querySelectorAll('#tRows [data-klive]').forEach((d) => d.classList.toggle('on', !!pressed[+d.dataset.klive]));
      const run = ctx.state.info?.mode === 4;
      const badge = ctx.$('#tBadge');
      badge.textContent = run ? t('test.live_from_guitar') : t('test.preview');
      badge.className = 'tag ' + (run ? t('test.live') : 'prev');
      badge.title = run ? t('test.guitar_keyboard_mode_these_are') : t('test.guitar_not_keyboard_mode_right');
      return;
    }
    const m = tv.mode, r = row(m);
    const live = ctx.liveSources(s, r, m);
    const fw = s.pad && s.modeRow === m;
    const pad = fw ? s.pad : computePad(r, live.v, live.tp, { mode: m, tiltStar: live.tiltStar, curve: cfg().ext.curve, range: cfg().ext.range });
    tv.pad.update(pad);
    tv.viz.update(pad, { mode: modeName().replace(/ \(.*\)$/, ''), live: !!fw });
    tv.pad.setLive(fw, fw ? t('test.pad_guitar_sending_right_now') : t('test.worked_out_from_inputs_guitar'));
    tv.pad.setHeader('YAGCC ' + modeName());
    const badge = ctx.$('#tBadge');
    badge.textContent = fw ? t('test.live_from_guitar') : t('test.preview');
    badge.className = 'tag ' + (fw ? t('test.live') : 'prev');
    badge.title = fw ? t('test.this_pad_guitar_sending_right') : s.modeRow >= 0 ? t('test.guitar_running_this_shows_what', { mode: testMode(s.modeRow)?.name || t('test.another_mode'), mode2: modeName() }) : t('test.this_shows_what_mode_would');
    ctx.$('#tPadSub').textContent = fw ? t('test.straight_from_guitar') : t('test.worked_out_from_inputs_guitar_2');
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
    if (e.extPins.slice(0, 4).some((p) => p !== PIN_NONE)) items.push({ k: 'dpad', name: t('test.d_pad.name'), arrows: [13, 14, 15, 16].map((i) => live.v[i] > 0.5) });
    for (const [i, n] of [[17, t('common.select')], [18, t('common.home')], [21, t('common.stick_click')], [10, t('common.tilt_switch')]]) if (wired(i)) items.push({ k: 'b' + i, name: n, on: live.v[i] > 0.5, raw: i === 10 });
    for (const i of [11, 12]) if (wired(i)) items.push({ k: 'a' + i, name: SOURCES[i].name, val: live.v[i] });
    if (wired(19) || wired(20)) items.push({ k: 'stick', name: t('test.stick.name'), x: live.v[19], y: live.v[20] });
    const sig = items.map((i) => i.k).join();
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = items.length ? items.map((i) => `<div class="t-chip" data-k="${i.k}"><span class="t-cn">${i.name}</span>${
        i.arrows ? '<span class="t-dp"><i data-a="0">▲</i><i data-a="1">▼</i><i data-a="2">◀</i><i data-a="3">▶</i></span>'
          : i.k === 'stick' ? '<span class="t-st"><i></i></span>'
          : i.k[0] === 'a' ? '<span class="t-bar"><i></i></span>' : '<span class="t-led"></span>'}</div>`).join('')
        : `<p class="dim small">${t('test.wire_d_pad_select_home')}</p>`;
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

  return { build, refresh, update, onPart, attachViewer, state: tv, select, assign };
}
