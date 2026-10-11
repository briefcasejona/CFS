#!/usr/bin/env node
// Bake a real-world theater height grid from AWS Terrain Tiles (Terrarium PNG, public dataset; sources: SRTM, GMTED,
// ETOPO1, EU-DEM … — see https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
// Pure JS: tiles are decoded with pngjs and resampled into the game's Lambert Conformal Conic frame.
// Output: assets/theaters/<id>/height.bin.gz (Int16 LE metres, row-major z then x) + meta.json.
//
// Usage: npm run build && node scripts/terrain/bake-theater.mjs <europe|gulf>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import pngjs from 'pngjs';
import { Lcc } from '../../build/src/world/lcc.js';

// per theater: Lambert Conformal Conic frame, half extent (square), grid spacing, Terrarium zoom, lon/lat window for
// the Natural Earth land mask
export const THEATERS = {
  europe: { proj: { lat0: 52, lon0: 10, lat1: 47, lat2: 57 }, half: 1150000, res: 1000, z: 7, window: [-20, 35, 40, 70] },
  gulf: { proj: { lat0: 29.5, lon0: 47.5, lat1: 26, lat2: 33 }, half: 600000, res: 1000, z: 8, window: [38, 20, 57, 38] },
};
const ID = process.argv[2];
if (!THEATERS[ID]) { console.error(`usage: bake-theater.mjs <${Object.keys(THEATERS).join('|')}>`); process.exit(1); }
const { proj: PROJ, half: HALF, res: RES, z: Z, window: WIN } = THEATERS[ID];
const OUT = `assets/theaters/${ID}`;
const CACHE = '.cache/terrarium';

const lcc = new Lcc(PROJ);
const N = Math.round((2 * HALF) / RES) + 1;
const WORLD = 256 * 2 ** Z;

const pix = (lat, lon) => {
  const x = ((lon + 180) / 360) * WORLD;
  const f = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2) * WORLD;
  return { x, y };
};

// ---- which tiles do we need?
const need = new Set();
for (let j = 0; j < N; j += 8) for (let i = 0; i < N; i += 8) {
  const { lat, lon } = lcc.inverse(-HALF + i * RES, -HALF + j * RES);
  const p = pix(lat, lon);
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) need.add(`${Math.floor(p.x / 256) + dx}/${Math.floor(p.y / 256) + dy}`);
}
console.log(`${N}×${N} samples, ${need.size} tiles at z${Z}`);

// ---- download (cached)
const tiles = new Map();
const list = [...need];
let done = 0;
async function getTile(key) {
  const file = join(CACHE, String(Z), `${key}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const [x, y] = key.split('/');
    for (let attempt = 0; attempt < 4 && buf === undefined; attempt++) {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        else if (r.status === 404) buf = null;
      } catch { await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
    }
    if (buf) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, buf); }
  }
  if (buf) {
    const png = pngjs.PNG.sync.read(buf);
    const h = new Float32Array(256 * 256);
    for (let k = 0; k < 256 * 256; k++) h[k] = png.data[k * 4] * 256 + png.data[k * 4 + 1] + png.data[k * 4 + 2] / 256 - 32768;
    tiles.set(key, h);
  }
  if (++done % 25 === 0) console.log(`  ${done}/${list.length} tiles`);
}
for (let k = 0; k < list.length; k += 8) await Promise.all(list.slice(k, k + 8).map(getTile));

// ---- resample
const heightAt = (px, py) => {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const t = tiles.get(`${tx}/${ty}`);
  if (!t) return -50;
  const lx = Math.min(255, Math.max(0, Math.floor(px - tx * 256))), ly = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
  return t[ly * 256 + lx];
};
const bilinear = (x, y) => {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  return (heightAt(x0, y0) * (1 - fx) + heightAt(x0 + 1, y0) * fx) * (1 - fy) + (heightAt(x0, y0 + 1) * (1 - fx) + heightAt(x0 + 1, y0 + 1) * fx) * fy;
};
const out = new Int16Array(N * N);
let min = Infinity, max = -Infinity, land = 0;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const { lat, lon } = lcc.inverse(-HALF + i * RES, -HALF + j * RES);
    const p = pix(lat, lon);
    const h = Math.max(-32000, Math.min(32000, Math.round(bilinear(p.x, p.y))));
    out[j * N + i] = h;
    if (h < min) min = h;
    if (h > max) max = h;
    if (h > 0) land++;
  }
}
// ---- land mask (Natural Earth 10 m land minus lakes, public domain): polders and low coasts below sea level stay
// land, so e.g. Friesland and Holland don't flood. Rasterised by scanline even-odd fill in grid coordinates.
async function geojson(name) {
  const file = join('.cache', `${name}.geojson`);
  if (!existsSync(file)) {
    const r = await fetch(`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${name}.geojson`);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    mkdirSync('.cache', { recursive: true });
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}
function rasterize(gj, mask, value) {
  const rings = [];
  for (const f of gj.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      // quick reject: rings entirely outside the theater's lon/lat window
      if (ring.every(([lon, lat]) => lon < WIN[0] || lon > WIN[2] || lat < WIN[1] || lat > WIN[3])) continue;
      rings.push(ring.map(([lon, lat]) => { const p = lcc.forward(lat, lon); return [(p.x + HALF) / RES, (p.z + HALF) / RES]; }));
    }
  }
  // even-odd scanline fill over all rings together (holes and islands handled by parity)
  const xs = Array.from({ length: N }, () => []);
  for (const r of rings) for (let k = 0; k < r.length; k++) {
    const [x1, y1] = r[k], [x2, y2] = r[(k + 1) % r.length];
    if (y1 === y2) continue;
    const ya = Math.ceil(Math.min(y1, y2)), yb = Math.floor(Math.max(y1, y2) - 1e-9);
    for (let y = Math.max(0, ya); y <= Math.min(N - 1, yb); y++) xs[y].push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  for (let y = 0; y < N; y++) {
    const row = xs[y].sort((a, b) => a - b);
    for (let k = 0; k + 1 < row.length; k += 2) {
      const a = Math.max(0, Math.ceil(row[k])), b = Math.min(N - 1, Math.floor(row[k + 1]));
      for (let x = a; x <= b; x++) mask[y * N + x] = value;
    }
  }
}
const mask = new Uint8Array(N * N);          // 1 = land
rasterize(await geojson('ne_10m_land'), mask, 1);
rasterize(await geojson('ne_10m_lakes'), mask, 0);
let raised = 0, sunk = 0;
for (let k = 0; k < N * N; k++) {
  if (mask[k] && out[k] <= 0) { out[k] = 1; raised++; }
  else if (!mask[k] && out[k] > 0 && out[k] < 3) { out[k] = -2; sunk++; }
}
console.log(`land mask: ${raised} low-land cells raised above sea level, ${sunk} coastal cells lowered`);

mkdirSync(OUT, { recursive: true });
const gz = gzipSync(Buffer.from(out.buffer), { level: 9 });
writeFileSync(join(OUT, 'height.bin.gz'), gz);
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ proj: PROJ, half: HALF, res: RES, n: N, format: 'int16le-gzip', min, max,
  source: 'AWS Terrain Tiles (Terrarium), Mapzen/Tilezen; data © their providers (SRTM, GMTED2010, ETOPO1, EU-DEM, …)', baked: new Date().toISOString() }, null, 2));
console.log(`done: ${(gz.length / 1e6).toFixed(1)} MB gz, heights ${min}…${max} m, land ${(100 * land / (N * N)).toFixed(0)}%`);
