import { describe, expect, it } from './expect.js';
import { Interpolator, makeRoomCode, type AcState } from '../src/net/protocol.js';
import { CoopHost, CoopClient, addCoopFlights, clientSpec, type NetTransport } from '../src/net/coop.js';
import { buildMission, buildScenario, defaultCustom } from '../src/game/mission.js';

const DT = 1 / 120;
const OPTS = { unlimitedFuel: false, unlimitedWeapons: false, invulnerable: false, gEffects: true, abDetent: 0.8 };

/** Two in-memory transports wired to each other; messages are JSON round-tripped like on the wire. */
function memoryPair(): [NetTransport, NetTransport] {
  type H = Map<string, (d: any, from: string) => void>;
  const mk = (id: string, handlers: H, other: () => { handlers: H }): NetTransport => ({
    selfId: id,
    send: (ch, data) => { other().handlers.get(ch)?.(JSON.parse(JSON.stringify(data)), id); },
    on: (ch, cb) => { handlers.set(ch, cb); },
    onPeerJoin: () => {}, onPeerLeave: () => {}, leave: () => {},
  });
  const hh: H = new Map(), ch: H = new Map();
  return [mk('H', hh, () => ({ handlers: ch })), mk('C', ch, () => ({ handlers: hh }))];
}

describe('net protocol', () => {
  it('interpolates poses between snapshots and extrapolates briefly', () => {
    const ip = new Interpolator();
    const s = (x: number): AcState => ({ i: 0, p: [x, 0, 0], q: [0, 0, 0, 1], v: [100, 0, 0], f: 1, s: 20, h: 100 });
    ip.push(1, s(0)); ip.push(2, s(100));
    expect(ip.sample(1.5)!.p[0]).toBeCloseTo(50, 3);
    expect(ip.sample(2.2)!.p[0]).toBeCloseTo(120, 3);
    expect(ip.sample(9)!.p[0]).toBeCloseTo(150, 3); // extrapolation capped at 0.5 s
    expect(makeRoomCode().length).toBe(6);
  });
});

describe('co-op multiplayer', () => {
  it('host and client stay in sync and client weapons are fired by the host', () => {
    const [ht, ct] = memoryPair();
    const base = buildScenario({ ...defaultCustom(), scenario: 'bvr', aircraftId: 'f16c', wingmen: 0 });
    const { spec, flightOf } = addCoopFlights(base, [{ peerId: 'C', name: 'Bob', aircraftId: 'fa18c' }]);
    const hb = buildMission(spec, OPTS);
    const host = new CoopHost(hb.world, ht, flightOf);
    const cb = buildMission(clientSpec(spec, flightOf.C), OPTS);
    const client = new CoopClient(cb.world, ct, flightOf.C);
    expect(cb.player.def.id).toBe('fa18c');
    expect(hb.world.aircraft.length).toBe(cb.world.aircraft.length);
    const step = (sec: number) => {
      for (let t = 0; t < sec; t += DT) { hb.world.step(DT); cb.world.step(DT); host.update(DT); client.update(DT); }
    };
    step(3);
    // the client's ghost of the host player follows the host
    const hostIdx = hb.world.aircraft.indexOf(hb.player);
    const ghost = cb.world.aircraft[hostIdx];
    expect(ghost.netGhost).toBe(true);
    expect(ghost.pos.distanceTo(hb.player.pos)).toBeLessThan(80);
    // the host's proxy of the client follows the client's own jet
    const proxy = hb.world.aircraft[client.myIndex];
    expect(proxy.netProxy).toBe(true);
    expect(proxy.pos.distanceTo(cb.player.pos)).toBeLessThan(80);
    // client fires a radar missile at an enemy: the host launches it from the proxy, and it shows up on the client
    const enemyIdx = hb.world.aircraft.findIndex((a) => a.side === 'red');
    const me = cb.player;
    me.radar!.mode = 'STT'; me.radar!.stt = cb.world.aircraft[enemyIdx];
    me.selWeapon = me.stores.find((s) => s.startsWith('aim120')) ?? me.stores.find((s) => s.startsWith('aim7'))!;
    const before = me.stores.filter(Boolean).length;
    cb.world.fireSelected(me);
    expect(me.stores.filter(Boolean).length).toBe(before - 1);
    expect(hb.world.missiles.some((m) => m.launcher === proxy)).toBe(true);
    step(0.2);
    expect(cb.world.missiles.length).toBeGreaterThan(0);
    // no AI runs on the client: the enemy ghost is positioned by the host
    expect(cb.world.aircraft[enemyIdx].ai).toBe(null);
  });
});
