import { describe, expect, it } from './expect.js';

// minimal browser stand-ins for the input manager
type Pad = { id: string; index: number; connected: boolean; mapping: string; axes: number[]; buttons: Array<{ pressed: boolean; value: number }> };
const pads: Pad[] = [];
const g = globalThis as Record<string, unknown>;
g.window ??= { addEventListener() {} };
const store = new Map<string, string>();
g.localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });

const { InputManager } = await import('../src/input/input.js');
import type { Binding } from '../src/input/input.js';

const btn = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, value });
function hotas(): Pad {
  // buttons 0..7; button 5 = one side of an on-on switch (always held); axes 0..2 stick/throttle, axis 3 = 3-position switch
  return { id: 'Test HOTAS (Vendor: 1234 Product: 5678)', index: 0, connected: true, mapping: '', axes: [0, 0, -1, 0], buttons: Array.from({ length: 8 }, (_, i) => btn(i === 5)) };
}

function capture(im: InstanceType<typeof InputManager>, type: 'button' | 'axis', steps: Array<(p: Pad) => void>, prefer?: string): Binding | null {
  let got: Binding | null | undefined;
  im.startCapture(type, (b) => { got = b; }, prefer);
  for (const step of steps) { step(pads[0]); im.poll(); if (got !== undefined) break; }
  return got ?? null;
}

describe('HOTAS binding', () => {
  it('a switch that is already on does not steal the binding; a fresh press does', () => {
    pads.length = 0; pads.push(hotas());
    const im = new InputManager();
    im.poll();
    const b = capture(im, 'button', [() => {}, () => {}, (p) => { p.buttons[2] = btn(true); }]);
    expect(b?.kind).toBe('button');
    expect((b as { index: number }).index).toBe(2);
  });

  it('flipping an on-on switch binds the side that just came on', () => {
    pads.length = 0; pads.push(hotas());
    const im = new InputManager();
    im.poll();
    // switch moves: button 5 releases, button 6 presses
    const b = capture(im, 'button', [() => {}, (p) => { p.buttons[5] = btn(false); p.buttons[6] = btn(true); }]);
    expect((b as { index: number }).index).toBe(6);
    // and flipping back later binds 5 (it was released during the capture)
    const b2 = capture(im, 'button', [(p) => { p.buttons[6] = btn(false); }, (p) => { p.buttons[5] = btn(true); }]);
    expect((b2 as { index: number }).index).toBe(5);
  });

  it('buttons that only report an analog value count as pressed', () => {
    pads.length = 0; pads.push(hotas());
    const im = new InputManager();
    im.poll();
    const b = capture(im, 'button', [(p) => { p.buttons[1] = { pressed: false, value: 0.9 }; }]);
    expect((b as { index: number }).index).toBe(1);
    im.setBinding('gear', pads[0].id, b);
    im.poll();
    expect(im.down('gear')).toBe(true);
  });

  it('a switch reported as an axis binds as an axis switch and drives the action', () => {
    pads.length = 0; pads.push(hotas());
    const im = new InputManager();
    im.poll();
    // a brief stick bump to 0.95 for one poll is ignored; the switch axis jumping to +1 and staying binds
    const b = capture(im, 'button', [
      (p) => { p.axes[0] = 0.95; }, (p) => { p.axes[0] = 0; },
      (p) => { p.axes[3] = 1; }, () => {}, () => {},
    ]);
    expect(b?.kind).toBe('axisbtn');
    expect((b as { index: number }).index).toBe(3);
    im.setBinding('hook', pads[0].id, b);
    pads[0].axes[3] = 1; im.poll();
    expect(im.down('hook')).toBe(true);
    pads[0].axes[3] = 0; im.poll();
    expect(im.down('hook')).toBe(false);
  });
});
