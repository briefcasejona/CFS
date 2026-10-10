import { describe, expect, it } from './expect.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Lcc } from '../src/world/lcc.js';
import { EUROPE, setEuropeGrid, europeLcc } from '../src/world/theaters/europe.js';
import * as T from '../src/world/theater.js';

const loadGrid = () => {
  const buf = gunzipSync(readFileSync('assets/theaters/europe/height.bin.gz'));
  setEuropeGrid(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
};

describe('Europe theater', () => {
  it('Lambert projection round-trips and has metric scale near 1', () => {
    const l = new Lcc({ lat0: 52, lon0: 10, lat1: 47, lat2: 57 });
    for (const [lat, lon] of [[52, 10], [42, -6], [62, 26], [55.2, 9.26]]) {
      const p = l.forward(lat, lon);
      const b = l.inverse(p.x, p.z);
      expect(b.lat).toBeCloseTo(lat, 6);
      expect(b.lon).toBeCloseTo(lon, 6);
    }
    // 1° of latitude ≈ 111 km
    const a = l.forward(52, 10), b = l.forward(53, 10);
    expect(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) / 111195 - 1)).toBeLessThan(0.02);
    expect(l.forward(53, 10).z).toBeLessThan(0); // north = −z
  });

  it('baked DEM: sea is water, the Alps are high, every airfield is on land', () => {
    loadGrid();
    const h = (lat: number, lon: number) => { const p = europeLcc.forward(lat, lon); return EUROPE.rawHeight(p.x, p.z); };
    expect(h(55.5, 3.0)).toBeLessThan(0);      // North Sea
    expect(h(45.9, 7.0)).toBeGreaterThan(1500); // Alps near Mont Blanc
    expect(h(52.1, 5.1)).toBeGreaterThan(-15);  // Utrecht (polder country, around sea level)
    for (const ab of EUROPE.airbases) expect(EUROPE.rawHeight(ab.x, ab.z) > 0, `${ab.name} on land`).toBe(true);
    for (const ab of EUROPE.airbases) expect(Math.abs(ab.x) < EUROPE.half && Math.abs(ab.z) < EUROPE.half, `${ab.id} inside`).toBe(true);
  });

  it('switching to Europe uses the DEM through the shared terrain functions', () => {
    loadGrid();
    T.setTheater('europe');
    try {
      expect(T.THEATER_NAME).toBe('Northern Europe');
      const v = T.airbaseById('volkel');
      expect(T.terrainHeight(v.x, v.z)).toBeCloseTo(v.elev, 0);
      expect(T.defaultNation('blue')).toBe('nl');
      expect(T.defaultNation('red')).toBe('ru');
    } finally { T.setTheater('varnia'); }
  });
});
