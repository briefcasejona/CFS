// Real-world theaters built on a baked DEM (scripts/terrain/bake-theater.mjs): a square Int16 grid in a Lambert
// Conformal Conic frame, fetched and gunzipped on first use, with sub-kilometre noise relief added at runtime.
import { smoothstep } from '../core/math.js';
import { fbm } from './noise.js';
import { Lcc } from './lcc.js';
import type { Airbase, ObjectiveDef, Runway, Theater } from './theater.js';
import { RUNWAYS } from './theaters/runways.js';
import type { CoverPatch } from './landcover.js';

export interface DemConfig {
  proj: { lat0: number; lon0: number; lat1: number; lat2: number };
  half: number;   // m
  res: number;    // m per sample
  asset: string;  // folder under assets/theaters/
  /** grid spacing (m) of the baked landcover.bin.gz (scripts/terrain/bake-landcover.mjs), when there is one */
  cover?: number;
}

/** a square of finer heights: n×n samples from (x0, z0), res m apart */
export interface DemPatch { x0: number; z0: number; n: number; res: number; data: Int16Array }
/** width (m) of the band along a patch's edge over which it fades into the 1 km grid */
const PATCH_FADE = 6000;

export type AbRow = [id: string, name: string, side: 'blue' | 'red', lat: number, lon: number, trueHdg: number, length: number];
export type ObjRow = [id: string, name: string, kind: ObjectiveDef['kind'], side: 'blue' | 'red', lat: number, lon: number, value: number, samType?: ObjectiveDef['samType']];

export class DemGrid {
  readonly lcc: Lcc;
  readonly n: number;
  grid: Int16Array | null = null;
  /** high-resolution elevation around the airfields (scripts/terrain/bake-patches.mjs), blended over the grid */
  patches: DemPatch[] = [];
  constructor(readonly cfg: DemConfig) {
    this.lcc = new Lcc(cfg.proj);
    this.n = Math.round((2 * cfg.half) / cfg.res) + 1;
  }

  private sample(i: number, j: number) {
    const N = this.n;
    i = i < 0 ? 0 : i >= N ? N - 1 : i;
    j = j < 0 ? 0 : j >= N ? N - 1 : j;
    return this.grid![j * N + i];
  }

  /** bilinear DEM height plus sub-kilometre noise relief (none near sea level, so low coasts never flood) */
  rawHeight = (x: number, z: number): number => {
    if (!this.grid) return -50;
    const { half, res } = this.cfg;
    const fx = (x + half) / res, fz = (z + half) / res;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const h = (this.sample(i, j) * (1 - tx) + this.sample(i + 1, j) * tx) * (1 - tz) + (this.sample(i, j + 1) * (1 - tx) + this.sample(i + 1, j + 1) * tx) * tz;
    // near an airfield: the real fine relief, fading into the grid towards the patch edge
    let best: DemPatch | null = null, w = 0;
    for (const p of this.patches) {
      const span = (p.n - 1) * p.res, d = Math.min(x - p.x0, p.x0 + span - x, z - p.z0, p.z0 + span - z);
      if (d > 0 && d > w * PATCH_FADE) { best = p; w = Math.min(1, d / PATCH_FADE); }
    }
    const coarse = h <= 0 ? h : Math.max(0.6, h + this.relief(x, z, h));
    if (!best) return coarse;
    w = smoothstep(0, 1, w);
    const fine = patchHeight(best, x, z);
    const out = coarse * (1 - w) + fine * w;
    return fine > 0 ? Math.max(0.6, out) : out;
  };

  /** sub-kilometre noise relief for the 1 km grid (none near sea level, so low coasts never flood) */
  private relief(x: number, z: number, h: number) {
    const rough = smoothstep(80, 900, h), low = smoothstep(1, 40, h);
    return low * (fbm(x / 1400, z / 1400, 4) * (12 + 160 * rough) + fbm(x / 350, z / 350, 2) * (3 + 25 * rough));
  }

  /** grid bearing (deg) of true north at a point — runway headings are given true and converted to grid */
  northBearing(lat: number, lon: number) {
    const a = this.lcc.forward(lat, lon), b = this.lcc.forward(lat + 0.01, lon);
    return Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI;
  }

  /** a runway from its two thresholds (lat/lon), in the grid frame */
  runway(la0: number, lo0: number, la1: number, lo1: number): Runway {
    const a = this.lcc.forward(la0, lo0), b = this.lcc.forward(la1, lo1);
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hdg: (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360, length: Math.hypot(b.x - a.x, b.z - a.z) };
  }

  airbases(rows: AbRow[]): Airbase[] {
    return rows.map(([id, name, side, lat, lon, hdg, length]) => {
      const p = this.lcc.forward(lat, lon);
      const grid = (hdg + this.northBearing(lat, lon) + 360) % 360;
      const real = RUNWAYS[id];
      if (!real) return { id, name, side, x: p.x, z: p.z, hdg: grid, length, elev: 0 };
      // the real layout (OurAirports): the longest runway is the main one, flown in the direction the row gives
      const [main, ...rest] = real.map(([a, b, c, d]) => this.runway(a, b, c, d));
      const off = Math.abs(((main.hdg - grid + 540) % 360) - 180);
      if (off > 90) main.hdg = (main.hdg + 180) % 360;
      return { id, name, side, ...main, elev: 0, ...(rest.length ? { extra: rest } : {}) };
    });
  }
  objectives(rows: ObjRow[]): ObjectiveDef[] {
    return rows.map(([id, name, kind, side, lat, lon, value, samType]) => {
      const p = this.lcc.forward(lat, lon);
      return { id, name, kind, side, x: p.x, z: p.z, value, ...(samType ? { samType } : {}) };
    });
  }

  /** install the grid (browser: fetched by load(); tests: read from disk) and refresh airfield elevations */
  setGrid(g: Int16Array, theater: Theater) {
    if (g.length !== this.n * this.n) throw new Error(`${this.cfg.asset} grid has ${g.length} samples, expected ${this.n * this.n}`);
    this.grid = g;
    for (const ab of theater.airbases) ab.elev = Math.max(5, this.rawHeight(ab.x, ab.z));
  }

  /** install the airfield patches (index from patches.json, heights concatenated in that order) */
  setPatches(index: Array<{ x0: number; z0: number; n: number; res: number }>, heights: Int16Array, theater: Theater) {
    let off = 0;
    const patches: DemPatch[] = [];
    for (const p of index) {
      patches.push({ ...p, data: heights.subarray(off, off + p.n * p.n) });
      off += p.n * p.n;
    }
    if (off !== heights.length) throw new Error(`${this.cfg.asset} patches have ${heights.length} samples, expected ${off}`);
    this.patches = patches;
    for (const ab of theater.airbases) ab.elev = Math.max(5, this.rawHeight(ab.x, ab.z));
  }

  /** install the landcover grid (RGBA fractions on the cfg.cover spacing) */
  setCover(data: Uint8Array, theater: Theater) {
    const res = this.cfg.cover!, n = Math.round((2 * this.cfg.half) / res) + 1;
    if (data.length !== n * n * 4) throw new Error(`${this.cfg.asset} landcover has ${data.length} bytes, expected ${n * n * 4}`);
    theater.cover = { data, n, half: this.cfg.half, res };
  }

  /** Theater.load: fetch the DEM (+ optional map overlay) once */
  async load(theater: Theater) {
    if (this.grid) return;
    const base = `assets/theaters/${this.cfg.asset}`;
    const res = await fetch(`${base}/height.bin.gz`);
    if (!res.ok) throw new Error(`${theater.name} terrain not available (${res.status})`);
    this.setGrid(new Int16Array(await gunzip(res)), theater);
    // finer elevation around the airfields — optional: without it the 1 km grid (plus noise) is used everywhere
    try {
      const [ix, hb] = await Promise.all([fetch(`${base}/patches.json`), fetch(`${base}/patches.bin.gz`)]);
      if (ix.ok && hb.ok) this.setPatches((await ix.json()).patches, new Int16Array(await gunzip(hb)), theater);
    } catch { /* offline without the patches cached */ }
    // satellite landcover (forests, towns, fields) — optional: without it the ground is coloured procedurally
    if (this.cfg.cover) {
      try {
        const c = await fetch(`${base}/landcover.bin.gz`);
        if (c.ok) this.setCover(new Uint8Array(await gunzip(c)), theater);
      } catch { /* offline without the landcover cached */ }
      // fine landcover around the airfields (houses on real built-up land, full forests) — optional as well
      try {
        const [ix, cb] = await Promise.all([fetch(`${base}/coverdetail.json`), fetch(`${base}/coverdetail.bin.gz`)]);
        if (ix.ok && cb.ok && theater.cover) theater.cover.detail = splitCoverDetail((await ix.json()).patches, new Uint8Array(await gunzip(cb)));
      } catch { /* offline without the fine landcover cached */ }
    }
    // borders and cities for the map — optional, the theater flies without them
    try {
      const o = await fetch(`${base}/overlay.json`);
      if (o.ok) theater.overlay = await o.json();
    } catch { /* offline without the overlay cached */ }
  }
}

/** cut the concatenated detail patches (coverdetail.bin.gz) apart */
export function splitCoverDetail(index: Array<{ x0: number; z0: number; n: number; res: number }>, data: Uint8Array): CoverPatch[] {
  const out: CoverPatch[] = [];
  let o = 0;
  for (const p of index) {
    const len = Math.ceil((p.n * p.n) / 4);
    if (o + len > data.length) throw new Error('coverdetail.bin.gz is shorter than its index');
    out.push({ x0: p.x0, z0: p.z0, n: p.n, res: p.res, data: data.subarray(o, o + len) });
    o += len;
  }
  return out;
}

/** a fetched body, gunzipped unless a server already did (Content-Encoding: gzip) */
async function gunzip(res: Response): Promise<ArrayBuffer> {
  const bytes = await res.arrayBuffer();
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/** bilinear height inside a patch */
function patchHeight(p: DemPatch, x: number, z: number) {
  const fx = (x - p.x0) / p.res, fz = (z - p.z0) / p.res, N = p.n;
  const i = Math.min(N - 2, Math.max(0, Math.floor(fx))), j = Math.min(N - 2, Math.max(0, Math.floor(fz))), tx = fx - i, tz = fz - j;
  const d = p.data, k = j * N + i;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + N] * (1 - tx) + d[k + N + 1] * tx) * tz;
}
