// Second pass: textures to JPEG/PNG at a sane size, drop unused data, write the final GLB. usage: node optimize_pads.mjs in.raw.glb out.glb [baseColorMax=1024] [otherMax=512]
import sharp from 'sharp';
import { prune, dedup } from '@gltf-transform/functions';
import { io } from './lib.mjs';
const [, , inp, out, bMax = '1024', oMax = '512'] = process.argv;
const doc = await io.read(inp);
const root = doc.getRoot();
const baseTex = new Set(root.listMaterials().flatMap((m) => [m.getBaseColorTexture(), m.getEmissiveTexture()].filter(Boolean)));
for (const t of root.listTextures()) {
  const max = baseTex.has(t) ? +bMax : +oMax;
  const img = sharp(Buffer.from(t.getImage())), meta = await img.metadata();
  const r = img.resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  if (meta.hasAlpha && (await sharp(Buffer.from(t.getImage())).stats()).isOpaque === false) t.setImage(await r.png({ compressionLevel: 9, palette: true }).toBuffer()).setMimeType('image/png');
  else t.setImage(await r.flatten({ background: '#000' }).jpeg({ quality: baseTex.has(t) ? 86 : 80, mozjpeg: true }).toBuffer()).setMimeType('image/jpeg');
}
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'KHR_materials_pbrSpecularGlossiness') e.dispose();
await doc.transform(dedup(), prune());
await io.write(out, doc);
