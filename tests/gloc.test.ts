import { describe, expect, it } from './expect.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
const DT = 1 / 60;

/** hold a constant load factor on the player and run the pilot model only */
function hold(aircraftId: string, nz: number, seconds: number, b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'freeflight', aircraftId }), OPTS)) {
  const p = b.player;
  let firstBlack = -1;
  for (let t = 0; t < seconds; t += DT) {
    p.fm.nz = nz;
    b.world.updateGEffects(p, DT);
    if (firstBlack < 0 && p.glocTimer > 0) firstBlack = t;
  }
  return { p, firstBlack, b };
}

describe('pilot G tolerance', () => {
  it('7 g can be held indefinitely', () => {
    const { p } = hold('f15c', 7, 120);
    expect(p.gLoc).toBe(0);
    expect(p.glocTimer).toBe(0);
  });

  it('9 g sustained greys out first and blacks out after roughly 10–15 s, not in 2 s', () => {
    const { firstBlack } = hold('f15c', 9, 30);
    expect(firstBlack).toBeGreaterThan(9);
    expect(firstBlack).toBeLessThan(16);
    const early = hold('f15c', 9, 6).p;
    expect(early.gLoc > 0 && early.gLoc < 0.6, `grey at 6 s: ${early.gLoc.toFixed(2)}`).toBe(true);
  });

  it('a reclined seat (F-16) holds 9 g longer than an upright one (F-15)', () => {
    expect(hold('f16c', 9, 60).firstBlack).toBeGreaterThan(hold('f15c', 9, 60).firstBlack + 5);
  });

  it('G-LOC drops the controls for a few seconds, then the pilot recovers after unloading', () => {
    const { p, b } = hold('f15c', 9.5, 9);   // blacks out at ~7.5 s, unconscious for 4 s
    expect(p.glocTimer > 0).toBe(true);
    p.ctrl.pitch = 1;
    b.world.step(DT);
    expect(p.ctrl.pitch).toBe(0);
    const r = hold('f15c', 1, 8, b).p;
    expect(r.glocTimer <= 0).toBe(true);
    expect(r.gLoc).toBe(0);
  });
});
