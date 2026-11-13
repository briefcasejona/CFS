import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { Aircraft } from '../src/sim/entities.js';
import { getAircraft, AIRCRAFT } from '../src/aircraft/defs.js';
import type { FlightEnv } from '../src/sim/flightModel.js';
import { F16Systems } from '../src/systems/f16/f16Systems.js';
import { hasSystems } from '../src/systems/registry.js';
import { KT, FT } from '../src/sim/atmosphere.js';

const flat: FlightEnv = { groundHeight: () => 0, isWater: () => false, wind: new THREE.Vector3() };
const DT = 1 / 60;
const LB = 0.45359237;

function jet(id: string, state: 'cold' | 'ground' | 'air', stores: string[] = []) {
  const ac = new Aircraft(getAircraft(id), 'blue', 'Viper 1', stores);
  if (state === 'air') {
    ac.fm.placeInAir(new THREE.Vector3(0, 15000 * FT, 0), 0, 350 * KT);
    ac.ctrl.gearDown = false; ac.ctrl.throttle = 0.6;
  } else {
    ac.fm.placeOnGround(0, 0, 0, 0);
    ac.ctrl.gearDown = true; ac.ctrl.throttle = 0;
  }
  ac.fm.step(DT, ac.ctrl, flat, {});
  ac.attachSystems(state);
  return { ac, sys: ac.systems as F16Systems };
}

function run(ac: Aircraft, seconds: number, each?: (t: number) => void | boolean) {
  for (let t = 0; t < seconds; t += DT) {
    if (each?.(t) === true) return t;
    ac.stepSystems(DT);
    ac.fm.step(DT, ac.ctrl, flat, {});
  }
  return seconds;
}

describe('aircraft systems: architecture', () => {
  it('only the F-16 family has its own systems so far; every other jet still flies on the generic set', () => {
    for (const def of AIRCRAFT) {
      const ac = new Aircraft(def, def.side, 'x', []);
      ac.fm.placeOnGround(0, 0, 0, 0);
      expect(ac.attachSystems('ground'), def.id).toBe(def.family === 'F-16');
      expect(hasSystems(def), def.id).toBe(def.family === 'F-16');
      expect(ac.fm.sys === null, def.id).toBe(def.family !== 'F-16');
    }
  });
  it('every control, light and gauge is declared with a unique id, and every position can be reached', () => {
    const { sys } = jet('f16c', 'ground');
    for (const list of [sys.controls, sys.lights, sys.gauges]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const g of sys.gauges) expect(Number.isFinite(sys.gauge(g.id)), g.id).toBe(true);
    for (const c of sys.controls) expect(c.hot < c.positions.length && c.cold < c.positions.length, c.id).toBe(true);
  });
  it('a running jet starts with everything on line and nothing lit on the caution panel', () => {
    for (const state of ['ground', 'air'] as const) {
      const { ac, sys } = jet('f16c', state);
      run(ac, 5);
      expect(sys.hooks.engineOn).toBe(true);
      expect(sys.hooks.controlPower).toBe(1);
      expect(sys.elec.mainGen).toBe(true);
      for (const l of sys.lights) if (l.kind !== 'indicator') expect(sys.light(l.id), `${state} ${l.id}`).toBe(false);
      expect(sys.powered('hud') && sys.powered('mfd') && sys.powered('radar')).toBe(true);
      expect(sys.checklist().every((s) => s.done)).toBe(true);
    }
  });
});

describe('F-16 start-up (TO 1F-16CM/AM-1 sections 2 and 6)', () => {
  it('cold and dark: no power, no hydraulics, dead flight controls, engine off', () => {
    const { ac, sys } = jet('f16c', 'cold');
    run(ac, 3);
    expect(sys.hooks.engineOn).toBe(false);
    expect(sys.hooks.controlPower).toBe(0);
    expect(ac.fm.thrust).toBe(0);
    expect(sys.gauge('rpm')).toBe(0);
    expect(sys.light('mainGen')).toBe(false);          // no battery power: no lights at all
    expect(sys.powered('hud')).toBe(false);
    expect(sys.hooks.parkingBrake).toBe(false);        // parking brake needs battery bus No. 2
  });
  it('MAIN PWR to BATT lights ELEC SYS, MAIN GEN, STBY GEN and FLCS RLY', () => {
    const { ac, sys } = jet('f16c', 'cold');
    sys.set('mainPwr', 1);
    run(ac, 1);
    for (const id of ['elecSys', 'mainGen', 'stbyGen', 'flcsRly', 'engine', 'hydOil']) expect(sys.light(id), id).toBe(true);
    expect(sys.light('flcsPmg')).toBe(false);
    expect(sys.hooks.parkingBrake).toBe(true);
    // FLCS PWR TEST closes the relays for the test only while on battery
    sys.set('flcsPwrTest', 1); run(ac, 0.5);
    expect(sys.light('flcsRly')).toBe(false);
    expect(sys.light('battToFlcs') && sys.light('flcsPwr')).toBe(true);
    sys.set('flcsPwrTest', 0); run(ac, 0.5);
    expect(sys.light('flcsRly')).toBe(true);
  });
  it('the manual start follows the book: JFS, 20 % rpm, throttle to IDLE, generators on line at idle', () => {
    const { ac, sys } = jet('f16c', 'cold');
    expect(sys.set('jfs', 2)).toContain('battery');     // no battery power yet
    sys.set('mainPwr', 2);
    run(ac, 1);
    expect(sys.set('jfs', 2)).toBe(null);
    run(ac, 0.1);
    expect(sys.light('flcsRly')).toBe(false);           // starting the JFS closes the FLCS relays
    const tRun = run(ac, 40, () => sys.light('jfsRun'));
    expect(tRun).toBeLessThan(30);                      // JFS RUN within 30 s
    run(ac, 40, () => sys.eng.n2 >= 20);
    expect(sys.eng.n2).toBeGreaterThan(19.9);
    expect(sys.eng.lit).toBe(false);
    sys.set('throttleCutoff', 1);
    let stbyAt = -1, mainAt = -1, jfsOffRpm = -1, pmgOffRpm = -1, peak = 0;
    const t = run(ac, 120, (tt) => {
      peak = Math.max(peak, sys.eng.ftit);
      if (jfsOffRpm < 0 && sys.get('jfs') === 0) jfsOffRpm = sys.eng.n2;
      if (pmgOffRpm < 0 && !sys.light('flcsPmg')) pmgOffRpm = sys.eng.n2;
      if (stbyAt < 0 && !sys.light('stbyGen')) stbyAt = tt;
      if (mainAt < 0 && !sys.light('mainGen')) mainAt = tt;
      return mainAt >= 0 && sys.eng.running;
    });
    expect(t).toBeLessThan(90);
    expect(peak).toBeLessThan(sys.p.startLimit);
    expect(Math.abs(jfsOffRpm - 50)).toBeLessThan(1);          // JFS shuts down at 50 %
    expect(Math.abs(pmgOffRpm - sys.p.flcsPmg)).toBeLessThan(1);
    expect(Math.abs(mainAt - stbyAt - 10)).toBeLessThan(0.5);  // main generator 10 s after the standby
    expect(sys.hooks.engineOn).toBe(true);
    run(ac, 3);
    expect(sys.light('hydOil') || sys.light('engine')).toBe(false);
    expect(sys.gauge('hydA')).toBeGreaterThan(2800);
    expect(sys.hooks.controlPower).toBe(1);
    // the brake/JFS accumulators recharge from system B in under a minute
    run(ac, 60);
    expect(sys.jfs.accum[0]).toBeGreaterThan(0.99);
  });
  it('PW and GE engines bring their generators on at the rpm the manual gives', () => {
    expect(jet('f16a', 'cold').sys.p.stbyGen).toBe(55);
    expect(jet('f16a', 'cold').sys.p.flcsPmg).toBe(40);
    expect(jet('f16c', 'cold').sys.p.stbyGen).toBe(60);
    expect(jet('f16c', 'cold').sys.p.flcsPmg).toBe(44);
  });
  it('auto-start works the same checklist to the end and the jet can then taxi', () => {
    const { ac, sys } = jet('f16c', 'cold');
    sys.autoStart = true;
    const t = run(ac, 240, () => !sys.autoStart);
    expect(t).toBeLessThan(150);
    expect(sys.checklist().every((s) => s.done)).toBe(true);
    expect(sys.hooks.engineOn && sys.elec.mainGen && sys.get('epu') === 1).toBe(true);
    expect(sys.light('masterCaution') || sys.light('elecSys') || sys.light('epuRun')).toBe(false);
    expect(sys.powered('hud') && sys.powered('radar') && sys.hooks.weaponsAvail).toBe(true);
    expect(sys.epu.hydrazine).toBe(100);
    ac.ctrl.throttle = 0.5;
    run(ac, 15);
    expect(ac.fm.tas).toBeGreaterThan(5);
  });
  it('throttle to IDLE too early is a hot start that costs the engine', () => {
    const { ac, sys } = jet('f16a', 'cold');
    sys.set('mainPwr', 2); run(ac, 1);
    sys.set('jfs', 2);
    run(ac, 60, () => sys.eng.n2 >= 13);
    sys.set('throttleCutoff', 1);
    run(ac, 40);
    expect(sys.eng.ftit).toBeGreaterThan(680);
    expect(sys.eng.health).toBeLessThan(1);
    sys.set('throttleCutoff', 0);
    run(ac, 5);
    expect(sys.eng.lit).toBe(false);
  });
  it('a second JFS start needs recharged accumulators', () => {
    const { ac, sys } = jet('f16c', 'cold');
    sys.set('mainPwr', 2); run(ac, 1);
    sys.set('jfs', 2); run(ac, 5);
    sys.set('jfs', 0);
    expect(sys.set('jfs', 2)).toContain('spooled down');
    run(ac, 20);
    expect(sys.set('jfs', 2)).toContain('accumulators');
  });
  it('EPU switch in NORM before the engine runs fires the EPU on the ramp', () => {
    const { ac, sys } = jet('f16c', 'cold');
    sys.set('mainPwr', 2); sys.set('epu', 1); run(ac, 1);
    expect(sys.epu.speed).toBe(0);                 // throttle OFF with weight on wheels: inhibited
    sys.set('throttleCutoff', 1);
    run(ac, 5);
    expect(sys.light('epuRun')).toBe(true);
    expect(sys.epu.hydrazine).toBeLessThan(100);
  });
});

describe('F-16 in flight', () => {
  it('fuel master OFF flames the engine out; the EPU starts itself and keeps the controls alive on hydrazine', () => {
    const { ac, sys } = jet('f16c', 'air');
    run(ac, 2);
    sys.set('fuelMaster', 0);
    run(ac, 30);
    expect(sys.hooks.engineOn).toBe(false);
    expect(ac.fm.thrust).toBe(0);
    expect(sys.light('epuRun') && sys.light('hydrazn')).toBe(true);
    expect(sys.gauge('hydA')).toBeGreaterThan(2500);
    expect(sys.gauge('hydB')).toBeLessThan(1000);          // windmilling: system B is gone, and with it the normal gear
    expect(sys.hooks.controlPower).toBe(0.75);
    expect(sys.light('engine') && sys.light('hydOil')).toBe(true);
    expect(sys.powered('hud')).toBe(true);                 // emergency buses
    expect(sys.powered('radar')).toBe(false);
    const before = sys.epu.hydrazine;
    run(ac, 30);
    // about ten minutes of hydrazine
    expect(Math.abs((before - sys.epu.hydrazine) / 30 - 100 / 600)).toBeLessThan(0.12);
    // gear: no system B, so the handle does nothing until the ALT GEAR handle is pulled
    ac.ctrl.throttle = 0;
    sys.set('lgHandle', 1); run(ac, 5);
    expect(ac.fm.gearPos).toBeLessThan(0.05);
    sys.set('altGear', 1); sys.set('altGear', 0); run(ac, 14);
    expect(ac.fm.gearPos).toBeGreaterThan(0.98);
    expect(sys.hooks.nws).toBe(false);
  });
  it('an airstart: fuel back on with the throttle at IDLE relights the windmilling engine', () => {
    const { ac, sys } = jet('f16c', 'air');
    run(ac, 2);
    sys.set('fuelMaster', 0); run(ac, 10);
    expect(sys.eng.lit).toBe(false);
    sys.set('fuelMaster', 1);
    const t = run(ac, 90, () => sys.hooks.engineOn);
    expect(t).toBeLessThan(60);
    run(ac, 15);
    expect(sys.elec.mainGen).toBe(true);
    expect(ac.fm.thrust).toBeGreaterThan(1000);
  });
  it('SEC: no afterburner and less thrust, with the SEC caution and master caution', () => {
    const a = jet('f16c', 'air'), b = jet('f16c', 'air');
    b.sys.set('engCont', 1);
    a.ac.ctrl.throttle = b.ac.ctrl.throttle = 1;
    run(a.ac, 8); run(b.ac, 8);
    expect(a.ac.fm.abFrac).toBeGreaterThan(0.9);
    expect(b.ac.fm.abFrac).toBe(0);
    expect(b.sys.light('sec') && b.sys.light('masterCaution')).toBe(true);
    expect(b.sys.gauge('nozzle')).toBeLessThan(1);
    b.sys.set('masterCaution', 1); b.sys.set('masterCaution', 0); run(b.ac, 0.5);
    expect(b.sys.light('masterCaution')).toBe(false);
    expect(b.sys.light('sec')).toBe(true);
  });
  it('the LG handle is locked down on the ground; flaps follow the handle and ALT FLAPS', () => {
    const g = jet('f16c', 'ground');
    expect(g.sys.set('lgHandle', 0)).toContain('weight on wheels');
    run(g.ac, 6);
    expect(g.ac.fm.flapPos).toBeGreaterThan(0.95);
    const { ac, sys } = jet('f16c', 'air');
    run(ac, 3);
    expect(ac.fm.flapPos).toBeLessThan(0.05);
    expect(sys.light('wheelNose')).toBe(false);
    ac.fm.vel.multiplyScalar(200 / 350);
    sys.set('altFlaps', 1); run(ac, 5);
    expect(ac.fm.flapPos).toBeGreaterThan(0.9);
    sys.set('altFlaps', 0);
    sys.set('lgHandle', 1); run(ac, 8);
    expect(ac.fm.gearPos).toBeGreaterThan(0.98);
    expect(sys.light('wheelNose') && sys.light('wheelLeft') && sys.light('wheelRight')).toBe(true);
    expect(sys.light('lgWarn')).toBe(false);
    expect(sys.hooks.speedbrakeMax).toBeLessThan(0.75);   // 43° of 60° with the gear down
  });
});

describe('F-16 fuel system (section 3)', () => {
  it('seven internal tanks hold the internal fuel, forward heavy by 0–600 lb', () => {
    const { sys } = jet('f16c', 'ground');
    const t = sys.tank;
    expect(Math.abs(t.lw + t.rw + t.f + t.a + t.fr + t.ar - getAircraft('f16c').fuelInternal)).toBeLessThan(0.01);
    const diff = (t.f + t.fr - t.a - t.ar) / LB;
    expect(diff).toBeGreaterThan(0); expect(diff).toBeLessThan(600);
    expect(Math.abs(sys.gauge('fuelTotal') - getAircraft('f16c').fuelInternal / LB)).toBeLessThan(15);
  });
  it('externals empty first (centerline before wings), then the wings, and the reservoirs stay full', () => {
    const { ac, sys } = jet('f16c', 'air', ['tank', 'tank', 'tank']);
    const t = sys.tank;
    expect(t.ec).toBeGreaterThan(1000); expect(t.el).toBeGreaterThan(1000);
    ac.ctrl.throttle = 0.7;
    // burn at a fixed rate without flying the jet for an hour
    const burn = (seconds: number, kgS: number) => { for (let k = 0; k < seconds * 10; k++) { const e = ac.systemsEnv(); e.fuelFlow = kgS; e.fuel = sys.fuelState().internal; e.extFuel = sys.fuelState().external; sys.step(0.1, e); } };
    burn(300, 1.5);
    expect(t.ec).toBeLessThan(getAircraft('f16c').pylonFuel - 400);
    expect(Math.abs(t.el - getAircraft('f16c').pylonFuel)).toBeLessThan(1);      // wing tanks wait for the centerline
    expect(Math.abs(t.lw - sys.cap.lw)).toBeLessThan(1);
    burn(2000, 1.5);
    expect(t.ec + t.el + t.er).toBeLessThan(1);
    expect(Math.abs(t.fr - sys.cap.fr) + Math.abs(t.ar - sys.cap.ar)).toBeLessThan(1);
    burn(400, 1.5);
    expect(t.lw + t.rw).toBeLessThan(1);
    // the fuel flow proportioner keeps the two systems in step
    const diff = (t.f + t.fr - t.a - t.ar) / LB;
    expect(diff).toBeGreaterThan(250); expect(diff).toBeLessThan(500);
    burn(1530, 1.5);
    expect(sys.light('fwdFuelLow') && sys.light('aftFuelLow')).toBe(true);
    burn(200, 1.5);
    expect(sys.eng.starved).toBe(true);
  });
  it('AIR SOURCE OFF traps the external fuel and raises TRP FUEL; ENG FEED AFT pulls the aft system down', () => {
    const { ac, sys } = jet('f16c', 'air', ['tank', 'tank']);
    sys.set('airSource', 0);
    const burn = (seconds: number) => { for (let k = 0; k < seconds * 10; k++) { const e = ac.systemsEnv(); e.fuelFlow = 1.2; e.fuel = sys.fuelState().internal; e.extFuel = sys.fuelState().external; sys.step(0.1, e); } };
    const ext = sys.tank.el + sys.tank.er;
    burn(700);
    expect(Math.abs(sys.tank.el + sys.tank.er - ext)).toBeLessThan(0.01);
    expect(sys.hudWarnings()).toContain('TRP FUEL');
    expect(sys.light('equipHot')).toBe(true);
    expect(sys.powered('radar')).toBe(false);
    sys.set('airSource', 1); burn(120);
    expect(sys.tank.el + sys.tank.er).toBeLessThan(ext - 100);
    // with the wings and externals dry, ENG FEED AFT takes everything from the aft system
    const c = jet('f16c', 'air');
    const burnC = (seconds: number) => { for (let k = 0; k < seconds * 10; k++) { const e = c.ac.systemsEnv(); e.fuelFlow = 1.2; e.fuel = c.sys.fuelState().internal; e.extFuel = 0; c.sys.step(0.1, e); } };
    burnC(500);
    const aft0 = c.sys.tank.a + c.sys.tank.ar, fwd0 = c.sys.tank.f + c.sys.tank.fr;
    c.sys.set('engFeed', 2); burnC(300);
    expect(Math.abs(c.sys.tank.f + c.sys.tank.fr - fwd0)).toBeLessThan(1);
    expect(Math.abs(aft0 - c.sys.tank.a - c.sys.tank.ar - 360)).toBeLessThan(2);
  });
  it('fuel written by the rest of the sim (tanker, jettison) lands in the tanks', () => {
    const { ac, sys } = jet('f16c', 'air', ['tank', 'tank']);
    ac.fm.fuel -= 800; run(ac, 0.1);
    expect(Math.abs(sys.fuelState().internal - (getAircraft('f16c').fuelInternal - 800))).toBeLessThan(2);
    expect(sys.tank.lw).toBeLessThan(sys.cap.lw);        // the wings give it up first
    ac.fm.fuel += 300; run(ac, 0.1);
    expect(Math.abs(ac.fm.fuel - (getAircraft('f16c').fuelInternal - 500))).toBeLessThan(3);
    ac.jettison(); run(ac, 0.1);
    expect(sys.fuelState().external).toBe(0);
    expect(ac.fm.extFuel).toBe(0);
  });
});
