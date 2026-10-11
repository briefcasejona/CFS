import { describe, expect, it } from './expect.js';
import { COMMS, matchCommand, braa } from '../src/game/comms.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';

const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };
const run = (id: string, b: ReturnType<typeof buildMission>) =>
  COMMS.find((c) => c.id === id)!.run({ world: b.world, player: b.player, flight: b.playerFlight });

describe('radio / voice commands', () => {
  it('spoken phrases map to the right call (first matching alternative wins)', () => {
    const id = (s: string[]) => matchCommand(s)?.id ?? null;
    expect(id(['Flight, attack my target'])).toBe('attack');
    expect(id(['engage my bandit'])).toBe('attack');
    expect(id(['weapons free'])).toBe('engage');
    expect(id(['two, rejoin'])).toBe('rejoin');
    expect(id(['R.T.B.'])).toBe('rtb');
    expect(id(['Magic, request picture'])).toBe('picture');
    expect(id(['bogey dope'])).toBe('picture');
    expect(id(['Texaco, request fuel'])).toBe('tanker');
    expect(id(['vector to home'])).toBe('home');
    expect(id(['Hornet ball, 4.2'])).toBe('ball');
    expect(id(['gear down'])).toBe('gearDown');
    expect(id(['gear up'])).toBe('gearUp');
    expect(id(['banana', 'hello there'])).toBe(null);
    expect(id(['banana', 'request picture'])).toBe('picture');
  });

  it('wingman orders reach the AI: RTB, rejoin, weapons free, attack my target', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'bvr', wingmen: 1 }), OPTS);
    const wing = b.playerFlight[1];
    expect(!!wing.ai).toBe(true);
    const reply = run('rtb', b);
    expect(reply[0][1]).toContain('RTB');
    expect(reply[1][1]).toContain('wilco');
    expect(wing.ai!.orderedRtb).toBe(true);
    run('rejoin', b);
    expect(wing.ai!.orderedRtb).toBe(false);
    expect(wing.ai!.weaponsFree).toBe(false);
    run('engage', b);
    expect(wing.ai!.weaponsFree).toBe(true);
    // no radar lock: the wingman asks for a target
    expect(run('attack', b)[1][1]).toContain('no target');
    const bandit = b.world.enemiesOf('blue')[0];
    (b.player.radar as unknown as { stt: unknown }).stt = bandit;
    expect(run('attack', b)[1][1]).toContain('engaging');
    expect(wing.ai!.orderedTarget).toBe(bandit);
    for (let t = 0; t < 1; t += 1 / 120) b.world.step(1 / 120);
    expect(wing.ai!.target).toBe(bandit);
  });

  it('AWACS picture gives a BRAA call on the nearest hostile; vectors and gear work', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'bfm_ir' }), OPTS);
    const pic = run('picture', b);
    expect(pic[1][1]).toContain('BRAA');
    expect(pic[1][1]).toContain(braa(b.player, b.world.enemiesOf('blue')[0]));
    expect(run('home', b)[1][1]).toContain(' for ');
    expect(run('tanker', b)[1][1]).toContain('no tanker');
    expect(run('gearDown', b)[0][1]).toBe('Gear down.');
    expect(b.player.ctrl.gearDown).toBe(true);
    run('gearUp', b);
    expect(b.player.ctrl.gearDown).toBe(false);
  });

  it('BRAA: bearing, range and hot/cold aspect', () => {
    const b = buildMission(buildScenario({ ...defaultCustom(), scenario: 'freeflight' }), OPTS);
    const me = b.player;
    const north = { pos: { x: me.pos.x, y: 6096, z: me.pos.z - 20 * 1852 }, vel: { x: 0, z: 200 } };   // 20 nm north, heading south
    expect(braa(me, north)).toBe('000 for 20, angels 20, hot');
    const away = { pos: north.pos, vel: { x: 0, z: -200 } };
    expect(braa(me, away)).toContain('cold');
  });
});
