import * as THREE from 'three';
import type { RadarDef } from '../aircraft/types.js';
import { rwrSymbol, type Aircraft, type RwrContact } from '../sim/entities.js';
import { lineOfSight, surfaceHeight } from '../world/theater.js';
import { DEG, RAD, clamp } from '../core/math.js';
import type { World } from '../sim/world.js';

export type RadarMode = 'OFF' | 'RWS' | 'TWS' | 'STT' | 'ACM';
export const RANGE_SCALES_NM = [5, 10, 20, 40, 80, 160];

export interface Contact {
  target: Aircraft;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  lastSeen: number;
  irst: boolean;
}

/** Register an RWR entry on a target aircraft. */
export function paintRwr(target: Aircraft, world: World, sourceId: number, kind: RwrContact['kind'], fromPos: THREE.Vector3, symbol: string) {
  const fm = target.fm;
  const d = fromPos.clone().sub(fm.pos);
  const range = d.length();
  const b = d.applyQuaternion(fm.quat.clone().invert());
  const bearing = Math.atan2(b.x, -b.z) * RAD;
  const prio = kind === 'missile' ? 4 : kind === 'launch' ? 3 : kind === 'lock' ? 2 : 1;
  let m = world.rwrRaw.get(target.id);
  if (!m) { m = new Map(); world.rwrRaw.set(target.id, m); }
  const prev = m.get(sourceId);
  if (!prev || prev.c.priority <= prio || world.time - prev.t > 0.5) {
    m.set(sourceId, { c: { sourceId, kind, bearing, range, symbol, priority: prio }, t: world.time });
  }
}

export class Radar {
  owner: Aircraft;
  def: RadarDef;
  mode: RadarMode = 'RWS';
  rangeIdx = 3;
  azScan = 60;            // deg half-width
  elevCenter = 0;         // deg antenna elevation
  contacts = new Map<number, Contact>();
  stt: Aircraft | null = null;
  sttLost = 0;
  cursor: Aircraft | null = null;
  private scanTimer = 0;
  private irstTimer = 0;
  private prevMode: RadarMode = 'RWS';

  constructor(owner: Aircraft, def: RadarDef) {
    this.owner = owner;
    this.def = def;
  }

  get rangeScale() { return RANGE_SCALES_NM[this.rangeIdx] * 1852; }
  get emitting() { return this.mode !== 'OFF'; }

  setMode(m: RadarMode) {
    if (m === 'TWS' && !this.def.tws) m = 'RWS';
    if (m !== 'STT') this.prevMode = m;
    if (m !== 'STT') this.stt = null;
    this.mode = m;
    this.azScan = m === 'TWS' ? 30 : 60;
  }
  cycleMode() {
    const order: RadarMode[] = this.def.tws ? ['RWS', 'TWS', 'ACM', 'OFF'] : ['RWS', 'ACM', 'OFF'];
    const cur = this.mode === 'STT' ? this.prevMode : this.mode;
    const i = order.indexOf(cur);
    this.setMode(order[(i + 1) % order.length]);
  }
  rangeUp() { this.rangeIdx = Math.min(RANGE_SCALES_NM.length - 1, this.rangeIdx + 1); }
  rangeDown() { this.rangeIdx = Math.max(0, this.rangeIdx - 1); }

  isTracked(t: Aircraft) {
    if (this.stt === t) return true;
    if (this.mode !== 'TWS') return false;
    const c = this.contacts.get(t.id);
    return !!c && !c.irst && (this.owner.fm.time - c.lastSeen) < 3;
  }

  lock(t: Aircraft | null) {
    if (!t || this.mode === 'OFF') return false;
    if (!this.canDetect(t, this.def.range * 1.15, this.def.azLimit, 60)) return false;
    if (this.mode !== 'STT') this.prevMode = this.mode;
    this.stt = t;
    this.sttLost = 0;
    this.mode = 'STT';
    return true;
  }
  unlock() {
    if (this.mode === 'STT') this.mode = this.prevMode;
    this.stt = null;
  }

  /** Detection range (m) vs a target, scaled by RCS (radar range equation, R^4). */
  detectRange(t: Aircraft) {
    return this.def.range * Math.pow(Math.max(t.rcs(), 0.01) / 5, 0.25);
  }

  /** Gimbal, range, terrain masking and look-down Doppler notch. */
  canDetect(t: Aircraft, rangeLimit: number, az: number, el: number): boolean {
    if (!t.active) return false;
    const me = this.owner.fm;
    const d = t.pos.clone().sub(me.pos);
    const range = d.length();
    const rmax = Math.min(rangeLimit, this.detectRange(t) * (rangeLimit / this.def.range));
    if (range > rmax) return false;
    const b = d.clone().applyQuaternion(me.quat.clone().invert());
    const azA = Math.atan2(b.x, -b.z) * RAD;
    const elA = Math.atan2(b.y, Math.hypot(b.x, b.z)) * RAD;
    if (Math.abs(azA) > az || Math.abs(elA - this.elevCenter) > el) return false;
    const tAgl = t.pos.y - surfaceHeight(t.pos.x, t.pos.z);
    if (t.pos.y < me.pos.y - 300 && tAgl < 8000) {
      const radialGround = Math.abs(t.vel.dot(d.clone().normalize()));
      if (radialGround < 35) return false;          // in the notch
      if (range > rmax * 0.8) return false;          // clutter reduces range
    }
    if (range > 3000 && !lineOfSight(me.pos.x, me.pos.y, me.pos.z, t.pos.x, t.pos.y, t.pos.z, 16)) return false;
    return true;
  }

  update(dt: number, world: World) {
    const me = this.owner;
    const sym = rwrSymbol(me.def);
    const now = world.time;
    // IRST (passive) — available even with the radar silent
    if (this.def.irst) {
      this.irstTimer -= dt;
      if (this.irstTimer <= 0) {
        this.irstTimer = 0.5;
        const inv = me.fm.quat.clone().invert();
        for (const t of world.aircraft) {
          if (!t.active || t.side === me.side) continue;
          const d = t.pos.distanceTo(me.pos);
          if (d > this.def.irst * Math.sqrt(t.heat())) continue;
          const b = t.pos.clone().sub(me.pos).applyQuaternion(inv);
          const off = Math.acos(clamp(-b.z / Math.max(b.length(), 1), -1, 1)) * RAD;
          if (off > 60) continue;
          if (!lineOfSight(me.pos.x, me.pos.y, me.pos.z, t.pos.x, t.pos.y, t.pos.z, 12)) continue;
          const c = this.contacts.get(t.id);
          if (!c || c.irst || now - c.lastSeen > 1) this.contacts.set(t.id, { target: t, pos: t.pos.clone(), vel: t.vel.clone(), lastSeen: now, irst: true });
        }
      }
    }
    if (this.mode === 'OFF') { this.stt = null; this.pruneContacts(now); return; }

    if (this.mode === 'STT') {
      const t = this.stt;
      if (!t || !t.active) { this.unlock(); return; }
      if (this.canDetect(t, this.def.range * 1.25, this.def.azLimit, 60)) {
        if (this.sttLost < 1) this.sttLost = 0;
        this.contacts.set(t.id, { target: t, pos: t.pos.clone(), vel: t.vel.clone(), lastSeen: now, irst: false });
        for (const cm of world.countermeasures) {
          const key = cm.id * 100000 + me.id;
          if (cm.kind === 'chaff' && cm.ownerId === t.id && !world.chaffSeen.has(key)) {
            world.chaffSeen.add(key);
            if (Math.random() < (this.def.name.includes('AESA') ? 0.06 : 0.15)) this.sttLost = 2;
          }
        }
        paintRwr(t, world, me.id, 'lock', me.pos, sym);
      } else {
        this.sttLost += dt;
      }
      if (this.sttLost > 1.2) this.unlock();
      return;
    }

    if (this.mode === 'ACM') {
      let best: Aircraft | null = null, bd = Infinity;
      for (const t of world.aircraft) {
        if (!t.active || t.side === me.side) continue;
        const d = t.pos.distanceTo(me.pos);
        if (d > 18520 || d >= bd) continue;
        if (this.canDetect(t, 18520, 20, 25)) { best = t; bd = d; }
      }
      if (best) this.lock(best);
      return;
    }

    // RWS / TWS: refresh the scan volume once per frame time
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = this.mode === 'TWS' ? 1.2 : 2.0;
      const limit = Math.min(this.def.range, this.rangeScale * 1.05);
      for (const t of world.aircraft) {
        if (!t.active || t === me || t.side === me.side) continue;
        if (this.canDetect(t, limit, this.azScan, 30)) {
          this.contacts.set(t.id, { target: t, pos: t.pos.clone(), vel: t.vel.clone(), lastSeen: now, irst: false });
          paintRwr(t, world, me.id, 'search', me.pos, sym);
        }
      }
    } else if (this.mode === 'TWS') {
      for (const c of this.contacts.values()) {
        if (!c.irst && now - c.lastSeen < 2.5 && c.target.active) { c.pos.copy(c.target.pos); c.vel.copy(c.target.vel); }
      }
    }
    this.pruneContacts(now);
    if (this.cursor && !this.contacts.has(this.cursor.id)) this.cursor = null;
  }

  private pruneContacts(now: number) {
    for (const [id, c] of this.contacts) if (now - c.lastSeen > 6 || !c.target.active) this.contacts.delete(id);
  }

  sortedContacts(): Contact[] {
    const me = this.owner.pos;
    return [...this.contacts.values()].sort((a, b) => a.pos.distanceToSquared(me) - b.pos.distanceToSquared(me));
  }

  cycleCursor() {
    const list = this.sortedContacts();
    if (!list.length) { this.cursor = null; return; }
    const i = list.findIndex((c) => c.target === this.cursor);
    this.cursor = list[(i + 1) % list.length].target;
  }

  /** TMS up: lock designated contact, else the nearest one in front. */
  lockDesignated() {
    if (this.mode === 'OFF') this.setMode('RWS');
    let t = this.cursor;
    if (!t) {
      const fwd = this.owner.fm.forward();
      const list = this.sortedContacts().filter((c) => c.pos.clone().sub(this.owner.pos).normalize().dot(fwd) > Math.cos(this.def.azLimit * DEG));
      t = list[0]?.target ?? null;
    }
    return this.lock(t);
  }
}
