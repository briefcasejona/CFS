import { describe, expect, it } from './expect.js';
import { validateMissionSpec, encodeMission, decodeMission } from '../src/game/missionFile.js';
import { buildMission, buildScenario, defaultCustom, SCENARIOS } from '../src/game/mission.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };

describe('mission files', () => {
  it('every Instant Action scenario is a valid mission file and survives a JSON round trip', () => {
    for (const s of SCENARIOS) {
      const spec = buildScenario({ ...defaultCustom(), scenario: s.id });
      const back = validateMissionSpec(JSON.parse(JSON.stringify(spec)));
      expect(back.flights.length).toBe(spec.flights.length);
    }
  });

  it('rejects broken missions with a readable reason', () => {
    const spec = buildScenario(defaultCustom());
    const bad = (mut: (o: any) => void) => { const o = JSON.parse(JSON.stringify(spec)); mut(o); try { validateMissionSpec(o); return ''; } catch (e) { return (e as Error).message; } };
    expect(bad((o) => { o.flights = []; })).toBe('Not a valid CFS mission: no flights');
    expect(bad((o) => { for (const f of o.flights) f.player = false; }).includes('player flight')).toBe(true);
    expect(bad((o) => { o.flights[0].aircraftId = 'x-wing'; }).includes('unknown aircraft')).toBe(true);
    expect(bad((o) => { o.goals.push({ kind: 'destroyGroup', group: 'nope', fraction: 1 }); }).includes('missing group')).toBe(true);
  });

  it('share links round-trip and the decoded mission flies', async () => {
    const spec = buildScenario({ ...defaultCustom(), scenario: 'strike' });
    spec.title = 'Shared strike';
    const token = await encodeMission(spec);
    expect(/^[\w-]+$/.test(token)).toBe(true);
    expect(token.length).toBeLessThan(JSON.stringify(spec).length);
    const back = await decodeMission(token);
    expect(back.title).toBe('Shared strike');
    const b = buildMission(back, OPTS);
    expect(b.player.alive).toBe(true);
  });
});
