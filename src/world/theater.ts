import { clamp, rng, smoothstep } from '../core/math.js';
import type { Side } from '../aircraft/types.js';

/**
 * The Varnia theater: a fictional 400 x 400 km peninsula.
 * World x = east, z = south. Federation (RED) holds the north, Coalition (BLUE) the south.
 */
export const THEATER_HALF = 200000;
export const THEATER_NAME = 'Varnia Peninsula';

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

export const AIRBASES: Airbase[] = [
  { id: 'halvorsen', name: 'Halvorsen AB', side: 'blue', x: -60000, z: 120000, hdg: 10, length: 3200, elev: 0 },
  { id: 'kestrel', name: 'Kestrel Field', side: 'blue', x: 45000, z: 85000, hdg: 350, length: 2800, elev: 0 },
  { id: 'aldren', name: 'Port Aldren NAS', side: 'blue', x: -100000, z: 150000, hdg: 40, length: 2600, elev: 0 },
  { id: 'southreach', name: 'Southreach AB', side: 'blue', x: 115000, z: 160000, hdg: 330, length: 3200, elev: 0 },
  { id: 'volsk', name: 'Volsk AB', side: 'red', x: -50000, z: -115000, hdg: 190, length: 3200, elev: 0 },
  { id: 'marovka', name: 'Marovka AB', side: 'red', x: 55000, z: -80000, hdg: 170, length: 2800, elev: 0 },
  { id: 'krasnyy', name: 'Krasnyy Bor AB', side: 'red', x: 125000, z: -155000, hdg: 200, length: 3200, elev: 0 },
  { id: 'zarech', name: 'Zarech Highway Strip', side: 'red', x: -110000, z: -70000, hdg: 160, length: 2400, elev: 0 },
];

export const OBJECTIVES: ObjectiveDef[] = [
  // Federation (red)
  { id: 'r_fac1', name: 'Volsk Aircraft Plant', kind: 'factory', side: 'red', x: -35000, z: -135000, value: 8 },
  { id: 'r_fac2', name: 'Marovka Refinery', kind: 'factory', side: 'red', x: 75000, z: -105000, value: 7 },
  { id: 'r_dep1', name: 'Tavrin Supply Depot', kind: 'depot', side: 'red', x: -20000, z: -45000, value: 6 },
  { id: 'r_dep2', name: 'Orsk Ammunition Depot', kind: 'depot', side: 'red', x: 70000, z: -40000, value: 6 },
  { id: 'r_brg1', name: 'Lenva River Bridge', kind: 'bridge', side: 'red', x: 10000, z: -30000, value: 5 },
  { id: 'r_cmd', name: 'Federation Northern Command', kind: 'command', side: 'red', x: 20000, z: -140000, value: 9 },
  { id: 'r_rad1', name: 'Hill 812 EW Radar', kind: 'radar', side: 'red', x: 0, z: -60000, value: 5 },
  { id: 'r_sam1', name: 'SA-10 Volsk', kind: 'sam', side: 'red', samType: 'SA-10', x: -45000, z: -100000, value: 7 },
  { id: 'r_sam2', name: 'SA-6 Tavrin', kind: 'sam', side: 'red', samType: 'SA-6', x: -25000, z: -32000, value: 5 },
  { id: 'r_sam3', name: 'SA-6 Orsk', kind: 'sam', side: 'red', samType: 'SA-6', x: 60000, z: -30000, value: 5 },
  { id: 'r_sam4', name: 'SA-2 Marovka', kind: 'sam', side: 'red', samType: 'SA-2', x: 50000, z: -95000, value: 4 },
  { id: 'r_sam5', name: 'SA-15 Lenva', kind: 'sam', side: 'red', samType: 'SA-15', x: 12000, z: -25000, value: 4 },
  { id: 'r_aaa1', name: 'AAA Volsk', kind: 'sam', side: 'red', samType: 'AAA', x: -52000, z: -112000, value: 2 },
  { id: 'r_city', name: 'Volsk', kind: 'city', side: 'red', x: -40000, z: -125000, value: 3 },
  // Coalition (blue)
  { id: 'b_fac1', name: 'Aldren Shipyards', kind: 'factory', side: 'blue', x: -95000, z: 162000, value: 7 },
  { id: 'b_fac2', name: 'Southreach Power Plant', kind: 'factory', side: 'blue', x: 95000, z: 140000, value: 7 },
  { id: 'b_dep1', name: 'Mirren Logistics Hub', kind: 'depot', side: 'blue', x: -10000, z: 45000, value: 6 },
  { id: 'b_dep2', name: 'Eastgate Depot', kind: 'depot', side: 'blue', x: 80000, z: 50000, value: 6 },
  { id: 'b_brg1', name: 'Calder Bridge', kind: 'bridge', side: 'blue', x: 20000, z: 30000, value: 5 },
  { id: 'b_cmd', name: 'Coalition Joint HQ', kind: 'command', side: 'blue', x: -20000, z: 140000, value: 9 },
  { id: 'b_rad1', name: 'Ridge Station EW Radar', kind: 'radar', side: 'blue', x: 30000, z: 60000, value: 5 },
  { id: 'b_sam1', name: 'Patriot Halvorsen', kind: 'sam', side: 'blue', samType: 'Patriot', x: -50000, z: 110000, value: 7 },
  { id: 'b_sam2', name: 'Hawk Mirren', kind: 'sam', side: 'blue', samType: 'Hawk', x: -5000, z: 35000, value: 5 },
  { id: 'b_sam3', name: 'Hawk Eastgate', kind: 'sam', side: 'blue', samType: 'Hawk', x: 75000, z: 40000, value: 5 },
  { id: 'b_city', name: 'Mirren', kind: 'city', side: 'blue', x: 0, z: 55000, value: 3 },
];

/** Frontline: z position per sector (sector i spans x from -200km + i*50km). */
export const SECTORS = 8;
export const INITIAL_FRONT = [5000, 0, -5000, 0, 8000, 5000, -3000, 0];
export const sectorX = (i: number) => -THEATER_HALF + (i + 0.5) * (2 * THEATER_HALF / SECTORS);

// ------------------------------------------------------------------ terrain
const PERM = new Uint8Array(512);
{
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1, -1];
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const h00 = PERM[X + PERM[Y]] & 7, h10 = PERM[X + 1 + PERM[Y]] & 7;
  const h01 = PERM[X + PERM[Y + 1]] & 7, h11 = PERM[X + 1 + PERM[Y + 1]] & 7;
  const n00 = GX[h00] * xf + GY[h00] * yf;
  const n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
  const n01 = GX[h01] * xf + GY[h01] * (yf - 1);
  const n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
  const u = fade(xf), v = fade(yf);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}
export function fbm(x: number, y: number, oct: number) {
  let a = 0, f = 1, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) { a += noise2(x * f, y * f) * amp; norm += amp; f *= 2.03; amp *= 0.5; }
  return a / norm;
}
function ridged(x: number, y: number, oct: number) {
  let a = 0, f = 1, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) { a += (1 - Math.abs(noise2(x * f + 31.7, y * f - 12.1))) * amp; norm += amp; f *= 2.1; amp *= 0.5; }
  return a / norm;
}

/** Raw terrain without airbase flattening. Negative = sea floor. */
function rawHeight(x: number, z: number): number {
  const nx = x / 1000, nz = z / 1000; // km
  const coast = -150 + fbm(nz * 0.012, 3.3, 4) * 60 + (nz > 100 ? (nz - 100) * 0.35 : 0);
  const land = smoothstep(coast - 8, coast + 12, nx);
  const eastCoast = 185 + fbm(nz * 0.015, 9.1, 3) * 15;
  const land2 = 1 - smoothstep(eastCoast - 10, eastCoast + 5, nx);
  const landMask = land * land2;
  let h = 80 + fbm(nx * 0.02, nz * 0.02, 5) * 350 + fbm(nx * 0.08, nz * 0.08, 3) * 90;
  const mtnMask = smoothstep(-40, -140, nz) * smoothstep(-80, 20, nx) + 0.6 * Math.exp(-(((nx - 90) / 40) ** 2) - ((nz - 20) / 60) ** 2);
  h += Math.max(0, ridged(nx * 0.015, nz * 0.015, 5) - 0.45) * 4200 * clamp(mtnMask, 0, 1.2);
  const riverZ = -25 + fbm(nx * 0.01, 7.7, 3) * 25;
  h -= 120 * Math.exp(-(((nz - riverZ) / 3) ** 2));
  h = Math.max(h, 15);
  return h * landMask - 60 * (1 - landMask);
}

for (const ab of AIRBASES) ab.elev = Math.max(5, rawHeight(ab.x, ab.z));

/** Terrain height (m) at world x,z. Airbase areas are flattened. Sea floor is negative. */
export function terrainHeight(x: number, z: number): number {
  let h = rawHeight(x, z);
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
