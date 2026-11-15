// The switches, knobs and buttons modelled in a cockpit model, bound to the aircraft's controls so they move and can
// be clicked. The model's grouped panels are split into parts by scripts/models/split-cockpit.mjs: every part is its
// own node with its origin at the centre of its bounds, and the cockpit model spec (cockpitModels.ts, `switches`) says
// which part is which control.
//
// How a part moves, unless the spec says otherwise:
//  * a spring-loaded two-position control (a push-button) presses in;
//  * a control with four or more positions (a rotary) turns about its own axis, 30° a step;
//  * anything else is a lever: it swings about its base, the end away from the eye, over ±25°.
import * as THREE from 'three';
import type { AircraftSystems, ControlDef } from '../systems/types.js';

export type PartMotion = 'button' | 'knob' | 'lever';
export type SwitchBinding = string | {
  id: string; motion?: PartMotion;
  /** lever swing per side, degrees */ throw?: number;
  /** knob step, degrees */ step?: number;
  /** lever angle of each position in degrees, when they are not evenly spread from one side to the other (a
   *  three-position switch whose OFF is in the middle, say) */
  angles?: number[];
  /** another part that this one moves with, as one piece (the same pivot and axis) */
  follow?: string;
};

interface Bound {
  node: THREE.Object3D; def: ControlDef; motion: PartMotion;
  basePos: THREE.Vector3; baseQuat: THREE.Quaternion;
  axis: THREE.Vector3; pivot: THREE.Vector3; travel: number; step: number;
  angles?: number[];
  shown: number;
}

const K = 18;   // 1/s: how fast a part settles on its new position

function motionFor(d: ControlDef): PartMotion {
  if (d.momentary && d.positions.length === 2) return 'button';
  return d.positions.length >= 4 ? 'knob' : 'lever';
}

export class ModelSwitches {
  private bound: Bound[] = [];
  /** the part meshes, for picking */
  readonly picks: THREE.Object3D[] = [];
  /** controls that have a part of their own (their overlay plate cells are left out) */
  readonly ids = new Set<string>();
  /** part names in the spec that the model does not have, or controls the aircraft does not have */
  readonly unmatched: string[] = [];

  constructor(root: THREE.Object3D, map: Record<string, SwitchBinding>, sys: AircraftSystems, eyeWorld: THREE.Vector3) {
    root.updateWorldMatrix(true, true);
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => { if (o.name) byName.set(o.name, o); });
    const entries = Object.entries(map).map(([name, b]) => [name, typeof b === 'string' ? { id: b } : b] as const);
    // leaders first, so a follower finds its leader bound
    entries.sort((a, b) => Number(!!a[1].follow) - Number(!!b[1].follow));
    for (const [name, spec] of entries) {
      const b = spec;
      const node = byName.get(name);
      const def = sys.controls.find((c) => c.id === spec.id);
      if (!node || !def) { this.unmatched.push(name); continue; }
      if (spec.follow) {
        const lead = this.bound.find((x) => x.node.name === spec.follow);
        if (!lead || node.parent !== lead.node.parent) { this.unmatched.push(name); continue; }
        this.bound.push({ ...lead, node, basePos: node.position.clone(), baseQuat: node.quaternion.clone(), shown: NaN });
        node.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.hit = { kind: 'control', def }; this.picks.push(o); } });
        continue;
      }
      const motion = spec.motion ?? motionFor(def);
      const box = new THREE.Box3();
      node.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!); } });
      const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      const dims = [size.x, size.y, size.z];
      const unit = (i: number) => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
      // the part's centre and the eye in the part's parent frame
      const parent = node.parent!;
      const eye = parent.worldToLocal(eyeWorld.clone());
      const toEye = eye.clone().sub(node.position).normalize();
      let axis: THREE.Vector3, pivot = node.position.clone(), travel = 0, step = 0;
      if (motion === 'knob') {
        // a knob's axis is the dimension least like the other two, and it points at the pilot more or less
        const odd = [0, 1, 2].map((i) => Math.abs(dims[i] - (dims[(i + 1) % 3] + dims[(i + 2) % 3]) / 2));
        const i = odd.indexOf(Math.max(...odd));
        axis = unit(i);
        step = THREE.MathUtils.degToRad(b.step ?? 30);
      } else if (motion === 'button') {
        // pressed in, away from the eye along the part's thinnest dimension
        const i = dims.indexOf(Math.min(...dims));
        axis = unit(i).multiplyScalar(Math.sign(unit(i).dot(toEye)) || 1);
        travel = Math.min(0.003, dims[i] * 0.6);
      } else {
        // the lever is the longest dimension; it swings about the end away from the eye, across the panel's width
        const i = dims.indexOf(Math.max(...dims));
        const lever = unit(i);
        const away = lever.dot(toEye) > 0 ? -1 : 1;
        pivot = node.position.clone().add(ctr).addScaledVector(lever, away * dims[i] / 2);
        // swing fore-aft on a console, up-down on the front panel: about x unless the lever lies along x
        axis = i === 0 ? unit(2) : unit(0);
        travel = THREE.MathUtils.degToRad(b.throw ?? 25);
      }
      const angles = spec.angles?.length === def.positions.length ? spec.angles.map((a) => THREE.MathUtils.degToRad(a)) : undefined;
      this.bound.push({ node, def, motion, basePos: node.position.clone(), baseQuat: node.quaternion.clone(), axis, pivot, travel, step, angles, shown: NaN });
      this.ids.add(def.id);
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.hit = { kind: 'control', def }; this.picks.push(o); } });
    }
  }

  /** where a control's part should be for its position (0..1 for levers and buttons, steps for knobs) */
  private target(b: Bound, v: number) {
    const n = b.def.positions.length;
    if (b.motion === 'knob') return v - (n - 1) / 2;
    if (b.motion === 'button') return v === (b.def.rest ?? 0) ? 0 : 1;
    if (b.angles) return (b.angles[v] ?? 0) / (b.travel || 1);
    return n > 1 ? v / (n - 1) * 2 - 1 : 0;
  }

  update(sys: AircraftSystems, dt: number) {
    const q = new THREE.Quaternion(), off = new THREE.Vector3();
    for (const b of this.bound) {
      const t = this.target(b, sys.get(b.def.id));
      b.shown = Number.isNaN(b.shown) ? t : b.shown + (t - b.shown) * Math.min(1, dt * K);
      if (b.motion === 'button') {
        b.node.position.copy(b.basePos).addScaledVector(b.axis, -b.travel * b.shown);
        continue;
      }
      q.setFromAxisAngle(b.axis, b.motion === 'knob' ? -b.step * b.shown : b.travel * b.shown);
      off.copy(b.basePos).sub(b.pivot).applyQuaternion(q);
      b.node.position.copy(b.pivot).add(off);
      b.node.quaternion.copy(q).multiply(b.baseQuat);
    }
  }

  /** put every part back as it was in the file */
  reset() {
    for (const b of this.bound) { b.node.position.copy(b.basePos); b.node.quaternion.copy(b.baseQuat); }
  }
}
