import { io } from './lib.mjs';
const doc = await io.read(process.argv[2]);
for (const n of doc.getRoot().listNodes()) if (n.getExtras()?.role) { const e = n.getExtras(); console.log(n.getName().padEnd(10), e.role.padEnd(7), 'pivot', n.getTranslation().map(v=>v.toFixed(3)).join(','), 'size', e.size?.join('x'), 'hgt', e.hgt, 'top', e.top?.join(',')); }
