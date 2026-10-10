#!/usr/bin/env node
// Shrink a glTF/GLB for the web with pure-JS tools only (no sharp / native gltfpack):
// textures are decoded (pngjs / jpeg-js), box-downscaled to a maximum size per material slot and re-encoded
// as JPEG (PNG kept when the alpha channel is actually used). Geometry is left untouched.
// The asset's licence metadata (asset.extras) is preserved and a "modified" note is added (CC BY-NC-SA §3).
//
// Usage: node scripts/models/optimize-glb.mjs <in.glb> <out.glb> [--base 2048] [--normal 2048] [--other 1024] [--q 85]
import { NodeIO } from '@gltf-transform/core';
import jpeg from 'jpeg-js';
import pngjs from 'pngjs';
import { statSync } from 'node:fs';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) { console.error('usage: optimize-glb.mjs <in.glb> <out.glb> [--base N] [--normal N] [--other N] [--q Q]'); process.exit(1); }
const opt = { base: 2048, normal: 2048, other: 1024, q: 85 };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = Number(rest[i + 1]);

function decode(img, mime) {
  if (mime === 'image/png') { const p = pngjs.PNG.sync.read(Buffer.from(img)); return { w: p.width, h: p.height, data: p.data }; }
  const j = jpeg.decode(Buffer.from(img), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  return { w: j.width, h: j.height, data: j.data };
}

/** Box filter down by an integer factor so the longest side is <= max. */
function downscale(src, max) {
  let f = 1;
  while (Math.max(src.w, src.h) / f > max) f *= 2;
  if (f === 1) return src;
  const w = Math.floor(src.w / f), h = Math.floor(src.h / f), out = new Uint8Array(w * h * 4), n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < f; dy++) {
      let i = ((y * f + dy) * src.w + x * f) * 4;
      for (let dx = 0; dx < f; dx++, i += 4) { r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3]; }
    }
    const o = (y * w + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
  }
  return { w, h, data: out };
}

const hasAlpha = (img) => { for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return true; return false; };

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();

// which slot is each texture used in?
const slot = new Map();
for (const m of root.listMaterials()) {
  const mark = (t, s) => { if (t && !slot.has(t)) slot.set(t, s); };
  mark(m.getBaseColorTexture(), 'base');
  mark(m.getEmissiveTexture(), 'base');
  mark(m.getNormalTexture(), 'normal');
  mark(m.getMetallicRoughnessTexture(), 'other');
  mark(m.getOcclusionTexture(), 'other');
}

for (const tex of root.listTextures()) {
  const before = tex.getImage()?.byteLength ?? 0;
  const s = slot.get(tex) ?? 'other';
  const img = downscale(decode(tex.getImage(), tex.getMimeType()), opt[s]);
  const alpha = s === 'base' && hasAlpha(img);
  let data, mime;
  if (alpha) {
    const png = new pngjs.PNG({ width: img.w, height: img.h });
    png.data = Buffer.from(img.data);
    data = pngjs.PNG.sync.write(png, { colorType: 6 }); mime = 'image/png';
  } else {
    data = jpeg.encode({ data: img.data, width: img.w, height: img.h }, s === 'normal' ? Math.max(opt.q, 92) : opt.q).data; mime = 'image/jpeg';
  }
  tex.setImage(new Uint8Array(data)).setMimeType(mime);
  if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, mime === 'image/png' ? '.png' : '.jpg'));
  console.log(`  ${tex.getName() || '(texture)'} [${s}] ${img.w}x${img.h} ${mime}  ${(before / 1e6).toFixed(1)} → ${(data.length / 1e6).toFixed(2)} MB`);
}

const asset = root.getAsset();
asset.extras = { ...(asset.extras ?? {}), modified: 'CFS: textures downscaled and re-encoded as JPEG for web delivery; geometry unchanged.' };
asset.generator = `${asset.generator ?? ''} + CFS optimize-glb`.trim();
await io.write(output, doc);
console.log(`${input} ${(statSync(input).size / 1e6).toFixed(1)} MB → ${output} ${(statSync(output).size / 1e6).toFixed(2)} MB`);
