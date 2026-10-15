// Ground cover per theater: fractions of forest, built-up land, cropland and open water on a square grid in the
// theater frame. Real-world theaters bake theirs from ESA WorldCover (scripts/terrain/bake-landcover.mjs); the
// fictional Varnia gets a procedural one from the noise that used to colour its forests.
// The terrain shader turns the (smooth, ~1 km) fractions into crisp patches by thresholding a shared tiling noise;
// treeAt() / builtAt() below repeat that test on the CPU so instanced trees and buildings land on the painted patches.
import { smoothstep } from '../core/math.js';
import { fbm } from './noise.js';
import type { Theater } from './theater.js';

/** Uint8 RGBA per cell (tree, built-up, cropland, water × 255), row-major z then x; cell (i, j) sits at
 *  (−half + i·res, −half + j·res) */
export interface CoverGrid { data: Uint8Array; n: number; half: number; res: number; detail?: CoverPatch[] }

/** Fine landcover around an airfield (scripts/terrain/bake-coverdetail.mjs): the WorldCover class at each cell,
 *  2 bits (0 other, 1 tree, 2 built-up, 3 water), 4 cells per byte, low bits first, row-major z then x; cell (i, j)
 *  sits at (x0 + i·res, z0 + j·res). */
export interface CoverPatch { x0: number; z0: number; n: number; res: number; data: Uint8Array }
export const COVER_TREE = 1, COVER_BUILT = 2, COVER_WATER = 3;

/** the fine landcover class at x, z (nearest cell), or −1 outside every detail patch */
export function detailClass(g: CoverGrid, x: number, z: number): number {
  if (!g.detail) return -1;
  for (const p of g.detail) {
    const i = Math.round((x - p.x0) / p.res), j = Math.round((z - p.z0) / p.res);
    if (i < 0 || j < 0 || i >= p.n || j >= p.n) continue;
    const k = j * p.n + i;
    return (p.data[k >> 2] >> ((k & 3) * 2)) & 3;
  }
  return -1;
}

/** bilinear cover fraction (0..1) of one channel: 0 tree, 1 built-up, 2 cropland, 3 water */
export function coverAt(g: CoverGrid, x: number, z: number, ch: number): number {
  const fx = (x + g.half) / g.res, fz = (z + g.half) / g.res, N = g.n;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const s = (a: number, b: number) => {
    a = a < 0 ? 0 : a >= N ? N - 1 : a;
    b = b < 0 ? 0 : b >= N ? N - 1 : b;
    return g.data[(b * N + a) * 4 + ch];
  };
  return ((s(i, j) * (1 - tx) + s(i + 1, j) * tx) * (1 - tz) + (s(i, j + 1) * (1 - tx) + s(i + 1, j + 1) * tx) * tz) / 255;
}

/** the active theater's cover grid: baked (loaded with the DEM) or, for procedural theaters, generated once */
export function coverOf(t: Theater): CoverGrid {
  return t.cover ??= proceduralCover(t);
}

function proceduralCover(t: Theater): CoverGrid {
  // (also the fallback for a real theater whose landcover did not load: kept to ≤ 1025² cells)
  const half = t.half, n = Math.min(1025, Math.round((2 * half) / 500) + 1), res = (2 * half) / (n - 1);
  const data = new Uint8Array(n * n * 4);
  const desert = t.palette?.style === 'desert';
  const cities = t.objectives.filter((o) => o.kind === 'city');
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * res, z = -half + j * res;
    const tree = desert ? 0 : smoothstep(0.5, 0.62, fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5);
    const crop = desert ? 0 : (1 - tree) * 0.85 * smoothstep(-0.25, 0.25, fbm(x * 0.00022 + 5.3, z * 0.00022 - 1.7, 3));
    let built = 0;
    for (const c of cities) built = Math.max(built, 0.75 * Math.exp(-(((x - c.x) ** 2 + (z - c.z) ** 2) / 2200 ** 2)));
    const k = (j * n + i) * 4;
    data[k] = Math.round(tree * (1 - built) * 255);
    data[k + 1] = Math.round(built * 255);
    data[k + 2] = Math.round(crop * (1 - built) * 255);
  }
  return { data, n, half, res };
}

// ---- the shared patch noise: a tiling 256² grey texture (also the near-field detail grain)
export const DETAIL_N = 256;
let detail: Uint8Array | null = null;
/** the tiling noise, one byte per texel (row j at v = (j + 0.5) / N, no flip) */
export function detailNoise(): Uint8Array {
  if (detail) return detail;
  const N = DETAIL_N;
  const raw = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // tileable: fbm sampled on a torus
    const a = i / N * Math.PI * 2, b = j / N * Math.PI * 2;
    raw[j * N + i] = fbm(Math.cos(a) * 3 + 17, Math.sin(a) * 3 + Math.cos(b) * 3 + 5, 4) * 0.5 + fbm(Math.sin(b) * 6, Math.cos(a) * 6 + 9, 3) * 0.5;
  }
  // equalised to a uniform 0..255 spread, so a threshold at f passes about a fraction f of the ground
  const order = Array.from(raw.keys()).sort((p, q) => raw[p] - raw[q]);
  detail = new Uint8Array(N * N);
  order.forEach((k, r) => { detail![k] = Math.floor((r * 256) / (N * N)); });
  return detail;
}
/** bilinear, wrapping lookup like the GPU's (LinearFilter, RepeatWrapping) at uv */
function detailAt(u: number, v: number) {
  const N = DETAIL_N, d = detailNoise();
  const fx = u * N - 0.5, fy = v * N - 0.5;
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const s = (a: number, b: number) => d[((b & (N - 1)) * N) + (a & (N - 1))];
  return ((s(i, j) * (1 - tx) + s(i + 1, j) * tx) * (1 - ty) + (s(i, j + 1) * (1 - tx) + s(i + 1, j + 1) * tx) * ty) / 255;
}

/** patch noise (≈ uniform 0..1) at world x, z: the same sum as patchN() in the terrain shader */
export function patchNoise(x: number, z: number, scale: number, off: number) {
  const a = detailAt(x / scale + off, z / scale + off), b = detailAt(x / (scale * 0.37) + off * 1.7, z / (scale * 0.37) + off * 1.7);
  return Math.min(1, Math.max(0, (a * 0.65 + b * 0.35 - 0.5) * 1.36 + 0.5));
}
/** a fraction f becomes a crisp patch where the noise allows: coverage ≈ f (shader: coverMask) */
export function coverMask(f: number, n: number) { return smoothstep(-0.06, 0.06, f - (1 - n)) * smoothstep(0, 0.05, f); }

/** patch scales and offsets shared with the shader */
export const PATCH = { tree: [1900, 0.13], built: [1100, 0.61], crop: [2600, 0.83] } as const;

/** forest at x, z (instanced trees go where the shader paints forest) */
export function treeAt(g: CoverGrid, x: number, z: number) {
  const c = detailClass(g, x, z);
  if (c >= 0) return c === COVER_TREE;
  return coverMask(coverAt(g, x, z, 0), patchNoise(x, z, PATCH.tree[0], PATCH.tree[1])) > 0.5;
}
/** built-up land at x, z (instanced houses) */
export function builtAt(g: CoverGrid, x: number, z: number) {
  const c = detailClass(g, x, z);
  if (c >= 0) {
    // built-up with built-up on at least three sides: towns and villages, not the single-cell lines of roads
    if (c !== COVER_BUILT) return false;
    const r = g.detail![0].res;
    let n = 0;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (detailClass(g, x + dx, z + dz) === COVER_BUILT) n++;
    return n >= 3;
  }
  // away from the detail patches: never on a cell that is mostly water
  if (coverAt(g, x, z, 3) > 0.5) return false;
  return coverMask(coverAt(g, x, z, 1), patchNoise(x, z, PATCH.built[0], PATCH.built[1])) > 0.5;
}
