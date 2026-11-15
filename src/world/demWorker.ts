// Web Worker for the fine-elevation streaming (demStream.ts): fetches and decodes the Terrarium tiles and resamples
// them into cells, so none of that (≈100k projections and bilinear samples per cell) runs in a frame.
//
// in:  { type: 'init', proj }                    the theater's projection (resets everything)
//      { type: 'want', cells: [[ci, cj], …] }    the cells the game lacks, nearest first (replaces the last list)
//      { type: 'drop', cells: [[ci, cj], …] }    cells the game dropped (may be wanted again later)
// out: { type: 'cell', ci, cj, data, missing, ok, errors }   data: Float32Array NS × NS (NaN where no tile)
//      { type: 'stat', ok, errors }
import { Lcc, type LccParams } from './lcc.js';
import { NS, fetchTile, resampleCell, tilesOf } from './demCell.js';

const MAX_INFLIGHT = 6;
const MAX_TILES = 220;
type Msg = { type: 'init'; proj: LccParams } | { type: 'want'; cells: Array<[number, number]> } | { type: 'drop'; cells: Array<[number, number]> };
const ctx = self as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

let lcc: Lcc | null = null;
let gen = 0;
let want: Array<[number, number]> = [];
const sent = new Set<string>();
const tiles = new Map<string, Float32Array | null>();
const tileUsed = new Map<string, number>();
const pending = new Set<string>();
const tilesOfCell = new Map<string, string[]>();
let inflight = 0, ok = 0, errors = 0, tick = 0, scheduled = false;

function schedule() { if (!scheduled) { scheduled = true; setTimeout(pump, 0); } }

function load(t: string) {
  pending.add(t); inflight++;
  const g = gen;
  fetchTile(t).then((h) => { if (g !== gen) return; ok++; tiles.set(t, h); },
    () => {
      if (g !== gen) return;
      errors++;
      tiles.set(t, null);
      // retried after a while; meanwhile its cells wait (the coarse ground shows)
      setTimeout(() => { if (tiles.get(t) === null) tiles.delete(t); }, 20000);
    }).finally(() => {
    if (g !== gen) return;
    inflight--; pending.delete(t);
    ctx.postMessage({ type: 'stat', ok, errors });
    schedule();
  });
}

function pump() {
  scheduled = false;
  if (!lcc) return;
  tick++;
  for (const [ci, cj] of want) {
    const k = `${ci},${cj}`;
    if (sent.has(k)) continue;
    if (tilesOfCell.size > 4000) tilesOfCell.clear();
    let need = tilesOfCell.get(k);
    if (!need) { need = tilesOf(lcc, ci, cj); tilesOfCell.set(k, need); }
    let ready = true;
    for (const t of need) {
      tileUsed.set(t, tick);
      if (tiles.has(t)) continue;
      ready = false;
      if (!pending.has(t) && inflight < MAX_INFLIGHT) load(t);
    }
    if (ready) {
      const data = new Float32Array(NS * NS);
      const missing = resampleCell(lcc, ci, cj, (t) => tiles.get(t), data);
      sent.add(k);
      ctx.postMessage({ type: 'cell', ci, cj, data, missing, ok, errors }, [data.buffer]);
      // one cell per turn, so new want lists get in between
      schedule();
      break;
    }
  }
  if (tiles.size > MAX_TILES) {
    const order = [...tileUsed.entries()].sort((a, b) => a[1] - b[1]);
    for (const [t] of order) {
      if (tiles.size <= MAX_TILES) break;
      if (pending.has(t)) continue;
      tiles.delete(t); tileUsed.delete(t);
    }
  }
}

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen++; lcc = new Lcc(m.proj); want = []; sent.clear(); tiles.clear(); tileUsed.clear(); pending.clear(); tilesOfCell.clear();
    inflight = 0;
  } else if (m.type === 'want') {
    want = m.cells;
    schedule();
  } else if (m.type === 'drop') {
    for (const [ci, cj] of m.cells) sent.delete(`${ci},${cj}`);
  }
};
