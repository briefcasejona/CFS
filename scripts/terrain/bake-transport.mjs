#!/usr/bin/env node
// Roads, railways and stations of a real-world theater → assets/theaters/<id>/roads/
//
// Input: .cache/transport/*.bin and stations.json from scripts/terrain/extract-transport.py / extract-stations.py
// (Overture Maps transportation and places themes, built from © OpenStreetMap contributors and other open data, ODbL).
//
// Output:
//   major/<bi>_<bj>.bin.gz   motorways to tertiary roads and railways, in 64 km blocks of 8 km cells, whole theater
//   local/<patch>.bin.gz     local streets in the 50 km detail squares around the airfields, 2 km cells
//   index.json               which blocks exist, the patches, attribution
//   stations.json            [x, z, track heading (deg), platform offsets left and right (m), name] per station
//
// A block file: 'CFSR', version, cells per side T, cell size (m), origin x0, z0 (i32 m), then u32 byte offsets
// (T² + 1) into the data that follows. Per cell a run of polylines:
//   u8 class (0 motorway 1 trunk 2 primary 3 secondary 4 tertiary 5 unclassified 6 residential 10 railway)
//   u8 flags (1 bridge, 2 slip road, 4 minor rail), u16 point count n,
//   i32 x, z of the first point, 0.25 m steps from the block origin, then n−1 × i16 dx, dz in 0.25 m steps.
// A polyline sits in the cell of its middle point and is no longer than a cell.
//
// usage: npm run build && node scripts/terrain/bake-transport.mjs <europe|gulf>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ID = process.argv[2];
if (!['europe', 'gulf'].includes(ID)) { console.error('usage: bake-transport.mjs <europe|gulf>'); process.exit(1); }
const mod = await import(`../../build/src/world/theaters/${ID}.js`);
const lcc = mod[`${ID}Lcc`];
const meta = JSON.parse(readFileSync(`assets/theaters/${ID}/meta.json`, 'utf8'));
const patches = JSON.parse(readFileSync(`assets/theaters/${ID}/patches.json`, 'utf8')).patches.map((p) => ({ id: p.id, x0: p.x0, z0: p.z0, size: (p.n - 1) * p.res }));
const SRC = '.cache/transport', OUT = `assets/theaters/${ID}/roads`;
const HALF = meta.half, BLOCK = 64000, CELL = 8000, LCELL = 2000, Q = 4;   // Q steps per metre
const TOL = (cls) => cls === 10 ? 1.2 : cls <= 1 ? 1.5 : cls <= 4 ? 2 : 2.5;
const D2R = Math.PI / 180;

// ---- read, project, sort into blocks / patches
/** key → polylines { cls, fl, pts: Float64Array x,z } */
const groups = new Map();
const push = (key, pl) => { let a = groups.get(key); if (!a) groups.set(key, a = []); a.push(pl); };
const patchOf = (x, z) => patches.find((p) => x >= p.x0 && z >= p.z0 && x < p.x0 + p.size && z < p.z0 + p.size);
// a quick lon/lat box around the theater, so the other theater's features skip the projection
const corners = [];
for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) corners.push(lcc.inverse(-HALF + i * HALF / 4, -HALF + j * HALF / 4));
const LA0 = Math.min(...corners.map((c) => c.lat)), LA1 = Math.max(...corners.map((c) => c.lat)), LO0 = Math.min(...corners.map((c) => c.lon)), LO1 = Math.max(...corners.map((c) => c.lon));
let nIn = 0;
for (const f of readdirSync(SRC)) {
  if (!f.endsWith('.bin')) continue;
  const b = readFileSync(`${SRC}/${f}`);
  const N = b.readUInt32LE(0), P = b.readUInt32LE(4);
  const cls = b.subarray(8, 8 + N), fl = b.subarray(8 + N, 8 + 2 * N);
  const npts = new Uint32Array(b.buffer.slice(b.byteOffset + 8 + 2 * N, b.byteOffset + 8 + 2 * N + 4 * N));
  const co = new Int32Array(b.buffer.slice(b.byteOffset + 8 + 6 * N, b.byteOffset + 8 + 6 * N + 8 * P));
  let o = 0;
  for (let k = 0; k < N; k++) {
    const n = npts[k], lo = co[o * 2] / 1e7, la = co[o * 2 + 1] / 1e7;
    if (n < 2 || lo < LO0 || lo > LO1 || la < LA0 || la > LA1) { o += n; continue; }
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { const c = lcc.forward(co[(o + i) * 2 + 1] / 1e7, co[(o + i) * 2] / 1e7); pts[i * 2] = c.x; pts[i * 2 + 1] = c.z; }
    o += n;
    const mx = pts[(n >> 1) * 2], mz = pts[(n >> 1) * 2 + 1];
    if (Math.abs(mx) >= HALF || Math.abs(mz) >= HALF) continue;
    if (cls[k] >= 5 && cls[k] < 10) {
      const p = patchOf(mx, mz);
      if (p) push('L' + p.id, { cls: cls[k], fl: fl[k], pts });
    } else push(`M${Math.floor((mx + HALF) / BLOCK)}_${Math.floor((mz + HALF) / BLOCK)}`, { cls: cls[k], fl: fl[k], pts });
    nIn++;
  }
}
console.log(`${nIn} segments in ${groups.size} groups`);

// ---- merge chains: two segments of one class meeting end to end (and nothing else of that class there) become one
function merge(list) {
  const key = (pl, end) => { const i = end ? pl.pts.length - 2 : 0; return `${pl.cls},${pl.fl},${Math.round(pl.pts[i] * 10)},${Math.round(pl.pts[i + 1] * 10)}`; };
  const at = new Map();
  for (const pl of list) for (const e of [0, 1]) { const k = key(pl, e); let a = at.get(k); if (!a) at.set(k, a = []); a.push([pl, e]); }
  const used = new Set(), out = [];
  const other = (pl, e) => { const a = at.get(key(pl, e)); if (a.length !== 2) return null; const o = a[0][0] === pl ? a[1] : a[0]; return o[0] === pl || used.has(o[0]) ? null : o; };
  for (const start of list) {
    if (used.has(start)) continue;
    used.add(start);
    let chain = [Array.from(start.pts)];
    // grow at the tail, then at the head
    for (const dir of [1, 0]) {
      let cur = start, end = dir;
      for (;;) {
        const nx = other(cur, end);
        if (!nx) break;
        const [pl, e] = nx; used.add(pl);
        let p = Array.from(pl.pts);
        // walking away from the joint
        if ((dir === 1) === (e === 1)) { const r = []; for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]); p = r; }
        if (dir === 1) chain.push(p.slice(2)); else chain.unshift(p.slice(0, -2));
        cur = pl; end = 1 - e;
      }
    }
    out.push({ cls: start.cls, fl: start.fl, pts: Float64Array.from(chain.flat()) });
  }
  return out;
}
// ---- Douglas-Peucker
function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a * 2], az = pts[a * 2 + 1], dx = pts[b * 2] - ax, dz = pts[b * 2 + 1] - az, l = Math.hypot(dx, dz) || 1;
    let worst = 0, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax, pz = pts[i * 2 + 1] - az;
      const t = Math.max(0, Math.min(l, (px * dx + pz * dz) / l));
      const d = Math.hypot(px - dx / l * t, pz - dz / l * t);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return Float64Array.from(out);
}
/** cut into pieces no longer than maxLen (and no step longer than 8 km) */
function chop(pts, maxLen) {
  const out = []; let cur = [pts[0], pts[1]], run = 0;
  for (let i = 1; i < pts.length / 2; i++) {
    let ax = pts[i * 2 - 2], az = pts[i * 2 - 1];
    const bx = pts[i * 2], bz = pts[i * 2 + 1], d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / Math.min(maxLen, 8000)));
    for (let s = 1; s <= steps; s++) {
      const x = pts[i * 2 - 2] + (bx - pts[i * 2 - 2]) * s / steps, z = pts[i * 2 - 1] + (bz - pts[i * 2 - 1]) * s / steps;
      cur.push(x, z); run += Math.hypot(x - ax, z - az); ax = x; az = z;
      if ((run >= maxLen || cur.length >= 60000) && !(i === pts.length / 2 - 1 && s === steps)) { out.push(cur); cur = [x, z]; run = 0; }
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

function writeBlock(file, list, x0, z0, T, cell) {
  const cells = Array.from({ length: T * T }, () => []);
  let bytes = 0, nPl = 0, nPt = 0;
  for (const pl of merge(list)) {
    for (const piece of chop(simplify(pl.pts, TOL(pl.cls)), cell)) {
      const n = piece.length / 2, m = n >> 1;
      const ci = Math.min(T - 1, Math.max(0, Math.floor((piece[m * 2] - x0) / cell))), cj = Math.min(T - 1, Math.max(0, Math.floor((piece[m * 2 + 1] - z0) / cell)));
      const rec = Buffer.alloc(12 + (n - 1) * 4);
      rec[0] = pl.cls; rec[1] = pl.fl; rec.writeUInt16LE(n, 2);
      let qx = Math.round((piece[0] - x0) * Q), qz = Math.round((piece[1] - z0) * Q);
      rec.writeInt32LE(qx, 4); rec.writeInt32LE(qz, 8);
      for (let i = 1; i < n; i++) {
        const nx = Math.round((piece[i * 2] - x0) * Q), nz = Math.round((piece[i * 2 + 1] - z0) * Q);
        rec.writeInt16LE(nx - qx, 12 + (i - 1) * 4); rec.writeInt16LE(nz - qz, 14 + (i - 1) * 4);
        qx = nx; qz = nz;
      }
      cells[cj * T + ci].push(rec); bytes += rec.length; nPl++; nPt += n;
    }
  }
  const head = Buffer.alloc(24 + (T * T + 1) * 4);
  head.write('CFSR', 0, 'latin1'); head.writeUInt32LE(1, 4); head.writeUInt32LE(T, 8); head.writeUInt32LE(cell, 12); head.writeInt32LE(x0, 16); head.writeInt32LE(z0, 20);
  let off = 0;
  cells.forEach((c, i) => { head.writeUInt32LE(off, 24 + i * 4); for (const r of c) off += r.length; });
  head.writeUInt32LE(off, 24 + T * T * 4);
  const gz = gzipSync(Buffer.concat([head, ...cells.flat()]), { level: 9 });
  writeFileSync(file, gz);
  return { gz: gz.length, nPl, nPt };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/major`, { recursive: true }); mkdirSync(`${OUT}/local`, { recursive: true });
const blocks = [], locals = [];
let tot = { gz: 0, nPl: 0, nPt: 0 };
const add = (r) => { tot.gz += r.gz; tot.nPl += r.nPl; tot.nPt += r.nPt; };
// rails for the station snap: segments in 500 m bins
const railBins = new Map();
for (const [key, list] of groups) {
  if (key[0] === 'M') {
    const [bi, bj] = key.slice(1).split('_').map(Number);
    add(writeBlock(`${OUT}/major/${bi}_${bj}.bin.gz`, list, -HALF + bi * BLOCK, -HALF + bj * BLOCK, BLOCK / CELL, CELL));
    blocks.push([bi, bj]);
    for (const pl of list) if (pl.cls === 10) for (let i = 1; i < pl.pts.length / 2; i++) {
      const s = [pl.pts[i * 2 - 2], pl.pts[i * 2 - 1], pl.pts[i * 2], pl.pts[i * 2 + 1], pl.fl];
      const k = `${Math.floor((s[0] + s[2]) / 1000)},${Math.floor((s[1] + s[3]) / 1000)}`;
      let a = railBins.get(k); if (!a) railBins.set(k, a = []); a.push(s);
    }
  } else {
    const p = patches.find((q) => q.id === key.slice(1));
    add(writeBlock(`${OUT}/local/${p.id}.bin.gz`, list, p.x0, p.z0, Math.ceil(p.size / LCELL), LCELL));
    locals.push({ id: p.id, x0: p.x0, z0: p.z0, size: p.size });
  }
}
console.log(`${blocks.length} blocks, ${locals.length} local patches: ${tot.nPl} polylines, ${tot.nPt} points, ${(tot.gz / 1e6).toFixed(1)} MB gz`);

// ---- stations: on a main-line track, one per 500 m, platforms outside the outermost tracks
const stations = [];
if (existsSync(`${SRC}/stations.json`)) {
  const near = (x, z, r) => {
    const out = [];
    for (let i = Math.floor((x - r) / 500); i <= Math.floor((x + r) / 500); i++) for (let j = Math.floor((z - r) / 500); j <= Math.floor((z + r) / 500); j++) for (const s of railBins.get(`${i},${j}`) ?? []) out.push(s);
    return out;
  };
  const seen = new Map();
  for (const [lat, lon, name, conf] of JSON.parse(readFileSync(`${SRC}/stations.json`, 'utf8')).sort((a, b) => b[3] - a[3])) {
    if (conf < 0.5 || lon < LO0 || lon > LO1 || lat < LA0 || lat > LA1) continue;
    const c = lcc.forward(lat, lon);
    if (Math.abs(c.x) >= HALF || Math.abs(c.z) >= HALF) continue;
    let best = null, bd = 150;
    for (const s of near(c.x, c.z, 200)) {
      const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((c.x - s[0]) * dx + (c.z - s[1]) * dz) / l2));
      const d = Math.hypot(s[0] + dx * t - c.x, s[1] + dz * t - c.z);
      if (d < bd) { bd = d; best = { x: s[0] + dx * t, z: s[1] + dz * t, dx: dx / Math.sqrt(l2), dz: dz / Math.sqrt(l2) }; }
    }
    if (!best) continue;
    const cell = `${Math.round(best.x / 500)},${Math.round(best.z / 500)}`;
    let dup = false;
    for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1; j++) { const o = seen.get(`${Math.round(best.x / 500) + i},${Math.round(best.z / 500) + j}`); if (o && Math.hypot(o.x - best.x, o.z - best.z) < 500) { dup = true; break; } }
    if (dup) continue;
    seen.set(cell, best);
    // the tracks crossing the station's cross-section (within 40 m): platforms go outside the outermost ones
    let lo = 0, hi = 0;
    for (const s of near(best.x, best.z, 120)) {
      const dx = s[2] - s[0], dz = s[3] - s[1], l = Math.hypot(dx, dz) || 1;
      if (Math.abs((dx * best.dx + dz * best.dz) / l) < 0.94) continue;   // roughly parallel tracks only
      const t = ((best.x - s[0]) * dx + (best.z - s[1]) * dz) / (l * l);
      if (t < -0.2 || t > 1.2) continue;
      const px = s[0] + dx * t - best.x, pz = s[1] + dz * t - best.z;
      const off = px * -best.dz + pz * best.dx;   // + = right of the heading
      if (Math.abs(off) > 40) continue;
      lo = Math.min(lo, off); hi = Math.max(hi, off);
    }
    const hdg = (Math.atan2(best.dx, -best.dz) / D2R + 360) % 360;
    stations.push([Math.round(best.x), Math.round(best.z), Math.round(hdg), Math.round(lo * 10) / 10, Math.round(hi * 10) / 10, name]);
  }
}
writeFileSync(`${OUT}/stations.json`, JSON.stringify(stations));
writeFileSync(`${OUT}/index.json`, JSON.stringify({
  attribution: '© OpenStreetMap contributors, Overture Maps Foundation (ODbL)', release: '2026-10-21.0',
  half: HALF, block: BLOCK, cell: CELL, blocks, local: locals, localCell: LCELL,
}));
console.log(`${stations.length} stations`);
