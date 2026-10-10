import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { World } from '../src/sim/world.js';
import { Aircraft } from '../src/sim/entities.js';
import { getAircraft } from '../src/aircraft/defs.js';
import { Refueling, receiverPoint, tankerPoints } from '../src/sim/refuel.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';

const DT = 1 / 120;
const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };

function place(world: World, id: string, side: 'blue' | 'red', pos: THREE.Vector3, hdg: number, speed = 220) {
  const ac = new Aircraft(getAircraft(id), side, `${id}-${side}`, []);
  ac.fm.placeInAir(pos, hdg, speed);
  ac.ctrl.gearDown = false; ac.ctrl.throttle = 0.7;
  world.addAircraft(ac);
  return ac;
}

describe('datalink', () => {
  it('shares a radar contact with friendlies and ages it out', () => {
    const w = new World();
    const f16 = place(w, 'f16c', 'blue', new THREE.Vector3(0, 7000, 0), 0);
    const buddy = place(w, 'f16c', 'blue', new THREE.Vector3(5000, 7000, 20000), 0);
    buddy.radar!.setMode('OFF');
    const red = place(w, 'mig29a', 'red', new THREE.Vector3(0, 7000, -40000), Math.PI);
    for (let t = 0; t < 4; t += DT) w.step(DT);
    expect(f16.radar!.contacts.has(red.id), 'own radar sees it').toBe(true);
    expect(w.datalink.has('blue', red)).toBe(true);
    expect(w.datalink.picture('blue', buddy).some((t) => t.target === red), 'buddy gets it off-board').toBe(true);
    expect(w.datalink.has('red', red)).toBe(false);
    red.removed = true; red.alive = false;
    for (let t = 0; t < 10; t += DT) w.step(DT);
    expect(w.datalink.has('blue', red)).toBe(false);
  });
});

describe('aerial refuelling', () => {
  it('boom receivers take fuel while held in the envelope, then disconnect when they drop out', () => {
    const w = new World();
    const tk = place(w, 'kc135', 'blue', new THREE.Vector3(0, 7600, 0), Math.PI / 2, 195);
    const rx = place(w, 'f16c', 'blue', new THREE.Vector3(0, 7600, 0), Math.PI / 2, 195);
    rx.fm.fuel = rx.def.fuelInternal * 0.3;
    const ref = receiverPoint(rx)!;
    expect(ref.kind).toBe('boom');
    const rf = new Refueling();
    const hold = () => {
      // put the receptacle exactly on the boom tip, flying in formation
      const tip = tankerPoints(tk, 'boom')[0].clone().applyQuaternion(tk.quat).add(tk.pos);
      rx.fm.pos.copy(tip.sub(ref.offset.clone().applyQuaternion(rx.quat)));
    };
    const f0 = rx.fm.fuel;
    let contacts = 0;
    for (let t = 0; t < 10; t += DT) { hold(); if (rf.step(DT, rx, w.aircraft) === 'Contact.') contacts++; }
    expect(contacts).toBe(1);
    expect(rf.status.contact).toBe(true);
    expect(rx.fm.fuel - f0).toBeGreaterThan(100);
    // drop 10 m below the boom → disconnect
    rx.fm.pos.y -= 10;
    expect(rf.step(DT, rx, w.aircraft)).toBe('Disconnect.');
  });

  it('probe jets use the drogues; the refuel scenario starts low on fuel behind a tanker', () => {
    expect(receiverPoint(new Aircraft(getAircraft('fa18c'), 'blue', 'x', []))!.kind).toBe('drogue');
    expect(receiverPoint(new Aircraft(getAircraft('su27'), 'red', 'x', []))).toBe(null);
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'refuel', aircraftId: 'f16c' }), OPTS);
    expect(b.player.fm.fuel).toBeLessThan(b.player.def.fuelInternal * 0.4);
    const tanker = b.world.aircraft.find((a) => a.def.tanker)!;
    expect(tanker.pos.distanceTo(b.player.pos)).toBeLessThan(2000);
    for (let t = 0; t < 30; t += DT) b.world.step(DT);
    expect(tanker.alive && Math.abs(tanker.fm.pos.y - 7600) < 300, 'tanker holds its altitude').toBe(true);
  });
});
