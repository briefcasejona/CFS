// The F-16 rebuilt from Jonathan's five documents: the HFFM flight model, the Dash-1 FLCS behaviour, and the cockpit
// model's controls.
import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Aircraft } from '../src/sim/entities.js';
import { AIRCRAFT, FLYABLE } from '../src/aircraft/defs.js';
import { Autopilot } from '../src/sim/autopilot.js';
import { F16FlightModel, cat1G, f16CL, f16Thrust, F16_S } from '../src/f16/flightModel.js';
import { BLOCKS, BLOCK_OF } from '../src/f16/blocks.js';
import { CONTROLS, COCKPIT_NODES, INDICATOR_NODES, CockpitPanel, parseControl, sanitize } from '../src/f16/cockpit/controls.js';
import { F16CockpitView } from '../src/f16/cockpit/view.js';
import { loadGlbScene } from './glbScene.js';

const env = { groundHeight: () => -5000, isWater: () => false, wind: new THREE.Vector3() };
const R = 180 / Math.PI, DT = 1 / 120, FT = 0.3048;

function jet(id: string, alt = 3000, speed = 200) {
  const ac = new Aircraft(AIRCRAFT.find((d) => d.id === id)!, 'blue', 't', []);
  ac.fm.placeInAir(new THREE.Vector3(0, alt, 0), 0, speed);
  Object.assign(ac.ctrl, { gearDown: false, throttle: 0.75 });
  ac.fm.gearPos = 0;
  return ac;
}
const run = (ac: Aircraft, s: number, f?: () => void, opts = {}) => { for (let k = 0; k < s / DT; k++) { ac.fm.step(DT, ac.ctrl, env, opts); f?.(); } };

describe('F-16: blocks and flight model (HFFM)', () => {
  it('the flyable F-16s are exactly the HFFM blocks, with the HFFM weights', () => {
    const blocks = FLYABLE.map((d) => BLOCK_OF[d.id]).sort();
    expect(blocks.join(',')).toBe('15,30,32,40,42,50,52');
    for (const d of FLYABLE) {
      const b = BLOCKS[BLOCK_OF[d.id]];
      expect(Math.abs(d.massEmpty / 0.45359237 - b.emptyLb) < 1, `${d.id} empty weight`).toBe(true);
      expect(Math.abs(d.fuelInternal / 0.45359237 - b.fuelLb) < 1, `${d.id} fuel`).toBe(true);
      expect(d.fcs.type).toBe('fbw');
      const ac = new Aircraft(d, 'blue', 't', []);
      expect(ac.fm instanceof F16FlightModel, `${d.id} flies the HFFM model`).toBe(true);
    }
    // every other type keeps the game's own model
    const hornet = new Aircraft(AIRCRAFT.find((d) => d.id === 'fa18c')!, 'blue', 't', []);
    expect(hornet.fm instanceof F16FlightModel).toBe(false);
  });

  it('reads the charts: lift, the CAT I limiter and thrust', () => {
    const fm = new F16FlightModel(AIRCRAFT.find((d) => d.id === 'f16c')!);
    // C/D lift: rises to a peak between 30° and 40° at Mach 0.4 (HFFM p. 17)
    const cls = Array.from({ length: 51 }, (_, a) => f16CL(fm.aero, a, 0.4));
    const peak = cls.indexOf(Math.max(...cls));
    expect(peak >= 30 && peak <= 40, `CL peak at ${peak}°`).toBe(true);
    expect(cls[10] > 0.6 && cls[10] < 0.9, `CL(10°) ${cls[10].toFixed(2)}`).toBe(true);
    // CAT I: 9 G (C/D) / 9.3 G (A/B) below 15°, about 1 G at 25° (HFFM p. 11)
    expect(cat1G(fm.aero, 10, 9)).toBe(9);
    expect(Math.abs(cat1G(fm.aero, 25.2, 9) - 1) < 0.15).toBe(true);
    const a = new F16FlightModel(AIRCRAFT.find((d) => d.id === 'f16a')!);
    expect(Math.abs(cat1G(a.aero, 15, 9.3) - 9.29) < 0.05).toBe(true);
    // thrust: max AB > MIL, falling with altitude
    const ab0 = f16Thrust('F110-GE-129', 'ab', 0, 0), mil0 = f16Thrust('F110-GE-129', 'mil', 0, 0);
    expect(ab0 > mil0 && f16Thrust('F110-GE-129', 'ab', 0, 9144) < ab0 * 0.5).toBe(true);
    expect(Math.abs(F16_S / (FT * FT) - 300) < 0.01).toBe(true);
  });

  it('accelerates like the HFFM chart: Block 50, max AB, 5 000 ft, DI 0 (HFFM p. 94)', () => {
    // chart: Mach 0.3 → 0.93 in 0.45 min, → 1.03 in 0.52 min
    const ac = jet('f16c', 5000 * FT, 0.3 * 334.4);
    ac.fm.core = 1; ac.fm.abFrac = 1; ac.ctrl.throttle = 1;
    const ap = new Autopilot();
    const h0 = ac.fm.pos.y;
    let t = 0, t93 = 0, t103 = 0;
    while (t < 120 && !t103) {
      ac.ctrl.pitch = ap.pitchForG(ac.fm, 1 + 0.004 * (h0 - ac.fm.pos.y) - 0.03 * ac.fm.vel.y, DT);
      run(ac, DT, undefined, { unlimitedFuel: true });
      t += DT;
      if (!t93 && ac.fm.mach >= 0.93) t93 = t;
      if (!t103 && ac.fm.mach >= 1.03) t103 = t;
    }
    expect(Math.abs(ac.fm.pos.y - h0) < 150, `held ${((ac.fm.pos.y - h0) / FT).toFixed(0)} ft off altitude`).toBe(true);
    expect(Math.abs(t93 / 60 - 0.45) < 0.45 * 0.2, `Mach 0.93 after ${(t93 / 60).toFixed(2)} min (chart 0.45)`).toBe(true);
    expect(Math.abs(t103 / 60 - 0.52) < 0.52 * 0.25, `Mach 1.03 after ${(t103 / 60).toFixed(2)} min (chart 0.52)`).toBe(true);
  });
});

describe('F-16: FLCS (Dash-1)', () => {
  it('neutral stick holds 1 G; full aft stick gives 9 G (C/D) and 9.3 G (A/B), never more than the limiter', () => {
    for (const [id, lim] of [['f16c', 9], ['f16a', 9.3]] as const) {
      const ac = jet(id, 3000, 300);
      run(ac, 2);
      expect(Math.abs(ac.fm.nz - 1) < 0.15, `${id}: ${ac.fm.nz.toFixed(2)} G with the stick free`).toBe(true);
      let mx = 0; ac.ctrl.pitch = 1; ac.ctrl.throttle = 1;
      run(ac, 2.5, () => { mx = Math.max(mx, ac.fm.nz); });
      expect(mx > lim - 0.4 && mx < lim + 0.35, `${id}: ${mx.toFixed(2)} G at full aft stick`).toBe(true);
      expect(ac.fm.crashed).toBe(false);
    }
  });

  it('slow and full aft stick: AoA stays at the CAT I limit (about 25°), and -3 G is the push limit', () => {
    const ac = jet('f16c', 3000, 110);
    let mx = 0; ac.ctrl.pitch = 1;
    run(ac, 6, () => { mx = Math.max(mx, ac.fm.alpha * R); });
    expect(mx > 23 && mx < 27, `max AoA ${mx.toFixed(1)}°`).toBe(true);
    const b = jet('f16c', 3000, 250);
    let mn = 9; b.ctrl.pitch = -1;
    run(b, 2, () => { mn = Math.min(mn, b.fm.nz); });
    expect(mn < -2.4 && mn > -3.4, `min ${mn.toFixed(2)} G`).toBe(true);
  });

  it('roll rate: about 278 °/s at speed (CAT I), less below 250 kt and in TO/L gains', () => {
    const fast = jet('f16c', 3000, 220); fast.ctrl.roll = 1;
    let pf = 0; run(fast, 1.5, () => { pf = Math.max(pf, fast.fm.p * R); });
    expect(pf > 240 && pf < 300, `${pf.toFixed(0)} °/s at 430 kt`).toBe(true);
    const slow = jet('f16c', 3000, 95); slow.ctrl.roll = 1;
    let ps = 0; run(slow, 1.5, () => { ps = Math.max(ps, slow.fm.p * R); });
    expect(ps < pf * 0.85, `${ps.toFixed(0)} °/s at 185 kt`).toBe(true);
    const tol = jet('f16c', 3000, 95); tol.ctrl.roll = 1; tol.ctrl.gearDown = true;
    let pt = 0; run(tol, 1.5, () => { pt = Math.max(pt, tol.fm.p * R); });
    // TO/L gains: a fixed limit, whatever the airspeed (Dash-1 16.2.2)
    expect(pt < ps * 0.8 && pt > 70 && pt < 100, `${pt.toFixed(0)} °/s with the gear handle down`).toBe(true);
  });

  it('rolling while pulling stays coordinated (sideslip stays small)', () => {
    const ac = jet('f16c', 3000, 200);
    let peak = 0; ac.ctrl.pitch = 0.5; ac.ctrl.roll = 1;
    run(ac, 2, () => { peak = Math.max(peak, Math.abs(ac.fm.beta * R)); });
    expect(peak < 4, `sideslip ${peak.toFixed(1)}°`).toBe(true);
  });

  it('trailing-edge flaps: 20° down below 240 KIAS with the gear handle down, up by 370 KIAS', () => {
    const tef = (kt: number) => { const ac = jet('f16c', 1000, kt * 0.514444); ac.ctrl.gearDown = true; run(ac, 1.5); return (ac.fm as F16FlightModel).tef; };
    expect(Math.abs(tef(200) - 20) < 1.5).toBe(true);
    expect(tef(300) > 4 && tef(300) < 16).toBe(true);
    expect(tef(390)).toBe(0);
  });
});

describe('F-16 cockpit: controls from the model\'s node names', () => {
  it('parses the naming: S<n> switches, K<n> knobs, B buttons, AX axes', () => {
    expect(parseControl('MAIN_POWER_S3')).toEqual({ node: 'MAIN_POWER_S3', id: 'MAIN_POWER', kind: 'switch', n: 3, label: 'MAIN POWER' });
    expect(parseControl('AIR_SOURCE_K4')!.kind).toBe('knob');
    expect(parseControl('AIR_SOURCE_K4')!.n).toBe(4);
    expect(parseControl('ICP_B3')!.id).toBe('ICP_3');
    expect(parseControl('Master_Caution_B')!.kind).toBe('button');
    expect(parseControl('ICP_SYM_AX')!.kind).toBe('axis');
    expect(parseControl('ROSB13_B.001')!.id).toBe('ROSB13');
    expect(parseControl('FLCS_BIT_2')!.n).toBe(2);
    expect(parseControl('Object_34')).toBe(null);
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
  });

  it('spring-loaded controls snap back; the dobber goes four ways and returns to centre', () => {
    const p = new CockpitPanel();
    // ICP INC/DEC rocker: rests in the middle, held up or down
    expect(p.get('ICP_INC_DC')).toBe(1);
    p.operate('ICP_INC_DC', 1, true); expect(p.get('ICP_INC_DC')).toBe(2);
    p.release(); expect(p.get('ICP_INC_DC')).toBe(1);
    // WARN RESET: the down position is momentary, the up position stays
    p.operate('WARN_RESET', -1, true); expect(p.get('WARN_RESET')).toBe(0);
    p.release(); expect(p.get('WARN_RESET')).toBe(1);
    p.operate('WARN_RESET', 1, true); p.release(); expect(p.get('WARN_RESET')).toBe(2);
    // dobber
    for (const d of [1, 2, 3, 4] as const) { p.operate('ICP_DOBBER', 1, true, d); expect(p.get('ICP_DOBBER')).toBe(d); p.release(); expect(p.get('ICP_DOBBER')).toBe(0); }
    // a plain switch stays where it is put; a button comes back out
    p.operate('MAIN_POWER', 1, true); p.release(); expect(p.get('MAIN_POWER')).toBe(1);
    p.operate('ICP_ENTR', 1, true); expect(p.get('ICP_ENTR')).toBe(1); p.release(); expect(p.get('ICP_ENTR')).toBe(0);
    // knobs step through their detents, axes move in 5 % steps on the wheel
    p.operate('AIR_SOURCE', 1, false); p.operate('AIR_SOURCE', 1, false); expect(p.get('AIR_SOURCE')).toBe(2);
    p.operate('ICP_SYM', 1, false); expect(Math.abs(p.get('ICP_SYM') - 0.05) < 1e-9).toBe(true);
    expect(p.drainChanges().length > 5).toBe(true);
  });

  it('the model has exactly these controls and indicators, and every control gets a pivot', async () => {
    const file = 'assets/models/cockpits/f16/cockpit.glb';
    const buf = readFileSync(file);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: Array<{ name: string }> };
    const names = new Set(json.nodes.map((n) => n.name));
    for (const n of [...COCKPIT_NODES, ...INDICATOR_NODES]) expect(names.has(n), `node ${n} in the model`).toBe(true);
    const named = [...names].filter((n) => !/^Object_/.test(n) && parseControl(n));
    expect(named.length).toBe(COCKPIT_NODES.length);
    const view = new F16CockpitView();
    view.panel = new CockpitPanel();
    const scene = await loadGlbScene(file);
    view.build(scene);
    expect(view.partCount).toBe(CONTROLS.length);
    // UFC_S2 is not a control: named so by mistake
    expect(parseControl('UFC_S2')).toBe(null);
    // a switch tips, a button goes in
    view.pose(0.5);
    const sw = view.pivotOf('MAIN_POWER')!, btn = view.pivotOf('ICP_ENTR')!;
    const q0 = sw.quaternion.clone(), b0 = btn.position.clone();
    view.panel.operate('MAIN_POWER', 1, true); view.panel.operate('ICP_ENTR', 1, true);
    view.pose(0.5);
    expect(sw.quaternion.angleTo(q0) > 0.2).toBe(true);
    expect(btn.position.distanceTo(b0) > 0.001).toBe(true);
    expect(sanitize('ICP_INC/DC_S2')).toBe('ICP_INCDC_S2');
  });
});
