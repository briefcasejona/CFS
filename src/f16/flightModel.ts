// The F-16 flight model, built from the HFFM Manual (Mav-jp & Raptor One) and the flight control system description
// of TO 1F-16CMAM-1 (Dash-1, sec. "Flight control system").
//
// Where the numbers come from:
//  * lift and drag by AoA and Mach, thrust by Mach and altitude, the CAT I G/AoA limiter, the side-force derivative,
//    the rudder (yaw) limiter, block weights and engines: HFFM (tables in data/hffm.ts, blocks in blocks.ts);
//  * the FLCS behaviour (G command in pitch with neutral stick = 1 G, -3 G negative limit, roll-rate command with its
//    reductions, TO/L gains, trailing-edge flap schedule, rudder fade with AoA): Dash-1;
//  * NOT in any of the five documents, fitted or chosen here and marked FIT / ASSUMED where used:
//      - reference wing area: FIT 300 ft² (the DI 0 acceleration charts below Mach 0.9, and the tightest-turn
//        radius of the HFFM EM chart, Block 50 at 10 000 ft: 2 178 ft);
//      - stores drag per drag index: FIT 0.00008 CD per DI (the DI 100 / DI 200 acceleration charts);
//      - idle thrust: FIT 9 % of MIL thrust at the same Mach and altitude (the deceleration charts);
//      - speed-brake drag: FIT CD +0.027 fully open (the "DI 0 + AB" deceleration curves);
//      - CAT I maximum roll rate: 278 °/s, from the Dash-1 statement that the DBU's 167 °/s is CAT III authority,
//        which is 60 % of CAT I;
//      - ASSUMED: engine spool rates, fuel flow (TSFC), landing-gear drag, the speed of the FLCS responses and the
//        control authority (how much moment the surfaces can make at a given dynamic pressure), the size of the
//        roll-rate reductions, negative-AoA lift (the charts start at AoA 0: mirrored about the AoA-0 lift).
import * as THREE from 'three';
import type { AircraftDef } from '../aircraft/types.js';
import { FlightModel, type Controls, type FlightEnv, type FMOptions } from '../sim/flightModel.js';
import { atmosphere, casFromTas, G0 } from '../sim/atmosphere.js';
import { approach, clamp, DEG, smoothstep } from '../core/math.js';
import { AOA, MACH, CL_AB, CD_AB, CL_CD, CD_CD, THRUST, THR_ALT, THR_MACH, CAT1_AB, CAT1_CD } from './data/hffm.js';
import { blockFor, FT, LBF, BLOCKS, type BlockSpec } from './blocks.js';

const UP = new THREE.Vector3(0, 1, 0);
const KT = 0.514444;

/** FIT: reference wing area, m² (300 ft²) */
export const F16_S = 300 * FT * FT;
/** FIT: drag coefficient per drag-index unit (HFFM sec. 1.4: Total drag = Drag(DI 0) + ΣDI · Stores_drag) */
export const STORES_DRAG = 0.00008;
/** FIT: idle thrust as a share of MIL thrust */
export const IDLE_FRACTION = 0.09;
/** FIT: speed brake fully open (60°, HFFM), drag coefficient */
export const SPEEDBRAKE_CD = 0.027;
/** ASSUMED (not in the documents): landing gear drag coefficient */
export const GEAR_CD = 0.02;
/** CAT I maximum roll rate (deg/s), derived from Dash-1 (DBU 167 °/s = CAT III = 60 % of CAT I) */
export const ROLL_RATE_MAX = 167 / 0.6;

// ---------------------------------------------------------------- table lookups
function idx(grid: readonly number[], x: number): [number, number] {
  if (x <= grid[0]) return [0, 0];
  const n = grid.length - 1;
  if (x >= grid[n]) return [n - 1, 1];
  let i = 0;
  while (grid[i + 1] < x) i++;
  return [i, (x - grid[i]) / (grid[i + 1] - grid[i])];
}
/** tab[row][col], rows by `rowGrid`, columns by `colGrid` */
function lookup2(tab: readonly (readonly number[])[], rowGrid: readonly number[], colGrid: readonly number[], r: number, c: number) {
  const [i, ti] = idx(rowGrid, r);
  const [j, tj] = idx(colGrid, c);
  const a = tab[i][j] + (tab[i][j + 1] - tab[i][j]) * tj;
  const b = tab[i + 1][j] + (tab[i + 1][j + 1] - tab[i + 1][j]) * tj;
  return a + (b - a) * ti;
}
function lookup1(xs: readonly number[], ys: readonly number[], x: number) {
  const [i, t] = idx(xs, x);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}

export interface F16Aero { CL: number[][]; CD: number[][]; cat1: { aoa: number[]; g: number[] } }
const AERO: Record<'AB' | 'CD', F16Aero> = {
  AB: { CL: CL_AB, CD: CD_AB, cat1: CAT1_AB },
  CD: { CL: CL_CD, CD: CD_CD, cat1: CAT1_CD },
};

/** Lift coefficient at AoA (deg) and Mach. Negative AoA is not charted: mirrored about the AoA-0 lift. */
export function f16CL(a: F16Aero, aoaDeg: number, mach: number): number {
  if (aoaDeg >= 0) return lookup2(a.CL, MACH, AOA, mach, Math.min(aoaDeg, 50));
  const c0 = lookup2(a.CL, MACH, AOA, mach, 0);
  return 2 * c0 - lookup2(a.CL, MACH, AOA, mach, Math.min(-aoaDeg, 50));
}
/** Drag coefficient (DI 0) at AoA (deg) and Mach. */
export function f16CD(a: F16Aero, aoaDeg: number, mach: number): number {
  return lookup2(a.CD, MACH, AOA, mach, Math.min(Math.abs(aoaDeg), 50));
}
/** CAT I limiter: G allowed at an AoA (deg) (HFFM p. 11); full G below 15°, and past the chart's end (25.2°) the line
 *  is carried on with its last slope, so the jet cannot be held much beyond it. */
export function cat1G(a: F16Aero, aoaDeg: number, gMax: number): number {
  const t = a.cat1;
  if (aoaDeg <= t.aoa[0]) return gMax;
  const n = t.aoa.length - 1;
  if (aoaDeg >= t.aoa[n]) {
    const s = (t.g[n] - t.g[n - 1]) / (t.aoa[n] - t.aoa[n - 1]);
    return t.g[n] + s * (aoaDeg - t.aoa[n]);
  }
  return Math.min(gMax, lookup1(t.aoa, t.g, aoaDeg));
}
/** Thrust (N) of one engine, max AB or MIL, at Mach and altitude (m). */
export function f16Thrust(engine: string, kind: 'mil' | 'ab', mach: number, altM: number): number {
  const t = THRUST[engine][kind];
  return lookup2(t, THR_ALT, THR_MACH, clamp(altM / FT / 1000, 0, 60), clamp(mach, 0, 2)) * LBF;
}

/** Side-force derivative CY-beta, per degree of sideslip, by Mach, for AoA up to about 27° (HFFM p. 19, read from the
 *  raster chart). */
const CYB_MACH: Array<[number, number]> = [
  [0.0, -0.021], [0.5, -0.021], [0.6, -0.025], [0.7, -0.0275], [0.8, -0.036], [0.9, -0.038], [1.0, -0.030], [1.1, -0.028],
  [1.2, -0.021], [1.3, -0.0185], [1.4, -0.017], [1.6, -0.0165], [1.8, -0.016], [2.0, -0.0145],
];
/** and its shape with AoA (same chart): flat to 27°, strongest near 41°, back to the low-AoA value near 69°, zero at 90° */
const CYB_AOA: Array<[number, number]> = [[-10, 1], [27, 1], [41, 1.55], [55, 1.2], [69, 1.0], [90, 0]];
function tab(t: Array<[number, number]>, x: number) {
  return lookup1(t.map((p) => p[0]), t.map((p) => p[1]), x);
}
export function cyBeta(aoaDeg: number, mach: number): number {
  return tab(CYB_MACH, clamp(mach, 0, 2)) * tab(CYB_AOA, clamp(aoaDeg, -10, 90));
}
/** Rudder (pedal) effectiveness by AoA, CAT I: 100 % to 14°, none at 26° (HFFM p. 19, Dash-1 yaw axis) */
export function rudderEffect(aoaDeg: number): number {
  return 1 - smoothstep(14, 26, aoaDeg);
}

// ---------------------------------------------------------------- the model
/** ASSUMED response times and authority of the FLCS (not in the documents) */
const TAU_ALPHA = 0.28;     // s: AoA settles on the commanded G's AoA
const TAU_RATE = 0.07;      // s: body rates follow their command
const CM_MAX = 0.17, CL_MAX = 0.07, CN_MAX = 0.045;   // largest moment coefficients the surfaces can make
const Q_MAX = 50 * DEG;     // rad/s pitch-rate command limit
const TOL_ROLL_RATE = 90 * DEG;   // rad/s, TO/L gains roll rate limit: a fixed value (Dash-1 16.2.2), size ASSUMED
const TOL_PITCH_RATE = 12 * DEG;   // rad/s at full stick, TO/L gains (pitch-rate command below 10° AoA)
const SPOOL_UP = 0.25, SPOOL_DOWN = 0.35;   // core per second
const TSFC_MIL = 0.75, TSFC_AB = 2.0;        // lb / (lbf·h)

export class F16FlightModel extends FlightModel {
  readonly block: BlockSpec;
  readonly aero: F16Aero;
  /** trailing-edge flaps (flaperons), degrees down: Dash-1 schedule */
  tef = 0;
  /** the gear handle / ALT FLAPS put the FLCS in takeoff-and-landing gains */
  tolGains = false;
  /** what the pitch law asked for (for tests and displays) */
  nzCmd = 1; alphaCmd = 0;
  /** roll rate limiter: the share of the roll authority left (Dash-1 sec. 16.2.2) */
  rollLimit = 1;

  constructor(def: AircraftDef) {
    super(def);
    this.block = blockFor(def.id) ?? BLOCKS['50'];
    this.aero = AERO[this.block.airframe];
    this.updateMass();
  }

  /** HFFM gross weight = empty weight + fuel (the charts' GW); the pilot is in the empty weight */
  override updateMass() {
    this.mass = this.def.massEmpty + this.fuel + this.extFuel + this.storeMass;
  }

  override clAlphaNow() {
    const M = this.mach;
    return (f16CL(this.aero, 6, M) - f16CL(this.aero, 0, M)) / (6 * DEG);
  }

  override placeInAir(pos: THREE.Vector3, hdgRad: number, speed: number, clExtra = 0, gamma = 0) {
    super.placeInAir(pos, hdgRad, speed, clExtra, gamma);
    // trim AoA from the HFFM lift: 1 G
    const at = atmosphere(pos.y);
    const M = speed / at.a;
    const q = 0.5 * at.rho * speed * speed;
    const cl = (this.mass * G0 * Math.cos(gamma)) / Math.max(1, q * F16_S);
    const a = this.hffmAoaForCl(cl, M) * DEG;
    const X = new THREE.Vector3(1, 0, 0);
    const path = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hdgRad, 0, 'YXZ'))
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, gamma));
    this.vel.set(0, 0, -1).applyQuaternion(path).multiplyScalar(speed);
    this.quat.copy(path).multiply(new THREE.Quaternion().setFromAxisAngle(X, a));
    this.alpha = a;
    this.tolGains = false; this.rollLimit = 1;
  }

  /** AoA (deg) that gives `cl` at Mach `M`, up to the lift peak */
  hffmAoaForCl(cl: number, M: number): number {
    const c0 = f16CL(this.aero, 0, M);
    if (cl < c0) {
      // negative side (mirrored lift), down to -10°
      for (let a = -1; a >= -10; a--) {
        const ca = f16CL(this.aero, a, M);
        if (ca <= cl) { const cb = f16CL(this.aero, a + 1, M); return a + (cl - ca) / (cb - ca || 1e-9); }
      }
      return -10;
    }
    let prev = c0;
    for (let a = 1; a <= 50; a++) {
      const ca = f16CL(this.aero, a, M);
      if (ca >= cl) return a - 1 + (cl - prev) / (ca - prev || 1e-9);
      if (ca < prev) return a - 1;   // past the peak
      prev = ca;
    }
    return 50;
  }

  override step(dtFull: number, c: Controls, env: FlightEnv, opts: FMOptions = {}) {
    if (this.crashed) return;
    const sub = 2;
    const dt = dtFull / sub;
    for (let i = 0; i < sub && !this.crashed; i++) this.f16Substep(dt, c, env, opts);
  }

  private f16Engine(dt: number, throttle: number, opts: FMOptions) {
    const detent = opts.abDetent ?? 0.8;
    let coreCmd = throttle <= detent ? throttle / detent : 1;
    let abCmd = throttle > detent ? (throttle - detent) / (1 - detent) : 0;
    const running = this.engineRunning && this.fuel + this.extFuel > 0;
    if (!running) { coreCmd = 0; abCmd = 0; }
    this.core = approach(this.core, coreCmd, coreCmd > this.core ? SPOOL_UP : SPOOL_DOWN, dt);
    if (abCmd > 0 && this.core > 0.97) {
      this.abTimer += dt;
      if (this.abTimer > 0.6) this.abFrac = approach(this.abFrac, abCmd, 1.2, dt);
    } else { this.abTimer = 0; this.abFrac = approach(this.abFrac, 0, 3, dt); }
    const M = this.mach, h = this.pos.y, eng = this.block.engine;
    const mil = f16Thrust(eng, 'mil', M, h);
    const idle = IDLE_FRACTION * mil;
    let T = 0, abPart = 0;
    if (running) {
      T = idle + (mil - idle) * this.core;
      if (this.abFrac > 0) { abPart = (f16Thrust(eng, 'ab', M, h) - mil) * this.abFrac; T += abPart; }
    }
    this.thrust = T * this.damage.engine;
    // ASSUMED fuel flow: TSFC on the dry and the afterburning part of the thrust (kg/s)
    this.fuelFlow = running ? ((T - abPart) / G0 * TSFC_MIL + abPart / G0 * TSFC_AB) / 3600 + 0.02 : 0;
    if (!opts.unlimitedFuel) {
      const burn = (this.fuelFlow + this.damage.fuelLeak) * dt;
      if (this.extFuel > 0) this.extFuel = Math.max(0, this.extFuel - burn);
      else this.fuel = Math.max(0, this.fuel - burn);
      this.updateMass();
    }
  }

  private f16Substep(dt: number, c: Controls, env: FlightEnv, opts: FMOptions) {
    const def = this.def;
    this.time += dt;
    this.atmo = atmosphere(this.pos.y, this.atmo);
    const rho = this.atmo.rho;

    // --- secondary actuators. Gear travel time: ASSUMED (not in the documents).
    if (!this.wow || c.gearDown) this.gearPos = approach(this.gearPos, c.gearDown ? 1 : 0, 1 / 6, dt);
    this.brakePos = approach(this.brakePos, c.speedbrake, 1 / 1.5, dt);
    // TO/L gains with the LG handle down or ALT FLAPS (c.flaps) extended (Dash-1)
    this.tolGains = c.gearDown || c.flaps > 0.5;
    // TEFs: 20° down below 240 KIAS in TO/L gains, faired by 370 KIAS (Dash-1); 35 °/s (HFFM)
    const kias = this.ias / KT;
    const tefCmd = this.tolGains ? 20 * clamp((370 - kias) / (370 - 240), 0, 1) : 0;
    this.tef = approach(this.tef, tefCmd, 35, dt);
    this.flapPos = this.tef / 20;

    // --- air data
    const vAir = new THREE.Vector3().copy(this.vel).sub(env.wind);
    const V = vAir.length();
    this.qi.copy(this.quat).invert();
    const vb = vAir.clone().applyQuaternion(this.qi);
    const u = -vb.z, vSide = vb.x, w = -vb.y;
    const Vs = Math.max(V, 1);
    this.alpha = V > 2 ? Math.atan2(w, u) : 0;
    this.beta = V > 2 ? Math.asin(clamp(vSide / V, -1, 1)) : 0;
    this.tas = V;
    this.mach = V / this.atmo.a;
    this.qbar = 0.5 * rho * V * V;
    this.ias = V > 1 ? casFromTas(V, this.pos.y) : 0;
    const M = this.mach, qbar = this.qbar, S = F16_S, b = def.span, cbar = def.chord;
    const aDeg = this.alpha / DEG;

    this.f16Engine(dt, c.throttle, opts);

    // --- aerodynamic coefficients (HFFM)
    const CL = f16CL(this.aero, aDeg, M);
    const stores = this.storeCdA / S;   // the game's stores, as a drag coefficient
    const CD = f16CD(this.aero, aDeg, M) + stores + SPEEDBRAKE_CD * this.brakePos + GEAR_CD * this.gearPos;
    const CY = cyBeta(aDeg, M) * (this.beta / DEG);
    this.stalled = Math.abs(aDeg) > 30 && !this.wow;

    // --- forces (world frame)
    const force = new THREE.Vector3(0, -this.mass * G0, 0);
    const liftDir = new THREE.Vector3();
    if (V > 0.5) {
      const vhat = vAir.clone().divideScalar(V);
      liftDir.crossVectors(this.right(), vhat);
      if (liftDir.lengthSq() > 1e-8) liftDir.normalize();
      const sideDir = new THREE.Vector3().crossVectors(vhat, liftDir);
      force.addScaledVector(liftDir, qbar * S * CL);
      force.addScaledVector(vhat, -qbar * S * CD);
      force.addScaledVector(sideDir, qbar * S * CY);
    }
    force.addScaledVector(this.forward(), this.thrust);

    // --- ground contact (the game's gear model)
    let Lg = 0, Mg = 0, Ng = 0;
    this.wow = false;
    const gh = env.groundHeight(this.pos.x, this.pos.z);
    const water = env.isWater(this.pos.x, this.pos.z);
    this.agl = this.pos.y - (water ? Math.max(gh, 0) : gh);
    let contact = false;
    if (this.agl < def.length + 5) {
      contact = this.groundForces(dt, c, env, force, (l, m, n) => { Lg += l; Mg += m; Ng += n; });
      if (this.crashed) return;
    }
    this.onGround = contact;

    // --- load factors (specific force in body axes, in G)
    const sb = force.clone().addScaledVector(UP, this.mass * G0).divideScalar(this.mass * G0).applyQuaternion(this.qi);
    this.nz = sb.y; this.ny = sb.x; this.nx = -sb.z;

    // --- FLCS (Dash-1): rate commands, then the moments the surfaces make to follow them
    const health = this.damage.controls * this.damage.hydraulics;
    // the velocity vector's own turn rate in the pitch plane (rad/s): the jet's nose has to follow it
    const accel = force.clone().divideScalar(this.mass);
    const pathRate = V > 5 ? accel.dot(liftDir) / Vs : 0;
    // and sideways (sideslip changes as  dβ/dt = p sin α − r cos α + a_side / V)
    const sideRate = V > 5 ? accel.dot(this.right()) / Vs : 0;
    const stick = clamp(c.pitch + c.trimPitch * 0.25, -1, 1);
    const gMax = this.block.gMax, gMin = -3;   // Dash-1: -3 G above 250 KCAS
    const nStick = stick >= 0 ? 1 + stick * (gMax - 1) : 1 + stick * (1 - gMin);
    this.nzCmd = nStick;
    // the AoA where the jet makes the commanded G, held under the CAT I limiter (HFFM p. 11)
    const aCmd = this.alphaForG(nStick, M, qbar, gMax);
    this.alphaCmd = aCmd;
    let qCmd = pathRate + (aCmd - aDeg) * DEG / TAU_ALPHA;
    if (this.tolGains) {
      // TO/L gains: pitch-rate command below 10° AoA, G command (with the limiter) above (Dash-1)
      const s = smoothstep(10, 13, aDeg);
      const rateCmd = stick * TOL_PITCH_RATE;
      qCmd = (1 - s) * Math.min(rateCmd, aDeg > aCmd ? qCmd : rateCmd) + s * qCmd;
    }
    if (this.wow && this.tolGains) qCmd = stick * TOL_PITCH_RATE;
    qCmd = clamp(qCmd, -Q_MAX, Q_MAX);

    // moments the surfaces can make (ASSUMED authority), to follow the commands
    const [Ixx0, Iyy0, Izz0] = def.inertia;
    const mScale = clamp(this.mass / (def.massEmpty + def.fuelInternal * 0.5), 0.7, 1.6);
    const Ixx = Ixx0 * mScale, Iyy = Iyy0 * mScale, Izz = Izz0 * mScale;
    const qS = qbar * S;
    const eff = health * (1 - 0.3 * smoothstep(1.0, 1.6, M));
    const lim = (v: number, m: number) => clamp(v, -m, m);
    const p = this.p, q = this.q, r = this.r;
    const mMax = qS * cbar * CM_MAX * eff, lMax = qS * b * CL_MAX * eff, nMax = qS * b * CN_MAX * eff;

    // yaw: coordinated (the jet rolls about its velocity vector, ARI, sideslip held near zero) plus pedal sideslip,
    // the pedal faded with AoA (HFFM yaw limiter, CAT I): the yaw rate that makes dβ/dt bring β to the command
    const pedal = clamp(c.yaw + c.trimYaw * 0.25, -1, 1);
    const betaCmd = -pedal * 8 * DEG * rudderEffect(aDeg);
    const ca = Math.max(Math.cos(this.alpha), 0.3);
    const rCmd = this.wow || V < 30 ? 0 : (this.p * Math.sin(this.alpha) + sideRate + (this.beta - betaCmd) / 0.3) / ca;
    // inversion: the moment that gives the wanted rate change, including the gyroscopic terms
    const nReq = Izz * (rCmd - r) / TAU_RATE - (Ixx - Iyy) * p * q;

    // roll: rate command (Dash-1 sec. 16.2.2): authority reduced as airspeed falls and AoA rises, and further for
    // large total rudder commands (here: when the rudder cannot make the yaw the coordination needs). Sizes ASSUMED.
    const rudderShare = Math.abs(nReq) / Math.max(nMax, 1);
    const limTarget = clamp(1.6 - rudderShare, 0.25, 1);
    this.rollLimit = approach(this.rollLimit, limTarget, limTarget < this.rollLimit ? 4 : 1, dt);
    const rollStick = clamp(c.roll + c.trimRoll * 0.25, -1, 1);
    let pMax = ROLL_RATE_MAX * DEG;
    pMax *= 1 - 0.7 * smoothstep(15, 25, Math.abs(aDeg));
    pMax *= clamp(kias / 250, 0.35, 1);
    // TO/L gains: a fixed limit, independent of AoA and airspeed (Dash-1 16.2.2; the value is ASSUMED)
    if (this.tolGains) pMax = TOL_ROLL_RATE;
    else pMax *= this.rollLimit;
    const pCmd = this.wow ? 0 : rollStick * pMax;

    let Mm = lim(Iyy * (qCmd - q) / TAU_RATE - (Izz - Ixx) * p * r, mMax);
    let Lm = lim(Ixx * (pCmd - p) / TAU_RATE - (Iyy - Izz) * q * r, lMax);
    let Nm = lim(nReq, nMax);
    if (this.wow) {
      // on the wheels the FLCS only rotates the jet in pitch; roll and yaw come from the gear
      Lm = 0; Nm = 0;
      // with the stick free the gear and the weight decide (the nose comes down after touchdown)
      if (!this.tolGains || Math.abs(stick) < 0.05) Mm = 0;
    }
    Mm += Mg; Lm += Lg; Nm += Ng;
    // surface positions for the exterior model (display only), full throw at full authority
    this.elev = -clamp(Mm / Math.max(mMax, 1), -1, 1) * 25 * DEG;
    this.ail = clamp(Lm / Math.max(lMax, 1), -1, 1) * 21 * DEG;
    this.rud = clamp(Nm / Math.max(nMax, 1), -1, 1) * 30 * DEG;

    // --- integration (as the game's other aircraft)
    this.vel.addScaledVector(force, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);
    const pd = (Lm + (Iyy - Izz) * q * r) / Ixx;
    const qd = (Mm + (Izz - Ixx) * p * r) / Iyy;
    const rd = (Nm + (Ixx - Iyy) * p * q) / Izz;
    this.p = clamp(p + pd * dt, -12, 12);
    this.q = clamp(q + qd * dt, -6, 6);
    this.r = clamp(r + rd * dt, -6, 6);
    const wx = this.q, wy = -this.r, wz = -this.p;
    const qq = this.quat;
    const h = 0.5 * dt;
    qq.set(
      qq.x + h * (qq.w * wx + qq.y * wz - qq.z * wy),
      qq.y + h * (qq.w * wy + qq.z * wx - qq.x * wz),
      qq.z + h * (qq.w * wz + qq.x * wy - qq.y * wx),
      qq.w + h * (-qq.x * wx - qq.y * wy - qq.z * wz),
    ).normalize();

    // --- structural limits (the game's rule)
    if (!this.wow && !opts.invulnerable) {
      if (this.nz > def.limits.gMax * 1.5 || this.nz < def.limits.gMin * 1.5) {
        this.overG += dt;
        if (this.overG > 0.25) this.crash('Structural failure (over-G)');
      } else if (this.nz > def.limits.gMax * 1.05) this.overG += dt * 0.02;
    }
    if (this.pos.y > 24000) this.vel.y = Math.min(this.vel.y, 0);
  }

  /** The AoA (deg) at which the jet makes `nCmd` G at this dynamic pressure, held to the CAT I limiter line: the
   *  first AoA where the G available reaches min(nCmd, limiter G at that AoA). */
  alphaForG(nCmd: number, M: number, qbar: number, gMax: number): number {
    const W = this.mass * G0;
    const k = qbar * F16_S / Math.max(W, 1);
    if (nCmd < 0 || k * f16CL(this.aero, 0, M) > nCmd) {
      // negative side: no limiter chart; lift mirrored, down to -10°
      if (k < 1e-6) return 0;
      return Math.max(-10, this.hffmAoaForCl(nCmd / k, M));
    }
    let prevA = 0, prevF = k * f16CL(this.aero, 0, M) - Math.min(nCmd, cat1G(this.aero, 0, gMax));
    for (let a = 0.5; a <= 32; a += 0.5) {
      const f = k * f16CL(this.aero, a, M) - Math.min(nCmd, cat1G(this.aero, a, gMax));
      if (f >= 0) return prevA + 0.5 * (-prevF) / (f - prevF || 1e-9);
      prevA = a; prevF = f;
    }
    return 32;
  }
}

/** The flight model for an aircraft: the HFFM model for every F-16, the game's generic model for the rest. */
export function createFlightModel(def: AircraftDef): FlightModel {
  return def.family === 'F-16' ? new F16FlightModel(def) : new FlightModel(def);
}
