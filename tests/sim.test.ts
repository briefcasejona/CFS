import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { World } from '../src/sim/world.js';
import { Aircraft } from '../src/sim/entities.js';
import { getAircraft, AIRCRAFT } from '../src/aircraft/defs.js';
import { WEAPONS } from '../src/weapons/stores.js';
import { Missile } from '../src/weapons/missile.js';
import { buildMission, buildScenario, defaultCustom, evaluate, SCENARIOS } from '../src/game/mission.js';
import { newCampaign, missionForFlight, resolveTurn, playerFlights, applyMissionResult, validateState } from '../src/campaign/campaign.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
const DT = 1 / 120;

function airTarget(world: World, id: string, pos: THREE.Vector3, hdgRad: number, side: 'blue' | 'red') {
  const ac = new Aircraft(getAircraft(id), side, 'tgt', []);
  ac.fm.placeInAir(pos, hdgRad, 250);
  ac.ctrl.gearDown = false;
  ac.ctrl.throttle = 0.7;
  world.addAircraft(ac);
  return ac;
}

describe('weapons', () => {
  it('AIM-120 kills a non-maneuvering head-on target at 30 km', () => {
    const w = new World();
    const shooter = airTarget(w, 'f16c', new THREE.Vector3(0, 9000, 0), 0, 'blue');
    const tgt = airTarget(w, 'mig29a', new THREE.Vector3(0, 9000, -30000), Math.PI, 'red');
    expect(shooter.radar.lock(tgt), 'radar lock').toBe(true);
    const m = new Missile(WEAPONS.aim120c, 'blue', shooter, null, tgt, null, shooter.pos.clone().add(new THREE.Vector3(0, -2, 0)), shooter.vel.clone());
    w.missiles.push(m);
    for (let t = 0; t < 90 && tgt.alive; t += DT) w.step(DT);
    expect(tgt.alive, 'target should be destroyed').toBe(false);
  });

  it('AIM-9X kills a target from the rear quarter at 3 km', () => {
    const w = new World();
    const shooter = airTarget(w, 'f16c', new THREE.Vector3(0, 5000, 0), 0, 'blue');
    const tgt = airTarget(w, 'su27', new THREE.Vector3(200, 5000, -3000), 0, 'red');
    shooter.stores = ['aim9x'];
    shooter.selWeapon = 'aim9x';
    shooter.irLock = tgt;
    expect(w.fireSelected(shooter)).toBe('FOX 2');
    for (let t = 0; t < 20 && tgt.alive; t += DT) w.step(DT);
    expect(tgt.alive).toBe(false);
  });

  it('guns hit a target dead ahead', () => {
    const w = new World();
    const shooter = airTarget(w, 'f16c', new THREE.Vector3(0, 5000, 0), 0, 'blue');
    // place the target 300 m down the gun line (nose + 1.5 deg boresight), accounting for trim AoA
    const gunDir = shooter.fm.forward().addScaledVector(shooter.fm.up(), 0.026).normalize();
    const tgt = airTarget(w, 'mig29a', shooter.pos.clone().addScaledVector(gunDir, 300), 0, 'red');
    tgt.fm.vel.copy(shooter.fm.vel);
    shooter.gunFiring = true;
    for (let t = 0; t < 1.5; t += DT) w.step(DT);
    expect(tgt.health).toBeLessThan(100);
  });

  it('CCIP prediction lands near the real Mk-82 impact point', () => {
    const w = new World();
    const ac = airTarget(w, 'f16c', new THREE.Vector3(10000, 3000, 70000), 0, 'blue');
    ac.stores = ['mk82'];
    ac.selWeapon = 'mk82';
    const pred = w.predictImpact(ac, WEAPONS.mk82);
    expect(!!pred).toBe(true);
    w.fireSelected(ac);
    const bomb = w.missiles[0];
    let impact: THREE.Vector3 | null = null;
    for (let t = 0; t < 60 && bomb.alive; t += DT) { const p = bomb.pos.clone(); w.step(DT); if (!bomb.alive) impact = p; }
    expect(!!impact).toBe(true);
    expect(impact!.distanceTo(pred!.point)).toBeLessThan(60);
  });
});

describe('scenarios', () => {
  for (const s of SCENARIOS) {
    it(`${s.id} builds and simulates 60 s`, () => {
      const b = buildMission(buildScenario({ ...defaultCustom(), scenario: s.id }), OPTS);
      for (let t = 0; t < 60; t += DT) b.world.step(DT);
      expect(typeof evaluate(b).status).toBe('string');
      expect(Number.isFinite(b.player.pos.y)).toBe(true);
    });
  }

  it('every aircraft can be the player in a BVR scenario', () => {
    for (const a of AIRCRAFT) {
      const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'bvr', aircraftId: a.id }), OPTS);
      for (let t = 0; t < 5; t += DT) b.world.step(DT);
      expect(b.player.def.id).toBe(a.id);
    }
  });

  it('AI fighters engage and someone dies in a furball', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'furball', aircraftId: 'f15c', enemyId: 'su27', skill: 'veteran' }), OPTS);
    for (let t = 0; t < 240; t += DT) b.world.step(DT);
    expect(b.world.aircraft.filter((a) => !a.alive).length).toBeGreaterThan(0);
  });
});

describe('dynamic campaign', () => {
  it('plans an ATO for both sides', () => {
    const st = newCampaign('test', 'regular', 42);
    expect(st.ato.filter((p) => p.side === 'blue').length).toBeGreaterThan(3);
    expect(st.ato.filter((p) => p.side === 'red').length).toBeGreaterThan(3);
    expect(playerFlights(st).length).toBeGreaterThan(3);
  });

  it('every player flight produces a flyable mission', () => {
    const st = newCampaign('test', 'regular', 7);
    for (const f of playerFlights(st)) {
      for (const start of ['air', 'runway'] as const) {
        const b = buildMission(missionForFlight(st, f, start), OPTS);
        for (let t = 0; t < 3; t += DT) b.world.step(DT);
        expect(b.player.alive, `${f.id} ${start}`).toBe(true);
      }
    }
  });

  it('a runway start does not count as a landing', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'takeoff', aircraftId: 'jas39' }), OPTS);
    for (let t = 0; t < 3; t += DT) b.world.step(DT);
    expect(b.player.fm.wow).toBe(true);
    expect(b.player.landed).toBe(false);
  });

  it('applies mission results and resolves 20 turns', () => {
    const st = newCampaign('test', 'regular', 99);
    const f = playerFlights(st)[0];
    const b = buildMission(missionForFlight(st, f, 'air'), OPTS);
    for (let t = 0; t < 10; t += DT) b.world.step(DT);
    applyMissionResult(st, f, b, evaluate(b));
    expect(f.flown).toBe(true);
    for (let i = 0; i < 20 && !st.outcome; i++) resolveTurn(st);
    expect(st.turn).toBeGreaterThan(5);
    expect(st.front.every((z) => Number.isFinite(z))).toBe(true);
    expect(validateState(JSON.parse(JSON.stringify(st))).turn).toBe(st.turn);
  });
});
