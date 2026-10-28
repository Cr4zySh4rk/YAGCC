// Surface region growing over a soup primitive: start at the triangle nearest to `seed`, cross edges whose dihedral angle (between the two
// face normals) is below `ang` degrees, stay inside `box` (centroid test, optional). Used to cut pieces that the artist modelled as one shell
// but separated by creases / seam grooves (Xbox One bumpers and triggers). Returns a Set of triangle indices.
export function triAdjacency(p, q = 1e-5) {
  const nt = p.idx.length / 3, key = new Map(), vid = new Int32Array(p.pos.length / 3);
  for (let i = 0; i < vid.length; i++) { const k = Math.round(p.pos[i*3]/q) + ',' + Math.round(p.pos[i*3+1]/q) + ',' + Math.round(p.pos[i*3+2]/q); let j = key.get(k); if (j === undefined) key.set(k, j = i); vid[i] = j; }
  const edges = new Map(), adj = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = vid[p.idx[t*3+k]], b = vid[p.idx[t*3+(k+1)%3]], key2 = a < b ? a + '_' + b : b + '_' + a, o = edges.get(key2);
    if (o === undefined) edges.set(key2, t); else if (o !== t) { adj[t].push(o); adj[o].push(t); }
  }
  const nrm = new Float32Array(nt * 3), cen = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const P = [0, 1, 2].map((k) => [0, 1, 2].map((d) => p.pos[p.idx[t*3+k]*3+d]));
    const u = [0, 1, 2].map((d) => P[1][d] - P[0][d]), v = [0, 1, 2].map((d) => P[2][d] - P[0][d]);
    const c = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]], l = Math.hypot(...c) || 1;
    nrm.set(c.map((x) => x / l), t * 3); cen.set([0, 1, 2].map((d) => (P[0][d] + P[1][d] + P[2][d]) / 3), t * 3);
  }
  return { adj, nrm, cen, nt };
}
export function flood(g, seed, { ang = 40, box = null, tris = null } = {}) {
  let best = -1, bd = 1e9;
  for (let t = 0; t < g.nt; t++) { if (tris && !tris.has(t)) continue; const d = Math.hypot(g.cen[t*3]-seed[0], g.cen[t*3+1]-seed[1], g.cen[t*3+2]-seed[2]); if (d < bd) { bd = d; best = t; } }
  const cos = Math.cos(ang * Math.PI / 180), seen = new Set([best]), st = [best];
  const inb = (t) => !box || [0,1,2].every((d) => g.cen[t*3+d] >= box[d] && g.cen[t*3+d] <= box[d+3]);
  while (st.length) { const t = st.pop(); for (const o of g.adj[t]) { if (seen.has(o) || (tris && !tris.has(o)) || !inb(o)) continue; const dot = g.nrm[t*3]*g.nrm[o*3] + g.nrm[t*3+1]*g.nrm[o*3+1] + g.nrm[t*3+2]*g.nrm[o*3+2]; if (dot < cos) continue; seen.add(o); st.push(o); } }
  return seen;
}
