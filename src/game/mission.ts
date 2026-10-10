import * as THREE from 'three';
import type { Side } from '../aircraft/types.js';
import { AIRCRAFT_BY_ID, getAircraft } from '../aircraft/defs.js';
import { Aircraft, GroundUnit, SamSite, type GroundType } from '../sim/entities.js';
import { World, type WorldOptions } from '../sim/world.js';
import { AIPilot, type AITask, type Skill } from '../ai/pilot.js';
import { airbaseById, runwayEnds, setTheater, terrainHeight, type SamType } from '../world/theater.js';
import type { Weather } from '../render/scene.js';
import { WEAPONS } from '../weapons/stores.js';
import { FT, KT, NM } from '../sim/atmosphere.js';
import { rng } from '../core/math.js';

export type StartSpec =
  | { kind: 'air'; x: number; z: number; alt: number; hdg: number; speed: number }   // hdg deg, alt m, speed m/s
  | { kind: 'runway'; airbaseId: string };

export interface FlightSpec {
  id: string;
  callsign: string;
  side: Side;
  aircraftId: string;
  stores: string[];
  count: number;
  skill: Skill;
  task: AITask;
  start: StartSpec;
  homeBase: string;
  waypoints?: Array<{ x: number; z: number; alt: number; name?: string }>;
  station?: { x: number; z: number; alt: number };
  targetGroup?: string;
  player?: boolean;
  squadronId?: string;
}

export type GroupKind = 'sam' | 'armor' | 'convoy' | 'factory' | 'depot' | 'bridge' | 'radar' | 'command' | 'airbase' | 'city';

export interface GroupSpec {
  id: string;
  side: Side;
  kind: GroupKind;
  x: number; z: number;
  samType?: SamType;
  objectiveId?: string;
  survive?: number;   // 0..1 fraction of units alive at spawn (campaign damage)
  name?: string;
  heading?: number;
}

export type MissionGoal =
  | { kind: 'killAir'; side: Side }
  | { kind: 'destroyGroup'; group: string; fraction: number }
  | { kind: 'survive' }
  | { kind: 'land' };

export interface MissionSpec {
  title: string;
  briefing: string;
  weather: Weather;
  flights: FlightSpec[];
  groups: GroupSpec[];
  goals: MissionGoal[];
  campaign?: { flightId: string; turn: number };
  /** theater (map) id; defaults to Varnia */
  theaterId?: string;
}

export interface BuiltMission {
  world: World;
  player: Aircraft;
  playerFlight: Aircraft[];
  groupUnits: Map<string, GroundUnit[]>;
  steerpoints: Array<{ pos: THREE.Vector3; name: string }>;
  spec: MissionSpec;
}

const weaponKind = (id: string) => WEAPONS[id]?.kind ?? '';

const CALLSIGNS_BLUE = ['Viper', 'Cobra', 'Hawk', 'Eagle', 'Falcon', 'Raptor', 'Ghost', 'Lancer', 'Jester', 'Mako'];
const CALLSIGNS_RED = ['Berkut', 'Sokol', 'Strizh', 'Grom', 'Molniya', 'Vityaz', 'Rapira', 'Kinzhal'];
export function callsignFor(side: Side, i: number) {
  const l = side === 'blue' ? CALLSIGNS_BLUE : CALLSIGNS_RED;
  return l[i % l.length];
}

function ground(x: number, z: number) { return Math.max(0, terrainHeight(x, z)); }

function spawnGroup(world: World, g: GroupSpec, seed: number): GroundUnit[] {
  const r = rng(seed);
  const units: GroundUnit[] = [];
  const add = (type: GroundType, dx: number, dz: number, hdg = 0) => {
    const x = g.x + dx, z = g.z + dz;
    const u = new GroundUnit(type, g.side, x, ground(x, z), z, hdg);
    u.objectiveId = g.objectiveId ?? '';
    units.push(world.addGround(u));
    return u;
  };
  const ring = (type: GroundType, n: number, rad: number) => {
    const out: GroundUnit[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r(); out.push(add(type, Math.cos(a) * rad, Math.sin(a) * rad, a)); }
    return out;
  };
  switch (g.kind) {
    case 'sam': {
      const t = g.samType ?? 'SA-6';
      if (t === 'AAA') {
        const guns = ring('aaa', 3, 120);
        guns[0].symbol = 'A';
        const site = new SamSite(g.name ?? 'AAA', 'AAA', g.side, guns[0]);
        site.launchers = guns;
        site.objectiveId = g.objectiveId ?? '';
        world.addSite(site);
      } else {
        const radar = add('sam_radar', 0, 0);
        const n = t === 'SA-15' ? 1 : t === 'Hawk' || t === 'SA-6' ? 3 : 4;
        const launchers = ring('sam_launcher', n, t === 'SA-15' ? 40 : 160);
        const site = new SamSite(g.name ?? t, t, g.side, radar);
        site.launchers = launchers;
        site.objectiveId = g.objectiveId ?? '';
        radar.symbol = site.params.symbol;
        radar.name = `${t} radar`;
        for (const l of launchers) l.name = `${t} launcher`;
        world.addSite(site);
        if (t === 'SA-10' || t === 'Patriot') add('aaa', 250, -200);
      }
      break;
    }
    case 'armor': {
      const hdg = g.heading ?? 0;
      for (let i = 0; i < 10; i++) {
        const type: GroundType = i % 4 === 0 ? 'apc' : i % 5 === 1 ? 'artillery' : i % 7 === 2 ? 'truck' : 'tank';
        const dx = (i % 5) * 45 - 90 + r() * 15, dz = Math.floor(i / 5) * 70 + r() * 15;
        add(type, dx * Math.cos(hdg) - dz * Math.sin(hdg), dx * Math.sin(hdg) + dz * Math.cos(hdg), hdg);
      }
      add('aaa', 120, 160, hdg);
      break;
    }
    case 'convoy': {
      const hdg = g.heading ?? 0;
      const dir = new THREE.Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
      const path = [new THREE.Vector3(g.x, 0, g.z).addScaledVector(dir, 12000), new THREE.Vector3(g.x, 0, g.z).addScaledVector(dir, -12000)];
      for (let i = 0; i < 8; i++) {
        const u = add(i % 3 === 0 ? 'apc' : 'truck', -dir.x * i * 40, -dir.z * i * 40, hdg);
        u.path = path; u.speed = 9;
      }
      break;
    }
    case 'factory':
      add('factory', 0, 0); add('factory', 90, 40); add('factory', -80, 60);
      add('fuel', 30, -90); add('building', -60, -80); add('building', 140, -50);
      break;
    case 'depot':
      for (let i = 0; i < 6; i++) add('building', (i % 3) * 60 - 60, Math.floor(i / 3) * 70 - 35);
      add('fuel', 140, 0); add('fuel', -140, 20);
      for (let i = 0; i < 5; i++) add('truck', -40 + i * 18, 110);
      break;
    case 'bridge': add('bridge', 0, 0, g.heading ?? 0); break;
    case 'radar': { const e = add('ewr', 0, 0); e.emitting = true; e.symbol = 'EW'; add('building', 40, 30); break; }
    case 'command': { add('bunker', 0, 0); add('building', 60, 0); add('building', -60, 20); const e = add('ewr', 0, 80); e.emitting = true; e.symbol = 'EW'; break; }
    case 'airbase': {
      const ab = airbaseById(g.objectiveId ?? '');
      if (ab) {
        const hr = ab.hdg * Math.PI / 180;
        const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
        const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
        for (let k = -3; k <= 3; k++) {
          const p = new THREE.Vector3(ab.x, 0, ab.z).addScaledVector(side, 470).addScaledVector(fwd, k * 90);
          const u = new GroundUnit('hangar', g.side, p.x, ab.elev, p.z, -hr);
          u.objectiveId = g.objectiveId ?? '';
          units.push(world.addGround(u));
        }
        const fx = ab.x + side.x * 600, fz = ab.z + side.z * 600;
        const f = new GroundUnit('fuel', g.side, fx, ab.elev, fz, 0);
        f.objectiveId = g.objectiveId ?? '';
        units.push(world.addGround(f));
      }
      break;
    }
    case 'city': break;
  }
  const survive = g.survive ?? 1;
  if (survive < 1) {
    const kill = Math.round(units.length * (1 - survive));
    for (let i = 0; i < kill; i++) { units[i].alive = false; units[i].hp = 0; units[i].emitting = false; }
  }
  return units;
}

export function buildMission(spec: MissionSpec, opts: WorldOptions): BuiltMission {
  setTheater(spec.theaterId);
  const world = new World();
  world.opts = { ...opts };
  const groupUnits = new Map<string, GroundUnit[]>();
  spec.groups.forEach((g, i) => groupUnits.set(g.id, spawnGroup(world, g, 1000 + i * 77)));
  let player: Aircraft | null = null;
  let playerFlight: Aircraft[] = [];
  const steerpoints: Array<{ pos: THREE.Vector3; name: string }> = [];
  let csBlue = 0, csRed = 0;
  for (const f of spec.flights) {
    const def = getAircraft(f.aircraftId);
    const members: Aircraft[] = [];
    const cs = f.callsign || callsignFor(f.side, f.side === 'blue' ? csBlue++ : csRed++);
    for (let i = 0; i < f.count; i++) {
      const ac = new Aircraft(def, f.side, `${cs} 1-${i + 1}`, f.stores);
      ac.flightId = f.id;
      ac.wingIndex = i;
      ac.homeBaseId = f.homeBase;
      ac.squadronId = f.squadronId ?? '';
      if (f.start.kind === 'air') {
        const s = f.start;
        const h = s.hdg * Math.PI / 180;
        const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
        const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
        const side = i % 2 === 1 ? 1 : -1;
        const rank = Math.ceil(i / 2);
        const pos = new THREE.Vector3(s.x, 0, s.z).addScaledVector(right, side * rank * 300).addScaledVector(fwd, -rank * 250);
        pos.y = Math.max(s.alt, ground(pos.x, pos.z) + 300);
        ac.fm.placeInAir(pos, h, s.speed);
        ac.ctrl.gearDown = false;
        ac.ctrl.throttle = 0.75;
      } else {
        const ab = airbaseById(f.start.airbaseId);
        const ends = runwayEnds(ab);
        const h = ab.hdg * Math.PI / 180;
        const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h));
        const along = 150 + Math.floor(i / 2) * 250;
        const lat = (i % 2 === 0 ? -1 : 1) * 9;
        ac.fm.placeOnGround(ends.start.x + ends.dir.x * along + right.x * lat, ends.start.z + ends.dir.z * along + right.z * lat, ab.elev, h);
        ac.ctrl.gearDown = true;
        ac.ctrl.throttle = 0;
      }
      world.addAircraft(ac);
      if (f.player && i === 0) {
        ac.isPlayer = true;
        ac.infiniteWeapons = opts.unlimitedWeapons;
        player = ac;
        world.player = ac;
      } else {
        const ai = new AIPilot(ac, f.task, f.skill);
        ai.homeBase = f.homeBase;
        ai.waypoints = (f.waypoints ?? []).map((w) => new THREE.Vector3(w.x, w.alt, w.z));
        if (f.station) ai.stationPoint = new THREE.Vector3(f.station.x, f.station.alt, f.station.z);
        ai.cruiseAlt = f.station?.alt ?? f.waypoints?.[0]?.alt ?? 7000;
        if (f.targetGroup) ai.groundTargets = groupUnits.get(f.targetGroup) ?? [];
        if (i > 0) ai.leader = members[0];
        if (f.start.kind === 'runway') ai.startTakeoff(airbaseById(f.start.airbaseId).hdg * Math.PI / 180);
        if (f.task === 'cap' || f.task === 'patrol') ai.commitRange = 60000;
        if (f.task === 'sweep' || f.task === 'intercept') ai.commitRange = 90000;
        if (f.task === 'escort') ai.commitRange = 40000;
      }
      members.push(ac);
    }
    if (f.player) {
      playerFlight = members;
      for (const w of f.waypoints ?? []) steerpoints.push({ pos: new THREE.Vector3(w.x, w.alt, w.z), name: w.name ?? 'STPT' });
      const home = airbaseById(f.homeBase);
      if (home) steerpoints.push({ pos: new THREE.Vector3(home.x, home.elev, home.z), name: 'HOME' });
      for (const m of members) if (m.ai) {
        m.ai.leader = members[0];
        if (f.start.kind !== 'runway') m.ai.state = 'follow';
      }
    }
  }
  if (!player) throw new Error('Mission has no player flight');
  return { world, player, playerFlight, groupUnits, steerpoints, spec };
}

// ------------------------------------------------------------------ evaluation
export interface MissionResult {
  success: boolean;
  status: string;
  lines: string[];
  playerKillsAir: number;
  playerKillsGround: number;
  friendlyLosses: number;
  enemyLossesAir: number;
  enemyLossesGround: number;
  playerFate: 'landed' | 'alive' | 'ejected' | 'killed';
}

export function evaluate(b: BuiltMission): MissionResult {
  const w = b.world;
  const p = b.player;
  const side = p.side;
  const lines: string[] = [];
  let ok = true;
  for (const g of b.spec.goals) {
    switch (g.kind) {
      case 'killAir': {
        const total = w.aircraft.filter((a) => a.side === g.side).length;
        const dead = w.aircraft.filter((a) => a.side === g.side && !a.alive).length;
        const fled = w.aircraft.filter((a) => a.side === g.side && a.alive && a.removed).length;
        // aircraft that returned to base no longer threaten the mission
        const pass = total > 0 && dead + fled >= total && dead > 0;
        lines.push(`${pass ? '✔' : '✘'} Destroy enemy aircraft: ${dead}/${total}${fled ? ` (${fled} retreated)` : ''}`);
        ok &&= pass;
        break;
      }
      case 'destroyGroup': {
        const u = b.groupUnits.get(g.group) ?? [];
        const frac = u.length ? u.filter((x) => !x.alive).length / u.length : 0;
        const pass = frac >= g.fraction;
        const gs = b.spec.groups.find((x) => x.id === g.group);
        lines.push(`${pass ? '✔' : '✘'} Destroy ${gs?.name ?? g.group}: ${Math.round(frac * 100)}% (need ${Math.round(g.fraction * 100)}%)`);
        ok &&= pass;
        break;
      }
      case 'survive':
        lines.push(`${p.alive ? '✔' : '✘'} Survive`);
        ok &&= p.alive;
        break;
      case 'land':
        lines.push(`${p.landed ? '✔' : '✘'} Land at an airbase`);
        ok &&= p.landed;
        break;
    }
  }
  const pk = w.kills.filter((k) => k.killerIsPlayer);
  const fate: MissionResult['playerFate'] = p.ejected ? 'ejected' : !p.alive ? 'killed' : p.landed ? 'landed' : 'alive';
  return {
    success: ok,
    status: ok ? 'MISSION SUCCESS' : 'MISSION INCOMPLETE',
    lines,
    playerKillsAir: pk.filter((k) => !k.ground).length,
    playerKillsGround: pk.filter((k) => k.ground).length,
    friendlyLosses: w.kills.filter((k) => !k.ground && k.victimSide === side).length,
    enemyLossesAir: w.kills.filter((k) => !k.ground && k.victimSide !== side).length,
    enemyLossesGround: w.kills.filter((k) => k.ground && k.victimSide !== side).length,
    playerFate: fate,
  };
}

// ------------------------------------------------------------------ instant action / mission setup
export type ScenarioId = 'freeflight' | 'takeoff' | 'bfm_guns' | 'bfm_ir' | 'bvr' | 'furball' | 'strike' | 'sead' | 'cas' | 'scramble';

export const SCENARIOS: Array<{ id: ScenarioId; name: string; desc: string }> = [
  { id: 'freeflight', name: 'Free flight', desc: 'Air start at 15,000 ft near Halvorsen AB. No threats — learn the jet.' },
  { id: 'takeoff', name: 'Takeoff & landing', desc: 'Runway start at Halvorsen AB. Take off, fly the pattern and land.' },
  { id: 'bfm_guns', name: 'BFM: guns only', desc: '1v1 head-on merge at 15,000 ft. Guns only — energy management decides.' },
  { id: 'bfm_ir', name: 'BFM: heaters + guns', desc: '1v1 from 10 nm, IR missiles and guns. Flares, flares, flares.' },
  { id: 'bvr', name: 'BVR 2v2', desc: 'You and a wingman vs. two bandits 50 nm out. Radar missiles, crank and notch.' },
  { id: 'furball', name: 'Furball 4v4', desc: 'Four-ship vs four-ship melee starting at 25 nm.' },
  { id: 'strike', name: 'Strike: supply depot', desc: 'Destroy the Tavrin supply depot. Defended by an SA-6, AAA and a CAP.' },
  { id: 'sead', name: 'SEAD: SAM belt', desc: 'Suppress and destroy the SA-6 and SA-15 sites guarding the Lenva river.' },
  { id: 'cas', name: 'CAS: armor column', desc: 'An enemy armored column is pushing across the front. Stop it.' },
  { id: 'scramble', name: 'Scramble / intercept', desc: 'Runway start at Kestrel. An enemy strike package is inbound — intercept it.' },
];

export interface CustomOptions {
  scenario: ScenarioId;
  aircraftId: string;
  loadoutIndex: number;
  enemyId: string;
  enemyCount: number;
  wingmen: number;
  skill: Skill;
  start: 'air' | 'runway';
  altFt: number;
  timeOfDay: number;
  visibilityKm: number;
  clouds: 'clear' | 'scattered' | 'overcast';
}

export function defaultCustom(): CustomOptions {
  return { scenario: 'bfm_ir', aircraftId: 'f16c', loadoutIndex: 0, enemyId: 'mig29a', enemyCount: 1, wingmen: 0, skill: 'regular', start: 'air', altFt: 15000, timeOfDay: 11, visibilityKm: 80, clouds: 'scattered' };
}

export function pickLoadout(acId: string, keywords: string[]): string[] {
  const def = AIRCRAFT_BY_ID[acId];
  for (const k of keywords) {
    const l = def.loadouts.find((x) => x.name.toLowerCase().startsWith(k.toLowerCase()));
    if (l) return l.stores;
  }
  return def.loadouts[0]?.stores ?? [];
}

export function buildScenario(o: CustomOptions): MissionSpec {
  const pdef = getAircraft(o.aircraftId);
  const enemySide: Side = 'red';
  const playerSide: Side = 'blue';
  const pl = pdef.loadouts[o.loadoutIndex]?.stores ?? pdef.loadouts[0].stores;
  const alt = o.altFt * FT;
  const weather: Weather = { visibilityKm: o.visibilityKm, clouds: o.clouds, cloudBase: o.clouds === 'overcast' ? 2500 : 3500, timeOfDay: o.timeOfDay };
  const AX = 10000, AZ = 70000;   // engagement area south of the front
  const spd = 420 * KT;
  const flights: FlightSpec[] = [];
  const groups: GroupSpec[] = [];
  const goals: MissionGoal[] = [{ kind: 'survive' }];
  const isAA = (id: string) => ['ir', 'sarh', 'arh'].includes(weaponKind(id));
  const playerStart = (x: number, z: number, hdg: number, a = alt, sp = spd): StartSpec =>
    o.start === 'runway' ? { kind: 'runway', airbaseId: 'halvorsen' } : { kind: 'air', x, z, alt: a, hdg, speed: sp };
  const playerFlight = (stores: string[], start: StartSpec, task: AITask = 'sweep', wps?: FlightSpec['waypoints'], target?: string): FlightSpec => ({
    id: 'player', callsign: 'Viper', side: playerSide, aircraftId: o.aircraftId, stores, count: 1 + o.wingmen, skill: 'veteran', task,
    start, homeBase: start.kind === 'runway' ? start.airbaseId : 'halvorsen', player: true, waypoints: wps, targetGroup: target,
  });
  const enemy = (id: string, stores: string[], count: number, start: StartSpec, task: AITask, extra: Partial<FlightSpec> = {}): FlightSpec => ({
    id: `red_${flights.length}`, callsign: '', side: enemySide, aircraftId: id, stores, count, skill: o.skill, task, start, homeBase: 'volsk', ...extra,
  });
  let title = SCENARIOS.find((s) => s.id === o.scenario)?.name ?? 'Mission';
  let brief = SCENARIOS.find((s) => s.id === o.scenario)?.desc ?? '';
  switch (o.scenario) {
    case 'freeflight':
      flights.push(playerFlight(pl, playerStart(-60000, 105000, 0)));
      goals.length = 0;
      break;
    case 'takeoff':
      flights.push(playerFlight(pl, { kind: 'runway', airbaseId: 'halvorsen' }, 'ferry', [
        { x: -45000, z: 100000, alt: 1500, name: 'DOWNWIND' },
        { x: -60000, z: 135000, alt: 600, name: 'FINAL' },
      ]));
      goals.length = 0;
      goals.push({ kind: 'land' });
      break;
    case 'bfm_guns':
      flights.push(playerFlight([], playerStart(AX, AZ + 3 * NM / 2, 0)));
      flights.push(enemy(o.enemyId, [], o.enemyCount, { kind: 'air', x: AX + 600, z: AZ - 3 * NM / 2, alt, hdg: 180, speed: spd }, 'sweep'));
      goals.unshift({ kind: 'killAir', side: enemySide });
      break;
    case 'bfm_ir': {
      let ps = pl.filter((s) => weaponKind(s) === 'ir');
      if (!ps.length) ps = pickLoadout(o.aircraftId, ['BFM', 'Dogfight', 'CAP']).filter((s) => weaponKind(s) === 'ir');
      flights.push(playerFlight(ps, playerStart(AX, AZ + 5 * NM, 0)));
      const es = pickLoadout(o.enemyId, ['Dogfight', 'BFM', 'CAP', 'Internal']).filter((s) => weaponKind(s) === 'ir');
      flights.push(enemy(o.enemyId, es, o.enemyCount, { kind: 'air', x: AX + 800, z: AZ - 5 * NM, alt, hdg: 180, speed: spd }, 'sweep'));
      goals.unshift({ kind: 'killAir', side: enemySide });
      break;
    }
    case 'bvr': case 'furball': {
      const dist = (o.scenario === 'bvr' ? 50 : 25) * NM;
      const a2 = Math.max(alt, 25000 * FT);
      const stores = pl.some(isAA) ? pl : pickLoadout(o.aircraftId, ['CAP', 'Fleet', 'Internal']);
      const pf = playerFlight(stores, playerStart(AX, AZ + dist / 2, 0, a2));
      pf.count = o.scenario === 'furball' ? Math.max(o.wingmen + 1, 4) : Math.max(o.wingmen + 1, 2);
      flights.push(pf);
      flights.push(enemy(o.enemyId, pickLoadout(o.enemyId, ['CAP', 'Internal']), o.scenario === 'furball' ? Math.max(o.enemyCount, 4) : Math.max(o.enemyCount, 2),
        { kind: 'air', x: AX, z: AZ - dist / 2, alt: a2, hdg: 180, speed: spd }, 'sweep'));
      goals.unshift({ kind: 'killAir', side: enemySide });
      break;
    }
    case 'strike': {
      const tx = -20000, tz = -45000;
      groups.push({ id: 'tgt', side: enemySide, kind: 'depot', x: tx, z: tz, name: 'Tavrin Supply Depot' });
      groups.push({ id: 'sam1', side: enemySide, kind: 'sam', samType: 'SA-6', x: tx - 5000, z: tz + 9000, name: 'SA-6 Tavrin' });
      groups.push({ id: 'aaa1', side: enemySide, kind: 'sam', samType: 'AAA', x: tx + 600, z: tz + 500, name: 'AAA' });
      const stores = pl.some((s) => ['bomb', 'lgb', 'agm'].includes(weaponKind(s))) ? pl : pickLoadout(o.aircraftId, ['Strike', 'Precision', 'CAS', 'Bombcat', 'Swing']);
      flights.push(playerFlight(stores, playerStart(tx + 10000, tz + 75000, 350, Math.max(alt, 18000 * FT)), 'strike',
        [{ x: tx + 3000, z: tz + 25000, alt: 5500, name: 'IP' }, { x: tx, z: tz, alt: 3000, name: 'TGT' }], 'tgt'));
      flights.push(enemy(o.enemyId, pickLoadout(o.enemyId, ['CAP', 'Internal']), Math.max(1, o.enemyCount), { kind: 'air', x: tx + 20000, z: tz - 30000, alt: 7000, hdg: 180, speed: 220 }, 'cap',
        { station: { x: tx, z: tz - 10000, alt: 7000 } }));
      goals.unshift({ kind: 'destroyGroup', group: 'tgt', fraction: 0.6 });
      break;
    }
    case 'sead': {
      groups.push({ id: 'sam1', side: enemySide, kind: 'sam', samType: 'SA-6', x: -25000, z: -32000, name: 'SA-6 Tavrin' });
      groups.push({ id: 'sam2', side: enemySide, kind: 'sam', samType: 'SA-15', x: 12000, z: -25000, name: 'SA-15 Lenva' });
      const stores = pl.some((s) => weaponKind(s) === 'arm') ? pl : pickLoadout(o.aircraftId, ['SEAD', 'CAS', 'Strike', 'Precision']);
      flights.push(playerFlight(stores, playerStart(-5000, 40000, 350, Math.max(alt, 20000 * FT)), 'sead',
        [{ x: -15000, z: -10000, alt: 6000, name: 'IP' }, { x: -25000, z: -32000, alt: 6000, name: 'SAM' }], 'sam1'));
      goals.unshift({ kind: 'destroyGroup', group: 'sam1', fraction: 0.5 }, { kind: 'destroyGroup', group: 'sam2', fraction: 0.5 });
      break;
    }
    case 'cas': {
      groups.push({ id: 'armor', side: enemySide, kind: 'armor', x: 30000, z: -2000, heading: Math.PI, name: 'Armored column' });
      groups.push({ id: 'shorad', side: enemySide, kind: 'sam', samType: 'SA-15', x: 31000, z: -6000, name: 'SA-15 escort' });
      const stores = pl.some((s) => ['bomb', 'agm', 'lgb'].includes(weaponKind(s))) ? pl : pickLoadout(o.aircraftId, ['CAS', 'Strike', 'Precision', 'Anti-armor']);
      flights.push(playerFlight(stores, playerStart(30000, 50000, 0, Math.max(alt, 12000 * FT)), 'cas',
        [{ x: 30000, z: 12000, alt: 3000, name: 'CP' }, { x: 30000, z: -2000, alt: 2000, name: 'TGT' }], 'armor'));
      goals.unshift({ kind: 'destroyGroup', group: 'armor', fraction: 0.6 });
      break;
    }
    case 'scramble': {
      const stores = pl.some(isAA) ? pl : pickLoadout(o.aircraftId, ['CAP']);
      flights.push(playerFlight(stores, { kind: 'runway', airbaseId: 'kestrel' }, 'intercept'));
      groups.push({ id: 'kestrel', side: playerSide, kind: 'airbase', objectiveId: 'kestrel', x: 45000, z: 85000, name: 'Kestrel Field' });
      flights.push(enemy('su30', pickLoadout('su30', ['Strike']), 2, { kind: 'air', x: 50000, z: -40000, alt: 6000, hdg: 180, speed: 240 }, 'strike',
        { waypoints: [{ x: 47000, z: 60000, alt: 3000 }], targetGroup: 'kestrel' }));
      flights.push(enemy(o.enemyId, pickLoadout(o.enemyId, ['CAP', 'Internal']), Math.max(1, o.enemyCount), { kind: 'air', x: 52000, z: -46000, alt: 8000, hdg: 180, speed: 250 }, 'escort',
        { waypoints: [{ x: 47000, z: 55000, alt: 8000 }] }));
      goals.unshift({ kind: 'killAir', side: enemySide });
      title = 'Scramble!';
      brief += ' Protect Kestrel Field.';
      break;
    }
  }
  return { title, briefing: brief, weather, flights, groups, goals };
}
