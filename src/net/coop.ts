// Co-op multiplayer: the host's World is authoritative (AI, SAMs, missiles, damage, kills); each client flies its
// own jet locally and sees everything else as interpolated "ghosts". Weapons fired by a client are requests that
// the host executes from that client's proxy aircraft.
import * as THREE from 'three';
import type { World } from '../sim/world.js';
import type { Aircraft, GroundUnit, RwrContact } from '../sim/entities.js';
import type { MissionSpec, FlightSpec, StartSpec } from '../game/mission.js';
import { WEAPONS, type WeaponDef } from '../weapons/stores.js';
import { getAircraft } from '../aircraft/defs.js';
import { packAircraft, applyAircraft, Interpolator, INTERP_DELAY, F_ALIVE, F_REMOVED, type Snapshot, type ClientState, type FireRequest, type MsState } from './protocol.js';

/** Minimal message transport (Trystero room in the game, an in-memory pair in tests). */
export interface NetTransport {
  selfId: string;
  send(channel: string, data: unknown, to?: string): void;
  on(channel: string, cb: (data: any, from: string) => void): void;
  onPeerJoin(cb: (id: string) => void): void;
  onPeerLeave(cb: (id: string) => void): void;
  leave(): void;
}

export interface CoopPlayer { peerId: string; name: string; aircraftId: string }

const SNAP_HZ = 15, STATE_HZ = 20;

/** Add one 1-ship flight per remote player next to the host's flight. Returns the spec and peer → flight id. */
export function addCoopFlights(spec: MissionSpec, players: CoopPlayer[]): { spec: MissionSpec; flightOf: Record<string, string> } {
  const out: MissionSpec = JSON.parse(JSON.stringify(spec));
  const host = out.flights.find((f) => f.player)!;
  const flightOf: Record<string, string> = {};
  players.forEach((p, n) => {
    const def = getAircraft(p.aircraftId);
    const off = 450 * (n + 1);
    let start: StartSpec;
    if (host.start.kind === 'air') {
      const s = host.start, h = s.hdg * Math.PI / 180;
      start = { ...s, x: s.x + Math.cos(h) * off, z: s.z + Math.sin(h) * off };
    } else {
      start = { ...host.start }; // runway: the client lines up behind the host (offset applied in buildMission by slot)
    }
    const f: FlightSpec = {
      id: `mp_${n}`, callsign: p.name.slice(0, 12) || `Player ${n + 2}`, side: host.side, aircraftId: p.aircraftId,
      stores: def.loadouts[0]?.stores ?? [], count: 1, skill: 'veteran', task: host.task, start, homeBase: host.homeBase,
      waypoints: host.waypoints, targetGroup: host.targetGroup, runwaySlot: n + 1,
    };
    out.flights.push(f);
    flightOf[p.peerId] = f.id;
  });
  return { spec: out, flightOf };
}

/** The spec as seen by a client: its own flight is the player flight. */
export function clientSpec(spec: MissionSpec, myFlightId: string): MissionSpec {
  const out: MissionSpec = JSON.parse(JSON.stringify(spec));
  for (const f of out.flights) f.player = f.id === myFlightId;
  return out;
}

const indexOfFlight = (world: World, flightId: string) => world.aircraft.findIndex((a) => a.flightId === flightId);

// ------------------------------------------------------------------ host
export class CoopHost {
  private proxies = new Map<string, Aircraft>();
  private cmSeen = new Map<string, { f: number; c: number }>();
  private timer = 0;
  private kills = 0;
  private msgTime = -1;

  constructor(private world: World, private net: NetTransport, flightOf: Record<string, string>) {
    world.netRole = 'host';
    for (const [peer, fid] of Object.entries(flightOf)) {
      const ac = world.aircraft[indexOfFlight(world, fid)];
      if (!ac) continue;
      ac.netProxy = true;
      ac.ai = null;
      this.proxies.set(peer, ac);
    }
    net.on('st', (s: ClientState, from) => this.onState(s, from));
    net.on('fire', (r: FireRequest, from) => this.onFire(r, from));
    net.onPeerLeave((id) => { const ac = this.proxies.get(id); if (ac?.alive) { ac.removed = true; this.world.radio(`${ac.callsign} left the game.`, '#ccc'); } });
  }

  private onState(s: ClientState, from: string) {
    const ac = this.proxies.get(from);
    if (!ac || ac.removed) return;
    if (ac.alive) applyAircraft(ac, s);
    ac.ctrl.throttle = s.th;
    // countermeasures: the client reports its remaining counts; drop the difference here
    const prev = this.cmSeen.get(from) ?? { f: s.cmF, c: s.cmC };
    for (let k = 0; k < prev.f - s.cmF; k++) this.world.dropCountermeasure(ac, 'flare');
    for (let k = 0; k < prev.c - s.cmC; k++) this.world.dropCountermeasure(ac, 'chaff');
    this.cmSeen.set(from, { f: s.cmF, c: s.cmC });
    if (!(s.f & F_ALIVE) && ac.alive) this.world.damageAircraft(ac, 999, null, 'crash');
  }

  private onFire(r: FireRequest, from: string) {
    const ac = this.proxies.get(from);
    if (!ac?.active || !WEAPONS[r.weapon]) return;
    if (r.targetKind === 'air') {
      const t = this.world.aircraft[r.target];
      if (t?.active) { if (ac.radar) { ac.radar.mode = 'STT'; ac.radar.stt = t; } ac.irLock = t; }
    } else if (r.targetKind === 'ground') {
      const g = this.world.ground[r.target];
      if (g?.alive) ac.agTarget = g;
    }
    ac.selWeapon = r.weapon;
    if (ac.countOf(r.weapon) <= 0) ac.stores.push(r.weapon); // trust the client's inventory
    this.world.fireSelected(ac);
  }

  /** Call once per frame after world.step(). */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0 || !this.proxies.size) return;
    this.timer = 1 / SNAP_HZ;
    const w = this.world;
    const ms: MsState[] = w.missiles.filter((m) => m.alive).map((m) => ({
      id: m.id, w: m.def.id, p: [m.pos.x, m.pos.y, m.pos.z], v: [m.vel.x, m.vel.y, m.vel.z], m: m.motorOn ? 1 : 0,
    }));
    const gu: number[] = [];
    w.ground.forEach((g, i) => { if (!g.alive || g.speed > 0) gu.push(i, g.alive ? 1 : 0, Math.round(g.pos.x), Math.round(g.pos.z)); });
    const rwr: Record<string, RwrContact[]> = {};
    for (const [peer, ac] of this.proxies) rwr[peer] = ac.rwr;
    const snap: Snapshot = {
      t: w.time,
      ac: w.aircraft.map((a, i) => packAircraft(a, i)),
      ms, gu,
      k: w.kills.slice(this.kills),
      r: w.messages.filter((m) => m.time > this.msgTime),
      rwr,
    };
    this.kills = w.kills.length;
    for (const m of w.messages) this.msgTime = Math.max(this.msgTime, m.time);
    this.net.send('snap', snap);
  }

  end(reason: string) { this.net.send('end', { reason }); }
}

// ------------------------------------------------------------------ client
/** Visual-only stand-in for a host missile (rendered like a Missile). */
class GhostMissile {
  alive = true; target = null; launcher = null; site = null; guided = false; seeker = 'inertial';
  pos = new THREE.Vector3(); vel = new THREE.Vector3(); motorOn = false;
  constructor(public id: number, public def: WeaponDef) {}
}

export class CoopClient {
  private interp = new Map<number, Interpolator>();
  private ghosts = new Map<number, GhostMissile>();
  private hostTime = 0;
  private recvAt = 0;
  private timer = 0;
  private rwr: RwrContact[] = [];
  readonly me: Aircraft;
  readonly myIndex: number;
  onEnd: ((reason: string) => void) | null = null;

  constructor(private world: World, private net: NetTransport, myFlightId: string) {
    world.netRole = 'client';
    this.myIndex = indexOfFlight(world, myFlightId);
    this.me = world.aircraft[this.myIndex];
    world.aircraft.forEach((a, i) => { if (i !== this.myIndex) { a.netGhost = true; a.ai = null; } });
    // own weapons: the host fires them
    world.netFire = (weapon, target) => {
      const air = target && target.kind === 'aircraft' ? world.aircraft.indexOf(target as Aircraft) : -1;
      const gnd = target && target.kind !== 'aircraft' ? world.ground.indexOf(target as GroundUnit) : -1;
      const req: FireRequest = air >= 0 ? { weapon, target: air, targetKind: 'air' } : gnd >= 0 ? { weapon, target: gnd, targetKind: 'ground' } : { weapon, target: -1, targetKind: 'none' };
      net.send('fire', req);
    };
    net.on('snap', (s: Snapshot) => this.onSnap(s));
    net.on('end', (m: { reason: string }) => this.onEnd?.(m.reason));
  }

  private onSnap(s: Snapshot) {
    const w = this.world;
    this.hostTime = s.t;
    this.recvAt = now();
    for (const a of s.ac) {
      const ac = w.aircraft[a.i];
      if (!ac) continue;
      if (a.i === this.myIndex) {
        // the host decides damage to us
        ac.health = Math.min(ac.health, a.h);
        if (!(a.f & F_ALIVE) && ac.alive) { ac.health = 0; ac.alive = false; ac.fm.crashed = true; w.addEffect('fireball', ac.pos, 12); }
        continue;
      }
      let ip = this.interp.get(a.i);
      if (!ip) { ip = new Interpolator(); this.interp.set(a.i, ip); }
      ip.push(s.t, a);
      ac.health = a.h;
      if (!(a.f & F_ALIVE) && ac.alive) { ac.alive = false; w.addEffect('fireball', ac.pos, 12); }
      if (a.f & F_REMOVED) ac.removed = true;
    }
    // missiles: replace the visual list
    const seen = new Set<number>();
    for (const m of s.ms) {
      seen.add(m.id);
      let g = this.ghosts.get(m.id);
      if (!g) { const def = WEAPONS[m.w]; if (!def) continue; g = new GhostMissile(m.id, def); this.ghosts.set(m.id, g); }
      g.pos.set(m.p[0], m.p[1], m.p[2]); g.vel.set(m.v[0], m.v[1], m.v[2]); g.motorOn = !!m.m;
    }
    for (const [id, g] of this.ghosts) if (!seen.has(id)) { w.addEffect('airburst', g.pos, 4); this.ghosts.delete(id); }
    w.missiles = [...this.ghosts.values()] as unknown as typeof w.missiles;
    for (let k = 0; k < s.gu.length; k += 4) {
      const g = w.ground[s.gu[k]];
      if (!g) continue;
      if (!s.gu[k + 1] && g.alive) { g.alive = false; g.hp = 0; w.addEffect('explosion', g.pos, g.radius * 1.5); }
      g.pos.x = s.gu[k + 2]; g.pos.z = s.gu[k + 3];
    }
    w.kills.push(...s.k);
    for (const m of s.r) w.radio(m.text, m.color);
    this.rwr = s.rwr[this.net.selfId] ?? [];
  }

  /** Call once per frame after world.step(). */
  update(dt: number) {
    const t = this.hostTime + (now() - this.recvAt) / 1000 - INTERP_DELAY;
    for (const [i, ip] of this.interp) {
      const ac = this.world.aircraft[i];
      const s = ip.sample(t);
      if (ac && s && ac.alive) applyAircraft(ac, s);
    }
    for (const g of this.ghosts.values()) g.pos.addScaledVector(g.vel, dt);
    this.me.rwr = this.rwr;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / STATE_HZ;
    const st: ClientState = { ...packAircraft(this.me, this.myIndex), th: this.me.ctrl.throttle, cmF: this.me.flares, cmC: this.me.chaff };
    this.net.send('st', st);
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
