// Live 3D guitar. Model: "Guitar Hero Controller" by CamSear16 (https://sketchfab.com/CamSear16), CC-BY-4.0,
// split into moving parts and with brand marks removed for YAGCC (see assets/model/README.md).
// three.js (MIT) is bundled in vendor/three-yagcc.js and only downloaded when a 3D view is created.

let libP = null, modelP = null;
const lib = () => (libP ||= import('../vendor/three-yagcc.js?v=dev'));
const loadModel = () => (modelP ||= lib().then((T) => new T.GLTFLoader().loadAsync(new URL('../models/guitar.glb?v=dev', import.meta.url).href)));

// Only with a real GPU: a software renderer (SwiftShader, llvmpipe) would make the whole page crawl.
// ?force3d skips that check (tests), ?2d turns the model off.
const force3d = /[?&]force3d\b/.test(location.search);
const lite = /[?&]force3d=lite\b/.test(location.search);   // software renderers: skip the costly reflections
export function webglAvailable() {
  if (/[?&]2d\b/.test(location.search)) return false;
  try {
    const c = document.createElement('canvas');
    const gl = window.WebGL2RenderingContext && c.getContext('webgl2', { failIfMajorPerformanceCaveat: !force3d });
    if (!gl) return false;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return force3d || !/swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch { return false; }
}

const FRETS = { green: 'fret_Green', red: 'fret_Red', yellow: 'fret_Yellow', blue: 'fret_Blue', orange: 'fret_Orange' };
const DEFAULT_COLORS = { green: '#22c55e', red: '#ef4444', yellow: '#facc15', blue: '#3b82f6', orange: '#fb923c' };
const FOCUS_COLOR = 0x1cc6ff;
const ASPECT = 1100 / 340;   // same box as the 2D drawing, so nothing jumps when the model arrives
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// state: what the real guitar is doing. The render loop eases the model towards it.
export function createGuitar3D(host, { onReady, onFail, onPart } = {}) {
  const st = { pressed: {}, whammy: 0, tilt: false, focus: [], hover: '', colors: { ...DEFAULT_COLORS } };
  let disposed = false;
  const api = {
    setPressed(n, on) { st.pressed[n] = !!on; },
    setWhammy(v) { st.whammy = Math.min(1, Math.max(0, +v || 0)); },
    setTilt(on) { st.tilt = !!on; },
    setFocus(names) { st.focus = names || []; },
    setFretColors(cols) { Object.keys(FRETS).forEach((n, i) => { st.colors[n] = cols[i] || DEFAULT_COLORS[n]; }); },
    dispose() { disposed = true; pre.disconnect(); },
  };

  // nothing is downloaded until this view is actually on screen (the Flash page never loads three.js)
  const pre = new IntersectionObserver((es) => { if (es[0].isIntersecting) { pre.disconnect(); start(); } });
  setTimeout(() => pre.observe(host));   // the caller attaches host to the page right after this returns
  const start = () => Promise.all([lib(), loadModel()]).then(([T, gltf]) => {
    if (disposed) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'guitar3d';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Live 3D view of the guitar. Drag to turn it, double-click to reset.');
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'low-power' });
    } catch (e) { onFail?.(e); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NeutralToneMapping;   // keeps the fret colours true (ACES turns orange yellow)
    renderer.toneMappingExposure = 1.05;

    const scene = new T.Scene();
    if (!lite) {
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }
    scene.add(new T.HemisphereLight(0xbfd4ff, 0x0a0c14, 0.6));
    const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(-1.5, 2.5, 4); scene.add(key);
    const rimBlue = new T.DirectionalLight(0x2f7bff, 3.0); rimBlue.position.set(3, -2.5, -2); scene.add(rimBlue);
    const rimViolet = new T.DirectionalLight(0x9a4dff, 2.4); rimViolet.position.set(-3.5, 2.5, -2.5); scene.add(rimViolet);

    // model is X = length (body at -X), Y = face normal, Z = width. Stand it up facing the camera.
    const tiltRig = new T.Group(); scene.add(tiltRig);
    const orient = new T.Group(); orient.rotation.x = Math.PI / 2; tiltRig.add(orient);
    const root = gltf.scene.clone(true);
    orient.add(root);
    const box = new T.Box3().setFromObject(orient);
    const c = box.getCenter(new T.Vector3());
    orient.position.sub(c);

    const part = {};
    root.traverse((o) => { if (o.name) part[o.name] = o; });
    // each fret, strum bar and button gets its own material so it can glow on its own
    const own = (o) => { o.material = o.material.clone(); o.material.emissive = new T.Color(0); return o.material; };
    const mats = {};
    for (const [n, node] of Object.entries(FRETS)) mats[n] = own(part[node]);
    mats.strum = own(part.Strummer);
    mats.star = own(part.button_Back);
    mats.plus = own(part.button_Start);
    mats.whammy = own(part.whammy_Bar);
    const rest = {};
    for (const n of [...Object.values(FRETS), 'Strummer', 'button_Back', 'button_Start', 'whammy_Bar']) {
      rest[n] = { p: part[n].position.clone(), r: part[n].rotation.clone() };
    }

    const camera = new T.PerspectiveCamera(22, ASPECT, 0.1, 50);
    const HOME = new T.Vector3(0.2, 0.5, 2.7);
    camera.position.copy(HOME);
    const controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.enablePan = false; controls.minDistance = 1.6; controls.maxDistance = 4.5;
    controls.minPolarAngle = 0.35; controls.maxPolarAngle = Math.PI - 0.35;
    controls.target.set(0, 0, 0); controls.update();
    let lastTouch = -1e9;
    controls.addEventListener('start', () => { lastTouch = Infinity; canvas.classList.add('grabbing'); });
    controls.addEventListener('end', () => { lastTouch = performance.now(); canvas.classList.remove('grabbing'); });
    canvas.addEventListener('dblclick', () => { lastTouch = -1e9; });

    const size = () => {
      const w = host.clientWidth || 600;
      // --g3d-maxh (set by the page on a sticky or small stage) caps the height; the model stays fully in frame
      const capCss = parseFloat(getComputedStyle(host).getPropertyValue('--g3d-maxh')) || 1e9;
      const h = Math.max(60, Math.round(Math.min(w / ASPECT, host.classList.contains('compact-3d') ? 230 : 1e9, capCss)));
      renderer.setSize(w, h, false); needsDraw = true;
      canvas.style.width = '100%'; canvas.style.height = h + 'px';
      camera.aspect = w / h;
      // keep the whole guitar in frame on narrow screens
      camera.zoom = Math.min(1, (w / h) / ASPECT * 1.04);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(host);
    addEventListener('resize', size);   // a media query can change the height cap without changing the width

    let visible = false;
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; loop(); });
    io.observe(host);
    document.addEventListener('visibilitychange', () => loop());

    let moving = true;   // render only while something is still easing, pulsing or being dragged
    const ease = (cur, target, k) => {
      const d = target - cur;
      if (Math.abs(d) < 1e-5) return target;
      moving = true;
      return cur + d * k;
    };
    const clock = new T.Clock();
    const tmp = new T.Color();
    let running = false, needsDraw = true;
    function frame() {
      const dt = Math.min(clock.getDelta(), 0.05);
      const still = reduceMotion();   // reduced motion: jump straight to the new pose
      const k = still ? 1 : 1 - Math.exp(-dt * 22), kSlow = still ? 1 : 1 - Math.exp(-dt * 7);
      const t = clock.elapsedTime;
      const pulse = reduceMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4.2);
      const focus = (n) => st.focus.includes(n) || st.hover === n;   // hovering a clickable part pulses it like a focus
      moving = st.focus.length > 0 && !reduceMotion();

      for (const [n, node] of Object.entries(FRETS)) {
        const on = st.pressed[n];
        const p = part[node];
        p.position.y = ease(p.position.y, rest[node].p.y - (on ? 0.0035 : 0), k);
        const m = mats[n];
        if (on) { tint(m, st.colors[n]); m.emissiveIntensity = ease(m.emissiveIntensity, 1.4, k); }
        else if (focus(n)) { tint(m, st.colors[n]);   // the fret being asked for glows in its own colour
           m.emissiveIntensity = ease(m.emissiveIntensity, 0.4 + 0.9 * pulse, k); }
        else m.emissiveIntensity = ease(m.emissiveIntensity, 0, k);
      }
      // strum bar rocks on its long axis
      const sb = part.Strummer;
      const strumT = st.pressed.strumUp ? -0.32 : st.pressed.strumDown ? 0.32 : 0;
      sb.rotation.x = ease(sb.rotation.x, rest.Strummer.r.x + strumT, k);
      glow(mats.strum, strumT !== 0, focus('strumUp') || focus('strumDown'), 0xffffff);
      // buttons: back = star power, start = plus
      press(part.button_Back, rest.button_Back, mats.star, st.pressed.star, focus('star'), 0xfacc15);
      press(part.button_Start, rest.button_Start, mats.plus, st.pressed.plus, focus('plus'), 0x38e1c6);
      // whammy: tip goes down towards the body as the bar is pushed
      const wb = part.whammy_Bar;
      wb.rotation.z = ease(wb.rotation.z, rest.whammy_Bar.r.z - st.whammy * 0.36, k);
      glow(mats.whammy, st.whammy > 0.02, focus('whammy'), 0x1cc6ff, 0.35 + st.whammy * 0.6);
      // tilt: neck up, like lifting the guitar for star power
      const wobble = focus('tilt') && !st.tilt && !reduceMotion() ? Math.sin(t * 2.2) * 0.05 : 0;
      tiltRig.rotation.z = ease(tiltRig.rotation.z, (st.tilt ? 0.3 : 0) + wobble, kSlow);

      function tint(m, col) {
        tmp.set(col);
        if (Math.abs(m.emissive.r - tmp.r) + Math.abs(m.emissive.g - tmp.g) + Math.abs(m.emissive.b - tmp.b) > 1e-3) { m.emissive.lerp(tmp, k); moving = true; }
      }
      function glow(m, on, foc, col, lvl = 0.9) {
        if (on) { tint(m, col); m.emissiveIntensity = ease(m.emissiveIntensity, lvl, k); }
        else if (foc) { tint(m, FOCUS_COLOR); m.emissiveIntensity = ease(m.emissiveIntensity, 0.4 + 0.9 * pulse, k); }
        else m.emissiveIntensity = ease(m.emissiveIntensity, 0, k);
      }
      function press(p, r, m, on, foc, col) {
        p.position.y = ease(p.position.y, r.p.y - (on ? 0.006 : 0), k);
        glow(m, on, foc, col);
      }

      // drift back to the front view a few seconds after the user lets go
      if (performance.now() - lastTouch > 3500 && camera.position.distanceToSquared(HOME) > 1e-6) { camera.position.lerp(HOME, kSlow * 0.5); moving = true; }
      if (controls.update()) moving = true;
      if (lastTouch === Infinity) moving = true;
      if (moving || needsDraw) { renderer.render(scene, camera); needsDraw = false; }
    }
    function loop() {
      const want = visible && !document.hidden && !disposed;
      if (want === running) return;
      running = want;
      if (want) { clock.getDelta(); renderer.setAnimationLoop(frame); } else renderer.setAnimationLoop(null);
    }
    api.dispose = () => { disposed = true; loop(); ro.disconnect(); io.disconnect(); renderer.dispose(); };

    // click-to-map: a click (not a drag) on a fret, the strum bar or a button reports its FUNCS name.
    // Meshes may be nested, so walk up the parents until one of the named nodes is found.
    if (onPart) {
      const NODE_FUNC = { Strummer: 'strumUp', button_Back: 'star', button_Start: 'plus', whammy_Bar: 'whammy' };
      for (const [n, node] of Object.entries(FRETS)) NODE_FUNC[node] = n;
      // The bundled three.js has no Raycaster, so hit-test in screen space instead: project each part's
      // world bounding box to the canvas and take the smallest box under the pointer (a fret sits inside
      // the neck's box, so "smallest" is the part). The strum bar splits into up (upper half) / down.
      const corner = new T.Vector3(), box = new T.Box3();
      const screenBox = (o, r) => {
        box.setFromObject(o);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          const x = (corner.x + 1) / 2 * r.width, y = (1 - corner.y) / 2 * r.height;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        return [x0, y0, x1, y1];
      };
      const pick = (e) => {
        const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, pad = 4;
        scene.updateMatrixWorld(true);
        let best = '', area = 1e18;
        for (const [node, name] of Object.entries(NODE_FUNC)) {
          if (!part[node]) continue;
          const [x0, y0, x1, y1] = screenBox(part[node], r);
          if (px < x0 - pad || px > x1 + pad || py < y0 - pad || py > y1 + pad) continue;
          const a = (x1 - x0) * (y1 - y0);
          if (a < area) { area = a; best = name === 'strumUp' && py > (y0 + y1) / 2 ? 'strumDown' : name; }
        }
        return best;
      };
      let down = null, hoverRaf = 0;
      canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
      canvas.addEventListener('pointerup', (e) => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }   // a drag turns the model
        down = null;
        const n = pick(e);
        if (n) onPart(n);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (down || e.pointerType === 'touch' || hoverRaf) return;
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          const n = pick(e);
          if (n !== st.hover) { st.hover = n; needsDraw = true; canvas.style.cursor = n ? 'pointer' : ''; }
        });
      });
      canvas.addEventListener('pointerleave', () => { if (st.hover) { st.hover = ''; needsDraw = true; canvas.style.cursor = ''; } });
    }

    if (force3d) (window.__g3d ||= []).push({ T, scene, camera, controls, orient, part, mats });
    size();
    host.appendChild(canvas);
    onReady?.(canvas);
    loop();
  }).catch((e) => { console.warn('3D guitar unavailable:', e); onFail?.(e); });

  return api;
}
