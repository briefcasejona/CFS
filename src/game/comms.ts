// Radio commands for the flight lead: wingman orders, AWACS picture, vectors to the tanker and home, and carrier
// calls. One table serves both the keyboard comms menu and voice recognition (each command lists its spoken phrases).
import type { World } from '../sim/world.js';
import type { Aircraft } from '../sim/entities.js';
import { AIRBASES } from '../world/theater.js';
import { NM } from '../sim/atmosphere.js';

export interface CommsContext {
  world: World;
  player: Aircraft;
  /** the player's flight (index 0 = the player) */
  flight: Aircraft[];
}

export interface CommsCommand {
  id: string;
  label: string;
  /** spoken phrases (regex over the lower-case, punctuation-free transcript) */
  phrases: RegExp;
  /** radio lines to show: [speaker, text] */
  run(ctx: CommsContext): Array<[string, string]>;
}

const FT = 0.3048, KG_LB = 2.20462;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** BRAA-style call from `from` to `to`: bearing / range / altitude, plus aspect when the contact is moving */
export function braa(from: Aircraft, to: { pos: { x: number; y: number; z: number }; vel?: { x: number; z: number } }) {
  const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z;
  const brg = wrap360(Math.atan2(dx, -dz) * 180 / Math.PI);
  const rng = Math.hypot(dx, dz) / NM;
  const angels = Math.max(0, Math.round(to.pos.y / FT / 1000));
  let aspect = '';
  if (to.vel && Math.hypot(to.vel.x, to.vel.z) > 20) {
    // angle between the contact's track and the line back to us: < 45° hot, > 135° cold, else flanking
    const back = Math.atan2(-dx, dz), trk = Math.atan2(to.vel.x, -to.vel.z);
    const off = Math.abs(((back - trk) * 180 / Math.PI + 540) % 360 - 180);
    aspect = off < 45 ? ', hot' : off > 135 ? ', cold' : ', flanking';
  }
  return `${String(Math.round(brg) % 360).padStart(3, '0')} for ${rng.toFixed(0)}, angels ${angels}${aspect}`;
}

const wingmen = (c: CommsContext) => c.flight.filter((a) => a !== c.player && a.alive && a.ai);
const lead = (c: CommsContext) => c.player.callsign.replace(/ 1-1$/, '');
function orderAll(c: CommsContext, cmd: 'attack' | 'engage' | 'rejoin' | 'rtb', label: string): Array<[string, string]> {
  const out: Array<[string, string]> = [[c.player.callsign, label]];
  const w = wingmen(c);
  if (!w.length) { out.push(['—', 'No wingmen in your flight.']); return out; }
  const stt = c.player.radar?.stt ?? null;
  const target = cmd === 'attack' && stt && stt.kind === 'aircraft' ? stt as Aircraft : null;
  for (const a of w) out.push([a.callsign, a.ai!.order(cmd, target)]);
  return out;
}
function setGear(c: CommsContext, down: boolean): Array<[string, string]> {
  const p = c.player;
  if (!down && p.fm.wow) return [['—', 'Gear handle locked — weight on wheels.']];
  p.ctrl.gearDown = down;
  return [['—', `Gear ${down ? 'down' : 'up'}.`]];
}

export const COMMS: CommsCommand[] = [
  { id: 'attack', label: 'Flight, attack my target', phrases: /\b(attack|engage|kill|hit|take) (my|the) (target|bandit|lock)\b/, run: (c) => orderAll(c, 'attack', 'Flight, attack my target.') },
  { id: 'engage', label: 'Flight, weapons free', phrases: /\bweapons free\b|\bengage\b|\bcleared (hot|to engage)\b|\bfree to engage\b/, run: (c) => orderAll(c, 'engage', 'Flight, weapons free, engage bandits.') },
  { id: 'rejoin', label: 'Flight, rejoin', phrases: /\b(rejoin|re join|form up|join up|on me)\b/, run: (c) => orderAll(c, 'rejoin', 'Flight, rejoin on me.') },
  { id: 'rtb', label: 'Flight, RTB', phrases: /\b(r t b|rtb|return to base|go home)\b/, run: (c) => orderAll(c, 'rtb', 'Flight, RTB.') },
  {
    id: 'picture', label: 'AWACS, request picture', phrases: /\b(picture|bogey dope|bogie dope|awacs|any bandits)\b/,
    run: (c) => {
      const me = c.player;
      const hostiles = c.world.enemiesOf(me.side).filter((e) => e.alive).sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
      const out: Array<[string, string]> = [[me.callsign, 'Request picture.']];
      const awacs = c.world.aircraft.find((a) => a.side === me.side && a.alive && a.ai?.task === 'awacs');
      const who = awacs?.callsign.replace(/ 1-\d$/, '') ?? 'Magic';
      if (!hostiles.length) out.push([who, `${lead(c)}, picture clean.`]);
      else {
        const n = hostiles.filter((h) => h.pos.distanceTo(hostiles[0].pos) < 10 * NM).length;
        out.push([who, `${lead(c)}, ${n > 1 ? `group of ${n}` : 'single group'}, BRAA ${braa(me, hostiles[0])}, hostile.`]);
      }
      return out;
    },
  },
  {
    id: 'tanker', label: 'Request vector to tanker', phrases: /\b(tanker|texaco|shell|arco|refuel|gas)\b/,
    run: (c) => {
      const me = c.player;
      const t = c.world.aircraft.filter((a) => a.side === me.side && a.alive && a.ai?.task === 'tanker').sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos))[0];
      const ask: [string, string] = [me.callsign, `Request tanker, fuel ${(me.fm.totalFuel * KG_LB / 1000).toFixed(1)}.`];
      if (!t) return [ask, ['Magic', 'Negative, no tanker on station.']];
      return [ask, ['Magic', `${lead(c)}, ${t.callsign.replace(/ 1-\d$/, '')} ${braa(me, t)}.`]];
    },
  },
  {
    id: 'home', label: 'Request vector home', phrases: /\b(vector|steer|heading) (to )?(home|base|mother|the boat)\b|\binbound\b|\bbingo\b|\bhome plate\b/,
    run: (c) => {
      const me = c.player;
      const places = AIRBASES.filter((b) => b.side === me.side).map((b) => ({ name: b.name, pos: { x: b.x, y: b.elev, z: b.z } }));
      for (const cv of c.world.carriers) if (cv.side === me.side) places.push({ name: cv.name, pos: { x: cv.pos.x, y: 0, z: cv.pos.z } });
      places.sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) - Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z));
      const ask: [string, string] = [me.callsign, 'Request vector home.'];
      if (!places.length) return [ask, ['Magic', 'Unable, no friendly field.']];
      return [ask, ['Magic', `${lead(c)}, ${places[0].name} ${braa(me, places[0]).replace(/, angels \d+/, '')}.`]];
    },
  },
  {
    id: 'ball', label: 'Call the ball', phrases: /\bball\b|\bclara\b/,
    run: (c) => {
      const me = c.player;
      const a = c.world.carrierOps.approach(me, c.world.carriers);
      const call: [string, string] = [me.callsign, `${me.def.name} ball, ${(me.fm.totalFuel * KG_LB / 1000).toFixed(1)}.`];
      if (!a || a.range > 2500) return [call, ['LSO', 'Say again — you are not in the groove.']];
      return [call, ['LSO', Math.abs(a.glideDev) > 1.2 ? 'Roger ball… watch your glideslope.' : 'Roger ball.']];
    },
  },
  { id: 'gearDown', label: 'Gear down', phrases: /\bgear down\b/, run: (c) => setGear(c, true) },
  { id: 'gearUp', label: 'Gear up', phrases: /\bgear up\b/, run: (c) => setGear(c, false) },
];

/** match a recognised utterance (any of the recogniser's alternatives, best first) to a command */
export function matchCommand(transcripts: string[]): CommsCommand | null {
  for (const t of transcripts) {
    const s = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const cmd of COMMS) if (cmd.phrases.test(s)) return cmd;
  }
  return null;
}
