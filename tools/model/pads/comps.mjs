import { io, bake, components, bboxOf, fmt, rotX, rotY, mmul, ident, normalise } from './lib.mjs';
const [,, f, rot='0', minTri='50', rotyDeg='0'] = process.argv;
const doc = await io.read(f);
const soup = bake(doc, mmul(rotY(+rotyDeg), rotX(+rot)));
normalise(soup, 2);
let i = 0;
for (const p of soup) { const cs = components(p, 1e-4); console.log('prim', p.name, p.mat?.getName(), 'verts', p.pos.length/3, 'comps', cs.length);
  for (const c of cs) if (c.tris.length >= +minTri) console.log('   #'+(i++), c.tris.length, 'min', fmt(c.min), 'max', fmt(c.max)); else i++; }
