// Minimal expect() shim on top of node:test / node:assert (no native deps required).
import assert from 'node:assert/strict';
export { describe, it } from 'node:test';

export function expect(actual: any, msg?: string) {
  return {
    toBe: (v: any) => assert.equal(actual, v, msg),
    toEqual: (v: any) => assert.deepEqual(actual, v, msg),
    toBeGreaterThan: (v: number) => assert.ok(actual > v, msg ?? `${actual} > ${v}`),
    toBeLessThan: (v: number) => assert.ok(actual < v, msg ?? `${actual} < ${v}`),
    toBeCloseTo: (v: number, digits = 2) => assert.ok(Math.abs(actual - v) < Math.pow(10, -digits) / 2, msg ?? `${actual} ≈ ${v}`),
    toBeTruthy: () => assert.ok(actual, msg),
  };
}
