// Builds the rigged pad models for the Test page: node build_pads.mjs <xbox360|xboxone|ds4|ds5|joycon|all> [srcdir] [outdir]
// Sources are the artists' models (see tools/model/README.md); every output gets the same node names:
//   btn_a btn_b btn_x btn_y (outputs 1-4, by POSITION: bottom/right/left/top), lb rb lt rt, back start guide, ls rs (stick caps, tilt + click),
//   dpad (one piece that tilts) or dpad_up/down/left/right (four keys). Node extras carry role, cap size and top centre (for label decals).
import fs from 'node:fs';
import sharp from 'sharp';
import { run, inBox } from './engine.mjs';
import { io, bake, normalise, rotX, rotY, mmul, shift, boxPrim, splitBody, bboxOf } from './lib.mjs';

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
      P('lb', 'bump', { tri: (c, p) => p.name === 'x7.004' && c[0] < 0 }, hingeBar), P('rb', 'bump', { tri: (c, p) => p.name === 'x7.004' && c[0] >= 0 }, hingeBar),
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
    const LT = [-1.1, 0, -0.7, -0.45, 0.3, -0.2], RT = [0.45, 0, -0.7, 1.1, 0.3, -0.2];
    const LB = [-1.0, 0.3, -0.7, -0.3, 0.47, -0.5], RB = [0.3, 0.3, -0.7, 1.0, 0.47, -0.5];
    return {
      name: 'xboxone', src: `${SRC}/white_xbox_controller.glb`, out: `${OUT}/pad_xboxone.glb`, rotX: -90,
      post: rotX(54.8),   // the model sits tilted on its grips; the cut boxes below are in that pose, the output is levelled (face up)
      budget: { part: 1000, parts: { ls: 2200, rs: 2200, dpad: 1800, lt: 1200, rt: 1200, lb: 700, rb: 700 }, static: 14000 },
      pre(soup) { splitBody(soup[0], [LT, RT, LB, RB]); },
      parts: [
        P('btn_a', 'btn', { comp: ids(8) }), P('btn_b', 'btn', { comp: ids(5) }), P('btn_x', 'btn', { comp: ids(9) }), P('btn_y', 'btn', { comp: ids(11) }),
        P('back', 'btn', { comp: ids(13) }), P('start', 'btn', { comp: ids(12) }), P('guide', 'btn', { comp: ids(14, 15) }),
        P('dpad', 'dpad', { comp: ids(1) }),
        P('ls', 'stick', { comp: ids(4, 17, 7) }, stickPivot()), P('rs', 'stick', { comp: ids(3, 16, 6) }, stickPivot()),
        P('lt', 'trig', { tri: (c) => inBox(c, LT) }, hingeTop), P('rt', 'trig', { tri: (c) => inBox(c, RT) }, hingeTop),
        P('lb', 'bump', { tri: (c) => inBox(c, LB) }, hingeBar), P('rb', 'bump', { tri: (c) => inBox(c, RB) }, hingeBar),
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
    const LB = [-0.98, 0.45, -0.7, -0.6, 0.85, -0.5], RB = [0.6, 0.45, -0.7, 0.98, 0.85, -0.5];
    const inb = (b) => (c) => inBox(c, b);
    return {
      name: 'ds5', src: `${SRC}/dualsense_model_updated.glb`, out: `${OUT}/pad_ds5.glb`,
      budget: { part: 600, parts: { ls: 1500, rs: 1500, lt: 2500, rt: 2500, lb: 900, rb: 900 }, static: 30000 },
      drop: [(c) => [433, 434, 435, 441, 442, 443, 444, 445, 446, 447, 448, 449, 450, 451].includes(c.gi)],   // the embossed PlayStation logo: a neutral disc is drawn instead
      parts: [
        P('btn_a', 'btn', { comp: ids(6, 655) }), P('btn_b', 'btn', { comp: ids(8, 653) }), P('btn_x', 'btn', { comp: ids(5, 652) }), P('btn_y', 'btn', { comp: ids(7, 654) }),
        P('dpad_up', 'dpad4', { comp: ids(4, 650) }), P('dpad_right', 'dpad4', { comp: ids(3, 649) }), P('dpad_down', 'dpad4', { comp: ids(1, 648) }), P('dpad_left', 'dpad4', { comp: ids(2, 651) }),
        P('ls', 'stick', { comp: ids(439) }, stickPivot()), P('rs', 'stick', { comp: ids(440) }, stickPivot()),
        P('lt', 'trig', { comp: ids(437, 438) }, hingeTop), P('rt', 'trig', { comp: ids(521, 522) }, hingeTop),
      ],
      mats(doc) { plastic(mat(doc, 'buttons_inner'), [0.93, 0.93, 0.96], 0.42); },
      late: {
        boxes: [CR, OP, PS, LB, RB],
        parts: [
          P('back', 'btn', { tri: inb(CR) }), P('start', 'btn', { tri: inb(OP) }), P('guide', 'btn', { tri: inb(PS) }), 
          P('lb', 'bump', { tri: inb(LB) }, hingeBar), P('rb', 'bump', { tri: inb(RB) }, hingeBar),
        ],
      },
    };
  },

  // ---------------------------------------------------------------- Joy-Con pair (Hayley Jacka): the model is the right one; the left one is a copy turned 180 degrees and recoloured
  joycon: () => {
    const MJ = [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1], W = 0.9, GAP = 0.34, SH = /^(Button_R_|Button_Rmiddle_|Button_ZR_)/;
    return {
      name: 'joycon', src: `${SRC}/nintendo_switch_joycon.glb`, out: `${OUT}/pad_joycon.glb`,
      budget: { part: 700, parts: { rs: 1800, ls: 1800 }, static: 9000 },
      async soup(doc) {
        const R = bake(doc, MJ); const nr = normalise(R, W);
        const L = bake(doc, mmul(rotY(180), MJ)); normalise(L, W);
        const SHL = bake(doc, MJ).filter((p) => SH.test(p.name));
        for (const p of SHL) for (let i = 0; i < p.pos.length; i += 3) for (let d = 0; d < 3; d++) p.pos[i+d] = (p.pos[i+d] - nr.off[d]) * nr.k;
        const dx = (W + GAP) / 2;
        R.forEach((p) => { p.name = 'R:' + p.name; }); L.forEach((p) => { p.name = 'L:' + p.name; }); SHL.forEach((p) => { p.name = 'LS:' + p.name; });
        const Lk = L.filter((p) => !SH.test(p.name.slice(2)));
        shift(R, [dx, 0, 0]); shift(Lk, [-dx, 0, 0]); shift(SHL, [-dx, 0, 0]);
        // left Joy-Con: blue body (hue-shifted copy of the red texture), a minus bar instead of the plus, no brand-free change otherwise
        const red = doc.getRoot().listMaterials().find((m) => m.getName() === 'Red_Sections');
        const img = red.getBaseColorTexture().getImage();
        const blueImg = await sharp(Buffer.from(img)).modulate({ hue: 188 }).png().toBuffer();
        const blue = red.clone().setName('Blue_Sections').setBaseColorTexture(doc.createTexture('blue').setImage(blueImg).setMimeType('image/png'));
        for (const p of [...Lk, ...SHL]) if (p.mat === red) p.mat = blue;
        const plus = Lk.find((p) => /^L:Button_Plus_/.test(p.name));
        // a real left Joy-Con has minus near the top and capture near the bottom (the 180-degree copy has them the other way round): swap ends
        if (plus) { const bb = bboxOf(plus), grey = plus.mat; const k = Lk.indexOf(plus); Lk[k] = { ...boxPrim([bb.c[0], bb.c[1], -bb.c[2]], [bb.s[0], bb.s[1], bb.s[2] * 0.32], grey), name: plus.name }; }
        const home = Lk.find((p) => /^L:Home_Button_/.test(p.name));
        if (home) { const bb = bboxOf(home); for (let i = 2; i < home.pos.length; i += 3) home.pos[i] += 1.06 - bb.c[2]; }
        return [...R, ...Lk, ...SHL];
      },
      parts: [
        P('btn_a', 'btn', { comp: (c, p) => /^R:Button_B_/.test(p.name) }), P('btn_b', 'btn', { comp: (c, p) => /^R:Button_A_/.test(p.name) }),
        P('btn_x', 'btn', { comp: (c, p) => /^R:Button_X_/.test(p.name) }), P('btn_y', 'btn', { comp: (c, p) => /^R:Button_Y_/.test(p.name) }),
        P('start', 'btn', { comp: (c, p) => /^R:Button_Plus_/.test(p.name) }), P('guide', 'btn', { comp: (c, p) => /^R:Home_Button_/.test(p.name) }),
        P('rs', 'stick', { comp: (c, p) => /^R:Joystick_/.test(p.name) }, stickPivot()),
        P('rb', 'bump', { comp: (c, p) => /^R:(Button_R_|Button_Rmiddle_)/.test(p.name) }, hingeBar), P('rt', 'trig', { comp: (c, p) => /^R:Button_ZR_/.test(p.name) }, hingeBar),
        P('dpad_up', 'dpad4', { comp: (c, p) => /^L:Button_B_/.test(p.name) }), P('dpad_down', 'dpad4', { comp: (c, p) => /^L:Button_Y_/.test(p.name) }),
        P('dpad_left', 'dpad4', { comp: (c, p) => /^L:Button_A_/.test(p.name) }), P('dpad_right', 'dpad4', { comp: (c, p) => /^L:Button_X_/.test(p.name) }),
        P('back', 'btn', { comp: (c, p) => /^L:Button_Plus_/.test(p.name) }), P('capture', 'btn', { comp: (c, p) => /^L:Home_Button_/.test(p.name) }),
        P('ls', 'stick', { comp: (c, p) => /^L:Joystick_/.test(p.name) }, stickPivot()),
        P('lb', 'bump', { comp: (c, p) => /^LS:(Button_R_|Button_Rmiddle_)/.test(p.name) }, hingeBar), P('lt', 'trig', { comp: (c, p) => /^LS:Button_ZR_/.test(p.name) }, hingeBar),
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
