#!/usr/bin/env node
// Bake a real-world theater landcover grid from ESA WorldCover 10 m 2021 v200 (satellite-derived, Sentinel-1/2;
// © ESA WorldCover project 2021 / contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover
// consortium, CC BY 4.0 — https://esa-worldcover.org). Each 3°×3° tile is a cloud-optimised GeoTIFF; we read one of its
// overviews (~270–300 m pixels) and count the classes that land in each cell of the game's Lambert Conformal Conic grid.
// Output: assets/theaters/<id>/landcover.bin.gz — Uint8 RGBA per cell (tree, built-up, cropland, water fractions ×255),
// row-major z then x, the same layout as height.bin.gz but on its own grid spacing (RES below).
//
// Usage: npm run build && node scripts/terrain/bake-landcover.mjs <europe|gulf>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fromUrl } from 'geotiff';
import { Lcc } from '../../build/src/world/lcc.js';

// grid spacing and COG overview per theater (image 0 = 36000 px per 3° tile, 4 = 2250, 5 = 1125): Europe at 1 km keeps the texture inside 4096² (2301²); the smaller Gulf affords 500 m
const THEATERS = {
  europe: { proj: { lat0: 52, lon0: 10, lat1: 47, lat2: 57 }, half: 1150000, res: 1000, overview: 5 },
  gulf: { proj: { lat0: 29.5, lon0: 47.5, lat1: 26, lat2: 33 }, half: 600000, res: 500, overview: 4 },
};
const ID = process.argv[2];
if (!THEATERS[ID]) { console.error(`usage: bake-landcover.mjs <${Object.keys(THEATERS).join('|')}>`); process.exit(1); }
const { proj, half: HALF, res: RES, overview: OVERVIEW } = THEATERS[ID];
const lcc = new Lcc(proj);
const N = Math.round((2 * HALF) / RES) + 1;
const CACHE = '.cache/worldcover';
const BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';

// WorldCover class → output channel: 0 tree (+ mangrove), 1 built-up, 2 cropland, 3 open water; others count only in
// the total (grass, shrub, bare, snow, wetland, moss) and leave the ground to the height/slope colouring
const CH = new Int8Array(256).fill(-1);
CH[10] = 0; CH[95] = 0; CH[50] = 1; CH[40] = 2; CH[80] = 3;

// ---- which 3° tiles cover the theater square?
const tiles = new Set();
const step = Math.max(1, Math.floor(N / 400));
for (let j = 0; j < N; j += step) for (let i = 0; i < N; i += step) {
  const { lat, lon } = lcc.inverse(-HALF + i * RES, -HALF + j * RES);
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3;
  tiles.add(`${la},${lo}`);
}
const tileName = (la, lo) => `${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}`;
console.log(`${N}×${N} cells at ${RES} m, ${tiles.size} candidate tiles`);

// ---- read (cached): the overview raster of one tile, or null where WorldCover has no tile (open sea)
async function readTile(name) {
  const file = join(CACHE, `${name}.L${OVERVIEW}.bin`), none = file + '.none';
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  if (existsSync(none)) return null;
  const url = `${BASE}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.status === 404 || head.status === 403) { mkdirSync(CACHE, { recursive: true }); writeFileSync(none, ''); return null; }
      const tif = await fromUrl(url);
      const img = await tif.getImage(OVERVIEW);
      const [band] = await img.readRasters();
      const data = new Uint8Array(band);
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, data);
      return data;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ---- accumulate class counts per cell (forward-projecting every overview pixel centre)
const total = new Uint16Array(N * N);
const counts = [0, 1, 2, 3].map(() => new Uint16Array(N * N));
let found = 0, done = 0;
const list = [...tiles];
async function addTile(key) {
  const [la, lo] = key.split(',').map(Number);
  const data = await readTile(tileName(la, lo));
  done++;
  if (!data) return;
  found++;
  const P = Math.round(Math.sqrt(data.length)), d = 3 / P;
  for (let r = 0; r < P; r++) {
    const lat = la + 3 - (r + 0.5) * d;   // row 0 is the tile's north edge
    for (let c = 0; c < P; c++) {
      const p = lcc.forward(lat, lo + (c + 0.5) * d);
      const i = Math.round((p.x + HALF) / RES), j = Math.round((p.z + HALF) / RES);
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const k = j * N + i, v = data[r * P + c];
      if (v === 0) continue;               // no data (sea)
      if (total[k] < 65535) total[k]++;
      const ch = CH[v];
      if (ch >= 0 && counts[ch][k] < 65535) counts[ch][k]++;
    }
  }
  if (done % 20 === 0) console.log(`  ${done}/${list.length} tiles (${found} with data)`);
}
for (let k = 0; k < list.length; k += 6) await Promise.all(list.slice(k, k + 6).map(addTile));

// ---- fractions, with holes (cells finer than the overview's pixels) filled from their neighbours
const out = new Uint8Array(N * N * 4);
let holes = 0;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i;
  let t = total[k], src = [k];
  if (!t) {
    src = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < N && jj < N && total[jj * N + ii]) { src.push(jj * N + ii); t += total[jj * N + ii]; }
    }
    if (t) holes++;
  }
  if (!t) continue;
  for (let ch = 0; ch < 4; ch++) {
    let s = 0;
    for (const q of src) s += counts[ch][q];
    out[k * 4 + ch] = Math.round((255 * s) / t);
  }
}
const gz = gzipSync(Buffer.from(out.buffer), { level: 9 });
writeFileSync(join('assets/theaters', ID, 'landcover.bin.gz'), gz);
const mean = [0, 1, 2, 3].map((ch) => { let s = 0; for (let k = 0; k < N * N; k++) s += out[k * 4 + ch]; return (100 * s / (255 * N * N)).toFixed(1); });
console.log(`done: ${found} tiles, ${holes} holes filled, ${(gz.length / 1e6).toFixed(1)} MB gz; mean tree ${mean[0]}% built ${mean[1]}% crop ${mean[2]}% water ${mean[3]}%`);
