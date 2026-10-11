import { clamp, smoothstep } from '../core/math.js';
import type { Side } from '../aircraft/types.js';
import { VARNIA } from './theaters/varnia.js';
import { EUROPE } from './theaters/europe.js';
import { GULF } from './theaters/gulf.js';
import type { CarrierSpec } from '../sim/carrier.js';

export { fbm } from './noise.js';

/**
 * Theaters (maps). World frame: x = east, z = south (metres, origin at the theater centre).
 * The active theater is chosen with setTheater(); the exported constants below are ES-module live bindings,
 * so every importer automatically sees the active theater's data.
 */
export interface Airbase {
  id: string;
  name: string;
  side: Side;
  x: number; z: number;
  hdg: number;        // runway heading deg (true)
  length: number;     // m
  elev: number;       // m (computed)
}

export type ObjectiveKind = 'factory' | 'depot' | 'bridge' | 'radar' | 'sam' | 'city' | 'command' | 'airbase';
export type SamType = 'SA-10' | 'SA-6' | 'SA-2' | 'SA-15' | 'Patriot' | 'Hawk' | 'AAA';

export interface ObjectiveDef {
  id: string;
  name: string;
  kind: ObjectiveKind;
  side: Side;
  x: number; z: number;
  samType?: SamType;
  value: number;      // strategic value 1..10
}

export interface Theater {
  id: string;
  name: string;
  description: string;
  /** half extent (m): the playable area is x, z ∈ [−half, half] */
  half: number;
  /** display names of the two coalitions */
  factions: { blue: string; red: string };
  /** nations in each coalition (ids from nations.ts); the first is the default for new flights */
  nations: { blue: string[]; red: string[] };
  /** terrain height without airbase flattening; negative = sea floor */
  rawHeight(x: number, z: number): number;
  airbases: Airbase[];
  objectives: ObjectiveDef[];
  /** campaign frontline: number of sectors across x and the initial front z per sector */
  sectors: number;
  initialFront: number[];
  /** false when the dynamic campaign is not available here yet */
  campaign?: boolean;
  /** Instant Action engagement area: centre, bearing towards the enemy (deg), and the bases scenarios use */
  iaAnchor?: { x: number; z: number; enemyHdg: number; blueBase: string; redBase: string };
  /** asynchronous data load (e.g. a DEM) — call ensureTheater() before flying here */
  load?: () => Promise<void>;
  /** terrain colouring overrides (defaults suit the fictional Varnia) */
  palette?: Partial<TerrainPalette>;
  /** carrier groups at sea (positions at mission start, open water for at least an hour's steaming) */
  carriers?: CarrierSpec[];
  /** map overlay (real-world theaters): border polylines as flat x,z pairs in 100 m units; cities [name, x, z, capital] */
  overlay?: { borders: number[][]; cities: Array<[string, number, number, number]> };
}

export interface TerrainPalette {
  /** land below this height (m) is drawn as sand/beach */
  beach: number;
  /** permanent snow from this height (m) at a point */
  snowLine: (x: number, z: number) => number;
  /** bare rock starts this far (m) below the snowline */
  rockBelowSnow: number;
  /** ground cover: green fields and forests, or sand and gravel */
  style: 'temperate' | 'desert';
  /** instanced forest trees near the camera */
  trees: boolean;
}
const DEFAULT_PALETTE: TerrainPalette = { beach: 8, snowLine: () => 1900, rockBelowSnow: 200, style: 'temperate', trees: true };
export function terrainPalette(): TerrainPalette { return { ...DEFAULT_PALETTE, ...current.palette }; }

const REGISTRY = new Map<string, Theater>();
let current: Theater = VARNIA;

export let THEATER_HALF = VARNIA.half;
export let THEATER_NAME = VARNIA.name;
export let AIRBASES: Airbase[] = VARNIA.airbases;
export let OBJECTIVES: ObjectiveDef[] = VARNIA.objectives;
/** Frontline: z position per sector (sector i spans x from -half + i*width). */
export let SECTORS = VARNIA.sectors;
export let INITIAL_FRONT: number[] = VARNIA.initialFront;
/** Bumped on every theater switch so caches (terrain meshes, map images) know to rebuild. */
export let theaterVersion = 0;

export function registerTheater(t: Theater) {
  for (const ab of t.airbases) ab.elev = Math.max(5, t.rawHeight(ab.x, ab.z));
  REGISTRY.set(t.id, t);
}
export function listTheaters(): Theater[] { return [...REGISTRY.values()]; }
export function currentTheater(): Theater { return current; }
export function theaterById(id: string | undefined): Theater { return (id && REGISTRY.get(id)) || VARNIA; }

/** Make `id` the active theater (no-op if it already is). Unknown ids fall back to Varnia. */
export function setTheater(id: string | undefined): Theater {
  const t = (id && REGISTRY.get(id)) || VARNIA;
  if (t === current) return t;
  current = t;
  THEATER_HALF = t.half;
  THEATER_NAME = t.name;
  AIRBASES = t.airbases;
  OBJECTIVES = t.objectives;
  SECTORS = t.sectors;
  INITIAL_FRONT = t.initialFront;
  theaterVersion++;
  return t;
}

registerTheater(VARNIA);
registerTheater(EUROPE);
registerTheater(GULF);

/** Load a theater's data if needed (DEM download) — resolves when it can be flown. */
export async function ensureTheater(id: string | undefined): Promise<Theater> {
  const t = (id && REGISTRY.get(id)) || VARNIA;
  if (t.load) await t.load();
  return t;
}

export const sectorX = (i: number) => -THEATER_HALF + (i + 0.5) * (2 * THEATER_HALF / SECTORS);

/** Terrain height (m) at world x,z. Airbase areas are flattened. Sea floor is negative. */
export function terrainHeight(x: number, z: number): number {
  let h = current.rawHeight(x, z);
  for (let i = 0; i < AIRBASES.length; i++) {
    const ab = AIRBASES[i];
    const dx = x - ab.x, dz = z - ab.z;
    if (Math.abs(dx) > 6000 || Math.abs(dz) > 6000) continue;
    const hr = ab.hdg * Math.PI / 180;
    const along = dx * Math.sin(hr) - dz * Math.cos(hr);
    const across = dx * Math.cos(hr) + dz * Math.sin(hr);
    const ex = Math.max(0, Math.abs(along) - ab.length / 2 - 400);
    const ey = Math.max(0, Math.abs(across) - 700);
    const d = Math.hypot(ex, ey);
    const w = 1 - smoothstep(0, 2500, d);
    h = h * (1 - w) + ab.elev * w;
  }
  return h;
}

export function isWater(x: number, z: number): boolean {
  return terrainHeight(x, z) <= 0;
}

/** Height including sea surface (for AGL / LOS). */
export function surfaceHeight(x: number, z: number): number {
  return Math.max(0, terrainHeight(x, z));
}

/** Line of sight check between two points (terrain masking), sampled. */
export function lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, steps = 24): boolean {
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    if (surfaceHeight(x, z) > y) return false;
  }
  return true;
}

export function runwayEnds(ab: Airbase) {
  const hr = ab.hdg * Math.PI / 180;
  const dx = Math.sin(hr), dz = -Math.cos(hr);
  const h = ab.length / 2;
  return {
    start: { x: ab.x - dx * h, z: ab.z - dz * h },
    end: { x: ab.x + dx * h, z: ab.z + dz * h },
    dir: { x: dx, z: dz },
  };
}

export function frontZAt(front: number[], x: number): number {
  const w = (2 * THEATER_HALF) / SECTORS;
  const f = (x + THEATER_HALF) / w - 0.5;
  const i = clamp(Math.floor(f), 0, SECTORS - 1);
  const j = clamp(i + 1, 0, SECTORS - 1);
  const t = clamp(f - i, 0, 1);
  return front[i] * (1 - t) + front[j] * t;
}

/** Default nation for a side in the active theater. */
export function defaultNation(side: Side): string { return current.nations[side][0]; }

export function airbaseById(id: string) { return AIRBASES.find((a) => a.id === id)!; }
export function nearestAirbase(x: number, z: number, side?: Side) {
  let best: Airbase | null = null, bd = Infinity;
  for (const a of AIRBASES) {
    if (side && a.side !== side) continue;
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd) { bd = d; best = a; }
  }
  return best!;
}
