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

  it('analog/CAS jets have a soft G limit: the stick fades near the limit (F-15C stays close to 9 g)', () => {
    const ac = jet('f15c', 3000, 250);
    let m = 0; ac.ctrl.pitch = 1; run(ac, 3, () => { m = Math.max(m, ac.fm.nz); });
    expect(m > 7.5 && m < 10.3, `F-15C max G ${m.toFixed(2)}`).toBe(true);
    expect(ac.fm.crashed).toBe(false);
  });
});
