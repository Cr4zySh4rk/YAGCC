// Lights page: "Extra LEDs" card (firmware 0.56+): neck, star power button, plus / select button and body edge LED zones.
// Settings live in cfg.ext.xzones / cfg.ext.xledPins (see protocol.js). The card redraws on structural changes and only
// updates labels while a slider or colour is dragged.
import { LED_TYPES, LED_ORDERS, xchainApa, PIN_NONE, NUM_DIGITAL_PINS, NUM_XLED_PINS, NUM_XZONES, MAX_CHAIN_LEDS, XZONE_MAX, XZONE_NAMES, XZONE_DESCS, XEFFECTS, ZX_REVERSE, ZX_STAR,
  rgbToHex, hexToRgb, emptyXzone, xzoneOn, xzoneLed, xledErrors, xledChains, xledAutoStart, mainChainUsers, xledTotal, maxBrightness, ledOverdrive, strumChainOf, applyLedLayout, ledLayout } from './protocol.js?v=dev';
import { t } from './i18n.js?v=dev';

const DEFAULT_COUNT = [4, 1, 1, 10];
const SID = NUM_XZONES;   // id of the strum LEDs among the blocks that share a data pin (firmware 0.57: they may leave the main chain)
const manual = new Set();   // zones whose start was typed by hand (Advanced): the packer leaves them where they are until Re-pack
const zname = (id) => (id === SID ? t('common.strum_bar_leds') : XZONE_NAMES[id]);

// ---- blocks on a chain: the zones, and the strum LEDs when they sit on an extra chain
const blockChain = (c, id) => (id === SID ? strumChainOf(c) : c.ext.xzones[id].chain);
const blockCount = (c, id) => (id === SID ? c.strumLeds || 0 : c.ext.xzones[id].count);
const blockStart = (c, id) => (id === SID ? Math.min(...c.strumMap.slice(0, c.strumLeds)) : c.ext.xzones[id].start);
const blockOn = (c, id) => (id === SID ? strumChainOf(c) > 0 : xzoneOn(c.ext.xzones[id]));
// strum LEDs keep their order along the wire (their roles go with them); only the first position moves
function setBlockStart(c, id, p) {
  if (id !== SID) { c.ext.xzones[id].start = p; return; }
  const n = c.strumLeds || 0;
  [...Array(n).keys()].sort((a, b) => c.strumMap[a] - c.strumMap[b]).forEach((k, j) => { c.strumMap[k] = p + j; });
}
const onChainOf = (c, ch) => {
  const ids = c.ext.xzones.map((zn, z) => z).filter((z) => xzoneOn(c.ext.xzones[z]) && c.ext.xzones[z].chain === ch);
  if (ch > 0 && strumChainOf(c) === ch) ids.push(SID);
  return ids;
};
const byStartOf = (c, ch) => onChainOf(c, ch).sort((x, y) => blockStart(c, x) - blockStart(c, y) || x - y);
// extra data pins nothing uses any more are released
function gcPinsOf(c) {
  const e = c.ext;
  for (let i = 0; i < NUM_XLED_PINS; i++) if (!onChainOf(c, i + 1).length) { e.xledPins[i] = PIN_NONE; e.xledClk[i] = PIN_NONE; e.xledType[i] = 0; e.xledOrder[i] = 0; }
}
// pack the blocks of one chain back to back in their order (default: by current position), around the fret / strum LEDs and any manual zones
function repackChain(c, ch, order = byStartOf(c, ch)) {
  const occ = Array(MAX_CHAIN_LEDS).fill(false);
  const mark = (p, n) => { for (let k = 0; k < n; k++) if (p + k >= 0 && p + k < MAX_CHAIN_LEDS) occ[p + k] = true; };
  if (ch === 0) mainChainUsers(c).forEach((u) => mark(u.pos, 1));
  onChainOf(c, ch).filter((id) => id !== SID && manual.has(id)).forEach((id) => mark(blockStart(c, id), blockCount(c, id)));
  let cur = 0;
  for (const id of order) {
    if ((id !== SID && manual.has(id)) || !blockOn(c, id)) continue;
    const n = blockCount(c, id);
    let p = cur;
    while (p + n <= MAX_CHAIN_LEDS && occ.slice(p, p + n).some(Boolean)) p++;
    if (p + n > MAX_CHAIN_LEDS) continue;   // does not fit: the error message says so
    setBlockStart(c, id, p); mark(p, n); cur = p + n;
  }
}
// the chain for a data pin choice: 'main' = 0, else the extra chain on that GPIO (it takes a free slot if the pin is new; 0 when there is none)
function chainForPin(c, v) {
  if (v === 'main') return 0;
  const e = c.ext, p = +v;
  let i = e.xledPins.indexOf(p);
  if (i < 0) { i = e.xledPins.indexOf(PIN_NONE); if (i >= 0) e.xledPins[i] = p; }
  return i >= 0 ? i + 1 : 0;
}
// firmware 0.57: put the strum LEDs on the main chain ('main') or on an extra data pin (a GPIO number)
function setStrumChainPin(c, v) {
  const e = c.ext, old = strumChainOf(c);
  e.strumChain = 0; gcPinsOf(c);   // leave the old chain (an extra pin nobody else uses is released)
  e.strumChain = chainForPin(c, v);
  gcPinsOf(c);
  const l = ledLayout(c), nw = strumChainOf(c);
  applyLedLayout(c, { frets: l.frets, strum: l.strum, strumFirst: false, per: l.per });   // frets close up behind / the strum LEDs go behind the frets again
  if (nw) setBlockStart(c, SID, 200);   // last in line on their new chain, then packed
  if (old) repackChain(c, old);
  if (nw) repackChain(c, nw);
  if (!old || !nw) repackChain(c, 0);   // the zones on the main chain flow around the new fret / strum LED positions
}
// the Lights page changed the LED layout (count, per fret ...): keep the strum LEDs packed on their extra chain, release a pin they left
export function fitStrumChain(c) {
  if (!c.ext?.xzones) return;
  gcPinsOf(c);
  const sx = strumChainOf(c);
  if (sx) repackChain(c, sx);
}
const ANIMATED = new Set([2, 3, 4, 6, 8]);   // effects that use the speed slider
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FRET_CELL = '#7d89a8', STRUM_CELL = '#b59b5a';

// ctx: { state, $, fwAtLeast, advOn, live, pushCfg, assignedPins(), test(pos, chain), active() }
export function createXled(ctx) {
  const { state, $ } = ctx;
  const body = $('#xledBody');
  let findRun = 0, finding = -1, findMsg = '';

  const ok = () => ctx.fwAtLeast(56) && !!state.cfg?.ext?.xzones;
  const ext = () => state.cfg.ext;
  const textOn = (hex) => { const [r, g, b] = hexToRgb(hex); return r * 0.3 + g * 0.59 + b * 0.11 > 150 ? '#10131a' : '#fff'; };
  const gcPins = () => gcPinsOf(state.cfg);
  const onChain = (ch) => onChainOf(state.cfg, ch);
  const byStart = (ch) => byStartOf(state.cfg, ch);
  const repack = (ch, order) => repackChain(state.cfg, ch, order);
  function setOn(z, on) {
    const zn = ext().xzones[z], old = zn.chain;
    manual.delete(z);
    if (on) {
      if (zn.effect === 0 && !zn.color.some(Boolean)) Object.assign(zn, emptyXzone(z), { count: 0 });
      zn.count = Math.min(XZONE_MAX[z], zn.count || DEFAULT_COUNT[z]);
      zn.chain = 0; zn.start = 1000;   // last in line, then packed
      repack(0);
    } else { zn.count = 0; zn.chain = 0; zn.start = 0; gcPins(); repack(old); }
    gcPins();
  }
  // data pin choice for zone z: 'main' or a GPIO number
  function setPin(z, v) {
    const e = ext(), zn = e.xzones[z], old = zn.chain;
    manual.delete(z);
    zn.start = 1000; zn.chain = 0; gcPins();   // leaves the old chain (an extra pin nobody else uses is released)
    zn.chain = chainForPin(state.cfg, v);
    zn.start = 1000;
    gcPins();
    repack(old); repack(zn.chain);
  }
  function move(id, dir) {
    const ch = blockChain(state.cfg, id), ord = byStart(ch), i = ord.indexOf(id), j = i + dir;
    // swap with the neighbouring block (on the main chain the fret / strum blocks stay where they are)
    if (j < 0 || j >= ord.length) return;
    [ord[i], ord[j]] = [ord[j], ord[i]];
    manual.delete(id); manual.delete(ord[i]);
    repack(ch, ord);
  }

  // ---- drawing
  // the data pin choices for a block (a zone, or SID = the strum LEDs): the main chain's pin or any free GPIO
  function pinOptions(id) {
    const c = state.cfg, e = ext(), chain = blockChain(c, id);
    const taken = new Set(ctx.assignedPins().filter((p) => !e.xledPins.includes(p) || p === PIN_NONE));
    const cur = chain > 0 ? e.xledPins[chain - 1] : 'main';
    const sole = chain > 0 && onChain(chain).length === 1;   // this block's own pin slot can be re-used
    const full = !e.xledPins.includes(PIN_NONE) && !sole;
    const own = (p) => e.xledPins.includes(p) && p !== PIN_NONE;
    const opts = [`<option value="main" ${cur === 'main' ? 'selected' : ''}>${esc(c.rgbPin === PIN_NONE ? t('lights.xled.pin_same_none') : t('lights.xled.pin_same', { pin: c.rgbPin }))}</option>`];
    for (let p = 0; p < NUM_DIGITAL_PINS; p++) {
      if (p === c.rgbPin || (c.ledType === 2 && p === c.ledClkPin) || (taken.has(p) && !own(p)) || e.xledClk.includes(p)) continue;
      const blocked = !own(p) && full;   // a fourth pin: no chain left
      opts.push(`<option value="${p}" ${cur === p ? 'selected' : ''} ${blocked && cur !== p ? 'disabled' : ''}>GP${p}</option>`);
    }
    return opts.join('');
  }
  function zoneHtml(z, errs) {
    const c = state.cfg, e = ext(), zn = e.xzones[z], on = xzoneOn(zn), name = XZONE_NAMES[z], off = !ok();
    const grp = z === 1 ? `<div class="xz-group"><h3>${esc(t('lights.xled.group.buttons.name'))}</h3><p class="dim">${esc(t('lights.xled.group.buttons.desc'))}</p></div>` : '';
    const head = `${grp}<div class="opt xz-head ${z === 0 ? 'first' : ''} ${z === 1 || z === 2 ? 'xz-sub' : ''}"><div><h3>${esc(name)}</h3><p class="dim">${esc(XZONE_DESCS[z])}${on && !errs.length ? ` <span class="xz-where">${esc(t('lights.xled.where', { from: zn.start + 1, to: zn.start + zn.count }))}</span>` : ''}</p></div>
      <span class="row xz-btns">${on ? `<button type="button" class="btn small" data-z="${z}" data-k="find" title="${esc(t('lights.xled.find_title'))}" ${errs.length || !c.rgbEnabled ? 'disabled' : ''}>${esc(finding === z ? findMsg : t('lights.xled.find'))}</button>` : ''}
      <label class="switch"><input type="checkbox" data-z="${z}" data-k="on" ${on ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="${esc(name)}"><i></i></label></span></div>`;
    if (!on) return `<div class="xz" data-zone="${z}">${head}</div>`;
    const fx = XEFFECTS.find((x) => x.id === zn.effect) || XEFFECTS[0];
    const hex = rgbToHex(...zn.color);
    const keep = zn.chain > 0 || (zn.flags & ZX_REVERSE) || errs.length || manual.has(z);
    const row = (label, inner, cls = '') => `<div class="xz-row ${cls}"><label>${label}</label><div class="xz-ctl">${inner}</div></div>`;
    return `<div class="xz on" data-zone="${z}">${head}
      <div class="xz-body">
        ${row(esc(t('lights.xled.count')), `<input type="number" data-z="${z}" data-k="count" min="1" max="${XZONE_MAX[z]}" step="1" value="${zn.count}" aria-label="${esc(t('lights.xled.count'))}">`)}
        ${row(esc(t('lights.xled.effect')), `<select data-z="${z}" data-k="effect" aria-label="${esc(t('lights.xled.effect'))}">${XEFFECTS.map((x) => `<option value="${x.id}" ${x.id === zn.effect ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}
        <p class="dim small xz-desc">${esc(fx.desc)}</p>
        ${zn.effect === 3 ? '' : row(esc(t('lights.studio.colour')), `<input type="color" data-z="${z}" data-k="color" value="${hex}" aria-label="${esc(t('lights.studio.colour'))}"><span class="hex" data-hex="${z}">${hex.toUpperCase()}</span>`, 'xz-col')}
        ${ANIMATED.has(zn.effect) ? `<div class="xz-slider"><label for="xzs${z}">${esc(t('lights.studio.speed'))}</label><input type="range" id="xzs${z}" data-z="${z}" data-k="speed" min="0" max="255" step="1" value="${zn.speed}"></div>` : ''}
        <div class="xz-slider"><label for="xzl${z}">${esc(t('common.brightness'))}</label><output data-lvl="${z}">${zn.level}%</output><input type="range" id="xzl${z}" data-z="${z}" data-k="level" min="1" max="100" step="1" value="${zn.level}"></div>
        <div class="xz-row"><label for="xzf${z}">${esc(t('lights.xled.follow_star'))}</label><label class="switch"><input type="checkbox" id="xzf${z}" data-z="${z}" data-k="star" ${zn.flags & ZX_STAR ? 'checked' : ''}><i></i></label></div>
        <div class="xz-adv adv ${keep ? 'adv-keep' : ''}">
          ${row(esc(t('lights.data_pin')), `<select data-z="${z}" data-k="pin" aria-label="${esc(t('lights.data_pin'))}" >${pinOptions(z)}</select>`)}
          ${row(esc(t('lights.xled.position')), `${manual.has(z) ? `<span class="tag">${esc(t('lights.xled.manual'))}</span><button type="button" class="btn small" data-z="${z}" data-k="repack" title="${esc(t('lights.xled.repack_title'))}">${esc(t('lights.xled.repack'))}</button>` : ''}<input type="number" data-z="${z}" data-k="start" min="1" max="${MAX_CHAIN_LEDS}" step="1" value="${zn.start + 1}" aria-label="${esc(t('lights.xled.position'))}">`)}
          ${row(esc(t('lights.xled.direction')), `<select data-z="${z}" data-k="dir" aria-label="${esc(t('lights.xled.direction'))}"><option value="0" ${zn.flags & ZX_REVERSE ? '' : 'selected'}>${esc(t('lights.xled.dir_normal'))}</option><option value="1" ${zn.flags & ZX_REVERSE ? 'selected' : ''}>${esc(t('lights.xled.dir_reversed'))}</option></select>`)}
        </div>
      </div></div>`;
  }
  const orderNames = (ty) => LED_ORDERS.map((o, i) => (ty === 2 ? (i === 0 ? t('lights.bgr_standard') : i === 5 ? 'GRB' : o) : (i === 0 ? t('lights.grb_standard') : o)));
  // per extra data pin: LED type, colour order, clock pin (APA102 only); one block per pin in use, not per zone
  function pinBlocksHtml() {
    const c = state.cfg, e = ext();
    return [1, 2, 3].filter((ch) => e.xledPins[ch - 1] !== PIN_NONE && onChain(ch).length).map((ch) => {
      const i = ch - 1, ty = e.xledType[i], taken = new Set(ctx.assignedPins().filter((p) => p !== e.xledClk[i]));
      taken.add(c.rgbPin);
      const clkOpts = `<option value="255">${esc(t('common.choose_pin'))}</option>` + [...Array(NUM_DIGITAL_PINS).keys()].filter((p) => !taken.has(p) || p === e.xledClk[i]).map((p) => `<option value="${p}" ${p === e.xledClk[i] ? 'selected' : ''}>GP${p}</option>`).join('');
      const row = (label, inner) => `<div class="xz-row"><label>${label}</label><div class="xz-ctl">${inner}</div></div>`;
      return `<div class="xpin" data-ch="${ch}"><h3>${esc(t('lights.xled.pin_block', { n: ch + 1, pin: e.xledPins[i] }))}</h3>
        ${row(esc(t('common.led_type')), `<select data-ch="${ch}" data-k="xtype" aria-label="${esc(t('common.led_type'))}">${LED_TYPES.map((x) => `<option value="${x.id}" ${x.id === ty ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}
        ${ty === 1 ? '' : row(esc(t('lights.colour_order')), `<select data-ch="${ch}" data-k="xorder" aria-label="${esc(t('lights.colour_order'))}">${orderNames(ty).map((o, k) => `<option value="${k}" ${k === e.xledOrder[i] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`)}
        ${ty === 2 ? row(esc(t('lights.clock_pin')), `<select data-ch="${ch}" data-k="xclk" aria-label="${esc(t('lights.clock_pin'))}">${clkOpts}</select>`) : ''}
      </div>`;
    }).join('');
  }
  function cellInfo(c, cell) {
    const e = ext();
    if (cell.kind === 'fret') return { name: t('lights.xled.cell_fret', { n: cell.idx + 1 }), color: c.colors?.[cell.idx] || FRET_CELL };
    if (cell.kind === 'strum') return { name: t('lights.xled.cell_strum', { n: cell.idx + 1 }), color: STRUM_CELL };
    return { name: XZONE_NAMES[cell.idx], color: rgbToHex(...e.xzones[cell.idx].color) };
  }
  // order of the zones that share one data pin: the fret / strum LEDs are fixed blocks, the zones move up / down
  function orderHtml(ch) {
    const c = state.cfg, e = ext(), zs = byStart(ch);
    if (zs.length < 2 && !zs.some((z) => manual.has(z))) return '';
    const items = zs.map((z) => ({ pos: blockStart(c, z), z }));
    if (ch === 0) {
      const fr = mainChainUsers(c).filter((u) => u.kind === 'fret').map((u) => u.pos), st = mainChainUsers(c).filter((u) => u.kind === 'strum').map((u) => u.pos);
      if (fr.length) items.push({ pos: Math.min(...fr), fixed: t('common.fret_leds'), from: Math.min(...fr), to: Math.max(...fr) });
      if (st.length) items.push({ pos: Math.min(...st), fixed: t('common.strum_bar_leds'), from: Math.min(...st), to: Math.max(...st) });
    }
    items.sort((a, b) => a.pos - b.pos);
    const li = items.map((it) => {
      if (it.fixed) return `<li class="fixed"><span class="xo-name">${esc(it.fixed)}</span><span class="xz-where">${esc(t('lights.xled.where', { from: it.from + 1, to: it.to + 1 }))}</span></li>`;
      const st = blockStart(c, it.z), i = zs.indexOf(it.z), nm = zname(it.z);
      return `<li><span class="xo-name">${esc(nm)}</span><span class="xz-where">${esc(t('lights.xled.where', { from: st + 1, to: st + blockCount(c, it.z) }))}</span>${manual.has(it.z) ? `<span class="tag">${esc(t('lights.xled.manual'))}</span>` : ''}
        <span class="xo-btns"><button type="button" class="btn small" data-z="${it.z}" data-k="up" aria-label="${esc(t('lights.xled.move_up', { zone: nm }))}" title="${esc(t('lights.xled.move_up', { zone: nm }))}" ${i === 0 ? 'disabled' : ''}>▲</button><button type="button" class="btn small" data-z="${it.z}" data-k="down" aria-label="${esc(t('lights.xled.move_down', { zone: nm }))}" title="${esc(t('lights.xled.move_down', { zone: nm }))}" ${i === zs.length - 1 ? 'disabled' : ''}>▼</button></span></li>`;
    }).join('');
    return `<p class="dim small xo-hint">${esc(t('lights.xled.order_hint'))}</p><ol class="xorder">${li}</ol>`;
  }
  function mapHtml() {
    const c = state.cfg, e = ext(), chains = xledChains(c);
    const used = [0, 1, 2, 3].filter((ch) => onChain(ch).length);   // chain 0 only while a zone is on it (the strum LEDs are fixed there)
    if (!used.length) return '';
    const rows = used.map((ch) => {
      const cells = chains[ch];
      let last = -1; cells.forEach((u, p) => { if (u.length) last = p; });
      const n = Math.min(MAX_CHAIN_LEDS, last + 2);
      const label = ch === 0 ? t('lights.xled.chain_main', { pin: c.rgbPin === PIN_NONE ? '?' : c.rgbPin }) : t('lights.xled.chain_extra', { pin: e.xledPins[ch - 1] });
      const html = cells.slice(0, n).map((u, p) => {
        const what = u.length ? u.map((x) => cellInfo(c, x).name).join(' + ') : t('lights.xled.free');
        const bad = u.length > 1;
        const first = u.length === 1 && u[0].kind === 'zone' ? (xzoneLed(e.xzones[u[0].idx], 0) === p ? ' first' : '') : '';
        const col = u.length ? cellInfo(c, u[0]).color : 'transparent';
        return `<button type="button" class="xc ${u.length ? '' : 'free'} ${bad ? 'bad' : ''}${first}" data-k="cell" data-ch="${ch}" data-p="${p}" style="--c:${col};--fg:${u.length ? textOn(col) : 'var(--dim)'}" title="${esc(t('lights.xled.cell', { n: p + 1, what }))}" aria-label="${esc(t('lights.xled.cell', { n: p + 1, what }))}" ${c.rgbEnabled ? '' : 'disabled'}>${p + 1}</button>`;
      }).join('');
      return `<div class="xmap-row"><span class="xmap-lbl">${esc(label)}</span><div class="xmap-cells">${html}</div>${orderHtml(ch)}</div>`;
    }).join('');
    const legend = [];
    if (used.includes(0) && chains[0].some((u) => u.some((x) => x.kind === 'fret'))) legend.push([FRET_CELL, t('common.fret_leds')]);
    if (used.some((ch) => chains[ch].some((u) => u.some((x) => x.kind === 'strum')))) legend.push([STRUM_CELL, t('common.strum_bar_leds')]);
    e.xzones.forEach((zn, z) => { if (xzoneOn(zn)) legend.push([rgbToHex(...zn.color), XZONE_NAMES[z]]); });
    return `<div class="xmap"><h3>${esc(t('lights.xled.map_h'))}</h3><p class="dim small">${esc(t('lights.xled.map_hint'))}</p>${rows}
      <div class="xmap-legend">${legend.map(([col, nm]) => `<span><i style="background:${col}"></i>${esc(nm)}</span>`).join('')}</div></div>`;
  }
  function errText(er) {
    const zone = er.z >= 0 ? zname(er.z) : '';
    if (er.code === 'pin') return t('lights.xled.err.pin', { pin: er.pin });
    if (er.code === 'nopin') return t('lights.xled.err.nopin', { zone });
    if (er.code === 'noclk') return t('lights.xled.err.noclk', { pin: er.pin });
    if (er.code === 'range') return t('lights.xled.err.range', { zone, max: MAX_CHAIN_LEDS });
    if (er.code === 'overlap') {
      const names = er.with.map((w) => (w === 'fret' ? t('common.fret_leds') : w === 'strum' ? t('common.strum_bar_leds') : XZONE_NAMES[+w.slice(1)]));
      return t('lights.xled.err.overlap', { zone, with: names.join(', ') });
    }
    return t('lights.xled.err.count', { zone });
  }

  function draw() {
    const card = $('#xledCard');
    if (!card) return;
    const c = state.cfg, can = ok();
    $('#xledNote').hidden = can || !state.info;
    card.classList.toggle('rgb-disabled', !c.rgbEnabled);
    let html = '';
    if (can) {
      const errs = xledErrors(c), total = xledTotal(c);
      html = [...Array(NUM_XZONES).keys()].map((z) => zoneHtml(z, errs.filter((er) => er.z === z))).join('') + pinBlocksHtml() + mapHtml();
      const msgs = errs.map(errText);
      if (msgs.length) html += `<div class="notice bad xz-err" role="alert">${msgs.map((m) => `<p>${esc(m)}</p>`).join('')}<p class="small">${esc(t('lights.xled.err.not_sent'))}</p></div>`;
      if (total && !ledOverdrive(c) && maxBrightness(c) < 255 && total + (c.noFretLeds ? 0 : 5 * (c.fretLeds === 2 ? 2 : 1)) + (c.strumLeds || 0) > 18)
        html += `<p class="dim small">${esc(t('lights.xled.limit', { m: maxBrightness(c) }))}</p>`;
    } else {
      html = [...Array(NUM_XZONES).keys()].map((z) => `<div class="xz"><div class="opt ${z === 0 ? 'first' : ''}"><div><h3>${esc(XZONE_NAMES[z])}</h3></div><label class="switch"><input type="checkbox" disabled aria-label="${esc(XZONE_NAMES[z])}"><i></i></label></div></div>`).join('');
    }
    if (body._html === html) return;
    const a = document.activeElement, keepFocus = a && body.contains(a) && a.dataset.k ? { z: a.dataset.z, k: a.dataset.k, ch: a.dataset.ch, p: a.dataset.p } : null;
    body.innerHTML = html; body._html = html;
    if (keepFocus) {
      const sel = `[data-k="${keepFocus.k}"]` + (keepFocus.z !== undefined ? `[data-z="${keepFocus.z}"]` : '') + (keepFocus.p !== undefined ? `[data-ch="${keepFocus.ch}"][data-p="${keepFocus.p}"]` : '');
      body.querySelector(sel)?.focus();
    }
  }

  // ---- find: light the zone's first and last LED in turn
  async function find(z) {
    const e = ext(), zn = e.xzones[z], id = ++findRun;
    const leds = zn.count > 1 ? [[0, t('lights.xled.find_first')], [zn.count - 1, t('lights.xled.find_last')]] : [[0, t('lights.xled.find_first')]];
    finding = z;
    try {
      for (const [k, msg] of leds) {
        if (id !== findRun || !ctx.active()) break;
        findMsg = msg; body._html = ''; draw();
        await ctx.test(xzoneLed(zn, k), zn.chain);
        await wait(1100);
      }
    } catch { /* device went away */ }
    if (id === findRun) { finding = -1; Promise.resolve(ctx.test(-1, 0)).catch(() => {}); body._html = ''; if (ctx.active()) draw(); }
  }

  // ---- events
  const info = (el) => ({ z: +el.dataset.z, k: el.dataset.k });
  body.onclick = (ev) => {
    const cell = ev.target.closest('[data-k="cell"]');
    if (cell) { findRun++; finding = -1; Promise.resolve(ctx.test(+cell.dataset.p, +cell.dataset.ch)).catch(() => {}); return; }
    const mv = ev.target.closest('[data-k="up"],[data-k="down"]');
    if (mv) { move(+mv.dataset.z, mv.dataset.k === 'up' ? -1 : 1); body._html = ''; ctx.live(); return; }
    const rp = ev.target.closest('[data-k="repack"]');
    if (rp) { manual.delete(+rp.dataset.z); repack(ext().xzones[+rp.dataset.z].chain); body._html = ''; ctx.live(); return; }
    const f = ev.target.closest('[data-k="find"]');
    if (f) find(+f.dataset.z);
  };
  // sliders and colour: no redraw while dragging
  body.oninput = (ev) => {
    const el = ev.target;
    if (!el.dataset.k || el.dataset.z === undefined) return;
    const { z, k } = info(el), zn = ext().xzones[z];
    if (k === 'color') { zn.color = hexToRgb(el.value); const h = body.querySelector(`[data-hex="${z}"]`); if (h) h.textContent = el.value.toUpperCase(); }
    else if (k === 'speed') zn.speed = +el.value;
    else if (k === 'level') { zn.level = +el.value; const o = body.querySelector(`[data-lvl="${z}"]`); if (o) o.textContent = zn.level + '%'; }
    else return;
    body._html = ''; ctx.pushCfg();
  };
  body.onchange = (ev) => {
    const el = ev.target;
    if (!ok() || !el.dataset.k) return;
    if (el.dataset.k === 'xtype' || el.dataset.k === 'xorder' || el.dataset.k === 'xclk') {   // per extra data pin
      const i = +el.dataset.ch - 1, e = ext(), v = +el.value;
      if (el.dataset.k === 'xtype') { e.xledType[i] = v; e.xledOrder[i] = 0; if (v !== 2) e.xledClk[i] = PIN_NONE; } else if (el.dataset.k === 'xorder') e.xledOrder[i] = v; else e.xledClk[i] = v;
      body._html = ''; ctx.live(); return;
    }
    if (el.dataset.z === undefined) return;
    const { z, k } = info(el), e = ext(), zn = e.xzones[z];
    if (k === 'on') setOn(z, el.checked);
    else if (k === 'count') { zn.count = Math.max(1, Math.min(XZONE_MAX[z], Math.round(+el.value) || 1)); repack(zn.chain); }
    else if (k === 'effect') zn.effect = +el.value;
    else if (k === 'star') zn.flags = el.checked ? zn.flags | ZX_STAR : zn.flags & ~ZX_STAR;
    else if (k === 'dir') zn.flags = el.value === '1' ? zn.flags | ZX_REVERSE : zn.flags & ~ZX_REVERSE;
    else if (k === 'pin') setPin(z, el.value);
    else if (k === 'start') { zn.start = Math.max(0, Math.min(MAX_CHAIN_LEDS - 1, (Math.round(+el.value) || 1) - 1)); manual.add(z); }
    else if (k === 'color' || k === 'speed' || k === 'level') { ctx.pushCfg(); return; }
    else return;
    body._html = '';
    ctx.live();
  };

  // the strum LEDs' data pin row for the strum LED settings (firmware 0.57+); '' when it does not apply
  function strumPinHtml() {
    const c = state.cfg;
    if (!ctx.fwAtLeast(57) || !c?.ext?.xzones || !(c.strumLeds > 0)) return '';
    const sx = strumChainOf(c);
    return `<div class="opt adv ${sx ? 'adv-keep' : ''}"><div><h3>${esc(t('lights.data_pin'))}</h3><p class="dim">${esc(t('lights.xled.strum_pin.desc'))}</p></div>
      <select data-k="spin" aria-label="${esc(t('lights.data_pin'))}">${pinOptions(SID)}</select></div>`;
  }
  return { draw, stop: () => { findRun++; finding = -1; }, strumPinHtml, setStrumPin: (v) => { setStrumChainPin(state.cfg, v); } };
}

// Setup wizard helper: set the zone counts (0 = off) and place the zones one after another, each on the chain it is already on
// (the main chain for a new one). counts = [neck, star, plus, body]
export function applyXledCounts(c, counts) {
  const e = c.ext;
  if (!e?.xzones) return;
  const chains = e.xzones.map((zn) => (xzoneOn(zn) ? zn.chain : 0));
  e.xzones.forEach((zn) => { zn.count = 0; zn.start = 0; zn.chain = 0; });
  counts.forEach((n, z) => {
    const zn = e.xzones[z];
    if (!n) return;
    if (zn.effect === 0 && !zn.color.some(Boolean)) Object.assign(zn, emptyXzone(z), { count: 0 });
    zn.chain = chains[z];
    zn.count = Math.min(XZONE_MAX[z], n);
    zn.start = Math.max(0, xledAutoStart(c, zn.chain, zn.count, z));
  });
  gcPinsOf(c);
}
