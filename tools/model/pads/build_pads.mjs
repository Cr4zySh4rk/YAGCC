// Builds the rigged pad models for the Test page: node build_pads.mjs <xbox360|xboxone|ds4|ds5|joycon|all> [srcdir] [outdir]
// Sources are the artists' models (see tools/model/README.md); every output gets the same node names:
//   btn_a btn_b btn_x btn_y (outputs 1-4, by POSITION: bottom/right/left/top), lb rb lt rt, back start guide, ls rs (stick caps, tilt + click),
//   dpad (one piece that tilts) or dpad_up/down/left/right (four keys). Node extras carry role, cap size and top centre (for label decals).
import fs from 'node:fs';
import sharp from 'sharp';
import { run, inBox } from './engine.mjs';
import { triAdjacency, flood } from './flood.mjs';
import { components } from './lib.mjs';
import { xp, io, bake, normalise, rotX, rotY, mmul, shift, boxPrim, splitBody, bboxOf } from './lib.mjs';
import { splitPlane, subset } from './lib.mjs';

const [, , which = 'all', SRC = 'src', OUT = 'out'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const ids = (...a) => { const s = new Set(a); return (c) => s.has(c.gi); };
const mat = (doc, n) => doc.getRoot().listMaterials().find((m) => m.getName() === n);
const plastic = (m, rgb, rough = 0.38, metal = 0) => m && m.setBaseColorFactor([...rgb, 1]).setRoughnessFactor(rough).setMetallicFactor(metal).setBaseColorTexture(null).setEmissiveFactor([0, 0, 0]);
const stickPivot = (y) => (bb) => [bb.c[0], y ?? bb.min[1], bb.c[2]];
const hingeTop = (bb) => [bb.c[0], bb.max[1] - 0.01, bb.c[2]];
const hingeBar = (bb) => [bb.c[0], bb.c[1], bb.c[2]];
const P = (name, role, pick, pivot) => ({ name, role, pivot, ...pick });

const CONFIGS = {
  // ---------------------------------------------------------------- Xbox 360 (matok39x, converted from .blend with tools/model/convert_blend.py)
  xbox360: () => ({
    name: 'xbox360', src: `${SRC}/x360_raw.glb`, out: `${OUT}/pad_xbox360.glb`, rotX: 0,
    drop: [(c, p) => ['x9.001', 'x10.001', 'x11.001', 'x12.001'].includes(p.name)],      // glass lens overlays
    budget: { part: 1400, parts: { ls: 2600, rs: 2600, dpad: 1800, lb: 900, rb: 900, lt: 1200, rt: 1200 }, static: 14000 },
    parts: [
      P('btn_a', 'btn', { comp: (c, p) => p.name === 'x10.003' }), P('btn_b', 'btn', { comp: (c, p) => p.name === 'x12.003' }),
      P('btn_x', 'btn', { comp: (c, p) => p.name === 'x9.002' }), P('btn_y', 'btn', { comp: (c, p) => p.name === 'x11.003' }),
      P('back', 'btn', { comp: (c, p) => p.name === 'x8.002' }), P('start', 'btn', { comp: (c, p) => p.name === 'x6.003' }),
      P('guide', 'btn', { comp: (c, p) => ['x1.003', 'x17.002', 'x19.002'].includes(p.name) }),
      P('dpad', 'dpad', { comp: (c, p) => p.name === 'x13.002' }),
      // the bumpers are the two shiny caps of ONE strip (prim x360gp.002 / gamepad_shiny_plastic, x -0.80..0.80); the middle of the strip (|x| < 0.44, hidden behind the
      // black bar x7.004, which is static trim and not a bumper) stays with the body
      P('lb', 'bump', { tri: (c, p) => p.name === 'x360gp.002' && p.mat?.getName() === 'gamepad_shiny_plastic' && c[0] < -0.44 }, hingeBar),
      P('rb', 'bump', { tri: (c, p) => p.name === 'x360gp.002' && p.mat?.getName() === 'gamepad_shiny_plastic' && c[0] > 0.44 }, hingeBar),
      P('lt', 'trig', { comp: (c, p) => p.name === 'x14.002' }, hingeTop), P('rt', 'trig', { comp: (c, p) => p.name === 'x15.002' }, hingeTop),
      P('ls', 'stick', { comp: (c, p) => p.name === 'x20.002' }, stickPivot(0.56)), P('rs', 'stick', { comp: (c, p) => p.name === 'x18.002' }, stickPivot(0.56)),
    ],
    mats(doc) {
      plastic(mat(doc, 'gamepad_shiny_plastic'), [0.93, 0.93, 0.92], 0.3); plastic(mat(doc, 'gamepad'), [0.88, 0.88, 0.87], 0.35);
      plastic(mat(doc, 'x'), [0.97, 0.97, 0.96], 0.25); plastic(mat(doc, 'rubber'), [0.72, 0.73, 0.75], 0.75); plastic(mat(doc, 'Xbig'), [0.05, 0.05, 0.05], 0.4);
      const g = mat(doc, 'green_emission'); g && g.setBaseColorFactor([0.25, 0.8, 0.12, 1]).setEmissiveFactor([0.12, 0.5, 0.05]).setRoughnessFactor(0.4);
    },
  }),

  // ---------------------------------------------------------------- Xbox One / Series (CREATRBOI): one shell, so triggers/bumpers are cut out of it with exact plane cuts
  xboxone: () => {
    // One shell. The bumper (the curved band along the top of the rear edge) and the trigger (the D-shaped panel below it) are separated from the shell and from each other
    // by modelled seam grooves, so they are cut out by region growing over the surface that stops at those creases (flood.mjs; seeds are in the levelled pose).
    const SEL = {}, SEED = { lt: [-0.58, 0.3, -0.6], rt: [0.58, 0.3, -0.6], lb: [-0.47, 0.6, -0.45], rb: [0.47, 0.6, -0.45] };
    const sel = (k) => (c, p, t) => SEL[k].has(t) && p === SEL.body;
    return {
      name: 'xboxone', src: `${SRC}/white_xbox_controller.glb`, out: `${OUT}/pad_xboxone.glb`, rotX: -90,
      post: rotX(54.8),   // the model sits tilted on its grips; the output is levelled (face up)
      budget: { part: 1000, parts: { ls: 2200, rs: 2200, dpad: 1800, lt: 1200, rt: 1200, lb: 900, rb: 900 }, static: 14000 },
      pre(soup) {
        const body = soup[0], W = rotX(54.8), lev = { pos: new Float32Array(body.pos.length), idx: body.idx };
        for (let i = 0; i < body.pos.length; i += 3) lev.pos.set(xp(W, body.pos[i], body.pos[i+1], body.pos[i+2]), i);
        const g = triAdjacency(lev), main = new Set(components(body)[0].tris);
        SEL.body = body;
        for (const [k, seed] of Object.entries(SEED)) { SEL[k] = flood(g, seed, { ang: 35, tris: main }); console.log('  xboxone', k, SEL[k].size, 'tris'); }
      },
      parts: [
        P('btn_a', 'btn', { comp: ids(8) }), P('btn_b', 'btn', { comp: ids(5) }), P('btn_x', 'btn', { comp: ids(9) }), P('btn_y', 'btn', { comp: ids(11) }),
        P('back', 'btn', { comp: ids(13) }), P('start', 'btn', { comp: ids(12) }), P('guide', 'btn', { comp: ids(14, 15) }),
        P('dpad', 'dpad', { comp: ids(1) }),
        P('ls', 'stick', { comp: ids(4, 17, 7) }, stickPivot()), P('rs', 'stick', { comp: ids(3, 16, 6) }, stickPivot()),
        P('lt', 'trig', { tri: sel('lt') }, hingeTop), P('rt', 'trig', { tri: sel('rt') }, hingeTop),
        P('lb', 'bump', { tri: sel('lb') }, hingeBar), P('rb', 'bump', { tri: sel('rb') }, hingeBar),
      ],
      mats(doc) { for (const m of doc.getRoot().listMaterials()) { plastic(m, [0.93, 0.93, 0.92], 0.34); m.setExtension('KHR_materials_pbrSpecularGlossiness', null); } },
    };
  },

  // ---------------------------------------------------------------- DualShock 4 (shaielwolf): symbols / SHARE / OPTIONS / PS are already in its textures
  ds4: () => ({
    name: 'ds4', src: `${SRC}/dualshock_4_playstation_controller_1k.glb`, out: `${OUT}/pad_ds4.glb`, rotX: -90,
    budget: { part: 800, parts: { ls: 1500, rs: 1500, lt: 1800, rt: 1800, guide: 1000 }, static: 12000 },
    parts: [
      P('btn_a', 'btn', { comp: ids(16) }), P('btn_b', 'btn', { comp: ids(15) }), P('btn_x', 'btn', { comp: ids(14) }), P('btn_y', 'btn', { comp: ids(13) }),
      P('dpad_up', 'dpad4', { comp: ids(9) }), P('dpad_left', 'dpad4', { comp: ids(10) }), P('dpad_down', 'dpad4', { comp: ids(11) }), P('dpad_right', 'dpad4', { comp: ids(12) }),
      P('back', 'btn', { comp: ids(8) }), P('start', 'btn', { comp: ids(7) }), P('guide', 'btn', { comp: ids(6) }),
      P('ls', 'stick', { comp: ids(5) }, stickPivot()), P('rs', 'stick', { comp: ids(4) }, stickPivot()),
      P('lt', 'trig', { comp: ids(17, 21) }, hingeTop), P('rt', 'trig', { comp: ids(18, 22) }, hingeTop),
      P('lb', 'bump', { comp: ids(19) }, hingeBar), P('rb', 'bump', { comp: ids(20) }, hingeBar),
    ],
  }),

  // ---------------------------------------------------------------- DualSense (EROLDINA): one fused shell, so the small buttons are cut out of it with boxes (cfg.late)
  ds5: () => {
    const CR = [-0.575, 0.5, -0.59, -0.51, 0.95, -0.49], OP = [0.51, 0.5, -0.59, 0.575, 0.95, -0.49];      // Create / Options ovals
    const PS = [-0.075, 0.5, -0.04, 0.075, 0.95, 0.06], MU = [-0.06, 0.5, 0.1, 0.06, 0.95, 0.2];          // PS button, mute button
    const inb = (b) => (c) => inBox(c, b);
    return {
      name: 'ds5', src: `${SRC}/dualsense_model_updated.glb`, out: `${OUT}/pad_ds5.glb`,
      budget: { part: 600, parts: { ls: 1500, rs: 1500, lt: 1800, rt: 1800, lb: 1800, rb: 1800 }, static: 30000 },
      drop: [(c) => [433, 434, 435, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451].includes(c.gi)],   // the embossed PlayStation logo: a neutral disc is drawn instead
      parts: [
        P('btn_a', 'btn', { comp: ids(6, 655) }), P('btn_b', 'btn', { comp: ids(8, 653) }), P('btn_x', 'btn', { comp: ids(5, 652) }), P('btn_y', 'btn', { comp: ids(7, 654) }),
        P('dpad_up', 'dpad4', { comp: ids(4, 650) }), P('dpad_right', 'dpad4', { comp: ids(3, 649) }), P('dpad_down', 'dpad4', { comp: ids(1, 648) }), P('dpad_left', 'dpad4', { comp: ids(2, 651) }),
        P('ls', 'stick', { comp: ids(439) }, stickPivot()), P('rs', 'stick', { comp: ids(440) }, stickPivot()),
        // loose pieces in the source: 437/521 = L2/R2 trigger (the long curved piece), 438/522 = L1/R1 bumper (the short cap in the shoulder recess above it)
        P('lt', 'trig', { comp: ids(437) }, hingeTop), P('rt', 'trig', { comp: ids(521) }, hingeTop),
        P('lb', 'bump', { comp: ids(438) }, hingeBar), P('rb', 'bump', { comp: ids(522) }, hingeBar),
      ],
      mats(doc) { plastic(mat(doc, 'buttons_inner'), [0.93, 0.93, 0.96], 0.42); },
      late: {
        boxes: [CR, OP, PS],
        parts: [
          P('back', 'btn', { tri: inb(CR) }), P('start', 'btn', { tri: inb(OP) }), P('guide', 'btn', { tri: inb(PS) }),
        ],
      },
    };
  },

  // ---------------------------------------------------------------- Joy-Con pair (Hayley Jacka): the model is the right one; the left one is its TRUE MIRROR (x negated, winding flipped, normals mirrored),
  // recoloured blue, with the stick and the four direction buttons swapped along the length (a left Joy-Con has the stick on top, the cross below) by swapping the two face bands of the shell
  joycon: () => {
    const MJ = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1], W = 0.9, GAP = 0.34;
    const ZC = [-0.94, -0.30], ZS = [-0.26, 0.38], DZ = 0.68, YSKIN = 0.45, XS = 0.34;   // face bands (in the normalised frame): button cluster / stick; skin = y above the underside
    return {
      name: 'joycon', src: `${SRC}/nintendo_switch_joycon.glb`, out: `${OUT}/pad_joycon.glb`,
      budget: { part: 700, parts: { rs: 1800, ls: 1800 }, static: 9000 },
      async soup(doc) {
        const R = bake(doc, MJ); const nr = normalise(R, W);
        const L = bake(doc, MJ);
        for (const p of L) {
          for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] = -(p.pos[i] - nr.off[0]) * nr.k; p.pos[i+1] = (p.pos[i+1] - nr.off[1]) * nr.k; p.pos[i+2] = (p.pos[i+2] - nr.off[2]) * nr.k; p.nor[i] = -p.nor[i]; }   // mirror across the left-right plane
          for (let t = 0; t < p.idx.length; t += 3) { const b = p.idx[t+1]; p.idx[t+1] = p.idx[t+2]; p.idx[t+2] = b; }   // flip winding so lighting / culling stay right
        }
        const dx = (W + GAP) / 2;
        R.forEach((p) => { p.name = 'R:' + p.name; }); L.forEach((p) => { p.name = 'L:' + p.name; });
        // blue body (hue-shifted copy of the red texture)
        const red = doc.getRoot().listMaterials().find((m) => m.getName() === 'Red_Sections');
        const img = red.getBaseColorTexture().getImage();
        const blueImg = await sharp(Buffer.from(img)).modulate({ hue: 188 }).png().toBuffer();
        const blue = red.clone().setName('Blue_Sections').setBaseColorTexture(doc.createTexture('blue').setImage(blueImg).setMimeType('image/png'));
        for (const p of L) if (p.mat === red) p.mat = blue;
        // the keys carry printed glyphs (R, ZR, A/B/X/Y, home, plus) in their textures that would read mirrored: give the left ones a plain dark plastic (the page draws arrows / capture on top)
        const g0 = L.find((p) => /^L:Button_R_/.test(p.name)).mat;
        const plain = g0.clone().setName('Grey_plain').setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setBaseColorFactor([0.025, 0.025, 0.03, 1]).setRoughnessFactor(0.4).setMetallicFactor(0);
        for (const p of L) if (/^L:(Button_R_|Button_ZR_|Button_[ABXY]_|Home_Button_|Button_Plus_)/.test(p.name)) p.mat = plain;
        // swap the two face bands of the shell (button cluster <-> stick well) and move the caps with them
        const bi = L.findIndex((p) => /^L:Base_Combined/.test(p.name)), base = L[bi];
        for (const z of [...ZC, ...ZS]) splitPlane(base, 2, z);
        for (const x of [-XS, XS]) splitPlane(base, 0, x);
        for (let i = 0; i < base.pos.length; i += 3) if (base.pos[i+1] > 0.6 && Math.abs(base.pos[i]) < XS + 0.03 && base.nor[i+1] > 0.7) { base.nor[i] = 0; base.nor[i+1] = 1; base.nor[i+2] = 0; }   // the flat top skin: undo normals the cuts interpolated towards the hole rims
        const cen = (t) => { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = base.idx[t*3+k]; x += base.pos[v*3]; y += base.pos[v*3+1]; z += base.pos[v*3+2]; } return [x/3, y/3, z/3]; };
        const tc = [], ts = [], tr = [];
        for (let t = 0; t < base.idx.length / 3; t++) { const c = cen(t); if (c[1] > YSKIN && Math.abs(c[0]) < XS && c[2] > ZC[0] && c[2] < ZC[1]) tc.push(t); else if (c[1] > YSKIN && Math.abs(c[0]) < XS && c[2] > ZS[0] && c[2] < ZS[1]) ts.push(t); else tr.push(t); }
        const mk = (tris, dz, nm) => { const s = subset(base, tris); for (let i = 2; i < s.pos.length; i += 3) s.pos[i] += dz; return { ...s, name: nm, name0: nm }; };
        L.splice(bi, 1, { ...subset(base, tr), name: 'L:Base_rest' }, mk(tc, DZ, 'L:Base_cluster'), mk(ts, -DZ, 'L:Base_stick'));
        for (const p of L) {
          if (/^L:Button_[ABXY]_/.test(p.name)) for (let i = 2; i < p.pos.length; i += 3) p.pos[i] += DZ;
          if (/^L:Joystick_/.test(p.name)) for (let i = 2; i < p.pos.length; i += 3) p.pos[i] -= DZ;
        }
        // minus bar instead of the plus (now at the top inner corner, as on a real left Joy-Con)
        const plus = L.find((p) => /^L:Button_Plus_/.test(p.name));
        if (plus) { const bb = bboxOf(plus), k = L.indexOf(plus); L[k] = { ...boxPrim(bb.c, [bb.s[0], bb.s[1], bb.s[2] * 0.32], plus.mat), name: plus.name }; }
        shift(R, [dx, 0, 0]); shift(L, [-dx, 0, 0]);
        return [...R, ...L];
      },
      parts: [
        P('btn_a', 'btn', { comp: (c, p) => /^R:Button_B_/.test(p.name) }), P('btn_b', 'btn', { comp: (c, p) => /^R:Button_A_/.test(p.name) }),
        P('btn_x', 'btn', { comp: (c, p) => /^R:Button_X_/.test(p.name) }), P('btn_y', 'btn', { comp: (c, p) => /^R:Button_Y_/.test(p.name) }),
        P('start', 'btn', { comp: (c, p) => /^R:Button_Plus_/.test(p.name) }), P('guide', 'btn', { comp: (c, p) => /^R:Home_Button_/.test(p.name) }),
        P('rs', 'stick', { comp: (c, p) => /^R:Joystick_/.test(p.name) }, stickPivot()),
        P('rb', 'bump', { comp: (c, p) => /^R:(Button_R_|Button_Rmiddle_)/.test(p.name) }, hingeBar), P('rt', 'trig', { comp: (c, p) => /^R:Button_ZR_/.test(p.name) }, hingeTop),
        // left Joy-Con is the mirror image: by position up = Y, down = B, left = A, right = X
        P('dpad_up', 'dpad4', { comp: (c, p) => /^L:Button_Y_/.test(p.name) }), P('dpad_down', 'dpad4', { comp: (c, p) => /^L:Button_B_/.test(p.name) }),
        P('dpad_left', 'dpad4', { comp: (c, p) => /^L:Button_A_/.test(p.name) }), P('dpad_right', 'dpad4', { comp: (c, p) => /^L:Button_X_/.test(p.name) }),
        P('back', 'btn', { comp: (c, p) => /^L:Button_Plus_/.test(p.name) }), P('capture', 'btn', { comp: (c, p) => /^L:Home_Button_/.test(p.name) }),
        P('ls', 'stick', { comp: (c, p) => /^L:Joystick_/.test(p.name) }, stickPivot()),
        P('lb', 'bump', { comp: (c, p) => /^L:(Button_R_|Button_Rmiddle_)/.test(p.name) }, hingeBar), P('lt', 'trig', { comp: (c, p) => /^L:Button_ZR_/.test(p.name) }, hingeTop),
      ],
    };
  },
};

for (const k of which === 'all' ? Object.keys(CONFIGS) : [which]) {
  const cfg = CONFIGS[k]();
  const { doc } = await run(cfg);
  await io.write(cfg.out.replace('.glb', '.raw.glb'), doc);
  console.log('built', k, cfg.out.replace('.glb', '.raw.glb'));
}
