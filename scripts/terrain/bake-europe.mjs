#!/usr/bin/env node
// Bake the Europe theater height grid from AWS Terrain Tiles (Terrarium PNG, public dataset; sources: SRTM, GMTED,
// ETOPO1, EU-DEM … — see https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
// Pure JS: tiles are decoded with pngjs and resampled into the game's Lambert Conformal Conic frame.
// Output: assets/theaters/europe/height.bin.gz (Int16 LE metres, row-major z then x) + meta.json.
//
// Usage: npm run build && node scripts/terrain/bake-europe.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import pngjs from 'pngjs';
import { Lcc } from '../../build/src/world/lcc.js';

const PROJ = { lat0: 52, lon0: 10, lat1: 47, lat2: 57 };
const HALF = 1150000;          // m — square theater, ±1150 km
const RES = 1000;              // m per sample
const Z = 7;                   // Terrarium zoom (~0.75 km/px at 52°N)
const OUT = 'assets/theaters/europe';
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
mkdirSync(OUT, { recursive: true });
const gz = gzipSync(Buffer.from(out.buffer), { level: 9 });
writeFileSync(join(OUT, 'height.bin.gz'), gz);
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ proj: PROJ, half: HALF, res: RES, n: N, format: 'int16le-gzip', min, max,
  source: 'AWS Terrain Tiles (Terrarium), Mapzen/Tilezen; data © their providers (SRTM, GMTED2010, ETOPO1, EU-DEM, …)', baked: new Date().toISOString() }, null, 2));
console.log(`done: ${(gz.length / 1e6).toFixed(1)} MB gz, heights ${min}…${max} m, land ${(100 * land / (N * N)).toFixed(0)}%`);
