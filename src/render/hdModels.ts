// Optional high-detail (HD) aircraft models loaded from glTF files (third-party, see the LICENSE.md next to each
// file under assets/models/). The procedural model stays the source of truth: it is shown until the GLB has loaded,
// beyond HD_RANGE, when HD models are disabled, and it is what hit-tests/physics are sized from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftDef } from '../aircraft/types.js';

export interface HdSpec {
  url: string;
  title: string; author: string; source: string; license: string;
  /** node-path patterns (matched against "ancestor/…/node" names) */
  gearDown: RegExp; gearUp: RegExp; cockpit: RegExp; hide?: RegExp;
  /** source axes: 'xfwd' = nose +X, right +Z (bohmerang exports, default); 'zfwd' = nose +Z, left +X (FBX exports) */
  axes?: 'xfwd' | 'zfwd';
  /** articulated swing wing: node paths of every moving wing part (panel, slats, flaps, spoilers, lights…), the pivot of
   *  the wing on the source's +X side in source metres, and the sweep (deg) the model is built at.
   *  `split`: the wings are fused into the airframe mesh of the `parts` nodes — every triangle that reaches beyond
   *  |x| > reach (game metres) with its centre forward of z < maxZ (clear of the tailplanes) is cut out and swept with
   *  its side's wing; the pivot is then given in game metres (x outboard, z aft of the model's centre) */
  wings?: { parts: RegExp; pivot: { x: number; z: number }; refSweep: number; split?: { reach: number; maxZ: number } };
  /** pilot eye position in game metres (body frame); default: ~0.65 m behind and just above the HUD combiner node,
   *  else derived from the cockpit node's bounds */
  eye?: { y: number; z: number };
  /** HUD combiner node (for the default eye point); default /hud/i */
  hud?: RegExp;
  /** the source paints the HUD combiner as an opaque plate: draw it as faintly tinted, see-through glass instead */
  hudGlass?: boolean;
  /** live MFD screens laid over the model's painted ones (game body frame, metres): centre, size, facing normal and
   *  which display (0 = left MFD canvas, 1 = right) — measured by raycasting the cockpit from the eye point */
  mfds?: Array<{ c: [number, number, number]; w: number; h: number; n: [number, number, number]; screen: 0 | 1 }>;
}

const BOHMERANG = { author: 'bohmerang', license: 'CC BY-NC-SA 4.0' };
const BOH_PARTS = { gearDown: /landingOn/i, gearUp: /landingOff/i, cockpit: /cockpit|hud/i, hudGlass: true };
const NEVER = /(?!)/;

// bohmerang's F-14A: the wings are part of the one airframe mesh, so they are cut out of it at bake time
const BOH_F14: HdSpec = {
  url: 'assets/models/cc-by-nc-sa/f14.glb', title: 'F-14 Tomcat - Fighter Jet - Free', ...BOHMERANG,
  source: 'https://sketchfab.com/3d-models/f-14-tomcat-fighter-jet-free-497f77c311b5411d9b567d8707a81c33',
  gearDown: /gearOn/i, gearUp: /gearOff/i, cockpit: /cockpit|instrGlass/i,
  wings: { parts: /airframe_0/, pivot: { x: 2.72, z: 1.55 }, refSweep: 20, split: { reach: 3.6, maxZ: 5.0 } },
  eye: { y: 1.6, z: -5.0 },
};

const BOH_F16: HdSpec = {
  url: 'assets/models/cc-by-nc-sa/f16.glb', title: 'F-16 Fighting Falcon - Fighter Jet - Free', ...BOHMERANG,
  source: 'https://sketchfab.com/3d-models/f-16-fighting-falcon-fighter-jet-free-f0b00989e5634764848ef2c235c64db5', ...BOH_PARTS,
  mfds: [
    { c: [-0.168, 0.835, -3.923], w: 0.08, h: 0.088, n: [0, 0.23, 0.97], screen: 0 },
    { c: [0.172, 0.835, -3.923], w: 0.08, h: 0.088, n: [0, 0.23, 0.97], screen: 1 },
  ],
};

/** HD models, keyed by aircraft id (one variant) or by family (every variant of the family). */
export const HD_SPECS: Record<string, HdSpec> = {
  // F-14A and F-14B: bohmerang's Tomcat (the B(U) uses it too until its own model is added)
  f14a: BOH_F14,
  f14b1: BOH_F14,
  f14b: BOH_F14,
  // F-14D: one articulated model: wings, slats, flaps and spoilers are separate nodes that sweep
  // rigidly about the real pivot (2.72 m from the centreline) — the published 68° / 75° spans check out on it
  f14d: {
    url: 'assets/models/cc-by/f14d.glb', title: 'Grumman F-14D "Super Tomcat"', author: 'KOG_THORNS',
    source: 'https://sketchfab.com/3d-models/grumman-f-14d-super-tomcat-74be89a104a34caabacb25a705708097', license: 'CC BY 4.0',
    axes: 'zfwd',
    gearDown: /vehicle#(gear|wheel)_/i, gearUp: NEVER,
    cockpit: /MFD Display|DISPLAY|\/HUD\/|cockpit|Meshpart|RIO|\/Glass\//i,
    hud: /\/HUD\//,
    wings: { parts: /vehicle#(wing_[lr]_|slat_[lr]_|flap\w*?_[lr]_|aileron_interceptor_[lr]_)/i, pivot: { x: 2.72, z: 0.32 }, refSweep: 20 },
    mfds: [
      { c: [0.007, 1.164, -5.652], w: 0.11, h: 0.105, n: [0, 0.17, 0.99], screen: 0 },
      { c: [0.187, 1.176, -5.653], w: 0.11, h: 0.105, n: [0, 0.17, 0.99], screen: 1 },
    ],
  },
  'JAS 39': {
    url: 'assets/models/cc-by-nc-sa/gripen.glb', title: 'Saab JAS 39 Gripen - Fighter Jet - Free', ...BOHMERANG,
    source: 'https://sketchfab.com/3d-models/saab-jas-39-gripen-fighter-jet-free-03d4f4f0f7e94f469299ba7db4c707c4', ...BOH_PARTS,
    // tactical (centre) display carries the radar page, the right one the RWR/stores page
    mfds: [
      { c: [0, 0.518, -3.463], w: 0.165, h: 0.15, n: [0, 0.1, 1], screen: 0 },
      { c: [0.168, 0.518, -3.463], w: 0.108, h: 0.145, n: [0, 0.1, 1], screen: 1 },
    ],
  },
  // single-seat F-16C Block 50 and Block 70 only: the other F-16s (two-seaters, A/B, Block 40) keep the procedural
  // model until they have their own
  f16c: BOH_F16,
  f16c70: BOH_F16,
  // the Super Hornet model only: the legacy F/A-18C has a different (smaller) airframe and keeps the procedural model
  fa18e: {
    url: 'assets/models/cc-by-nc-sa/fa18f.glb', title: 'Boeing F/A-18F Super Hornet - Free', ...BOHMERANG,
    source: 'https://sketchfab.com/3d-models/boeing-fa-18f-super-hornet-free-447caa975f534554a83f70f0877b73fb', ...BOH_PARTS,
    mfds: [
      { c: [-0.186, 1.268, -4.808], w: 0.125, h: 0.112, n: [0, 0.21, 0.98], screen: 0 },
      { c: [0.187, 1.268, -4.808], w: 0.125, h: 0.112, n: [0, 0.21, 0.98], screen: 1 },
    ],
  },
  f4e: {
    url: 'assets/models/cc-by-nc-sa/f4.glb', title: 'F-4 Phantom II - Fighter Jet - Free', ...BOHMERANG,
    source: 'https://sketchfab.com/3d-models/f-4-phantom-ii-fighter-jet-free-f0b9ac8bdab149f3b75352a9f4f4e1c8', ...BOH_PARTS,
  },
};

/** Distance (m) beyond which the cheaper procedural model is drawn instead. */
export const HD_RANGE = 3500;

let enabled = true;
export function setHdModelsEnabled(on: boolean) { enabled = on; }
export function hdModelsEnabled() { return enabled; }
export function hdSpecFor(def: AircraftDef): HdSpec | undefined { return HD_SPECS[def.id] ?? HD_SPECS[def.family ?? def.name]; }
export function hasHdModel(def: AircraftDef) { return !!hdSpecFor(def); }

interface Template { root: THREE.Group; spec: HdSpec }
const templates = new Map<string, Promise<Template | null>>();
let loader: GLTFLoader | null = null;

// source → game frame (x right, y up, z aft)
const SRC_TO_GAME = {
  xfwd: new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1),   // x fwd, z right
  zfwd: new THREE.Matrix4().makeRotationY(Math.PI),                                   // z fwd, x left
};

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

/** every attribute becomes a plain, uniform Float32 attribute: quantized (KHR_mesh_quantization) data survives being
 *  transformed, and geometries from different nodes can be merged (mergeGeometries needs identical attribute types) */
function floatAttributes(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
}

function pathOf(o: THREE.Object3D) {
  let s = '';
  for (let a: THREE.Object3D | null = o; a; a = a.parent) s = `${a.name}/${s}`;
  return s;
}

/**
 * Flatten the glTF hierarchy into game-frame meshes (metres, nose −Z), scaled to def.length with the gear bottom at
 * −gear.height, merged per role / wing side / material to keep draw calls low. Moving wing parts are tagged with
 * their side; root.userData.pivot is the (right) wing pivot in the game frame.
 */
export function bake(scene: THREE.Object3D, spec: HdSpec, def: AircraftDef): THREE.Group {
  scene.updateMatrixWorld(true);
  const toGame = SRC_TO_GAME[spec.axes ?? 'xfwd'];
  const parts: { name: string; geo: THREE.BufferGeometry; mat: THREE.Material; wing: number }[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = pathOf(m);
    const g = m.geometry.clone();
    floatAttributes(g);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGame, m.matrixWorld));
    for (const a of ['tangent', 'uv1', 'uv2', 'uv3']) if (g.getAttribute(a)) g.deleteAttribute(a);
    if (!g.getAttribute('normal')) g.computeVertexNormals();   // parts simplified without normals
    let wing = 0;
    if (spec.wings?.parts.test(name) && !spec.wings.split) { g.computeBoundingBox(); wing = Math.sign(g.boundingBox!.min.x + g.boundingBox!.max.x) || 1; }
    parts.push({ name, geo: g, mat: m.material as THREE.Material, wing });
  });
  // scale + centre on the airframe bounding box (gear excluded)
  const box = new THREE.Box3();
  for (const p of parts) if (!spec.gearDown.test(p.name) && !spec.gearUp.test(p.name)) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
  const s = def.length / (box.max.z - box.min.z);
  let gearMin = Infinity;
  for (const p of parts) if (spec.gearDown.test(p.name)) { p.geo.computeBoundingBox(); gearMin = Math.min(gearMin, p.geo.boundingBox!.min.y); }
  const cz = (box.min.z + box.max.z) / 2;
  const yShift = Number.isFinite(gearMin) ? -def.gear.height - gearMin * s : -((box.min.y + box.max.y) / 2) * s;
  const fix = new THREE.Matrix4().makeTranslation(0, yShift, -cz * s).multiply(new THREE.Matrix4().makeScale(s, s, s));
  const root = new THREE.Group();
  if (spec.wings?.split) root.userData.pivot = { ...spec.wings.pivot };
  else if (spec.wings) {
    const pv = new THREE.Vector3(spec.wings.pivot.x, 0, spec.wings.pivot.z).applyMatrix4(toGame).applyMatrix4(fix);
    root.userData.pivot = { x: Math.abs(pv.x), z: pv.z };
  }
  for (const p of parts) p.geo.applyMatrix4(fix);
  const split = spec.wings?.split;
  if (split) {
    for (const p of [...parts]) {
      if (!spec.wings!.parts.test(p.name)) continue;
      const [body, left, right] = splitWings(p.geo, split.reach, split.maxZ);
      p.geo = body;
      if (left) parts.push({ ...p, geo: left, wing: -1 });
      if (right) parts.push({ ...p, geo: right, wing: 1 });
    }
  }
  // merge parts that share role, wing side, material and attribute layout
  const groups = new Map<string, { role: string; wing: number; mat: THREE.Material; geos: THREE.BufferGeometry[]; name: string; hud: boolean }>();
  for (const p of parts) {
    const role = spec.gearDown.test(p.name) ? 'gearDown' : spec.gearUp.test(p.name) ? 'gearUp'
      : spec.cockpit.test(p.name) ? 'cockpit' : spec.hide?.test(p.name) ? 'hidden' : 'body';
    const hud = (spec.hud ?? /hud/i).test(p.name);
    const mats = (Array.isArray(p.mat) ? p.mat : [p.mat]) as THREE.MeshStandardMaterial[];
    for (const mt of mats) if (mt.isMeshStandardMaterial && mt.metalness > 0.4) mt.metalness = 0.4; // no env map: keep metal from going black
    const layout = Object.keys(p.geo.attributes).sort().join(',') + (p.geo.index ? ':i' : ':n');
    const key = `${role}|${p.wing}|${hud}|${(p.mat as THREE.Material).uuid}|${layout}`;
    let g = groups.get(key);
    if (!g) { g = { role, wing: p.wing, mat: p.mat, geos: [], name: p.name, hud }; groups.set(key, g); }
    g.geos.push(p.geo);
  }
  for (const g of groups.values()) {
    // a merge that still fails must not drop parts: fall back to one mesh per part
    const merged = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
    const mat = g.hud && spec.hudGlass ? hudGlassMaterial() : g.mat;
    for (const geo of merged ? [merged] : g.geos) {
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = g.name;
      mesh.userData.role = g.role;
      mesh.userData.wing = g.wing;
      mesh.userData.hud = g.hud;
      root.add(mesh);
    }
  }
  return root;
}

/** Cut the wing triangles out of a fused airframe geometry (game frame): [rest, left wing, right wing]. */
export function splitWings(g: THREE.BufferGeometry, reach: number, maxZ: number): [THREE.BufferGeometry, THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const side = new Int8Array(pos.count / 3);
  for (let t = 0; t < side.length; t++) {
    let far = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(3 * t + k);
      if (Math.abs(x) > Math.abs(far)) far = x;
      cz += pos.getZ(3 * t + k) / 3;
    }
    side[t] = Math.abs(far) > reach && cz < maxZ ? Math.sign(far) : 0;
  }
  const pick = (want: number) => {
    const n = side.reduce((a, s) => a + (s === want ? 1 : 0), 0);
    if (!n) return null;
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.getAttribute(name) as THREE.BufferAttribute;
      const arr = new Float32Array(n * 3 * a.itemSize);
      let o = 0;
      for (let t = 0; t < side.length; t++) {
        if (side[t] !== want) continue;
        for (let i = 3 * t * a.itemSize; i < (3 * t + 3) * a.itemSize; i++) arr[o++] = (a.array as ArrayLike<number>)[i];
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  };
  return [pick(0)!, pick(-1), pick(1)];
}

/** HUD combiner: a faint green-tinted reflector you see the world through (the symbology itself is drawn by the HUD
 *  overlay). It stays visible from the cockpit, unlike the canopy glass. */
export function hudGlassMaterial() {
  return new THREE.MeshStandardMaterial({
    name: 'hud-combiner', color: 0x9fe8b8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.1,
    depthWrite: false, side: THREE.DoubleSide,
  });
}

/** Per-aircraft instance of an HD model. */
export interface HdInstance {
  root: THREE.Group;
  /** swing-wing groups (left = −x, right = +x), each rotating about its pivot */
  wings: { left: THREE.Group; right: THREE.Group; refSweep: number } | null;
  gearDown: THREE.Object3D[];
  gearUp: THREE.Object3D[];
  cockpit: THREE.Object3D[];
  /** transparent canopy glass (hidden from inside) */
  glass: THREE.Object3D[];
  /** pilot eye in the body frame */
  eye: THREE.Vector3;
}

export function instantiateHd(t: { root: THREE.Group; spec: HdSpec }): HdInstance {
  const root = new THREE.Group();
  const inst: HdInstance = { root, wings: null, gearDown: [], gearUp: [], cockpit: [], glass: [], eye: new THREE.Vector3() };
  const pivot = t.root.userData.pivot as { x: number; z: number } | undefined;
  if (t.spec.wings && pivot) {
    const left = new THREE.Group(), right = new THREE.Group();
    left.position.set(-pivot.x, 0, pivot.z);
    right.position.set(pivot.x, 0, pivot.z);
    root.add(left, right);
    inst.wings = { left, right, refSweep: t.spec.wings.refSweep };
  }
  const hudBox = new THREE.Box3();
  for (const src of t.root.children as THREE.Mesh[]) {
    const role = src.userData.role as string;
    if (role === 'hidden') continue;
    if (src.userData.hud) { src.geometry.computeBoundingBox(); hudBox.union(src.geometry.boundingBox!); }
    const m = new THREE.Mesh(src.geometry, src.material);
    m.name = src.name;
    m.userData.role = role;
    if (role === 'gearDown') inst.gearDown.push(m);
    if (role === 'gearUp') inst.gearUp.push(m);
    if (role === 'cockpit') inst.cockpit.push(m);
    const mm = m.material as THREE.Material;
    if (!src.userData.hud && (mm.transparent || /glass|canopy/i.test(mm.name))) inst.glass.push(m);
    const w = src.userData.wing as number;
    if (inst.wings && w) {
      // the wing group sits at the pivot, so the mesh is offset back by it
      const grp = w < 0 ? inst.wings.left : inst.wings.right;
      m.position.set(-grp.position.x, 0, -grp.position.z);
      grp.add(m);
    } else root.add(m);
  }
  // eye: explicit; else the design eye point ~0.65 m behind and just above the HUD combiner; else from the cockpit
  const cb = new THREE.Box3();
  for (const c of inst.cockpit) { const mesh = c as THREE.Mesh; mesh.geometry.computeBoundingBox(); cb.union(mesh.geometry.boundingBox!); }
  const e = t.spec.eye;
  if (e) inst.eye.set(0, e.y, e.z);
  else if (!hudBox.isEmpty()) inst.eye.set(0, hudBox.max.y + 0.04, hudBox.max.z + 0.65);
  else if (!cb.isEmpty()) inst.eye.set(0, cb.max.y - 0.45, cb.min.z + (cb.max.z - cb.min.z) * 0.55);
  return inst;
}

/** Start loading (if enabled) and call back with a fresh instance when ready. */
export function requestHdModel(def: AircraftDef, cb: (inst: HdInstance) => void) {
  if (!enabled || !hdSpecFor(def) || typeof window === 'undefined') return;
  void loadTemplate(def).then((t) => { if (t) cb(instantiateHd(t)); });
}

/** Credits for the credits screen. */
export function hdCredits() {
  // one line per model file, however many variants share it
  const seen = new Set<string>();
  return Object.entries(HD_SPECS).filter(([, s]) => !seen.has(s.url) && !!seen.add(s.url))
    .map(([id, s]) => ({ id, title: s.title, author: s.author, source: s.source, license: s.license }));
}

/** sweep (deg) → wing group rotation (rad) relative to the sweep the model was built at */
export function wingRotation(sweepDeg: number, refSweep: number) { return (sweepDeg - refSweep) * Math.PI / 180; }

export function updateHdInstance(inst: HdInstance, gearPos: number, sweepDeg: number) {
  const down = gearPos > 0.5;
  for (const g of inst.gearDown) g.visible = down;
  for (const g of inst.gearUp) g.visible = !down;
  if (inst.wings) {
    // swept back, both tips move aft (+z): the left wing (−x) turns positive about +y, the right one negative
    const a = wingRotation(sweepDeg, inst.wings.refSweep);
    inst.wings.left.rotation.y = a;
    inst.wings.right.rotation.y = -a;
  }
}
