import type { Side } from '../aircraft/types.js';
import { AIRCRAFT_BY_ID, hasCapability } from '../aircraft/defs.js';
import type { Capability } from '../aircraft/types.js';
import { AIRBASES, OBJECTIVES, INITIAL_FRONT, SECTORS, sectorX, frontZAt, airbaseById, requireAirbase, currentTheater, setTheater, type ObjectiveDef } from '../world/theater.js';
import { pickLoadout, callsignFor, type FlightSpec, type GroupSpec, type MissionSpec, type MissionGoal, type BuiltMission, type MissionResult } from '../game/mission.js';
import type { Skill, AITask } from '../ai/pilot.js';
import { WEAPONS } from '../weapons/stores.js';
import { clamp, rng } from '../core/math.js';

export type CampaignTask = 'CAP' | 'Sweep' | 'Escort' | 'SEAD' | 'Strike' | 'OCA' | 'CAS' | 'Intercept';

export interface Squadron {
  id: string; name: string; side: Side; aircraftId: string; baseId: string;
  aircraft: number; maxAircraft: number; pilots: number;
  kills: number; losses: number; sorties: number;
}
export interface ObjectiveState { hp: number; owner: Side; deadTurns: number }
export interface AirbaseState { owner: Side; ops: number }
export interface CFlight {
  id: string; side: Side; squadronId: string; aircraftId: string; count: number; callsign: string;
  task: CampaignTask; targetId: string; targetName: string; x: number; z: number;
  stores: string[]; tot: number; packageId: string; flown?: boolean;
}
export interface CPackage { id: string; side: Side; task: CampaignTask; targetId: string; targetName: string; flights: CFlight[] }
export interface LogEntry { turn: number; day: number; hour: number; text: string; side?: Side }

export interface CampaignState {
  /** save format: 1 = original (implicit Varnia), 2 = adds theaterId */
  version: 2;
  /** theater (map) this campaign is fought in */
  theaterId: string;
  name: string;
  created: number;
  turn: number;
  day: number;
  hour: number;
  playerSide: Side;
  difficulty: Skill;
  front: number[];
  strength: { blue: number[]; red: number[] };
  supply: { blue: number; red: number };
  objectives: Record<string, ObjectiveState>;
  airbases: Record<string, AirbaseState>;
  squadrons: Squadron[];
  ato: CPackage[];
  log: LogEntry[];
  stats: { sorties: number; kills: number; groundKills: number; losses: number; won: number };
  outcome: Side | null;
  seed: number;
}

const SQUADRONS: Array<Pick<Squadron, 'id' | 'name' | 'side' | 'aircraftId' | 'baseId' | 'aircraft'>> = [
  { id: '36fs', name: '36th FS "Flying Fiends"', side: 'blue', aircraftId: 'f16c', baseId: 'halvorsen', aircraft: 18 },
  { id: '44fs', name: '44th FS "Vampire Bats"', side: 'blue', aircraftId: 'f15c', baseId: 'halvorsen', aircraft: 16 },
  { id: 'vf11', name: 'VF-11 "Red Rippers"', side: 'blue', aircraftId: 'f14b', baseId: 'aldren', aircraft: 12 },
  { id: 'vf2', name: 'VF-2 "Bounty Hunters"', side: 'blue', aircraftId: 'f14d', baseId: 'aldren', aircraft: 10 },
  { id: '494fs', name: '494th FS "Panthers"', side: 'blue', aircraftId: 'f15e', baseId: 'halvorsen', aircraft: 16 },
  { id: 'vfa87', name: 'VFA-87 "Golden Warriors"', side: 'blue', aircraftId: 'fa18c', baseId: 'aldren', aircraft: 12 },
  { id: 'vfa103', name: 'VFA-103 "Jolly Rogers" (F/A-18F)', side: 'blue', aircraftId: 'fa18e', baseId: 'aldren', aircraft: 12 },
  { id: 'vma231', name: 'VMA-231 "Ace of Spades"', side: 'blue', aircraftId: 'av8b', baseId: 'kestrel', aircraft: 10 },
  { id: '141fs', name: '141st FS "Tigers" (ANG)', side: 'blue', aircraftId: 'f4e', baseId: 'kestrel', aircraft: 12 },
  { id: 'ec12', name: 'EC 1/2 "Cigognes"', side: 'blue', aircraftId: 'm2000', baseId: 'kestrel', aircraft: 12 },
  { id: 'ec330', name: 'EC 3/30 "Lorraine"', side: 'blue', aircraftId: 'rafale', baseId: 'southreach', aircraft: 12 },
  { id: 'f17', name: 'F 17 "Blekinge Wing"', side: 'blue', aircraftId: 'jas39', baseId: 'southreach', aircraft: 12 },
  { id: 'tlg74', name: 'TLG 74 "Bavarian Tigers"', side: 'blue', aircraftId: 'ef2000', baseId: 'southreach', aircraft: 14 },
  { id: '560fts', name: '560th FTS "Rebels" (training)', side: 'blue', aircraftId: 't38c', baseId: 'halvorsen', aircraft: 8 },
  { id: '28giap', name: '28th GvIAP', side: 'red', aircraftId: 'mig29a', baseId: 'marovka', aircraft: 18 },
  { id: '31giap', name: '31st GvIAP', side: 'red', aircraftId: 'mig29a', baseId: 'zarech', aircraft: 12 },
  { id: '159iap', name: '159th IAP', side: 'red', aircraftId: 'su27', baseId: 'volsk', aircraft: 16 },
  { id: '790iap', name: '790th IAP', side: 'red', aircraftId: 'su27', baseId: 'volsk', aircraft: 12 },
  { id: '23iap', name: '23rd IAP', side: 'red', aircraftId: 'su30', baseId: 'krasnyy', aircraft: 16 },
  { id: '929glits', name: '929th GLITs detachment', side: 'red', aircraftId: 'su57', baseId: 'krasnyy', aircraft: 8 },
];

/** Combat value rating used by the statistical resolver. */
const RATING: Record<string, number> = {
  f15c: 1.25, f16c: 1.1, fa18c: 1.05, fa18e: 1.1, f14b: 1.1, f4e: 0.8, t38c: 0.3, av8b: 0.8,
  mig29a: 1.0, su27: 1.15, su30: 1.2, su57: 1.4, m2000: 1.05, rafale: 1.25, jas39: 1.15, ef2000: 1.3,
  f14a: 1.0, f14b1: 1.05, f14d: 1.2, f16a: 0.85, f16b: 0.8, f16c40: 1.0, f16d40: 0.95, f16d: 1.05, f16c70: 1.25, f16d70: 1.2,
  f15d: 1.2, f15e: 1.3,
};
export const ratingOf = (id: string) => RATING[id] ?? 1;
/** Roles follow from what the variant can carry (see aircraft capabilities). */
const isFighter = (id: string) => { const d = AIRCRAFT_BY_ID[id]; return !!d?.radar && (hasCapability(d, 'bvr') || hasCapability(d, 'ir')); };
const isStriker = (id: string) => { const d = AIRCRAFT_BY_ID[id]; return !!d && ['bombs', 'lgb', 'agm', 'sead'].some((c) => hasCapability(d, c as Capability)) && d.id !== 't38c'; };
const isSead = (id: string) => { const d = AIRCRAFT_BY_ID[id]; return !!d && (hasCapability(d, 'sead') || hasCapability(d, 'lgb')); };

const TASK_LOADOUT: Record<CampaignTask, string[]> = {
  CAP: ['CAP', 'Fleet', 'Internal', 'Light'], Sweep: ['Sweep', 'CAP', 'Internal', 'Fleet'], Escort: ['CAP', 'Internal', 'Light', 'Fighter'],
  Intercept: ['CAP', 'Internal', 'Fleet'], SEAD: ['SEAD', 'Precision', 'Strike'], Strike: ['Precision', 'Strike', 'Swing', 'Bombcat', 'Heavy'],
  OCA: ['Strike', 'Precision', 'Heavy', 'Swing'], CAS: ['CAS', 'Anti-armor', 'Strike', 'Precision'],
};
export const TASK_AI: Record<CampaignTask, AITask> = { CAP: 'cap', Sweep: 'sweep', Escort: 'escort', Intercept: 'intercept', SEAD: 'sead', Strike: 'strike', OCA: 'strike', CAS: 'cas' };

export function loadoutFor(aircraftId: string, task: CampaignTask): string[] { return pickLoadout(aircraftId, TASK_LOADOUT[task]); }
const hasAG = (stores: string[]) => stores.some((s) => ['bomb', 'lgb', 'agm', 'arm'].includes(WEAPONS[s]?.kind));
const hasARM = (stores: string[]) => stores.some((s) => WEAPONS[s]?.kind === 'arm');
const other = (s: Side): Side => (s === 'blue' ? 'red' : 'blue');
export function objDef(id: string): ObjectiveDef | undefined { return OBJECTIVES.find((o) => o.id === id); }
export function squadron(st: CampaignState, id: string) { return st.squadrons.find((s) => s.id === id)!; }

function log(st: CampaignState, text: string, side?: Side) {
  st.log.unshift({ turn: st.turn, day: st.day, hour: st.hour, text, side });
  if (st.log.length > 300) st.log.length = 300;
}

// ------------------------------------------------------------------ creation
export function newCampaign(name: string, difficulty: Skill, seed = Math.floor(Math.random() * 100000), theaterId = 'varnia'): CampaignState {
  setTheater(theaterId);
  const r = rng(seed);
  const st: CampaignState = {
    version: 2, theaterId: currentTheater().id, name, created: Date.now(), turn: 1, day: 1, hour: 6, playerSide: 'blue', difficulty,
    front: [...INITIAL_FRONT],
    strength: { blue: Array.from({ length: SECTORS }, () => 55 + Math.round(r() * 15)), red: Array.from({ length: SECTORS }, () => 58 + Math.round(r() * 15)) },
    supply: { blue: 1, red: 1 },
    objectives: Object.fromEntries(OBJECTIVES.map((o) => [o.id, { hp: 100, owner: o.side, deadTurns: 0 }])),
    airbases: Object.fromEntries(AIRBASES.map((a) => [a.id, { owner: a.side, ops: 100 }])),
    squadrons: SQUADRONS.map((s) => ({ ...s, maxAircraft: s.aircraft, pilots: Math.round(s.aircraft * 1.3), kills: 0, losses: 0, sorties: 0 })),
    ato: [], log: [], stats: { sorties: 0, kills: 0, groundKills: 0, losses: 0, won: 0 }, outcome: null, seed,
  };
  log(st, 'War breaks out on the Varnia Peninsula. Federation forces mass along the Lenva river; Coalition air power is ordered to establish air superiority and blunt the offensive.');
  planTurn(st);
  return st;
}

// ------------------------------------------------------------------ ATO planning
export function planTurn(st: CampaignState) {
  st.ato = [];
  const r = rng(st.seed + st.turn * 101);
  for (const side of ['blue', 'red'] as Side[]) planSide(st, side, r);
}

function planSide(st: CampaignState, side: Side, r: () => number) {
  const enemy = other(side);
  const sq = st.squadrons.filter((s) => s.side === side && s.aircraft >= 2 && s.pilots >= 2 && (st.airbases[s.baseId]?.ops ?? 0) > 25 && s.aircraftId !== 't38c');
  const left = new Map(sq.map((s) => [s.id, Math.floor(s.aircraft * 0.75)]));
  let pk = 0, fl = 0;
  const take = (pred: (s: Squadron) => boolean, n: number, task: CampaignTask) => {
    const cands = sq.filter((s) => pred(s) && (left.get(s.id) ?? 0) >= n)
      .sort((a, b) => ratingOf(b.aircraftId) - ratingOf(a.aircraftId) + (r() - 0.5) * 0.6);
    for (const s of cands) {
      const stores = loadoutFor(s.aircraftId, task);
      if (['Strike', 'OCA', 'CAS', 'SEAD'].includes(task) && !hasAG(stores)) continue;
      if (task === 'SEAD' && !hasARM(stores) && r() < 0.5) continue;
      left.set(s.id, (left.get(s.id) ?? 0) - n);
      return { s, stores };
    }
    return null;
  };
  const addPackage = (task: CampaignTask, targetId: string, targetName: string, x: number, z: number,
    flights: Array<{ task: CampaignTask; pred: (s: Squadron) => boolean; n: number }>) => {
    const pid = `${side}-p${st.turn}-${pk++}`;
    const tot = Math.round(30 + r() * 300);
    const out: CFlight[] = [];
    for (let k = 0; k < flights.length; k++) {
      const f = flights[k];
      const t = take(f.pred, f.n, f.task);
      if (!t) { if (k === 0) return; continue; }
      out.push({
        id: `${side}-${st.turn}-${fl++}`, side, squadronId: t.s.id, aircraftId: t.s.aircraftId, count: f.n,
        callsign: callsignFor(side, fl + st.turn * 3), task: f.task, targetId, targetName, x, z, stores: t.stores, tot: tot + k * 2, packageId: pid,
      });
    }
    st.ato.push({ id: pid, side, task, targetId, targetName, flights: out });
  };
  const fighter = (s: Squadron) => isFighter(s.aircraftId);
  const striker = (s: Squadron) => isStriker(s.aircraftId);
  const seader = (s: Squadron) => isSead(s.aircraftId);
  const dir = side === 'blue' ? -1 : 1; // direction of enemy territory in z

  for (const x of [-50000, 60000]) {
    addPackage('CAP', `cap:${x}`, `CAP ${x < 0 ? 'West' : 'East'}`, x, frontZAt(st.front, x) - dir * 25000, [{ task: 'CAP', pred: fighter, n: 2 }]);
  }
  if (r() < 0.8) {
    const x = (r() - 0.5) * 160000;
    addPackage('Sweep', `sweep:${Math.round(x)}`, 'Fighter sweep', x, frontZAt(st.front, x) + dir * 40000, [{ task: 'Sweep', pred: fighter, n: 2 }]);
  }
  const enemySams = OBJECTIVES.filter((o) => o.kind === 'sam' && o.samType !== 'AAA' && st.objectives[o.id].owner === enemy && st.objectives[o.id].hp > 0)
    .sort((a, b) => Math.abs(a.z - frontZAt(st.front, a.x)) - Math.abs(b.z - frontZAt(st.front, b.x)));
  for (const o of enemySams.slice(0, 2)) addPackage('SEAD', o.id, o.name, o.x, o.z, [{ task: 'SEAD', pred: seader, n: 2 }]);
  const strikeTargets = OBJECTIVES.filter((o) => ['factory', 'depot', 'bridge', 'command', 'radar'].includes(o.kind) && st.objectives[o.id].owner === enemy && st.objectives[o.id].hp > 15)
    .map((o) => ({ o, score: o.value * (st.objectives[o.id].hp / 100) / (1 + Math.abs(o.z - frontZAt(st.front, o.x)) / 80000) * (0.7 + r() * 0.6) }))
    .sort((a, b) => b.score - a.score);
  for (const { o } of strikeTargets.slice(0, 2)) {
    addPackage('Strike', o.id, o.name, o.x, o.z, [{ task: 'Strike', pred: striker, n: 2 }, { task: 'Escort', pred: fighter, n: 2 }]);
  }
  if (r() < 0.45) {
    const b = AIRBASES.filter((a) => st.airbases[a.id].owner === enemy && st.airbases[a.id].ops > 20)
      .sort((a, c) => Math.abs(a.z - frontZAt(st.front, a.x)) - Math.abs(c.z - frontZAt(st.front, c.x)))[0];
    if (b) addPackage('OCA', b.id, b.name, b.x, b.z, [{ task: 'OCA', pred: striker, n: 2 }, { task: 'Escort', pred: fighter, n: 2 }]);
  }
  const hot = st.front.map((_, i) => ({ i, d: Math.abs(st.strength.blue[i] - st.strength.red[i]) + r() * 10 })).sort((a, b) => a.d - b.d);
  for (const { i } of hot.slice(0, 2)) {
    const x = sectorX(i);
    addPackage('CAS', `sector:${i}`, `Front sector ${i + 1}`, x, frontZAt(st.front, x) + dir * 6000, [{ task: 'CAS', pred: striker, n: 2 }]);
  }
}

// ------------------------------------------------------------------ mission generation for the player's flight
export function flightRoute(st: CampaignState, f: CFlight) {
  const base = requireAirbase(squadron(st, f.squadronId).baseId);
  const ip = { x: base.x + (f.x - base.x) * 0.75, z: base.z + (f.z - base.z) * 0.75 };
  return { base, ip, target: { x: f.x, z: f.z } };
}

function hdgTo(a: { x: number; z: number }, b: { x: number; z: number }) {
  return ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
}

export function missionForFlight(st: CampaignState, f: CFlight, start: 'runway' | 'air', storesOverride?: string[]): MissionSpec {
  const sq = squadron(st, f.squadronId);
  const { base, ip, target } = flightRoute(st, f);
  const r = rng(st.seed + st.turn * 7 + f.id.length * 13);
  const groups: GroupSpec[] = [];
  const goals: MissionGoal[] = [{ kind: 'survive' }];
  const enemy = other(f.side);
  const isAA = ['CAP', 'Sweep', 'Escort', 'Intercept'].includes(f.task);
  const cruise = ['Strike', 'OCA', 'SEAD'].includes(f.task) ? 6500 : f.task === 'CAS' ? 4000 : 8000;
  let targetGroup: string | undefined;
  if (['Strike', 'SEAD', 'OCA'].includes(f.task)) {
    const o = objDef(f.targetId);
    const ab = AIRBASES.find((a) => a.id === f.targetId);
    if (o) {
      const kind = (o.kind === 'city' ? 'depot' : o.kind) as GroupSpec['kind'];
      groups.push({ id: 'tgt', side: st.objectives[o.id].owner, kind, samType: o.samType, x: o.x, z: o.z, objectiveId: o.id, survive: st.objectives[o.id].hp / 100, name: o.name });
    } else if (ab) {
      groups.push({ id: 'tgt', side: st.airbases[ab.id].owner, kind: 'airbase', x: ab.x, z: ab.z, objectiveId: ab.id, survive: st.airbases[ab.id].ops / 100, name: ab.name });
    }
    targetGroup = 'tgt';
    goals.unshift({ kind: 'destroyGroup', group: 'tgt', fraction: f.task === 'SEAD' ? 0.4 : 0.5 });
  } else if (f.task === 'CAS') {
    groups.push({ id: 'tgt', side: enemy, kind: 'armor', x: f.x, z: f.z, heading: f.side === 'blue' ? Math.PI : 0, name: `Enemy armor (${f.targetName})`, objectiveId: f.targetId });
    groups.push({ id: 'shorad', side: enemy, kind: 'sam', samType: r() < 0.5 ? 'SA-15' : 'AAA', x: f.x + 1500, z: f.z + (f.side === 'blue' ? -3000 : 3000), name: 'SHORAD' });
    targetGroup = 'tgt';
    goals.unshift({ kind: 'destroyGroup', group: 'tgt', fraction: 0.5 });
  }
  for (const o of OBJECTIVES) {
    if (o.kind !== 'sam' || o.id === f.targetId) continue;
    const os = st.objectives[o.id];
    if (os.owner !== enemy || os.hp <= 0) continue;
    if (Math.min(Math.hypot(o.x - target.x, o.z - target.z), Math.hypot(o.x - ip.x, o.z - ip.z)) < 45000) {
      groups.push({ id: o.id, side: enemy, kind: 'sam', samType: o.samType, x: o.x, z: o.z, objectiveId: o.id, survive: os.hp / 100, name: o.name });
    }
  }
  const flights: FlightSpec[] = [];
  const airStart = { x: base.x + (target.x - base.x) * 0.2, z: base.z + (target.z - base.z) * 0.2 };
  flights.push({
    id: f.id, callsign: f.callsign, side: f.side, aircraftId: f.aircraftId, stores: storesOverride ?? f.stores,
    count: Math.max(1, Math.min(f.count, sq.aircraft)), skill: 'veteran', task: TASK_AI[f.task], squadronId: f.squadronId,
    start: start === 'runway' ? { kind: 'runway', airbaseId: base.id } : { kind: 'air', x: airStart.x, z: airStart.z, alt: cruise, hdg: hdgTo(base, target), speed: 230 },
    homeBase: base.id, player: true, targetGroup,
    waypoints: [
      { x: ip.x, z: ip.z, alt: cruise, name: isAA ? 'CAP' : 'IP' },
      { x: target.x, z: target.z, alt: cruise, name: isAA ? 'STN' : 'TGT' },
    ],
  });
  const pkg = st.ato.find((p) => p.id === f.packageId);
  for (const o of pkg?.flights ?? []) {
    if (o.id === f.id) continue;
    const b2 = requireAirbase(squadron(st, o.squadronId).baseId);
    flights.push({
      id: o.id, callsign: o.callsign, side: o.side, aircraftId: o.aircraftId, stores: o.stores, count: o.count, skill: 'veteran',
      task: TASK_AI[o.task], squadronId: o.squadronId, homeBase: b2.id,
      targetGroup: ['Strike', 'SEAD', 'OCA', 'CAS'].includes(o.task) ? targetGroup : undefined,
      start: { kind: 'air', x: airStart.x + 1500, z: airStart.z + 1500, alt: cruise + 500, hdg: hdgTo(base, target), speed: 230 },
      waypoints: [{ x: ip.x, z: ip.z, alt: cruise }, { x: target.x, z: target.z, alt: cruise }],
      station: o.task === 'Escort' ? { x: target.x, z: target.z, alt: cruise + 1000 } : undefined,
    });
  }
  let enemyCount = 0;
  const maxEnemy = st.difficulty === 'ace' ? 8 : st.difficulty === 'veteran' ? 6 : 4;
  for (const p of st.ato) {
    if (p.side !== enemy) continue;
    for (const o of p.flights) {
      if (!['CAP', 'Sweep', 'Escort'].includes(o.task)) continue;
      const d = Math.min(Math.hypot(o.x - target.x, o.z - target.z), Math.hypot(o.x - ip.x, o.z - ip.z));
      if (d > 90000 || enemyCount + o.count > maxEnemy) continue;
      enemyCount += o.count;
      flights.push({
        id: o.id, callsign: o.callsign, side: enemy, aircraftId: o.aircraftId, stores: o.stores, count: o.count, skill: st.difficulty,
        task: 'cap', squadronId: o.squadronId, homeBase: squadron(st, o.squadronId).baseId,
        start: { kind: 'air', x: o.x, z: o.z, alt: 7000 + r() * 2000, hdg: hdgTo({ x: o.x, z: o.z }, target), speed: 220 },
        station: { x: (o.x + target.x) / 2, z: (o.z + target.z) / 2, alt: 7500 },
      });
    }
  }
  if (isAA && enemyCount === 0) {
    const s2 = st.squadrons.find((s) => s.side === enemy && s.aircraft >= 2 && isFighter(s.aircraftId));
    if (s2) {
      const zOff = enemy === 'red' ? -60000 : 60000;
      flights.push({
        id: `${enemy}-sweep-${st.turn}`, callsign: '', side: enemy, aircraftId: s2.aircraftId, stores: loadoutFor(s2.aircraftId, 'Sweep'), count: 2,
        skill: st.difficulty, task: 'sweep', squadronId: s2.id, homeBase: s2.baseId,
        start: { kind: 'air', x: target.x + (r() - 0.5) * 30000, z: target.z + zOff, alt: 8000, hdg: enemy === 'red' ? 180 : 0, speed: 240 },
        waypoints: [{ x: target.x, z: target.z, alt: 8000 }, { x: ip.x, z: ip.z, alt: 8000 }],
      });
      enemyCount += 2;
    }
  }
  if (isAA && enemyCount > 0) goals.unshift({ kind: 'killAir', side: enemy });
  const hour = st.hour + f.tot / 60;
  return {
    title: `${f.callsign} — ${f.task}: ${f.targetName}`,
    briefing: briefingText(st, f, sq.name, base.name),
    weather: { visibilityKm: 40 + Math.round(r() * 60), clouds: r() < 0.3 ? 'clear' : r() < 0.8 ? 'scattered' : 'overcast', cloudBase: 2500 + r() * 3000, timeOfDay: clamp(hour % 24, 6, 19) },
    flights, groups, goals,
    campaign: { flightId: f.id, turn: st.turn },
    theaterId: st.theaterId,
  };
}

export function briefingText(st: CampaignState, f: CFlight, sqName: string, baseName: string) {
  const task: Record<CampaignTask, string> = {
    CAP: 'Establish a combat air patrol and destroy any enemy aircraft entering the area.',
    Sweep: 'Sweep ahead into enemy airspace and destroy enemy fighters.',
    Escort: 'Escort the strike package to the target and protect it from enemy fighters.',
    Intercept: 'Intercept and destroy inbound enemy aircraft.',
    SEAD: 'Suppress or destroy the enemy air defence site so follow-on strikes can get through.',
    Strike: 'Destroy the assigned target. Expect SAM and fighter opposition.',
    OCA: 'Attack the enemy airbase: hangars and fuel storage reduce their sortie rate.',
    CAS: 'Support friendly ground forces by destroying enemy armor at the front.',
  };
  return `${sqName} out of ${baseName}. ${task[f.task]} Target: ${f.targetName}. Time on target: ${fmtTime(st.hour + f.tot / 60)}.`;
}

export function fmtTime(h: number) {
  const t = ((h % 24) + 24) % 24;
  const hh = Math.floor(t), mm = Math.floor((t - hh) * 60);
  return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}L`;
}

// ------------------------------------------------------------------ results of the player's mission
export function applyMissionResult(st: CampaignState, f: CFlight, b: BuiltMission, res: MissionResult) {
  const w = b.world;
  f.flown = true;
  st.stats.sorties++;
  const enemy = other(f.side);
  for (const k of w.kills) {
    if (k.ground) continue;
    const sq = st.squadrons.find((s) => s.id === k.squadronId);
    if (sq) {
      sq.aircraft = Math.max(0, sq.aircraft - 1);
      sq.losses++;
      if (!(k.victimIsPlayer && b.player.ejected)) sq.pilots = Math.max(0, sq.pilots - 1);
    }
    const killer = w.aircraft.find((a) => a.id === k.killerId);
    const ksq = killer ? st.squadrons.find((s) => s.id === killer.squadronId) : undefined;
    if (ksq) ksq.kills++;
  }
  const psq = st.squadrons.find((s) => s.id === f.squadronId);
  if (psq) psq.sorties += f.count;
  st.stats.kills += res.playerKillsAir;
  st.stats.groundKills += res.playerKillsGround;
  if (res.playerFate === 'killed' || res.playerFate === 'ejected') st.stats.losses++;
  if (res.success) st.stats.won++;
  for (const g of b.spec.groups) {
    const units = b.groupUnits.get(g.id) ?? [];
    if (!units.length || !g.objectiveId) continue;
    const alive = units.filter((u) => u.alive).length / units.length;
    if (g.objectiveId.startsWith('sector:')) {
      const i = Number(g.objectiveId.split(':')[1]);
      st.strength[enemy][i] = Math.max(5, st.strength[enemy][i] - (1 - alive) * 18);
      continue;
    }
    const os = st.objectives[g.objectiveId];
    if (os) {
      let hp = alive * 100;
      if (g.kind === 'sam' && !units[0].alive) hp = 0; // radar dead = site out of action
      os.hp = Math.min(os.hp, hp);
    }
    const ab = st.airbases[g.objectiveId];
    if (ab) ab.ops = Math.min(ab.ops, alive * 100);
  }
  const fate = res.playerFate === 'killed' ? ' Flight lead KIA.' : res.playerFate === 'ejected' ? ' Flight lead ejected.' : '';
  log(st, `${f.callsign} (${psq?.name ?? f.aircraftId}) flew ${f.task} vs ${f.targetName}: ${res.success ? 'successful' : 'unsuccessful'}. Kills A-A ${res.playerKillsAir}, A-G ${res.playerKillsGround}.${fate}`, f.side);
}

// ------------------------------------------------------------------ statistical resolution of the rest of the ATO
export function resolveTurn(st: CampaignState) {
  const r = rng(st.seed + st.turn * 977);
  const lose = (f: CFlight, n: number) => {
    const s = squadron(st, f.squadronId);
    const k = Math.min(n, s.aircraft);
    s.aircraft -= k; s.losses += k; s.pilots = Math.max(0, s.pilots - Math.round(k * 0.6));
    return k;
  };
  const casBonus = { blue: Array(SECTORS).fill(0) as number[], red: Array(SECTORS).fill(0) as number[] };
  const airPower = (side: Side) => st.ato.filter((p) => p.side === side).flatMap((p) => p.flights)
    .filter((f) => ['CAP', 'Sweep', 'Escort', 'Intercept'].includes(f.task)).reduce((a, f) => a + f.count * ratingOf(f.aircraftId), 0);
  const bluePow = airPower('blue') + 0.1, redPow = airPower('red') + 0.1;
  const fights = Math.round(2 + r() * 3);
  for (let i = 0; i < fights; i++) {
    const loserSide: Side = r() < bluePow / (bluePow + redPow) ? 'red' : 'blue';
    const pool = st.ato.filter((p) => p.side === loserSide).flatMap((p) => p.flights).filter((f) => !f.flown);
    const victim = pool[Math.floor(r() * pool.length)];
    if (victim && lose(victim, 1)) {
      const winner = st.ato.filter((p) => p.side !== loserSide).flatMap((p) => p.flights).find((f) => isFighter(f.aircraftId) && !f.flown);
      if (winner) squadron(st, winner.squadronId).kills++;
      log(st, `Air combat: a ${AIRCRAFT_BY_ID[victim.aircraftId].name} of ${squadron(st, victim.squadronId).name} was shot down.`, loserSide);
    }
  }
  for (const p of st.ato) {
    const enemy = other(p.side);
    for (const f of p.flights) {
      if (f.flown) continue;
      squadron(st, f.squadronId).sorties += f.count;
      if (!['Strike', 'SEAD', 'OCA', 'CAS'].includes(f.task)) continue;
      const sams = OBJECTIVES.filter((o) => o.kind === 'sam' && st.objectives[o.id].owner === enemy && st.objectives[o.id].hp > 0 && o.id !== f.targetId
        && Math.hypot(o.x - f.x, o.z - f.z) < 40000).length;
      const hasSead = p.flights.some((x) => x.task === 'SEAD');
      const hasEscort = p.flights.some((x) => x.task === 'Escort');
      const enemyAir = (p.side === 'blue' ? redPow : bluePow) / ((p.side === 'blue' ? bluePow : redPow) + 0.1);
      const base: Record<string, number> = { Strike: 0.6, SEAD: 0.5, OCA: 0.5, CAS: 0.65 };
      let pS = base[f.task] * ratingOf(f.aircraftId);
      pS -= sams * (hasSead ? 0.05 : 0.12);
      pS -= clamp(enemyAir - 1, 0, 1) * (hasEscort ? 0.05 : 0.15);
      pS = clamp(pS, 0.1, 0.9);
      const pLoss = clamp(0.02 + sams * 0.04 * (hasSead ? 0.5 : 1) + clamp(enemyAir - 1, 0, 1) * 0.05, 0.01, 0.3);
      let lost = 0;
      for (let k = 0; k < f.count; k++) if (r() < pLoss) lost += lose(f, 1);
      if (lost) log(st, `${f.callsign} (${AIRCRAFT_BY_ID[f.aircraftId].name}) lost ${lost} aircraft on ${f.task} vs ${f.targetName}.`, p.side);
      if (r() < pS) {
        const dmg = 25 + r() * 45;
        if (f.task === 'CAS') {
          const i = Number(f.targetId.split(':')[1]);
          st.strength[enemy][i] = Math.max(5, st.strength[enemy][i] - dmg * 0.2);
          casBonus[p.side][i] += 1;
        } else if (st.objectives[f.targetId]) {
          const os = st.objectives[f.targetId];
          os.hp = Math.max(0, os.hp - (f.task === 'SEAD' ? dmg * 1.3 : dmg));
          log(st, os.hp <= 0 ? `${f.targetName} destroyed by ${f.callsign}.` : `${f.callsign} struck ${f.targetName} (${Math.round(os.hp)}% remaining).`, p.side);
        } else if (st.airbases[f.targetId]) {
          const ab = st.airbases[f.targetId];
          ab.ops = Math.max(0, ab.ops - dmg);
          log(st, `${f.targetName} hit by OCA strike (ops ${Math.round(ab.ops)}%).`, p.side);
        }
      }
    }
  }
  groundWar(st, r, casBonus);
  logistics(st);
  st.turn++;
  st.hour += 6;
  while (st.hour >= 24) { st.hour -= 24; st.day++; }
  checkVictory(st);
  if (!st.outcome) planTurn(st);
}

function sideSupply(st: CampaignState, side: Side) {
  const vals = OBJECTIVES.filter((o) => ['factory', 'depot', 'bridge', 'command'].includes(o.kind) && o.side === side)
    .map((o) => (st.objectives[o.id].owner === side ? st.objectives[o.id].hp : 0) * (o.kind === 'depot' || o.kind === 'bridge' ? 1.3 : 1));
  return vals.length ? clamp((vals.reduce((a, b) => a + b, 0) / (vals.length * 100)) * 1.1, 0.2, 1.2) : 1;
}

function groundWar(st: CampaignState, r: () => number, cas: { blue: number[]; red: number[] }) {
  st.supply.blue = sideSupply(st, 'blue');
  st.supply.red = sideSupply(st, 'red');
  for (let i = 0; i < SECTORS; i++) {
    const b = st.strength.blue[i] * st.supply.blue * (1 + cas.blue[i] * 0.15) * (0.85 + r() * 0.3);
    const rd = st.strength.red[i] * st.supply.red * (1 + cas.red[i] * 0.15) * (0.85 + r() * 0.3) * 1.05;
    const ratio = b / Math.max(rd, 1);
    st.front[i] = clamp(st.front[i] - clamp((ratio - 1) * 9000, -7000, 7000), -170000, 170000);
    st.strength.blue[i] = clamp(st.strength.blue[i] - (2 + (ratio < 1 ? 3 : 1)) + 2.5 * st.supply.blue, 5, 100);
    st.strength.red[i] = clamp(st.strength.red[i] - (2 + (ratio > 1 ? 3 : 1)) + 2.5 * st.supply.red, 5, 100);
  }
  for (const ab of AIRBASES) {
    const owner: Side = ab.z > frontZAt(st.front, ab.x) ? 'blue' : 'red';
    const s = st.airbases[ab.id];
    if (s.owner === owner) continue;
    s.owner = owner; s.ops = 30;
    log(st, `${ab.name} has been overrun and captured by the ${owner === 'blue' ? 'Coalition' : 'Federation'}!`, owner);
    for (const sq of st.squadrons.filter((q) => q.baseId === ab.id)) {
      const nb = AIRBASES.filter((a) => st.airbases[a.id].owner === sq.side)
        .sort((a, c) => Math.hypot(a.x - ab.x, a.z - ab.z) - Math.hypot(c.x - ab.x, c.z - ab.z))[0];
      if (nb) { sq.baseId = nb.id; sq.aircraft = Math.floor(sq.aircraft * 0.8); log(st, `${sq.name} relocates to ${nb.name}.`, sq.side); }
    }
  }
  for (const o of OBJECTIVES) {
    const owner: Side = o.z > frontZAt(st.front, o.x) ? 'blue' : 'red';
    const s = st.objectives[o.id];
    if (s.owner !== owner) { s.owner = owner; s.hp = Math.min(s.hp, 40); log(st, `${o.name} falls into ${owner === 'blue' ? 'Coalition' : 'Federation'} hands.`, owner); }
  }
}

function logistics(st: CampaignState) {
  for (const o of OBJECTIVES) {
    const s = st.objectives[o.id];
    if (s.hp <= 0) {
      s.deadTurns++;
      if (o.kind === 'sam' && s.deadTurns >= 6) { s.hp = 60; s.deadTurns = 0; log(st, `Intel: ${o.name} appears to have been rebuilt.`, s.owner); }
      else if (o.kind !== 'sam' && s.deadTurns >= 10) { s.hp = 30; s.deadTurns = 0; }
    } else s.hp = Math.min(100, s.hp + 4);
  }
  for (const id of Object.keys(st.airbases)) st.airbases[id].ops = Math.min(100, st.airbases[id].ops + 8);
  for (const side of ['blue', 'red'] as Side[]) {
    const fac = OBJECTIVES.filter((o) => o.kind === 'factory' && o.side === side).map((o) => (st.objectives[o.id].owner === side ? st.objectives[o.id].hp : 0));
    const prod = fac.length ? fac.reduce((a, b) => a + b, 0) / fac.length : 50;
    for (const sq of st.squadrons.filter((s) => s.side === side)) {
      if (prod > 50 && sq.aircraft < sq.maxAircraft && st.turn % 2 === 0) sq.aircraft++;
      if (sq.pilots < sq.aircraft * 1.2 && st.turn % 3 === 0) sq.pilots++;
    }
  }
}

function checkVictory(st: CampaignState) {
  const avg = st.front.reduce((a, b) => a + b, 0) / SECTORS;
  const air = (side: Side) => st.squadrons.filter((s) => s.side === side && s.aircraftId !== 't38c').reduce((a, s) => a + s.aircraft, 0);
  const cmd = (id: string) => st.objectives[id]?.hp ?? 100;
  if (avg < -95000 || air('red') < 8 || (cmd('r_cmd') <= 0 && st.supply.red < 0.4)) {
    st.outcome = 'blue';
    log(st, 'VICTORY: Federation forces have collapsed. The Coalition has won the war for the Varnia Peninsula.', 'blue');
  } else if (avg > 95000 || air('blue') < 8 || (cmd('b_cmd') <= 0 && st.supply.blue < 0.4)) {
    st.outcome = 'red';
    log(st, 'DEFEAT: Coalition forces have been overrun. The Federation controls the peninsula.', 'red');
  } else if (st.turn > 60) {
    st.outcome = avg < 0 ? 'blue' : 'red';
    log(st, `Ceasefire after ${st.day} days. ${avg < 0 ? 'The Coalition holds the advantage.' : 'The Federation holds the advantage.'}`, st.outcome);
  }
}

export function playerFlights(st: CampaignState): CFlight[] {
  return st.ato.filter((p) => p.side === st.playerSide).flatMap((p) => p.flights);
}

// ------------------------------------------------------------------ persistence
const SAVE_KEY = 'cfs.campaign.saves.v1';
export interface SaveSlot { slot: number; name: string; savedAt: number; day: number; turn: number; state: CampaignState }

export function listSaves(): SaveSlot[] {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? '[]'); } catch { return []; }
}
export function saveCampaign(st: CampaignState, slot: number): boolean {
  const saves = listSaves().filter((s) => s.slot !== slot);
  saves.push({ slot, name: st.name, savedAt: Date.now(), day: st.day, turn: st.turn, state: JSON.parse(JSON.stringify(st)) });
  saves.sort((a, b) => a.slot - b.slot);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saves)); return true; } catch { return false; }
}
export function deleteSave(slot: number) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(listSaves().filter((s) => s.slot !== slot))); } catch { /* storage unavailable */ }
}
export function validateState(o: any): CampaignState {
  if (!o || (o.version !== 1 && o.version !== 2) || !Array.isArray(o.front) || !Array.isArray(o.squadrons) || typeof o.turn !== 'number') throw new Error('Not a CFS campaign file');
  // migrations
  if (o.version === 1) { o.theaterId = 'varnia'; o.version = 2; }
  if (typeof o.theaterId !== 'string') o.theaterId = 'varnia';
  return o as CampaignState;
}
