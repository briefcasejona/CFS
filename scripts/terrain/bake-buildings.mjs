// Real building footprints around the European airfields → assets/theaters/europe/buildings/<patch>.bin.gz
//
// Input: one JSON per landcover detail patch (coverdetail.json), each building as
//   [lat, lon, w, d, angle, height or -1, fill]
// where w × d is the footprint's minimum-area rectangle (m), angle the direction of side w (rad, counter-clockwise
// from east), height the roof height (m, -1 = unknown) and fill the footprint's share of that rectangle. They come from
// the Overture Maps buildings theme (OpenStreetMap and other open sources; ODbL), read with pyarrow from the public
// release on S3 — see SOURCES.md.
//
// Output per patch: the buildings sorted into 2 km tiles, each tile's large buildings first (so a far tile can draw
// just that prefix), 8 bytes a building:
//   x, z  u16  position in the tile, 5 cm steps
//   w, d  u8   footprint (shrunk to the true area), 0.25 m steps to 50 m, then 6 m steps
//   ang   u8   grid angle of side w, 0..π in 256 steps
//   h     u8   roof height, 0 = unknown, 0.25 m steps to 50 m, then 2 m steps
// Header: 'CFSB', version, tiles per side, building count, tile offsets (u32 × T²+1), large counts (u32 × T²).
//
// usage: node scripts/terrain/bake-buildings.mjs <dir with bld-<patch>.json>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { europeLcc as lcc } from '../../build/src/world/theaters/europe.js';

const SRC = process.argv[2];
const OUT = 'assets/theaters/europe/buildings';
const TILE = 2000, MIN_AREA = 30, BIG_AREA = 400;
mkdirSync(OUT, { recursive: true });
const patches = JSON.parse(readFileSync('assets/theaters/europe/coverdetail.json', 'utf8')).patches;

const encSize = (m) => m <= 50 ? Math.round(m * 4) : Math.min(255, 200 + Math.round((m - 50) / 6));
const encH = (m) => m <= 0 ? 0 : m <= 50 ? Math.max(1, Math.round(m * 4)) : Math.min(255, 200 + Math.round((m - 50) / 2));
const index = [];
let total = 0;
for (const p of patches) {
  const f = `${SRC}/bld-${p.id}.json`;
  if (!existsSync(f)) { console.warn('no buildings for', p.id); continue; }
  const size = (p.n - 1) * p.res, T = Math.ceil(size / TILE);
  const tiles = Array.from({ length: T * T }, () => []);
  for (const [lat, lon, w0, d0, ang, h, fill] of JSON.parse(readFileSync(f, 'utf8'))) {
    const area = w0 * d0 * fill;
    if (area < MIN_AREA) continue;
    const c = lcc.forward(lat, lon);
    const x = c.x - p.x0, z = c.z - p.z0;
    if (x < 0 || z < 0 || x >= T * TILE || z >= T * TILE) continue;
    // side w's direction on the grid: step 10 m along it in lat/lon and project
    const e = Math.cos(ang) * 10, n = Math.sin(ang) * 10;
    const c2 = lcc.forward(lat + n / 110540, lon + e / (111320 * Math.cos(lat * Math.PI / 180)));
    // three.js rotation about +y by θ turns +x into (cos θ, 0, −sin θ)
    let th = Math.atan2(-(c2.z - c.z), c2.x - c.x);
    th = ((th % Math.PI) + Math.PI) % Math.PI;
    const k = Math.sqrt(Math.min(1, Math.max(0.55, fill)));
    const ti = Math.floor(x / TILE), tj = Math.floor(z / TILE);
    tiles[tj * T + ti].push({ x: x - ti * TILE, z: z - tj * TILE, w: w0 * k, d: d0 * k, th, h, area });
  }
  const count = tiles.reduce((s, t) => s + t.length, 0);
  const head = 16 + (T * T + 1) * 4 + T * T * 4;
  const buf = Buffer.alloc(head + count * 8);
  buf.write('CFSB', 0, 'latin1'); buf.writeUInt32LE(1, 4); buf.writeUInt32LE(T, 8); buf.writeUInt32LE(count, 12);
  let off = 0, rec = head;
  tiles.forEach((t, i) => {
    t.sort((a, b) => b.area - a.area);
    buf.writeUInt32LE(off, 16 + i * 4);
    buf.writeUInt32LE(t.filter((b) => b.area >= BIG_AREA).length, 16 + (T * T + 1) * 4 + i * 4);
    for (const b of t) {
      buf.writeUInt16LE(Math.min(39999, Math.round(b.x * 20)), rec);
      buf.writeUInt16LE(Math.min(39999, Math.round(b.z * 20)), rec + 2);
      buf[rec + 4] = encSize(b.w); buf[rec + 5] = encSize(b.d);
      buf[rec + 6] = Math.round(b.th / Math.PI * 256) & 255; buf[rec + 7] = encH(b.h);
      rec += 8;
    }
    off += t.length;
  });
  buf.writeUInt32LE(off, 16 + T * T * 4);
  const gz = gzipSync(buf, { level: 9 });
  writeFileSync(`${OUT}/${p.id}.bin.gz`, gz);
  index.push({ id: p.id, x0: p.x0, z0: p.z0, tile: TILE, T, count });
  total += count;
  console.log(p.id, count, (gz.length / 1e6).toFixed(1) + ' MB');
}
writeFileSync(`${OUT}/index.json`, JSON.stringify({ attribution: '© OpenStreetMap contributors, Overture Maps Foundation (ODbL)', patches: index }));
console.log('total', total);
