// Real-world theaters built on a baked DEM (scripts/terrain/bake-theater.mjs): a square Int16 grid in a Lambert
// Conformal Conic frame, fetched and gunzipped on first use, with sub-kilometre noise relief added at runtime.
import { smoothstep } from '../core/math.js';
import { fbm } from './noise.js';
import { Lcc } from './lcc.js';
import type { Airbase, ObjectiveDef, Runway, Theater } from './theater.js';
import { RUNWAYS } from './theaters/runways.js';

export interface DemConfig {
  proj: { lat0: number; lon0: number; lat1: number; lat2: number };
  half: number;   // m
  res: number;    // m per sample
  asset: string;  // folder under assets/theaters/
}

export type AbRow = [id: string, name: string, side: 'blue' | 'red', lat: number, lon: number, trueHdg: number, length: number];
export type ObjRow = [id: string, name: string, kind: ObjectiveDef['kind'], side: 'blue' | 'red', lat: number, lon: number, value: number, samType?: ObjectiveDef['samType']];

export class DemGrid {
  readonly lcc: Lcc;
  readonly n: number;
  grid: Int16Array | null = null;
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
    if (h <= 0) return h;
    const rough = smoothstep(80, 900, h), low = smoothstep(1, 40, h);
    return Math.max(0.6, h + low * (fbm(x / 1400, z / 1400, 4) * (12 + 160 * rough) + fbm(x / 350, z / 350, 2) * (3 + 25 * rough)));
  };

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

  /** Theater.load: fetch the DEM (+ optional map overlay) once */
  async load(theater: Theater) {
    if (this.grid) return;
    const base = `assets/theaters/${this.cfg.asset}`;
    const res = await fetch(`${base}/height.bin.gz`);
    if (!res.ok) throw new Error(`${theater.name} terrain not available (${res.status})`);
    let bytes = await res.arrayBuffer();
    const head = new Uint8Array(bytes, 0, 2);
    // gunzip unless a server already did (Content-Encoding: gzip)
    if (head[0] === 0x1f && head[1] === 0x8b) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    this.setGrid(new Int16Array(bytes), theater);
    // borders and cities for the map — optional, the theater flies without them
    try {
      const o = await fetch(`${base}/overlay.json`);
      if (o.ok) theater.overlay = await o.json();
    } catch { /* offline without the overlay cached */ }
  }
}
