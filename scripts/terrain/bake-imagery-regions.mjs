#!/usr/bin/env node
// Which aerial-photo service covers which part of a real-world theater. The Sentinel-2 mosaic (10 m) covers the whole
// world; on top of it the game streams open national orthophotos (0.2–1 m) where a country publishes them as Web
// Mercator tiles (src/render/imagery.ts, AERIAL). This bakes a lat/lon raster of provider ids from the Natural Earth
// 10 m countries (public domain), eroded by one cell along land borders so a tile never reaches across a border into
// a country the service doesn't cover (sea is fine: the game draws its own water there).
//
// Output: assets/theaters/<id>/imagery.json  { lat0, lon0, step, nx, ny, providers: [id…], rows: [[value, run, …] …] }
// (row 0 is the northern edge; value 0 = sea, 255 = land no service covers, i = providers[i − 1]). A tile is fetched
// from a service when every sample in it is that service's land or sea.
//
// Usage: node scripts/terrain/bake-imagery-regions.mjs <europe|uswest>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// provider id → the Natural Earth countries (ADM0_A3) it covers; must match AERIAL in src/render/imagery.ts
const PROVIDERS = {
  europe: { ign: ['FRA', 'MCO'], pdok: ['NLD'], swisstopo: ['CHE', 'LIE'], basemapat: ['AUT'] },
  uswest: { usgs: ['USA'] },
};
const WINDOW = { europe: [-11, 35, 21, 64], uswest: [-128, 30, -106, 51] };   // lon0, lat0, lon1, lat1
const STEP = 0.02;
const ID = process.argv[2];
if (!PROVIDERS[ID]) { console.error(`usage: bake-imagery-regions.mjs <${Object.keys(PROVIDERS).join('|')}>`); process.exit(1); }

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

const [LO0, LA0, LO1, LA1] = WINDOW[ID];
const nx = Math.round((LO1 - LO0) / STEP), ny = Math.round((LA1 - LA0) / STEP);
// country index per cell: 0 sea, 255 a country no provider covers, else the provider's number
const grid = new Uint8Array(nx * ny);
const ids = Object.keys(PROVIDERS[ID]);
const of = new Map();
ids.forEach((p, k) => { for (const c of PROVIDERS[ID][p]) of.set(c, k + 1); });

function fill(rings, value) {
  // even-odd scanline fill at cell centres; row 0 = north
  const xs = Array.from({ length: ny }, () => []);
  for (const r of rings) for (let k = 0; k < r.length; k++) {
    const [ax, ay] = r[k], [bx, by] = r[(k + 1) % r.length];
    const y1 = (LA1 - ay) / STEP - 0.5, y2 = (LA1 - by) / STEP - 0.5;
    if (y1 === y2) continue;
    const x1 = (ax - LO0) / STEP - 0.5, x2 = (bx - LO0) / STEP - 0.5;
    const ya = Math.ceil(Math.min(y1, y2)), yb = Math.floor(Math.max(y1, y2) - 1e-9);
    for (let y = Math.max(0, ya); y <= Math.min(ny - 1, yb); y++) xs[y].push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  for (let y = 0; y < ny; y++) {
    const row = xs[y].sort((a, b) => a - b);
    for (let k = 0; k + 1 < row.length; k += 2) {
      const a = Math.max(0, Math.ceil(row[k])), b = Math.min(nx - 1, Math.floor(row[k + 1]));
      for (let x = a; x <= b; x++) grid[y * nx + x] = value;
    }
  }
}
for (const f of (await geojson('ne_10m_admin_0_countries')).features) {
  const g = f.geometry, a3 = f.properties.ADM0_A3;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const rings = [];
  for (const poly of polys) for (const ring of poly) {
    if (ring.every(([lon, lat]) => lon < LO0 || lon > LO1 || lat < LA0 || lat > LA1)) continue;
    rings.push(ring);
  }
  // each country on its own, so neighbours' parities don't mix
  if (rings.length) fill(rings, of.get(a3) ?? 255);
}
// erode along land borders: a cell keeps its provider only if no neighbouring cell is another country's land
const out = new Uint8Array(nx * ny);
for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  const v = grid[y * nx + x];
  if (v === 0 || v === 255) { out[y * nx + x] = v; continue; }
  let ok = true;
  for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
    const w = grid[yy * nx + xx];
    if (w !== 0 && w !== v) { ok = false; break; }
  }
  out[y * nx + x] = ok ? v : 255;
}
const rows = [];
for (let y = 0; y < ny; y++) {
  const row = [];
  let cur = out[y * nx], run = 0;
  for (let x = 0; x < nx; x++) {
    const v = out[y * nx + x];
    if (v === cur) run++;
    else { row.push(cur, run); cur = v; run = 1; }
  }
  row.push(cur, run);
  rows.push(row);
}
const json = JSON.stringify({ source: 'Natural Earth 10 m countries (public domain)', lat0: LA1, lon0: LO0, step: STEP, nx, ny, providers: ids, rows });
writeFileSync(`assets/theaters/${ID}/imagery.json`, json);
const counts = ids.map((p, k) => `${p} ${out.filter((v) => v === k + 1).length}`);
console.log(`${ID}: ${nx}×${ny} cells, ${(json.length / 1024).toFixed(0)} KB; ${counts.join(', ')}`);
