import { describe, expect, it } from './expect.js';
import { AIRCRAFT, getAircraft, mergeDeep, resolveVariant, hasCapability, familyOf } from '../src/aircraft/defs.js';
import { WEAPONS } from '../src/weapons/stores.js';

describe('aircraft variant system', () => {
  it('mergeDeep merges objects, replaces arrays and primitives', () => {
    const base = { a: 1, o: { x: 1, y: 2 }, arr: [1, 2, 3], n: { k: 1 } as { k: number } | null };
    const m = mergeDeep(base, { o: { y: 5 }, arr: [9], n: null });
    expect(m).toEqual({ a: 1, o: { x: 1, y: 5 }, arr: [9], n: null });
    expect(base.o.y).toBe(2); // base untouched
  });

  it('resolveVariant applies overrides on top of the base airframe', () => {
    const base = getAircraft('f16c');
    const v = resolveVariant(base, { id: 'f16x', extends: 'f16c', overrides: { name: 'F-16X', engine: { milThrust: 1 }, loadouts: [] } });
    expect(v.id).toBe('f16x');
    expect(v.engine.milThrust).toBe(1);
    expect(v.engine.abThrust).toBe(base.engine.abThrust);
    expect(v.loadouts.length).toBe(0);
    expect(v.aero).toEqual(base.aero);
  });

  it('every aircraft is finalised with family, seats, capabilities and legal loadouts', () => {
    for (const a of AIRCRAFT) {
      expect(!!a.family, `${a.id} family`).toBe(true);
      expect(a.seats === 1 || a.seats === 2, `${a.id} seats`).toBe(true);
      expect(Array.isArray(a.capabilities), `${a.id} caps`).toBe(true);
      for (const l of a.loadouts) for (const s of l.stores) if (s) {
        expect(!!WEAPONS[s], `${a.id} store ${s} exists`).toBe(true);
        expect(a.allowedStores!.includes(s), `${a.id} may carry ${s}`).toBe(true);
      }
    }
    expect(new Set(AIRCRAFT.map((a) => a.id)).size).toBe(AIRCRAFT.length);
  });

  it('derives capabilities from stores and systems', () => {
    const f16 = getAircraft('f16c');
    for (const c of ['bvr', 'ir', 'gun', 'sead', 'lgb', 'agm', 'bombs'] as const) expect(hasCapability(f16, c), `F-16 ${c}`).toBe(true);
    expect(hasCapability(getAircraft('f14b'), 'carrier')).toBe(true);
    expect(hasCapability(getAircraft('f14b'), 'swing-wing')).toBe(true);
    expect(hasCapability(getAircraft('av8b'), 'stovl')).toBe(true);
    expect(hasCapability(getAircraft('t38c'), 'bvr')).toBe(false);
    expect(familyOf(getAircraft('f16c').family!).length).toBeGreaterThan(0);
  });
});
