// The F-16 cockpit model (assets/models/cockpits/f16/cockpit.glb, Jonathan's model) in the 3D world.
//
// It is loaded when the player enters cockpit view and unloaded (GPU memory freed) when the player leaves it; the
// positions of the switches live in the flight's CockpitPanel (controls.ts), so nothing is lost in between.
//
// The model's control nodes carry their geometry baked in model coordinates (the node origins are not hinge points),
// so every control gets a pivot of its own. Each control finds the panel it sits on by a ray from the eye through
// it: the panel face behind it gives the panel's normal, and "up" on that panel is the world's up (or, on a flat
// console, forward) laid into the panel plane. Then, as in Jonathan's arrow pictures (2026-11-22):
//  * toggle switches and levers hinge at their base on the panel and tip up and down along the panel;
//  * knobs, wheels and rheostats turn about the panel's normal, clockwise for a higher detent;
//  * buttons travel in along the normal while pressed;
//  * the ICP dobber tips towards the side that is held.
import * as THREE from 'three';
import { CockpitScreens } from './screens.js';
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
const MODEL_EYE = new THREE.Vector3(0, 2.58, -3.30);
/** the exterior F-16's MFD centre in the body frame (render/hdModels.ts, BOH_F16.mfds): the cockpit is placed so
 *  its MFDs land on the exterior model's, which lines it up with the canopy and the airframe */
const EXTERIOR_MFD_CENTRE = new THREE.Vector3(0.002, 0.835, -3.923);

/** throw of one switch step (deg) */
const SWITCH_STEP = 25;
/** knob detent angles (deg) and the detent the model is drawn in, read off Jonathan's pictures; others: 45° and the
 *  middle detent */
const KNOBS: Record<string, { step: number; model?: number }> = {
  ENG_FEED: { step: 60 }, AIR_SOURCE: { step: 60 }, IFF_MASTER: { step: 45 }, INS_FUNCTION: { step: 40 },
  UHF_PWR: { step: 45 }, UHF_MODE: { step: 45 }, FUEL_SELECT: { step: 40 }, NAV_MODE: { step: 40 },
  UHF_DIGIT1: { step: 30 }, UHF_DIGIT2: { step: 30 }, UHF_DIGIT3: { step: 30 }, UHF_DIGIT4: { step: 30 },
  UHF_DIGIT5AND6: { step: 30 }, CHAN_SEL: { step: 18 },
};
/** switches that move left and right on their panel instead of up and down */
const SIDEWAYS = new Set<string>();
const BUTTON_TRAVEL = 0.002;

export interface CockpitHit { id: string; kind: ControlKind; dir4?: 1 | 2 | 3 | 4 }

interface Part {
  def: ControlDef;
  pivot: THREE.Group;
  /** hinge or spin axis in the cockpit frame */
  axis: THREE.Vector3;
  /** the panel's normal (towards the pilot) and its up direction */
  normal: THREE.Vector3;
  up: THREE.Vector3;
  /** the position the model is drawn in */
  modelPos: number;
  step: number;
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
  private hidden: THREE.Object3D[] = [];
  private body: THREE.Object3D | null = null;
  private ray = new THREE.Raycaster();
  /** the MFDs, DED and HUD drawn onto the model (made with the model, freed with it) */
  screens: CockpitScreens | null = null;
  /** each frame while the model is shown: draw the displays (set by the flight session) */
  onDraw: ((scr: CockpitScreens) => void) | null = null;

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
    this.pose();
    if (this.screens && this.onDraw) this.onDraw(this.screens);
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
      const side = new THREE.Vector3().crossVectors(part.up, part.normal).normalize();
      const u = local.dot(part.up), r = local.dot(side);
      hit.dir4 = Math.abs(u) > Math.abs(r) ? (u > 0 ? 1 : 2) : (r < 0 ? 3 : 4);
    }
    return hit;
  }

  /** Leave cockpit view: remove the model and free its memory; the exterior shows again. */
  unload() {
    for (const o of this.hidden) o.visible = true;
    this.hidden = []; this.hiddenFor = undefined;
    if (this.root) { this.root.parent?.remove(this.root); dispose(this.root); }
    this.screens?.dispose(); this.screens = null;
    this.root = null;
    this.parts.clear(); this.pickMeshes = []; this.meshPart.clear();
    this.loading = false;
    this.body = null;
    this.gen++;
  }

  private hiddenFor: unknown = undefined;

  private hideExterior(m: AircraftModel) {
    // again once the HD exterior has loaded: its cockpit would otherwise show through the model's screens
    if (this.hiddenFor === m.hd) return;
    this.hiddenFor = m.hd;
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
    // first every control node, so the panel rays can skip them
    const found: Array<{ def: ControlDef; node: THREE.Object3D; meshes: THREE.Mesh[] }> = [];
    const controlMeshes = new Set<THREE.Object3D>();
    for (const def of CONTROLS) {
      const node = byName.get(sanitize(def.node));
      if (!node) { console.warn('cockpit model: no node', def.node); continue; }
      const meshes: THREE.Mesh[] = [];
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      found.push({ def, node, meshes });
      for (const m of meshes) controlMeshes.add(m);
    }
    const panels: THREE.Mesh[] = [];
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !controlMeshes.has(m)) panels.push(m); });
    for (const { def, node, meshes } of found) {
      const box = new THREE.Box3().setFromObject(node);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      // a node far larger than any control stays where it is (a guard against a misnamed node)
      if (Math.max(size.x, size.y, size.z) > MAX_PART_SIZE) { console.warn('cockpit model: node too large to move', def.node); continue; }
      const away = centre.clone().sub(eye).normalize();
      const normal = panelNormal(this.ray, eye, centre, away, panels);
      const up = panelUp(normal);
      const side = new THREE.Vector3().crossVectors(up, normal).normalize();   // to the right on the panel
      const pts = vertices(meshes);
      // the part's extent along the normal: the base sits on the panel
      let lo = Infinity, hi = -Infinity;
      for (const v of pts) { const d = v.dot(normal); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      const band = (from: number, to: number) => {
        const c = new THREE.Vector3(); let k = 0;
        for (const v of pts) { const t = (v.dot(normal) - lo) / Math.max(1e-6, hi - lo); if (t >= from && t <= to) { c.add(v); k++; } }
        return k ? c.divideScalar(k) : centre.clone();
      };
      let pivotAt = centre.clone();
      let axis = normal.clone();
      let modelPos = 0, step = 0;
      if (def.kind === 'switch' && !def.fourWay) {
        const base = band(0, 0.25), tip = band(0.75, 1);
        pivotAt = base;
        const dir = SIDEWAYS.has(def.id) ? side : up;
        // a higher position is up (or right): the lever turns from the normal towards `dir`
        axis = new THREE.Vector3().crossVectors(normal, dir).normalize();
        step = SWITCH_STEP;
        // the position the model is drawn in, from the lever's lean
        const lean = Math.atan2(tip.clone().sub(base).dot(dir), Math.max(1e-6, tip.clone().sub(base).dot(normal))) * 180 / Math.PI;
        modelPos = def.n === 2 ? (lean >= 0 ? 1 : 0) : Math.max(0, Math.min(def.n - 1, Math.round((def.n - 1) / 2 + lean / SWITCH_STEP)));
      } else if (def.kind === 'knob') {
        const k = KNOBS[def.id];
        step = k?.step ?? 45;
        modelPos = k?.model ?? Math.floor((def.n - 1) / 2);
        pivotAt = band(0, 1).clone();
        // the spin axis runs through the knob's middle, along the normal
        pivotAt.add(normal.clone().multiplyScalar((lo + hi) / 2 - pivotAt.dot(normal)));
      } else if (def.kind === 'axis') {
        step = def.endless ? 360 : 270;
        pivotAt.add(normal.clone().multiplyScalar((lo + hi) / 2 - pivotAt.dot(normal)));
      }
      const pivot = new THREE.Group();
      pivot.position.copy(pivotAt);
      root.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(node);
      const part: Part = { def, pivot, axis, normal, up, modelPos, step, away, centre, meshes, shown: Number.NaN };
      this.parts.set(def.id, part);
      for (const mm of meshes) { this.pickMeshes.push(mm); this.meshPart.set(mm, part); }
    }
    this.screens = new CockpitScreens(root, byName, eye);
    // "throttle (B)" in the model is the canopy structure, not the throttle (Jonathan, 2026-11-22): it never moves
    return root;
  }

  /** Put every control where the panel says. */
  pose(throttle = 0) {
    void throttle;
    const panel = this.panel;
    if (panel) for (const p of this.parts.values()) {
      const v = panel.get(p.def.id);
      if (v === p.shown) continue;
      p.shown = v;
      const d = p.def;
      p.pivot.quaternion.identity();
      p.pivot.position.sub(p.pivot.userData.offset ?? new THREE.Vector3());
      p.pivot.userData.offset = new THREE.Vector3();
      const D = THREE.MathUtils.DEG2RAD;
      if (d.kind === 'button') {
        const off = p.normal.clone().multiplyScalar(v ? -BUTTON_TRAVEL : 0);
        p.pivot.position.add(off); p.pivot.userData.offset = off;
      } else if (d.kind === 'knob') {
        // clockwise, seen from the pilot, for a higher detent
        p.pivot.quaternion.setFromAxisAngle(p.normal, -(v - p.modelPos) * p.step * D);
      } else if (d.kind === 'axis') {
        p.pivot.quaternion.setFromAxisAngle(p.normal, -(v - 0.5) * p.step * D);
      } else if (d.fourWay) {
        const tilt = 10 * D;
        const side = new THREE.Vector3().crossVectors(p.up, p.normal).normalize();
        // up / down: turn about the side axis; left / right: about the up axis
        if (v === 1 || v === 2) p.pivot.quaternion.setFromAxisAngle(side, v === 1 ? -tilt : tilt);
        else if (v === 3 || v === 4) p.pivot.quaternion.setFromAxisAngle(p.up, v === 3 ? -tilt : tilt);
      } else {
        p.pivot.quaternion.setFromAxisAngle(p.axis, (v - p.modelPos) * p.step * D);
      }
    }
  }

  /** the control parts found in the model (tests) */
  get partCount() { return this.parts.size; }
  /** a control's pivot (tests) */
  pivotOf(id: string): THREE.Object3D | undefined { return this.parts.get(id)?.pivot; }
}

/** The normal of the panel a control sits on: a ray from the eye through the control to the first panel face
 *  behind it (not counting the control itself). Points towards the pilot. */
function panelNormal(ray: THREE.Raycaster, eye: THREE.Vector3, centre: THREE.Vector3, away: THREE.Vector3, panels: THREE.Object3D[]): THREE.Vector3 {
  ray.set(eye, away); ray.near = eye.distanceTo(centre) - 0.01; ray.far = eye.distanceTo(centre) + 0.08;
  for (const h of ray.intersectObjects(panels, false)) {
    if (!h.face) continue;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.dot(away) > 0) n.negate();
    if (n.dot(away) < -0.2) return n;
  }
  return away.clone().negate();
}

/** "Up" on a panel: the world's up laid into the panel's plane, or on a flat console, forward (−z). */
function panelUp(normal: THREE.Vector3): THREE.Vector3 {
  const lay = (v: THREE.Vector3) => v.clone().sub(normal.clone().multiplyScalar(v.dot(normal)));
  const u = lay(new THREE.Vector3(0, 1, 0));
  return (u.length() > 0.5 ? u : lay(new THREE.Vector3(0, 0, -1))).normalize();
}

/** every vertex of the meshes, in the cockpit frame */
function vertices(meshes: THREE.Mesh[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const a = m.geometry.getAttribute('position');
    if (!a) continue;
    const stride = Math.max(1, Math.floor(a.count / 400));
    for (let i = 0; i < a.count; i += stride) out.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld));
  }
  return out;
}
