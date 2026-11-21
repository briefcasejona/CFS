// The F-16's aircraft systems (src/f16/systems.ts) against the Dash-1: power up, JFS and engine start, generators,
// hydraulics, EPU, fuel feed, parking brake and the lights.
import { describe, expect, it } from './expect.js';
import { CockpitPanel } from '../src/f16/cockpit/controls.js';
import { F16Systems, AIR_SOURCE, ENG_FEED, GEAR, JFS, MAIN_POWER, PBRAKE, IDLE_RPM, type SysInput } from '../src/f16/systems.js';

const DT = 1 / 20;
const KG = 0.45359237;

/** a stand-in for the flight model's engine: idle core, fuel burnt at the given flow */
function rig(engine: 'F100-PW-229' | 'F110-GE-129' = 'F100-PW-229', fuelLb = 7000) {
  const panel = new CockpitPanel();
  const sys = new F16Systems(panel, engine);
  const inp: SysInput = {
    throttle: 0, wow: true, altM: 0, groundSpeed: 0, fuel: fuelLb * KG, extFuel: 0,
    core: 0, abFrac: 0, fuelFlow: 0.3, engineHealth: 1, windmillRpm: 0,
  };
  const run = (s: number, each?: (t: number) => boolean | void) => {
    for (let t = 0; t < s; t += DT) {
      sys.step(DT, inp);
      if (sys.lit) inp.fuel = Math.max(0, inp.fuel - inp.fuelFlow * DT);
      if (each?.(t)) return t;
    }
    return s;
  };
  return { panel, sys, inp, run };
}

describe('F-16 systems: cold start (Dash-1 2.27 – 2.29, 6.9)', () => {
  it('MAIN PWR to BATT: ELEC SYS with MAIN GEN, STBY GEN and FLCS RLY; engine and HYD/OIL warnings', () => {
    const { panel, sys, run } = rig();
    sys.setCold(3000 * KG);
    run(1);
    expect(sys.cautions.size).toBe(0);           // no power, no lights
    expect(sys.warnings.size).toBe(0);
    panel.set('MAIN_POWER', MAIN_POWER.BATT);
    run(1);
    expect(sys.cautions.has('ELEC SYS')).toBe(true);
    expect(sys.mainGenLight && sys.stbyGenLight && sys.flcsRlyLight).toBe(true);
    expect(sys.flcsPmgLight).toBe(false);        // needs the FLCS relays closed
    expect(sys.warnings.has('ENGINE')).toBe(true);
    expect(sys.warnings.has('HYD/OIL PRESS')).toBe(true);
    expect(sys.masterCaution).toBe(true);
  });

  it('the JFS needs battery power and runs within 30 s; START 2 uses both accumulators and closes the FLCS relays', () => {
    const { panel, sys, run } = rig();
    sys.setCold(3000 * KG);
    panel.set('JFS', JFS.START2);
    run(2);
    expect(sys.jfsOn).toBe(false);               // MAIN PWR OFF: no start
    panel.set('JFS', JFS.OFF); run(0.1);
    panel.set('MAIN_POWER', MAIN_POWER.MAIN);
    panel.set('JFS', JFS.START2);
    const t = run(30, () => sys.jfsRun);
    expect(t).toBeLessThan(30);
    expect(sys.accumulators).toBeLessThan(0.01);
    expect(sys.flcsRelays).toBe(true);
    expect(sys.flcsPmgLight && sys.acftBattToFlcsLight).toBe(true);
    // the JFS motors the engine; without the throttle at IDLE there is no light-off
    run(20);
    expect(sys.rpm).toBeGreaterThan(20);
    expect(sys.burning).toBe(false);
  });

  it('full start: light-off at IDLE, JFS off at 50 %, FLCS PMG at 40 %, STBY GEN at 55 %, MAIN GEN 10 s later', () => {
    const { panel, sys, inp, run } = rig();
    sys.setCold(5000 * KG);
    panel.set('MAIN_POWER', MAIN_POWER.MAIN);
    panel.set('JFS', JFS.START2);
    run(30, () => sys.rpm >= 20);
    expect(sys.setThrottleOff(false, 0)).toBe(true);
    let pmgOff = -1, jfsOff = -1, stby = -1, main = -1;
    run(90, (t) => {
      if (pmgOff < 0 && !sys.flcsPmgLight) pmgOff = sys.rpm;
      if (jfsOff < 0 && panel.get('JFS') === JFS.OFF) jfsOff = sys.rpm;
      if (stby < 0 && sys.stbyGen) stby = t;
      if (main < 0 && sys.mainGen) main = t;
      return main > 0 && t > main + 2;
    });
    expect(pmgOff).toBeCloseTo(40, 0);
    expect(jfsOff).toBeCloseTo(50, 0);
    expect(main - stby).toBeCloseTo(10, 0);
    expect(sys.lit).toBe(true);
    expect(sys.rpm).toBe(IDLE_RPM);
    expect(sys.hydA).toBe(3000);
    expect(sys.hydB).toBe(3000);
    expect(sys.cautions.has('ELEC SYS')).toBe(false);
    expect(sys.warnings.size).toBe(0);
    expect(sys.oil).toBeGreaterThan(20);
    expect(sys.ftit).toBeGreaterThan(300);
    // the accumulators recharged from system B within 60 s of passing 12 %
    run(30);
    expect(sys.accumulators).toBe(2);
    void inp;
  });

  it('the GE engine: FLCS PMG off at 44 %, STBY GEN at 60 %', () => {
    const { panel, sys, run } = rig('F110-GE-129');
    sys.setCold(5000 * KG);
    panel.set('MAIN_POWER', MAIN_POWER.MAIN); panel.set('JFS', JFS.START2);
    run(30, () => sys.rpm >= 20);
    sys.setThrottleOff(false, 0);
    let pmgOff = -1, stbyAt = -1;
    run(60, () => { if (pmgOff < 0 && !sys.flcsPmgLight) pmgOff = sys.rpm; if (stbyAt < 0 && sys.stbyGen) stbyAt = sys.rpm; return stbyAt > 0; });
    expect(pmgOff).toBeCloseTo(44, 0);
    expect(stbyAt).toBeCloseTo(60, 0);
  });

  it('throttle to OFF shuts the engine down; it moves in and out of OFF only from IDLE', () => {
    const { sys, inp, run } = rig();
    sys.setRunning(5000 * KG);
    run(1);
    expect(sys.setThrottleOff(true, 0.5)).toBe(false);
    expect(sys.setThrottleOff(true, 0)).toBe(true);
    run(60);
    expect(sys.lit).toBe(false);
    expect(sys.rpm).toBeLessThan(20);
    expect(sys.warnings.has('ENGINE')).toBe(true);
    expect(sys.cautions.has('ELEC SYS')).toBe(true);
    // on the ground the EPU does not run (safety pin)
    expect(sys.epuRun).toBe(false);
    void inp;
  });

  it('a JFS cannot restart until it has spooled down (about 17 s)', () => {
    const { panel, sys, run } = rig();
    sys.setCold(3000 * KG);
    panel.set('MAIN_POWER', MAIN_POWER.MAIN); panel.set('JFS', JFS.START1);
    run(20, () => sys.jfsRun);
    expect(sys.accumulators).toBeCloseTo(1, 3);   // START 1: one accumulator
    panel.set('JFS', JFS.OFF); run(3);
    panel.set('JFS', JFS.START1); run(1);
    expect(sys.jfsOn).toBe(false);
    panel.set('JFS', JFS.OFF); run(16);
    panel.set('JFS', JFS.START1); run(1);
    expect(sys.jfsOn).toBe(true);
  });
});

describe('F-16 systems: in flight', () => {
  it('main and standby generator failure in flight starts the EPU in about 2 s; it powers the emergency buses and system A', () => {
    const { sys, inp, run } = rig();
    sys.setRunning(5000 * KG);
    inp.wow = false; inp.core = 0.6; inp.altM = 6000;
    run(1);
    expect(sys.epuRun).toBe(false);
    sys.failures.add('mainGen'); sys.failures.add('stbyGen');
    const t = run(5, () => sys.epuRun);
    expect(t).toBeLessThan(2.5);
    expect(sys.emergencyBus).toBe(true);
    expect(sys.essentialBus).toBe(false);
    expect(sys.cautions.has('ELEC SYS')).toBe(true);
    // above the bleed rpm (75-85 %) the EPU runs on bleed air
    expect(sys.rpm).toBeGreaterThan(80);
    const h = sys.hydrazine; run(10);
    expect(sys.hydrazine).toBeCloseTo(h, 3);
  });

  it('a flameout in flight: the EPU runs on hydrazine for about 10 minutes', () => {
    const { sys, inp, run } = rig();
    sys.setRunning(5000 * KG);
    inp.wow = false; inp.altM = 6000;
    inp.engineHealth = 0;
    run(60);
    expect(sys.lit).toBe(false);
    expect(sys.epuRun).toBe(true);
    expect(sys.epuHydrazine).toBe(true);
    expect(sys.hydA).toBe(3000);
    expect(sys.hydrazine).toBeCloseTo(90, 0);
    run(560);
    expect(sys.epuRun).toBe(false);
  });

  it('the voice message system: WARNING 1.5 s after a warning light, CAUTION 7 s after a caution light, nothing on the ground', () => {
    const { panel, sys, inp, run } = rig();
    sys.setRunning(5000 * KG);
    panel.set('AIR_SOURCE', AIR_SOURCE.OFF);
    run(20);
    expect(sys.cautions.has('EQUIP HOT')).toBe(true);
    expect(sys.drainMessages().length).toBe(0);   // WOW
    inp.wow = false;
    panel.set('AIR_SOURCE', AIR_SOURCE.NORM); run(1);
    panel.set('AIR_SOURCE', AIR_SOURCE.OFF);
    run(5 + 6.5);
    expect(sys.drainMessages().length).toBe(0);
    run(1);
    expect(sys.drainMessages()).toContain('CAUTION, CAUTION');
  });
});

describe('F-16 systems: fuel, brakes, lights', () => {
  it('fuel feeds equally from forward and aft; ENG FEED FWD feeds from the forward system; low-fuel lights at 400 / 250 lb', () => {
    const { panel, sys, inp, run } = rig('F100-PW-229', 2000);
    sys.setRunning(2000 * KG);
    const d0 = sys.fuelFwd - sys.fuelAft;
    expect(d0).toBeCloseTo(300, 3);
    run(30);
    expect(sys.fuelFwd - sys.fuelAft).toBeCloseTo(300, 1);
    panel.set('ENG_FEED', ENG_FEED.FWD);
    run(30);
    expect(sys.fuelFwd - sys.fuelAft).toBeLessThan(300 - 30 * 0.3 / KG * 0.9);
    panel.set('ENG_FEED', ENG_FEED.NORM);
    inp.fuelFlow = 2;
    run(400, () => sys.cautions.has('FWD FUEL LOW'));
    expect(sys.fuelFwd).toBeLessThan(400);
    expect(sys.fuelFwd).toBeGreaterThan(380);
  });

  it('the parking brake holds on the accumulators and lets go when the throttle is advanced', () => {
    const { panel, sys, inp, run } = rig();
    sys.setCold(3000 * KG);
    run(1);
    expect(sys.parkingBrake).toBe(true);
    sys.setRunning(3000 * KG);
    panel.set('PBRAKE', PBRAKE.PARK);
    inp.throttle = 0.05; run(1);
    expect(panel.get('PBRAKE')).toBe(PBRAKE.PARK);
    inp.throttle = 0.2; run(1);
    expect(panel.get('PBRAKE')).toBe(PBRAKE.ANTI_SKID);
    // ANTI SKID caution: gear handle down, switch OFF
    panel.set('PBRAKE', PBRAKE.OFF); panel.set('GEAR_LEVER', GEAR.DN); run(1);
    expect(sys.cautions.has('ANTI SKID')).toBe(true);
  });

  it('MASTER CAUTION resets with its button, but not while ELEC SYS is on', () => {
    const { panel, sys, run } = rig();
    sys.setRunning(3000 * KG);
    panel.set('AIR_SOURCE', AIR_SOURCE.OFF);
    run(8);
    expect(sys.masterCaution).toBe(true);
    panel.set('MASTER_CAUTION', 1); run(0.1); panel.set('MASTER_CAUTION', 0); run(0.1);
    expect(sys.masterCaution).toBe(false);
    expect(sys.cautions.has('EQUIP HOT')).toBe(true);
    // ELEC SYS: battery only
    sys.setCold(3000 * KG); panel.set('MAIN_POWER', MAIN_POWER.BATT); run(1);
    expect(sys.masterCaution).toBe(true);
    panel.set('MASTER_CAUTION', 1); run(0.1); panel.set('MASTER_CAUTION', 0); run(0.1);
    expect(sys.masterCaution).toBe(true);
  });

  it('the gauges drop without power on their buses', () => {
    const { panel, sys, run } = rig();
    sys.setRunning(3000 * KG);
    run(1);
    expect(sys.gauges().rpm).toBeGreaterThan(50);
    panel.set('MAIN_POWER', MAIN_POWER.OFF); run(0.1);
    expect(sys.gauges().rpm).toBe(0);
    expect(sys.gauges().hydA).toBe(0);
  });
});
