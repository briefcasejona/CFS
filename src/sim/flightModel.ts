import * as THREE from 'three';
import type { AircraftDef } from '../aircraft/types.js';
import { atmosphere, casFromTas, G0, type AtmoState } from './atmosphere.js';
import { approach, clamp, DEG, smoothstep, table1 } from '../core/math.js';

/** F-16 FLCS: AoA limit (deg) and the speed (m/s, ≈450 kt) below which the stick's G gearing falls off */
const F16_AOA_LIMIT = 25;
const F16_CORNER = 230;

/**
 * 6-DOF rigid-body flight model.
 *
 * World frame: x = east, y = up, z = south (three.js). Body frame: forward = -Z, up = +Y, right = +X.
 * Body rates p (roll, right wing down +), q (pitch, nose up +), r (yaw, nose right +).
 * In three.js body-axis vector form the angular velocity is w_b = (q, -r, -p).
 */

export interface Controls {
  pitch: number;      // -1..1, + = pull (nose up)
  roll: number;       // -1..1, + = right
  yaw: number;        // -1..1, + = right pedal
  throttle: number;   // 0..1 (abDetent..1 = afterburner)
  flaps: number;      // 0..1 command
  speedbrake: number; // 0..1
  gearDown: boolean;
  brakes: number;     // 0..1
  nozzle: number;     // 0..1 (Harrier: 0..98 deg)
  trimPitch: number;  // -1..1
  trimRoll: number;
  trimYaw: number;
}

export function defaultControls(): Controls {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, speedbrake: 0, gearDown: true, brakes: 0, nozzle: 0, trimPitch: 0, trimRoll: 0, trimYaw: 0 };
}

export interface FlightEnv {
  groundHeight(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** velocity of a moving surface (carrier deck) at a point, null for solid ground */
  groundVelocity?(x: number, z: number): THREE.Vector3 | null;
  wind: THREE.Vector3;
}

export interface FMOptions {
  unlimitedFuel?: boolean;
  invulnerable?: boolean;
  abDetent?: number;
}

export interface Damage {
  engine: number;    // 0..1 health
  controls: number;  // 0..1
  fuelLeak: number;  // kg/s
  hydraulics: number;
}

// Mach tables (multipliers)
const CLA_MACH: ReadonlyArray<readonly [number, number]> = [[0, 1], [0.6, 1.08], [0.9, 1.2], [1.05, 1.12], [1.3, 0.95], [2.0, 0.72], [3, 0.55]];
const CLMAX_MACH: ReadonlyArray<readonly [number, number]> = [[0, 1], [0.5, 1], [0.8, 0.88], [1.0, 0.78], [1.3, 0.72], [2.0, 0.6]];

const UP = new THREE.Vector3(0, 1, 0);

export class FlightModel {
  readonly def: AircraftDef;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  p = 0; q = 0; r = 0;

  fuel: number;
  storeMass = 0;
  storeCdA = 0;
  extFuel = 0;      // fuel in external tanks
  mass = 0;

  // actuators/state
  core = 0;          // 0 = idle, 1 = mil
  abFrac = 0;        // 0..1 afterburner stage
  abTimer = 0;
  engineRunning = true;
  gearPos = 1;
  flapPos = 0;
  brakePos = 0;
  nozzleAngle = 0;   // rad
  sweep = 20;        // deg (swing wing)
  elev = 0; ail = 0; rud = 0; tvc = 0; // rad
  private alphaInt = 0;
  private alphaPrev = 0;
  private alphaDot = 0;
  private nzPrev = 1;
  /** load-factor rate (g/s), smoothed — the limiters look ahead on it */
  private nzDot = 0;
  private qi = new THREE.Quaternion();
  /** F-16 FLCS state: prefiltered G and roll commands, roll authority left by the rudder, filtered load factor */
  private flcs = { n: 1, ps: 0, rollAuth: 1, nzF: 1 };

  // outputs
  alpha = 0; beta = 0; mach = 0; tas = 0; ias = 0; qbar = 0;
  nz = 1; ny = 0; nx = 0;
  thrust = 0; fuelFlow = 0;
  /** compressor stall state: seconds left, which engine (−1 left / +1 right), how many so far */
  stallTimer = 0; stallSide = 0; stallCount = 0;
  private asymThrust = 0;
  private lastThrottle = 0;
  onGround = false;
  wow = false;
  crashed = false;
  crashReason = '';
  stalled = false;
  tailScrape = false;
  overG = 0;
  agl = 0;
  time = 0;
  atmo: AtmoState = atmosphere(0);
  damage: Damage = { engine: 1, controls: 1, fuelLeak: 0, hydraulics: 1 };

  constructor(def: AircraftDef) {
    this.def = def;
    this.fuel = def.fuelInternal;
    this.updateMass();
  }

  setStores(mass: number, cda: number, extFuel: number) {
    this.storeMass = mass;
    this.storeCdA = cda;
    this.extFuel = extFuel;
    this.updateMass();
  }

  updateMass() {
    this.mass = this.def.massEmpty + this.fuel + this.extFuel + this.storeMass + 100; // + pilot/oil
  }

  get totalFuel() { return this.fuel + this.extFuel; }

  /** Place on ground at given heading (rad), gear down, engine idle. */
  placeOnGround(x: number, z: number, groundY: number, hdgRad: number) {
    this.pos.set(x, groundY + this.def.gear.height, z);
    this.vel.set(0, 0, 0);
    this.quat.setFromEuler(new THREE.Euler(0, -hdgRad, 0, 'YXZ'));
    this.p = this.q = this.r = 0;
    this.gearPos = 1; this.core = 0; this.abFrac = 0;
    this.onGround = true; this.wow = true;
  }

  /**
   * Airstart at altitude and speed (m/s), roughly trimmed. `clExtra` is lift already provided by high-lift devices
   * (landing flaps) and `gamma` the flight-path angle (rad, negative = descending).
   */
  placeInAir(pos: THREE.Vector3, hdgRad: number, speed: number, clExtra = 0, gamma = 0) {
    this.pos.copy(pos);
    this.quat.setFromEuler(new THREE.Euler(0, -hdgRad, 0, 'YXZ'));
    const X = new THREE.Vector3(1, 0, 0);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(X, gamma));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    this.vel.copy(fwd).multiplyScalar(speed);
    const at = atmosphere(pos.y);
    const qb = 0.5 * at.rho * speed * speed;
    const cl = (this.mass * G0 * Math.cos(gamma)) / Math.max(1, qb * this.def.wingArea);
    const a = clamp((cl - this.def.aero.CL0 - clExtra) / this.def.aero.CLa, -0.1, 0.25);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(X, a));
    this.gearPos = 0; this.flapPos = 0;
    this.core = 0.85; this.p = this.q = this.r = 0;
    this.alphaInt = 0;
    this.onGround = false; this.wow = false;
    this.mach = speed / at.a;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  /** Pitch, roll, heading (rad). Heading clockwise from north. */
  attitude() {
    const f = this.forward();
    const rgt = this.right();
    const upv = this.up();
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const roll = Math.atan2(-rgt.y, upv.y);
    const hdg = Math.atan2(f.x, -f.z);
    return { pitch, roll, hdg };
  }

  /** Current lift-curve slope (per rad) incl. Mach effect. */
  clAlphaNow() { return this.def.aero.CLa * table1(CLA_MACH, this.mach); }
  /** Current pitch stiffness Cm_alpha incl. supersonic AC shift. */
  cmAlphaNow() { return this.def.aero.Cma - 0.35 * smoothstep(0.9, 1.3, this.mach); }
  /** Control surface effectiveness factor (supersonic loss). */
  ctrlEffectNow() { return 1 - 0.35 * smoothstep(0.9, 1.5, this.mach); }

  get rpm() { return this.engineRunning && this.fuel > 0 ? 62 + 38 * this.core + 3 * this.abFrac : Math.max(0, 62 * this.core); }

  /** Engine thrust model, total for all engines (N). */
  private engineStep(dt: number, throttle: number, opts: FMOptions) {
    const e = this.def.engine;
    const detent = opts.abDetent ?? 0.8;
    const hasAB = e.abThrust > e.milThrust;
    let coreCmd: number, abCmd = 0;
    if (!hasAB) {
      coreCmd = clamp(throttle, 0, 1);
    } else if (throttle <= detent) {
      coreCmd = throttle / detent;
    } else {
      coreCmd = 1;
      abCmd = (throttle - detent) / (1 - detent);
    }
    const running = this.engineRunning && this.fuel + this.extFuel > 0;
    if (!running) { coreCmd = 0; abCmd = 0; }
    const rate = (1 / e.spoolTime) * (this.core < 0.3 ? 0.7 : 1.3);
    this.core = approach(this.core, coreCmd, rate, dt);
    if (abCmd > 0 && this.core > 0.95) {
      this.abTimer += dt;
      if (this.abTimer > 0.5) this.abFrac = approach(this.abFrac, abCmd, 1.5, dt);
    } else {
      this.abTimer = 0;
      this.abFrac = approach(this.abFrac, 0, 3, dt);
    }
    const at = this.atmo;
    const M = this.mach;
    const milLapse = Math.pow(at.sigma, 0.95) * (1 + 0.1 * M);
    const abLapse = Math.pow(at.sigma, 0.75) * (1 + 0.7 * M);
    const inlet = clamp(1 - (M - e.inletMach) * 4, 0, 1);
    const milT = running ? e.milThrust * (0.04 + 0.96 * Math.pow(this.core, 1.6)) * milLapse : 0;
    const abT = running ? (e.abThrust - e.milThrust) * this.abFrac * abLapse : 0;
    // engine/inlet temperature & dynamic pressure limit at low altitude (emulates Tt2 / max q schedule)
    const vmax = this.def.limits.vmaxKcas * 0.514444;
    const qLim = 0.5 * 1.225 * vmax * vmax;
    const qCut = clamp(1 - (this.qbar - qLim) / (0.3 * qLim), 0.2, 1);
    this.thrust = (milT + abT) * e.count * inlet * qCut * this.damage.engine;
    // compressor stall (TF30): high AoA / sideslip / abrupt throttle in AB → one engine stalls for a few seconds
    this.asymThrust = 0;
    if (e.stallProne && running && e.count === 2) {
      if (this.stallTimer > 0) {
        this.stallTimer -= dt;
        const lost = this.thrust * 0.5 * clamp(this.stallTimer / 1.0, 0.3, 1);
        this.thrust -= lost;
        this.asymThrust = lost * this.stallSide;
      } else {
        const a = Math.abs(this.alpha), b = Math.abs(this.beta);
        const dThr = Math.abs(throttle - this.lastThrottle) / Math.max(dt, 1e-3);
        const risk = e.stallProne * (
          smoothstep(16 * DEG, 30 * DEG, a) * (0.15 + smoothstep(3 * DEG, 12 * DEG, b)) * (this.abFrac > 0.1 ? 1.8 : 1)
          + (dThr > 1.2 && this.abFrac > 0.1 && this.mach > 0.7 ? 0.6 : 0)
          + smoothstep(8 * DEG, 18 * DEG, b) * 0.25);
        if (Math.random() < risk * dt) {
          this.stallTimer = 3 + Math.random() * 3;
          this.stallSide = Math.random() < 0.5 ? -1 : 1;
          this.stallCount++;
        }
      }
    }
    this.lastThrottle = throttle;
    this.fuelFlow = running ? (milT * e.tsfcMil + abT * e.tsfcAB) * e.count + 0.05 : 0;
    if (!opts.unlimitedFuel) {
      const burn = (this.fuelFlow + this.damage.fuelLeak) * dt;
      if (this.extFuel > 0) this.extFuel = Math.max(0, this.extFuel - burn);
      else this.fuel = Math.max(0, this.fuel - burn);
      this.updateMass();
    }
  }

  step(dtFull: number, c: Controls, env: FlightEnv, opts: FMOptions = {}) {
    if (this.crashed) return;
    const sub = 2;
    const dt = dtFull / sub;
    for (let i = 0; i < sub && !this.crashed; i++) this.substep(dt, c, env, opts);
  }

  private substep(dt: number, c: Controls, env: FlightEnv, opts: FMOptions) {
    const def = this.def;
    const A = def.aero;
    this.time += dt;
    this.atmo = atmosphere(this.pos.y, this.atmo);
    const rho = this.atmo.rho;

    // --- secondary actuators
    if (!this.wow || c.gearDown) this.gearPos = approach(this.gearPos, c.gearDown ? 1 : 0, 1 / 6, dt);
    let flapCmd = c.flaps;
    if (this.ias > 140) flapCmd = 0; // flap blowback ~270 kt
    this.flapPos = approach(this.flapPos, flapCmd, 0.25, dt);
    this.brakePos = approach(this.brakePos, c.speedbrake, 0.8, dt);
    if (def.fcs.vtol) this.nozzleAngle = approach(this.nozzleAngle, c.nozzle * 98 * DEG, 90 * DEG, dt);
    if (def.fcs.swingWing) this.sweep = approach(this.sweep, 20 + 48 * smoothstep(0.45, 0.95, this.mach), 7, dt);

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
    const M = this.mach;
    const qbar = this.qbar;
    const S = def.wingArea, b = def.span, cbar = def.chord;
    const alpha = this.alpha, beta = this.beta;
    const absA = Math.abs(alpha);

    this.engineStep(dt, c.throttle, opts);

    // --- swing wing modifiers
    let clmaxMul = 1, kMul = 1, waveMul = 1, mcritAdd = 0;
    if (def.fcs.swingWing) {
      const s = (this.sweep - 20) / 48;
      clmaxMul = 1 - 0.3 * s; kMul = 1 + 1.6 * s; waveMul = 1 - 0.35 * s; mcritAdd = 0.12 * s;
    }

    // --- lift coefficient: linear, smooth quadratic roll-off to CLmax, then post-stall flat plate
    const CLa = A.CLa * table1(CLA_MACH, M);
    const CLmax = A.CLmax * table1(CLMAX_MACH, M) * clmaxMul + A.flapCL * this.flapPos * 0.6;
    const sgn = alpha >= 0 ? 1 : -1;
    const negScale = alpha >= 0 ? 1 : 0.75;
    const clm = CLmax * negScale;
    const cl0s = A.CL0 * sgn;
    const aLe = (0.75 * clm - cl0s) / CLa;
    const aSt = (1.25 * clm - cl0s) / CLa;
    const aStallPos = (1.25 * CLmax - A.CL0) / CLa;
    let CL: number;
    if (absA <= aLe) {
      CL = A.CL0 + CLa * alpha;
    } else if (absA <= aSt) {
      const t = absA - aLe;
      const d = aSt - aLe;
      CL = sgn * (0.75 * clm + CLa * t - (CLa / (2 * d)) * t * t);
    } else {
      const flat = 1.15 * Math.sin(2 * alpha);
      const decay = sgn * Math.max(clm - 1.6 * (absA - aSt), 0);
      CL = Math.abs(flat) > Math.abs(decay) ? flat : decay;
    }
    CL += A.flapCL * this.flapPos * (absA < aSt ? 1 : 0.5);
    const stallF = smoothstep(aSt * 0.92, aSt * 1.25, absA);
    this.stalled = stallF > 0.3 && !this.wow;

    // --- drag coefficient
    const Mcrit = A.Mcrit + mcritAdd;
    let cd0 = A.CD0;
    const wave = A.waveDrag * waveMul;
    if (M > Mcrit) {
      if (M < 1.1) cd0 *= 1 + (wave - 1) * smoothstep(Mcrit, 1.1, M);
      else cd0 *= wave - (wave - 1) * 0.35 * clamp((M - 1.1) / 0.9, 0, 1.5);
    }
    const kEff = A.k * kMul * (1 + 1.5 * Math.max(0, M - 0.9));
    const CD = cd0 + kEff * CL * CL * (1 - stallF * 0.5) + 1.25 * Math.sin(absA) ** 2 * stallF
      + A.flapCD * this.flapPos + A.brakeCD * this.brakePos + A.gearCD * this.gearPos
      + (this.storeCdA / S) * (M > 0.9 ? 1.6 : 1) + 0.6 * Math.sin(Math.abs(beta)) ** 2;

    // --- aerodynamic moment terms the control laws need too
    const superCtrl = 1 - 0.35 * smoothstep(0.9, 1.5, M);
    const Cma = A.Cma - 0.35 * smoothstep(0.9, 1.3, M);
    // directional stability fades past the stall and only reverses (mildly) deep post-stall — the FCS or the pilot's
    // feet have to keep the sideslip in check up there
    const depart = smoothstep(aSt * 1.0, aSt * 1.6, absA);
    const Cnb = A.Cnb * (1 - 1.3 * depart);
    const Clb = A.Clb * (1 - 1.2 * depart);
    // yaw due to roll rate (Cnp ≈ −CL/8)
    const Cnp = -clamp(CL, -1.5, 1.5) / 8;
    // adverse yaw per radian of aileron: grows with AoA; FCS-coordinated jets hide most of it
    const advYawDa = -0.15 * A.Clda * Math.sin(2 * absA) * (def.fcs.type === 'manual' ? 1 : def.fcs.type === 'cas' ? 0.6 : 0.3);
    // (a fly-by-wire roll-rate loop sees the rock coming and holds most of it off)
    const wingRock = stallF * 0.015 * Math.sin(this.time * 2.3) * (1 + Math.sin(this.time * 0.7)) * (def.fcs.type === 'fbw' ? 0.3 : 1);
    const pitchBreak = stallF * 0.08 * sgn * (def.fcs.canard ? 0.3 : 1);

    // --- flight control system -> surface deflections
    const ctrlHealth = this.damage.controls * this.damage.hydraulics;
    if (def.fcs.law === 'f16') {
      this.f16Flcs(dt, c, Vs, qbar, ctrlHealth, { CLa, CLmax, aStall: aStallPos, stallF, superCtrl, Cma, Cnb, Clb, Cnp, advYawDa, wingRock, pitchBreak });
    } else this.fcs(dt, c, V, Vs, qbar, CLa, aStallPos, ctrlHealth);

    // --- aerodynamic moment coefficients
    const qhat = this.q * cbar / (2 * Vs);
    const phat = this.p * b / (2 * Vs);
    const rhat = this.r * b / (2 * Vs);
    let Cm = Cma * alpha + A.Cmq * qhat + A.Cmde * this.elev * superCtrl - 0.02 * this.brakePos - 0.04 * this.flapPos;
    Cm -= pitchBreak;
    const advYaw = advYawDa * this.ail;
    const Cl = Clb * beta + A.Clp * phat + A.Clr * rhat + A.Clda * this.ail * superCtrl * (1 - 0.5 * stallF) + wingRock;
    const Cn = Cnb * beta + A.Cnr * rhat + Cnp * phat + A.Cndr * this.rud * superCtrl * (1 - 0.4 * stallF) + advYaw;
    const CY = A.CYb * beta;

    // --- forces (world frame)
    const force = new THREE.Vector3(0, -this.mass * G0, 0);
    if (V > 0.5) {
      const vhat = vAir.clone().divideScalar(V);
      const rightW = this.right();
      const liftDir = new THREE.Vector3().crossVectors(rightW, vhat);
      if (liftDir.lengthSq() > 1e-8) liftDir.normalize();
      const sideDir = new THREE.Vector3().crossVectors(vhat, liftDir);
      force.addScaledVector(liftDir, qbar * S * CL);
      force.addScaledVector(vhat, -qbar * S * CD);
      force.addScaledVector(sideDir, qbar * S * CY);
    }
    let Mthrust = 0;
    const tdir = new THREE.Vector3(0, 0, -1);
    if (def.fcs.vtol) {
      tdir.set(0, Math.sin(this.nozzleAngle), -Math.cos(this.nozzleAngle));
    } else if (def.fcs.tvc) {
      tdir.set(0, Math.sin(this.tvc), -Math.cos(this.tvc));
      Mthrust = this.thrust * Math.sin(this.tvc) * 0.42 * def.length;
    }
    tdir.applyQuaternion(this.quat);
    force.addScaledVector(tdir, this.thrust);

    // --- moments in body (roll L, pitch M, yaw N)
    let Lm = qbar * S * b * Cl;
    let Mm = qbar * S * cbar * Cm + Mthrust;
    let Nm = qbar * S * b * Cn;
    // asymmetric thrust (one engine stalled): engines ~7% of span off the centreline
    if (this.asymThrust) Nm += this.asymThrust * def.span * 0.07;

    // Harrier reaction control system (works at zero airspeed)
    if (def.fcs.vtol && this.nozzleAngle > 10 * DEG) {
      const rcs = this.thrust * smoothstep(10 * DEG, 40 * DEG, this.nozzleAngle) * ctrlHealth;
      Mm += rcs * 0.05 * def.length * clamp(c.pitch + c.trimPitch * 0.3, -1, 1) - rcs * 0.4 * this.q;
      Lm += rcs * 0.035 * def.span * c.roll - rcs * 0.25 * this.p;
      Nm += rcs * 0.025 * def.length * c.yaw - rcs * 0.25 * this.r;
    }

    // --- ground contact
    this.wow = false;
    const gh = env.groundHeight(this.pos.x, this.pos.z);
    const water = env.isWater(this.pos.x, this.pos.z);
    this.agl = this.pos.y - (water ? Math.max(gh, 0) : gh);
    let contact = false;
    if (this.agl < def.length + 5) {
      contact = this.groundForces(dt, c, env, force, (l, m, n) => { Lm += l; Mm += m; Nm += n; });
      if (this.crashed) return;
    }
    this.onGround = contact;

    // --- load factors (specific force in body axes, in G)
    const sb = force.clone().addScaledVector(UP, this.mass * G0).divideScalar(this.mass * G0).applyQuaternion(this.qi);
    this.nz = sb.y; this.ny = sb.x; this.nx = -sb.z;

    // --- translational integration (semi-implicit Euler)
    this.vel.addScaledVector(force, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);

    // --- rotational integration (Euler's equations)
    const [Ixx0, Iyy0, Izz0] = def.inertia;
    const mref = def.massEmpty + def.fuelInternal * 0.5;
    const mScale = clamp(this.mass / mref, 0.7, 1.6);
    const Ixx = Ixx0 * mScale, Iyy = Iyy0 * mScale, Izz = Izz0 * mScale;
    const p = this.p, q = this.q, r = this.r;
    const pd = (Lm + (Iyy - Izz) * q * r) / Ixx;
    const qd = (Mm + (Izz - Ixx) * p * r) / Iyy;
    const rd = (Nm + (Ixx - Iyy) * p * q) / Izz;
    this.p = clamp(p + pd * dt, -12, 12);
    this.q = clamp(q + qd * dt, -6, 6);
    this.r = clamp(r + rd * dt, -6, 6);
    // quaternion kinematics: dq = 0.5 q ⊗ (w_b, 0)
    const wx = this.q, wy = -this.r, wz = -this.p;
    const qq = this.quat;
    const h = 0.5 * dt;
    const nx = qq.x + h * (qq.w * wx + qq.y * wz - qq.z * wy);
    const ny = qq.y + h * (qq.w * wy + qq.z * wx - qq.x * wz);
    const nz = qq.z + h * (qq.w * wz + qq.x * wy - qq.y * wx);
    const nw = qq.w + h * (-qq.x * wx - qq.y * wy - qq.z * wz);
    qq.set(nx, ny, nz, nw).normalize();

    // --- structural limits
    if (!this.wow && !opts.invulnerable) {
      if (this.nz > def.limits.gMax * 1.5 || this.nz < def.limits.gMin * 1.5) {
        this.overG += dt;
        if (this.overG > 0.25) this.crash('Structural failure (over-G)');
      } else if (this.nz > def.limits.gMax * 1.05) {
        this.overG += dt * 0.02;
      }
    }
    if (this.pos.y > 24000) this.vel.y = Math.min(this.vel.y, 0);
  }

  /**
   * F-16 flight control system (FLCS), after the real jet's structure: a G command with an AoA limiter in pitch, a
   * stability-axis roll-rate command in roll, and a sideslip command with turn coordination in yaw — flown here by
   * dynamic inversion: every loop asks for an angular acceleration and the law works out, from the same aerodynamic
   * and inertia terms the flight model uses (including the inertial coupling of rolling while pulling), which
   * stabilator, flaperon and rudder deflection produces it. The relaxed-stability airframe then responds the same way
   * at every speed and weight, and the rudder is solved together with the flaperons, so rolls under G stay coordinated
   * instead of setting off a yaw swing.
   */
  private f16Flcs(dt: number, c: Controls, Vs: number, qbar: number, health: number, an: {
    CLa: number; CLmax: number; aStall: number; stallF: number; superCtrl: number; Cma: number; Cnb: number; Clb: number; Cnp: number;
    advYawDa: number; wingRock: number; pitchBreak: number;
  }) {
    const def = this.def;
    const A = def.aero;
    const L = def.limits;
    const st = this.flcs;
    const eMax = def.controls.elev * DEG, aMax = def.controls.ail * DEG, rMax = def.controls.rud * DEG;
    const S = def.wingArea, b = def.span, cbar = def.chord;
    const att = this.attitude();
    const mS = clamp(this.mass / (def.massEmpty + def.fuelInternal * 0.5), 0.7, 1.6);
    const Ixx = def.inertia[0] * mS, Iyy = def.inertia[1] * mS, Izz = def.inertia[2] * mS;
    const qS = Math.max(qbar * S, 1);
    const p = this.p, q = this.q, r = this.r, alpha = this.alpha, beta = this.beta;
    const absA = Math.abs(alpha);
    // force-stick gradient: fine control near the centre, the full command at the stop
    const shape = (x: number) => Math.sign(x) * (0.45 * Math.abs(x) + 0.55 * x * x);
    const pitchIn = clamp(c.pitch + c.trimPitch * 0.25, -1, 1);
    const rollIn = clamp(c.roll + c.trimRoll * 0.1, -1, 1);
    const yawIn = clamp(c.yaw + c.trimYaw * 0.2, -1, 1);
    const air = !this.wow && Vs > 30;

    if (!air) {
      // on the ground (or barely moving) the FLCS passes the stick straight to the surfaces
      st.n = 1; st.ps = 0; st.rollAuth = 1; st.nzF = 1; this.alphaInt = 0;
      this.elev = approach(this.elev, clamp(pitchIn * eMax, -eMax, eMax) * health, 60 * DEG, dt);
      this.ail = approach(this.ail, clamp(rollIn * aMax, -aMax, aMax) * health, 80 * DEG, dt);
      this.rud = approach(this.rud, clamp(yawIn * rMax, -rMax, rMax) * health, 120 * DEG, dt);
      return;
    }

    // ================= pitch: G command, AoA limiter
    // below corner speed the G per inch of stick is geared down with the speed, so an inch of stick gives about the
    // same pitch rate at 250 kt as at 450 kt (a pure G command doubles the pitch rate per inch as the speed halves, and
    // the pilot ends up chasing the nose); full stick still reaches the AoA limiter
    const kV = Math.min(1, (Vs + 30) / (F16_CORNER + 30));
    const nTarget = pitchIn >= 0 ? 1 + shape(pitchIn) * kV * (0.96 * L.gMax - 1) : 1 + shape(-pitchIn) * kV * (0.96 * L.gMin - 1);
    // stick prefilter (≈0.08 s) and the measured load factor through a light filter, so the law never chases noise
    st.n += (nTarget - st.n) * Math.min(1, dt / 0.08);
    st.nzF += (this.nz - st.nzF) * Math.min(1, dt / 0.03);
    this.nzDot += ((st.nzF - this.nzPrev) / dt - this.nzDot) * Math.min(1, dt * 15);
    this.nzPrev = st.nzF;
    this.alphaDot += ((alpha - this.alphaPrev) / dt - this.alphaDot) * Math.min(1, dt * 20);
    this.alphaPrev = alpha;
    const nCmd = st.n;
    const W = this.mass * G0;
    // the G command becomes an AoA command through the lift curve, rounded top included (the flaps' share
    // subtracted); a load the wing cannot make sends the jet to the AoA limiter
    // the real FLCS limits AoA to ~25°: short of the stall and its pitch-up, where the stabilator can still stop the nose
    const aoaMax = Math.min(L.aoaMax, F16_AOA_LIMIT) * DEG, aoaNeg = (L.aoaNeg ?? 10) * DEG;
    let aCmd = this.aoaForCl((nCmd * W) / qS - A.flapCL * this.flapPos, an.CLa, an.CLmax, aoaMax, aoaNeg);
    // hard G limit with look-ahead on the load-factor rate
    const nzLead = st.nzF + 0.12 * this.nzDot;
    const gOver = nCmd >= 1 ? Math.max(0, nzLead - Math.min(nCmd, L.gMax)) : Math.min(0, nzLead - Math.max(nCmd, L.gMin));
    aCmd -= (0.6 * gOver * W) / qS / an.CLa;
    // integral trims out the steady G error once the load has settled
    const settle = 1 - smoothstep(0.4, 1.5, Math.abs(nCmd - st.nzF));
    this.alphaInt = clamp(this.alphaInt + (nCmd - st.nzF) * 0.03 * settle * dt, -0.08, 0.08);
    aCmd += this.alphaInt;
    const aLim = aoaMax - 0.12 * Math.max(0, this.alphaDot);
    if (aCmd > aLim) { aCmd = aLim; this.alphaInt = Math.min(this.alphaInt, 0); }
    if (aCmd < -aoaNeg) { aCmd = -aoaNeg; this.alphaInt = Math.max(this.alphaInt, 0); }
    // AoA → pitch-rate demand on top of the flight path's own turn rate, → pitch acceleration (critically damped)
    const gamma = Math.asin(clamp(this.vel.y / Vs, -1, 1));
    // (+ the kinematic coupling of rolling with sideslip, which turns β into AoA: α̇ = q − (p·cosα + r·sinα)·tanβ − …)
    const qRef = (G0 / Vs) * (st.nzF - Math.cos(gamma) * Math.cos(att.roll))
      + (p * Math.cos(alpha) + r * Math.sin(alpha)) * Math.tan(beta);
    // response bandwidth scheduled on the stabilator's pitch authority (its full-deflection pitch acceleration): asking
    // a slow, low-q jet for a 5 rad/s response drives the stabilator into its 60°/s rate limit, and the lag of a
    // rate-limited surface turns into a nose that bobs, worst with a pilot chasing it
    const authority = (qS * cbar * A.Cmde * an.superCtrl * eMax) / Iyy;
    const WN = clamp(1.6 * Math.sqrt(authority), 2.8, 5), ZETA = 1.4, QMAX = 0.45;
    const qDem = clamp((WN / (2 * ZETA)) * (aCmd - alpha), -QMAX, QMAX);
    const qdotDes = 2 * ZETA * WN * (qDem - (q - qRef));
    // moment that acceleration needs, less the inertial pitch-up of rolling while yawing, (Izz − Ixx)·p·r
    const cmReq = (Iyy * qdotDes - (Izz - Ixx) * p * r) / (qS * cbar);
    const cmKnown = an.Cma * alpha + A.Cmq * q * cbar / (2 * Vs) - 0.02 * this.brakePos - 0.04 * this.flapPos - an.pitchBreak;
    const de = (cmReq - cmKnown) / (A.Cmde * an.superCtrl);

    // ================= roll and yaw: stability-axis roll rate + sideslip command, solved together
    // roll-rate limit: the jet's 300°/s at speed, less at low dynamic pressure and as the AoA builds
    const pMax = L.rollRate * DEG * (1 - 0.7 * smoothstep(10 * DEG, 30 * DEG, absA)) * clamp(qbar / 6000, 0.25, 1);
    const psTarget = shape(rollIn) * pMax * st.rollAuth;
    st.ps += (psTarget - st.ps) * Math.min(1, dt / 0.06);
    // the pedals command sideslip at low AoA; past ~20° AoA they fade out (the FLCS turns them into roll coordination),
    // and at high dynamic pressure they are geared down to a few degrees, like the real rudder command
    const betaCmd = -yawIn * 10 * DEG * (1 - smoothstep(15 * DEG, 25 * DEG, absA)) * clamp(8000 / Math.max(qbar, 1), 0.2, 1);
    // stability-axis yaw rate that keeps the sideslip at its command: turn coordination (gravity and side force)
    // plus sideslip feedback — β then decays as e^(−Kβ·t) instead of swinging
    const KB = 2.2;
    const rsCmd = (G0 * Math.cos(att.pitch) * Math.sin(att.roll)) / Vs + (qS * A.CYb * beta) / (this.mass * Vs) + KB * (beta - betaCmd);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const pCmd = st.ps * ca - rsCmd * sa;
    const rCmd = st.ps * sa + rsCmd * ca;
    const KP = 10, KR = 4;
    const clReq = (Ixx * KP * (pCmd - p) - (Iyy - Izz) * q * r) / (qS * b);
    const cnReq = (Izz * KR * (rCmd - r) - (Ixx - Iyy) * p * q) / (qS * b);
    const phat = p * b / (2 * Vs), rhat = r * b / (2 * Vs);
    const daEff = A.Clda * an.superCtrl * (1 - 0.5 * an.stallF);
    let da = (clReq - (an.Clb * beta + A.Clp * phat + A.Clr * rhat + an.wingRock)) / daEff;
    da = clamp(da, -aMax, aMax);
    const drEff = A.Cndr * an.superCtrl * (1 - 0.4 * an.stallF);
    let dr = (cnReq - (an.Cnb * beta + A.Cnr * rhat + an.Cnp * phat + an.advYawDa * da)) / drEff;
    // roll–sideslip interconnect: when the rudder runs out of travel to coordinate the roll, the roll command backs off
    // (instead of the jet rolling on with the sideslip building)
    const need = Math.abs(dr) / rMax;
    const authTarget = clamp(1 - 2.5 * (need - 0.75), 0.3, 1) * (1 - 0.7 * smoothstep(4 * DEG, 12 * DEG, Math.abs(beta)));
    st.rollAuth = approach(st.rollAuth, authTarget, authTarget < st.rollAuth ? 4 : 1, dt);

    this.elev = approach(this.elev, clamp(de, -eMax, eMax) * health, 60 * DEG, dt);
    this.ail = approach(this.ail, da * health, 100 * DEG, dt);
    dr = clamp(dr, -rMax, rMax);
    this.rud = approach(this.rud, dr * health, 120 * DEG, dt);
  }

  /** AoA (rad) at which the wing makes lift coefficient `cl` — the inverse of the lift curve in substep(), up to its
   *  peak; past the peak, the AoA limit of that sign. */
  private aoaForCl(cl: number, CLa: number, CLmax: number, aoaMax: number, aoaNeg: number) {
    const CL0 = this.def.aero.CL0;
    const sg = cl >= CL0 ? 1 : -1;
    const clm = CLmax * (sg > 0 ? 1 : 0.75);
    const aLe = (0.75 * clm - CL0 * sg) / CLa, aSt = (1.25 * clm - CL0 * sg) / CLa;
    const lin = (cl - CL0) / CLa;
    if (Math.abs(lin) <= aLe) return lin;
    const f = (Math.abs(cl) - 0.75 * clm) / (0.25 * clm);
    if (f >= 1) return sg > 0 ? aoaMax : -aoaNeg;
    return sg * (aLe + (aSt - aLe) * (1 - Math.sqrt(1 - Math.max(0, f))));
  }

  /** Flight control computer. Sets elev/ail/rud (rad) and tvc. */
  private fcs(dt: number, c: Controls, V: number, Vs: number, qbar: number, CLa: number, aStall: number, health: number) {
    const def = this.def;
    const A = def.aero;
    const L = def.limits;
    const eMax = def.controls.elev * DEG, aMax = def.controls.ail * DEG, rMax = def.controls.rud * DEG;
    const S = def.wingArea, b = def.span, cbar = def.chord;
    const att = this.attitude();
    // stabilator trim: up to half the stick on mechanical/CAS jets (enough to trim out landing flaps); on FBW jets
    // trim is only a small g/AoA bias
    const pitchIn = clamp(c.pitch + c.trimPitch * (def.fcs.type === 'fbw' ? 0.25 : 0.5), -1, 1);
    const rollIn = clamp(c.roll + c.trimRoll * 0.1, -1, 1);
    const yawIn = clamp(c.yaw + c.trimYaw * 0.2, -1, 1);
    let de: number, da: number, dr: number;
    const ctrlRate = 60 * DEG;
    this.alphaDot += ((this.alpha - this.alphaPrev) / dt - this.alphaDot) * Math.min(1, dt * 20);
    this.alphaPrev = this.alpha;
    this.nzDot += ((this.nz - this.nzPrev) / dt - this.nzDot) * Math.min(1, dt * 15);
    this.nzPrev = this.nz;
    const nzLead = this.nz + 0.12 * this.nzDot;

    if (def.fcs.type === 'fbw' && !this.wow && V > 30) {
      // ---- Pitch: G command with AoA limiter (model following + integral)
      // hard AoA limiter at the jet's limit (post-stall AoA is flown on the FCS, not on natural stability)
      const aoaMax = L.aoaMax * DEG, aoaNeg = (L.aoaNeg ?? 10) * DEG;
      // full stick commands 96 % of the limit: the law settles a few percent high, so the jet lands just under it
      const nCmd = pitchIn >= 0 ? 1 + pitchIn * (0.96 * L.gMax - 1) : 1 + -pitchIn * (0.96 * L.gMin - 1);
      const W = this.mass * G0;
      const clReq = (nCmd * W) / Math.max(qbar * S, 1);
      // the flaps' share of the lift is subtracted, so the law doesn't over-command AoA in the landing configuration
      let aCmd = (clReq - A.CL0 - A.flapCL * this.flapPos) / CLa;
      // hard G limit: take back the AoA worth of any (anticipated) load beyond the command
      const gOver = pitchIn >= 0 ? Math.max(0, nzLead - Math.min(nCmd, L.gMax)) : Math.min(0, nzLead - Math.max(nCmd, L.gMin));
      aCmd -= (0.6 * gOver * W) / Math.max(qbar * S, 1) / CLa;
      // the integral only trims out the steady error: while the load is still building it would wind up and overshoot
      const settle = 1 - smoothstep(0.4, 1.5, Math.abs(nCmd - this.nz));
      this.alphaInt = clamp(this.alphaInt + (nCmd - this.nz) * 0.03 * settle * dt, -0.08, 0.08);
      aCmd += this.alphaInt;
      // the limit anticipates the AoA rate so a full-stick pull does not overshoot it
      const aLim = aoaMax - 0.12 * Math.max(0, this.alphaDot);
      if (aCmd > aLim) { aCmd = aLim; this.alphaInt = Math.min(this.alphaInt, 0.0); }
      if (aCmd < -aoaNeg) { aCmd = -aoaNeg; this.alphaInt = Math.max(this.alphaInt, 0); }
      const gamma = Math.asin(clamp(this.vel.y / Vs, -1, 1));
      // the flight path's own turn rate at the present load: q − qRef is then the AoA rate
      const qRef = (G0 / Vs) * (this.nz - Math.cos(gamma) * Math.cos(att.roll));
      const Cma = A.Cma - 0.35 * smoothstep(0.9, 1.3, this.mach);
      // model following by inversion: the law asks for a pitch acceleration (a well-damped second-order AoA response,
      // the same on every jet and at every speed) and converts it into the moment that airframe needs — so a light,
      // short-coupled, relaxed-stability jet like the F-16 isn't over-driven into the stabilator's rate limit
      const Iyy0 = def.inertia[1];
      const IyyP = Iyy0 * clamp(this.mass / (def.massEmpty + def.fuelInternal * 0.5), 0.7, 1.6);
      const kM = Math.max(qbar * S * cbar, 1) / IyyP;      // pitch acceleration per unit Cm
      const WN = 5, ZETA = 1.0;                 // rad/s, damping ratio
      // (cascaded: AoA error → pitch-rate demand, capped so that a big AoA change — letting go at the limiter — can be
      // arrested with the stabilator available instead of overshooting)
      const QMAX = 0.45;
      const qDem = clamp((WN / (2 * ZETA)) * (aCmd - this.alpha), -QMAX, QMAX);
      const qdotDes = 2 * ZETA * WN * (qDem - (this.q - qRef));
      const superCtrl = 1 - 0.35 * smoothstep(0.9, 1.5, this.mach);
      const cmNeeded = qdotDes / kM - Cma * this.alpha - A.Cmq * this.q * cbar / (2 * Vs)
        + 0.08 * smoothstep(aStall * 0.92, aStall * 1.25, Math.abs(this.alpha));
      de = cmNeeded / (A.Cmde * superCtrl);
      if (def.fcs.tvc) {
        const sat = de - clamp(de, -eMax, eMax);
        this.tvc = clamp(sat * 1.5 + (de / eMax) * def.fcs.tvc * DEG * 0.3, -def.fcs.tvc * DEG, def.fcs.tvc * DEG);
      }
      // ---- Roll: rate command
      // roll about the velocity vector: at high AoA the rate is limited to what the rudder can coordinate (r = p·tanα)
      // and the roll-rate limiter tightens with AoA (pitch–roll inertia coupling grows with p·q)
      const absAl = Math.abs(this.alpha);
      const tanA = Math.tan(clamp(absAl, 0, 1.2));
      const pMax = Math.min(L.rollRate * DEG * (1 - 0.65 * smoothstep(8 * DEG, 30 * DEG, absAl)), (50 * DEG) / Math.max(tanA, 0.05))
        * clamp(qbar / 6000, 0.25, 1);
      // roll–sideslip interconnect: if the rudder can't keep up and sideslip builds, the roll command backs off
      const pCmd = rollIn * pMax * (1 - 0.8 * smoothstep(2 * DEG, 10 * DEG, Math.abs(this.beta)));
      const clNeeded = -A.Clp * pCmd * b / (2 * Vs) + 3.0 * (pCmd - this.p) * b / (2 * Vs) - A.Clb * this.beta;
      da = clNeeded / A.Clda;
      // ---- Yaw: sideslip command + turn coordination + damper
      const betaCmd = -yawIn * 8 * DEG;
      const rRef = this.p * Math.tan(clamp(this.alpha, -0.6, 0.9)) + G0 * Math.sin(att.roll) * Math.cos(att.pitch) / Vs;
      // sideslip + yaw-rate feedback (moderate gains: a saturated rudder would ring) plus feed-forward cancelling the
      // inertial yaw moment of rolling while pulling, (Ixx − Iyy)·p·q
      const [Ixx, Iyy] = def.inertia;
      const mS = clamp(this.mass / (def.massEmpty + def.fuelInternal * 0.5), 0.7, 1.6);
      const cnCoupling = ((Ixx - Iyy) * mS * this.p * this.q) / Math.max(qbar * S * b, 1);
      const cnNeeded = -A.Cnb * betaCmd + 0.1 * (this.beta - betaCmd) - 6 * (this.r - rRef) * b / (2 * Vs) - cnCoupling;
      dr = cnNeeded / A.Cndr;
    } else {
      // ---- Digital CAS (F-15, F-14B/D…) or analog stability augmentation (F-14A, F-4): no hard limiter
      this.alphaInt = 0;
      const cas = def.fcs.type === 'cas';
      const sas = cas ? 1 : 0.5;
      const gnd = this.wow || V < 30;
      // soft limiter: approaching the G or AoA limit, the stick's authority in that direction fades — on analog jets to
      // 30 % (a determined pilot can pull through and overstress the jet), on digital CAS jets to nothing by 110 %
      let pitchCmd = pitchIn;
      if (!gnd) {
        // digital CAS looks ahead on the AoA rate; analog jets only "feel" the AoA itself
        const aDeg = (this.alpha + (cas ? 0.35 * this.alphaDot : 0)) / DEG;
        const fade = (x: number) => cas ? 1 - 0.7 * smoothstep(0.82, 1.0, x) - 0.3 * smoothstep(1.0, 1.12, x) : 1 - 0.7 * smoothstep(0.9, 1.0, x);
        const n = cas ? nzLead : this.nz;
        if (pitchCmd > 0) pitchCmd *= Math.min(fade(n / L.gMax), fade(aDeg / L.aoaMax));
        else pitchCmd *= Math.min(fade(n / L.gMin), fade(-aDeg / (L.aoaNeg ?? 10)));
      }
      // pitch ratio changer: less stabilator per inch of stick at high dynamic pressure, so a full-stick pull at
      // speed lands near the G limit instead of far past it
      const gearing = gnd ? 1 : clamp((cas ? 14000 : 22000) / Math.max(qbar, 1), cas ? 0.3 : 0.45, 1);
      de = pitchCmd * eMax * gearing - (gnd ? 0 : sas * (cas ? 4 : 2.5) * this.q * cbar / (2 * Vs) / A.Cmde);
      // digital CAS backs the roll off when sideslip builds (it cannot out-yaw the inertia coupling)
      const rollCmd = cas && !gnd ? rollIn * (1 - 0.6 * smoothstep(3 * DEG, 12 * DEG, Math.abs(this.beta))) : rollIn;
      da = rollCmd * aMax - (gnd ? 0 : sas * 0.4 * this.p * b / (2 * Vs) / A.Clda);
      // yaw damper about the stability axis (p·tanα), so it damps Dutch roll without fighting coordinated rolls
      const tanA = Math.tan(clamp(this.alpha, -0.6, 0.9));
      const rRef = this.p * tanA * (cas ? 1 : 0.5) + G0 * Math.sin(att.roll) * Math.cos(att.pitch) / Vs;
      dr = yawIn * rMax - (gnd ? 0 : sas * 1.5 * (this.r - rRef) * b / (2 * Vs) / A.Cndr);
      if (cas && !gnd) {
        // aileron-rudder interconnect (rudder follows roll commands with AoA) and sideslip feedback
        dr += rollIn * rMax * 0.6 * Math.sin(Math.abs(this.alpha) * 1.5);
        dr += 0.5 * this.beta / A.Cndr * 0.1;
        // feed-forward against the inertial yaw of rolling while pulling, (Ixx − Iyy)·p·q
        const [Ixx, Iyy] = def.inertia;
        const mS = clamp(this.mass / (def.massEmpty + def.fuelInternal * 0.5), 0.7, 1.6);
        dr -= ((Ixx - Iyy) * mS * this.p * this.q) / Math.max(qbar * S * b, 1) / A.Cndr;
      }
      if (def.fcs.tvc) this.tvc = pitchIn * def.fcs.tvc * DEG;
    }
    de = clamp(de, -eMax, eMax) * health;
    da = clamp(da, -aMax, aMax) * health;
    dr = clamp(dr, -rMax, rMax) * health;
    this.elev = approach(this.elev, de, ctrlRate, dt);
    this.ail = approach(this.ail, da, ctrlRate * 1.3, dt);
    this.rud = approach(this.rud, dr, ctrlRate, dt);
  }

  /** Spring-damper gear and airframe ground collision. Returns true if in contact. */
  private groundForces(dt: number, c: Controls, env: FlightEnv, force: THREE.Vector3,
    addMoment: (l: number, m: number, n: number) => void): boolean {
    const def = this.def;
    const g = def.gear;
    const water = env.isWater(this.pos.x, this.pos.z);
    const wheelsDown = this.gearPos > 0.95;
    // static load share so every strut compresses ~0.18 m
    const noseShare = g.main / (g.nose + g.main);
    const kSpring = (this.mass * G0) / (3 * 0.18);
    const kNose = (this.mass * G0 * noseShare) / 0.18;
    const kMain = (this.mass * G0 * (1 - noseShare)) / 2 / 0.18;
    const cDamp = 2 * Math.sqrt(kSpring * this.mass / 3) * 0.8;
    const wWorld = new THREE.Vector3(this.q, -this.r, -this.p).applyQuaternion(this.quat);
    const fwd = this.forward();
    let contact = false;
    const fTot = new THREE.Vector3();
    const torque = new THREE.Vector3();
    // on a moving deck, tyre friction works on the velocity relative to the deck
    const gv = env.groundVelocity?.(this.pos.x, this.pos.z) ?? null;
    const speed = gv ? this.vel.clone().sub(gv).length() : this.vel.length();
    if (wheelsDown && !water) {
      const steer = (speed < 20 ? 55 : 6) * DEG * clamp(c.yaw, -1, 1);
      const pts: Array<[number, number, number, number]> = [
        [0, -g.height, -g.nose, 0],
        [-g.track / 2, -g.height, g.main, 1],
        [g.track / 2, -g.height, g.main, 1],
      ];
      for (const [x, y, z, type] of pts) {
        const rW = new THREE.Vector3(x, y, z).applyQuaternion(this.quat);
        const P = rW.clone().add(this.pos);
        const pen = env.groundHeight(P.x, P.z) - P.y;
        if (pen <= 0) continue;
        contact = true;
        if (type === 1) this.wow = true;
        const vp = new THREE.Vector3().crossVectors(wWorld, rW).add(this.vel);
        if (gv) vp.sub(gv);
        if (-vp.y > 7.5) { this.crash('Landing gear collapse (hard landing)'); return true; }
        const kk = type === 0 ? kNose : kMain;
        let Fn = kk * Math.min(pen, 0.6) - cDamp * (type === 0 ? 0.5 : 1) * vp.y;
        if (Fn < 0) Fn = 0;
        const wf = fwd.clone(); wf.y = 0;
        if (wf.lengthSq() < 1e-6) wf.set(0, 0, -1);
        wf.normalize();
        if (type === 0) wf.applyAxisAngle(UP, -steer);
        const wr = new THREE.Vector3(-wf.z, 0, wf.x);
        const vLong = vp.dot(wf);
        const vLat = vp.dot(wr);
        const mu = 0.02 + (type === 1 ? 0.55 * c.brakes : 0);
        const fLong = -clamp(vLong / 0.4, -1, 1) * mu * Fn;
        const fLat = -clamp(vLat / 0.25, -1, 1) * 0.75 * Fn;
        const Fw = new THREE.Vector3(0, Fn, 0).addScaledVector(wf, fLong).addScaledVector(wr, fLat);
        fTot.add(Fw);
        torque.add(new THREE.Vector3().crossVectors(rW, Fw));
      }
    }
    // airframe points -> crash detection (or belly landing)
    const L2 = def.length / 2, s2 = def.span / 2;
    const frame: Array<[number, number, number]> = [
      [0, -0.6, -L2], [0, 0, L2 * 0.95], [-s2, 0, L2 * 0.3], [s2, 0, L2 * 0.3], [0, -g.height * 0.6, 0],
    ];
    for (let i = 0; i < frame.length; i++) {
      const [x, y, z] = frame[i];
      const rW = new THREE.Vector3(x, y, z).applyQuaternion(this.quat);
      const P = rW.clone().add(this.pos);
      let h = env.groundHeight(P.x, P.z);
      if (env.isWater(P.x, P.z)) h = Math.max(h, 0);
      if (P.y < h) {
        const vp = new THREE.Vector3().crossVectors(wWorld, rW).add(this.vel);
        if (gv) vp.sub(gv);
        if (i === 1 && vp.y > -6 && !water) {
          // tail scrape: hurts, but survivable
          const Fs = new THREE.Vector3(0, kSpring * 2 * Math.min(h - P.y, 0.4) - cDamp * vp.y, 0);
          fTot.add(Fs);
          torque.add(new THREE.Vector3().crossVectors(rW, Fs));
          this.tailScrape = true;
          contact = true;
        } else if (!wheelsDown && speed < 50 && Math.abs(this.vel.y) < 3 && !water) {
          const pen = h - P.y;
          fTot.y += kSpring * 3 * Math.min(pen, 0.5) - cDamp * this.vel.y;
          fTot.addScaledVector(this.vel, -this.mass * 0.5);
          this.damage.engine = 0;
          contact = true;
        } else {
          this.crash(water ? 'Impacted water' : 'Impacted terrain');
          return true;
        }
      }
    }
    if (water && this.pos.y - g.height < 0.3) { this.crash('Ditched in water'); return true; }
    force.add(fTot);
    if (torque.lengthSq() > 0) {
      const tb = torque.applyQuaternion(this.qi);
      // body (x right, y up, z back) -> roll L = -tz, pitch M = tx, yaw N = -ty
      addMoment(-tb.z, tb.x, -tb.y);
    }
    if (contact) { this.p *= 1 - 2 * dt; this.r *= 1 - 1 * dt; }
    return contact;
  }

  crash(reason: string) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.vel.set(0, 0, 0);
    this.p = this.q = this.r = 0;
    this.thrust = 0;
  }
}
