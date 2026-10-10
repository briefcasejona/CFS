// Co-op multiplayer wire format + interpolation (pure, no networking — unit-tested).
// Entities are addressed by their index in world.aircraft / world.ground: host and clients build the same
// MissionSpec in the same order, so indices match on every machine.
import * as THREE from 'three';
import type { Aircraft, RwrContact } from '../sim/entities.js';
import type { KillEvent, RadioMsg } from '../sim/world.js';

export const NET_VERSION = 1;

/** Compact aircraft pose: index, position (0.1 m), quaternion, velocity, flags, wing sweep, health. */
export interface AcState { i: number; p: number[]; q: number[]; v: number[]; f: number; s: number; h: number }
/** Missile (or bomb) in flight. */
export interface MsState { id: number; w: string; p: number[]; v: number[]; m: number }
/** Host → clients, ~15 Hz. `gu` is flat: [index, alive, x, z, ...] for ground units that moved or died. */
export interface Snapshot {
  t: number;
  ac: AcState[];
  ms: MsState[];
  gu: number[];
  k: KillEvent[];
  r: RadioMsg[];
  /** per client peer id: its RWR picture (the host simulates everyone's emitters) */
  rwr: Record<string, RwrContact[]>;
}
/** Client → host, ~20 Hz: the client's own aircraft. */
export interface ClientState extends AcState { th: number; cmF: number; cmC: number }
/** Client → host: weapon release request (the host fires it from the client's proxy aircraft). */
export interface FireRequest { weapon: string; target: number; targetKind: 'air' | 'ground' | 'none' }

export const F_ALIVE = 1, F_GEAR = 2, F_AB = 4, F_REMOVED = 8, F_GUN = 16;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function packAircraft(ac: Aircraft, i: number): AcState {
  const fm = ac.fm;
  const f = (ac.alive ? F_ALIVE : 0) | (fm.gearPos > 0.5 ? F_GEAR : 0) | (fm.abFrac > 0.05 ? F_AB : 0) | (ac.removed ? F_REMOVED : 0) | (ac.gunFiring ? F_GUN : 0);
  return {
    i,
    p: [r1(fm.pos.x), r1(fm.pos.y), r1(fm.pos.z)],
    q: [r4(fm.quat.x), r4(fm.quat.y), r4(fm.quat.z), r4(fm.quat.w)],
    v: [r1(fm.vel.x), r1(fm.vel.y), r1(fm.vel.z)],
    f, s: Math.round(fm.sweep), h: Math.round(ac.health),
  };
}

/** Apply a received pose to a locally non-simulated (ghost / proxy) aircraft. */
export function applyAircraft(ac: Aircraft, s: AcState) {
  const fm = ac.fm;
  fm.pos.set(s.p[0], s.p[1], s.p[2]);
  fm.quat.set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize();
  fm.vel.set(s.v[0], s.v[1], s.v[2]);
  fm.gearPos = s.f & F_GEAR ? 1 : 0;
  fm.abFrac = s.f & F_AB ? 1 : 0;
  fm.sweep = s.s;
  ac.gunFiring = !!(s.f & F_GUN);
}

/** Two-sample interpolation buffer per entity; renders ~INTERP_DELAY behind the newest snapshot. */
export const INTERP_DELAY = 0.12;
export class Interpolator {
  private a: { t: number; s: AcState } | null = null;
  private b: { t: number; s: AcState } | null = null;

  push(t: number, s: AcState) {
    if (this.b && t <= this.b.t) return;
    this.a = this.b;
    this.b = { t, s };
  }

  /** Pose at time t (host clock): lerp between samples, extrapolate with velocity past the newest one (≤ 0.5 s). */
  sample(t: number): AcState | null {
    const a = this.a, b = this.b;
    if (!b) return null;
    if (!a || t >= b.t) {
      const dt = Math.min(0.5, Math.max(0, t - b.t));
      return { ...b.s, p: [b.s.p[0] + b.s.v[0] * dt, b.s.p[1] + b.s.v[1] * dt, b.s.p[2] + b.s.v[2] * dt] };
    }
    const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
    const qa = new THREE.Quaternion(a.s.q[0], a.s.q[1], a.s.q[2], a.s.q[3]);
    const qb = new THREE.Quaternion(b.s.q[0], b.s.q[1], b.s.q[2], b.s.q[3]);
    qa.slerp(qb, k);
    const L = (x: number, y: number) => x + (y - x) * k;
    return {
      ...b.s,
      p: [L(a.s.p[0], b.s.p[0]), L(a.s.p[1], b.s.p[1]), L(a.s.p[2], b.s.p[2])],
      v: [L(a.s.v[0], b.s.v[0]), L(a.s.v[1], b.s.v[1]), L(a.s.v[2], b.s.v[2])],
      q: [qa.x, qa.y, qa.z, qa.w],
    };
  }
}

/** Short shareable room codes (no ambiguous characters). */
export function makeRoomCode(rand = Math.random) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
