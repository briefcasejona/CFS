// V2: the F-16 is the only aircraft the player flies; every other type stays in the game as AI.
import { describe, expect, it } from './expect.js';
import { AIRCRAFT, AIRCRAFT_BY_ID, FLYABLE, isFlyable } from '../src/aircraft/defs.js';
import { scenariosFor, withFlyablePlayer, type MissionSpec } from '../src/game/mission.js';
import { COCKPIT_MODELS } from '../src/render/cockpitModels.js';
import * as THREE from 'three';
import { ModelSwitches } from '../src/render/modelSwitches.js';
import { F16_CONTROLS } from '../src/systems/f16/panels.js';
import type { AircraftSystems, ControlDef } from '../src/systems/types.js';

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

describe('V2: the cockpit model\'s own switches', () => {
  const ctl = (id: string, positions: string[], extra: Partial<ControlDef> = {}): ControlDef => ({ id, label: id, panel: 'P', positions, hot: 0, cold: 0, ...extra });
  const controls = [ctl('lever', ['OFF', 'ON']), ctl('btn', ['', 'PRESS'], { momentary: true, rest: 0 }), ctl('knob', ['A', 'B', 'C', 'D']), ctl('three', ['OFF', 'S1', 'S2'])];
  const state: Record<string, number> = { lever: 0, btn: 0, knob: 0, three: 0 };
  const sys = { controls, get: (id: string) => state[id] ?? 0 } as unknown as AircraftSystems;
  const part = (name: string, sx: number, sy: number, sz: number, x: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz));
    m.name = name; m.position.set(x, 2, -4);
    return m;
  };
  const build = () => {
    const root = new THREE.Group();
    // a lever standing up off a console, a flat push-button, a round knob and a three-way lever (with a second piece)
    root.add(part('part_a', 0.008, 0.027, 0.006, 0), part('part_b', 0.01, 0.004, 0.01, 0.1), part('part_c', 0.02, 0.012, 0.02, 0.2),
      part('part_d', 0.008, 0.027, 0.006, 0.3), part('part_e', 0.004, 0.01, 0.004, 0.3));
    const sw = new ModelSwitches(root, {
      part_a: 'lever', part_b: 'btn', part_c: 'knob', part_d: { id: 'three', angles: [0, -25, 25] }, part_e: { id: 'three', follow: 'part_d' },
      part_x: 'lever', part_f: 'nothing',
    }, sys, new THREE.Vector3(0, 2.6, -3.5));
    return { root, sw, get: (n: string) => root.getObjectByName(n)! };
  };

  it('binds the named parts, reports the ones it cannot, and makes the parts clickable', () => {
    const { sw } = build();
    expect([...sw.ids].sort().join()).toBe('btn,knob,lever,three');
    expect(sw.unmatched.sort().join()).toBe('part_f,part_x');
    expect(sw.picks.length).toBe(5);
    expect((sw.picks[0].userData.hit as { kind: string }).kind).toBe('control');
  });

  it('levers swing about their base, buttons press in, knobs turn, followers move with their leader', () => {
    const { sw, get } = build();
    sw.update(sys, 0.016);
    const a0 = get('part_a').position.clone(), q0 = get('part_a').quaternion.clone();
    const b0 = get('part_b').position.clone(), c0 = get('part_c').quaternion.clone();
    // the three-way switch starts in the middle (OFF): no swing
    expect(get('part_d').quaternion.angleTo(new THREE.Quaternion()) < 1e-6).toBe(true);
    Object.assign(state, { lever: 1, btn: 1, knob: 2, three: 2 });
    for (let i = 0; i < 60; i++) sw.update(sys, 0.05);
    const swing = get('part_a').quaternion.angleTo(q0);
    expect(Math.abs(swing - THREE.MathUtils.degToRad(50)) < 0.01).toBe(true);   // OFF −25° to ON +25°
    expect(get('part_a').position.distanceTo(a0) > 0.002).toBe(true);            // about the base, not the centre
    expect(get('part_b').position.distanceTo(b0) > 0.001).toBe(true);
    expect(Math.abs(get('part_c').quaternion.angleTo(c0) - THREE.MathUtils.degToRad(60)) < 0.01).toBe(true);
    expect(Math.abs(get('part_d').quaternion.angleTo(new THREE.Quaternion()) - THREE.MathUtils.degToRad(25)) < 0.01).toBe(true);
    expect(get('part_e').quaternion.angleTo(get('part_d').quaternion) < 1e-6).toBe(true);
    sw.reset();
    expect(get('part_a').position.distanceTo(a0) > 0.002).toBe(true);
    Object.assign(state, { lever: 0, btn: 0, knob: 0, three: 0 });
  });

  it('the F-16 cockpit model binds only controls the F-16 has', () => {
    const ids = new Set(F16_CONTROLS.map((c) => c.id));
    for (const b of Object.values(COCKPIT_MODELS['F-16'].switches ?? {})) expect(ids.has(typeof b === 'string' ? b : b.id)).toBe(true);
  });
});
