import { describe, expect, it } from './expect.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { GULF, setGulfGrid, gulfLcc } from '../src/world/theaters/gulf.js';
import { Carrier } from '../src/sim/carrier.js';
import * as T from '../src/world/theater.js';
import { buildMission, buildScenario, defaultCustom, SCENARIOS } from '../src/game/mission.js';

const loadGrid = () => {
  const buf = gunzipSync(readFileSync('assets/theaters/gulf/height.bin.gz'));
  setGulfGrid(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
};

describe('Persian Gulf theater', () => {
  it('baked DEM: the Gulf is water, Kuwait and Iraq are low desert, the Zagros are high', () => {
    loadGrid();
    const h = (lat: number, lon: number) => { const p = gulfLcc.forward(lat, lon); return GULF.rawHeight(p.x, p.z); };
    expect(h(27.5, 50.5)).toBeLessThan(0);          // open Gulf
    expect(h(29.3, 47.5)).toBeGreaterThan(50);      // inland Kuwait
    expect(h(29.3, 47.5)).toBeLessThan(400);
    expect(h(32.37, 50.07)).toBeGreaterThan(3000);  // Zard-Kuh, Zagros
    for (const ab of GULF.airbases) expect(GULF.rawHeight(ab.x, ab.z) > 0, `${ab.name} on land`).toBe(true);
    for (const o of GULF.objectives) expect(Math.abs(o.x) < GULF.half && Math.abs(o.z) < GULF.half, `${o.id} inside`).toBe(true);
  });

  it('the carrier has an hour of open water ahead', () => {
    loadGrid();
    const c = new Carrier(GULF.carriers![0]);
    for (let t = 0; t <= 3600; t += 120) {
      c.update(t);
      for (const [u, v] of [[0, 0], [170, 0], [-160, 0], [0, 40], [0, -50]]) {
        const p = c.fromDeck(u, v);
        expect(GULF.rawHeight(p.x, p.z) < -2, `t=${t} ${u},${v}`).toBe(true);
      }
    }
  });

  it('every Instant Action scenario can be flown over the Gulf', () => {
    loadGrid();
    const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
    try {
      for (const s of SCENARIOS) {
        const b = buildMission(buildScenario({ ...defaultCustom(), scenario: s.id, aircraftId: 'fa18c', theaterId: 'gulf' }), OPTS);
        expect(T.currentTheater().id).toBe('gulf');
        for (let t = 0; t < 3; t += 1 / 120) b.world.step(1 / 120);
        expect(b.player.alive && !b.player.fm.crashed, `${s.id}: player alive`).toBe(true);
        for (const a of b.world.aircraft) expect(Math.abs(a.pos.x) < GULF.half && Math.abs(a.pos.z) < GULF.half, `${s.id}: ${a.callsign} inside`).toBe(true);
      }
      expect(T.defaultNation('red')).toBe('iq');
      expect(T.terrainPalette().style).toBe('desert');
    } finally { T.setTheater('varnia'); }
  });
});
