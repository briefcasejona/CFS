import * as THREE from 'three';
import type { AircraftDef, Side } from '../aircraft/types.js';
import { FlightModel, defaultControls, type Controls } from './flightModel.js';
import { WEAPONS, type WeaponDef } from '../weapons/stores.js';
import type { SamType } from '../world/theater.js';

let NEXT_ID = 1;
export const newId = () => NEXT_ID++;

export interface RwrContact {
  sourceId: number;
  kind: 'search' | 'lock' | 'launch' | 'missile';
  bearing: number;   // deg relative to own nose (0 = ahead, clockwise)
  range: number;     // m
  symbol: string;    // e.g. '29', '16', '10', 'M'
  priority: number;
}

export type Target = Aircraft | GroundUnit;

/** RWR symbol for an aircraft type. */
export function rwrSymbol(def: AircraftDef): string {
  const m: Record<string, string> = {
    f15c: '15', f16c: '16', fa18c: '18', fa18e: '18', f14b: '14', f4e: 'F4', t38c: 'T', av8b: 'AV',
    mig29a: '29', su27: '27', su30: '30', su57: '57', m2000: '2K', rafale: 'RF', jas39: 'GR', ef2000: 'EF',
  };
  return m[def.id] ?? 'U';
}

export class Aircraft {
  readonly kind = 'aircraft' as const;
  readonly id = newId();
  callsign: string;
  side: Side;
  def: AircraftDef;
  fm: FlightModel;
  ctrl: Controls = defaultControls();
  stores: string[] = [];
  gunRounds: number;
  chaff: number;
  flares: number;
  health = 100;
  alive = true;          // false once destroyed
  removed = false;       // removed from the world (landed / despawned)
  ejected = false;
  isPlayer = false;
  ai: any = null;        // AIPilot (typed loosely to avoid an import cycle)
  radar: any = null;     // Radar
  rwr: RwrContact[] = [];
  selWeapon = 'gun';
  irLock: Target | null = null;
  agTarget: GroundUnit | null = null;
  agPoint: THREE.Vector3 | null = null;
  lastHitBy: Aircraft | null = null;
  lastHitWeapon = '';
  kills = 0;
  groundKills = 0;
  gunFiring = false;
  gunAccum = 0;
  cmTimer = 0;
  flightId = '';
  wingIndex = 0;
  homeBaseId = '';
  incoming: number[] = [];  // missile ids guiding on this aircraft
  gLoc = 0;                 // 0..1 vision loss
  gStress = 0;
  /** seconds of G-induced loss of consciousness left (no control inputs) */
  glocTimer = 0;
  private lastNz = 1;
  /** g onset rate (g/s), smoothed — fast onsets are harder to strain against */
  gOnset = 0;
  trackOnset(nz: number, dt: number) {
    const rate = (nz - this.lastNz) / Math.max(dt, 1e-3);
    this.lastNz = nz;
    this.gOnset += (rate - this.gOnset) * Math.min(1, dt * 4);
  }
  landed = false;
  /** station positions of the starting loadout (body frame), see aircraft/stations.ts */
  stationPos: THREE.Vector3[] | null = null;
  /** tailhook lowered (carrier-capable jets) */
  hook = false;
  /** has left the ground at least once (a runway start isn't a landing) */
  everAirborne = false;
  /** nation id (world/nations.ts) — identity/markings; `side` is the coalition used by IFF and AI */
  nation = '';
  infiniteWeapons = false;
  /** multiplayer: positioned from host snapshots (client side), or from a remote player's updates (host side) */
  netGhost = false;
  netProxy = false;
  squadronId = '';

  constructor(def: AircraftDef, side: Side, callsign: string, loadout: string[]) {
    this.def = def;
    this.side = side;
    this.callsign = callsign;
    this.fm = new FlightModel(def);
    this.gunRounds = def.gun?.rounds ?? 0;
    this.chaff = def.chaff;
    this.flares = def.flares;
    this.stores = [...loadout];
    this.applyStores(true);
    this.selWeapon = this.defaultWeapon();
  }

  get pos() { return this.fm.pos; }
  get vel() { return this.fm.vel; }
  get quat() { return this.fm.quat; }
  get active() { return this.alive && !this.removed; }

  /** IR signature (arbitrary units): engines + afterburner. */
  heat(): number {
    const e = this.def.engine;
    return (0.4 + this.fm.core * 0.6 + this.fm.abFrac * 3) * (e.count === 2 ? 1.3 : 1) * (this.alive ? 1 : 0.6);
  }
  rcs(): number { return this.def.rcs * (1 + this.stores.filter((s) => s).length * 0.15); }

  applyStores(fillTanks = false) {
    let mass = 0, cda = 0, tanks = 0;
    for (const s of this.stores) {
      if (!s) continue;
      const w = WEAPONS[s];
      if (!w) continue;
      mass += w.mass;
      cda += w.cda * (this.def.id === 'su57' && w.kind !== 'tank' ? 0.1 : 1); // internal bays
      if (w.kind === 'tank') tanks++;
    }
    const cap = tanks * this.def.pylonFuel;
    const ext = fillTanks ? cap : Math.min(this.fm.extFuel, cap);
    this.fm.setStores(mass, cda, ext);
  }

  /** Weapons available, in station order, unique. Includes 'gun'. */
  weaponList(): string[] {
    const ids: string[] = [];
    for (const s of this.stores) if (s && s !== 'tank' && !ids.includes(s)) ids.push(s);
    if (this.def.gun) ids.push('gun');
    return ids;
  }
  countOf(id: string): number {
    if (id === 'gun') return this.gunRounds;
    return this.stores.filter((s) => s === id).length;
  }
  defaultWeapon(): string {
    const l = this.weaponList();
    const aa = l.find((w) => w !== 'gun' && ['arh', 'sarh', 'ir'].includes(WEAPONS[w].kind));
    return aa ?? l[0] ?? '';
  }
  cycleWeapon(dir = 1) {
    const l = this.weaponList();
    if (!l.length) return;
    const i = l.indexOf(this.selWeapon);
    this.selWeapon = l[(i + dir + l.length) % l.length];
    this.irLock = null;
  }
  selectByKind(kinds: string[]) {
    const l = this.weaponList();
    const cand = l.filter((w) => (w === 'gun' ? kinds.includes('gun') : kinds.includes(WEAPONS[w].kind)));
    if (!cand.length) return false;
    const i = cand.indexOf(this.selWeapon);
    this.selWeapon = cand[(i + 1) % cand.length];
    this.irLock = null;
    return true;
  }
  /** Remove one store of the given weapon. Returns station index or -1. */
  takeStore(id: string): number {
    const i = this.stores.lastIndexOf(id);
    if (i < 0) return -1;
    if (this.infiniteWeapons) return i;
    this.stores[i] = '';
    this.applyStores();
    if (!this.weaponList().includes(this.selWeapon)) {
      const l = this.weaponList();
      this.selWeapon = l.find((w) => w !== 'gun' && WEAPONS[w].kind === WEAPONS[id].kind) ?? l.find((w) => w !== 'gun') ?? (l.includes('gun') ? 'gun' : '');
    }
    return i;
  }
  jettison() {
    this.stores = this.stores.map((s) => (s && WEAPONS[s] && (WEAPONS[s].kind === 'tank' || ['bomb', 'lgb', 'agm', 'arm'].includes(WEAPONS[s].kind)) ? '' : s));
    this.fm.extFuel = 0;
    this.applyStores();
    if (!this.weaponList().includes(this.selWeapon)) this.selWeapon = this.defaultWeapon();
  }
  selectedDef(): WeaponDef | null {
    return this.selWeapon && this.selWeapon !== 'gun' ? WEAPONS[this.selWeapon] ?? null : null;
  }

  /** Apply battle damage. */
  damage(amount: number, by: Aircraft | null, weapon: string, invulnerable = false) {
    if (!this.alive || invulnerable) return;
    this.health -= amount;
    if (by) { this.lastHitBy = by; this.lastHitWeapon = weapon; }
    const d = this.fm.damage;
    if (amount > 8) {
      const r = Math.random();
      if (r < 0.3) d.engine = Math.max(0, d.engine - amount / 100);
      else if (r < 0.55) d.fuelLeak += amount / 25;
      else if (r < 0.75) d.hydraulics = Math.max(0.3, d.hydraulics - amount / 150);
      else d.controls = Math.max(0.4, d.controls - amount / 200);
    }
    if (this.health <= 0) this.destroy();
  }
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    const d = this.fm.damage;
    d.engine = 0; d.controls = 0.15; d.hydraulics = 0.2;
    this.fm.engineRunning = false;
    this.ctrl.pitch = (Math.random() - 0.5) * 0.6;
    this.ctrl.roll = (Math.random() - 0.5) * 2;
    this.ctrl.throttle = 0;
  }
}

export type GroundType =
  | 'tank' | 'apc' | 'truck' | 'artillery'
  | 'sam_radar' | 'sam_launcher' | 'ewr' | 'aaa'
  | 'building' | 'hangar' | 'bridge' | 'fuel' | 'factory' | 'bunker';

export const GROUND_INFO: Record<GroundType, { hp: number; radius: number; name: string; armored: boolean }> = {
  tank: { hp: 60, radius: 4, name: 'MBT', armored: true },
  apc: { hp: 40, radius: 4, name: 'APC', armored: true },
  truck: { hp: 15, radius: 4, name: 'Truck', armored: false },
  artillery: { hp: 35, radius: 5, name: 'SP Artillery', armored: true },
  sam_radar: { hp: 35, radius: 6, name: 'SAM radar', armored: false },
  sam_launcher: { hp: 35, radius: 6, name: 'SAM launcher', armored: false },
  ewr: { hp: 50, radius: 10, name: 'EW radar', armored: false },
  aaa: { hp: 35, radius: 4, name: 'AAA', armored: true },
  building: { hp: 150, radius: 15, name: 'Building', armored: false },
  hangar: { hp: 220, radius: 20, name: 'Hangar', armored: false },
  bridge: { hp: 400, radius: 30, name: 'Bridge', armored: false },
  fuel: { hp: 80, radius: 10, name: 'Fuel tanks', armored: false },
  factory: { hp: 350, radius: 30, name: 'Factory hall', armored: false },
  bunker: { hp: 500, radius: 12, name: 'Bunker', armored: true },
};

export class GroundUnit {
  readonly kind = 'ground' as const;
  readonly id = newId();
  type: GroundType;
  side: Side;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0;   // rad
  hp: number;
  maxHp: number;
  alive = true;
  removed = false;
  name: string;
  objectiveId = '';
  radius: number;
  emitting = false;     // radar on (for RWR/ARM)
  symbol = '';          // RWR symbol
  path: THREE.Vector3[] | null = null; // convoy waypoints
  pathIndex = 0;
  speed = 0;
  lastHitBy: Aircraft | null = null;

  constructor(type: GroundType, side: Side, x: number, y: number, z: number, heading = 0) {
    this.type = type;
    this.side = side;
    this.pos.set(x, y, z);
    this.heading = heading;
    const info = GROUND_INFO[type];
    this.hp = this.maxHp = info.hp;
    this.radius = info.radius;
    this.name = info.name;
  }
  get active() { return this.alive && !this.removed; }
  heat() { return this.alive ? (this.type === 'tank' || this.type === 'apc' || this.type === 'truck' ? 0.3 : 0.15) : 0.5; }
  rcs() { return 10; }
  damage(amount: number, by: Aircraft | null) {
    if (!this.alive) return;
    const info = GROUND_INFO[this.type];
    this.hp -= info.armored ? amount * 0.8 : amount;
    if (by) this.lastHitBy = by;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.emitting = false; this.speed = 0; }
  }
}

export interface SamParams {
  weapon: string;
  searchRange: number;
  trackRange: number;
  minAlt: number;
  maxAlt: number;
  salvo: number;
  reload: number;      // s between launches
  symbol: string;
  isGun?: boolean;
}

export const SAM_PARAMS: Record<SamType, SamParams> = {
  'SA-10': { weapon: 'sa10', searchRange: 150000, trackRange: 90000, minAlt: 25, maxAlt: 27000, salvo: 2, reload: 6, symbol: '10' },
  'SA-6': { weapon: 'sa6', searchRange: 60000, trackRange: 25000, minAlt: 50, maxAlt: 12000, salvo: 2, reload: 8, symbol: '6' },
  'SA-2': { weapon: 'sa2', searchRange: 90000, trackRange: 40000, minAlt: 300, maxAlt: 25000, salvo: 2, reload: 10, symbol: '2' },
  'SA-15': { weapon: 'sa15', searchRange: 25000, trackRange: 12000, minAlt: 10, maxAlt: 6000, salvo: 2, reload: 4, symbol: '15' },
  Patriot: { weapon: 'patriot', searchRange: 150000, trackRange: 80000, minAlt: 60, maxAlt: 24000, salvo: 2, reload: 6, symbol: 'P' },
  Hawk: { weapon: 'hawk', searchRange: 90000, trackRange: 40000, minAlt: 60, maxAlt: 14000, salvo: 1, reload: 8, symbol: 'HK' },
  AAA: { weapon: '', searchRange: 15000, trackRange: 3000, minAlt: 0, maxAlt: 3000, salvo: 0, reload: 0, symbol: 'A', isGun: true },
};

export class SamSite {
  readonly id = newId();
  name: string;
  type: SamType;
  side: Side;
  params: SamParams;
  radar: GroundUnit;
  launchers: GroundUnit[] = [];
  ammo: number;
  reloadTimer = 0;
  target: Aircraft | null = null;
  trackTime = 0;
  objectiveId = '';
  gunAccum = 0;
  constructor(name: string, type: SamType, side: Side, radar: GroundUnit) {
    this.name = name;
    this.type = type;
    this.side = side;
    this.params = SAM_PARAMS[type];
    this.radar = radar;
    this.ammo = type === 'AAA' ? 999999 : 8;
  }
  get alive() { return this.radar.alive && (!!this.params.isGun || this.launchers.some((l) => l.alive)); }
}

export interface Countermeasure {
  kind: 'flare' | 'chaff';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  ownerId: number;
  id: number;
}
