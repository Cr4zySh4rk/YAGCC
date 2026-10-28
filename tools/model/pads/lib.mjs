// Shared helpers for the pad model pipeline (gltf-transform based). See tools/model/README.md
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// 4x4 column-major helpers
export const mmul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
export const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
export const rotX = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; };
export const rotY = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
export const scaleM = (k) => [k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1];
export const transM = (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
export const xp = (m, x, y, z) => [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
export const xn = (m, x, y, z) => { const v = [m[0]*x+m[4]*y+m[8]*z, m[1]*x+m[5]*y+m[9]*z, m[2]*x+m[6]*y+m[10]*z]; const l = Math.hypot(...v) || 1; return v.map((q) => q / l); };

// soup: flat list of primitives baked into world space: {pos:Float32Array, nor, uv, idx:Uint32Array, mat}
export function bake(doc, M = ident()) {
  const soup = [];
  const scene = doc.getRoot().listScenes()[0];
  const visit = (n) => {
    const m = n.getMesh();
    if (m) for (const p of m.listPrimitives()) {
      const W = mmul(M, n.getWorldMatrix());
      const a = p.getAttribute('POSITION'), no = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0');
      const nv = a.getCount(), pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), e = [0, 0, 0];
      for (let i = 0; i < nv; i++) {
        a.getElement(i, e); pos.set(xp(W, ...e), i * 3);
        if (no) { no.getElement(i, e); nor.set(xn(W, ...e), i * 3); }
        if (uv) { uv.getElement(i, e); uvs.set([e[0], e[1]], i * 2); }
      }
      const ia = p.getIndices();
      const idx = ia ? Uint32Array.from(ia.getArray()) : Uint32Array.from({ length: nv }, (_, i) => i);
      soup.push({ pos, nor, uv: uvs, idx, mat: p.getMaterial(), name: n.getName(), hasUV: !!uv });
    }
    n.listChildren().forEach(visit);
  };
  scene.listChildren().forEach(visit);
  return soup;
}

// split a soup primitive into connected components (vertices welded by quantised position). returns [{tris:[tri indices], bbox, count}]
export function components(p, q = 1e-4) {
  const nv = p.pos.length / 3, par = new Int32Array(nv).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const map = new Map();
  for (let i = 0; i < nv; i++) {
    const k = Math.round(p.pos[i*3]/q) + ',' + Math.round(p.pos[i*3+1]/q) + ',' + Math.round(p.pos[i*3+2]/q);
    const j = map.get(k); if (j === undefined) map.set(k, i); else par[find(i)] = find(j);
  }
  for (let t = 0; t < p.idx.length; t += 3) { const a = find(p.idx[t]), b = find(p.idx[t+1]), c = find(p.idx[t+2]); par[b] = a; par[find(c)] = find(a); }
  const comps = new Map();
  for (let t = 0; t < p.idx.length; t += 3) {
    const r = find(p.idx[t]); let c = comps.get(r); if (!c) comps.set(r, c = { tris: [], min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] });
    c.tris.push(t / 3);
    for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) { const v = p.pos[p.idx[t+k]*3+d]; c.min[d] = Math.min(c.min[d], v); c.max[d] = Math.max(c.max[d], v); }
  }
  return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length);
}

// extract triangles of soup prim p into a new compact prim, positions minus pivot
export function subset(p, tris, pivot = [0,0,0]) {
  const remap = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = p.idx[t*3+k]; let j = remap.get(v);
    if (j === undefined) { j = remap.size; remap.set(v, j); pos.push(p.pos[v*3]-pivot[0], p.pos[v*3+1]-pivot[1], p.pos[v*3+2]-pivot[2]); nor.push(p.nor[v*3], p.nor[v*3+1], p.nor[v*3+2]); uv.push(p.uv[v*2], p.uv[v*2+1]); }
    idx.push(j);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: Uint32Array.from(idx), mat: p.mat, hasUV: p.hasUV };
}
export function merge(list) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const p of list) { pos.push(...p.pos); nor.push(...p.nor); uv.push(...p.uv); for (const i of p.idx) idx.push(i + off); off += p.pos.length / 3; }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: Uint32Array.from(idx), mat: list[0].mat, hasUV: list.some((p) => p.hasUV) };
}
export const bboxOf = (p) => { const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9]; for (let i = 0; i < p.pos.length; i += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], p.pos[i+d]); mx[d] = Math.max(mx[d], p.pos[i+d]); } return { min: mn, max: mx, c: mn.map((v, d) => (v + mx[d]) / 2), s: mn.map((v, d) => mx[d] - v) }; };
export const fmt = (a) => a.map((v) => v.toFixed(3)).join(',');

// emit prim -> gltf Mesh on node
export function addPrim(doc, buf, mesh, p, name) {
  const prim = doc.createPrimitive();
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.pos).setBuffer(buf));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(p.nor).setBuffer(buf));
  if (p.hasUV) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.uv).setBuffer(buf));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(p.idx.length < 65535 && Math.max(...[0]) === 0 ? (p.idx.length ? Uint32Array.from(p.idx) : p.idx) : p.idx).setBuffer(buf));
  if (p.mat) prim.setMaterial(p.mat);
  mesh.addPrimitive(prim);
}

// translate so the bbox centre is x=0,z=0, y min = 0, scale so the width (x) = w. mutates soup. returns {k, off}
export function normalise(soup, w = 2, centre = null) {
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (const p of soup) for (let i = 0; i < p.pos.length; i += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], p.pos[i+d]); mx[d] = Math.max(mx[d], p.pos[i+d]); }
  const k = w / (mx[0] - mn[0]), off = centre || [(mn[0]+mx[0])/2, mn[1], (mn[2]+mx[2])/2];
  for (const p of soup) for (let i = 0; i < p.pos.length; i += 3) for (let d = 0; d < 3; d++) p.pos[i+d] = (p.pos[i+d] - off[d]) * k;
  return { k, off };
}

// split every triangle of p that straddles the plane (axis, value) so each lies on one side (exact, watertight). mutates p
export function splitPlane(p, axis, val, box = null) {
  const pos = Array.from(p.pos), nor = Array.from(p.nor), uv = Array.from(p.uv), idx = [];
  const mid = (a, b) => { // new vertex on edge a-b at the plane
    const t = (val - pos[a*3+axis]) / (pos[b*3+axis] - pos[a*3+axis]), n = pos.length / 3;
    for (let d = 0; d < 3; d++) pos.push(pos[a*3+d] + (pos[b*3+d] - pos[a*3+d]) * t);
    let nn = [0,1,2].map((d) => nor[a*3+d] + (nor[b*3+d] - nor[a*3+d]) * t); const l = Math.hypot(...nn) || 1; nor.push(...nn.map((v) => v / l));
    uv.push(uv[a*2] + (uv[b*2] - uv[a*2]) * t, uv[a*2+1] + (uv[b*2+1] - uv[a*2+1]) * t);
    pos[n*3+axis] = val; return n;
  };
  const cache = new Map();
  const edge = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; let v = cache.get(k); if (v === undefined) cache.set(k, v = mid(Math.min(a, b), Math.max(a, b))); return v; };
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [p.idx[t], p.idx[t+1], p.idx[t+2]], s = v.map((i) => pos[i*3+axis] > val);
    const n = s.filter(Boolean).length;
    if (box && [0, 1, 2].some((d) => Math.max(...v.map((i) => pos[i*3+d])) < box[d] || Math.min(...v.map((i) => pos[i*3+d])) > box[d+3])) { idx.push(...v); continue; }   // only near the box
    if (n === 0 || n === 3 || v.some((i) => pos[i*3+axis] === val)) { idx.push(...v); continue; }
    // rotate so v0 is the lone vertex on its side
    let r = 0; while (!(s.filter((x) => x === s[r]).length === 1)) r++;
    const a = v[r], b = v[(r+1)%3], c = v[(r+2)%3];
    const ab = edge(a, b), ac = edge(a, c);
    idx.push(a, ab, ac, ab, b, c, ab, c, ac);
  }
  p.pos = new Float32Array(pos); p.nor = new Float32Array(nor); p.uv = new Float32Array(uv); p.idx = Uint32Array.from(idx);
}
export const splitBox = (p, b) => { for (let d = 0; d < 3; d++) { splitPlane(p, d, b[d], b); splitPlane(p, d, b[d+3], b); } };

// axis-aligned box prim (flat shaded) for hand-made parts
export function boxPrim(c, s, mat) {
  const pos = [], nor = [], uv = [], idx = [];
  const faces = [[0,1,1],[0,-1,1],[1,1,1],[1,-1,1],[2,1,1],[2,-1,1]];
  for (const [ax, sg] of faces) {
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, base = pos.length / 3;
    for (const [u, v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      const p = [0,0,0]; p[ax] = c[ax] + sg * s[ax] / 2; p[a1] = c[a1] + u * s[a1] / 2; p[a2] = c[a2] + v * s[a2] / 2;
      pos.push(...p); const n = [0,0,0]; n[ax] = sg; nor.push(...n); uv.push(0.5, 0.5);
    }
    if (sg > 0) idx.push(base, base+1, base+2, base, base+2, base+3); else idx.push(base, base+2, base+1, base, base+3, base+2);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), idx: Uint32Array.from(idx), mat, hasUV: true, name: 'box' };
}
export const shift = (soup, d) => { for (const p of soup) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) p.pos[i+k] += d[k]; };

import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
// weld identical vertices (pos+nor+uv) and reduce to ~target triangles keeping borders (part seams); returns a compact prim
export function reduce(q, target) {
  // weld
  const key = new Map(), remap = new Uint32Array(q.pos.length / 3), pos = [], nor = [], uv = [];
  const r = (v) => Math.round(v * 1e5);
  for (let i = 0; i < remap.length; i++) {
    const k = r(q.pos[i*3]) + ',' + r(q.pos[i*3+1]) + ',' + r(q.pos[i*3+2]) + ',' + r(q.nor[i*3]*50) + ',' + r(q.nor[i*3+1]*50) + ',' + r(q.nor[i*3+2]*50) + ',' + r(q.uv[i*2]*200) + ',' + r(q.uv[i*2+1]*200);
    let j = key.get(k); if (j === undefined) { j = pos.length / 3; key.set(k, j); pos.push(q.pos[i*3], q.pos[i*3+1], q.pos[i*3+2]); nor.push(q.nor[i*3], q.nor[i*3+1], q.nor[i*3+2]); uv.push(q.uv[i*2], q.uv[i*2+1]); }
    remap[i] = j;
  }
  let idx = Uint32Array.from(q.idx, (v) => remap[v]);
  const keep = [];   // drop degenerate
  for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t+1] && idx[t+1] !== idx[t+2] && idx[t] !== idx[t+2]) keep.push(idx[t], idx[t+1], idx[t+2]);
  idx = Uint32Array.from(keep);
  let P = new Float32Array(pos), N = new Float32Array(nor), U = new Float32Array(uv);
  const tris = idx.length / 3;
  if (target && tris > target) {
    const attrs = new Float32Array(P.length / 3 * 5);
    for (let i = 0; i < P.length / 3; i++) { attrs.set([N[i*3], N[i*3+1], N[i*3+2], U[i*2], U[i*2+1]], i * 5); }
    const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, P, 3, attrs, 5, [0.5, 0.5, 0.5, 0.3, 0.3], null, Math.floor(target * 3 / 3) * 3, 0.02, ['LockBorder']);
    idx = out;
  }
  // compact
  const used = new Map(), p2 = [], n2 = [], u2 = [], i2 = [];
  for (const v of idx) { let j = used.get(v); if (j === undefined) { j = used.size; used.set(v, j); p2.push(P[v*3], P[v*3+1], P[v*3+2]); n2.push(N[v*3], N[v*3+1], N[v*3+2]); u2.push(U[v*2], U[v*2+1]); } i2.push(j); }
  return { ...q, pos: new Float32Array(p2), nor: new Float32Array(n2), uv: new Float32Array(u2), idx: Uint32Array.from(i2) };
}

// cut the boxes' planes through the biggest connected piece of prim p only (so the numbering of the other pieces stays as listed by comps.mjs)
export function splitBody(p, boxes) {
  const cs = components(p), body = cs[0], isBody = new Set(body.tris), rest = [];
  for (let t = 0; t < p.idx.length / 3; t++) if (!isBody.has(t)) rest.push(t);
  const a = subset(p, body.tris), b = subset(p, rest);
  for (const bx of boxes) splitBox(a, bx);
  const m = merge([a, b]);
  Object.assign(p, { pos: m.pos, nor: m.nor, uv: m.uv, idx: m.idx });
}
