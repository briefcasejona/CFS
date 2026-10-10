import * as THREE from 'three';
import type { Side } from '../aircraft/types.js';
import { clamp } from '../core/math.js';
import type { Aircraft } from './entities.js';

/**
 * Aircraft carrier (Nimitz-class, simplified): a moving flight deck with an angled landing area, four arresting
 * wires, two bow catapults and an island. The ship steams in a straight line, so its position is a pure function of
 * mission time — every multiplayer peer computes the same deck without network traffic.
 *
 * Deck frame: u = metres forward of the deck centre, v = metres to starboard. Landing frame (angled deck): s = metres
 * along the landing centreline (towards the bow-port corner), t = metres to the right of it.
 */
export interface CarrierSpec {
  id: string;
  name: string;
  side: Side;
  x: number; z: number;   // position at mission time 0 (m)
  hdg: number;            // course (deg, grid)
  speedKt: number;
}

export const DECK_H = 18.5;            // flight deck above the waterline (m)
const KT = 0.514444;
const ANGLE = 9 * Math.PI / 180;       // angled deck, to port
const LAND_O = { u: -60, v: -10 };     // landing-frame origin
const LAND = { s0: -100, s1: 150, half: 15 };
/** wire positions along the landing centreline (1 = aft-most) */
export const WIRES = [-48, -36, -24, -12];
/** glideslope aim point (between wires 2 and 3) and angle */
export const AIM_S = -30;
export const GLIDE_DEG = 3.5;
/** bow catapults: start point in the deck frame and stroke length */
export const CATS = [{ u: 50, v: 8, stroke: 92 }, { u: 50, v: -8, stroke: 92 }];
const MAIN = { u0: -160, u1: 166, v0: -16, v1: 22 };
const ISLAND = { u0: 20, u1: 60, v0: 23, v1: 33, h: 26 };

export class Carrier {
  readonly kind = 'carrier';
  readonly id: string;
  readonly name: string;
  readonly side: Side;
  readonly hdg: number;               // rad
  readonly speed: number;             // m/s
  readonly dir: THREE.Vector3;        // forward unit vector (world)
  readonly right: THREE.Vector3;      // starboard unit vector (world)
  readonly vel: THREE.Vector3;
  readonly pos = new THREE.Vector3(); // deck centre at the waterline
  private x0: number; private z0: number;

  constructor(spec: CarrierSpec) {
    this.id = spec.id; this.name = spec.name; this.side = spec.side;
    this.hdg = spec.hdg * Math.PI / 180;
    this.speed = spec.speedKt * KT;
    this.dir = new THREE.Vector3(Math.sin(this.hdg), 0, -Math.cos(this.hdg));
    this.right = new THREE.Vector3(Math.cos(this.hdg), 0, Math.sin(this.hdg));
    this.vel = this.dir.clone().multiplyScalar(this.speed);
    this.x0 = spec.x; this.z0 = spec.z;
    this.update(0);
  }

  /** move to mission time t (s) */
  update(t: number) { this.pos.set(this.x0 + this.vel.x * t, 0, this.z0 + this.vel.z * t); }

  toDeck(x: number, z: number) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    return { u: dx * this.dir.x + dz * this.dir.z, v: dx * this.right.x + dz * this.right.z };
  }
  fromDeck(u: number, v: number, y = DECK_H) {
    return new THREE.Vector3(this.pos.x + this.dir.x * u + this.right.x * v, y, this.pos.z + this.dir.z * u + this.right.z * v);
  }
  /** landing direction (world unit vector) */
  landingDir() {
    return this.dir.clone().multiplyScalar(Math.cos(ANGLE)).addScaledVector(this.right, -Math.sin(ANGLE));
  }
  toLanding(x: number, z: number) {
    const { u, v } = this.toDeck(x, z);
    const du = u - LAND_O.u, dv = v - LAND_O.v;
    return { s: du * Math.cos(ANGLE) - dv * Math.sin(ANGLE), t: du * Math.sin(ANGLE) + dv * Math.cos(ANGLE) };
  }
  fromLanding(s: number, t: number, y = DECK_H) {
    const u = LAND_O.u + s * Math.cos(ANGLE) + t * Math.sin(ANGLE);
    const v = LAND_O.v - s * Math.sin(ANGLE) + t * Math.cos(ANGLE);
    return this.fromDeck(u, v, y);
  }

  /** surface height at a point, or null when the point is not over the ship */
  deckHeight(x: number, z: number): number | null {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (dx * dx + dz * dz > 200 * 200) return null;
    const { u, v } = this.toDeck(x, z);
    if (u >= ISLAND.u0 && u <= ISLAND.u1 && v >= ISLAND.v0 && v <= ISLAND.v1) return DECK_H + ISLAND.h;
    if (u >= MAIN.u0 && u <= MAIN.u1 && v >= MAIN.v0 && v <= MAIN.v1) return DECK_H;
    const { s, t } = this.toLanding(x, z);
    if (s >= LAND.s0 && s <= LAND.s1 && Math.abs(t) <= LAND.half) return DECK_H;
    return null;
  }

  /** catapult start pose (world position at deck height, heading rad) */
  catPose(i: number) {
    const c = CATS[i % CATS.length];
    return { pos: this.fromDeck(c.u, c.v), hdg: this.hdg };
  }
}

// ------------------------------------------------------------------ deck operations
type OpState =
  | { kind: 'cat'; carrier: Carrier; cat: number; launching: boolean; travelled: number; vEnd: number }
  | { kind: 'arrest'; carrier: Carrier; wire: number; v0: number; pulled: number }
  | { kind: 'trapped'; carrier: Carrier; wire: number; t: number };

export interface ApproachInfo {
  carrier: Carrier;
  range: number;          // m to the aim point
  glideDev: number;       // deg above (+) / below (−) the glideslope
  lineup: number;         // m right (+) / left (−) of the landing centreline
}

const LSO_GRADES = ['', 'Wire one — a little flat.', 'Wire two — OK.', 'Three wire — OK pass!', 'Four wire — a little high.'];

/** Catapult launches, arrested landings and LSO calls (player aircraft). */
export class CarrierOps {
  private st = new Map<number, OpState>();
  private prevS = new Map<number, number>();
  private touched = new Set<number>();
  private lsoTimer = 0;
  private ballCalled = false;

  state(ac: Aircraft) { return this.st.get(ac.id)?.kind ?? null; }

  /** put an aircraft on a catapult (mission start) */
  attachToCat(ac: Aircraft, carrier: Carrier, cat: number) {
    const { pos, hdg } = carrier.catPose(cat);
    ac.fm.placeOnGround(pos.x, pos.z, DECK_H, hdg);
    ac.fm.vel.copy(carrier.vel);
    // end speed: comfortably above the jet's approach speed (heavier jets get a harder shot)
    const vEnd = clamp(66 + (ac.fm.mass - 15000) / 1000 * 0.8, 66, 82);
    this.st.set(ac.id, { kind: 'cat', carrier, cat, launching: false, travelled: 0, vEnd });
  }

  /** player command: salute — launch when at full power */
  launch(ac: Aircraft): string | null {
    const s = this.st.get(ac.id);
    if (!s || s.kind !== 'cat' || s.launching) return null;
    if (ac.ctrl.throttle < 0.9) return 'Shooter: run it up to full power first.';
    s.launching = true;
    return 'Shooter: launch!';
  }

  /** tailhook point in world space */
  private hookPoint(ac: Aircraft) {
    const d = ac.def;
    return new THREE.Vector3(0, -d.gear.height * 0.75, d.length * 0.45).applyQuaternion(ac.fm.quat).add(ac.fm.pos);
  }

  /** after the flight-model step: catapult/wire forces and arrest detection. Returns radio calls. */
  step(dt: number, ac: Aircraft, carriers: Carrier[]): string[] {
    const out: string[] = [];
    if (!ac.alive || ac.fm.crashed) { this.st.delete(ac.id); return out; }
    const s = this.st.get(ac.id);
    const fm = ac.fm;
    if (s?.kind === 'cat') {
      const c = s.carrier;
      const cat = CATS[s.cat % CATS.length];
      const start = c.fromDeck(cat.u, cat.v, fm.pos.y);
      if (!s.launching) {
        // held in the shuttle: move with the ship
        fm.pos.x = start.x; fm.pos.z = start.z;
        fm.vel.x = c.vel.x; fm.vel.z = c.vel.z;
        return out;
      }
      const rel = fm.vel.clone().sub(c.vel);
      let along = rel.dot(c.dir);
      const a = (s.vEnd * s.vEnd) / (2 * cat.stroke);
      along = Math.min(s.vEnd, along + a * dt);
      s.travelled += along * dt;
      fm.vel.set(c.vel.x + c.dir.x * along, fm.vel.y, c.vel.z + c.dir.z * along);
      const p = c.fromDeck(cat.u + s.travelled, cat.v, fm.pos.y);
      fm.pos.x = p.x; fm.pos.z = p.z;
      if (s.travelled >= cat.stroke) {
        // end of the stroke: the nose-gear launch bar and flight controls rotate the jet to a flying attitude
        fm.q = Math.max(fm.q, 0.16);
        this.st.delete(ac.id);
        out.push('Airboss: good shot.');
      }
      return out;
    }
    if (s?.kind === 'arrest') {
      const c = s.carrier;
      const L = c.landingDir();
      const rel = fm.vel.clone().sub(c.vel);
      let along = rel.dot(L);
      const decel = Math.max(15, (s.v0 * s.v0) / (2 * 100));
      along = Math.max(0, along - decel * dt);
      s.pulled += along * dt;
      const lat = rel.clone().addScaledVector(L, -rel.dot(L)); lat.y = 0;
      fm.vel.set(c.vel.x + L.x * along + lat.x * 0.9, fm.vel.y, c.vel.z + L.z * along + lat.z * 0.9);
      if (along < 0.5) {
        this.st.set(ac.id, { kind: 'trapped', carrier: c, wire: s.wire, t: 0 });
        out.push(`LSO: ${LSO_GRADES[s.wire]}`);
      }
      return out;
    }
    if (s?.kind === 'trapped') {
      // the wire holds the jet until the pilot comes off the power
      const c = s.carrier;
      const rel = fm.vel.clone().sub(c.vel);
      const L = c.landingDir();
      if (rel.dot(L) > 0) fm.vel.addScaledVector(L, -rel.dot(L));
      s.t += dt;
      if (ac.ctrl.throttle < 0.3 && s.t > 1.5) { this.st.delete(ac.id); ac.hook = false; out.push('Air boss: hook up, clear the landing area.'); }
      return out;
    }
    // airborne / rolling: wire engagement and bolters
    for (const c of carriers) {
      if (c.side !== ac.side) continue;
      const hp = this.hookPoint(ac);
      const { s: sNow, t } = c.toLanding(hp.x, hp.z);
      const sPrev = this.prevS.get(ac.id) ?? sNow;
      this.prevS.set(ac.id, sNow);
      if (Math.abs(t) > LAND.half || sNow < LAND.s0 - 50 || sNow > LAND.s1) continue;
      const overDeck = hp.y - DECK_H;
      if (fm.wow && c.deckHeight(fm.pos.x, fm.pos.z) !== null) this.touched.add(ac.id);
      if (!ac.hook || overDeck > 1.5) continue;
      for (let k = 0; k < WIRES.length; k++) {
        if (sPrev < WIRES[k] && sNow >= WIRES[k]) {
          const v0 = fm.vel.clone().sub(c.vel).dot(c.landingDir());
          if (v0 > 90) { out.push('LSO: too fast — the wire parted!'); continue; }
          this.st.set(ac.id, { kind: 'arrest', carrier: c, wire: k + 1, v0, pulled: 0 });
          this.touched.delete(ac.id);
          return out;
        }
      }
    }
    if (this.touched.has(ac.id) && !fm.wow && fm.agl > 3) {
      this.touched.delete(ac.id);
      out.push(ac.hook ? 'LSO: Bolter, bolter, bolter!' : 'LSO: Hook up?! Bolter!');
    }
    return out;
  }

  /** glideslope / lineup relative to the nearest friendly carrier while the hook is down (for HUD + LSO). */
  approach(ac: Aircraft, carriers: Carrier[]): ApproachInfo | null {
    if (!ac.hook || ac.fm.wow) return null;
    let best: ApproachInfo | null = null;
    for (const c of carriers) {
      if (c.side !== ac.side) continue;
      const aim = c.fromLanding(AIM_S, 0);
      const { s, t } = c.toLanding(ac.fm.pos.x, ac.fm.pos.z);
      const behind = AIM_S - s;
      if (behind < 50 || behind > 12000) continue;
      const range = Math.hypot(ac.fm.pos.x - aim.x, ac.fm.pos.z - aim.z);
      const ang = Math.atan2(ac.fm.pos.y - DECK_H, behind) * 180 / Math.PI;
      const info = { carrier: c, range, glideDev: ang - GLIDE_DEG, lineup: t };
      if (!best || range < best.range) best = info;
    }
    return best;
  }

  /** LSO voice calls on final (rate-limited) */
  lsoCalls(dt: number, ac: Aircraft, carriers: Carrier[]): string | null {
    this.lsoTimer -= dt;
    const a = this.approach(ac, carriers);
    if (!a || a.range > 2200) { if (!a) this.ballCalled = false; return null; }
    if (!this.ballCalled && a.range < 1600) { this.ballCalled = true; this.lsoTimer = 2.5; return 'LSO: Paddles contact — call the ball.'; }
    if (this.lsoTimer > 0) return null;
    this.lsoTimer = 2.2;
    if (a.glideDev < -1.2) return 'LSO: Power! Power!';
    if (a.glideDev < -0.5) return 'LSO: You\'re low.';
    if (a.glideDev > 0.9) return 'LSO: You\'re high.';
    if (a.lineup > 8) return 'LSO: Come left.';
    if (a.lineup < -8) return 'LSO: Right for lineup.';
    return null;
  }
}

/** deck geometry for the renderer (deck frame) */
export const DECK_GEOM = { MAIN, ISLAND, LAND, CATS, WIRES };
export function landingToDeck(s: number, t: number) {
  return { u: LAND_O.u + s * Math.cos(ANGLE) + t * Math.sin(ANGLE), v: LAND_O.v - s * Math.sin(ANGLE) + t * Math.cos(ANGLE) };
}
