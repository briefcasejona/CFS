import { describe, expect, it } from './expect.js';
import { validateMissionSpec, encodeMission, decodeMission } from '../src/game/missionFile.js';
import { buildMission, buildScenario, defaultCustom, SCENARIOS, type MissionSpec } from '../src/game/mission.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { setEuropeGrid } from '../src/world/theaters/europe.js';
import * as T from '../src/world/theater.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };

describe('mission files', () => {
  // the v0.1.10 crash: an editor mission on one map flown while another map was active
  const runwayMission = (theaterId: string | undefined, airbaseId: string): MissionSpec => ({
    title: 't', briefing: '', weather: { visibilityKm: 80, clouds: 'clear', cloudBase: 3500, timeOfDay: 11 }, groups: [], goals: [{ kind: 'survive' }],
    ...(theaterId ? { theaterId } : {}),
    flights: [{ id: 'f1', callsign: 'Viper', side: 'blue', aircraftId: 'f16c', stores: [], count: 2, skill: 'veteran', task: 'sweep',
      start: { kind: 'runway', airbaseId }, homeBase: airbaseId, player: true, waypoints: [] }],
  });

  it('missions carry their map: a Europe runway start flies even when Varnia was active', () => {
    const buf = gunzipSync(readFileSync('assets/theaters/europe/height.bin.gz'));
    setEuropeGrid(new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2));
    try {
      T.setTheater('varnia');
      const spec = validateMissionSpec(JSON.parse(JSON.stringify(runwayMission('europe', 'volkel'))));
      const b = buildMission(spec, OPTS);
      expect(T.currentTheater().id).toBe('europe');
      expect(b.player.fm.wow).toBe(true);
      expect(T.nearestAirbase(b.player.pos.x, b.player.pos.z).id).toBe('volkel');
    } finally { T.setTheater('varnia'); }
  });

  it('old missions without a map are Varnia missions; foreign airbases are refused with a clear reason', () => {
    expect(validateMissionSpec(JSON.parse(JSON.stringify(runwayMission(undefined, 'halvorsen')))).theaterId).toBe('varnia');
    let err = '';
    try { validateMissionSpec(JSON.parse(JSON.stringify(runwayMission('varnia', 'volkel')))); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('not on the Varnia');
    try { validateMissionSpec(JSON.parse(JSON.stringify(runwayMission('mars', 'x')))); } catch (e) { err = (e as Error).message; }
    expect(err).toContain('unknown map');
    // a stale home base is repaired, not fatal
    const m = runwayMission('varnia', 'halvorsen'); m.flights[0].homeBase = 'volkel';
    expect(validateMissionSpec(m).flights[0].homeBase).toBe('halvorsen');
    // and building an unvalidated mission for the wrong map is a readable error, not a TypeError
    try { buildMission(runwayMission('varnia', 'volkel'), OPTS); err = ''; } catch (e) { err = (e as Error).message; }
    expect(err).toContain('not on the');
  });

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
