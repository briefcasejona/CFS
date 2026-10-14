import { describe, expect, it } from './expect.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Lcc } from '../src/world/lcc.js';
import { EUROPE, setEuropeGrid, europeLcc } from '../src/world/theaters/europe.js';
import * as T from '../src/world/theater.js';
import { buildMission, buildScenario, defaultCustom, SCENARIOS } from '../src/game/mission.js';

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

  it('polders below sea level stay dry land after the sub-kilometre detail is added', () => {
    loadGrid();
    // Flevoland, Haarlemmermeer, Noordoostpolder: sampled every 250 m over 4×4 km
    for (const [lat, lon] of [[52.45, 5.55], [52.31, 4.70], [52.71, 5.78]]) {
      const c = europeLcc.forward(lat, lon);
      for (let dz = -2000; dz <= 2000; dz += 250) for (let dx = -2000; dx <= 2000; dx += 250) {
        expect(EUROPE.rawHeight(c.x + dx, c.z + dz) > 0, `${lat},${lon} +${dx},${dz}`).toBe(true);
      }
    }
  });

  it('every Instant Action scenario can be flown over Europe', () => {
    loadGrid();
    const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
    try {
      for (const s of SCENARIOS) {
        const spec = buildScenario({ ...defaultCustom(), scenario: s.id, theaterId: 'europe' });
        expect(spec.theaterId).toBe('europe');
        const b = buildMission(spec, OPTS);
        expect(T.currentTheater().id).toBe('europe');
        for (let t = 0; t < 3; t += 1 / 120) b.world.step(1 / 120);
        expect(b.player.alive, `${s.id}: player alive`).toBe(true);
        for (const a of b.world.aircraft) expect(Math.abs(a.pos.x) < EUROPE.half && Math.abs(a.pos.z) < EUROPE.half, `${s.id}: ${a.callsign} inside`).toBe(true);
      }
      // the takeoff scenario starts on a real NATO runway
      const tk = buildMission(buildScenario({ ...defaultCustom(), scenario: 'takeoff', theaterId: 'europe' }), OPTS);
      expect(tk.player.fm.wow).toBe(true);
      expect(T.nearestAirbase(tk.player.pos.x, tk.player.pos.z).id).toBe('malbork');
    } finally { T.setTheater('varnia'); }
  });

  it('switching to Europe uses the DEM through the shared terrain functions', () => {
    loadGrid();
    T.setTheater('europe');
    try {
      expect(T.THEATER_NAME).toBe('Northern Europe');
      const v = T.requireAirbase('volkel');
      expect(T.terrainHeight(v.x, v.z)).toBeCloseTo(v.elev, 0);
      expect(T.defaultNation('blue')).toBe('nl');
      expect(T.defaultNation('red')).toBe('ru');
    } finally { T.setTheater('varnia'); }
  });
});

describe('satellite imagery georeferencing', () => {
  it('maps Leeuwarden AB to its Web-Mercator tile and back through the theater projection', async () => {
    const { mercator } = await import('../src/render/imagery.js');
    const { EUROPE, europeLcc } = await import('../src/world/theaters/europe.js');
    const p = europeLcc.forward(53.228, 5.76);
    const ll = EUROPE.geo!(p.x, p.z);
    expect(Math.abs(ll.lat - 53.228) < 1e-6 && Math.abs(ll.lon - 5.76) < 1e-6, `round trip ${ll.lat}, ${ll.lon}`).toBe(true);
    const m = mercator(ll.lat, ll.lon, { x: 0, y: 0 });
    // slippy-map tile z11 of the base (x 1056, y 664)
    expect([Math.floor(m.x * 2048), Math.floor(m.y * 2048)].join('/')).toBe('1056/664');
  });
});

describe('Leeuwarden layout', () => {
  it('ties the aerial image to the runway thresholds within a few tens of metres, shelters clear of the runways', () => {
    const lw = EUROPE.airbases.find((a) => a.id === 'leeuwarden')!;
    const L = lw.layout!;
    expect(L.fitRms < 60, `image fit RMS ${L.fitRms.toFixed(1)} m`).toBe(true);
    expect(L.shelters.length > 30 && L.taxiways.length > 5).toBe(true);
    for (const rw of [lw, ...(lw.extra ?? [])]) {
      const r = rw.hdg * Math.PI / 180;
      for (const s of L.shelters) {
        const dx = s.x - rw.x, dz = s.z - rw.z;
        const along = Math.abs(dx * Math.sin(r) - dz * Math.cos(r)), off = Math.abs(dx * Math.cos(r) + dz * Math.sin(r));
        expect(along > rw.length / 2 + 50 || off > 80, `shelter ${s.x.toFixed(0)},${s.z.toFixed(0)} ${off.toFixed(0)} m off a runway`).toBe(true);
      }
    }
  });
});
