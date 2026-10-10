#!/usr/bin/env node
// Bake the Europe map overlay: national borders (Natural Earth 10 m admin-0 boundary lines, public domain) and major
// cities (Natural Earth populated places) in the game's Lambert frame. Output: assets/theaters/europe/overlay.json
//   { borders: [[x0,z0,x1,z1,…] …] (100 m units), cities: [[name, x, z, isCapital] …] (metres) }
//
// Usage: npm run build && node scripts/terrain/bake-europe-overlay.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Lcc } from '../../build/src/world/lcc.js';

const lcc = new Lcc({ lat0: 52, lon0: 10, lat1: 47, lat2: 57 });
const HALF = 1150000;
const OUT = 'assets/theaters/europe';

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

const inside = (p, m = 0) => Math.abs(p.x) <= HALF + m && Math.abs(p.z) <= HALF + m;

// borders: split lines where they leave the theater, drop points closer than 1.5 km to the previous one
const borders = [];
for (const f of (await geojson('ne_10m_admin_0_boundary_lines_land')).features) {
  const g = f.geometry;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const line of lines) {
    let cur = [], last = null;
    const flush = () => { if (cur.length >= 4) borders.push(cur); cur = []; last = null; };
    for (const [lon, lat] of line) {
      const p = lcc.forward(lat, lon);
      if (!inside(p, 50000)) { flush(); continue; }
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1500) continue;
      cur.push(Math.round(p.x / 100), Math.round(p.z / 100));
      last = p;
    }
    flush();
  }
}

// cities: national capitals plus places over ~600 k inhabitants
const cities = [];
for (const f of (await geojson('ne_10m_populated_places_simple')).features) {
  const pr = f.properties;
  const capital = pr.featurecla === 'Admin-0 capital';
  if (!capital && (pr.pop_max ?? 0) < 600000) continue;
  const [lon, lat] = f.geometry.coordinates;
  const p = lcc.forward(lat, lon);
  if (!inside(p)) continue;
  cities.push([pr.name.replace(/\s+/g, ' '), Math.round(p.x), Math.round(p.z), capital ? 1 : 0]);
}

mkdirSync(OUT, { recursive: true });
const json = JSON.stringify({ source: 'Natural Earth (public domain)', borders, cities });
writeFileSync(join(OUT, 'overlay.json'), json);
console.log(`overlay: ${borders.length} border lines, ${cities.length} cities, ${(json.length / 1024).toFixed(0)} KB`);
