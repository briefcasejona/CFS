#!/usr/bin/env node
// Bake high-resolution elevation patches around each airfield of a real-world theater, from the same AWS Terrain Tiles
// (Terrarium) as the 1 km theater grid but at a finer zoom: low-level flying near the fields shows real valleys,
// ridges and river banks instead of the coarse grid smoothed with noise.
// Output: assets/theaters/<id>/patches.json (one entry per airfield: id, origin, size, spacing) and
// assets/theaters/<id>/patches.bin.gz (the patches' Int16 LE heights, concatenated in the order of the JSON).
// Low land the coarse grid marks as land (polders below sea level) stays land, as in bake-theater.mjs.
//
// Usage: npm run build && node scripts/terrain/bake-patches.mjs <europe|gulf>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import pngjs from 'pngjs';

const THEATERS = {
  europe: { module: '../../build/src/world/theaters/europe.js', name: 'EUROPE', z: 11 },
  gulf: { module: '../../build/src/world/theaters/gulf.js', name: 'GULF', z: 11 },
};
export const PATCH_HALF = 25000, PATCH_RES = 75;    // 50 km square around each field, 75 m spacing
const ID = process.argv[2];
if (!THEATERS[ID]) { console.error(`usage: bake-patches.mjs <${Object.keys(THEATERS).join('|')}>`); process.exit(1); }
const cfg = THEATERS[ID];
const mod = await import(cfg.module);
const theater = mod[cfg.name];
const lcc = mod[`${ID}Lcc`];
const OUT = `assets/theaters/${ID}`;
const CACHE = '.cache/terrarium';
const Z = cfg.z, WORLD = 256 * 2 ** Z;

// the coarse grid (for the land mask), sampled bilinearly
const coarse = (() => {
  const meta = JSON.parse(readFileSync(join(OUT, 'meta.json'), 'utf8'));
  const buf = gunzipSync(readFileSync(join(OUT, 'height.bin.gz')));
  const g = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2), N = meta.n;
  const s = (i, j) => g[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  return (x, z) => {
    const fx = (x + meta.half) / meta.res, fz = (z + meta.half) / meta.res, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (s(i, j) * (1 - tx) + s(i + 1, j) * tx) * (1 - tz) + (s(i, j + 1) * (1 - tx) + s(i + 1, j + 1) * tx) * tz;
  };
})();

const pix = (lat, lon) => {
  const f = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * WORLD, y: ((1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2) * WORLD };
};
const tiles = new Map();
async function tile(key) {
  if (tiles.has(key)) return tiles.get(key);
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
  let h = null;
  if (buf) {
    const png = pngjs.PNG.sync.read(buf);
    h = new Float32Array(256 * 256);
    for (let k = 0; k < 256 * 256; k++) h[k] = png.data[k * 4] * 256 + png.data[k * 4 + 1] + png.data[k * 4 + 2] / 256 - 32768;
  }
  tiles.set(key, h);
  return h;
}
const heightAt = (px, py) => {
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256), t = tiles.get(`${tx}/${ty}`);
  if (!t) return -50;
  return t[Math.min(255, Math.max(0, Math.floor(py - ty * 256))) * 256 + Math.min(255, Math.max(0, Math.floor(px - tx * 256)))];
};
const bilinear = (x, y) => {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  return (heightAt(x0, y0) * (1 - fx) + heightAt(x0 + 1, y0) * fx) * (1 - fy) + (heightAt(x0, y0 + 1) * (1 - fx) + heightAt(x0 + 1, y0 + 1) * fx) * fy;
};

const n = Math.round((2 * PATCH_HALF) / PATCH_RES) + 1;
const index = [], parts = [];
for (const ab of theater.airbases) {
  const x0 = Math.round(ab.x - PATCH_HALF), z0 = Math.round(ab.z - PATCH_HALF);
  // fetch the tiles this patch needs
  const need = new Set();
  for (let j = 0; j < n; j += 20) for (let i = 0; i < n; i += 20) {
    const { lat, lon } = lcc.inverse(x0 + i * PATCH_RES, z0 + j * PATCH_RES);
    const p = pix(lat, lon);
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) need.add(`${Math.floor(p.x / 256) + dx}/${Math.floor(p.y / 256) + dy}`);
  }
  const keys = [...need];
  for (let k = 0; k < keys.length; k += 8) await Promise.all(keys.slice(k, k + 8).map(tile));
  const out = new Int16Array(n * n);
  let raised = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * PATCH_RES, z = z0 + j * PATCH_RES;
    const { lat, lon } = lcc.inverse(x, z);
    const p = pix(lat, lon);
    let h = Math.round(bilinear(p.x, p.y));
    if (h <= 0 && coarse(x, z) > 0) { h = 1; raised++; }
    out[j * n + i] = Math.max(-32000, Math.min(32000, h));
  }
  index.push({ id: ab.id, x0, z0, n, res: PATCH_RES });
  parts.push(Buffer.from(out.buffer));
  console.log(`  ${ab.id}: ${keys.length} tiles${raised ? `, ${raised} low-land samples kept above sea level` : ''}`);
}
const gz = gzipSync(Buffer.concat(parts), { level: 9 });
writeFileSync(join(OUT, 'patches.bin.gz'), gz);
writeFileSync(join(OUT, 'patches.json'), JSON.stringify({ zoom: Z, source: 'AWS Terrain Tiles (Terrarium)', patches: index }));
console.log(`done: ${index.length} patches of ${n}×${n}, ${(gz.length / 1e6).toFixed(1)} MB gz`);
