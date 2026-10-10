import * as THREE from 'three';
import type { FlightModel, Controls } from './flightModel.js';
import { G0 } from './atmosphere.js';
import { clamp, DEG, wrapPi } from '../core/math.js';

/**
 * Inner-loop autopilot that converts "desired load factor + bank angle" into stick inputs.
 * It works for every FCS type because it closes the loop on measured G (and pitch rate),
 * so AI pilots fly the same physics as the player.
 */
export class Autopilot {
  private gInt = 0;
  private spdInt = 0;

  reset() { this.gInt = 0; this.spdInt = 0; }

  /** Pitch stick to obtain load factor nCmd. */
  pitchForG(fm: FlightModel, nCmd: number, dt: number): number {
    const L = fm.def.limits;
    nCmd = clamp(nCmd, L.gMin * 0.9, L.gMax);
    if (fm.def.fcs.type === 'fbw') {
      this.gInt = clamp(this.gInt + (nCmd - fm.nz) * 0.05 * dt, -0.15, 0.15);
      const base = nCmd >= 1 ? (nCmd - 1) / (L.gMax - 1) : -(1 - nCmd) / (1 - L.gMin);
      return clamp(base + this.gInt, -1, 1);
    }
    // Mechanical / CAS jets: replicate a model-following G law and convert to stick (stick ~ elevator).
    const def = fm.def;
    const A = def.aero;
    const V = Math.max(fm.tas, 30);
    const qS = Math.max(fm.qbar * def.wingArea, 1);
    const CLa = fm.clAlphaNow();
    this.alphaDot += ((fm.alpha - this.alphaPrev) / dt - this.alphaDot) * Math.min(1, dt * 15);
    this.alphaPrev = fm.alpha;
    this.gInt = clamp(this.gInt + (nCmd - fm.nz) * 0.03 * dt, -0.06, 0.06);
    const aLim = def.limits.aoaMax * DEG * 0.85;
    const aReq = clamp((nCmd * fm.mass * G0 / qS - A.CL0) / CLa + this.gInt, -10 * DEG, aLim);
    const att = fm.attitude();
    const gamma = Math.asin(clamp(fm.vel.y / V, -1, 1));
    const qRef = (G0 / V) * (Math.min(nCmd, fm.nz + 1) - Math.cos(gamma) * Math.cos(att.roll));
    const cbar = def.chord;
    const cm = -fm.cmAlphaNow() * aReq + 1.2 * (aReq - fm.alpha - 0.3 * this.alphaDot) - 15 * (fm.q - qRef) * cbar / (2 * V);
    const sas = def.fcs.type === 'manual' ? 0.5 : 1;
    const de = cm / (A.Cmde * fm.ctrlEffectNow()) + sas * 2.5 * fm.q * cbar / (2 * V) / A.Cmde;
    return clamp(de / (def.controls.elev * DEG), -1, 1);
  }
  private alphaDot = 0;
  private alphaPrev = 0;

  /** Roll stick to obtain bank angle (rad). */
  rollToBank(fm: FlightModel, bankCmd: number, dt: number): number {
    const att = fm.attitude();
    const err = wrapPi(bankCmd - att.roll);
    const rate = fm.def.limits.rollRate * DEG;
    const pDes = clamp(err * 3, -rate, rate);
    const k = fm.def.fcs.type === 'fbw' ? 1 / rate : 0.6 / rate;
    return clamp(pDes * k + (pDes - fm.p) * 0.25, -1, 1);
  }

  /** Throttle for target true airspeed (m/s). */
  throttleForSpeed(fm: FlightModel, tas: number, dt: number, allowAB = true): number {
    const err = tas - fm.tas;
    this.spdInt = clamp(this.spdInt + err * 0.004 * dt, -0.3, 0.6);
    return clamp(0.55 + err * 0.02 + this.spdInt, 0, allowAB ? 1 : 0.8);
  }

  /** Point the lift vector at a world direction and pull up to maxG. Returns angle off (rad). */
  flyDirection(fm: FlightModel, dir: THREE.Vector3, maxG: number, ctrl: Controls, dt: number) {
    const fwd = fm.forward();
    const d = dir.clone().normalize();
    const angle = Math.acos(clamp(fwd.dot(d), -1, 1));
    const att = fm.attitude();
    const horizRight = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (horizRight.lengthSq() < 1e-6) horizRight.copy(fm.right());
    horizRight.normalize();
    const horizUp = new THREE.Vector3().crossVectors(horizRight, fwd).normalize();
    // required acceleration direction = towards target + gravity compensation
    const perp = d.clone().addScaledVector(fwd, -fwd.dot(d));
    const turnG = Math.min(maxG, 1 + angle * 10);
    const accel = perp.lengthSq() > 1e-8 ? perp.normalize().multiplyScalar(turnG) : new THREE.Vector3();
    accel.y += 1; // cancel gravity
    const bank = Math.atan2(accel.dot(horizRight), accel.dot(horizUp));
    ctrl.roll = this.rollToBank(fm, bank, dt);
    const bankErr = Math.abs(wrapPi(bank - att.roll));
    const nNeeded = accel.length();
    const nCmd = bankErr < 0.35 ? nNeeded : bankErr < 1.0 ? Math.min(nNeeded, 2.5) : 1;
    ctrl.pitch = this.pitchForG(fm, Math.min(nCmd, maxG), dt);
    return angle;
  }

  /** Altitude / heading / speed hold. hdg in rad (clockwise from north). */
  holdAltHdgSpd(fm: FlightModel, alt: number, hdg: number, tas: number, ctrl: Controls, dt: number, maxBank = 60 * DEG) {
    const att = fm.attitude();
    const hErr = wrapPi(hdg - att.hdg);
    const bank = clamp(hErr * 2.5, -maxBank, maxBank);
    ctrl.roll = this.rollToBank(fm, bank, dt);
    const V = Math.max(fm.tas, 50);
    const vsCmd = clamp((alt - fm.pos.y) * 0.08, -V * 0.35, V * 0.35);
    const gammaCmd = Math.asin(clamp(vsCmd / V, -0.6, 0.6));
    const gamma = Math.asin(clamp(fm.vel.y / V, -1, 1));
    const nCmd = Math.cos(gamma) / Math.max(Math.cos(att.roll), 0.35) + (gammaCmd - gamma) * V / G0 * 0.35;
    ctrl.pitch = this.pitchForG(fm, clamp(nCmd, -1, 4), dt);
    ctrl.throttle = this.throttleForSpeed(fm, tas, dt);
    ctrl.yaw = 0;
  }
}
