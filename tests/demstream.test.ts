import { describe, expect, it } from './expect.js';
import { DemStream, CELL } from '../src/world/demStream.js';
import { Lcc } from '../src/world/lcc.js';

describe('streamed fine elevation', () => {
  it('fades in only where a cell and all its neighbours are loaded, so it never ends in a step', () => {
    const s = new DemStream(new Lcc({ lat0: 49.6, lon0: 7, lat1: 41, lat2: 57 }), 1420000, () => true);
    // install a 3×3 block of flat 500 m cells directly (the browser builds them from Terrarium tiles)
    const priv = s as unknown as { cells: Map<number, unknown>; reweight(ci: number, cj: number): void };
    const NS = CELL / 25 + 1;
    for (let cj = -1; cj <= 1; cj++) for (let ci = -1; ci <= 1; ci++) {
      priv.cells.set((ci + 32768) * 65536 + (cj + 32768), { ci, cj, data: new Float32Array(NS * NS).fill(500), w: new Float32Array(4) });
    }
    for (let cj = -1; cj <= 1; cj++) for (let ci = -1; ci <= 1; ci++) priv.reweight(ci, cj);
    const o = { h: 0, w: 0 };
    // the middle cell is fully weighted, the ring fades out to nothing at its outer edge
    s.sample(CELL / 2, CELL / 2, o);
    expect(o.w).toBeCloseTo(1, 6);
    expect(o.h).toBeCloseTo(500, 3);
    s.sample(-CELL + 1, CELL / 2, o);
    expect(o.w < 0.01).toBe(true);
    s.sample(-CELL / 2, CELL / 2, o);
    expect(o.w > 0.3 && o.w < 0.7, `half way ${o.w}`).toBe(true);
    s.sample(3 * CELL, 0, o);
    expect(o.w).toBe(0);
  });
});
