// The Test page's "Controller Visualizer" as a real 3D pad: one model per USB mode (Xbox 360, Xbox One/Series, DualShock 4, DualSense, Joy-Con pair).
// Same interface as gamepad.js (createPad): el, setHeader, setLive, setMode, setArmed, update(pad). createPadAuto() returns the 3D card where WebGL
// is real hardware and the 2D drawing everywhere else (and until the model has loaded); the drawing stays in the page, visually hidden, as the
// keyboard / screen-reader layer and as the source of the per-family aria-labels. Models: web/models/pad_*.glb (credits: README, tools/model/README.md).
// three.js (MIT) is the bundle in vendor/three-yagcc.js, only downloaded when a 3D pad is created.
import { createPad } from './gamepad.js?v=dev';
import { webglAvailable } from './guitar3d.js?v=dev';
import { outName, outputSupported, modeFamily } from './mapping.js?v=dev';

let libP = null;
const lib = () => (libP ||= import('../vendor/three-yagcc.js?v=dev'));
const loaded = new Map();   // model key -> Promise<gltf>
const loadModel = (key) => {
  if (!loaded.has(key)) loaded.set(key, lib().then((T) => new T.GLTFLoader().loadAsync(new URL(`../models/${MODELS[key].file}?v=dev`, import.meta.url).href)));
  return loaded.get(key);
};
const force3d = /[?&]force3d\b/.test(location.search);
const lite = /[?&]force3d=lite\b/.test(location.search);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- which model each USB mode shows (ids from mapping.js TEST_MODES)
export const MODE_MODEL = { 0: 'xbox360', 2: 'xboxone', 9: 'xboxone', 7: 'xboxone', 1: 'ds4', 3: 'ds4', 8: 'ds4', 11: 'ds5', 5: 'joycon', 6: 'joycon' };
export const modelKey = (mode) => MODE_MODEL[mode] || 'xboxone';

// ---- the nodes every model shares (names fixed by tools/model/pads/build_pads.mjs) and the generic output each one stands for
const OUT = { btn_a: 1, btn_b: 2, btn_x: 3, btn_y: 4, lb: 5, rb: 6, lt: 7, rt: 8, back: 9, start: 10, guide: 11, ls: 12, rs: 13, dpad_up: 14, dpad_down: 15, dpad_left: 16, dpad_right: 17 };
const DIR_OUT = { up: 14, down: 15, left: 16, right: 17 };

// Per model: file, canvas aspect, label glyphs drawn on the caps (only where the model has none of its own), and how far things move.
// deg: trigger / bumper hinge angles about X (sign = direction of travel, + moves the free end towards the player), tilt: stick lean in radians.
const GREY = '#7b838f', SYM = { a: '#7fb4ff', b: '#ff6f78', x: '#f3a6d6', y: '#3fd3b4' };
const ARROW = (d) => ({ g: 'arrow_' + d, c: '#e8e8ec', bg: '#1e1e22', s: 0.92 });
const MODELS = {
  xbox360: {
    file: 'pad_xbox360.glb', ratio: 1.55, trig: -15, bump: 5, tilt: 0.3, press: 0.006,
    decals: { btn_a: { g: 'A', c: '#6cc04a', s: 0.64 }, btn_b: { g: 'B', c: '#e5484d', s: 0.64 }, btn_x: { g: 'X', c: '#3f8fe0', s: 0.64 }, btn_y: { g: 'Y', c: '#f0c52b', s: 0.64 } },
    dpadArrows: true,
  },
  xboxone: {
    file: 'pad_xboxone.glb', ratio: 1.55, trig: -14, bump: 5, tilt: 0.3, press: 0.01,
    decals: { btn_a: { g: 'A', c: GREY, s: 0.6 }, btn_b: { g: 'B', c: GREY, s: 0.6 }, btn_x: { g: 'X', c: GREY, s: 0.6 }, btn_y: { g: 'Y', c: GREY, s: 0.6 },
      back: { g: 'view', c: GREY, s: 0.62 }, start: { g: 'menu', c: GREY, s: 0.62 } },
    dpadArrows: true,
  },
  ds4: { file: 'pad_ds4.glb', ratio: 1.6, trig: -14, bump: 5, tilt: 0.28, press: 0.007, decals: {} },
  ds5: {
    file: 'pad_ds5.glb', ratio: 1.6, trig: -14, bump: 5, tilt: 0.28, press: 0.007,
    decals: { btn_a: { g: 'cross', c: SYM.a, s: 0.62 }, btn_b: { g: 'circle', c: SYM.b, s: 0.62 }, btn_x: { g: 'square', c: SYM.x, s: 0.62 }, btn_y: { g: 'triangle', c: SYM.y, s: 0.62 } },
  },
  joycon: {
    file: 'pad_joycon.glb', ratio: 1.2, trig: -10, bump: 5, tilt: 0.3, press: 0.006,
    decals: { dpad_up: ARROW('up'), dpad_down: ARROW('down'), dpad_left: ARROW('left'), dpad_right: ARROW('right'), capture: { g: 'capture', c: '#e8e8ec', bg: '#1e1e22', s: 0.95 } },
  },
};

// ---- label glyphs, drawn white-on-transparent or in their own colour onto a canvas texture
function glyphCanvas(def, T) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); x.translate(S / 2, S / 2);
  if (def.bg) { x.fillStyle = def.bg; x.beginPath(); x.arc(0, 0, S / 2 - 2, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = x.fillStyle = def.c; x.lineWidth = 11; x.lineCap = x.lineJoin = 'round';
  const k = def.bg ? 0.5 : 1, g = def.g;
  if (g.length === 1) { x.font = '800 ' + Math.round(S * 0.86 * k) + 'px system-ui, "Segoe UI", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillText(g, 0, S * 0.3 * k); }
  else if (g === 'cross') { const r = 30; x.lineWidth = 12; x.beginPath(); x.moveTo(-r, -r); x.lineTo(r, r); x.moveTo(r, -r); x.lineTo(-r, r); x.stroke(); }
  else if (g === 'circle') { x.lineWidth = 12; x.beginPath(); x.arc(0, 0, 34, 0, Math.PI * 2); x.stroke(); }
  else if (g === 'square') { x.lineWidth = 12; x.strokeRect(-30, -30, 60, 60); }
  else if (g === 'triangle') { x.lineWidth = 12; x.beginPath(); x.moveTo(0, -38); x.lineTo(36, 26); x.lineTo(-36, 26); x.closePath(); x.stroke(); }
  else if (g.startsWith('arrow_')) {
    const d = g.slice(6), a = { up: -90, right: 0, down: 90, left: 180 }[d] * Math.PI / 180;
    x.rotate(a); x.beginPath(); x.moveTo(30, 0); x.lineTo(-18, -28); x.lineTo(-18, 28); x.closePath(); x.fill();
  } else if (g === 'view') { x.lineWidth = 9; x.strokeRect(-30, -24, 40, 34); x.strokeRect(-12, -6, 40, 34); }
  else if (g === 'menu') { x.lineWidth = 10; x.beginPath(); for (const y of [-24, 0, 24]) { x.moveTo(-30, y); x.lineTo(30, y); } x.stroke(); }
  else if (g === 'capture') { x.lineWidth = 9; x.strokeRect(-30, -24, 60, 48); x.beginPath(); x.arc(0, 0, 11, 0, Math.PI * 2); x.stroke(); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ---- the 3D view (one canvas; swaps the model when the mode's model changes)
export function createPad3D(host, { onPick, onReady, onFail, watch = host } = {}) {
  let disposed = false, T = null, ready = false;
  const st = { pad: null, mode: 0, key: null, armed: false, hover: '', label: '' };
  const api = {
    setMode(m) { st.mode = m; applyMode(); },
    setArmed(on) { st.armed = !!on; need(); },
    update(pad) { st.pad = pad; need(); },
    dispose() { disposed = true; pre.disconnect(); },
  };
  let need = () => {};
  let applyMode = () => {};

  const pre = new IntersectionObserver((es) => { if (es[0].isIntersecting) { pre.disconnect(); start(); } });
  setTimeout(() => pre.observe(watch));
  const start = async () => {
    try {
      T = await lib();
      if (disposed) return;
      init();
    } catch (e) { console.warn('3D pad unavailable:', e); onFail?.(e); }
  };

  function init() {
    const canvas = document.createElement('canvas');
    canvas.className = 'pad3d';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Live 3D view of the controller. Drag to turn it, double-click to reset. The list of buttons below the drawing works with the keyboard.');
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'low-power' }); } catch (e) { onFail?.(e); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    const scene = new T.Scene();
    if (!lite) {
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.5;
      pm.dispose();
    }
    scene.add(new T.HemisphereLight(0xffffff, 0x1a1c26, 0.45));
    const key = new T.DirectionalLight(0xffffff, 2.0); key.position.set(-1.6, 3.2, 2.4); scene.add(key);
    const rimBlue = new T.DirectionalLight(0x4f8cff, 1.3); rimBlue.position.set(3, 1.2, -2.5); scene.add(rimBlue);
    const rimViolet = new T.DirectionalLight(0xa070ff, 1.0); rimViolet.position.set(-3.2, 1.5, -2.4); scene.add(rimViolet);
    const fill = new T.DirectionalLight(0xffffff, 0.7); fill.position.set(2, 1, 4); scene.add(fill);

    // soft contact shadow under the pad
    const sh = document.createElement('canvas'); sh.width = sh.height = 128;
    { const g = sh.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
    const shadow = new T.Mesh(new T.CircleGeometry(1, 40), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sh), transparent: true, depthWrite: false, opacity: 0.8 }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

    const stage = new T.Group(); scene.add(stage);          // holds the current rig
    const camera = new T.PerspectiveCamera(24, 1.6, 0.05, 60);
    const controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.09; controls.enablePan = false; controls.enableZoom = false; controls.rotateSpeed = 0.7;
    controls.minPolarAngle = 0.25; controls.maxPolarAngle = Math.PI * 0.62;
    controls.minAzimuthAngle = -0.9; controls.maxAzimuthAngle = 0.9;
    let lastTouch = -1e9;
    controls.addEventListener('start', () => { lastTouch = Infinity; canvas.classList.add('grabbing'); });
    controls.addEventListener('end', () => { lastTouch = performance.now(); canvas.classList.remove('grabbing'); });
    canvas.addEventListener('dblclick', () => { lastTouch = -1e9; });

    const accent = new T.Color('#4f7cff'), cyan = new T.Color(0x1cc6ff), tmp = new T.Color(), white = new T.Color(1, 1, 1);
    const readAccent = () => { try { const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); if (v) accent.set(v); } catch { /* keep */ } };
    readAccent();

    let hitAt = null;
    let rig = null, needsDraw = true, running = false, visible = false, home = new T.Vector3(0, 3, 4), target = new T.Vector3(), moving = true;
    need = () => { needsDraw = true; if (rig && !running) loop(); };

    // ---- build the rig for a loaded model: pose bookkeeping per named part, own materials (so each part can glow alone), label decals
    function makeRig(key, gltf) {
      const cfg = MODELS[key], root = gltf.scene.clone(true), parts = {}, meshes = [];
      root.traverse((o) => { if (o.userData?.role && o.userData.role !== 'static') parts[o.name] = o; });
      const decalMats = [];
      for (const [name, p] of Object.entries(parts)) {
        const mats = [];
        p.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone(); o.material.userData.base = { color: o.material.color.clone(), em: o.material.emissive.clone(), emi: o.material.emissiveIntensity };
          mats.push(o.material); o.userData.part = name; meshes.push(o);
        });
        p.userData.mats = mats; p.userData.rest = { p: p.position.clone(), r: p.rotation.clone() };
        p.userData.s = { v: 0, hov: 0 };   // eased 0..1 press / pull
        p.userData.out = OUT[name]; p.userData.name = name;
        const d = cfg.decals[name];
        if (d) {
          const sz = Math.min(...p.userData.size) * d.s, tex = glyphCanvas(d, T);
          const m = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false });
          const pl = new T.Mesh(new T.PlaneGeometry(sz, sz), m);
          pl.rotation.x = -Math.PI / 2; const tp = p.userData.top; pl.position.set(tp[0], tp[1] + 0.0025, tp[2]); pl.userData.decal = true; pl.renderOrder = 2;
          p.add(pl); decalMats.push(m); p.userData.decal = m;
        }
        if (name === 'dpad' && cfg.dpadArrows) {   // one-piece D-pad: four small arrows that light up for the pressed direction
          const sz = p.userData.size[0], tp = p.userData.top, dd = {};
          for (const [dir, ox, oz] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]]) {
            const m = new T.MeshBasicMaterial({ map: glyphCanvas({ g: 'arrow_' + dir, c: '#ffffff' }, T), color: 0x8a909c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false });
            const pl = new T.Mesh(new T.PlaneGeometry(sz * 0.2, sz * 0.2), m); pl.rotation.x = -Math.PI / 2; pl.renderOrder = 2;
            pl.position.set(tp[0] + ox * sz * 0.33, tp[1] + 0.0025, tp[2] + oz * sz * 0.33); p.add(pl); dd[dir] = m; decalMats.push(m);
          }
          p.userData.arrows = dd;
        }
      }
      stage.add(root);
      // centre: x/z around the middle, resting on y = 0
      root.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(root), c = box.getCenter(new T.Vector3());
      root.position.set(-c.x, -box.min.y, -c.z); root.updateMatrixWorld(true);
      const bb = new T.Box3().setFromObject(root);
      stage.remove(root);
      return { key, cfg, root, parts, meshes, bb, decalMats, supported: {} };
    }

    function frameHome() {
      if (!rig) return;
      const bb = rig.bb, c = bb.getCenter(new T.Vector3()), s = bb.getSize(new T.Vector3());
      target.copy(c); controls.target.copy(target);
      // distance at which all 8 corners of the box fit the view (binary search; cheap)
      const el = 0.99, dir = new T.Vector3(0, Math.sin(el), Math.cos(el)), corner = new T.Vector3();
      const fits = (d) => {
        camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
        for (let i = 0; i < 8; i++) { corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).project(camera); if (Math.abs(corner.x) > 0.93 || Math.abs(corner.y) > 0.93) return false; }
        return true;
      };
      let lo = Math.max(s.x, s.z) * 0.6, hi = Math.max(s.x, s.z) * 12;
      for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      home.copy(target).addScaledVector(dir, hi);
      camera.position.copy(home); controls.update();
      shadow.scale.set(s.x * 0.56, s.z * 0.56, 1); shadow.position.set(0, -0.12, 0);
      shadow.rotation.x = -Math.PI / 2;
    }
    const size = () => {
      const w = host.clientWidth || 600, r = (rig?.cfg.ratio || 1.55) * (w < 480 ? 0.86 : 1);
      const h = Math.round(Math.max(210, Math.min(w / r, 470)));
      renderer.setSize(w, h, false); canvas.style.width = '100%'; canvas.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix(); frameHome(); needsDraw = true;
    };
    const ro = new ResizeObserver(size); ro.observe(host);

    // ---- model switching: keep the old model on screen until the new one is ready
    let wantKey = null;
    applyMode = () => {
      const key = modelKey(st.mode); st.key = key;
      if (rig && rig.key === key) { applyLabels(); return; }
      wantKey = key;
      loadModel(key).then((gltf) => {
        if (disposed || wantKey !== key) return;
        const r = (cache[key] ||= makeRig(key, gltf));
        if (rig) stage.remove(rig.root);
        rig = r; stage.add(r.root); readAccent(); size(); applyLabels();
        if (!ready) { ready = true; host.appendChild(canvas); onReady?.(canvas); }
        if (force3d) window.__pad3d = { T, scene, camera, controls, get rig() { return rig; }, stage, st, renderer, hit: (x, y) => hitAt?.({ clientX: x, clientY: y }) };
        need(); loop();
      }).catch((e) => { console.warn('3D pad model failed:', e); if (!ready) { onFail?.(e); disposed = true; } });
    };
    const cache = {};
    // dim parts the current mode can't send; labels for tooltips
    const partOuts = (name) => (name === 'ls' ? [12, 18, 19] : name === 'rs' ? [13, 20, 21] : name === 'dpad' ? [14, 15, 16, 17] : name === 'lt' ? [7, 22] : name === 'rt' ? [8, 23] : OUT[name] ? [OUT[name]] : []);
    function applyLabels() {
      if (!rig) return;
      for (const [name, p] of Object.entries(rig.parts)) {
        const outs = partOuts(name), na = outs.length > 0 && !outs.some((o) => outputSupported(st.mode, o));
        p.userData.na = na;
        for (const m of p.userData.mats) { const b = m.userData.base; m.color.copy(b.color).multiplyScalar(na ? 0.5 : 1); }
        if (p.userData.decal) p.userData.decal.opacity = na ? 0.35 : 1;
      }
      need();
    }
    const labelOf = (name, sub) => {
      const m = st.mode;
      if (name === 'ls' || name === 'rs') return sub && sub.startsWith('stick:') ? `${name === 'ls' ? 'Left' : 'Right'} stick ${sub.slice(6)}` : outName(OUT[name], m);
      if (name === 'dpad') return outName(DIR_OUT[sub] || 14, m);
      if (name === 'capture') return 'Capture (no output)';
      return OUT[name] ? outName(OUT[name], m) : '';
    };

    // ---- per frame
    const clock = new T.Clock();
    const ease = (cur, tgt, k) => { const d = tgt - cur; if (Math.abs(d) < 1e-4) return tgt; moving = true; return cur + d * k; };
    const bit = (pad, o) => (pad.buttons & (1 << (o - 1))) !== 0;
    const clamp1 = (v) => Math.max(-1, Math.min(1, v || 0));
    function glow(p, level, k, focus) {
      // emissive: accent for pressed (the base colour darkens a little so the glow reads on white plastic), cyan pulse for the hovered part while a source is picked
      const dim = (p.userData.na ? 0.5 : 1) * (1 - 0.5 * Math.min(1, level));
      for (const m of p.userData.mats) {
        const b = m.userData.base;
        m.color.copy(b.color).multiplyScalar(dim);
        if (level > 0.02) { tmp.copy(accent); m.emissive.lerp(tmp, k); m.emissiveIntensity = ease(m.emissiveIntensity, 0.15 + 0.85 * level, k); }
        else if (focus > 0) { m.emissive.lerp(cyan, k); m.emissiveIntensity = ease(m.emissiveIntensity, 0.25 + 0.5 * focus, k); }
        else { m.emissive.lerp(b.em, k); m.emissiveIntensity = ease(m.emissiveIntensity, b.emi, k); }
      }
    }
    let t0 = 0;
    function frame() {
      const dt = Math.min(clock.getDelta(), 0.05), now = (t0 += dt);
      const still = reduceMotion(), k = still ? 1 : 1 - Math.exp(-dt * 24), kSlow = still ? 1 : 1 - Math.exp(-dt * 7);
      moving = false;
      if (rig) {
        const pad = st.pad || { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, cfg = rig.cfg;
        const pulse = still ? 0.6 : 0.5 + 0.5 * Math.sin(now * 5);
        for (const [name, p] of Object.entries(rig.parts)) {
          const u = p.userData, s = u.s, rest = u.rest, role = u.role, hov = st.armed && st.hover === name ? pulse : 0;
          if (role === 'btn' || role === 'dpad4') {
            const on = u.out ? bit(pad, u.out) : false;
            s.v = ease(s.v, on ? 1 : 0, k);
            p.position.y = rest.p.y - Math.min(cfg.press, u.hgt * 0.45) * s.v;
            glow(p, s.v, k, hov);
          } else if (role === 'bump') {
            const on = bit(pad, u.out); s.v = ease(s.v, on ? 1 : 0, k);
            p.rotation.x = rest.r.x + (cfg.bump * Math.PI / 180) * s.v; p.position.y = rest.p.y - 0.012 * s.v;
            glow(p, s.v, k, hov);
          } else if (role === 'trig') {
            const raw = name === 'lt' ? Math.max(pad.lt || 0, bit(pad, 7) ? 1 : 0) : Math.max(pad.rt || 0, bit(pad, 8) ? 1 : 0);
            s.v = ease(s.v, Math.max(0, Math.min(1, raw)), k);
            p.rotation.x = rest.r.x + (cfg.trig * Math.PI / 180) * s.v;
            glow(p, s.v > 0.02 ? 0.25 + 0.75 * s.v : 0, k, hov);
          } else if (role === 'stick') {
            const L = name === 'ls', x = clamp1(L ? pad.lx : pad.rx), y = clamp1(L ? pad.ly : pad.ry), click = bit(pad, u.out);
            const mag = Math.hypot(x, y), sc = mag > 1 ? 1 / mag : 1;
            u.tx = ease(u.tx || 0, x * sc, k); u.ty = ease(u.ty || 0, y * sc, k); s.v = ease(s.v, click ? 1 : 0, k);
            p.rotation.z = rest.r.z - u.tx * cfg.tilt; p.rotation.x = rest.r.x - u.ty * cfg.tilt;   // Y+ is up on the pad = away from the player (-z)
            p.position.y = rest.p.y - 0.03 * s.v;
            glow(p, click ? 1 : 0, k, hov);
          } else if (role === 'dpad') {
            const up = bit(pad, 14), dn = bit(pad, 15), lf = bit(pad, 16), rt = bit(pad, 17);
            u.tx = ease(u.tx || 0, (rt ? 1 : 0) - (lf ? 1 : 0), k); u.ty = ease(u.ty || 0, (up ? 1 : 0) - (dn ? 1 : 0), k);
            p.rotation.z = rest.r.z - u.tx * 0.13; p.rotation.x = rest.r.x - u.ty * 0.13;
            const any = up || dn || lf || rt; s.v = ease(s.v, any ? 1 : 0, k);
            glow(p, s.v * 0.35, k, hov);
            if (u.arrows) for (const [dir, m] of Object.entries(u.arrows)) { const on = { up, down: dn, left: lf, right: rt }[dir]; tmp.set(on ? accent : 0x8a909c); if (!m.color.equals(tmp)) { m.color.lerp(tmp, k); moving = true; } }
          }
          if (u.decal) { const on = (u.out && bit(pad, u.out)) || false; /* decals keep their own colour */ void on; }
        }
      }
      if (st.armed) moving = true;   // the hover pulse
      // drift back to the front view a few seconds after the user lets go
      if (performance.now() - lastTouch > 3500 && camera.position.distanceToSquared(home) > 1e-6) { camera.position.lerp(home, kSlow * 0.5); if (camera.position.distanceToSquared(home) < 1e-6) camera.position.copy(home); moving = true; }
      if (controls.update()) moving = true;
      if (lastTouch === Infinity) moving = true;
      if (moving || needsDraw) { renderer.render(scene, camera); needsDraw = false; }
      else if (!st.armed && !moving) { idleFrames++; if (idleFrames > 3) { renderer.setAnimationLoop(null); running = false; idleFrames = 0; } }
      if (moving) idleFrames = 0;
    }
    let idleFrames = 0;
    function loop() {
      if (disposed) return;
      const want = visible && !document.hidden && !!rig;
      if (want === running) return;
      running = want;
      if (want) { clock.getDelta(); renderer.setAnimationLoop(frame); } else renderer.setAnimationLoop(null);
    }
    const origNeed = need; need = () => { needsDraw = true; idleFrames = 0; if (rig && visible && !running) loop(); };
    void origNeed;
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; need(); loop(); }); io.observe(watch);
    document.addEventListener('visibilitychange', () => loop());
    api.dispose = () => { disposed = true; running = false; renderer.setAnimationLoop(null); ro.disconnect(); io.disconnect(); renderer.dispose(); };

    // ---- click / hover: ray cast against the parts' meshes; sticks and the D-pad split their hits into click / direction
    const ray = new T.Raycaster(), ndc = new T.Vector2(), v = new T.Vector3();
    const hit = hitAt = (e) => {
      if (!rig) return null;
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld(true); rig.root.updateMatrixWorld(true);
      ray.setFromCamera(ndc, camera);
      const hs = ray.intersectObjects(rig.meshes, false);
      if (!hs.length) return null;
      const h = hs[0], name = h.object.userData.part, p = rig.parts[name];
      let sub = '';
      if (name === 'ls' || name === 'rs' || name === 'dpad') {
        // hit point relative to the part's resting centre, in the pad's frame (x right, z down the pad)
        v.copy(h.point); rig.root.worldToLocal(v);
        const c = new T.Vector3(); p.parent.localToWorld(c.copy(p.userData.rest.p)); rig.root.worldToLocal(c);
        const dx = v.x - c.x, dz = v.z - c.z, rad = Math.max(p.userData.size[0], p.userData.size[1]) / 2;
        if (name === 'dpad') sub = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'left' : 'right') : (dz < 0 ? 'up' : 'down');
        else sub = Math.hypot(dx, dz) < rad * 0.5 ? 'click' : 'stick:' + (Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'left' : 'right') : (dz < 0 ? 'up' : 'down'));
      }
      return { name, sub };
    };
    const targetOf = ({ name, sub }) => {
      if (name === 'ls' || name === 'rs') return sub === 'click' ? { out: OUT[name] } : { stick: name === 'ls' ? 'L' : 'R', dir: sub.slice(6) };
      if (name === 'lt' || name === 'rt') return { trigger: name === 'lt' ? 'L' : 'R' };
      if (name === 'dpad') return { out: DIR_OUT[sub] };
      return OUT[name] ? { out: OUT[name] } : null;
    };
    let down = null, hoverRaf = 0;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }   // a drag turns the model
      down = null;
      const h = hit(e), t = h && targetOf(h);
      if (t) onPick?.(t);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down || e.pointerType === 'touch' || hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const h = hit(e), n = h ? h.name : '', lab = h ? labelOf(h.name, h.sub) : '';
        if (n !== st.hover) { st.hover = n; need(); }
        if (lab !== st.label) { st.label = lab; canvas.title = lab; canvas.style.cursor = h && targetOf(h) ? 'pointer' : ''; }
      });
    });
    canvas.addEventListener('pointerleave', () => { if (st.hover) { st.hover = ''; st.label = ''; canvas.title = ''; canvas.style.cursor = ''; need(); } });
    applyMode();
  }
  return api;
}

// ---- the card: the 2D pad (kept as the fallback and the keyboard layer) plus the 3D view when it can run
export function createPadAuto(onPick) {
  const pad2 = createPad(onPick);
  if (!webglAvailable()) return pad2;
  const card = pad2.el, svg = pad2.svg;
  const wrap = document.createElement('div'); wrap.className = 'gp-3d'; wrap.hidden = true;
  card.insertBefore(wrap, svg);
  let mode = 0, p3 = null, pendingPad = null;
  const fail = () => { wrap.remove(); p3 = null; svg.classList.remove('gp-sr'); card.classList.remove('is-3d'); };
  p3 = createPad3D(wrap, {
    onPick, watch: card,
    onReady: () => { wrap.hidden = false; svg.classList.add('gp-sr'); card.classList.add('is-3d'); },
    onFail: fail,
  });
  p3.setMode(mode);
  return Object.assign(Object.create(pad2), {
    el: card, svg,
    setMode(m) { mode = m; pad2.setMode(m); p3?.setMode(m); },
    setArmed(on) { pad2.setArmed(on); p3?.setArmed(on); },
    update(pad) { pad2.update(pad); pendingPad = pad; p3?.update(pad); },
  });
}
