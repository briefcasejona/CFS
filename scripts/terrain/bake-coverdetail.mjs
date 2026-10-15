#!/usr/bin/env node
// Bake fine landcover around each airfield from ESA WorldCover 10 m 2021 v200 (© ESA WorldCover project 2021 /
// contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium, CC BY 4.0 —
// https://esa-worldcover.org), on the same 50 km squares as the elevation patches (bake-patches.mjs): houses then
// stand where the satellite map really shows built-up land, never in water, and forests are filled where real
// forest is, instead of following the 1 km fractions plus noise.
// Each cell holds the WorldCover class at its centre, reduced to 2 bits: 0 other, 1 tree, 2 built-up, 3 water.
// Output: assets/theaters/<id>/coverdetail.json (one entry per patch: id, origin, size, spacing) and
// assets/theaters/<id>/coverdetail.bin.gz (the patches' cells, 4 per byte, low bits first, row-major z then x,
// concatenated in the order of the JSON).
//
// Usage: npm run build && node scripts/terrain/bake-coverdetail.mjs <europe|gulf>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fromUrl } from 'geotiff';

const THEATERS = {
  europe: { module: '../../build/src/world/theaters/europe.js' },
  gulf: { module: '../../build/src/world/theaters/gulf.js' },
};
export const DETAIL_RES = 20;
const ID = process.argv[2];
if (!THEATERS[ID]) { console.error(`usage: bake-coverdetail.mjs <${Object.keys(THEATERS).join('|')}>`); process.exit(1); }
const mod = await import(THEATERS[ID].module);
const lcc = mod[`${ID}Lcc`];
const OUT = `assets/theaters/${ID}`;
const BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';
const CLS = new Uint8Array(256);
CLS[10] = 1; CLS[95] = 1; CLS[50] = 2; CLS[80] = 3;
const tileName = (la, lo) => `${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}`;
const P = 36000, D = 3 / P;   // full-resolution pixels per 3° tile

const tifs = new Map();
async function tif(name) {
  if (!tifs.has(name)) tifs.set(name, (async () => {
    const url = `${BASE}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return null;
    return (await fromUrl(url)).getImage(0);
  })());
  return tifs.get(name);
}

const patches = JSON.parse(readFileSync(join(OUT, 'patches.json'), 'utf8')).patches;
const index = [], chunks = [];
for (const p of patches) {
  const size = (p.n - 1) * p.res, n = Math.round(size / DETAIL_RES) + 1;
  const ll = new Float64Array(n * n * 2);
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const { lat, lon } = lcc.inverse(p.x0 + i * DETAIL_RES, p.z0 + j * DETAIL_RES);
    const k = (j * n + i) * 2;
    ll[k] = lat; ll[k + 1] = lon;
    la0 = Math.min(la0, lat); la1 = Math.max(la1, lat); lo0 = Math.min(lo0, lon); lo1 = Math.max(lo1, lon);
  }
  const cls = new Uint8Array(n * n);
  // every 3° tile the patch touches: read the window over the patch and look each cell up
  for (let la = Math.floor(la0 / 3) * 3; la <= la1; la += 3) for (let lo = Math.floor(lo0 / 3) * 3; lo <= lo1; lo += 3) {
    const img = await tif(tileName(la, lo));
    if (!img) continue;
    const c0 = Math.max(0, Math.floor((lo0 - lo) / D) - 1), c1 = Math.min(P, Math.ceil((lo1 - lo) / D) + 1);
    const r0 = Math.max(0, Math.floor((la + 3 - la1) / D) - 1), r1 = Math.min(P, Math.ceil((la + 3 - la0) / D) + 1);
    if (c1 <= c0 || r1 <= r0) continue;
    const [band] = await img.readRasters({ window: [c0, r0, c1, r1] });
    const W = c1 - c0;
    for (let k = 0; k < n * n; k++) {
      const c = Math.floor((ll[2 * k + 1] - lo) / D) - c0, r = Math.floor((la + 3 - ll[2 * k]) / D) - r0;
      if (c < 0 || r < 0 || c >= W || r >= r1 - r0) continue;
      cls[k] = CLS[band[r * W + c]];
    }
  }
  const packed = new Uint8Array(Math.ceil((n * n) / 4));
  for (let k = 0; k < n * n; k++) packed[k >> 2] |= cls[k] << ((k & 3) * 2);
  const share = [0, 0, 0, 0];
  for (let k = 0; k < n * n; k++) share[cls[k]]++;
  console.log(`${p.id}: ${n}² cells, tree ${(100 * share[1] / (n * n)).toFixed(1)}% built ${(100 * share[2] / (n * n)).toFixed(1)}% water ${(100 * share[3] / (n * n)).toFixed(1)}%`);
  index.push({ id: p.id, x0: p.x0, z0: p.z0, n, res: DETAIL_RES });
  chunks.push(packed);
}
const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
writeFileSync(join(OUT, 'coverdetail.json'), JSON.stringify({ source: 'ESA WorldCover 10 m 2021 v200', patches: index }));
writeFileSync(join(OUT, 'coverdetail.bin.gz'), gz);
console.log(`done: ${index.length} patches, ${(gz.length / 1e6).toFixed(1)} MB gz`);
