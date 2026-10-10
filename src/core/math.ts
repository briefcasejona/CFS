import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapPi(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
export function wrap360(a: number) {
  a %= 360;
  return a < 0 ? a + 360 : a;
}
/** Approach target value at a max rate. */
export function approach(cur: number, target: number, rate: number, dt: number) {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}
/** Linear interpolation in a sorted table [[x,y],...]. */
export function table1(tbl: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= tbl[0][0]) return tbl[0][1];
  const n = tbl.length;
  if (x >= tbl[n - 1][0]) return tbl[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (x <= tbl[i][0]) {
      const [x0, y0] = tbl[i - 1];
      const [x1, y1] = tbl[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return tbl[n - 1][1];
}

// Seeded PRNG (mulberry32)
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// World convention: x = east, y = up, z = south. Heading 0 = north (-z), clockwise positive.
export function headingOf(v: THREE.Vector3): number {
  return wrap360(Math.atan2(v.x, -v.z) * RAD);
}
export function bearingTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return wrap360(Math.atan2(to.x - from.x, -(to.z - from.z)) * RAD);
}
export function dirFromHeading(hdgDeg: number, out = new THREE.Vector3()) {
  const h = hdgDeg * DEG;
  return out.set(Math.sin(h), 0, -Math.cos(h));
}
/** Quaternion for heading/pitch/roll (degrees). Body: forward -Z, up +Y, right +X. */
export function quatFromHPR(hdg: number, pitch: number, roll: number, out = new THREE.Quaternion()) {
  const e = new THREE.Euler(pitch * DEG, -hdg * DEG, -roll * DEG, 'YXZ');
  return out.setFromEuler(e);
}
export function hprFromQuat(q: THREE.Quaternion) {
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { hdg: wrap360(-e.y * RAD), pitch: e.x * RAD, roll: -e.z * RAD };
}
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
