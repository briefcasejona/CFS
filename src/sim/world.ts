import { Datalink } from '../avionics/datalink.js';
import { Refueling } from './refuel.js';
import * as THREE from 'three';
import { Aircraft, GroundUnit, SamSite, newId, rwrSymbol, type Countermeasure, type RwrContact, type Target } from './entities.js';
import type { FlightEnv, FMOptions } from './flightModel.js';
import { Missile } from '../weapons/missile.js';
import { Bullets } from '../weapons/gun.js';
import { WEAPONS, type WeaponDef } from '../weapons/stores.js';
import { Radar, paintRwr } from '../avionics/radar.js';
import { isWater, lineOfSight, surfaceHeight, terrainHeight, AIRBASES } from '../world/theater.js';
import { clamp, DEG } from '../core/math.js';
import { G0 } from './atmosphere.js';

export type EffectType = 'explosion' | 'airburst' | 'hit' | 'dust' | 'fireball' | 'launch';
export interface Effect { type: EffectType; pos: THREE.Vector3; size: number }
export interface RadioMsg { text: string; time: number; color: string }
export interface KillEvent {
  time: number;
  killer: string; killerSide: 'blue' | 'red' | ''; killerIsPlayer: boolean; killerId: number;
  victim: string; victimType: string; victimSide: 'blue' | 'red'; victimIsPlayer: boolean; victimId: number;
  weapon: string; ground: boolean; objectiveId: string; squadronId: string;
}

export interface WorldOptions {
  unlimitedFuel: boolean;
  unlimitedWeapons: boolean;
  invulnerable: boolean;
  gEffects: boolean;
  abDetent: number;
}

export class World {
  time = 0;
  aircraft: Aircraft[] = [];
  ground: GroundUnit[] = [];
  sites: SamSite[] = [];
  missiles: Missile[] = [];
  countermeasures: Countermeasure[] = [];
  bullets = new Bullets();
  effects: Effect[] = [];
  messages: RadioMsg[] = [];
  kills: KillEvent[] = [];
  rwrRaw = new Map<number, Map<number, { c: RwrContact; t: number }>>();
  chaffSeen = new Set<number>();
  player: Aircraft | null = null;
  wind = new THREE.Vector3();
  opts: WorldOptions = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
  env: FlightEnv;
  lastLaunched: Missile | null = null;
  /** coalition air pictures (Link 16) */
  datalink = new Datalink();
  /** multiplayer role: the host simulates everything; clients only fly their own jet */
  netRole: 'none' | 'host' | 'client' = 'none';
  /** player air-to-air refuelling state */
  refuel = new Refueling();
  private rwrTimer = 0;
  private aiRadarTimer = 0;

  constructor() {
    const self = this;
    this.env = {
      groundHeight: (x, z) => terrainHeight(x, z),
      isWater: (x, z) => isWater(x, z),
      get wind() { return self.wind; },
    };
  }

  addAircraft(ac: Aircraft) {
    if (ac.def.radar && !ac.radar) ac.radar = new Radar(ac, ac.def.radar);
    this.aircraft.push(ac);
    return ac;
  }
  addGround(g: GroundUnit) { this.ground.push(g); return g; }
  addSite(s: SamSite) { this.sites.push(s); return s; }

  addEffect(type: EffectType, pos: THREE.Vector3, size: number) {
    if (this.effects.length < 400) this.effects.push({ type, pos: pos.clone(), size });
  }
  radio(text: string, color = '#9f9') {
    this.messages.push({ text, time: this.time, color });
    if (this.messages.length > 30) this.messages.shift();
  }

  fmOpts(ac: Aircraft): FMOptions {
    return {
      unlimitedFuel: ac.isPlayer && this.opts.unlimitedFuel,
      invulnerable: ac.isPlayer && this.opts.invulnerable,
      abDetent: this.opts.abDetent,
    };
  }

  // ------------------------------------------------------------------ main step
  step(dt: number) {
    this.time += dt;
    this.aiRadarTimer -= dt;
    const aiTick = this.aiRadarTimer <= 0;
    if (aiTick) this.aiRadarTimer = 0.25;
    for (const ac of this.aircraft) {
      if (ac.removed) continue;
      // multiplayer: ghosts (client side) and proxies (host side) are positioned from the network, not simulated
      const local = !ac.netGhost && !ac.netProxy;
      if (ac.ai && ac.alive && local) ac.ai.update(dt, this);
      if (local) {
        const wasCrashed = ac.fm.crashed;
        ac.fm.step(dt, ac.ctrl, this.env, this.fmOpts(ac));
        if (ac.fm.crashed && !wasCrashed) this.onCrash(ac);
      }
      if (ac.radar && ac.alive && local) {
        if (ac.isPlayer) ac.radar.update(dt, this);
        else if (aiTick) ac.radar.update(0.25, this);
      }
      if (ac.alive && !ac.fm.crashed && !ac.netGhost) {
        this.updateGun(ac, dt);
        if (ac.isPlayer || aiTick) this.updateSeekers(ac);
        if (ac.isPlayer) this.updateGEffects(ac, dt);
      }
      if (!ac.fm.wow) ac.everAirborne = true;
      if (ac.isPlayer) ac.landed = ac.everAirborne && ac.alive && !ac.fm.crashed && ac.fm.wow && ac.fm.tas < 2 && this.onRunway(ac);
    }
    for (const m of this.netRole === 'client' ? [] : this.missiles) {
      m.step(dt, this);
      if (m.alive && m.target && m.target.kind === 'aircraft') {
        const t = m.target;
        if (m.def.kind === 'arh' && m.seeker === 'active') paintRwr(t, this, m.id, 'missile', m.pos, 'M');
        else if ((m.def.kind === 'sarh' || m.def.kind === 'arh') && m.guided) {
          if (m.launcher) paintRwr(t, this, m.launcher.id, 'launch', m.launcher.pos, rwrSymbol(m.launcher.def));
          else if (m.site) paintRwr(t, this, m.site.radar.id, 'launch', m.site.radar.pos, m.site.params.symbol);
        }
      }
    }
    this.datalink.update(dt, this.time, this.aircraft);
    if (this.player && !this.player.removed) {
      const msg = this.refuel.step(dt, this.player, this.aircraft);
      if (msg && this.refuel.status.tanker) this.radio(`${this.refuel.status.tanker.callsign}: ${msg}`, "#9fd8ff");
    }
    if (this.netRole !== 'client') this.missiles = this.missiles.filter((m) => m.alive);
    this.bullets.step(dt, this);
    for (const cm of this.countermeasures) {
      cm.life -= dt;
      const drag = cm.kind === 'chaff' ? 2.5 : 0.8;
      cm.vel.multiplyScalar(1 - drag * dt);
      cm.vel.y -= (cm.kind === 'chaff' ? 1 : G0 * 0.6) * dt;
      cm.pos.addScaledVector(cm.vel, dt);
    }
    this.countermeasures = this.countermeasures.filter((c) => c.life > 0);
    if (this.netRole !== 'client') {
      this.stepGround(dt);
      this.stepSams(dt);
    }
    this.rwrTimer -= dt;
    if (this.rwrTimer <= 0) { this.rwrTimer = 0.1; this.compileRwr(); }
    if (this.chaffSeen.size > 20000) this.chaffSeen.clear();
  }

  private compileRwr() {
    for (const ac of this.aircraft) {
      const m = this.rwrRaw.get(ac.id);
      if (!m) { ac.rwr = []; continue; }
      const list: RwrContact[] = [];
      for (const [id, e] of m) {
        const maxAge = e.c.kind === 'search' ? 3 : 1.0;
        if (this.time - e.t > maxAge) { m.delete(id); continue; }
        list.push(e.c);
      }
      ac.rwr = list.sort((a, b) => b.priority - a.priority);
    }
  }

  onRunway(ac: Aircraft) {
    for (const ab of AIRBASES) {
      if (Math.hypot(ac.pos.x - ab.x, ac.pos.z - ab.z) < ab.length / 2 + 800) return true;
    }
    return false;
  }

  private onCrash(ac: Aircraft) {
    this.addEffect('fireball', ac.pos, 25);
    const wasAlive = ac.alive;
    ac.destroy();
    if (wasAlive) this.recordAircraftKill(ac, ac.fm.crashReason);
    if (ac.isPlayer) this.radio(`${ac.callsign}: ${ac.fm.crashReason}`, '#f88');
  }

  private recordAircraftKill(victim: Aircraft, cause: string) {
    const by = victim.lastHitBy;
    const site = !by && victim.lastHitWeapon ? victim.lastHitWeapon : '';
    if (by && by.side !== victim.side) {
      by.kills++;
      this.radio(`${by.callsign}: Splash one! ${victim.def.name} down (${victim.lastHitWeapon}).`, by.side === 'blue' ? '#9cf' : '#f99');
    } else if (site) {
      this.radio(`${victim.callsign} (${victim.def.name}) shot down by ${site}.`, victim.side === 'blue' ? '#f99' : '#9cf');
    } else if (!victim.isPlayer) {
      this.radio(`${victim.callsign} (${victim.def.name}) crashed — ${cause}.`, '#ccc');
    }
    this.kills.push({
      time: this.time,
      killer: by ? by.callsign : site || cause, killerSide: by ? by.side : site ? (victim.side === 'blue' ? 'red' : 'blue') : '',
      killerIsPlayer: !!by?.isPlayer, killerId: by?.id ?? 0,
      victim: victim.callsign, victimType: victim.def.name, victimSide: victim.side, victimIsPlayer: victim.isPlayer, victimId: victim.id,
      weapon: by ? victim.lastHitWeapon : cause, ground: false, objectiveId: '', squadronId: victim.squadronId,
    });
  }

  damageAircraft(a: Aircraft, dmg: number, by: Aircraft | null, weapon: string) {
    if (!a.alive || this.netRole === 'client') return; // the host decides hits in multiplayer
    const inv = a.isPlayer && this.opts.invulnerable;
    if (!by) a.lastHitWeapon = weapon;
    a.damage(dmg, by, weapon, inv);
    if (a.isPlayer && !inv && dmg > 3) this.radio(`${a.callsign}: I'm hit! (${Math.max(0, Math.round(a.health))}%)`, '#fa6');
    if (!a.alive) {
      this.addEffect('fireball', a.pos, 12);
      this.recordAircraftKill(a, 'shot down');
    }
  }

  damageGround(g: GroundUnit, dmg: number, by: Aircraft | null) {
    if (!g.alive || this.netRole === 'client') return;
    g.damage(dmg, by);
    if (!g.alive) {
      this.addEffect('explosion', g.pos, g.radius * 1.5);
      if (by) by.groundKills++;
      this.kills.push({
        time: this.time, killer: by?.callsign ?? '', killerSide: by?.side ?? '', killerIsPlayer: !!by?.isPlayer, killerId: by?.id ?? 0,
        victim: g.name, victimType: g.type, victimSide: g.side, victimIsPlayer: false, victimId: g.id,
        weapon: '', ground: true, objectiveId: g.objectiveId, squadronId: '',
      });
      if (by?.isPlayer) this.radio(`${by.callsign}: Target destroyed — ${g.name}.`, '#9cf');
    }
  }

  blastDamage(pos: THREE.Vector3, radius: number, warhead: number, by: Aircraft | null, weapon: string) {
    for (const g of this.ground) {
      if (!g.alive) continue;
      const d = g.pos.distanceTo(pos) - g.radius * 0.5;
      if (d < radius) this.damageGround(g, warhead * Math.pow(1 - Math.max(0, d) / radius, 1.5), by);
    }
    for (const a of this.aircraft) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(pos);
      if (d < radius * 0.6) this.damageAircraft(a, warhead * 0.5 * (1 - d / (radius * 0.6)), by, weapon);
    }
  }

  // ------------------------------------------------------------------ weapons
  stationOffset(ac: Aircraft, station: number) {
    const n = Math.max(ac.stores.length, 1);
    const side = station % 2 === 0 ? -1 : 1;
    const along = Math.floor(station / 2) / Math.max(1, Math.ceil(n / 2));
    return new THREE.Vector3(side * (0.6 + along * ac.def.span * 0.38), -0.8, 0.5);
  }

  /** Release the selected weapon. Returns a status string. */
  fireSelected(ac: Aircraft): string {
    const id = ac.selWeapon;
    if (!id || id === 'gun') return '';
    const def = WEAPONS[id];
    if (!def || ac.countOf(id) <= 0) return 'NO WPN';
    let target: Target | null = null;
    let point: THREE.Vector3 | null = null;
    const r: Radar | null = ac.radar;
    switch (def.kind) {
      case 'ir':
        target = ac.irLock;
        break;
      case 'sarh':
        if (!r?.stt) return 'NO LOCK';
        target = r.stt;
        break;
      case 'arh':
        if (r?.stt) target = r.stt;
        else if (r?.cursor && r.isTracked(r.cursor)) target = r.cursor;
        else if (r && r.mode === 'TWS') target = r.sortedContacts().find((c) => !c.irst && r.isTracked(c.target))?.target ?? null;
        if (!target) return 'NO TRACK';
        break;
      case 'agm':
        if (!ac.agTarget || !ac.agTarget.alive) return 'NO LOCK';
        target = ac.agTarget;
        break;
      case 'lgb':
        if (ac.agTarget && ac.agTarget.alive) target = ac.agTarget;
        else if (ac.agPoint) point = ac.agPoint;
        break;
      case 'arm': {
        const em = this.findEmitter(ac, def);
        if (!em) return 'NO EMITTER';
        target = em;
        break;
      }
      case 'bomb':
        break;
      default:
        return '';
    }
    const station = ac.takeStore(id);
    if (station < 0) return 'NO WPN';
    const off = this.stationOffset(ac, station).applyQuaternion(ac.quat);
    const pos = ac.pos.clone().add(off);
    const vel = ac.vel.clone();
    if (def.kind === 'bomb' || def.kind === 'lgb') vel.addScaledVector(ac.fm.up(), -2);
    else vel.addScaledVector(ac.fm.forward(), 5);
    const m = new Missile(def, ac.side, ac, null, target, point, pos, vel);
    this.missiles.push(m);
    if (ac.isPlayer) this.lastLaunched = m;
    const call = def.kind === 'sarh' ? 'Fox 1' : def.kind === 'ir' ? 'Fox 2' : def.kind === 'arh' ? 'Fox 3' : def.kind === 'arm' ? 'Magnum' : def.kind === 'agm' ? 'Rifle' : 'Pickle';
    if (ac.isPlayer || (this.player && ac.side === this.player.side && ac.pos.distanceTo(this.player.pos) < 60000)) {
      this.radio(`${ac.callsign}: ${call}${target && target.kind === 'aircraft' ? ` on ${target.def.name}` : ''}.`, '#cfc');
    }
    this.addEffect('launch', pos, 1);
    return call.toUpperCase();
  }

  findEmitter(ac: Aircraft, def: WeaponDef): GroundUnit | null {
    let best: GroundUnit | null = null, bestScore = Infinity;
    const fwd = ac.fm.forward();
    for (const g of this.ground) {
      if (!g.alive || !g.emitting || g.side === ac.side) continue;
      const d = g.pos.clone().sub(ac.pos);
      const range = d.length();
      if (range > (def.seekerRange ?? 100000)) continue;
      const off = Math.acos(clamp(d.normalize().dot(fwd), -1, 1));
      if (off > (def.gimbal ?? 60) * DEG) continue;
      const score = off * 50000 + range;
      if (score < bestScore) { bestScore = score; best = g; }
    }
    return best;
  }

  private updateGun(ac: Aircraft, dt: number) {
    const gun = ac.def.gun;
    if (!gun || !ac.gunFiring || ac.gunRounds <= 0) { ac.gunAccum = 0; return; }
    ac.gunAccum += (gun.rpm / 60) * dt;
    const fwd = ac.fm.forward();
    const up = ac.fm.up();
    const dir = fwd.clone().addScaledVector(up, 0.026).normalize(); // gun line ~1.5 deg up
    const muzzle = ac.pos.clone().addScaledVector(fwd, ac.def.length * 0.3).addScaledVector(ac.fm.right(), 0.6);
    while (ac.gunAccum >= 1) {
      ac.gunAccum -= 1;
      if (!(ac.isPlayer && this.opts.unlimitedWeapons)) ac.gunRounds--;
      const spread = 0.004;
      const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)).normalize();
      const v = ac.vel.clone().addScaledVector(d, gun.muzzleVel);
      this.bullets.spawn(muzzle, v, ac, ac.side, gun.damage, ac.gunRounds % 4 === 0, 3.5);
      if (ac.gunRounds <= 0) break;
    }
  }

  dropCountermeasure(ac: Aircraft, kind: 'flare' | 'chaff') {
    const unlimited = ac.isPlayer && this.opts.unlimitedWeapons;
    if (kind === 'flare') { if (ac.flares <= 0) return false; if (!unlimited) ac.flares--; }
    else { if (ac.chaff <= 0) return false; if (!unlimited) ac.chaff--; }
    const v = ac.vel.clone().multiplyScalar(kind === 'flare' ? 0.85 : 0.6).addScaledVector(ac.fm.up(), -15)
      .add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
    this.countermeasures.push({ kind, pos: ac.pos.clone().addScaledVector(ac.fm.forward(), -ac.def.length * 0.4), vel: v, life: kind === 'flare' ? 4.5 : 3.5, ownerId: ac.id, id: newId() });
    return true;
  }

  /** IR missile seeker lock (with radar slaving) and AG target validity. */
  private updateSeekers(ac: Aircraft) {
    const def = ac.selectedDef();
    if (!def || def.kind !== 'ir') ac.irLock = null;
    else {
      const fwd = ac.fm.forward();
      const gimbal = (def.gimbal ?? 40) * DEG;
      const valid = (t: Aircraft) => {
        if (!t.active || t.side === ac.side) return false;
        const d = t.pos.clone().sub(ac.pos);
        const range = d.length();
        const rear = clamp(0.5 + 0.5 * t.fm.forward().dot(d.clone().normalize()), 0, 1); // 1 = tail aspect
        const lockRange = (def.seekerRange ?? 10000) * Math.sqrt(t.heat()) * (0.45 + 0.55 * rear);
        if (range > lockRange || range < 200) return false;
        if (Math.acos(clamp(d.normalize().dot(fwd), -1, 1)) > gimbal) return false;
        return lineOfSight(ac.pos.x, ac.pos.y, ac.pos.z, t.pos.x, t.pos.y, t.pos.z, 8);
      };
      if (ac.irLock && ac.irLock.kind === 'aircraft' && !valid(ac.irLock)) ac.irLock = null;
      if (!ac.irLock) {
        const stt: Aircraft | null = ac.radar?.stt ?? null;
        if (stt && valid(stt)) ac.irLock = stt;
        else {
          let best: Aircraft | null = null;
          let bOff = ac.isPlayer ? 6 * DEG : gimbal * 0.8;
          for (const t of this.aircraft) {
            if (!valid(t)) continue;
            const off = Math.acos(clamp(t.pos.clone().sub(ac.pos).normalize().dot(fwd), -1, 1));
            if (off < bOff) { bOff = off; best = t; }
          }
          ac.irLock = best;
        }
      }
    }
    if (ac.agTarget && !ac.agTarget.alive) ac.agTarget = null;
  }

  /** Designate ground target near boresight (targeting pod / Maverick seeker). */
  designateGround(ac: Aircraft, coneDeg = 8, maxRange = 25000): GroundUnit | null {
    const fwd = ac.fm.forward();
    const def = ac.selectedDef();
    if (def?.kind === 'agm') maxRange = def.seekerRange ?? maxRange;
    let best: GroundUnit | null = null, bOff = coneDeg * DEG;
    for (const g of this.ground) {
      if (!g.alive || g.side === ac.side) continue;
      const d = g.pos.clone().sub(ac.pos);
      if (d.length() > maxRange) continue;
      const off = Math.acos(clamp(d.normalize().dot(fwd), -1, 1));
      if (off < bOff && lineOfSight(ac.pos.x, ac.pos.y, ac.pos.z, g.pos.x, g.pos.y + 3, g.pos.z, 12)) { bOff = off; best = g; }
    }
    ac.agTarget = best;
    ac.agPoint = best ? null : this.raycastTerrain(ac.pos, fwd, maxRange);
    return best;
  }

  raycastTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxRange: number): THREE.Vector3 | null {
    const p = origin.clone();
    let d = 0;
    while (d < maxRange) {
      p.copy(origin).addScaledVector(dir, d);
      if (p.y <= surfaceHeight(p.x, p.z)) return p.clone();
      d += Math.min(400, 30 + d * 0.01);
    }
    return null;
  }

  /** Predict bomb impact point (CCIP) by integrating the ballistic path. */
  predictImpact(ac: Aircraft, def: WeaponDef): { point: THREE.Vector3; tof: number } | null {
    const p = ac.pos.clone();
    const v = ac.vel.clone().addScaledVector(ac.fm.up(), -2);
    const dt = 0.05;
    for (let t = 0; t < 60; t += dt) {
      const V = v.length();
      const rho = 1.225 * Math.exp(-p.y / 9000);
      const drag = 0.5 * rho * V * V * def.cda / def.mass;
      v.addScaledVector(v.clone().divideScalar(Math.max(V, 1)), -drag * dt);
      v.y -= G0 * dt;
      p.addScaledVector(v, dt);
      if (p.y <= surfaceHeight(p.x, p.z)) return { point: p, tof: t };
    }
    return null;
  }

  private updateGEffects(ac: Aircraft, dt: number) {
    if (!this.opts.gEffects) { ac.gLoc = 0; return; }
    const n = ac.fm.nz;
    if (n > 6.5) ac.gStress += (n - 6.5) * dt * 0.25;
    else if (n < -2.5) ac.gStress += (-2.5 - n) * dt * 0.4;
    else ac.gStress = Math.max(0, ac.gStress - dt * (n < 4 ? 0.35 : 0.1));
    ac.gStress = Math.min(ac.gStress, 1.6);
    ac.gLoc = clamp(ac.gStress, 0, 1);
  }

  // ------------------------------------------------------------------ ground & SAMs
  private stepGround(dt: number) {
    for (const g of this.ground) {
      if (!g.alive || !g.path || g.speed <= 0) continue;
      const wp = g.path[g.pathIndex];
      if (!wp) continue;
      const d = wp.clone().sub(g.pos); d.y = 0;
      if (d.length() < 20) { g.pathIndex = (g.pathIndex + 1) % g.path.length; continue; }
      d.normalize();
      g.vel.copy(d).multiplyScalar(g.speed);
      g.pos.addScaledVector(g.vel, dt);
      g.pos.y = Math.max(0, terrainHeight(g.pos.x, g.pos.z));
      g.heading = Math.atan2(d.x, -d.z);
    }
  }

  private stepSams(dt: number) {
    for (const site of this.sites) {
      if (!site.alive) { site.radar.emitting = false; site.target = null; continue; }
      site.radar.emitting = true;
      site.reloadTimer -= dt;
      site.trackTime += dt;
      const p = site.params;
      const rp = site.radar.pos.clone(); rp.y += 8;
      const valid = (a: Aircraft) => {
        if (!a.active || a.side === site.side) return false;
        const range = a.pos.distanceTo(rp);
        const agl = a.pos.y - surfaceHeight(a.pos.x, a.pos.z);
        if (range > p.trackRange || agl < p.minAlt || a.pos.y > p.maxAlt) return false;
        const los = a.pos.clone().sub(rp).normalize();
        if (!p.isGun && Math.abs(a.vel.dot(los)) < 25 && agl < 3000) return false; // Doppler notch
        return lineOfSight(rp.x, rp.y, rp.z, a.pos.x, a.pos.y, a.pos.z, 16);
      };
      if (site.target && !valid(site.target)) site.target = null;
      if (!site.target && Math.random() < dt * 2) {
        let best: Aircraft | null = null, bd = Infinity;
        for (const a of this.aircraft) {
          if (!valid(a)) continue;
          const d = a.pos.distanceTo(rp);
          if (d < bd) { bd = d; best = a; }
        }
        if (best) { site.target = best; site.trackTime = 0; }
      }
      if (Math.random() < dt * 1.5) {
        for (const a of this.aircraft) {
          if (!a.active || a.side === site.side) continue;
          if (a.pos.distanceTo(rp) < p.searchRange && lineOfSight(rp.x, rp.y, rp.z, a.pos.x, a.pos.y, a.pos.z, 10)) {
            paintRwr(a, this, site.radar.id, 'search', rp, p.symbol);
          }
        }
      }
      const t = site.target;
      if (!t) continue;
      paintRwr(t, this, site.radar.id, 'lock', rp, p.symbol);
      const range = t.pos.distanceTo(rp);
      if (p.isGun) {
        if (range < 3500 && site.trackTime > 1.5) this.fireAAA(site, t, dt);
        continue;
      }
      const w = WEAPONS[p.weapon];
      const inFlight = this.missiles.filter((m) => m.site === site && m.alive).length;
      if (site.trackTime > 4 && site.reloadTimer <= 0 && site.ammo > 0 && range < w.rangeKm * 1000 * 0.8 && range > (w.minRange ?? 2000) && inFlight < p.salvo) {
        const l = site.launchers.find((x) => x.alive);
        if (!l) continue;
        const pos = l.pos.clone(); pos.y += 6;
        const dir = t.pos.clone().sub(pos).normalize();
        dir.y = Math.max(dir.y, 0.5); dir.normalize();
        this.missiles.push(new Missile(w, site.side, null, site, t, null, pos, dir.multiplyScalar(60)));
        site.reloadTimer = p.reload;
        site.ammo--;
        this.addEffect('launch', pos, 3);
        if (t.isPlayer) this.radio(`RWR: ${site.type} launch!`, '#f66');
      }
    }
  }

  private fireAAA(site: SamSite, t: Aircraft, dt: number) {
    site.gunAccum += dt * 30;
    const gp = site.radar.pos.clone(); gp.y += 3;
    while (site.gunAccum >= 1) {
      site.gunAccum -= 1;
      const range = t.pos.distanceTo(gp);
      const tof = range / 950;
      const lead = t.pos.clone().addScaledVector(t.vel, tof); lead.y += 0.5 * G0 * tof * tof;
      const err = 0.012 + range / 200000;
      const dir = lead.sub(gp).normalize().add(new THREE.Vector3((Math.random() - 0.5) * err, (Math.random() - 0.5) * err, (Math.random() - 0.5) * err)).normalize();
      this.bullets.spawn(gp, dir.multiplyScalar(970), null, site.side, 6, Math.random() < 0.3, 4);
    }
  }

  enemiesOf(side: 'blue' | 'red') {
    return this.aircraft.filter((a) => a.active && a.side !== side);
  }

  missilesAt(ac: Aircraft) {
    return this.missiles.filter((m) => m.alive && m.target === ac && m.guided);
  }
}
