// The part of the fine-elevation streaming (demStream.ts) that needs no game state: which Terrarium tiles a cell
// needs, decoding a tile and resampling the tiles into a cell's grid. Shared by the main thread (fallback) and the
// worker (demWorker.ts) that does this off the frame.
import { Lcc } from './lcc.js';

export const CELL = 8000;          // m
export const RES = 25;             // m between samples
export const NS = CELL / RES + 1;  // samples per side (both edges)
export const Z = 12;               // Terrarium zoom
const WORLD = 256 * 2 ** Z;        // Terrarium pixels around the world at Z
export const tileUrl = (t: string) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${t}.png`;

function merc(lat: number, lon: number, out: { x: number; y: number }) {
  const f = lat * Math.PI / 180;
  out.x = ((lon + 180) / 360) * WORLD;
  out.y = ((1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2) * WORLD;
  return out;
}

/** the Terrarium tiles ("x/y") a cell's samples (and their bilinear neighbours) fall in */
export function tilesOf(lcc: Lcc, ci: number, cj: number): string[] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const p = { x: 0, y: 0 };
  for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) {
    const ll = lcc.inverse((ci + a / 2) * CELL, (cj + b / 2) * CELL);
    merc(ll.lat, ll.lon, p);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const out: string[] = [];
  for (let ty = Math.floor((y0 - 2) / 256); ty <= Math.floor((y1 + 2) / 256); ty++) {
    for (let tx = Math.floor((x0 - 2) / 256); tx <= Math.floor((x1 + 2) / 256); tx++) out.push(`${tx}/${ty}`);
  }
  return out;
}

/** fetch and decode one Terrarium tile into metres; null where there is none (open sea). Throws on network errors. */
export async function fetchTile(t: string): Promise<Float32Array | null> {
  const r = await fetch(tileUrl(t), { mode: 'cors', referrerPolicy: 'no-referrer' });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(String(r.status));
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const cx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  cx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const px = cx.getImageData(0, 0, 256, 256).data;
  const h = new Float32Array(256 * 256);
  for (let k = 0; k < 256 * 256; k++) h[k] = px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768;
  return h;
}

/** Resample the tiles into a cell's NS × NS grid (row-major, north row first in z). Samples without a tile are NaN.
 *  Returns how many samples had no tile. */
export function resampleCell(lcc: Lcc, ci: number, cj: number, tile: (t: string) => Float32Array | null | undefined, data: Float32Array): number {
  let missing = 0;
  let lastKey = '', last: Float32Array | null | undefined = null;
  const at = (px: number, py: number) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const k = `${tx}/${ty}`;
    if (k !== lastKey) { lastKey = k; last = tile(k); }
    if (!last) return NaN;
    return last[(py - ty * 256) * 256 + (px - tx * 256)];
  };
  const x0 = ci * CELL, z0 = cj * CELL, p = { x: 0, y: 0 };
  for (let j = 0; j < NS; j++) {
    for (let i = 0; i < NS; i++) {
      const ll = lcc.inverse(x0 + i * RES, z0 + j * RES);
      merc(ll.lat, ll.lon, p);
      // bilinear between pixel centres
      const fx = p.x - 0.5, fy = p.y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
      const h = (at(ix, iy) * (1 - ax) + at(ix + 1, iy) * ax) * (1 - ay) + (at(ix, iy + 1) * (1 - ax) + at(ix + 1, iy + 1) * ax) * ay;
      if (Number.isNaN(h)) missing++;
      data[j * NS + i] = h;
    }
  }
  return missing;
}
