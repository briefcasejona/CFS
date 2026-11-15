// V2: the F-16 is the only aircraft the player flies; every other type stays in the game as AI.
import { describe, expect, it } from './expect.js';
import { AIRCRAFT, AIRCRAFT_BY_ID, FLYABLE, isFlyable } from '../src/aircraft/defs.js';
import { scenariosFor, withFlyablePlayer, type MissionSpec } from '../src/game/mission.js';
import { COCKPIT_MODELS } from '../src/render/cockpitModels.js';

describe('V2: F-16 only', () => {
  it('only F-16 variants are flyable, and every other aircraft is still there for the AI', () => {
    expect(FLYABLE.length > 0).toBe(true);
    for (const a of FLYABLE) expect(a.family).toBe('F-16');
    expect(isFlyable('f16c')).toBe(true);
    for (const id of ['f15c', 'fa18c', 'f14b', 'mig29a', 'su27', 'kc135']) {
      expect(!!AIRCRAFT_BY_ID[id]).toBe(true);
      expect(isFlyable(id)).toBe(false);
    }
    expect(AIRCRAFT.length > FLYABLE.length + 10).toBe(true);
  });

  it('a mission that seats the player in another type puts the player in an F-16, and leaves the AI alone', () => {
    const spec: MissionSpec = {
      title: 't', briefing: '', weather: { visibilityKm: 80, clouds: 'clear', cloudBase: 3500, timeOfDay: 11 }, groups: [], goals: [{ kind: 'survive' }],
      flights: [
        { id: 'p', callsign: 'Eagle', side: 'blue', aircraftId: 'f15c', stores: [], count: 2, skill: 'veteran', task: 'strike',
          start: { kind: 'air', x: 0, z: 0, alt: 5000, hdg: 0, speed: 220 }, homeBase: 'halvorsen', player: true },
        { id: 'r', callsign: '', side: 'red', aircraftId: 'mig29a', stores: [], count: 2, skill: 'regular', task: 'cap',
          start: { kind: 'air', x: 0, z: -40000, alt: 5000, hdg: 180, speed: 220 }, homeBase: 'volsk' },
      ],
    };
    const out = withFlyablePlayer(spec);
    expect(out.flights[0].aircraftId).toBe('f16c');
    expect(out.flights[0].stores.includes('mk82')).toBe(true);   // strike task: the strike loadout
    expect(out.flights[1]).toBe(spec.flights[1]);
    expect(spec.flights[0].aircraftId).toBe('f15c');              // the original is not changed
    const ok = { ...spec, flights: [{ ...spec.flights[0], aircraftId: 'f16c' }] };
    expect(withFlyablePlayer(ok)).toBe(ok);
  });

  it('the carrier scenarios are not offered to a jet that cannot go to sea', () => {
    expect(scenariosFor('f16c').some((s) => s.carrier)).toBe(false);
    expect(scenariosFor('fa18c').some((s) => s.carrier)).toBe(true);
  });

  it('every flyable family has a cockpit model slot', () => {
    for (const a of FLYABLE) expect(!!COCKPIT_MODELS[a.family!]).toBe(true);
  });
});
