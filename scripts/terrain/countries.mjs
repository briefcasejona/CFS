// Which countries a real-world theater's content (roads, rail, stations, buildings) covers: a lat/lon raster of the
// Natural Earth 10 m countries (public domain) at 0.02°. The land outside them is drawn as terrain only.
//   const inside = await theaterCountries('europe'); inside(lat, lon) → boolean   (null for a theater without a list)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Natural Earth ADM0_A3 codes; Norway only south of 62°N
export const COUNTRIES = {
  europe: { codes: ['FRA', 'BEL', 'LUX', 'CHE', 'LIE', 'ITA', 'SMR', 'VAT', 'MCO', 'NLD', 'AUT', 'GBR', 'IMN', 'JEY', 'GGY', 'DNK', 'NOR'], maxLat: { NOR: 62 }, window: [-11, 35, 21, 64] },
  uswest: { codes: ['USA'], maxLat: {}, window: [-128, 30, -106, 51] },
};
const STEP = 0.02;

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

export async function theaterCountries(id) {
  const cfg = COUNTRIES[id];
  if (!cfg) return null;
  const [LO0, LA0, LO1, LA1] = cfg.window;
  const nx = Math.round((LO1 - LO0) / STEP), ny = Math.round((LA1 - LA0) / STEP);
  const grid = new Uint8Array(nx * ny);
  for (const f of (await geojson('ne_10m_admin_0_countries')).features) {
    const a3 = f.properties.ADM0_A3;
    if (!cfg.codes.includes(a3)) continue;
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const xs = Array.from({ length: ny }, () => []);
    for (const poly of polys) for (const r of poly) for (let k = 0; k < r.length; k++) {
      const [ax, ay] = r[k], [bx, by] = r[(k + 1) % r.length];
      const y1 = (LA1 - ay) / STEP - 0.5, y2 = (LA1 - by) / STEP - 0.5;
      if (y1 === y2) continue;
      const x1 = (ax - LO0) / STEP - 0.5, x2 = (bx - LO0) / STEP - 0.5;
      const ya = Math.ceil(Math.min(y1, y2)), yb = Math.floor(Math.max(y1, y2) - 1e-9);
      for (let y = Math.max(0, ya); y <= Math.min(ny - 1, yb); y++) xs[y].push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    const maxLat = cfg.maxLat[a3] ?? 90;
    for (let y = 0; y < ny; y++) {
      if (LA1 - (y + 0.5) * STEP > maxLat) continue;
      const row = xs[y].sort((a, b) => a - b);
      for (let k = 0; k + 1 < row.length; k += 2) {
        const a = Math.max(0, Math.ceil(row[k])), b = Math.min(nx - 1, Math.floor(row[k + 1]));
        for (let x = a; x <= b; x++) grid[y * nx + x] = 1;
      }
    }
  }
  // grow by one cell (~2 km), so roads and lines along a coast or up to a border aren't clipped short
  const out = grid.slice();
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    if (grid[y * nx + x]) continue;
    if (grid[y * nx + x - 1] || grid[y * nx + x + 1] || grid[(y - 1) * nx + x] || grid[(y + 1) * nx + x]) out[y * nx + x] = 1;
  }
  return (lat, lon) => {
    const x = Math.floor((lon - LO0) / STEP), y = Math.floor((LA1 - lat) / STEP);
    return x >= 0 && y >= 0 && x < nx && y < ny && out[y * nx + x] === 1;
  };
}
