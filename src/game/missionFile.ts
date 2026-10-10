// Mission files: validation, local library, and share links (#mission=… deflate + base64url).
import { AIRCRAFT_BY_ID } from '../aircraft/defs.js';
import type { MissionSpec } from './mission.js';

export const MISSION_FILE_VERSION = 1;
const LIB_KEY = 'cfs.missions.v1';

/** Throws with a readable message when the object is not a usable MissionSpec; returns it typed otherwise. */
export function validateMissionSpec(o: any): MissionSpec {
  const fail = (m: string): never => { throw new Error(`Not a valid CFS mission: ${m}`); };
  if (!o || typeof o !== 'object') fail('empty');
  if (typeof o.title !== 'string') fail('missing title');
  if (!Array.isArray(o.flights) || !o.flights.length) fail('no flights');
  if (!Array.isArray(o.groups)) fail('groups missing');
  if (!Array.isArray(o.goals)) fail('goals missing');
  if (!o.weather || typeof o.weather.timeOfDay !== 'number') fail('weather missing');
  const players = o.flights.filter((f: any) => f.player);
  if (players.length !== 1) fail('exactly one flight must be the player flight');
  const ids = new Set<string>();
  for (const f of o.flights) {
    if (!AIRCRAFT_BY_ID[f.aircraftId]) fail(`unknown aircraft ${f.aircraftId}`);
    if (f.side !== 'blue' && f.side !== 'red') fail(`bad side on ${f.id}`);
    if (!(f.count >= 1 && f.count <= 8)) fail(`bad count on ${f.id}`);
    if (!f.start || !['air', 'runway', 'carrier'].includes(f.start.kind)) fail(`bad start on ${f.id}`);
    if (f.start.kind === 'carrier' && !(o.carriers ?? []).some((c: any) => c.id === f.start.carrierId)) fail(`${f.id} starts on an unknown carrier`);
    if (ids.has(f.id)) fail(`duplicate flight id ${f.id}`);
    ids.add(f.id);
  }
  if (o.carriers !== undefined) {
    if (!Array.isArray(o.carriers)) fail('carriers must be a list');
    for (const c of o.carriers) {
      if (typeof c.id !== 'string' || !Number.isFinite(c.x) || !Number.isFinite(c.z) || !Number.isFinite(c.hdg) || !(c.speedKt >= 0 && c.speedKt <= 35)) fail('bad carrier');
      if (c.side !== 'blue' && c.side !== 'red') fail(`bad side on carrier ${c.id}`);
    }
  }
  for (const g of o.goals) if (g.kind === 'destroyGroup' && !o.groups.some((x: any) => x.id === g.group)) fail(`goal references missing group ${g.group}`);
  return o as MissionSpec;
}

// ------------------------------------------------------------------ share links
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compact share token for a mission (deflate-raw + base64url). */
export async function encodeMission(spec: MissionSpec): Promise<string> {
  const json = JSON.stringify({ v: MISSION_FILE_VERSION, m: spec });
  return b64url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

export async function decodeMission(token: string): Promise<MissionSpec> {
  const json = new TextDecoder().decode(await pipe(fromB64url(token), new DecompressionStream('deflate-raw')));
  const o = JSON.parse(json);
  return validateMissionSpec(o.m ?? o);
}

// ------------------------------------------------------------------ local library
export interface SavedMission { name: string; savedAt: number; spec: MissionSpec }

export function listMissions(): SavedMission[] {
  try { return JSON.parse(localStorage.getItem(LIB_KEY) ?? '[]'); } catch { return []; }
}
export function saveMission(spec: MissionSpec): boolean {
  const list = listMissions().filter((m) => m.name !== spec.title);
  list.unshift({ name: spec.title, savedAt: Date.now(), spec });
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list.slice(0, 50))); return true; } catch { return false; }
}
export function deleteMission(name: string) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(listMissions().filter((m) => m.name !== name))); } catch { /* storage unavailable */ }
}
