// Air-to-air refuelling for the player: flying-boom receptacles and probe-and-drogue.
// The receiver's reference point (receptacle / probe tip) must be held inside the tanker's contact envelope
// with a gentle closure; fuel then flows until full or the envelope is left (disconnect).
import * as THREE from 'three';
import type { Aircraft } from './entities.js';
import { hasCapability } from '../aircraft/defs.js';

export type RefuelKind = 'boom' | 'drogue';

export interface RefuelStatus {
  tanker: Aircraft | null;
  kind: RefuelKind | null;
  contact: boolean;
  /** receiver reference point relative to the contact point, in the tanker's frame (m): x right, y up, z aft */
  delta: THREE.Vector3;
  transferredKg: number;
}

/** Receiver reference point in its own body frame (−Z forward). */
export function receiverPoint(ac: Aircraft): { kind: RefuelKind; offset: THREE.Vector3 } | null {
  const d = ac.def, L = d.length;
  const R = Math.max(0.55, L * 0.042) * (d.model.engines === 2 ? 1.15 : 1);
  if (hasCapability(d, 'boom')) return { kind: 'boom', offset: new THREE.Vector3(0, R * 0.95, -L * 0.1) };
  if (hasCapability(d, 'probe')) return { kind: 'drogue', offset: new THREE.Vector3(R * 0.9, R * 0.65, -L * 0.5) };
  return null;
}

/** Contact points in the tanker body frame: boom tip behind/below the tail, drogues trailing the wing-tip pods. */
export function tankerPoints(t: Aircraft, kind: RefuelKind): THREE.Vector3[] {
  const L = t.def.length, b = t.def.span;
  if (kind === 'boom') return t.def.tanker?.boom ? [new THREE.Vector3(0, -7.5, L * 0.5 + 12)] : [];
  return t.def.tanker?.drogue ? [new THREE.Vector3(-b * 0.38, -2.5, 20), new THREE.Vector3(b * 0.38, -2.5, 20)] : [];
}

// envelope radii (tanker frame x, y, z) to make and to keep contact
const MAKE = { boom: new THREE.Vector3(3, 2.5, 3), drogue: new THREE.Vector3(0.9, 0.9, 1.2) };
const KEEP = { boom: new THREE.Vector3(4.5, 3.5, 4.5), drogue: new THREE.Vector3(2.2, 2.2, 3) };
const MAX_CLOSURE = { boom: 2.5, drogue: 3.5 }; // m/s at the moment of contact

export class Refueling {
  status: RefuelStatus = { tanker: null, kind: null, contact: false, delta: new THREE.Vector3(), transferredKg: 0 };
  private lastDelta = new THREE.Vector3();

  /** Returns a radio message when something noteworthy happens (contact / disconnect / complete). */
  step(dt: number, rx: Aircraft, aircraft: Aircraft[]): string | null {
    const st = this.status;
    const ref = receiverPoint(rx);
    if (!ref || !rx.alive) { st.tanker = null; st.contact = false; return null; }
    // nearest friendly tanker within 3 km
    let tanker: Aircraft | null = null, bd = 3000;
    for (const a of aircraft) {
      if (!a.active || a === rx || a.side !== rx.side || !a.def.tanker) continue;
      const d = a.pos.distanceTo(rx.pos);
      if (d < bd) { bd = d; tanker = a; }
    }
    if (!tanker) { const was = st.contact; st.tanker = null; st.contact = false; return was ? 'Disconnect.' : null; }
    st.tanker = tanker; st.kind = ref.kind;
    const pts = tankerPoints(tanker, ref.kind);
    if (!pts.length) return null;
    // receiver point in the tanker frame
    const inv = tanker.quat.clone().invert();
    const local = ref.offset.clone().applyQuaternion(rx.quat).add(rx.pos).sub(tanker.pos).applyQuaternion(inv);
    let best = pts[0];
    for (const p of pts) if (p.distanceTo(local) < best.distanceTo(local)) best = p;
    const delta = local.clone().sub(best);
    const rate = dt > 0 ? delta.clone().sub(this.lastDelta).divideScalar(dt) : new THREE.Vector3();
    this.lastDelta.copy(delta);
    st.delta.copy(delta);
    const inside = (r: THREE.Vector3) => (delta.x / r.x) ** 2 + (delta.y / r.y) ** 2 + (delta.z / r.z) ** 2 <= 1;
    let msg: string | null = null;
    if (!st.contact) {
      if (inside(MAKE[ref.kind]) && rate.length() < MAX_CLOSURE[ref.kind]) { st.contact = true; msg = 'Contact.'; }
    } else if (!inside(KEEP[ref.kind]) || (ref.kind === 'drogue' && rate.length() > 4.5)) {
      st.contact = false; msg = 'Disconnect.';
    }
    if (st.contact) {
      const space = rx.def.fuelInternal - rx.fm.fuel;
      if (space <= 1) { st.contact = false; return 'Fuel transfer complete — disconnect, cleared to depart.'; }
      const kg = Math.min(space, tanker.def.tanker!.rateKgS * dt);
      rx.fm.fuel += kg;
      rx.fm.updateMass();
      tanker.fm.fuel = Math.max(0, tanker.fm.fuel - kg);
      st.transferredKg += kg;
    }
    return msg;
  }

  /** HUD cue: which way to move to reach the contact point. */
  cue(): string | null {
    const st = this.status;
    if (!st.tanker || !st.kind) return null;
    const d = st.delta;
    if (st.contact) return `${st.kind === 'boom' ? 'BOOM' : 'DROGUE'} CONTACT  +${Math.round(st.transferredKg)} kg`;
    if (d.length() > 250) return `TANKER ${(d.length() / 1000).toFixed(1)} km — close to pre-contact`;
    const ax = (v: number, pos: string, neg: string) => (Math.abs(v) < 0.5 ? '' : `${v > 0 ? neg : pos} ${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}`);
    return ['TANKER', ax(d.z, 'AFT', 'FWD'), ax(d.y, 'UP', 'DN'), ax(d.x, 'RT', 'LT')].filter(Boolean).join('  ');
  }
}
