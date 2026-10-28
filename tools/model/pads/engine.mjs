// Pad model engine: bake -> normalise -> carve named parts -> write GLB. Configs live in build_pads.mjs
import { Document } from '@gltf-transform/core';
import { reduce, io, bake, splitBox, components, subset, merge, bboxOf, fmt, rotX, rotY, mmul, ident, normalise, addPrim, xp, xn } from './lib.mjs';

// part selectors ---------------------------------------------------------------------------
export const inBox = (c, b) => [0,1,2].every((d) => c[d] >= b[d] && c[d] <= b[d+3]);   // box = [x0,y0,z0,x1,y1,z1]

export function carve(soup, parts, opt = {}) {
  const P = soup.map((p) => ({ p, comps: components(p, opt.weld || 1e-4), taken: new Uint8Array(p.idx.length / 3) }));
  P.forEach((q, pi) => q.comps.forEach((c, ci) => { c.pi = pi; c.ci = ci; c.center = c.min.map((v, d) => (v + c.max[d]) / 2); }));
  const all = P.flatMap((q) => q.comps); all.forEach((c, i) => { c.gi = i; });
  const out = [];
  const dropped = [];
  for (const def of opt.drop || []) for (const c of all) if (def(c, soup[c.pi]) ) { for (const t of c.tris) P[c.pi].taken[t] = 1; dropped.push(c); }
  for (const part of parts) {
    const picked = [];   // [pi, tris[]]
    if (part.comp) for (const c of all) { const q = P[c.pi]; const tris = c.tris.filter((t) => !q.taken[t]); if (tris.length && part.comp(c, q.p)) picked.push([c.pi, tris]); }
    if (part.tri) for (let pi = 0; pi < P.length; pi++) {
      const q = P[pi], tris = [];
      for (let t = 0; t < q.taken.length; t++) {
        if (q.taken[t]) continue;
        const i = t * 3, p = q.p; let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) { cx += p.pos[p.idx[i+k]*3]; cy += p.pos[p.idx[i+k]*3+1]; cz += p.pos[p.idx[i+k]*3+2]; }
        if (part.tri([cx/3, cy/3, cz/3], p)) tris.push(t);
      }
      if (tris.length) picked.push([pi, tris]);
    }
    // a part may be given several times (merge): same name -> merged later
    for (const [pi, tris] of picked) for (const t of tris) P[pi].taken[t] = 1;
    out.push({ part, picked });
  }
  return { P, out, dropped };
}

export function pivotOf(spec, bb) {
  if (Array.isArray(spec)) return spec;
  if (typeof spec === 'function') return spec(bb);
  switch (spec || 'center') {
    case 'center': return bb.c;
    case 'base': return [bb.c[0], bb.min[1], bb.c[2]];
    case 'top': return [bb.c[0], bb.max[1], bb.c[2]];
    case 'back': return [bb.c[0], bb.c[1], bb.min[2]];     // far edge (away from the player): hinge of a trigger
    case 'backbase': return [bb.c[0], bb.min[1], bb.min[2]];
    default: throw new Error('pivot ' + spec);
  }
}

// write document. cfg.mats: optional function(doc, soupMaterials) to tweak materials
export function write(soup, res, cfg, outPath, srcDoc) {
  const doc = srcDoc; const root = doc.getRoot();
  const scene = root.listScenes()[0];
  scene.listChildren().forEach((n) => n.dispose()); root.listMeshes().forEach((m) => m.dispose());
  const buf = root.listBuffers()[0] || doc.createBuffer();
  const top = doc.createNode(cfg.name).setExtras({ pad: cfg.name, ...(cfg.extras || {}) }); scene.addChild(top);
  const byName = new Map();
  for (const { part, picked } of res.out) {
    if (!picked.length) { console.warn('  part EMPTY:', part.name); continue; }
    const prims = picked.map(([pi, tris]) => subset(res.P[pi].p, tris));   // pivot applied below
    const allp = merge(prims.map((q, i) => ({ ...q, mat: q.mat })));
    const bb = bboxOf(allp);
    let n = byName.get(part.name);
    if (n) throw new Error('duplicate part ' + part.name + ' (merge selectors instead)');
    const piv = pivotOf(part.pivot, bb);
    const node = doc.createNode(part.name).setTranslation(piv);
    const mesh = doc.createMesh(part.name);
    for (const q of prims) { for (let i = 0; i < q.pos.length; i += 3) for (let d = 0; d < 3; d++) q.pos[i+d] -= piv[d]; }
    // one primitive per material
    const byMat = new Map();
    for (const q of prims) { const k = q.mat; (byMat.get(k) || byMat.set(k, []).get(k)).push(q); }
    for (const [, list] of byMat) addPrim(doc, buf, mesh, reduce(merge(list), (cfg.budget?.parts || {})[part.name] ?? cfg.budget?.part ?? 1500), part.name);
    node.setMesh(mesh);
    const lb = { min: bb.min.map((v, d) => v - piv[d]), max: bb.max.map((v, d) => v - piv[d]) };
    node.setExtras({ ...(part.x || {}), role: part.role, size: [lb.max[0]-lb.min[0], lb.max[2]-lb.min[2]].map((v) => +v.toFixed(4)), top: [+((lb.min[0]+lb.max[0])/2).toFixed(4), +lb.max[1].toFixed(4), +((lb.min[2]+lb.max[2])/2).toFixed(4)], hgt: +(lb.max[1]-lb.min[1]).toFixed(4) });
    top.addChild(node); byName.set(part.name, node);
  }
  // static: whatever is left, merged per material
  const rest = new Map();
  res.P.forEach((q) => {
    const tris = []; for (let t = 0; t < q.taken.length; t++) if (!q.taken[t]) tris.push(t);
    if (tris.length) { const s = subset(q.p, tris); (rest.get(s.mat) || rest.set(s.mat, []).get(s.mat)).push(s); }
  });
  let k = 0, totalT = 0; for (const list of rest.values()) for (const s of list) totalT += s.idx.length / 3;
  for (const [mat, list] of rest) { const m0 = merge(list); const share = (m0.idx.length / 3) / totalT; const mesh = doc.createMesh('body' + k); addPrim(doc, buf, mesh, reduce(m0, Math.max(300, Math.round((cfg.budget?.static ?? 12000) * share))), 'body'); top.addChild(doc.createNode('body' + (k++)).setMesh(mesh).setExtras({ role: 'static' })); }
  return doc;
}

export async function run(cfg) {
  const doc = await io.read(cfg.src);
  const M = cfg.matrix ? cfg.matrix : mmul(rotY(cfg.rotY || 0), rotX(cfg.rotX || 0));
  const soup = cfg.soup ? await cfg.soup(doc) : bake(doc, M);
  const nm = cfg.soup ? null : normalise(soup, cfg.width || 2, cfg.centre);
  if (cfg.pre) cfg.pre(soup, doc);
  const res = carve(soup, cfg.parts, { drop: cfg.drop });
  if (cfg.post) for (const q of res.P) { const W = cfg.post; for (let i = 0; i < q.p.pos.length; i += 3) { const v = xp(W, q.p.pos[i], q.p.pos[i+1], q.p.pos[i+2]); q.p.pos.set(v, i); const n = xn(W, q.p.nor[i], q.p.nor[i+1], q.p.nor[i+2]); q.p.nor.set(n, i); } }
  if (cfg.mats) cfg.mats(doc);
  const d = write(soup, res, cfg, cfg.out, doc);
  return { doc: d, soup, res, nm };
}
