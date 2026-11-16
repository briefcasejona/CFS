import { describe, expect, it } from './expect.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { USWEST, setUswestGrid, uswestLcc } from '../src/world/theaters/uswest.js';
import { Carrier } from '../src/sim/carrier.js';
import * as T from '../src/world/theater.js';
import { buildMission, buildScenario, defaultCustom, SCENARIOS } from '../src/game/mission.js';

const loadGrid = () => {
  const buf = gunzipSync(readFileSync('assets/theaters/uswest/height.bin.gz'));
  setUswestGrid(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
};

describe('US West Coast theater', () => {
  it('baked DEM: the Pacific is water, the Sierra and Cascades are high, Death Valley stays dry land', () => {
    loadGrid();
    const h = (lat: number, lon: number) => { const p = uswestLcc.forward(lat, lon); return USWEST.rawHeight(p.x, p.z); };
    expect(h(37.0, -125.0)).toBeLessThan(-1000);    // open Pacific
    expect(h(36.58, -118.29)).toBeGreaterThan(3500); // Mount Whitney
    expect(h(46.85, -121.76)).toBeGreaterThan(3200); // Mount Rainier
    expect(h(36.23, -116.82)).toBeGreaterThan(0);    // Badwater Basin (below sea level, but land)
    expect(h(36.23, -116.82)).toBeLessThan(200);
    for (const ab of USWEST.airbases) {
      expect(USWEST.rawHeight(ab.x, ab.z) > 0, `${ab.name} on land`).toBe(true);
      expect(Math.abs(ab.x) < USWEST.half - 20000 && Math.abs(ab.z) < USWEST.half - 20000, `${ab.id} inside`).toBe(true);
    }
    for (const o of USWEST.objectives) expect(Math.abs(o.x) < USWEST.half && Math.abs(o.z) < USWEST.half, `${o.id} inside`).toBe(true);
    // the map reaches from the Mexican to the Canadian border, and east past Nevada
    for (const [lat, lon] of [[32.55, -117.05], [48.99, -122.75], [36.0, -114.05], [42.0, -114.05]]) {
      const p = uswestLcc.forward(lat, lon);
      expect(Math.abs(p.x) < USWEST.half && Math.abs(p.z) < USWEST.half, `${lat}, ${lon} inside`).toBe(true);
    }
  });

  it('the carrier has an hour of open water ahead', () => {
    loadGrid();
    const c = new Carrier(USWEST.carriers![0]);
    for (let t = 0; t <= 3600; t += 120) {
      c.update(t);
      for (const [u, v] of [[0, 0], [170, 0], [-160, 0], [0, 40], [0, -50]]) {
        const p = c.fromDeck(u, v);
        expect(USWEST.rawHeight(p.x, p.z) < -2, `t=${t} ${u},${v}`).toBe(true);
      }
    }
  });

  it('every Instant Action scenario can be flown over the West Coast', () => {
    loadGrid();
    const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
    try {
      for (const s of SCENARIOS) {
        const b = buildMission(buildScenario({ ...defaultCustom(), scenario: s.id, theaterId: 'uswest' }), OPTS);
        expect(T.currentTheater().id).toBe('uswest');
        for (let t = 0; t < 3; t += 1 / 120) b.world.step(1 / 120);
        expect(b.player.alive && !b.player.fm.crashed, `${s.id}: player alive`).toBe(true);
        for (const a of b.world.aircraft) expect(Math.abs(a.pos.x) < USWEST.half && Math.abs(a.pos.z) < USWEST.half, `${s.id}: ${a.callsign} inside`).toBe(true);
      }
      const tk = buildMission(buildScenario({ ...defaultCustom(), scenario: 'takeoff', theaterId: 'uswest' }), OPTS);
      expect(tk.player.fm.wow).toBe(true);
      expect(T.nearestAirbase(tk.player.pos.x, tk.player.pos.z).id).toBe('edwards');
      expect(T.defaultNation('blue')).toBe('us');
      expect(T.defaultNation('red')).toBe('aggressor');
    } finally { T.setTheater('varnia'); }
  });

  it('every civil airport lies in the United States part of the map', () => {
    for (const f of USWEST.fields ?? []) {
      const ll = USWEST.geo!(f.x, f.z);
      expect(ll.lat > 31.3 && ll.lat < 49.1 && ll.lon > -125 && ll.lon < -104, `${f.id} ${ll.lat.toFixed(2)},${ll.lon.toFixed(2)}`).toBe(true);
    }
  });
});
