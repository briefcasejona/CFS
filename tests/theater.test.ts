import { describe, expect, it } from './expect.js';
import * as T from '../src/world/theater.js';
import { newCampaign, validateState } from '../src/campaign/campaign.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
const FLAT: T.Theater = {
  id: 'test-flat', name: 'Test Flats', description: 'flat test theater', half: 50000,
  factions: { blue: 'Blue', red: 'Red' },
  rawHeight: (x) => (x < -40000 ? -50 : 100), // sea in the far west
  sectors: 4, initialFront: [0, 0, 0, 0],
  airbases: [{ id: 'tb', name: 'Test Base', side: 'blue', x: 0, z: 20000, hdg: 0, length: 3000, elev: 0 }],
  objectives: [{ id: 'to', name: 'Test Depot', kind: 'depot', side: 'red', x: 0, z: -20000, value: 5 }],
};

describe('theaters', () => {
  it('varnia is registered and active by default', () => {
    expect(T.currentTheater().id).toBe('varnia');
    expect(T.listTheaters().some((t) => t.id === 'varnia')).toBe(true);
    for (const ab of T.AIRBASES) expect(T.terrainHeight(ab.x, ab.z) > 0, `${ab.id} on land`).toBe(true);
  });

  it('switching theaters updates the live exports and terrain', () => {
    T.registerTheater(FLAT);
    const v0 = T.theaterVersion;
    T.setTheater('test-flat');
    try {
      expect(T.THEATER_HALF).toBe(50000);
      expect(T.AIRBASES.length).toBe(1);
      expect(T.airbaseById('tb').name).toBe('Test Base');
      expect(T.SECTORS).toBe(4);
      expect(T.theaterVersion).toBe(v0 + 1);
      expect(T.terrainHeight(1000, 1000)).toBe(100);
      expect(T.isWater(-45000, 0)).toBe(true);
      expect(T.airbaseById('tb').elev).toBe(100);
    } finally {
      T.setTheater('varnia');
    }
    expect(T.currentTheater().id).toBe('varnia');
    expect(T.AIRBASES.length).toBeGreaterThan(4);
  });

  it('unknown theater ids fall back to Varnia', () => {
    expect(T.setTheater('does-not-exist').id).toBe('varnia');
  });

  it('missions activate their theater', () => {
    T.registerTheater(FLAT);
    const spec = buildScenario(defaultCustom());
    const air = { kind: 'air', x: 0, z: 0, alt: 4000, hdg: 0, speed: 200 } as const;
    buildMission({ ...spec, theaterId: 'test-flat', flights: spec.flights.map((f) => ({ ...f, start: air })), groups: [] }, OPTS);
    expect(T.currentTheater().id).toBe('test-flat');
    buildMission(spec, OPTS);
    expect(T.currentTheater().id).toBe('varnia');
  });

  it('campaign saves migrate from version 1 (no theater) to version 2', () => {
    const st = newCampaign('mig', 'regular', 5);
    expect(st.version).toBe(2);
    expect(st.theaterId).toBe('varnia');
    const old = JSON.parse(JSON.stringify(st));
    old.version = 1; delete old.theaterId;
    const m = validateState(old);
    expect(m.version).toBe(2);
    expect(m.theaterId).toBe('varnia');
  });
});
