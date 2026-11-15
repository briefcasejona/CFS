import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { Aircraft } from '../src/sim/entities.js';
import { getAircraft } from '../src/aircraft/defs.js';
import type { FlightEnv } from '../src/sim/flightModel.js';
import { F16Systems } from '../src/systems/f16/f16Systems.js';
import type { MissionData } from '../src/systems/types.js';
import { KT, FT, NM } from '../src/sim/atmosphere.js';
import { rampPlan, routeProgress, GENERIC } from '../src/game/ramp.js';
import { AIRBASES, apronSide, setTheater } from '../src/world/theater.js';
import { osbAt, osbPos } from '../src/ui/mfd.js';
import { flowPlate } from '../src/systems/pitLayout.js';
import { F16_PIT } from '../src/systems/f16/pitLayout.js';

const flat: FlightEnv = { groundHeight: () => 0, isWater: () => false, wind: new THREE.Vector3() };
const DT = 1 / 60;

const MISSION: MissionData = {
  steerpoints: [
    { name: 'DEP', x: 0, z: -20000, alt: 3000 }, { name: 'IP', x: 30000, z: -60000, alt: 5000 },
    { name: 'TGT', x: 40000, z: -90000, alt: 5000 }, { name: 'HOME', x: 0, z: 0, alt: 0, kind: 'home' },
  ],
  geo: (x, z) => ({ lat: 42 - z / 111320, lon: 44 + x / 82000 }),
  navaids: [{ id: 'HALV', name: 'Halvorsen', x: 0, z: 0, elev: 0, tacan: 23, band: 'X', ils: 108.3, crs: 90 }],
  bingoKg: 1100, callsign: 'Viper 1', zuluStart: 10 * 3600,
};

function jet(state: 'cold' | 'ground' | 'air') {
  const ac = new Aircraft(getAircraft('f16c'), 'blue', 'Viper 1', []);
  if (state === 'air') { ac.fm.placeInAir(new THREE.Vector3(0, 15000 * FT, 0), 0, 350 * KT); ac.ctrl.gearDown = false; ac.ctrl.throttle = 0.6; }
  else { ac.fm.placeOnGround(0, 0, 0, 0); ac.ctrl.gearDown = true; ac.ctrl.throttle = 0; }
  ac.fm.step(DT, ac.ctrl, flat, {});
  ac.attachSystems(state);
  const sys = ac.systems as F16Systems;
  sys.avionics.loadMission(MISSION);
  return { ac, sys, av: sys.avionics };
}
function run(ac: Aircraft, seconds: number, each?: (t: number) => void | boolean) {
  for (let t = 0; t < seconds; t += DT) {
    if (each?.(t) === true) return t;
    ac.stepSystems(DT);
    ac.fm.step(DT, ac.ctrl, flat, {});
  }
  return seconds;
}
const press = (sys: F16Systems, ...keys: string[]) => { for (const k of keys) { sys.set(`icp${k}`, 1); sys.set(`icp${k}`, 0); } };
const text = (sys: F16Systems, id = 'ded') => sys.avionics.display(id).join('\n').replace(/[\u0001\u0002]/g, '');

describe('F-16 flight control system (TO 1F-16CM/AM-1 sections 16–17)', () => {
  it('gear down gives take-off and landing gains, gear up cruise gains', () => {
    const { ac, sys } = jet('air');
    run(ac, 1);
    expect(sys.flcs.mode).toBe('cruise');
    expect(sys.hooks.flcs?.aoaMax).toBe(null);
    sys.set('lgHandle', 1);
    run(ac, 1);
    expect(sys.flcs.mode).toBe('tol');
    expect(sys.hooks.flcs?.aoaMax).toBe(21);
    expect(sys.hooks.flcs?.rollRate).toBe(180);
  });
  it('CAT III lowers the AoA limit and the roll rate; the flight model flies to the lower limit', () => {
    const peak = (cat3: boolean) => {
      const { ac, sys } = jet('air');
      if (cat3) sys.set('storesConfig', 1);
      let a = 0;
      run(ac, 8, () => { ac.ctrl.pitch = 1; ac.ctrl.throttle = 0.3; a = Math.max(a, ac.fm.alpha * 180 / Math.PI); });
      return a;
    };
    const c1 = peak(false), c3 = peak(true);
    expect(c3).toBeLessThan(c1 - 4);
    expect(c3).toBeLessThan(19);
  });
  it('two air-data failures put the FLCS in standby gains: warning, PFL entry, no autopilot; FLCS RESET clears it when the cause has gone', () => {
    const { ac, sys } = jet('air');
    run(ac, 1);
    sys.flcs.failAirData(1);
    run(ac, 0.5);
    expect(sys.light('flcsFault')).toBe(true);
    expect(sys.light('flcsWarn')).toBe(false);
    sys.flcs.failAirData(2);
    run(ac, 0.5);
    expect(sys.flcs.mode).toBe('standby');
    expect(sys.light('flcsWarn')).toBe(true);
    expect(sys.hudWarnings().includes('FLCS')).toBe(true);
    expect(text(sys, 'pfld').includes('STBY GAIN')).toBe(true);
    expect(sys.hooks.autopilotAvail).toBe(false);
    expect(sys.set('apPitch', 0) !== null).toBe(true);
    expect(sys.hooks.flcs!.liftLoss).toBeGreaterThan(0.1);
    sys.set('flcsReset', 1); run(ac, 0.2); sys.set('flcsReset', 0);
    run(ac, 0.5);
    expect(sys.flcs.mode).toBe('cruise');
    expect(sys.light('flcsWarn')).toBe(false);
  });
  it('digital backup: DBU ON light, fixed roll rate, CAT III-like AoA limit', () => {
    const { ac, sys } = jet('air');
    sys.set('dbu', 1);
    run(ac, 0.5);
    expect(sys.light('dbuOn')).toBe(true);
    expect(sys.hooks.flcs?.rollRate).toBe(167);
    expect(sys.hooks.flcs?.aoaMax).toBe(17);
  });
  it('the BIT runs 45 s on the ground with both hydraulic systems and fails if the jet is not ready', () => {
    const { ac, sys } = jet('ground');
    run(ac, 2);
    expect(sys.set('flcsBit', 1)).toBe(null);
    expect(sys.get('flcsBit')).toBe(1);
    run(ac, 30);
    expect(sys.light('bitRun')).toBe(true);
    run(ac, 17);
    expect(sys.flcs.bit.state).toBe('pass');
    expect(sys.get('flcsBit')).toBe(0);
    const air = jet('air');
    run(air.ac, 1);
    air.sys.set('flcsBit', 1);
    run(air.ac, 1);
    expect(air.sys.flcs.bit.state).toBe('fail');
    expect(air.sys.light('bitFail')).toBe(true);
  });
  it('F-ACK steps through the pilot fault list and the fault stays in the maintenance list', () => {
    const { ac, sys } = jet('air');
    sys.flcs.failAirData(1);
    run(ac, 0.5);
    expect(text(sys, 'pfld').includes('ADC')).toBe(true);
    sys.set('fAck', 1); sys.set('fAck', 0);
    run(ac, 0.2);
    expect(sys.faults.mfl().some((f) => f.mfl === 'FLCS')).toBe(true);
  });
});

describe('F-16 avionics (TO 1F-16CM/AM-34-1-1)', () => {
  it('a cold jet aligns in NORM: degraded after 90 s, full after four minutes, then NAV', () => {
    const { ac, sys, av } = jet('cold');
    sys.autoStart = true;
    let ready = -1, full = -1, t0 = -1;
    run(ac, 600, (t) => {
      if (t0 < 0 && av.egi.state === 'align') t0 = t;
      if (ready < 0 && av.egi.ready) ready = t - t0;
      if (full < 0 && av.egi.cep <= 0.81) full = t - t0;
      return av.egi.state === 'nav';
    });
    expect(ready).toBeGreaterThan(85); expect(ready).toBeLessThan(100);
    expect(full).toBeGreaterThan(230); expect(full).toBeLessThan(250);
    expect(av.egi.state).toBe('nav');
    expect(av.nav().insReady).toBe(true);
    expect(av.dteLoaded).toBe(true);
    expect(av.steerPoint()?.name).toBe('DEP');
  });
  it('taking the INS to NAV before it is aligned leaves no steering', () => {
    const { ac, sys, av } = jet('ground');
    sys.set('egi', 0); run(ac, 0.2);
    sys.set('egi', 2); run(ac, 30);
    sys.set('egi', 3); run(ac, 1);
    expect(av.nav().insReady).toBe(false);
    expect(av.steerPoint()).toBe(null);
  });
  it('the CNI page shows the steerpoint and the ICP increments it; STPT, TIME and BINGO pages open from the keypad', () => {
    const { ac, sys, av } = jet('air');
    run(ac, 0.5);
    expect(sys.avionics.display('ded').length).toBe(5);
    for (const r of sys.avionics.display('ded')) expect(r.replace(/[\u0001\u0002]/g, '').length).toBe(24);
    expect(av.steer).toBe(0);
    press(sys, 'INC'); run(ac, 0.1);
    expect(av.steer).toBe(1);
    press(sys, '4'); run(ac, 0.1);
    expect(text(sys).includes('STPT')).toBe(true);
    expect(text(sys).includes('LAT')).toBe(true);
    press(sys, 'RTN', '6'); run(ac, 0.1);
    expect(text(sys).includes('TIME')).toBe(true);
    press(sys, 'RTN', 'LIST', '2'); run(ac, 0.1);
    expect(text(sys).includes('BINGO')).toBe(true);
    press(sys, '3', '0', '0', '0', 'ENTR'); run(ac, 0.1);
    expect(av.bingo.lb).toBe(3000);
    press(sys, 'RTN'); run(ac, 0.1);
    expect(av.page).toBe('CNI');
  });
  it('steerpoints sequence automatically inside two miles and the bingo call comes at the set fuel', () => {
    const { ac, sys, av } = jet('air');
    ac.fm.pos.set(0, 4000, -20000 + 1 * NM);
    run(ac, 1);
    expect(av.steer).toBe(1);
    av.bingo.lb = 20000;
    run(ac, 1);
    expect(av.nav().bingo).toBe(true);
    expect(sys.drainMessages().some((m) => m.text.includes('BINGO'))).toBe(true);
  });
  it('MFD: OSB 12–14 pick the format, pressing the current one opens the menu, OSB 15 swaps the displays', () => {
    const { ac, av } = jet('air');
    run(ac, 0.2);
    expect(av.mfd(0).format).toBe('FCR');
    expect(av.mfd(1).format).toBe('RWR');
    av.mfdPress(0, 13);
    expect(av.mfd(0).format).toBe('HSD');
    av.mfdPress(0, 13);
    expect(av.mfd(0).format).toBe('MENU');
    const flcs = av.mfd(0).osb.findIndex((o) => o?.text === 'FLCS') + 1;
    av.mfdPress(0, flcs);
    expect(av.mfd(0).format).toBe('FLCS');
    av.mfdPress(0, 15);
    expect(av.mfd(1).format).toBe('FLCS');
    expect(av.mfd(0).format).toBe('RWR');
    av.mfdPress(0, 12);
    expect(av.mfd(0).osb[11]?.on).toBe(true);
  });
  it('MFD button positions round the bezel map back to their numbers', () => {
    for (let n = 1; n <= 20; n++) { const p = osbPos(n); expect(osbAt(p.u, p.v)).toBe(n); }
    expect(osbAt(0.5, 0.5)).toBe(0);
    expect(osbPos(1).edge).toBe('top'); expect(osbPos(6).edge).toBe('right'); expect(osbPos(15).u).toBeLessThan(0.3); expect(osbPos(20).v).toBeLessThan(0.3);
  });
  it('MASTER ARM off holds the weapons; the master-mode keys go through the avionics', () => {
    const { ac, sys, av } = jet('air');
    run(ac, 0.2);
    expect(sys.hooks.weaponsAvail).toBe(true);
    sys.set('masterArm', 1); run(ac, 0.2);
    expect(sys.hooks.weaponsAvail).toBe(false);
    press(sys, 'AA');
    expect(av.masterMode).toBe('AA');
    expect(av.drainActions().some((a) => a.t === 'master' && a.mode === 'AA')).toBe(true);
    press(sys, 'AA');
    expect(av.masterMode).toBe('NAV');
  });
});

describe('ramp parking', () => {
  it('every airbase of every theatre has a stand off the runway and a route that ends lined up on it', () => {
    for (const th of ['varnia', 'europe', 'gulf']) {
      setTheater(th);
      for (const ab of AIRBASES) {
        const r = rampPlan(ab, 0);
        const hr = ab.hdg * Math.PI / 180;
        const across = (p: { x: number; z: number }) => (p.x - ab.x) * Math.cos(hr) + (p.z - ab.z) * Math.sin(hr);
        const along = (p: { x: number; z: number }) => (p.x - ab.x) * Math.sin(hr) - (p.z - ab.z) * Math.cos(hr);
        expect(Math.abs(across(r.spot)), `${ab.id} spot`).toBeGreaterThan(100);
        const end = r.route[r.route.length - 1];
        expect(Math.abs(across(end)), `${ab.id} end`).toBeLessThan(2);
        expect(along(end), `${ab.id} room`).toBeLessThan(ab.length * 0.25);
        expect(r.length, `${ab.id} len`).toBeGreaterThan(300);
        expect(r.length, `${ab.id} len`).toBeLessThan(9000);
        for (let k = 1; k < r.route.length; k++) expect(Math.hypot(r.route[k].x - r.route[k - 1].x, r.route[k].z - r.route[k - 1].z), `${ab.id} leg ${k}`).toBeLessThan(ab.layout ? 700 : ab.length);
        expect(routeProgress(r.route, r.spot).left).toBeGreaterThan(r.length - 1);
        expect(routeProgress(r.route, end).left).toBeLessThan(1);
        if (!ab.layout) expect(Math.sign(across(r.spot))).toBe(apronSide(ab));
      }
    }
    setTheater('varnia');
  });
  it('the generic stands sit on the apron and wingmen get their own', () => {
    setTheater('varnia');
    const ab = AIRBASES[0];
    const a = rampPlan(ab, 0), b = rampPlan(ab, 1);
    expect(Math.hypot(a.spot.x - b.spot.x, a.spot.z - b.spot.z)).toBeGreaterThan(30);
    expect(GENERIC.spotOff).toBeGreaterThan(GENERIC.apronNear);
    expect(GENERIC.spotOff).toBeLessThan(GENERIC.apronFar);
  });
});

describe('clickable cockpit layout', () => {
  it('every control, light, gauge and display of the F-16 has exactly one place in the cockpit, and nothing is squeezed', () => {
    const { sys } = jet('ground');
    const seen = new Map<string, number>();
    for (const p of F16_PIT.plates) {
      const f = flowPlate(p, sys);
      expect(f.missing.join(','), p.id).toBe('');
      expect(f.scale, p.id).toBeGreaterThan(0.8);
      for (const it of f.items) {
        if (it.kind === 'title') continue;
        const k = `${it.kind}:${it.def.id}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
        expect(it.x >= -1e-9 && it.y >= -1e-9 && it.x + it.w <= p.w + 1e-9 && it.y + it.h <= p.h + 1e-9, `${p.id} ${k}`).toBe(true);
        expect(it.w, `${p.id} ${k} width`).toBeGreaterThan(it.kind === 'control' && it.style !== 'key' ? 0.03 : 0.018);
      }
    }
    for (const c of sys.controls) expect(seen.get(`control:${c.id}`), `control ${c.id}`).toBe(1);
    for (const l of sys.lights) expect(seen.get(`light:${l.id}`), `light ${l.id}`).toBe(1);
    for (const g of sys.gauges) expect(seen.get(`gauge:${g.id}`), `gauge ${g.id}`).toBe(1);
    for (const d of sys.avionics.displays) expect(seen.get(`display:${d.id}`), `display ${d.id}`).toBe(1);
    expect(F16_PIT.mfds.length).toBe(sys.avionics.mfdCount);
  });
});
