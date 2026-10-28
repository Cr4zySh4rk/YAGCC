// hl2.mjs src rotX rotY "id:color,id:color,..." out.glb  (colors r|g|b|y|m|c|o ; rest grey)
import { io, bake, components, subset, merge, rotX, rotY, mmul, normalise, addPrim } from './lib.mjs';
const [,, f, rx, ry, spec, out] = process.argv;
const COL = { r:[1,.1,.1], g:[.1,.8,.1], b:[.2,.3,1], y:[1,.9,0], m:[1,0,1], c:[0,.9,.9], o:[1,.5,0], k:[0,0,0] };
const want = new Map(spec.split(',').filter(Boolean).map(s => s.split(':')).map(([i,c]) => [+i, c]));
const doc = await io.read(f);
const soup = bake(doc, mmul(rotY(+ry), rotX(+rx))); normalise(soup, 2);
const root = doc.getRoot(), scene = root.listScenes()[0];
scene.listChildren().forEach(n=>n.dispose()); root.listMeshes().forEach(m=>m.dispose());
const buf = root.listBuffers()[0]||doc.createBuffer();
const grey = doc.createMaterial('g').setBaseColorFactor([.75,.75,.8,1]).setRoughnessFactor(.6).setMetallicFactor(0);
const groups = new Map(); const lo = []; let i = 0;
for (const p of soup) for (const c of components(p, 1e-4)) { const k = want.get(i++); const s = subset(p, c.tris); s.mat = null; s.hasUV = false; if (k) { (groups.get(k) || groups.set(k, []).get(k)).push(s); } else lo.push(s); }
const mk = (list, mat, n) => { if (!list.length) return; const m = doc.createMesh(n); const q = merge(list); q.mat = mat; q.hasUV = false; addPrim(doc, buf, m, q); scene.addChild(doc.createNode(n).setMesh(m)); };
mk(lo, grey, 'lo');
for (const [k, l] of groups) mk(l, doc.createMaterial('c'+k).setBaseColorFactor([...COL[k], 1]).setEmissiveFactor(COL[k].map(v=>v*.5)).setRoughnessFactor(.6).setMetallicFactor(0), 'g'+k);
await io.write(out, doc);
