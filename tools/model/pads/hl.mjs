// hl.mjs src rotX rotY "ids" out.glb : highlight listed component ids red, rest as is (greyish)
import { Document } from '@gltf-transform/core';
import { io, bake, components, subset, merge, rotX, rotY, mmul, normalise, addPrim, splitBox } from './lib.mjs';
const [,, f, rx, ry, ids, out] = process.argv;
const want = new Set(ids.split(',').filter(Boolean).map(Number));
const doc = await io.read(f);
const soup = bake(doc, mmul(rotY(+ry), rotX(+rx))); normalise(soup, 2);
const root = doc.getRoot(), scene = root.listScenes()[0];
scene.listChildren().forEach(n=>n.dispose()); root.listMeshes().forEach(m=>m.dispose());
const buf = root.listBuffers()[0]||doc.createBuffer();
const red = doc.createMaterial('hl').setBaseColorFactor([1,0.1,0.1,1]).setEmissiveFactor([0.6,0,0]);
const grey = doc.createMaterial('g').setBaseColorFactor([.75,.75,.8,1]).setRoughnessFactor(.6).setMetallicFactor(0);
const BOX0 = (process.env.TRIBOX||'').split(';').filter(Boolean).map(b=>b.split(',').map(Number)); if (process.env.TRIPRIM) soup.filter((p,k)=>String(k)===process.env.TRIPRIM).forEach(p=>BOX0.forEach(b=>splitBox(p,b)));
let i = 0; const hi = [], lo = [];
const BOX = (process.env.TRIBOX||'').split(';').filter(Boolean).map(b=>b.split(',').map(Number));
const inb = (p,t)=>{let c=[0,0,0];for(let k=0;k<3;k++)for(let d=0;d<3;d++)c[d]+=p.pos[p.idx[t*3+k]*3+d]/3;return BOX.some(b=>[0,1,2].every(d=>c[d]>=b[d]&&c[d]<=b[d+3]));};
for (const p of soup) for (const c of components(p, 1e-4)) { const w = want.has(i++); let a=c.tris, b=[]; if (BOX.length) { a=c.tris.filter(t=>inb(p,t)); b=c.tris.filter(t=>!inb(p,t)); } const mk=(tr,h)=>{ if(!tr.length) return; const s = subset(p, tr); s.mat = null; (h?hi:lo).push(s); }; if (BOX.length) { mk(a,true); mk(b,false);} else mk(a,w); }
const mk = (list, mat, n) => { if (!list.length) return; const m = doc.createMesh(n); const q = merge(list); q.mat = mat; q.hasUV = false; addPrim(doc, buf, m, q); scene.addChild(doc.createNode(n).setMesh(m)); };
mk(hi, red, 'hi'); mk(lo, grey, 'lo');
await io.write(out, doc);
