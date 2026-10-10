// Optional high-detail (HD) aircraft models loaded from glTF files (user-supplied, CC BY-NC-SA — see
// assets/models/cc-by-nc-sa/LICENSE.md). The procedural model stays the source of truth: it is shown until the
// GLB has loaded, beyond HD_RANGE, when HD models are disabled, and it is what hit-tests/physics are sized from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AircraftDef } from '../aircraft/types.js';

export interface HdSpec {
  url: string;
  title: string; author: string; source: string; license: string;
  /** node-name patterns (matched against "parentName/meshName") */
  gearDown: RegExp; gearUp: RegExp; cockpit: RegExp; hide?: RegExp;
  /** swing wing (F-14): outer-wing vertices beyond |x| > minAbsX (game metres) and forward of maxZ rotate around (±pivotX, *, pivotZ) */
  swing?: { pivotX: number; pivotZ: number; minAbsX: number; maxZ: number; refSweep: number };
  /** pilot eye position in game metres (body frame); default derived from the cockpit node's bounds */
  eye?: { y: number; z: number };
}

/** HD models per aircraft family (every variant of the family uses it). */
export const HD_SPECS: Record<string, HdSpec> = {
  'F-14': {
    url: 'assets/models/cc-by-nc-sa/f14.glb', title: 'F-14 Tomcat - Fighter Jet - Free', author: 'bohmerang',
    source: 'https://sketchfab.com/3d-models/f-14-tomcat-fighter-jet-free-497f77c311b5411d9b567d8707a81c33', license: 'CC BY-NC-SA 4.0',
    gearDown: /gearOn/i, gearUp: /gearOff/i, cockpit: /cockpit|instrGlass/i,
    swing: { pivotX: 2.7, pivotZ: -1.5, minAbsX: 3.85, maxZ: 4.5, refSweep: 20 },
    eye: { y: 1.6, z: -5.0 },
  },
  'JAS 39': {
    url: 'assets/models/cc-by-nc-sa/gripen.glb', title: 'Saab JAS 39 Gripen - Fighter Jet - Free', author: 'bohmerang',
    source: 'https://sketchfab.com/3d-models/saab-jas-39-gripen-fighter-jet-free-03d4f4f0f7e94f469299ba7db4c707c4', license: 'CC BY-NC-SA 4.0',
    gearDown: /landingOn/i, gearUp: /landingOff/i, cockpit: /cockpit|hud/i,
  },
};

/** Distance (m) beyond which the cheaper procedural model is drawn instead. */
export const HD_RANGE = 3500;

let enabled = true;
export function setHdModelsEnabled(on: boolean) { enabled = on; }
export function hdModelsEnabled() { return enabled; }
export function hdSpecFor(def: AircraftDef): HdSpec | undefined { return HD_SPECS[def.family ?? def.name]; }
export function hasHdModel(def: AircraftDef) { return !!hdSpecFor(def); }

interface Template { root: THREE.Group; spec: HdSpec }
const templates = new Map<string, Promise<Template | null>>();
let loader: GLTFLoader | null = null;

// source (x fwd, y up, z right) → game (x right, y up, z aft)
const SRC_TO_GAME = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);

function loadTemplate(def: AircraftDef): Promise<Template | null> {
  let p = templates.get(def.id);
  if (p) return p;
  const spec = hdSpecFor(def)!;
  loader ??= new GLTFLoader();
  const l = loader;
  p = new Promise<Template | null>((resolve) => {
    l.load(spec.url, (gltf) => {
      try { resolve({ root: bake(gltf.scene, spec, def), spec }); } catch (e) { console.warn('HD model failed', def.id, e); resolve(null); }
    }, undefined, (err) => { console.warn('HD model not available', def.id, err); resolve(null); });
  });
  templates.set(def.id, p);
  return p;
}

/** Flatten the glTF hierarchy into game-frame meshes (metres, nose −Z), scaled to def.length, gear bottom at −gear.height. */
export function bake(scene: THREE.Object3D, spec: HdSpec, def: AircraftDef): THREE.Group {
  scene.updateMatrixWorld(true);
  const parts: { name: string; mesh: THREE.Mesh }[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = `${m.parent?.name ?? ''}/${m.name}`;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(SRC_TO_GAME, m.matrixWorld));
    for (const a of ['tangent', 'uv2', 'uv3']) if (g.getAttribute(a)) g.deleteAttribute(a);
    parts.push({ name, mesh: new THREE.Mesh(g, m.material) });
  });
  // scale + centre on the airframe bounding box
  const box = new THREE.Box3();
  for (const p of parts) if (!spec.gearDown.test(p.name) && !spec.gearUp.test(p.name)) box.expandByObject(p.mesh);
  const s = def.length / (box.max.z - box.min.z);
  let gearMin = Infinity;
  for (const p of parts) if (spec.gearDown.test(p.name)) { p.mesh.geometry.computeBoundingBox(); gearMin = Math.min(gearMin, p.mesh.geometry.boundingBox!.min.y); }
  const cz = (box.min.z + box.max.z) / 2;
  const yShift = Number.isFinite(gearMin) ? -def.gear.height - gearMin * s : -((box.min.y + box.max.y) / 2) * s;
  const fix = new THREE.Matrix4().makeTranslation(0, yShift, -cz * s).multiply(new THREE.Matrix4().makeScale(s, s, s));
  const root = new THREE.Group();
  for (const p of parts) {
    p.mesh.geometry.applyMatrix4(fix);
    p.mesh.geometry.computeBoundingSphere();
    p.mesh.name = p.name;
    p.mesh.userData.role = spec.gearDown.test(p.name) ? 'gearDown' : spec.gearUp.test(p.name) ? 'gearUp'
      : spec.cockpit.test(p.name) ? 'cockpit' : spec.hide?.test(p.name) ? 'hidden' : 'body';
    const mats = (Array.isArray(p.mesh.material) ? p.mesh.material : [p.mesh.material]) as THREE.MeshStandardMaterial[];
    for (const mt of mats) if (mt.isMeshStandardMaterial && mt.metalness > 0.4) mt.metalness = 0.4; // no env map: keep metal from going black
    if (spec.swing && /airframe/i.test(p.name) && !spec.gearDown.test(p.name) && !spec.gearUp.test(p.name)) {
      // un-index so every triangle can be classified as a whole: the outer panel then pivots rigidly instead of
      // stretching the root triangles across the glove
      if (p.mesh.geometry.index) p.mesh.geometry = p.mesh.geometry.toNonIndexed();
      addSwingAttribute(p.mesh.geometry, spec.swing);
    }
    root.add(p.mesh);
  }
  return root;
}

export function addSwingAttribute(g: THREE.BufferGeometry, sw: NonNullable<HdSpec['swing']>) {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count);
  const perTri = !g.index;
  for (let i = 0; i < pos.count; i += perTri ? 3 : 1) {
    const n = perTri ? 3 : 1;
    let x = 0, z = 0;
    for (let k = 0; k < n; k++) { x += pos.getX(i + k); z += pos.getZ(i + k); }
    x /= n; z /= n;
    const v = Math.abs(x) > sw.minAbsX && z < sw.maxZ ? Math.sign(x) : 0;
    for (let k = 0; k < n; k++) a[i + k] = v;
  }
  g.setAttribute('aSwing', new THREE.BufferAttribute(a, 1));
}

/** Per-aircraft instance of an HD model. */
export interface HdInstance {
  root: THREE.Group;
  sweep: { value: number } | null;
  refSweep: number;
  gearDown: THREE.Object3D[];
  gearUp: THREE.Object3D[];
  cockpit: THREE.Object3D[];
  /** transparent canopy glass (hidden from inside) */
  glass: THREE.Object3D[];
  /** pilot eye in the body frame */
  eye: THREE.Vector3;
}

function instantiate(t: Template): HdInstance {
  const root = new THREE.Group();
  const sw = t.spec.swing;
  const inst: HdInstance = { root, sweep: null, refSweep: sw?.refSweep ?? 0, gearDown: [], gearUp: [], cockpit: [], glass: [], eye: new THREE.Vector3() };
  const uSweep = { value: 0 };
  for (const src of t.root.children as THREE.Mesh[]) {
    const role = src.userData.role as string;
    if (role === 'hidden') continue;
    let mat = src.material as THREE.Material;
    if (sw && src.geometry.getAttribute('aSwing')) {
      mat = mat.clone();
      const uPivot = { value: new THREE.Vector2(sw.pivotX, sw.pivotZ) };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uSweep = uSweep; sh.uniforms.uPivot = uPivot;
        const rot = `
          if (aSwing != 0.0) { float sa = -aSwing * uSweep; float cs = cos(sa), sn = sin(sa);`;
        sh.vertexShader = 'attribute float aSwing;\nuniform float uSweep;\nuniform vec2 uPivot;\n' + sh.vertexShader
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>${rot}
            objectNormal = vec3(objectNormal.x * cs + objectNormal.z * sn, objectNormal.y, -objectNormal.x * sn + objectNormal.z * cs); }`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>${rot}
            vec2 pv = vec2(aSwing * uPivot.x, uPivot.y);
            vec2 r = transformed.xz - pv; transformed.xz = pv + vec2(r.x * cs + r.y * sn, -r.x * sn + r.y * cs); }`);
      };
      mat.customProgramCacheKey = () => 'cfs-swing';
      inst.sweep = uSweep;
    }
    const m = new THREE.Mesh(src.geometry, mat);
    if (role === 'gearDown') inst.gearDown.push(m);
    if (role === 'gearUp') inst.gearUp.push(m);
    if (role === 'cockpit') inst.cockpit.push(m);
    const mm = m.material as THREE.Material;
    if (mm.transparent || /glass|canopy/i.test(mm.name)) inst.glass.push(m);
    root.add(m);
  }
  // eye: explicit, else front part of the cockpit volume
  const cb = new THREE.Box3();
  for (const c of inst.cockpit) { const mesh = c as THREE.Mesh; mesh.geometry.computeBoundingBox(); cb.union(mesh.geometry.boundingBox!); }
  const e = t.spec.eye;
  if (e) inst.eye.set(0, e.y, e.z);
  else if (!cb.isEmpty()) inst.eye.set(0, cb.max.y - 0.45, cb.min.z + (cb.max.z - cb.min.z) * 0.55);
  return inst;
}

/** Start loading (if enabled) and call back with a fresh instance when ready. */
export function requestHdModel(def: AircraftDef, cb: (inst: HdInstance) => void) {
  if (!enabled || !hdSpecFor(def) || typeof window === 'undefined') return;
  void loadTemplate(def).then((t) => { if (t) cb(instantiate(t)); });
}

/** Credits for the credits screen. */
export function hdCredits() {
  return Object.entries(HD_SPECS).map(([id, s]) => ({ id, title: s.title, author: s.author, source: s.source, license: s.license }));
}

export function updateHdInstance(inst: HdInstance, gearPos: number, sweepDeg: number) {
  const down = gearPos > 0.5;
  for (const g of inst.gearDown) g.visible = down;
  for (const g of inst.gearUp) g.visible = !down;
  if (inst.sweep) inst.sweep.value = (sweepDeg - inst.refSweep) * Math.PI / 180;
}
