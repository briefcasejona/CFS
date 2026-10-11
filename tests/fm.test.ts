import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { FlightModel, defaultControls, type FlightEnv } from '../src/sim/flightModel.js';
import { AIRCRAFT, getAircraft } from '../src/aircraft/defs.js';
import { atmosphere, KT, FT } from '../src/sim/atmosphere.js';
import { Autopilot } from '../src/sim/autopilot.js';

const flat: FlightEnv = { groundHeight: () => 0, isWater: () => false, wind: new THREE.Vector3() };
const DT = 1 / 120;

function airstart(id: string, altFt: number, kts: number) {
  const fm = new FlightModel(getAircraft(id));
  fm.fuel = fm.def.fuelInternal * 0.6;
  fm.updateMass();
  fm.placeInAir(new THREE.Vector3(0, altFt * FT, 0), 0, kts * KT);
  return fm;
}

function run(fm: FlightModel, seconds: number, ctrl = defaultControls(), each?: (fm: FlightModel) => void) {
  for (let t = 0; t < seconds; t += DT) {
    each?.(fm);
    fm.step(DT, ctrl, flat, { unlimitedFuel: true });
    if (fm.crashed) break;
  }
}

describe('atmosphere', () => {
  it('matches ISA at sea level and 11 km', () => {
    expect(atmosphere(0).rho).toBeCloseTo(1.225, 3);
    expect(atmosphere(11000).T).toBeCloseTo(216.65, 1);
    expect(atmosphere(0).a).toBeCloseTo(340.3, 0);
  });
});

describe('flight model', () => {
  it('F-16 holds roughly level flight hands-off at 350 kt', () => {
    const fm = airstart('f16c', 15000, 350);
    const c = defaultControls(); c.gearDown = false; c.throttle = 0.6;
    run(fm, 20, c);
    expect(fm.crashed).toBe(false);
    expect(Math.abs(fm.vel.y)).toBeLessThan(40);
    expect(fm.nz).toBeGreaterThan(0.7);
    expect(fm.nz).toBeLessThan(1.3);
  });

  it('F-16 FBW limits G to ~9 on full aft stick', () => {
    const fm = airstart('f16c', 10000, 450);
    const c = defaultControls(); c.gearDown = false; c.throttle = 1; c.pitch = 1;
    let maxG = 0;
    run(fm, 4, c, (f) => { maxG = Math.max(maxG, f.nz); });
    expect(maxG).toBeGreaterThan(7.5);
    expect(maxG).toBeLessThan(10);
  });

  it('F-14A TF30s stall when abused at high AoA with rudder in afterburner; F110 Tomcats do not', () => {
    const abuse = (id: string) => {
      let stalls = 0, yawKick = 0;
      for (let k = 0; k < 6; k++) {
        const fm = airstart(id, 15000, 300);
        const c = defaultControls(); c.gearDown = false; c.throttle = 1; c.pitch = 1; c.yaw = 0.8;
        run(fm, 15, c, (f) => { if (f.stallTimer > 0) yawKick = Math.max(yawKick, Math.abs(f.r)); });
        stalls += fm.stallCount;
      }
      return { stalls, yawKick };
    };
    const a = abuse('f14a');
    expect(a.stalls, 'TF30 stalls').toBeGreaterThan(0);
    expect(abuse('f14b').stalls, 'F110 never stalls').toBe(0);
    expect(abuse('f14d').stalls).toBe(0);
  });

  it('F-14A has less thrust than F-14B/D; F-15E carries more fuel than F-15C; two-seat F-16D carries less than the C', () => {
    expect(getAircraft('f14a').engine.abThrust).toBeLessThan(getAircraft('f14b').engine.abThrust);
    expect(getAircraft('f15e').fuelInternal).toBeGreaterThan(getAircraft('f15c').fuelInternal);
    expect(getAircraft('f16d').fuelInternal).toBeLessThan(getAircraft('f16c').fuelInternal);
    expect(getAircraft('f16d').seats).toBe(2);
    expect(getAircraft('f16a').capabilities!.includes('bvr')).toBe(false);
    expect(getAircraft('f16c40').capabilities!.includes('sead')).toBe(false);
    expect(getAircraft('f16c70').radar!.range).toBeGreaterThan(getAircraft('f16c').radar!.range);
    expect(getAircraft('f14d').radar!.irst ?? 0).toBeGreaterThan(0);
  });

  it('F-16 AoA limiter holds ~35 deg at low speed', () => {
    const fm = airstart('f16c', 15000, 220);
    const c = defaultControls(); c.gearDown = false; c.throttle = 0.5; c.pitch = 1;
    let maxA = 0;
    run(fm, 8, c, (f) => { maxA = Math.max(maxA, f.alpha); });
    expect(maxA * 57.3).toBeLessThan(37.5);   // a full-stick pull overshoots the 35° limit by ~2° transiently
    expect(maxA * 57.3).toBeGreaterThan(28);
  });

  it('F-16 rolls at > 180 deg/s', () => {
    const fm = airstart('f16c', 15000, 400);
    const c = defaultControls(); c.gearDown = false; c.throttle = 0.7; c.roll = 1;
    let maxP = 0;
    run(fm, 2, c, (f) => { maxP = Math.max(maxP, f.p); });
    expect(maxP * 57.3).toBeGreaterThan(180);
  });

  it('every aircraft can take off from a runway and climb out', () => {
    for (const def of AIRCRAFT) {
      const fm = new FlightModel(def);
      fm.placeOnGround(0, 0, 0, 0);
      const c = defaultControls(); c.throttle = 1;
      if (def.fcs.vtol) c.nozzle = 0.3;
      let rotated = false;
      const ap = new Autopilot();
      run(fm, 70, c, (f) => {
        if (!rotated && f.ias > def.rotateKts * KT) rotated = true;
        if (f.wow) c.pitch = rotated ? (f.attitude().pitch < 0.14 ? 0.5 : 0.05) : 0;
        else { ap.holdAltHdgSpd(f, 600, 0, 170, c, DT); c.throttle = 1; if (f.pos.y > 100) c.nozzle = 0; }
        if (f.pos.y > 30) c.gearDown = false;
      });
      expect(fm.crashed, `${def.id}: ${fm.crashReason}`).toBe(false);
      expect(fm.pos.y, `${def.id} climb`).toBeGreaterThan(150);
    }
  });

  it('every aircraft holds altitude and heading on autopilot', () => {
    for (const def of AIRCRAFT) {
      const fm = airstart(def.id, 20000, 380);
      const c = defaultControls(); c.gearDown = false;
      const ap = new Autopilot();
      const y0 = fm.pos.y;
      run(fm, 40, c, (f) => ap.holdAltHdgSpd(f, y0, Math.PI / 2, 380 * KT * 1.3, c, DT));
      expect(fm.crashed, `${def.id} crashed: ${fm.crashReason}`).toBe(false);
      expect(Math.abs(fm.pos.y - y0), `${def.id} altitude error`).toBeLessThan(300);
      expect(Math.abs(fm.attitude().hdg - Math.PI / 2), `${def.id} heading error`).toBeLessThan(0.15);
    }
  });
});

describe('performance table', () => {
  it('prints envelope', () => {
    const rows: string[] = [];
    for (const def of AIRCRAFT) {
      const fm = airstart(def.id, 36000, 450);
      const c = defaultControls(); c.gearDown = false;
      const ap = new Autopilot();
      const y0 = fm.pos.y;
      run(fm, 300, c, (f) => { ap.holdAltHdgSpd(f, y0, 0, 1000, c, DT); c.throttle = 1; });
      const fl = airstart(def.id, 1000, 450);
      const cl = defaultControls(); cl.gearDown = false;
      const apl = new Autopilot();
      run(fl, 200, cl, (f) => { apl.holdAltHdgSpd(f, 1000 * FT, 0, 1000, cl, DT); cl.throttle = 1; });
      const fs = airstart(def.id, 10000, 250);
      const cs = defaultControls(); cs.gearDown = false;
      const ap2 = new Autopilot();
      let minIas = 999;
      const ty = fs.pos.y;
      run(fs, 90, cs, (f) => {
        ap2.holdAltHdgSpd(f, ty, 0, 0, cs, DT); cs.throttle = 0;
        if (Math.abs(f.vel.y) < 3 && Math.abs(f.pos.y - ty) < 60) minIas = Math.min(minIas, f.ias / KT);
      });
      rows.push([
        def.id.padEnd(8),
        `M@36k=${fm.mach.toFixed(2)} (${(fm.pos.y / FT).toFixed(0)}ft)`,
        `M@1kft=${fl.mach.toFixed(2)}`,
        `minLevelKIAS=${minIas.toFixed(0)}`,
        fm.crashReason + fs.crashReason + fl.crashReason,
      ].join('  '));
    }
    console.log('\n' + rows.join('\n'));
  });
});
