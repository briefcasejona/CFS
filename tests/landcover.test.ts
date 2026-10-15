import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect } from './expect.js';
import { EUROPE, setEuropeCover, europeLcc } from '../src/world/theaters/europe.js';
import { VARNIA } from '../src/world/theaters/varnia.js';
import { coverAt, coverOf, coverMask, patchNoise, treeAt, builtAt, detailClass, COVER_BUILT, COVER_WATER, PATCH } from '../src/world/landcover.js';
import { splitCoverDetail } from '../src/world/demTheater.js';

describe('landcover', () => {
  it('Europe: the baked WorldCover grid puts towns, forest and water where they are', () => {
    const buf = gunzipSync(readFileSync('assets/theaters/europe/landcover.bin.gz'));
    setEuropeCover(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const g = EUROPE.cover!;
    const at = (lat: number, lon: number, ch: number) => { const p = europeLcc.forward(lat, lon); return coverAt(g, p.x, p.z, ch); };
    expect(at(52.37, 4.9, 1)).toBeGreaterThan(0.6);    // Amsterdam: built up
    expect(at(48.0, 8.2, 0)).toBeGreaterThan(0.6);     // Black Forest
    expect(at(52.6, 5.4, 3)).toBeGreaterThan(0.8);     // IJsselmeer: open water
    expect(at(52.6, 5.4, 0)).toBeLessThan(0.05);
  });

  it('Europe: around the airfields houses follow the 20 m WorldCover cells: in towns, never in water', () => {
    const buf = gunzipSync(readFileSync('assets/theaters/europe/landcover.bin.gz'));
    setEuropeCover(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const g = EUROPE.cover!;
    const idx = JSON.parse(readFileSync('assets/theaters/europe/coverdetail.json', 'utf8')).patches;
    g.detail = splitCoverDetail(idx, new Uint8Array(gunzipSync(readFileSync('assets/theaters/europe/coverdetail.bin.gz'))));
    const cls = (lat: number, lon: number) => { const p = europeLcc.forward(lat, lon); return detailClass(g, p.x, p.z); };
    expect(cls(53.201, 5.799)).toBe(COVER_BUILT);       // Leeuwarden town centre
    expect(cls(53.40, 5.60)).toBe(COVER_WATER);        // Wadden Sea north of Harlingen
    // no house on any water cell of the Leeuwarden patch, and some in the town
    const p = g.detail[idx.findIndex((q: { id: string }) => q.id === 'leeuwarden')];
    let wet = 0, town = 0;
    for (let k = 0; k < 20000; k++) {
      const x = p.x0 + ((k * 7919) % 50000), z = p.z0 + ((k * 104729) % 50000);
      if (!builtAt(g, x, z)) continue;
      if (detailClass(g, x, z) === COVER_WATER) wet++; else town++;
    }
    expect(wet).toBe(0);
    expect(town).toBeGreaterThan(100);
    g.detail = undefined;
  });

  it('a fraction f paints about f of the ground (shader and instanced trees agree on where)', () => {
    for (const f of [0.1, 0.35, 0.7]) {
      let n = 0;
      const N = 20000;
      for (let k = 0; k < N; k++) {
        const x = (k * 7919) % 400000, z = Math.floor(k * 7919 / 400000) * 977 + (k % 13) * 3011;
        if (coverMask(f, patchNoise(x, z, PATCH.tree[0], PATCH.tree[1])) > 0.5) n++;
      }
      expect(Math.abs(n / N - f)).toBeLessThan(0.06);
    }
    const g = { data: new Uint8Array(4 * 9).fill(0), n: 3, half: 1000, res: 1000 };
    expect(treeAt(g, 0, 0)).toBe(false);
    expect(builtAt(g, 0, 0)).toBe(false);
  });

  it('Varnia gets a procedural grid: forests, fields and its cities', () => {
    const g = coverOf(VARNIA);
    expect(g.n).toBeLessThan(1026);
    const city = VARNIA.objectives.find((o) => o.kind === 'city')!;
    expect(coverAt(g, city.x, city.z, 1)).toBeGreaterThan(0.5);
    let tree = 0;
    for (let k = 0; k < g.n * g.n; k++) tree += g.data[k * 4];
    expect(tree / (255 * g.n * g.n)).toBeGreaterThan(0.1);
  });
});
