import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect } from './expect.js';
import { EUROPE, setEuropeGrid, setEuropePatches } from '../src/world/theaters/europe.js';

const read = (f: string) => { const b = gunzipSync(readFileSync(f)); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };

describe('airfield elevation patches', () => {
  it('blend in without a step at the patch edge and keep every field on land', () => {
    setEuropeGrid(read('assets/theaters/europe/height.bin.gz'));
    const before = EUROPE.airbases.map((ab) => EUROPE.rawHeight(ab.x + 30000, ab.z));
    const idx = JSON.parse(readFileSync('assets/theaters/europe/patches.json', 'utf8')).patches;
    setEuropePatches(idx, read('assets/theaters/europe/patches.bin.gz'));
    expect(idx.length).toBe(EUROPE.airbases.length);
    for (const ab of EUROPE.airbases) {
      expect(ab.elev).toBeGreaterThan(0);
      // across the patch edge (25 km out) the surface is continuous: samples 10 m apart differ by little
      const a = EUROPE.rawHeight(ab.x + 24995, ab.z), b = EUROPE.rawHeight(ab.x + 25005, ab.z);
      expect(Math.abs(a - b)).toBeLessThan(15);
    }
    // outside every patch nothing changed
    EUROPE.airbases.forEach((ab, k) => {
      const far = EUROPE.airbases.every((o) => Math.abs(o.x - ab.x - 30000) > 25000 || Math.abs(o.z - ab.z) > 25000);
      if (far) expect(EUROPE.rawHeight(ab.x + 30000, ab.z)).toBe(before[k]);
    });
  });
});
