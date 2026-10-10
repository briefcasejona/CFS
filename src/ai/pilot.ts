import * as THREE from 'three';
import { Autopilot } from '../sim/autopilot.js';
import type { Aircraft, GroundUnit } from '../sim/entities.js';
import type { World } from '../sim/world.js';
import { WEAPONS } from '../weapons/stores.js';
import { clamp, DEG, wrapPi } from '../core/math.js';
import { surfaceHeight, airbaseById } from '../world/theater.js';
import { G0 } from '../sim/atmosphere.js';

export type Skill = 'rookie' | 'regular' | 'veteran' | 'ace';
export type AITask = 'cap' | 'sweep' | 'escort' | 'strike' | 'sead' | 'cas' | 'intercept' | 'patrol' | 'ferry' | 'awacs' | 'tanker';

const SKILL: Record<Skill, { g: number; react: number; shootRange: number; aim: number; cm: number }> = {
  rookie: { g: 0.7, react: 1.6, shootRange: 0.55, aim: 3.0, cm: 0.5 },
  regular: { g: 0.82, react: 1.0, shootRange: 0.65, aim: 2.0, cm: 0.75 },
  veteran: { g: 0.92, react: 0.6, shootRange: 0.75, aim: 1.3, cm: 0.9 },
  ace: { g: 1.0, react: 0.35, shootRange: 0.85, aim: 0.8, cm: 1.0 },
};

type State = 'takeoff' | 'enroute' | 'station' | 'engage' | 'defend' | 'attack' | 'rtb' | 'follow';

/**
 * AI pilot: flies the same flight model as the player through the autopilot inner loops.
 * Decision layer: navigation, BVR (shoot / crank), BFM (lead / lag pursuit, guns),
 * missile defense (beam / notch + countermeasures), ground attack and RTB.
 */
export class AIPilot {
  ac: Aircraft;
  ap = new Autopilot();
  skill: Skill;
  task: AITask;
  state: State = 'enroute';
  waypoints: THREE.Vector3[] = [];
  wpIndex = 0;
  stationPoint: THREE.Vector3 | null = null;
  /** racetrack axis heading (rad) for AWACS / tanker orbits */
  stationHdg = Math.PI / 2;
  private leg = 0;
  target: Aircraft | null = null;
  groundTargets: GroundUnit[] = [];
  groundTarget: GroundUnit | null = null;
  leader: Aircraft | null = null;
  formationOffset = new THREE.Vector3(180, 0, 200); // lateral, up, back
  cruiseAlt = 7000;
  cruiseSpeed = 230;
  commitRange = 70000;
  homeBase = '';
  weaponsFree = true;
  despawnAtHome = true;
  takeoffHdg = 0;
  private decide = 0;
  private lastShot = -99;
  private crankDir = 1;
  private cmTimer = 0;
  private defendTimer = 0;
  private attackPhase = 0;
  private bingo = false;

  constructor(ac: Aircraft, task: AITask, skill: Skill) {
    this.ac = ac;
    this.task = task;
    this.skill = skill;
    ac.ai = this;
    this.crankDir = Math.random() < 0.5 ? -1 : 1;
  }

  get sk() { return SKILL[this.skill]; }

  update(dt: number, world: World) {
    const ac = this.ac;
    const fm = ac.fm;
    if (!ac.alive) return;
    this.decide -= dt;
    this.cmTimer -= dt;
    if (this.decide <= 0) {
      this.decide = this.sk.react * (0.6 + Math.random() * 0.8);
      this.think(world);
    }
    const c = ac.ctrl;
    c.gearDown = fm.wow || (this.state === 'takeoff' && fm.agl < 50);
    c.flaps = this.state === 'takeoff' ? 0.5 : 0;
    c.speedbrake = 0;
    c.brakes = 0;
    ac.gunFiring = false;

    switch (this.state) {
      case 'takeoff': this.flyTakeoff(dt); break;
      case 'enroute': this.flyRoute(dt, world); break;
      case 'station': this.flyStation(dt); break;
      case 'follow': this.flyFollow(dt, world); break;
      case 'engage': this.flyEngage(dt, world); break;
      case 'defend': this.flyDefend(dt, world); break;
      case 'attack': this.flyAttack(dt, world); break;
      case 'rtb': this.flyRtb(dt); break;
    }
    this.groundAvoid(dt);
  }

  // ------------------------------------------------------------------ decisions
  private think(world: World) {
    const ac = this.ac;
    const fm = ac.fm;
    if (this.state === 'takeoff') {
      if (fm.agl > 300) this.state = this.leader ? 'follow' : 'enroute';
      else return;
    }
    if (this.task === 'awacs' || this.task === 'tanker') { this.state = this.wpIndex >= this.waypoints.length ? 'station' : 'enroute'; return; }
    if (!this.bingo && fm.totalFuel < fm.def.fuelInternal * 0.2) this.bingo = true;

    const threats = world.missilesAt(ac);
    const seen = threats.filter((m) => m.pos.distanceTo(ac.pos) < (m.def.kind === 'ir' ? 6000 : 25000)
      && (m.def.kind !== 'arh' || m.seeker === 'active' || ac.rwr.some((r) => r.kind === 'launch')));
    if (seen.length && Math.random() < 0.6 + 0.4 * this.sk.cm) {
      if (this.state !== 'defend') this.defendTimer = 0;
      this.state = 'defend';
      return;
    }
    if (this.state === 'defend') {
      this.defendTimer += this.sk.react;
      if (this.defendTimer > 3) this.state = this.target?.active ? 'engage' : 'enroute';
      return;
    }
    if (this.bingo) { this.state = 'rtb'; return; }

    const isA2A = ['cap', 'sweep', 'escort', 'intercept', 'patrol'].includes(this.task);
    const commit = isA2A ? this.commitRange : 12000;
    let best: Aircraft | null = null, bd = Infinity;
    for (const e of world.enemiesOf(ac.side)) {
      const d = e.pos.distanceTo(ac.pos);
      if (d < commit && d < bd) { bd = d; best = e; }
    }
    const hasAAWeapons = ac.weaponList().some((w) => (w === 'gun' ? ac.gunRounds > 0 : ['ir', 'sarh', 'arh'].includes(WEAPONS[w].kind)));
    if (best && hasAAWeapons && this.weaponsFree) {
      this.target = best;
      this.state = 'engage';
      return;
    }
    if (this.state === 'engage') this.target = null;

    if (['strike', 'sead', 'cas'].includes(this.task)) {
      const hasAG = ac.weaponList().some((w) => (w === 'gun' ? this.task === 'cas' && ac.gunRounds > 0 : ['bomb', 'lgb', 'agm', 'arm'].includes(WEAPONS[w].kind)));
      const live = this.groundTargets.filter((g) => g.alive);
      if (hasAG && live.length) {
        if (live[0].pos.distanceTo(ac.pos) < 40000 || this.state === 'attack') { this.state = 'attack'; return; }
      } else { this.state = 'rtb'; return; }
    }
    if (this.leader && this.leader.active) { this.state = 'follow'; return; }
    if (this.wpIndex >= this.waypoints.length) this.state = this.stationPoint ? 'station' : 'rtb';
    else this.state = 'enroute';
  }

  // ------------------------------------------------------------------ behaviours
  private flyTakeoff(dt: number) {
    const ac = this.ac, fm = ac.fm, c = ac.ctrl;
    c.throttle = 1;
    c.flaps = 0.5;
    if (fm.wow) {
      c.pitch = fm.ias > fm.def.rotateKts * 0.5144 ? (fm.attitude().pitch < 0.15 ? 0.5 : 0.05) : 0;
      c.roll = 0;
      c.yaw = clamp(wrapPi(this.takeoffHdg - fm.attitude().hdg) * 3, -1, 1);
    } else {
      this.ap.holdAltHdgSpd(fm, fm.pos.y + 300, this.takeoffHdg, 170, c, dt, 10 * DEG);
      c.throttle = 1;
    }
  }

  private flyRoute(dt: number, world: World) {
    const ac = this.ac, fm = ac.fm;
    const wp = this.waypoints[this.wpIndex];
    if (!wp) { this.flyStation(dt); return; }
    const d = new THREE.Vector3(wp.x - ac.pos.x, 0, wp.z - ac.pos.z);
    if (d.length() < 3000) { this.wpIndex++; return; }
    const hdg = Math.atan2(d.x, -d.z);
    this.ap.holdAltHdgSpd(fm, Math.max(wp.y, surfaceHeight(ac.pos.x, ac.pos.z) + 600), hdg, this.cruiseSpeed, ac.ctrl, dt);
    void world;
  }

  private flyStation(dt: number) {
    const ac = this.ac, fm = ac.fm;
    if (this.task === 'awacs' || this.task === 'tanker') { this.flyRacetrack(dt); return; }
    const sp = this.stationPoint ?? ac.pos.clone();
    const d = new THREE.Vector3(sp.x - ac.pos.x, 0, sp.z - ac.pos.z);
    let hdg = Math.atan2(d.x, -d.z);
    if (d.length() < 20000) hdg += 75 * DEG; // orbit
    this.ap.holdAltHdgSpd(fm, Math.max(this.cruiseAlt, surfaceHeight(ac.pos.x, ac.pos.z) + 800), hdg, this.cruiseSpeed * 0.9, ac.ctrl, dt, 35 * DEG);
  }

  /** Racetrack: two 50 km legs, 12 km apart, gentle 20° bank turns — steady enough to tank behind. */
  private flyRacetrack(dt: number) {
    const ac = this.ac, fm = ac.fm;
    const sp = this.stationPoint ?? ac.pos.clone();
    const H = this.stationHdg, LEG = 25000, W = 24000;
    const f = { x: Math.sin(H), z: -Math.cos(H) }, r = { x: Math.cos(H), z: Math.sin(H) };
    const rx = ac.pos.x - sp.x, rz = ac.pos.z - sp.z;
    const along = rx * f.x + rz * f.z;
    if (this.leg === 0 && along > LEG) this.leg = 1;
    else if (this.leg === 1 && along < -LEG) this.leg = 0;
    // cross-track error to the active leg's line (positive = right of track)
    const cross = this.leg === 0 ? rx * r.x + rz * r.z : -((rx - r.x * W) * r.x + (rz - r.z * W) * r.z);
    const hdg = (this.leg === 0 ? H : H + Math.PI) - clamp(cross / 6000, -0.6, 0.6);
    this.ap.holdAltHdgSpd(fm, Math.max(this.cruiseAlt, surfaceHeight(ac.pos.x, ac.pos.z) + 800), hdg, this.cruiseSpeed, ac.ctrl, dt, 20 * DEG);
  }

  private flyFollow(dt: number, world: World) {
    const ac = this.ac, fm = ac.fm;
    const L = this.leader;
    if (!L || !L.active) { this.leader = null; this.state = 'enroute'; this.flyRoute(dt, world); return; }
    const lf = L.fm.forward(); lf.y = 0;
    if (lf.lengthSq() < 1e-6) lf.set(0, 0, -1);
    lf.normalize();
    const lr = new THREE.Vector3(-lf.z, 0, lf.x);
    const slot = Math.max(1, ac.wingIndex);
    const sideSign = slot % 2 === 1 ? 1 : -1;
    const rank = Math.ceil(slot / 2);
    const spot = L.pos.clone()
      .addScaledVector(lr, this.formationOffset.x * sideSign * rank)
      .addScaledVector(lf, -this.formationOffset.z * rank);
    spot.y = L.pos.y + this.formationOffset.y;
    const to = spot.clone().sub(ac.pos);
    const dist = to.length();
    const ahead = to.dot(lf);
    const dir = spot.clone().addScaledVector(L.vel, 4).sub(ac.pos);
    if (dist > 6000) {
      this.ap.flyDirection(fm, dir, 4, ac.ctrl, dt);
      ac.ctrl.throttle = 1;
    } else {
      const hdg = Math.atan2(dir.x, -dir.z);
      this.ap.holdAltHdgSpd(fm, spot.y, hdg, Math.max(120, L.fm.tas + clamp(ahead * 0.05, -40, 60)), ac.ctrl, dt, 50 * DEG);
    }
  }

  private flyEngage(dt: number, world: World) {
    const ac = this.ac, fm = ac.fm, c = ac.ctrl;
    const t = this.target;
    if (!t || !t.active) { this.target = null; this.state = 'enroute'; this.flyRoute(dt, world); return; }
    const toT = t.pos.clone().sub(ac.pos);
    const range = toT.length();
    const los = toT.clone().normalize();
    const fwd = fm.forward();
    const ata = Math.acos(clamp(fwd.dot(los), -1, 1));
    const radar = ac.radar;
    const maxG = fm.def.limits.gMax * this.sk.g;
    const list = ac.weaponList();
    const ir = list.find((w) => w !== 'gun' && WEAPONS[w].kind === 'ir');
    const rad = list.find((w) => w !== 'gun' && (WEAPONS[w].kind === 'arh' || WEAPONS[w].kind === 'sarh'));
    const now = world.time;
    const myMissiles = world.missiles.filter((m) => m.launcher === ac && m.target === t && m.alive);

    if (radar) {
      if (radar.mode === 'OFF') radar.setMode('RWS');
      if (radar.stt !== t && range < radar.def.range * 0.9 && (rad || range < 20000)) radar.lock(t);
    }

    // ---- BVR
    if (rad && range > 9000) {
      const w = WEAPONS[rad];
      const closing = -t.vel.clone().sub(ac.vel).dot(los);
      const altF = clamp(0.6 + ac.pos.y / 20000, 0.6, 1.3);
      const rmax = w.rangeKm * 1000 * this.sk.shootRange * altF * clamp(0.5 + closing / 600, 0.45, 1.1);
      const canShoot = radar?.stt === t && ata < 25 * DEG && now - this.lastShot > 6 && myMissiles.length === 0;
      if (canShoot && range < rmax) {
        ac.selWeapon = rad;
        if (world.fireSelected(ac).startsWith('FOX')) this.lastShot = now;
      }
      if (myMissiles.length) {
        // crank: hold the target ~50 deg off the nose to support the shot while slowing closure
        const crank = los.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.crankDir * 50 * DEG);
        crank.y = clamp(los.y, -0.15, 0.1);
        this.ap.flyDirection(fm, crank, 4, c, dt);
        c.throttle = this.ap.throttleForSpeed(fm, 260, dt);
        return;
      }
      const dir = los.clone(); dir.y += 0.05;
      this.ap.flyDirection(fm, dir, 5, c, dt);
      c.throttle = this.ap.throttleForSpeed(fm, 300, dt);
      return;
    }

    // ---- WVR / BFM
    const gunMode = range < 1500 && !!ac.def.gun && ac.gunRounds > 0;
    let aim: THREE.Vector3;
    if (gunMode) {
      // bullets leave at own velocity + muzzle velocity, so lead with the *relative* velocity
      const tof = range / ((ac.def.gun?.muzzleVel ?? 1000) * 0.92);
      aim = t.pos.clone().addScaledVector(t.vel.clone().sub(ac.vel), tof).add(new THREE.Vector3(0, 0.5 * G0 * tof * tof, 0));
      // the gun line sits ~1.5 deg above the nose: point the nose that much below the solution
      aim.addScaledVector(fm.up(), -aim.distanceTo(ac.pos) * 0.026);
    } else if (range > 3000) {
      aim = t.pos.clone().addScaledVector(t.vel, 1.0);
    } else {
      aim = t.pos.clone().addScaledVector(t.vel, -0.5);
    }
    const off = this.ap.flyDirection(fm, aim.sub(ac.pos), maxG, c, dt);
    // energy / closure management: chase hard when behind and not closing, don't overshoot when close
    const corner = 230;
    const closure = -t.vel.clone().sub(ac.vel).dot(los);
    if (off > 30 * DEG) {
      c.throttle = fm.tas < corner ? 1 : fm.tas > corner + 60 ? 0.75 : 0.95; // turning fight: hold corner speed
      if (fm.tas > corner + 80) c.speedbrake = 1;
    } else if (range > 1200 && closure < 60) {
      c.throttle = 1; // tail chase: full afterburner to close
    } else if (range < 900 && closure > 40) {
      c.throttle = 0.5; // about to overshoot
      if (closure > 100) c.speedbrake = 1;
    } else {
      c.throttle = 0.85;
    }

    if (ir && range < WEAPONS[ir].rangeKm * 1000 * 0.45 && range > 700 && now - this.lastShot > 4) {
      ac.selWeapon = ir;
      if (ac.irLock === t && world.fireSelected(ac).startsWith('FOX')) this.lastShot = now;
    }
    if (gunMode && range < 1000) {
      ac.selWeapon = 'gun';
      ac.gunFiring = off < (this.sk.aim * 1.5 + 1.0) * DEG;
    }
  }

  private flyDefend(dt: number, world: World) {
    const ac = this.ac, fm = ac.fm, c = ac.ctrl;
    const threats = world.missilesAt(ac);
    if (!threats.length) {
      this.defendTimer += dt;
      if (this.defendTimer > 2) this.state = this.target?.active ? 'engage' : 'enroute';
      this.flyRoute(dt, world);
      return;
    }
    const m = threats.reduce((a, b) => (a.pos.distanceTo(ac.pos) < b.pos.distanceTo(ac.pos) ? a : b));
    const toM = m.pos.clone().sub(ac.pos);
    const dist = toM.length();
    const losH = toM.clone(); losH.y = 0;
    if (losH.lengthSq() < 1e-6) losH.set(0, 0, -1);
    losH.normalize();
    const right = new THREE.Vector3(-losH.z, 0, losH.x);
    const beam = right.dot(fm.forward()) >= 0 ? right : right.negate();
    let dir: THREE.Vector3;
    if (dist < 3500) {
      dir = beam.clone().addScaledVector(losH, 0.6);
      dir.y = -0.2;
      this.ap.flyDirection(fm, dir, fm.def.limits.gMax * this.sk.g, c, dt);
    } else {
      dir = beam.clone();
      dir.y = fm.agl > 1500 ? -0.35 : 0;
      this.ap.flyDirection(fm, dir, 5, c, dt);
    }
    c.throttle = m.def.kind === 'ir' ? 0.75 : 1;
    if (this.cmTimer <= 0 && Math.random() < this.sk.cm) {
      this.cmTimer = 0.6;
      const k = m.def.kind === 'ir' ? 'flare' : 'chaff';
      world.dropCountermeasure(ac, k);
      if (dist < 4000) world.dropCountermeasure(ac, k);
    }
  }

  private flyAttack(dt: number, world: World) {
    const ac = this.ac, fm = ac.fm, c = ac.ctrl;
    const live = this.groundTargets.filter((g) => g.alive);
    if (!live.length) { this.state = 'rtb'; return; }
    const list = ac.weaponList();
    const arm = list.find((w) => w !== 'gun' && WEAPONS[w].kind === 'arm');
    const agm = list.find((w) => w !== 'gun' && WEAPONS[w].kind === 'agm');
    const lgb = list.find((w) => w !== 'gun' && WEAPONS[w].kind === 'lgb');
    const bomb = list.find((w) => w !== 'gun' && WEAPONS[w].kind === 'bomb');
    let tgt = this.groundTarget && this.groundTarget.alive ? this.groundTarget : null;
    if (!tgt) {
      const emit = live.filter((g) => g.emitting);
      const pool = arm && emit.length ? emit : live;
      tgt = pool.reduce((a, b) => (a.pos.distanceTo(ac.pos) < b.pos.distanceTo(ac.pos) ? a : b));
      this.groundTarget = tgt;
    }
    const to = tgt.pos.clone().sub(ac.pos);
    const horiz = Math.hypot(to.x, to.z);
    const hdg = Math.atan2(to.x, -to.z);
    const now = world.time;
    const terrain = surfaceHeight(ac.pos.x, ac.pos.z);
    if (arm && tgt.emitting) {
      this.ap.holdAltHdgSpd(fm, Math.max(terrain + 3000, 6000), hdg, 260, c, dt);
      if (horiz < WEAPONS[arm].rangeKm * 700 && now - this.lastShot > 5) {
        ac.selWeapon = arm;
        if (world.fireSelected(ac) === 'MAGNUM') { this.lastShot = now; this.groundTarget = null; }
      }
      return;
    }
    if (agm) {
      if (horiz < 18000) this.ap.flyDirection(fm, to.clone().normalize(), 3, c, dt);
      else this.ap.holdAltHdgSpd(fm, Math.max(terrain + 2500, 3000), hdg, 230, c, dt);
      c.throttle = this.ap.throttleForSpeed(fm, 230, dt);
      if (horiz < 12000 && now - this.lastShot > 4) {
        ac.selWeapon = agm;
        world.designateGround(ac, 6, 14000);
        if (ac.agTarget && world.fireSelected(ac) === 'RIFLE') { this.lastShot = now; this.groundTarget = null; }
      }
      return;
    }
    if (lgb) {
      this.ap.holdAltHdgSpd(fm, Math.max(terrain + 4500, 6000), hdg, 240, c, dt);
      const pred = world.predictImpact(ac, WEAPONS[lgb]);
      if (pred && now - this.lastShot > 3 && pred.point.distanceTo(tgt.pos) < 2500 && horiz < 9000) {
        ac.selWeapon = lgb;
        ac.agTarget = tgt;
        if (world.fireSelected(ac) === 'PICKLE') this.lastShot = now;
      }
      return;
    }
    if (bomb) {
      if (this.attackPhase === 0) {
        this.ap.holdAltHdgSpd(fm, Math.max(terrain + 2500, 3000), hdg, 250, c, dt);
        if (horiz < 5500) this.attackPhase = 1;
      } else {
        this.ap.flyDirection(fm, to.clone().normalize(), 4, c, dt);
        c.throttle = this.ap.throttleForSpeed(fm, 250, dt);
        const pred = world.predictImpact(ac, WEAPONS[bomb]);
        if (pred && pred.point.distanceTo(tgt.pos) < 40 + this.sk.aim * 20 && now - this.lastShot > 0.25) {
          ac.selWeapon = bomb;
          if (world.fireSelected(ac) === 'PICKLE') this.lastShot = now;
        }
        if (fm.agl < 800 || horiz < 300 || to.clone().normalize().dot(fm.forward()) < 0.5) { this.attackPhase = 0; this.groundTarget = null; }
      }
      return;
    }
    if (ac.def.gun && ac.gunRounds > 0) {
      if (horiz > 5000) this.ap.holdAltHdgSpd(fm, terrain + 1200, hdg, 220, c, dt);
      else {
        const off = this.ap.flyDirection(fm, to, 4, c, dt);
        ac.gunFiring = off < 2 * DEG && to.length() < 2000;
      }
      return;
    }
    this.state = 'rtb';
  }

  private flyRtb(dt: number) {
    const ac = this.ac, fm = ac.fm;
    const base = this.homeBase ? airbaseById(this.homeBase) : null;
    if (!base) { this.flyStation(dt); return; }
    const d = new THREE.Vector3(base.x - ac.pos.x, 0, base.z - ac.pos.z);
    if (d.length() < 6000 && this.despawnAtHome) { ac.removed = true; ac.landed = true; return; }
    this.ap.holdAltHdgSpd(fm, Math.max(base.elev + 3000, surfaceHeight(ac.pos.x, ac.pos.z) + 1000), Math.atan2(d.x, -d.z), 220, ac.ctrl, dt);
  }

  /** Terrain avoidance override: predicted flight path below safety height -> roll level and pull. */
  private groundAvoid(dt: number) {
    const ac = this.ac, fm = ac.fm;
    if (fm.wow || this.state === 'takeoff') return;
    const p = ac.pos.clone().addScaledVector(ac.vel, 6);
    const h = Math.max(surfaceHeight(p.x, p.z), surfaceHeight(ac.pos.x, ac.pos.z));
    const minAgl = this.state === 'attack' ? 200 : 350;
    if (p.y < h + minAgl || fm.agl < minAgl * 0.6) {
      const c = ac.ctrl;
      c.roll = this.ap.rollToBank(fm, 0, dt);
      const att = fm.attitude();
      c.pitch = this.ap.pitchForG(fm, Math.abs(att.roll) < 60 * DEG ? fm.def.limits.gMax * 0.7 : 1, dt);
      c.throttle = 1;
      ac.gunFiring = false;
    }
  }

  startTakeoff(hdgRad: number) {
    this.state = 'takeoff';
    this.takeoffHdg = hdgRad;
  }
}
