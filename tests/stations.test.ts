import { describe, expect, it } from './expect.js';
import { stationLayout } from '../src/aircraft/stations.js';
import { AIRCRAFT, getAircraft } from '../src/aircraft/defs.js';

describe('weapon stations', () => {
  it('every loadout of every jet: one store per station, symmetric pairs mirror each other', () => {
    for (const d of AIRCRAFT) for (const l of d.loadouts) {
      const pos = stationLayout(d, l.stores);
      const keys = pos.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
      expect(new Set(keys).size, `${d.id} "${l.name}": two stores on one station`).toBe(keys.length);
      for (let i = 0; i < l.stores.length; i++) {
        // stores with a twin of the same type have a mirrored partner station
        const twins = l.stores.filter((s) => s === l.stores[i]).length;
        if (twins >= 2 && twins % 2 === 0 && Math.abs(pos[i].x) > 0.01) {
          expect(pos.some((q, j) => j !== i && l.stores[j] === l.stores[i] && Math.abs(q.x + pos[i].x) < 0.01 && Math.abs(q.z - pos[i].z) < 0.01),
            `${d.id} "${l.name}" ${l.stores[i]} at x=${pos[i].x.toFixed(2)} has no mirrored twin`).toBe(true);
        }
      }
    }
  });

  it('F-16: heat-seekers on the wingtip rails, tanks inboard of the missiles', () => {
    const d = getAircraft('f16c');
    const l = d.loadouts.find((x) => x.name.startsWith('CAP'))!;
    const pos = stationLayout(d, l.stores);
    const xs = (id: string) => pos.filter((_, i) => l.stores[i] === id).map((p) => Math.abs(p.x));
    for (const x of xs('aim9x')) expect(x).toBeGreaterThan(d.span / 2 - 0.3);
    expect(Math.max(...xs('tank'))).toBeLessThan(Math.min(...xs('aim120c')));
  });

  it('F-14: everything hangs under the fuselage tunnel or the gloves, never on the swinging wing', () => {
    const d = getAircraft('f14b');
    for (const l of d.loadouts) for (const p of stationLayout(d, l.stores)) expect(Math.abs(p.x) < 2.9, `${l.name}: store at x=${p.x.toFixed(2)}`).toBe(true);
  });
});
