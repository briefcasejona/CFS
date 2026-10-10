import * as THREE from 'three';
import type { WeaponDef } from './stores.js';
import { atmosphere, G0 } from '../sim/atmosphere.js';
import { clamp, DEG } from '../core/math.js';
import { newId, type Aircraft, type GroundUnit, type SamSite, type Target, type Countermeasure } from '../sim/entities.js';
import { surfaceHeight } from '../world/theater.js';
import type { World } from '../sim/world.js';

export type SeekerState = 'datalink' | 'active' | 'tracking' | 'inertial' | 'lost' | 'ballistic';

/**
 * Point-mass missile / bomb with proportional navigation guidance and seeker logic
 * for IR, semi-active radar, active radar, laser, TV/IR (AGM) and anti-radiation seekers.
 */
export class Missile {
  readonly id = newId();
  def: WeaponDef;
  side: 'blue' | 'red';
  launcher: Aircraft | null;
  site: SamSite | null;
  target: Target | null;
  targetPoint: THREE.Vector3 | null;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  mass: number;
  t = 0;
  alive = true;
  seeker: SeekerState = 'tracking';
  estPos = new THREE.Vector3();
  estVel = new THREE.Vector3();
  decoy: Countermeasure | null = null;
  checkedCM = new Set<number>();
  motorOn = false;
  minDist = Infinity;
  loftUntil = 0;
  launchRange = 0;
  private prevPos = new THREE.Vector3();

  constructor(def: WeaponDef, side: 'blue' | 'red', launcher: Aircraft | null, site: SamSite | null,
    target: Target | null, targetPoint: THREE.Vector3 | null, pos: THREE.Vector3, vel: THREE.Vector3) {
    this.def = def;
    this.side = side;
    this.launcher = launcher;
    this.site = site;
    this.target = target;
    this.targetPoint = targetPoint?.clone() ?? null;
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    this.vel.copy(vel);
    this.mass = def.mass;
    const k = def.kind;
    if (k === 'bomb') this.seeker = 'ballistic';
    else if (k === 'arh') this.seeker = 'datalink';
    else this.seeker = target || targetPoint ? 'tracking' : 'lost';
    const tp = target ? target.pos : targetPoint;
    if (tp) {
      this.estPos.copy(tp);
      if (target) this.estVel.copy(target.vel);
      this.launchRange = tp.distanceTo(pos);
      if (def.loft && this.launchRange > 25000) this.loftUntil = clamp(this.launchRange / 6000, 3, 14);
    }
  }

  get isBomb() { return this.def.kind === 'bomb' || this.def.kind === 'lgb'; }
  get guided() { return this.seeker !== 'ballistic' && this.seeker !== 'lost'; }

  step(dt: number, world: World) {
    if (!this.alive) return;
    const def = this.def;
    this.t += dt;
    this.prevPos.copy(this.pos);

    // --- motor
    let thrust = 0;
    const burn = def.burn ?? 0;
    if (def.thrust && this.t < burn) thrust = def.thrust;
    else if (def.sustain && this.t < burn + (def.sustainTime ?? 0)) thrust = def.sustain;
    this.motorOn = thrust > 0;
    if (thrust > 0 && def.propellant) {
      const impulse = (def.thrust ?? 0) * burn + (def.sustain ?? 0) * (def.sustainTime ?? 0);
      this.mass = Math.max(def.mass - def.propellant, this.mass - def.propellant * thrust / impulse * dt);
    }

    // --- seeker / guidance
    this.updateSeeker(dt, world);
    const V = Math.max(this.vel.length(), 1);
    const vhat = this.vel.clone().divideScalar(V);
    const at = atmosphere(this.pos.y);
    const qbar = 0.5 * at.rho * V * V;
    const aCmd = new THREE.Vector3();
    if (this.guided && def.maxG) {
      const R = this.estPos.clone().sub(this.pos);
      const range = R.length();
      if (this.t < this.loftUntil && range > 15000) R.y += range * 0.35; // loft
      const Vrel = this.estVel.clone().sub(this.vel);
      const r2 = Math.max(R.lengthSq(), 1);
      const omega = new THREE.Vector3().crossVectors(R, Vrel).divideScalar(r2);
      aCmd.crossVectors(omega, this.vel).multiplyScalar(def.navGain ?? 4);
      if (this.isBomb) {
        const dir = R.clone().normalize();
        aCmd.addScaledVector(dir.sub(vhat), V * 0.8);
      }
      // gravity compensation (perpendicular to velocity)
      aCmd.add(new THREE.Vector3(0, G0, 0).addScaledVector(vhat, -vhat.y * G0));
      const railFactor = this.launcher ? clamp((this.t - 0.25) / 0.4, 0, 1) : clamp(this.t / 1.0, 0, 1);
      const maxA = def.maxG * G0 * clamp(qbar / 25000, 0.12, 1) * railFactor;
      aCmd.addScaledVector(vhat, -aCmd.dot(vhat));
      if (aCmd.length() > maxA) aCmd.setLength(maxA);
    }
    // --- forces: thrust, drag (incl. induced drag from maneuvering), gravity
    const drag = qbar * def.cda + aCmd.length() * this.mass * 0.08;
    const acc = vhat.clone().multiplyScalar((thrust - drag) / this.mass).add(aCmd);
    acc.y -= G0;
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    this.checkFuze(world);
    if (!this.alive) return;

    const gh = surfaceHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.detonate(world, true);
      return;
    }
    const lifetime = def.lifetime ?? 600;
    const burnTotal = burn + (def.sustainTime ?? 0);
    if (this.t > lifetime || (!this.isBomb && this.t > burnTotal + 2 && V < 140)) {
      this.alive = false;
      if (!this.isBomb) world.addEffect('airburst', this.pos, 3);
    }
  }

  private inGimbal(p: THREE.Vector3, gimbalDeg: number) {
    const los = p.clone().sub(this.pos).normalize();
    const vhat = this.vel.clone().normalize();
    return los.dot(vhat) > Math.cos(gimbalDeg * DEG);
  }

  private updateSeeker(dt: number, world: World) {
    const def = this.def;
    const tgt = this.target;
    if (this.seeker === 'ballistic') return;

    if (this.decoy) {
      if (this.decoy.life > 0) { this.estPos.copy(this.decoy.pos); this.estVel.copy(this.decoy.vel); }
      else { this.seeker = 'lost'; this.decoy = null; }
      return;
    }

    switch (def.kind) {
      case 'ir': {
        if (!tgt || !tgt.alive) { this.seeker = 'lost'; return; }
        const range = tgt.pos.distanceTo(this.pos);
        const ok = this.inGimbal(tgt.pos, def.gimbal ?? 40) && range < (def.seekerRange ?? 10000) * 1.6 * Math.sqrt(tgt.heat());
        if (ok) { this.seeker = 'tracking'; this.estPos.copy(tgt.pos); this.estVel.copy(tgt.vel); }
        else { this.seeker = 'lost'; return; }
        for (const cm of world.countermeasures) {
          if (cm.kind !== 'flare' || this.checkedCM.has(cm.id) || cm.ownerId !== tgt.id) continue;
          this.checkedCM.add(cm.id);
          if (!this.inGimbal(cm.pos, def.gimbal ?? 40)) continue;
          const p = (1 - (def.flareResist ?? 0.5)) * 0.45 / Math.max(0.6, tgt.heat() * 0.6);
          if (Math.random() < p) { this.decoy = cm; return; }
        }
        break;
      }
      case 'sarh': {
        if (!tgt || !tgt.alive) { this.seeker = 'lost'; return; }
        let illuminated = false;
        if (this.launcher) illuminated = this.launcher.active && this.launcher.radar?.stt === tgt;
        else if (this.site) illuminated = this.site.alive && this.site.target === tgt;
        if (illuminated && this.inGimbal(tgt.pos, def.gimbal ?? 60)) {
          this.seeker = 'tracking';
          this.estPos.copy(tgt.pos); this.estVel.copy(tgt.vel);
          this.radarDefeat(dt, world, tgt);
        } else {
          this.seeker = 'inertial';
          this.estPos.addScaledVector(this.estVel, dt);
        }
        break;
      }
      case 'arh': {
        if (!tgt || !tgt.alive) { this.seeker = 'lost'; return; }
        if (this.seeker !== 'active') {
          const r = this.launcher?.radar;
          const dl = this.launcher && this.launcher.active && r && (r.stt === tgt || r.isTracked?.(tgt));
          if (dl) { this.seeker = 'datalink'; this.estPos.copy(tgt.pos); this.estVel.copy(tgt.vel); }
          else { this.seeker = 'inertial'; this.estPos.addScaledVector(this.estVel, dt); }
          if (this.estPos.distanceTo(this.pos) < (def.seekerRange ?? 15000)) this.seeker = 'active';
        }
        if (this.seeker === 'active') {
          const range = tgt.pos.distanceTo(this.pos);
          if (this.inGimbal(tgt.pos, def.gimbal ?? 60) && range < (def.seekerRange ?? 15000) * 1.3 * Math.pow(tgt.rcs() / 5, 0.25) + 3000) {
            this.estPos.copy(tgt.pos); this.estVel.copy(tgt.vel);
            this.radarDefeat(dt, world, tgt);
          } else {
            this.estPos.addScaledVector(this.estVel, dt);
            if (this.estPos.distanceTo(this.pos) < 1500) this.seeker = 'lost';
          }
        }
        break;
      }
      case 'lgb': case 'agm': {
        if (tgt) { this.estPos.copy(tgt.pos); this.estVel.copy(tgt.vel); }
        else if (this.targetPoint) { this.estPos.copy(this.targetPoint); this.estVel.set(0, 0, 0); }
        else this.seeker = 'lost';
        if (def.kind === 'lgb' && !this.inGimbal(this.estPos, 70)) this.seeker = 'lost';
        break;
      }
      case 'arm': {
        const g = tgt as GroundUnit | null;
        if (g && g.alive && g.emitting) { this.estPos.copy(g.pos); this.estVel.set(0, 0, 0); this.seeker = 'tracking'; }
        else if (g) this.seeker = 'inertial';
        else this.seeker = 'lost';
        break;
      }
    }
  }

  /** Chaff and Doppler notch vs radar-guided missiles. */
  private radarDefeat(dt: number, world: World, tgt: Target) {
    const resist = this.def.chaffResist ?? 0.5;
    for (const cm of world.countermeasures) {
      if (cm.kind !== 'chaff' || this.checkedCM.has(cm.id) || cm.ownerId !== tgt.id) continue;
      this.checkedCM.add(cm.id);
      if (Math.random() < (1 - resist) * 0.35) { this.decoy = cm; return; }
    }
    const los = tgt.pos.clone().sub(this.pos).normalize();
    const radial = Math.abs(tgt.vel.dot(los));
    const lookDown = tgt.pos.y < this.pos.y - 200 && tgt.pos.y - surfaceHeight(tgt.pos.x, tgt.pos.z) < 6000;
    if (radial < 30 && lookDown && Math.random() < (1 - resist) * 1.5 * dt) this.seeker = 'lost';
  }

  private checkFuze(world: World) {
    if (this.isBomb || this.def.kind === 'arm' || this.def.kind === 'agm') return;
    if (this.t < 0.6) return;
    const tgt = this.target;
    const fuze = this.def.fuze ?? 10;
    for (const a of world.aircraft) {
      if (!a.alive || a.removed || a.side === this.side) continue;
      if (a !== tgt && a.pos.distanceToSquared(this.pos) > 400 * 400) continue;
      const d = segmentPointDist(this.prevPos, this.pos, a.pos);
      if (a === tgt) {
        if (d < this.minDist) this.minDist = d;
        else if (this.minDist < fuze * 3) { this.detonate(world, false); return; }
      }
      if (d < fuze) { this.detonate(world, false); return; }
    }
  }

  detonate(world: World, ground: boolean) {
    if (!this.alive) return;
    this.alive = false;
    const def = this.def;
    const by = this.launcher;
    if (def.blast) {
      world.addEffect(ground ? 'explosion' : 'airburst', this.pos, Math.max(4, def.blast * 0.4));
      world.blastDamage(this.pos, def.blast, def.warhead, by, def.name);
    } else {
      world.addEffect(ground ? 'explosion' : 'airburst', this.pos, 6);
      // full fragment damage inside half the fuze radius, falling off to zero at the lethal radius
      const fuze = def.fuze ?? 10;
      const lethal = fuze * 2.5;
      const core = fuze * 0.5;
      for (const a of world.aircraft) {
        if (!a.alive || a.side === this.side) continue;
        const d = a.pos.distanceTo(this.pos);
        if (d < lethal) world.damageAircraft(a, def.warhead * 2 * clamp(1 - (d - core) / (lethal - core), 0, 1), by, def.name);
      }
    }
  }
}

export function segmentPointDist(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const l2 = ab.lengthSq();
  if (l2 < 1e-9) return a.distanceTo(p);
  const t = clamp(p.clone().sub(a).dot(ab) / l2, 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
