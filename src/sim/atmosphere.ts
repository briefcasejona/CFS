// International Standard Atmosphere (ISA 1976), valid 0..32 km.
export const G0 = 9.80665;
export const RHO0 = 1.225;
const R = 287.05287;
const GAMMA = 1.4;
const T0 = 288.15;
const P0 = 101325;

export interface AtmoState {
  T: number;   // K
  p: number;   // Pa
  rho: number; // kg/m3
  a: number;   // speed of sound m/s
  sigma: number; // density ratio
}

export function atmosphere(altM: number, out?: AtmoState): AtmoState {
  const h = Math.max(-500, Math.min(32000, altM));
  let T: number, p: number;
  if (h <= 11000) {
    T = T0 - 0.0065 * h;
    p = P0 * Math.pow(T / T0, 5.255877);
  } else if (h <= 20000) {
    T = 216.65;
    p = 22632.06 * Math.exp(-G0 * (h - 11000) / (R * T));
  } else {
    T = 216.65 + 0.001 * (h - 20000);
    p = 5474.889 * Math.pow(T / 216.65, -34.1632);
  }
  const rho = p / (R * T);
  const o = out ?? ({} as AtmoState);
  o.T = T; o.p = p; o.rho = rho; o.a = Math.sqrt(GAMMA * R * T); o.sigma = rho / RHO0;
  return o;
}

export const KT = 0.514444;       // m/s per knot
export const FT = 0.3048;         // m per foot
export const NM = 1852;           // m per nautical mile
export const LB = 0.45359237;     // kg per lb
export const LBF = 4.4482216;     // N per lbf

/** Calibrated/indicated airspeed approximation (subsonic compressible) in m/s. */
export function casFromTas(tas: number, altM: number): number {
  const at = atmosphere(altM);
  const M = tas / at.a;
  const qc = at.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return 340.294 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
