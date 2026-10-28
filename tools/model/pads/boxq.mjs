// boxq.mjs src rotX rotY x0,y0,z0,x1,y1,z1 : per component, how many triangles have their centroid inside the box
import { io, bake, components, rotX, rotY, mmul, normalise } from './lib.mjs';
const [,, f, rx, ry, bx] = process.argv; const b = bx.split(',').map(Number);
const soup = bake(await io.read(f), mmul(rotY(+ry), rotX(+rx))); normalise(soup, 2);
let i = 0;
for (const p of soup) for (const c of components(p, 1e-4)) { let n = 0; for (const t of c.tris) { const m = [0,0,0]; for (let k=0;k<3;k++) for (let d=0;d<3;d++) m[d]+=p.pos[p.idx[t*3+k]*3+d]/3; if ([0,1,2].every(d=>m[d]>=b[d]&&m[d]<=b[d+3])) n++; } if (n) console.log('#'+i, 'in', n, 'of', c.tris.length); i++; }
