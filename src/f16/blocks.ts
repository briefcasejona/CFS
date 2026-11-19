// The F-16 blocks of the HFFM Manual (sec. 3: engine, empty weight, internal fuel) and what the game maps to them.

export type EngineId = 'F100-PW-200' | 'F100-PW-220' | 'F100-PW-229' | 'F110-GE-100' | 'F110-GE-129';

export interface BlockSpec {
  block: string;
  /** which lift/drag charts: the A/B airframe or the C/D airframe (HFFM sec. 1.2) */
  airframe: 'AB' | 'CD';
  engine: EngineId;
  /** lb, HFFM sec. 3 */
  emptyLb: number;
  fuelLb: number;
  /** CAT I limiter maximum G: 9.3 for the A/B, 9 for the C/D (HFFM sec. 1.3) */
  gMax: number;
}

/** HFFM Manual sec. 3.1 – 3.5 */
export const BLOCKS: Record<string, BlockSpec> = {
  '15': { block: '15', airframe: 'AB', engine: 'F100-PW-200', emptyLb: 16800, fuelLb: 7162, gMax: 9.3 },   // 3.1
  '30': { block: '30', airframe: 'CD', engine: 'F110-GE-100', emptyLb: 18700, fuelLb: 7162, gMax: 9 },     // 3.3
  '32': { block: '32', airframe: 'CD', engine: 'F100-PW-220', emptyLb: 17914, fuelLb: 7162, gMax: 9 },     // 3.3
  '40': { block: '40', airframe: 'CD', engine: 'F110-GE-100', emptyLb: 20186, fuelLb: 7162, gMax: 9 },     // 3.4
  '42': { block: '42', airframe: 'CD', engine: 'F100-PW-220', emptyLb: 19500, fuelLb: 7162, gMax: 9 },     // 3.4
  '50': { block: '50', airframe: 'CD', engine: 'F110-GE-129', emptyLb: 19975, fuelLb: 7162, gMax: 9 },     // 3.5
  '52': { block: '52', airframe: 'CD', engine: 'F100-PW-229', emptyLb: 19635, fuelLb: 7162, gMax: 9 },     // 3.5
};

/** Aircraft id → HFFM block. The flyable F-16s are exactly the HFFM blocks. The two-seaters and the Block 70 stay in
 *  the game as AI aircraft only; the HFFM has no data for them, so they fly on the nearest block's tables. */
export const BLOCK_OF: Record<string, string> = {
  f16a: '15', f16c30: '30', f16c32: '32', f16c40: '40', f16c42: '42', f16c: '50', f16c52: '52',
  // AI only (not in the HFFM)
  f16b: '15', f16d40: '40', f16d: '50', f16c70: '50', f16d70: '50',
};

export function blockFor(id: string): BlockSpec | null {
  const b = BLOCK_OF[id];
  return b ? BLOCKS[b] : null;
}

export const LB = 0.45359237;
export const LBF = 4.4482216;
export const FT = 0.3048;
