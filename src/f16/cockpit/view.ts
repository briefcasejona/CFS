// The F-16 cockpit model (assets/models/cockpits/f16/cockpit.glb, Jonathan's model) in the 3D world.
//
// It is loaded when the player enters cockpit view and unloaded (GPU memory freed) when the player leaves it; the
// positions of the switches live in the flight's CockpitPanel (controls.ts), so nothing is lost in between.
//
// The model's control nodes carry their geometry baked in model coordinates (the node origins are not hinge points),
// so every control gets a pivot of its own, found from its mesh bounds:
//  * switches and levers hinge at the end farthest from the pilot's eye (the panel side) and tip about the panel's
//    lateral axis; each position is one throw step;
//  * knobs, wheels and rheostats turn about their own axis of symmetry;
//  * buttons travel in, away from the eye, while pressed;
//  * the ICP dobber tips towards the side that is held.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Aircraft } from '../../sim/entities.js';
import type { AircraftModel } from '../../render/models.js';
import { CONTROLS, sanitize, type CockpitPanel, type ControlDef, type ControlKind } from './controls.js';

export const COCKPIT_URL = 'assets/models/cockpits/f16/cockpit.glb';

/** The model sits in its file with nose −Z, y up and x right after its nodes' own transforms (they carry the
 *  model's Z-up → Y-up turn). These are measured on the file, in its scene frame (metres):
 *  the centre of the two MFD faces, and the design eye. */
const MODEL_MFD_CENTRE = new THREE.Vector3(0, 2.174, -4.07);
/** the design eye: on the centreline, level with the upper third of the HUD combiner (glass 2.39 … 2.57 m high,
 *  3.80 … 4.02 m forward) and 0.62 m behind it, so the HUD fills the forward view as in the jet */
const MODEL_EYE = new THREE.Vector3(0, 2.52, -3.30);
/** the exterior F-16's MFD centre in the body frame (render/hdModels.ts, BOH_F16.mfds): the cockpit is placed so
 *  its MFDs land on the exterior model's, which lines it up with the canopy and the airframe */
const EXTERIOR_MFD_CENTRE = new THREE.Vector3(0.002, 0.835, -3.923);

/** throw of one switch step (deg); knob detent angle is 360/n up to 30° */
const SWITCH_STEP = 25;
const BUTTON_TRAVEL = 0.002;

export interface CockpitHit { id: string; kind: ControlKind; dir4?: 1 | 2 | 3 | 4 }

interface Part {
  def: ControlDef;
  pivot: THREE.Group;
  /** hinge or spin axis in the cockpit frame */
  axis: THREE.Vector3;
  /** unit vector from the eye to the part (button travel, dobber layout) */
  away: THREE.Vector3;
  centre: THREE.Vector3;
  meshes: THREE.Mesh[];
  shown: number;
}

let loader: GLTFLoader | null = null;

function dispose(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/** m: no single switch, knob or button in the cockpit is larger than this */
const MAX_PART_SIZE = 0.3;

export class F16CockpitView {
  /** the flight's control positions (set by the flight session) */
  panel: CockpitPanel | null = null;
  private root: THREE.Group | null = null;
  private loading = false;
  private failed = false;
  private gen = 0;
  private parts = new Map<string, Part>();
  private pickMeshes: THREE.Mesh[] = [];
  private meshPart = new Map<THREE.Object3D, Part>();
  private throttle: { pivot: THREE.Group } | null = null;
  private hidden: THREE.Object3D[] = [];
  private body: THREE.Object3D | null = null;
  private ray = new THREE.Raycaster();

  get loaded() { return !!this.root; }

  /** The eye point in the body frame. */
  eye(): THREE.Vector3 {
    return MODEL_EYE.clone().sub(MODEL_MFD_CENTRE).add(EXTERIOR_MFD_CENTRE);
  }

  /** Each frame for the player's jet. `inside`: the camera is in cockpit view. */
  update(m: AircraftModel, ac: Aircraft, inside: boolean, dt: number, base = '') {
    if (!inside || ac.def.family !== 'F-16') { if (this.root || this.loading) this.unload(); return; }
    if (this.body && this.body !== m.body) this.unload();
    this.body = m.body;
    this.hideExterior(m);
    if (!this.root) { this.request(base); return; }
    if (this.root.parent !== m.body) {
      this.root.position.copy(EXTERIOR_MFD_CENTRE).sub(MODEL_MFD_CENTRE);
      m.body.add(this.root);
    }
    this.pose(ac.ctrl.throttle);
    void dt;
  }

  /** The control under a screen position (normalised device coordinates), if any. */
  pick(cam: THREE.Camera, ndcX: number, ndcY: number): CockpitHit | null {
    if (!this.root?.parent || !this.pickMeshes.length) return null;
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    this.ray.near = 0.05; this.ray.far = 2;
    const hits = this.ray.intersectObjects(this.pickMeshes, false);
    if (!hits.length) return null;
    const part = this.meshPart.get(hits[0].object)!;
    const hit: CockpitHit = { id: part.def.id, kind: part.def.kind };
    if (part.def.fourWay) {
      const local = this.root.worldToLocal(hits[0].point.clone()).sub(part.centre);
      hit.dir4 = Math.abs(local.y) > Math.abs(local.x) ? (local.y > 0 ? 1 : 2) : (local.x < 0 ? 3 : 4);
    }
    return hit;
  }

  /** Leave cockpit view: remove the model and free its memory; the exterior shows again. */
  unload() {
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    if (this.root) { this.root.parent?.remove(this.root); dispose(this.root); }
    this.root = null;
    this.parts.clear(); this.pickMeshes = []; this.meshPart.clear(); this.throttle = null;
    this.loading = false;
    this.body = null;
    this.gen++;
  }

  private hideExterior(m: AircraftModel) {
    if (this.hidden.length) return;
    // the exterior's own cockpit, HUD and canopy glass would show through the model; the procedural canopy too
    const hide = [...(m.hd?.cockpit ?? []), ...(m.hd?.glass ?? []), m.canopy];
    for (const o of hide) if (o.visible) { o.visible = false; this.hidden.push(o); }
  }

  private request(base: string) {
    if (this.loading || this.failed) return;
    this.loading = true;
    const gen = this.gen;
    loader ??= new GLTFLoader();
    loader.load(base + COCKPIT_URL, (gltf) => {
      if (gen !== this.gen) { dispose(gltf.scene); return; }
      this.loading = false;
      this.root = this.build(gltf.scene);
    }, undefined, (err) => {
      this.loading = false; this.failed = true;
      console.warn('F-16 cockpit model could not be loaded', err);
    });
  }

  /** Take the loaded scene apart into pivots for every control. (Public for the tests.) */
  build(scene: THREE.Group): THREE.Group {
    const root = new THREE.Group();
    root.name = 'f16-cockpit';
    scene.updateMatrixWorld(true);
    const byName = new Map<string, THREE.Object3D>();
    scene.traverse((o) => {
      const n = (o.userData.name as string | undefined) ?? o.name;
      if (n) { byName.set(sanitize(n), o); byName.set(sanitize(o.name), o); }
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          // the HUD combiner: faint see-through glass
          if (mat.name === 'glas') { mat.transparent = true; mat.opacity = 0.12; mat.depthWrite = false; }
        }
      }
    });
    root.add(scene);
    const eye = MODEL_EYE;
    for (const def of CONTROLS) {
      const node = byName.get(sanitize(def.node));
      if (!node) { console.warn('cockpit model: no node', def.node); continue; }
      const box = new THREE.Box3().setFromObject(node);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      // a node far larger than any control (UFC_S2 spans the whole cockpit in this model) stays where it is
      if (Math.max(size.x, size.y, size.z) > MAX_PART_SIZE) { console.warn('cockpit model: node too large to move', def.node); continue; }
      const away = centre.clone().sub(eye).normalize();
      let pivotAt = centre.clone();
      let axis = new THREE.Vector3(1, 0, 0);
      if (def.kind === 'knob' || def.kind === 'axis') axis = spinAxis(size, away);
      else if (def.kind === 'switch') {
        // the hinge: the end of the lever's long axis farther from the eye
        const k = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
        const lo = centre.clone(), hi = centre.clone();
        lo[k] = box.min[k]; hi[k] = box.max[k];
        pivotAt = lo.distanceTo(eye) > hi.distanceTo(eye) ? lo : hi;
        // a lever lying across (long axis x) tips fore and aft about y; otherwise about x
        axis = k === 'x' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      }
      const pivot = new THREE.Group();
      pivot.position.copy(pivotAt);
      root.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(node);
      const meshes: THREE.Mesh[] = [];
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const part: Part = { def, pivot, axis, away, centre, meshes, shown: Number.NaN };
      this.parts.set(def.id, part);
      for (const mm of meshes) { this.pickMeshes.push(mm); this.meshPart.set(mm, part); }
    }
    const thr = byName.get(sanitize('throttle (B)'));
    if (thr) {
      const box = new THREE.Box3().setFromObject(thr);
      const pivot = new THREE.Group();
      // the throttle swings fore and aft about a pivot below the console
      pivot.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.12, (box.min.z + box.max.z) / 2);
      root.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(thr);
      this.throttle = { pivot };
    }
    return root;
  }

  /** Put every control where the panel says, and the throttle at `throttle` (0 … 1). */
  pose(throttle: number) {
    const panel = this.panel;
    if (panel) for (const p of this.parts.values()) {
      const v = panel.get(p.def.id);
      if (v === p.shown) continue;
      p.shown = v;
      const d = p.def;
      p.pivot.quaternion.identity();
      p.pivot.position.sub(p.pivot.userData.offset ?? new THREE.Vector3());
      p.pivot.userData.offset = new THREE.Vector3();
      if (d.kind === 'button') {
        const off = p.away.clone().multiplyScalar(v ? BUTTON_TRAVEL : 0);
        p.pivot.position.add(off); p.pivot.userData.offset = off;
      } else if (d.kind === 'knob') {
        const step = Math.min(30, 360 / d.n);
        p.pivot.quaternion.setFromAxisAngle(p.axis, -(v - (d.n - 1) / 2) * step * THREE.MathUtils.DEG2RAD);
      } else if (d.kind === 'axis') {
        p.pivot.quaternion.setFromAxisAngle(p.axis, -(v - 0.5) * (d.endless ? 360 : 270) * THREE.MathUtils.DEG2RAD);
      } else if (d.fourWay) {
        const tilt = 10 * THREE.MathUtils.DEG2RAD;
        if (v === 1 || v === 2) p.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), v === 1 ? -tilt : tilt);
        else if (v === 3 || v === 4) p.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v === 3 ? tilt : -tilt);
      } else {
        // positions spread evenly about the modelled pose; a higher index is up / forward
        const ang = -(v - (d.n - 1) / 2) * SWITCH_STEP * THREE.MathUtils.DEG2RAD;
        p.pivot.quaternion.setFromAxisAngle(p.axis, ang);
      }
    }
    if (this.throttle) {
      // idle aft, full afterburner forward (the model is drawn at mid travel)
      const k = throttle - 0.5;
      this.throttle.pivot.rotation.x = -k * 30 * THREE.MathUtils.DEG2RAD;
    }
  }

  /** the control parts found in the model (tests) */
  get partCount() { return this.parts.size; }
  /** a control's pivot (tests) */
  pivotOf(id: string): THREE.Object3D | undefined { return this.parts.get(id)?.pivot; }
}

/** a knob's or wheel's spin axis: the box dimension that differs most from the other two (a disc: the thin one, a
 *  long cylinder: the long one), signed to point away from the eye */
function spinAxis(size: THREE.Vector3, away: THREE.Vector3): THREE.Vector3 {
  const d = [size.x, size.y, size.z];
  let best = 0, score = -1;
  for (let k = 0; k < 3; k++) {
    const o = d.filter((_, j) => j !== k);
    const s = Math.abs(Math.log((d[k] + 1e-6) / Math.sqrt(o[0] * o[1] + 1e-12))) - Math.abs(Math.log((o[0] + 1e-6) / (o[1] + 1e-6)));
    if (s > score) { score = s; best = k; }
  }
  const a = new THREE.Vector3(best === 0 ? 1 : 0, best === 1 ? 1 : 0, best === 2 ? 1 : 0);
  if (a.dot(away) < 0) a.negate();
  return a;
}
