// Streamed fine elevation for the real-world theaters: AWS Terrain Tiles (Terrarium PNG, zoom 12 — about 25–30 m a
// pixel here; USGS 3DEP in the US, SRTM / EU-DEM / national models in Europe) fetched around the camera at runtime
// and resampled into the game frame, so every valley, ridge and river bank within ~25 km is the real one instead of
// the 1 km grid smoothed with noise. The 1 km grid (and the 75 m airfield patches) stay underneath: the fine data
// fades in over the outermost cell of the loaded area, so there is never a step where it ends.
//
// The game frame is cut into CELL-sized squares of RES-spaced samples. A cell is built once every Terrarium tile under
// it has arrived (one cell per frame at most: ~100k projections), and cells far behind the camera are dropped again.
// `version` counts the changes; `changedSince` says which squares of the ground changed, so the terrain renderer can
// rebuild the chunks that lie on them.
//
// In a browser the tiles are fetched, decoded and resampled in a Web Worker (demWorker.ts), so a cell arriving costs
// the frame only the copy into the map; where workers can't start it all runs here, one cell per frame.
import type { Lcc } from './lcc.js';
import { CELL, RES, NS, fetchTile as fetchTerrarium, resampleCell, tilesOf } from './demCell.js';
export { CELL, RES } from './demCell.js';

const LOAD_R = 26000;              // m: cells within this of the camera (or of where it will be in 20 s) are wanted
const DROP_R = 48000;              // m: cells further than this are dropped
const MAX_INFLIGHT = 6;
const MAX_TILES = 220;             // decoded tiles kept (256 KB each)

let enabled = true;
/** Settings → Detailed terrain (off: nothing is downloaded, the 1 km grid and the airfield patches are used) */
export function setDemStreamEnabled(on: boolean) { enabled = on; }

interface FineCell {
  ci: number; cj: number;
  data: Float32Array;
  /** fade weights at the cell's corners (NW, NE, SW, SE): 1 where all four cells that share the corner are loaded */
  w: Float32Array;
}

const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);

export class DemStream {
  private cells = new Map<number, FineCell>();
  private tiles = new Map<string, Float32Array | null>();   // null = no tile there (open sea) or failed
  private tileUsed = new Map<string, number>();
  private pending = new Set<string>();
  private inflight = 0;
  private errors = 0;
  private ok = 0;
  private frame = 0;
  private wantList: Array<[number, number, number]> = [];
  private changes: Array<{ v: number; x0: number; z0: number; x1: number; z1: number }> = [];
  version = 0;
  /** the worker (null: not started yet or not available; false: failed, everything runs here) */
  private worker: Worker | null | false = null;
  /** the want list last sent to the worker */
  private sentWant = '';

  /**
   * @param lcc the theater's projection
   * @param coarseLand whether the 1 km grid holds land at a point (below-sea-level land like polders stays dry)
   */
  constructor(private readonly lcc: Lcc, private readonly half: number, private readonly coarseLand: (x: number, z: number) => boolean) {}

  /** whether this browser can stream at all (tests run in node: never) */
  static supported() { return typeof document !== 'undefined' && typeof createImageBitmap !== 'undefined'; }

  /** Drop everything (theater switch). */
  clear() {
    if (this.cells.size) this.bump(-this.half, -this.half, this.half, this.half);
    this.cells.clear();
    this.tiles.clear(); this.tileUsed.clear(); this.pending.clear();
    if (this.worker) { this.worker.postMessage({ type: 'init', proj: this.lcc.p }); this.sentWant = ''; }
  }

  private startWorker(): Worker | false {
    if (typeof Worker === 'undefined') return false;
    try {
      const w = new Worker(new URL('./demWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        this.ok = Math.max(this.ok, m.ok); this.errors = Math.max(this.errors, m.errors);
        if (m.type === 'cell') this.insert(m.ci, m.cj, m.data, m.missing);
      };
      // (e.g. a desktop build served from file://): fall back to building here
      w.onerror = () => { console.warn('Detailed terrain worker failed; building cells on the main thread.'); w.terminate(); this.worker = false; this.sentWant = ''; };
      w.postMessage({ type: 'init', proj: this.lcc.p });
      return w;
    } catch { return false; }
  }

  /** streaming here at all: switched on, in a browser, and the tile service reachable */
  get active() { return enabled && DemStream.supported() && !(this.errors > 12 && this.ok === 0); }

  /** Follow the camera: request the tiles of the wanted cells, build at most one cell, drop the far ones. */
  update(x: number, z: number, vx = 0, vz = 0) {
    if (!this.active) return;
    this.frame++;
    // where the camera will be in 20 s, so a fast jet finds the ground ahead already loaded
    const px = x + vx * 20, pz = z + vz * 20;
    if (this.frame % 15 === 1) {
      this.wantList = [];
      const r = Math.ceil(LOAD_R / CELL) + 1;
      const seen = new Set<number>();
      for (const [cx, cz] of [[x, z], [px, pz]]) {
        const ic = Math.floor(cx / CELL), jc = Math.floor(cz / CELL);
        for (let cj = jc - r; cj <= jc + r; cj++) for (let ci = ic - r; ci <= ic + r; ci++) {
          const mx = (ci + 0.5) * CELL, mz = (cj + 0.5) * CELL;
          if (Math.abs(mx) > this.half + CELL || Math.abs(mz) > this.half + CELL) continue;
          const d = Math.hypot(mx - cx, mz - cz) - CELL * 0.7;
          if (d > LOAD_R || seen.has(key(ci, cj))) continue;
          seen.add(key(ci, cj));
          // the camera's own surroundings first
          this.wantList.push([Math.hypot(mx - x, mz - z), ci, cj]);
        }
      }
      this.wantList.sort((a, b) => a[0] - b[0]);
      // drop the cells far behind
      const dropped: Array<[number, number]> = [];
      for (const [k, c] of this.cells) {
        const mx = (c.ci + 0.5) * CELL, mz = (c.cj + 0.5) * CELL;
        if (Math.min(Math.hypot(mx - x, mz - z), Math.hypot(mx - px, mz - pz)) > DROP_R) {
          this.cells.delete(k);
          dropped.push([c.ci, c.cj]);
          this.reweight(c.ci, c.cj);
          this.bump(c.ci * CELL - CELL, c.cj * CELL - CELL, (c.ci + 2) * CELL, (c.cj + 2) * CELL);
        }
      }
      this.trimTiles();
      if (this.worker === null) this.worker = this.startWorker();
      if (this.worker) {
        if (dropped.length) this.worker.postMessage({ type: 'drop', cells: dropped });
        const lack = this.wantList.filter(([, ci, cj]) => !this.cells.has(key(ci, cj))).map(([, ci, cj]) => [ci, cj]);
        const sig = lack.join(';');
        if (sig !== this.sentWant) { this.sentWant = sig; this.worker.postMessage({ type: 'want', cells: lack }); }
      }
    }
    if (this.worker) return;
    // tiles for the nearest unloaded cells; build the first cell whose tiles are all here
    let built = false;
    for (const [, ci, cj] of this.wantList) {
      if (this.cells.has(key(ci, cj))) continue;
      const need = this.tilesOf(ci, cj);
      let ready = true;
      for (const t of need) {
        this.tileUsed.set(t, this.frame);
        if (this.tiles.has(t)) continue;
        ready = false;
        if (!this.pending.has(t) && this.inflight < MAX_INFLIGHT) this.fetchTile(t);
      }
      if (ready && !built) { this.build(ci, cj, need); built = true; }
      if (this.inflight >= MAX_INFLIGHT && built) break;
    }
  }

  /** fine height at a point and how much of it to use (0 = none: use the coarse terrain) */
  sample(x: number, z: number, out: { h: number; w: number }) {
    out.w = 0;
    if (!this.cells.size) return out;
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    const c = this.cells.get(key(ci, cj));
    if (!c) return out;
    const lx = x - ci * CELL, lz = z - cj * CELL;
    const tx = lx / CELL, tz = lz / CELL;
    const w = (c.w[0] * (1 - tx) + c.w[1] * tx) * (1 - tz) + (c.w[2] * (1 - tx) + c.w[3] * tx) * tz;
    if (w <= 0) return out;
    const fx = lx / RES, fz = lz / RES;
    const i = Math.min(NS - 2, Math.floor(fx)), j = Math.min(NS - 2, Math.floor(fz)), ax = fx - i, az = fz - j;
    const d = c.data, k = j * NS + i;
    out.h = (d[k] * (1 - ax) + d[k + 1] * ax) * (1 - az) + (d[k + NS] * (1 - ax) + d[k + NS + 1] * ax) * az;
    out.w = w * w * (3 - 2 * w);
    return out;
  }

  /** the ground squares (game x0, z0, x1, z1) that changed after version `v` */
  changedSince(v: number) { return this.changes.filter((c) => c.v > v); }

  /** how many cells are loaded (for the debug overlay and tests) */
  get loaded() { return this.cells.size; }

  // ---- internals

  private bump(x0: number, z0: number, x1: number, z1: number) {
    this.version++;
    this.changes.push({ v: this.version, x0, z0, x1, z1 });
    if (this.changes.length > 400) this.changes.splice(0, this.changes.length - 400);
  }

  private tilesOf(ci: number, cj: number) { return tilesOf(this.lcc, ci, cj); }

  private fetchTile(t: string) {
    this.pending.add(t);
    this.inflight++;
    fetchTerrarium(t)
      .then((h) => { this.ok++; this.tiles.set(t, h); })
      .catch(() => {
        this.errors++;
        if (this.errors === 13 && this.ok === 0) console.warn('Detailed terrain unavailable (elevation-tiles-prod); using the 1 km grid.');
        // a failed tile is retried after a while; meanwhile its cells wait (the coarse ground shows)
        this.tiles.set(t, null);
        setTimeout(() => { if (this.tiles.get(t) === null) this.tiles.delete(t); }, 20000);
      })
      .finally(() => { this.inflight--; this.pending.delete(t); });
  }

  /** build a cell here (no worker) */
  private build(ci: number, cj: number, need: string[]) {
    const data = new Float32Array(NS * NS);
    const tl = new Map<string, Float32Array | null>();
    for (const t of need) tl.set(t, this.tiles.get(t) ?? null);
    const missing = resampleCell(this.lcc, ci, cj, (t) => tl.get(t), data);
    this.insert(ci, cj, data, missing);
  }

  /** put a resampled cell into the map: the gaps and the land below sea level fixed from the 1 km grid */
  private insert(ci: number, cj: number, data: Float32Array, missing: number) {
    const x0 = ci * CELL, z0 = cj * CELL;
    for (let j = 0, k = 0; j < NS; j++) {
      for (let i = 0; i < NS; i++, k++) {
        const h = data[k];
        if (h > 0.5) continue;
        const x = x0 + i * RES, z = z0 + j * RES;
        if (Number.isNaN(h)) data[k] = this.coarseLand(x, z) ? 1 : -20;
        // land below sea level (polders) stays dry where the 1 km grid (corrected by the Natural Earth land mask)
        // says land; the sea floor is kept a little below the surface
        else if (this.coarseLand(x, z)) data[k] = Math.max(0.6, h);
      }
    }
    const c: FineCell = { ci, cj, data, w: new Float32Array(4) };
    this.cells.set(key(ci, cj), c);
    this.reweight(ci, cj);
    // the cell and its neighbours (their fades changed)
    this.bump((ci - 1) * CELL, (cj - 1) * CELL, (ci + 2) * CELL, (cj + 2) * CELL);
    if (missing > NS * NS / 2) this.errors++;
  }

  /** recompute the corner fades of a cell and its eight neighbours */
  private reweight(ci: number, cj: number) {
    const has = (i: number, j: number) => this.cells.has(key(i, j));
    // a corner (i, j) is the NW corner of cell (i, j)
    const corner = (i: number, j: number) => (has(i - 1, j - 1) && has(i, j - 1) && has(i - 1, j) && has(i, j) ? 1 : 0);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const c = this.cells.get(key(i, j));
      if (!c) continue;
      c.w[0] = corner(i, j); c.w[1] = corner(i + 1, j); c.w[2] = corner(i, j + 1); c.w[3] = corner(i + 1, j + 1);
    }
  }

  private trimTiles() {
    if (this.tiles.size <= MAX_TILES) return;
    const order = [...this.tileUsed.entries()].sort((a, b) => a[1] - b[1]);
    for (const [t] of order) {
      if (this.tiles.size <= MAX_TILES) break;
      this.tiles.delete(t); this.tileUsed.delete(t);
    }
  }
}
