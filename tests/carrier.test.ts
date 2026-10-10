import { describe, expect, it } from './expect.js';
import { Carrier, DECK_H, WIRES } from '../src/sim/carrier.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';
import { validateMissionSpec } from '../src/game/missionFile.js';
import { setTheater } from '../src/world/theater.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
const DT = 1 / 120;

describe('carriers', () => {
  it('deck geometry follows the ship as it steams', () => {
    const c = new Carrier({ id: 'cv', name: 'CV', side: 'blue', x: 1000, z: 2000, hdg: 90, speedKt: 20 });
    expect(c.deckHeight(1000, 2000)).toBe(DECK_H);
    expect(c.deckHeight(1000, 2300)).toBe(null);                       // 300 m to starboard (south): sea
    const isl = c.fromDeck(40, 28);
    expect(c.deckHeight(isl.x, isl.z)! > DECK_H + 10).toBe(true);      // the island stands proud of the deck
    const ld = c.fromLanding(WIRES[2], 0);
    expect(c.deckHeight(ld.x, ld.z)).toBe(DECK_H);                     // wires are on the angled deck
    c.update(60);
    expect(c.pos.x).toBeCloseTo(1000 + 20 * 0.514444 * 60, 3);         // east at 20 kt for a minute
    expect(c.deckHeight(1000, 2000)).toBe(null);
  });

  it('a jet parked on the moving deck moves with the ship', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'carrier_ops', aircraftId: 'fa18c' }), OPTS);
    try {
      const w = b.world, cv = w.carriers[0], p = b.player;
      // detach from the catapult: put the jet on the aft deck, brakes on, engine idle
      (w.carrierOps as unknown as { st: Map<number, unknown> }).st.delete(p.id);
      const spot = cv.fromDeck(-100, 5);
      p.fm.placeOnGround(spot.x, spot.z, DECK_H, cv.hdg);
      p.fm.vel.copy(cv.vel);
      p.ctrl.throttle = 0; p.ctrl.brakes = 1;   // idle thrust alone would creep forward, as on a real deck
      for (let t = 0; t < 10; t += DT) w.step(DT);
      const d = cv.toDeck(p.pos.x, p.pos.z);
      expect(p.fm.crashed).toBe(false);
      expect(Math.abs(d.u + 100) < 3 && Math.abs(d.v - 5) < 3, `drifted to ${d.u.toFixed(1)}, ${d.v.toFixed(1)}`).toBe(true);
      expect(p.fm.vel.distanceTo(cv.vel) < 0.5).toBe(true);
    } finally { setTheater('varnia'); }
  });

  it('catapult: held until launched, then flying off the bow above approach speed', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'carrier_ops', aircraftId: 'fa18c' }), OPTS);
    const w = b.world, cv = w.carriers[0], p = b.player;
    expect(w.carrierOps.state(p)).toBe('cat');
    expect(w.carrierOps.launch(p)).toContain('full power');            // not at power yet: shooter refuses
    p.ctrl.throttle = 1;
    for (let t = 0; t < 3; t += DT) w.step(DT);
    const held = cv.toDeck(p.pos.x, p.pos.z);
    expect(Math.abs(held.u - 50) < 1).toBe(true);                      // still in the shuttle at full power
    expect(w.carrierOps.launch(p)).toContain('launch');
    let endSpeed = 0;
    for (let t = 0; t < 4 && w.carrierOps.state(p) === 'cat'; t += DT) { w.step(DT); endSpeed = p.fm.vel.clone().sub(cv.vel).length(); }
    expect(w.carrierOps.state(p)).toBe(null);
    expect(endSpeed > 64).toBe(true);
    p.ctrl.pitch = 0.3;   // rotate
    for (let t = 0; t < 6; t += DT) { w.step(DT); if (p.pos.y > DECK_H + 40) p.ctrl.pitch = 0; }
    expect(p.fm.crashed).toBe(false);
    expect(p.fm.wow).toBe(false);
    expect(p.pos.y > DECK_H + 10).toBe(true);
    expect(b.player.landed).toBe(false);
  });

  const onFinal = (hook: boolean) => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'carrier_trap', aircraftId: 'fa18c' }), OPTS);
    const w = b.world, cv = w.carriers[0], p = b.player;
    expect(p.hook).toBe(true);
    p.hook = hook;
    // 60 m short of the first wire, 1.5 m above the deck, 65 m/s closing, sinking 3.5 m/s
    const L = cv.landingDir();
    const start = cv.fromLanding(WIRES[0] - 60, 0, DECK_H + p.def.gear.height + 1.5);
    const hdg = Math.atan2(L.x, -L.z);
    p.fm.placeInAir(start, hdg, 65);
    p.fm.vel.copy(L).multiplyScalar(65).add(cv.vel).setY(-3.5);
    p.fm.gearPos = 1; p.ctrl.gearDown = true; p.ctrl.flaps = 1; p.fm.flapPos = 1;
    p.ctrl.throttle = 1;                                                // power up on touchdown, like the real thing
    p.ctrl.trimPitch = 0;
    return { b, w, cv, p };
  };

  it('arrested landing: the hook catches a wire and stops the jet on the deck', () => {
    const { b, w, cv, p } = onFinal(true);
    let caught = false;
    for (let t = 0; t < 6; t += DT) { w.step(DT); if (w.carrierOps.state(p) === 'arrest') caught = true; }
    expect(caught).toBe(true);
    expect(p.fm.crashed).toBe(false);
    expect(w.carrierOps.state(p)).toBe('trapped');
    expect(p.fm.vel.distanceTo(cv.vel) < 2).toBe(true);
    expect(w.messages.some((m) => /wire/i.test(m.text))).toBe(true);
    p.ctrl.throttle = 0; p.ctrl.brakes = 1;
    for (let t = 0; t < 4; t += DT) w.step(DT);
    expect(b.player.landed).toBe(true);
  });

  it('hook up: no wire, the jet bolters off the angled deck', () => {
    const { w, p } = onFinal(false);
    let touched = false;
    for (let t = 0; t < 7; t += DT) {
      w.step(DT);
      if (p.fm.wow) touched = true;
      // approach power until the wheels hit, then full power and rotate (a bolter is flown off at full power)
      p.ctrl.throttle = touched ? 1 : 0.4;
      p.ctrl.pitch = !touched ? -0.1 : (!p.fm.wow && p.fm.agl > 5) ? 0 : 0.4;
    }
    expect(touched).toBe(true);
    expect(w.carrierOps.state(p)).toBe(null);
    expect(p.fm.crashed).toBe(false);
    expect(w.messages.some((m) => /bolter/i.test(m.text))).toBe(true);
  });

  it('mission files keep carriers and carrier starts', () => {
    const spec = buildScenario({ ...defaultCustom(), scenario: 'carrier_ops', aircraftId: 'f14b' });
    const back = validateMissionSpec(JSON.parse(JSON.stringify(spec)));
    expect(back.carriers?.length).toBe(1);
    expect(back.flights[0].start.kind).toBe('carrier');
    const bad = JSON.parse(JSON.stringify(spec));
    bad.flights[0].start.carrierId = 'nope';
    let err = '';
    try { validateMissionSpec(bad); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('unknown carrier');
    // Europe has its own carrier in the North Sea
    const eu = buildScenario({ ...defaultCustom(), scenario: 'carrier_trap', theaterId: 'europe' });
    expect(eu.carriers?.[0].id).toBe('cvn75');
  });
});
