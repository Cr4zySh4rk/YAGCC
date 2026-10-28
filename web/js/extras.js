// Setup step "More controls" (firmware 0.42+): optional D-pad, Select, Home, stick click and an analog stick.
import { PIN_NONE, NUM_DIGITAL_PINS, EXT_PIN_NAMES, STICK_INVERT_X, STICK_INVERT_Y, STICK_SWAP, isPressed } from './protocol.js?v=dev';
import { PinDetector } from './detect.js?v=dev';

const ROW_HELP = ['Up on the D-pad', 'Down on the D-pad', 'Left on the D-pad', 'Right on the D-pad', 'A Back / Select button', 'A Home / Guide button', 'Pressing the stick in'];

// ctx: { state, $, pushCfg, assignedPins, whammyChannels(), advOn(), toast, rerender() }
export function createExtras(ctx) {
  const x = { det: null, detIdx: -1, msg: '', cal: null, recent: [[], []] };
  const ext = () => ctx.state.cfg.ext;

  function pinOptions(own) {
    const used = new Set(ctx.assignedPins());
    const opts = [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !used.has(p) || p === own);
    return `<option value="255">Not wired</option>${opts.map((p) => `<option value="${p}" ${p === own ? 'selected' : ''}>GP${p}</option>`).join('')}`;
  }
  function chanOptions(i) {
    const e = ext(), blocked = ctx.whammyChannels(), other = e.stickCh[1 - i];
    return `<option value="255">Not wired</option>${[0, 1, 2].map((ch) => {
      const why = blocked.has(ch) ? ' (used by whammy or tilt)' : ch === other ? ' (other axis)' : '';
      return `<option value="${ch}" ${e.stickCh[i] === ch ? 'selected' : ''} ${why ? 'disabled' : ''}>GP${26 + ch}${why}</option>`;
    }).join('')}`;
  }
  const stickSet = () => ext().stickCh.some((c) => c !== PIN_NONE);

  function render(card, head, nav, wireNav) {
    const e = ext(), adv = ctx.advOn();
    const rows = EXT_PIN_NAMES.map((n, i) => `<div class="x-row" data-i="${i}">
        <span class="x-live" data-live="${i}" aria-hidden="true"></span>
        <label for="xp${i}"><b>${n}</b><span class="dim small">${ROW_HELP[i]}</span></label>
        <select id="xp${i}" data-pin="${i}" aria-label="${n} pin">${pinOptions(e.extPins[i])}</select>
        <button class="btn small ${x.detIdx === i ? 'primary' : ''}" data-det="${i}">${x.detIdx === i ? 'Press it twice…' : 'Detect'}</button></div>`).join('');
    const both = e.stickCh[0] !== PIN_NONE && e.stickCh[1] !== PIN_NONE;
    const fl = e.stickFlags;
    const keep = stickSet();
    card.innerHTML = head + `
      <div class="x-sec"><h3>D-pad, Select, Home</h3>
        <p class="dim small">Buttons wired to free pins, like the frets. Each one can do something different in every console mode on the Test page.</p>
        <div class="x-rows">${rows}</div>
        <p class="bp-msg ${x.msg ? 'bad' : ''}" role="status" id="xMsg">${x.msg || ''}</p></div>
      <div class="x-sec adv ${keep ? 'adv-keep' : ''}" id="xStick"><h3>Analog stick</h3>
        <p class="dim small">A two-axis thumb stick on two of the analog pins (GP26 to GP28) that the whammy bar and tilt sensors don't use.</p>
        <div class="x-stick">
          <div class="x-fields">
            <label>Left / right (X)<select id="xsX">${chanOptions(0)}</select></label>
            <label>Up / down (Y)<select id="xsY">${chanOptions(1)}</select></label>
            <div class="x-flags" role="group" aria-label="Stick direction">
              <label class="x-chk"><input type="checkbox" id="xsInvX" ${fl & STICK_INVERT_X ? 'checked' : ''}> Flip X</label>
              <label class="x-chk"><input type="checkbox" id="xsInvY" ${fl & STICK_INVERT_Y ? 'checked' : ''}> Flip Y</label>
              <label class="x-chk"><input type="checkbox" id="xsSwap" ${fl & STICK_SWAP ? 'checked' : ''}> Swap X and Y</label></div>
            <div class="slider-row"><label for="xsDead">Dead zone</label><output class="val" id="xsDeadV">${e.deadzone} %</output>
              <input type="range" id="xsDead" min="0" max="50" step="1" value="${e.deadzone}"></div>
          </div>
          <div class="x-live-box">
            <div class="x-pad" id="xsPad" aria-hidden="true"><i id="xsDot"></i></div>
            <div class="mono small dim" id="xsRaw">–</div>
          </div></div>
        <div class="x-cal" id="xCal"></div>
      </div>
      <p class="adv-hint" ${adv || keep ? 'hidden' : ''}>More options (analog stick). <button type="button" class="linklike" data-adv-on>Turn on Advanced</button></p>
      ${nav('<button class="btn primary" id="bSkip">Continue</button>')}`;
    wireNav();
    card.querySelectorAll('[data-pin]').forEach((s) => s.addEventListener('change', () => {
      e.extPins[+s.dataset.pin] = +s.value; x.msg = ''; ctx.pushCfg(); render(card, head, nav, wireNav);
    }));
    card.querySelectorAll('[data-det]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.det;
      if (x.detIdx === i) { x.detIdx = -1; x.det = null; } else { x.detIdx = i; x.msg = ''; x.det = new PinDetector({ windowMs: 3000, minPresses: 2, exclude: ctx.assignedPins().filter((p) => p !== e.extPins[i]) }); }
      render(card, head, nav, wireNav);
    }));
    const setCh = (i, v) => { e.stickCh[i] = v; x.cal = null; ctx.pushCfg(); render(card, head, nav, wireNav); };
    card.querySelector('#xsX').onchange = (ev) => setCh(0, +ev.target.value);
    card.querySelector('#xsY').onchange = (ev) => setCh(1, +ev.target.value);
    const flag = (id, bit) => { card.querySelector(id).onchange = (ev) => { e.stickFlags = ev.target.checked ? e.stickFlags | bit : e.stickFlags & ~bit; ctx.pushCfg(); }; };
    flag('#xsInvX', STICK_INVERT_X); flag('#xsInvY', STICK_INVERT_Y); flag('#xsSwap', STICK_SWAP);
    card.querySelector('#xsDead').oninput = (ev) => { e.deadzone = +ev.target.value; card.querySelector('#xsDeadV').textContent = e.deadzone + ' %'; ctx.pushCfg(); };
    renderCal(card);
  }

  // ---- guided calibration: centre, then circles for the extremes
  function renderCal(card) {
    const box = card.querySelector('#xCal'), e = ext();
    if (!box) return;
    const both = e.stickCh[0] !== PIN_NONE && e.stickCh[1] !== PIN_NONE;
    if (!both) { box.innerHTML = '<p class="dim small">Pick both pins to calibrate.</p>'; return; }
    const c = x.cal;
    if (!c) {
      const done = e.cal.join() !== '0,2048,4095,0,2048,4095';
      box.innerHTML = `<div class="row"><button class="btn" id="xCalGo">${done ? 'Calibrate again' : 'Calibrate the stick'}</button><span class="dim small">${done ? 'Calibrated. Move the stick to check the dot.' : 'Takes ten seconds. Until then the stick assumes a perfectly centred 3.3 V thumb stick.'}</span></div>`;
      box.querySelector('#xCalGo').onclick = () => { x.cal = { phase: 'centre', mid: [2048, 2048], min: [4095, 4095], max: [0, 0], err: '' }; renderCal(card); };
      return;
    }
    if (c.phase === 'centre') {
      box.innerHTML = `<p><b>1 of 2.</b> Let go of the stick so it rests in the middle.</p><div class="row"><button class="btn primary" id="xCapMid">Capture the centre</button><button class="btn quiet" id="xCalCancel">Cancel</button></div>`;
      box.querySelector('#xCapMid').onclick = () => {
        const mean = (a) => (a.length ? Math.round(a.reduce((p, q) => p + q, 0) / a.length) : 2048);
        c.mid = [mean(x.recent[0]), mean(x.recent[1])]; c.min = c.mid.slice(); c.max = c.mid.slice(); c.phase = 'move'; c.err = ''; renderCal(card);
      };
    } else {
      box.innerHTML = `<p><b>2 of 2.</b> Push the stick all the way round its edge, a few full circles. The ranges below fill in as you go.</p>
        <div class="x-range"><span>X <b id="xrX">–</b></span><span>Y <b id="xrY">–</b></span></div>
        <p class="bp-msg bad" id="xCalErr" role="status">${c.err}</p>
        <div class="row"><button class="btn primary" id="xCalDone">Done</button><button class="btn quiet" id="xCalCancel">Cancel</button></div>`;
      box.querySelector('#xCalDone').onclick = () => {
        const span = (i) => c.max[i] - c.min[i];
        if (span(0) < 800 || span(1) < 800) { c.err = 'The stick barely moved. Circle all the way round the edge, then press Done.'; renderCal(card); return; }
        const m = c.mid.map((v, i) => Math.min(c.max[i] - 1, Math.max(c.min[i] + 1, v)));
        e.cal = [c.min[0], m[0], c.max[0], c.min[1], m[1], c.max[1]];
        x.cal = null; ctx.pushCfg(); ctx.toast('Stick calibrated', 'ok'); renderCal(card);
      };
    }
    box.querySelector('#xCalCancel')?.addEventListener('click', () => { x.cal = null; renderCal(card); });
  }

  function tick(s, card) {
    const e = ext();
    if (!e || !card) return;
    card.querySelectorAll('[data-live]').forEach((d) => d.classList.toggle('on', isPressed(s, e.extPins[+d.dataset.live])));
    // detect a pin
    if (x.det) {
      const r = x.det.feed(s);
      if (r) {
        if (r.pin !== undefined) {
          e.extPins[x.detIdx] = r.pin; x.det = null; x.detIdx = -1; x.msg = ''; ctx.pushCfg(); ctx.rerender();
        } else {
          x.msg = r.ambiguous ? `Several inputs moved at once (${r.ambiguous.map((p) => 'GP' + p).join(', ')}). Press only this one.` : `GP${r.used[0]} is used for something else. Press a different control.`;
          const m = card.querySelector('#xMsg'); if (m) { m.className = 'bp-msg bad'; m.textContent = x.msg; }
        }
      }
    }
    // stick readings
    const raw = e.stickCh.map((ch) => (ch === PIN_NONE ? null : s.adc[ch]));
    raw.forEach((v, i) => { if (v == null) return; const a = x.recent[i]; a.push(v); if (a.length > 8) a.shift(); });
    const dot = card.querySelector('#xsDot');
    if (dot) {
      let px = 0, py = 0;
      if (x.cal && x.cal.phase === 'move') {
        raw.forEach((v, i) => { if (v != null) { x.cal.min[i] = Math.min(x.cal.min[i], v); x.cal.max[i] = Math.max(x.cal.max[i], v); } });
        const n = (i) => (raw[i] == null ? 0 : Math.max(-1, Math.min(1, raw[i] >= x.cal.mid[i] ? (raw[i] - x.cal.mid[i]) / Math.max(1, x.cal.max[i] - x.cal.mid[i]) : (raw[i] - x.cal.mid[i]) / Math.max(1, x.cal.mid[i] - x.cal.min[i]))));
        px = n(0); py = -n(1);
        const set = (id, i) => { const el = card.querySelector(id); if (el) el.textContent = `${x.cal.min[i]} to ${x.cal.max[i]}`; };
        set('#xrX', 0); set('#xrY', 1);
      } else if (s.stick) { px = s.stick[0]; py = -s.stick[1]; }   // status Y+ is up
      dot.style.left = (50 + px * 42) + '%'; dot.style.top = (50 + py * 42) + '%';
      const rw = card.querySelector('#xsRaw');
      if (rw) rw.textContent = raw.every((v) => v == null) ? 'Not wired' : `raw ${raw[0] ?? '–'} · ${raw[1] ?? '–'}`;
    }
  }
  return { render, tick, reset() { x.det = null; x.detIdx = -1; x.cal = null; x.msg = ''; } };
}
