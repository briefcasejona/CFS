// Roads and railways of a real-world theater (scripts/terrain/bake-transport.mjs, from OpenStreetMap / Overture Maps):
// reading the baked blocks and turning their polylines into ribbons that lie on the terrain. No rendering here.

/** class codes of the baked polylines */
export const MOTORWAY = 0, TRUNK = 1, PRIMARY = 2, SECONDARY = 3, TERTIARY = 4, UNCLASSIFIED = 5, RESIDENTIAL = 6, RAILWAY = 10;
export const F_BRIDGE = 1, F_LINK = 2, F_MINOR_RAIL = 4;

/** a block file: T × T cells of `cell` metres from (x0, z0) */
export interface RoadBlock { x0: number; z0: number; T: number; cell: number; offs: Uint32Array; data: DataView }
export interface Polyline { cls: number; flags: number; /** x, z pairs, world frame */ pts: Float64Array }

export function parseBlock(buf: ArrayBuffer): RoadBlock {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x52534643 || dv.getUint32(4, true) !== 1) throw new Error('not a CFSR v1 road block');
  const T = dv.getUint32(8, true), head = 24 + (T * T + 1) * 4;
  const offs = new Uint32Array(T * T + 1);
  for (let k = 0; k <= T * T; k++) offs[k] = dv.getUint32(24 + k * 4, true);
  return { x0: dv.getInt32(16, true), z0: dv.getInt32(20, true), T, cell: dv.getUint32(12, true), offs, data: new DataView(buf, head) };
}

/** the polylines stored in cell (ci, cj) of a block */
export function cellPolylines(b: RoadBlock, ci: number, cj: number): Polyline[] {
  const out: Polyline[] = [], dv = b.data;
  let o = b.offs[cj * b.T + ci];
  const end = b.offs[cj * b.T + ci + 1];
  while (o < end) {
    const cls = dv.getUint8(o), flags = dv.getUint8(o + 1), n = dv.getUint16(o + 2, true);
    let qx = dv.getInt32(o + 4, true), qz = dv.getInt32(o + 8, true);
    const pts = new Float64Array(n * 2);
    pts[0] = b.x0 + qx / 4; pts[1] = b.z0 + qz / 4;
    o += 12;
    for (let i = 1; i < n; i++, o += 4) {
      qx += dv.getInt16(o, true); qz += dv.getInt16(o + 2, true);
      pts[i * 2] = b.x0 + qx / 4; pts[i * 2 + 1] = b.z0 + qz / 4;
    }
    out.push({ cls, flags, pts });
  }
  return out;
}

/** half the paved (or ballasted) width in metres */
export function halfWidth(cls: number, flags: number): number {
  if (cls === RAILWAY) return flags & F_MINOR_RAIL ? 1.5 : 1.7;
  if (flags & F_LINK) return 3;
  return [5.75, 4.75, 4.25, 3.6, 3.1, 2.6, 2.75][cls] ?? 2.6;
}
/** drawn over one another in this order: the railway and the big roads last */
const rank = (p: Polyline) => (p.cls === RAILWAY ? 20 : 10 - p.cls);

export interface Ribbons {
  /** centreline points (two per ribbon vertex pair), relative to the origin given */
  position: Float32Array;
  /** across direction × mitre (x, z), half width (m), class */
  road: Float32Array;
  /** side (−1 / +1), metres along the polyline */
  uv: Float32Array;
  index: Uint32Array;
}

/**
 * Ribbons for a set of polylines. Each point gives two vertices on the centreline; the shader pushes them apart by the
 * half width (so it can keep a far road a pixel wide). Segments longer than `step` are divided so the ribbon follows
 * the ground; a bridge runs straight from one end's height to the other's, and nothing dips below `floor` (water).
 */
export function buildRibbons(polys: Polyline[], ox: number, oz: number, step: number, height: (x: number, z: number) => number, lift = 0.25, floor = 0.8): Ribbons {
  const P: number[] = [], R: number[] = [], U: number[] = [], I: number[] = [];
  const sorted = [...polys].sort((a, b) => rank(a) - rank(b));
  const xs: number[] = [], zs: number[] = [], ys: number[] = [];
  for (const pl of sorted) {
    xs.length = zs.length = ys.length = 0;
    const n = pl.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x = pl.pts[i * 2], z = pl.pts[i * 2 + 1];
      if (i > 0) {
        const px = pl.pts[i * 2 - 2], pz = pl.pts[i * 2 - 1], parts = Math.ceil(Math.hypot(x - px, z - pz) / step);
        for (let s = 1; s < parts; s++) { xs.push(px + (x - px) * s / parts); zs.push(pz + (z - pz) * s / parts); }
      }
      xs.push(x); zs.push(z);
    }
    const m = xs.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) ys.push(Math.max(height(xs[i], zs[i]), floor) + lift);
    if (pl.flags & F_BRIDGE) {
      // the deck: straight between the abutments, clear of whatever it crosses
      const a = ys[0], b = ys[m - 1];
      let run = 0, total = 0;
      for (let i = 1; i < m; i++) total += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      for (let i = 1; i < m - 1; i++) {
        run += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
        ys[i] = Math.max(ys[i], a + (b - a) * run / (total || 1));
      }
    }
    const hw = halfWidth(pl.cls, pl.flags), base = P.length / 3;
    let run = 0;
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
      let dx = xs[b] - xs[a], dz = zs[b] - zs[a];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // mitre: widen the joint by 1/cos of half the bend so the width stays even
      let miter = 1;
      if (i > 0 && i < m - 1) {
        const ax = xs[i] - xs[i - 1], az = zs[i] - zs[i - 1], al = Math.hypot(ax, az) || 1;
        miter = 1 / Math.max(0.5, (ax / al) * dx + (az / al) * dz);
      }
      if (i > 0) run += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
      for (const side of [-1, 1]) {
        P.push(xs[i] - ox, ys[i], zs[i] - oz);
        R.push(-dz * miter, dx * miter, hw, pl.cls);
        U.push(side, run);
      }
      if (i > 0) { const o = base + (i - 1) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
  }
  return { position: new Float32Array(P), road: new Float32Array(R), uv: new Float32Array(U), index: new Uint32Array(I) };
}

/** a baked station: on the track at x, z; platforms outside the tracks that lie `lo`…`hi` metres to the right */
export interface Station { x: number; z: number; hdg: number; lo: number; hi: number; name: string }
export function parseStations(rows: Array<[number, number, number, number, number, string]>): Station[] {
  return rows.map(([x, z, hdg, lo, hi, name]) => ({ x, z, hdg, lo, hi, name }));
}
