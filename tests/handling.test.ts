import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { Aircraft } from '../src/sim/entities.js';
import { AIRCRAFT } from '../src/aircraft/defs.js';

const env = { groundHeight: () => -5000, isWater: () => false, wind: new THREE.Vector3() };
const R = 180 / Math.PI, DT = 1 / 120;

function jet(id: string, alt = 4500, speed = 180) {
  const ac = new Aircraft(AIRCRAFT.find((d) => d.id === id)!, 'blue', 't', []);
  ac.fm.placeInAir(new THREE.Vector3(0, alt, 0), 0, speed);
  Object.assign(ac.ctrl, { gearDown: false, throttle: 0.9 });
  ac.fm.gearPos = 0;
  for (let k = 0; k < 120; k++) ac.fm.step(DT, ac.ctrl, env, {});
  return ac;
}
const run = (ac: Aircraft, s: number, f?: () => void) => { for (let k = 0; k < s / DT; k++) { ac.fm.step(DT, ac.ctrl, env, {}); f?.(); } };

describe('handling: limiters and lateral-directional stability', () => {
  it('aft stick + full roll, then let go: no swaying yaw on FBW and CAS jets', () => {
    for (const d of AIRCRAFT.filter((x) => x.playable !== false && x.fcs.type !== 'manual')) {
      const ac = jet(d.id);
      let peak = 0;
      ac.ctrl.pitch = 0.7; ac.ctrl.roll = 1;
      run(ac, 3, () => { peak = Math.max(peak, Math.abs(ac.fm.beta * R)); });
      ac.ctrl.pitch = 0; ac.ctrl.roll = 0;
      run(ac, 2);
      let late = 0, crossings = 0, prev = ac.fm.beta;
      run(ac, 4, () => {
        late = Math.max(late, Math.abs(ac.fm.beta * R));
        if (Math.sign(ac.fm.beta) !== Math.sign(prev) && Math.abs(ac.fm.beta * R) > 0.5) crossings++;
        prev = ac.fm.beta;
      });
      expect(peak < 25, `${d.id}: peak sideslip ${peak.toFixed(1)}°`).toBe(true);
      expect(late < 5, `${d.id}: sideslip still ${late.toFixed(1)}° 2–6 s after letting go`).toBe(true);
      expect(crossings <= 1, `${d.id}: yaw oscillation (${crossings} swings)`).toBe(true);
    }
  });

  it('FBW jets hold their AoA limit (Hornet ~50°, F-16 ~35°) and their G limit', () => {
    const maxAoa = (id: string) => { const ac = jet(id, 4500, 110); let m = 0; ac.ctrl.pitch = 1; run(ac, 6, () => { m = Math.max(m, ac.fm.alpha * R); }); return m; };
    const hornet = maxAoa('fa18c');
    expect(hornet > 38 && hornet < 53, `F/A-18C max AoA ${hornet.toFixed(1)}°`).toBe(true);
    const viper = maxAoa('f16c');
    expect(viper < 37.5, `F-16 max AoA ${viper.toFixed(1)}°`).toBe(true);
    const maxG = (id: string) => { const ac = jet(id, 3000, 250); let m = 0; ac.ctrl.pitch = 1; run(ac, 3, () => { m = Math.max(m, ac.fm.nz); }); return m; };
    const h = maxG('fa18c'), t = maxG('ef2000');
    // hard limit with at most ~8 % transient overshoot on a full-stick yank
    expect(h > 6 && h < 7 * 1.08, `F/A-18C max G ${h.toFixed(2)}`).toBe(true);
    expect(t > 8 && t < 9 * 1.08, `Typhoon max G ${t.toFixed(2)}`).toBe(true);
    // negative side
    const ac = jet('f16c', 3000, 250); let mn = 0; ac.ctrl.pitch = -1; run(ac, 2, () => { mn = Math.min(mn, ac.fm.nz); });
    expect(mn > -3.4, `F-16 min G ${mn.toFixed(2)}`).toBe(true);
  });

  it('FBW pitch: a pull and a let-go settle without bobbing (F-16 family and the other FBW jets)', () => {
    for (const d of AIRCRAFT.filter((x) => x.playable !== false && x.fcs.type === 'fbw')) {
      for (const [alt, spd, stick] of [[3000, 250, 0.5], [9000, 300, 1], [6000, 180, 0.5], [1000, 320, 1]]) {
        const ac = jet(d.id, alt, spd);
        const nz: number[] = [];
        ac.ctrl.pitch = stick; run(ac, 2.5, () => nz.push(ac.fm.nz));
        const aEnd = ac.fm.alpha * R;
        ac.ctrl.pitch = 0;
        const a: number[] = []; run(ac, 3.5, () => a.push(ac.fm.alpha * R));
        const settled = a[a.length - 1], dip = settled - Math.min(...a);
        // let go from a hard pull: AoA comes straight back down to its 1 g value, no undershoot and rebound
        expect(dip < 4, `${d.id} ${alt} m ${spd} m/s: AoA dips ${dip.toFixed(1)}° below its 1 g value after letting go of a ${aEnd.toFixed(0)}° pull`).toBe(true);
        expect(Math.max(...nz) < d.limits.gMax * 1.05, `${d.id}: ${Math.max(...nz).toFixed(2)} g over the ${d.limits.gMax} g limit`).toBe(true);
      }
    }
  });

  it('analog/CAS jets have a soft G limit: the stick fades near the limit (F-15C stays close to 9 g)', () => {
    const ac = jet('f15c', 3000, 250);
    let m = 0; ac.ctrl.pitch = 1; run(ac, 3, () => { m = Math.max(m, ac.fm.nz); });
    expect(m > 7.5 && m < 10.3, `F-15C max G ${m.toFixed(2)}`).toBe(true);
    expect(ac.fm.crashed).toBe(false);
  });
});

describe('handling: F-16 FLCS', () => {
  const f16s = AIRCRAFT.filter((d) => d.fcs.law === 'f16').map((d) => d.id);

  it('rolls under G stay coordinated: no yaw swing while rolling and pulling, none after letting go', () => {
    for (const id of f16s) for (const spd of [140, 180, 250]) {
      const ac = jet(id, 3000, spd);
      let peak = 0;
      ac.ctrl.pitch = 0.5; ac.ctrl.roll = 1;
      run(ac, 1, () => { peak = Math.max(peak, Math.abs(ac.fm.beta * R)); });
      ac.ctrl.roll = 0;
      let swings = 0, prev = ac.fm.r;
      run(ac, 3, () => {
        peak = Math.max(peak, Math.abs(ac.fm.beta * R));
        if (Math.sign(ac.fm.r) !== Math.sign(prev) && Math.abs(ac.fm.r * R) > 2) swings++;
        prev = ac.fm.r;
      });
      expect(peak < 6, `${id} ${spd} m/s: sideslip ${peak.toFixed(1)}° in a rolling pull`).toBe(true);
      expect(swings <= 1, `${id} ${spd} m/s: yaw rate swings ${swings} times after the roll`).toBe(true);
    }
  });

  it('the stick commands G: the same deflection gives the same load at every speed', () => {
    for (const id of f16s) {
      const g = [200, 260, 330].map((spd) => { const ac = jet(id, 3000, spd); ac.ctrl.pitch = 0.6; run(ac, 3); return ac.fm.nz; });
      expect(Math.max(...g) - Math.min(...g) < 0.4, `${id}: 0.6 stick gives ${g.map((x) => x.toFixed(2)).join(' / ')} g`).toBe(true);
    }
  });

  it('abusive stick and rudder at 740 kt stay inside the G limits (no over-G break-up)', () => {
    for (const id of f16s) {
      const ac = jet(id, 1000, 380);
      let mx = 0, mn = 9;
      for (const [pitch, roll, yaw, s] of [[1, 1, 0, 3], [1, -1, 0, 2], [1, 0, 1, 2], [-1, 0, 0, 1.5], [0.4, 1, -1, 2], [0, 0, 0, 2]]) {
        Object.assign(ac.ctrl, { pitch, roll, yaw });
        run(ac, s, () => { mx = Math.max(mx, ac.fm.nz); mn = Math.min(mn, ac.fm.nz); });
      }
      expect(ac.fm.crashed, `${id}: ${ac.fm.crashReason}`).toBe(false);
      expect(mx < 9.5 && mn > -3.3, `${id}: ${mn.toFixed(2)} … ${mx.toFixed(2)} g`).toBe(true);
    }
  });
});
