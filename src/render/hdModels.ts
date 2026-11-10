// Optional high-detail (HD) aircraft models loaded from glTF files (third-party, see the LICENSE.md next to each
// file under assets/models/). The procedural model stays the source of truth: it is shown until the GLB has loaded and
// when HD models are disabled, and it is what hit-tests/physics are sized from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftDef } from '../aircraft/types.js';

export interface HdSpec {
  url: string;
  title: string; author: string; source: string; license: string;
  /** node-path patterns (matched against "ancestor/…/node" names) */
  gearDown: RegExp; gearUp: RegExp; cockpit: RegExp; hide?: RegExp;
  /** source axes: 'xfwd' = nose +X, right +Z (bohmerang exports, default); 'zfwd' = nose +Z, left +X (FBX exports);
   *  'game' = already nose −Z, right +X */
  axes?: 'xfwd' | 'zfwd' | 'game';
  /** articulated swing wing: node paths of every moving wing part (panel, slats, flaps, spoilers, lights…), the pivot of
   *  the wing on the source's +X side in source metres, and the sweep (deg) the model is built at.
   *  `split`: the wings are fused into the airframe mesh of the `parts` nodes — every triangle that reaches beyond
   *  |x| > reach (game metres) with its centre forward of z < maxZ (clear of the tailplanes) is cut out and swept with
   *  its side's wing; the pivot is then given in game metres (x outboard, z aft of the model's centre)
   *  Separate wing parts have their roots trimmed to the glove outline (see RootTrim). */
  wings?: { parts: RegExp; pivot: { x: number; z: number }; refSweep: number; split?: { reach: number; maxZ: number } };
  /** gear doors modelled into an airframe mesh: triangles of the `parts` nodes whose centre hangs below `below`
   *  between z[0] and z[1] and with |x| within `x` (source metres, after `axes`) are cut out and
   *  shown/hidden with the gear */
  gearDoors?: { parts: RegExp; boxes: Array<{ below: number; z: [number, number]; x?: [number, number] }> };
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
  /** engine nozzle exits (game body frame, metres): centre of the exit plane and its inner radius; fitted by casting
   *  rays forward from behind the jet and taking the rearmost ring of the nozzle petals */
  nozzles?: Array<{ x: number; y: number; z: number; r: number }>;
  /** moving parts (control surfaces, gear legs, doors), each turning about a hinge line given in the game body frame
   *  (metres, at the reference sweep for parts on a swing wing); see Mover */
  movers?: Mover[];
}

/**
 * A part that turns about a hinge line a→b. Horizontal hinges are taken pointing +x (whichever order they are given in)
 * and vertical ones pointing up, so a positive angle is trailing edge down, or trailing edge to the right for a rudder.
 * The angle is the sum of the drives: surface deflections in radians times a gain (elev/ail/rud), and degrees at
 * full travel for flaps (0..1), speedbrake (0..1), spoilers (rising with the roll command towards `side`, locked out
 * above `maxSweep`) and gear (0 down .. 1 stowed; a stowed gear leg is hidden).
 */
export interface Mover {
  parts: RegExp;
  hinge: [[number, number, number], [number, number, number]];
  elev?: number; ail?: number; rud?: number;
  flap?: number; brake?: number; gear?: number;
  spoiler?: { deg: number; side: 1 | -1; maxSweep?: number };
}

/** Flight-control state that drives the movers. */
export interface HdControls {
  /** surface deflections (rad, flight-model sign) */
  elev: number; ail: number; rud: number;
  /** roll command, −1..1 (+ = right wing down) */
  roll: number;
  flap: number; brake: number;
}

const BOHMERANG = { author: 'bohmerang', license: 'CC BY-NC-SA 4.0' };
const BOH_PARTS = { gearDown: /landingOn/i, gearUp: /landingOff/i, cockpit: /cockpit|hud/i, hudGlass: true };
const NEVER = /(?!)/;

// bohmerang's F-14A: the wings are part of the one airframe mesh, so they are cut out of it at bake time
const BOH_F14: HdSpec = {
  url: 'assets/models/cc-by-nc-sa/f14.glb', title: 'F-14 Tomcat - Fighter Jet - Free', ...BOHMERANG,
  nozzles: [{ x: -1.436, y: 0.211, z: 8.695, r: 0.39 }, { x: 1.436, y: 0.211, z: 8.695, r: 0.39 }],
  source: 'https://sketchfab.com/3d-models/f-14-tomcat-fighter-jet-free-497f77c311b5411d9b567d8707a81c33',
  gearDown: /gearOn/i, gearUp: /gearOff/i, cockpit: /cockpit|instrGlass/i,
  wings: { parts: /airframe_0/, pivot: { x: 2.72, z: 1.55 }, refSweep: 20, split: { reach: 3.6, maxZ: 5.0 } },
  // raised so the canopy sill sits well below the eye and you look over the glareshield, as from the F-16C seat
  eye: { y: 1.72, z: -5.05 },
  // the VDI (radar page) and, below it, the HSD (RWR / stores page)
  mfds: [
    { c: [0, 1.31, -5.632], w: 0.15, h: 0.124, n: [0, 0.17, 0.98], screen: 0 },
    { c: [0, 1.126, -5.604], w: 0.15, h: 0.15, n: [0, 0.42, 0.91], screen: 1 },
  ],
};

const BOH_F16: HdSpec = {
  url: 'assets/models/cc-by-nc-sa/f16.glb', title: 'F-16 Fighting Falcon - Fighter Jet - Free', ...BOHMERANG,
  nozzles: [{ x: 0, y: 0.242, z: 6.963, r: 0.39 }],
  source: 'https://sketchfab.com/3d-models/f-16-fighting-falcon-fighter-jet-free-f0b00989e5634764848ef2c235c64db5', ...BOH_PARTS,
  mfds: [
    { c: [-0.168, 0.835, -3.923], w: 0.08, h: 0.088, n: [0, 0.23, 0.97], screen: 0 },
    { c: [0.172, 0.835, -3.923], w: 0.08, h: 0.088, n: [0, 0.23, 0.97], screen: 1 },
  ],
};

/** HD models, keyed by aircraft id (one variant) or by family (every variant of the family). */
export const HD_SPECS: Record<string, HdSpec> = {
  // F-14A and F-14B: bohmerang's Tomcat
  f14a: BOH_F14,
  f14b1: BOH_F14,
  // F-14B(U): KOG_THORNS' F-14B, fitted with bohmerang's F-14A landing gear (so the file is CC BY-NC-SA as a whole)
  f14b: {
    url: 'assets/models/cc-by-nc-sa/f14b.glb', title: 'Grumman F-14B Tomcat', author: 'KOG_THORNS, gear by bohmerang',
    nozzles: [{ x: -1.43, y: -0.144, z: 8.96, r: 0.45 }, { x: 1.43, y: -0.144, z: 8.96, r: 0.45 }],
    source: 'https://sketchfab.com/3d-models/grumman-f-14b-tomcat-50285312fae748b3811b9cb7804cab29', license: 'CC BY 4.0 / CC BY-NC-SA 4.0',
    axes: 'game',
    gearDown: /f14a-gearOn/, gearUp: NEVER,
    cockpit: /_(Cockpit\d+|VDI)_0|\/Meshpart(33|53|85|81)\//,
    // wing panels, flaps, spoilers and tip lights are separate nodes; the gloves stay put. The pivot sits where the
    // model's straight wing root stays inside the glove at full sweep (z 16, from the published spans, let it poke out)
    wings: { parts: /\/Meshes(5151|1361|1441|6141|951|1721|1051|4171|1151|7111|891|1541|1641)\//, pivot: { x: 12.0, z: 14.0 }, refSweep: 20 },
    eye: { y: 1.21, z: -4.92 },
    // hinge lines fitted to the parts' edges (flaps, spoilers: leading edge; slats: trailing edge; rudders: leading
    // edge; stabilators: their spindle at ~40 % root chord; gear legs: top of the strut)
    movers: [
      // flaps (with their track fittings) and slats on the maneuver/landing flap handle
      { parts: /\/Meshes(1051|1441|1361)\//, hinge: [[2.255, 0.424, 3.253], [8.896, 0.442, 4.662]], flap: 35 },
      { parts: /\/Meshes(1151|1541)\//, hinge: [[-2.395, 0.388, 3.322], [-8.89, 0.408, 4.699]], flap: 35 },
      { parts: /\/Meshes6141\//, hinge: [[3.623, 0.511, 1.828], [8.749, 0.431, 3.938]], flap: -17 },
      { parts: /\/Meshes7111\//, hinge: [[-3.698, 0.472, 1.911], [-8.719, 0.398, 3.975]], flap: -17 },
      // spoilers: roll control at low sweep, up on the down-going wing
      { parts: /\/Meshes951\//, hinge: [[4.341, 0.503, 3.358], [8.112, 0.462, 4.315]], spoiler: { deg: 55, side: 1, maxSweep: 57 } },
      { parts: /\/Meshes891\//, hinge: [[-4.398, 0.467, 3.413], [-8.086, 0.427, 4.348]], spoiler: { deg: 55, side: -1, maxSweep: 57 } },
      // stabilators: pitch, plus differential for roll; rudders
      { parts: /\/Meshes1841\//, hinge: [[2.0, -0.1, 6.9], [4.9, -0.2, 6.9]], elev: -1, ail: -0.6 },
      { parts: /\/Meshes1941\//, hinge: [[-2.0, -0.1, 6.9], [-4.9, -0.2, 6.9]], elev: -1, ail: 0.6 },
      { parts: /\/Meshes2131\//, hinge: [[1.411, 0.485, 7.622], [1.562, 2.662, 8.811]], rud: 1 },
      { parts: /\/Meshes2041\//, hinge: [[-1.29, 0.484, 7.611], [-1.556, 2.654, 8.805]], rud: 1 },
      // gear: the nose leg and both main legs swing forward into the fuselage and gloves, the doors swing shut
      { parts: /\/f14a-gearOn(010|017|025)?\//, hinge: [[-0.3, 0.25, -4.25], [0.3, 0.25, -4.25]], gear: 100 },
      { parts: /\/f14a-gearOn(002|003|005|018)\//, hinge: [[1.9, 0.1, 2.6], [2.4, 0.1, 2.6]], gear: 95 },
      { parts: /\/f14a-gearOn(001|004|006|019)\//, hinge: [[-1.9, 0.1, 2.6], [-2.4, 0.1, 2.6]], gear: 95 },
      { parts: /\/f14a-gearOn007\//, hinge: [[1.95, -0.03, 1.08], [1.95, -0.03, 1.9]], gear: 90 },
      { parts: /\/f14a-gearOn008\//, hinge: [[-1.95, -0.02, 1.08], [-1.95, -0.02, 1.9]], gear: -90 },
      { parts: /\/f14a-gearOn013\//, hinge: [[0.3, 0.05, -5.39], [0.3, 0.05, -4.3]], gear: 90 },
    ],
    // the VDI (radar page) and, below it, the HSD (RWR / stores page)
    mfds: [
      { c: [0.001, 0.785, -5.602], w: 0.146, h: 0.146, n: [0, 0.38, 0.92], screen: 0 },
      { c: [0.002, 0.585, -5.577], w: 0.13, h: 0.13, n: [0, 0.39, 0.92], screen: 1 },
    ],
  },
  // F-14D: one articulated model: wings, slats, flaps and spoilers are separate nodes that sweep
  // rigidly about the real pivot (2.72 m from the centreline) — the published 68° / 75° spans check out on it
  f14d: {
    url: 'assets/models/cc-by/f14d.glb', title: 'Grumman F-14D "Super Tomcat"', author: 'KOG_THORNS',
    nozzles: [{ x: -1.394, y: 0.214, z: 9.17, r: 0.45 }, { x: 1.394, y: 0.214, z: 9.17, r: 0.45 }],
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
    nozzles: [{ x: 0, y: 0.436, z: 7.048, r: 0.31 }],
    source: 'https://sketchfab.com/3d-models/saab-jas-39-gripen-fighter-jet-free-03d4f4f0f7e94f469299ba7db4c707c4', ...BOH_PARTS,
    // the model's canopy is small for the jet: sit high in it, just aft of the windscreen bow, to see over the HUD
    eye: { y: 1.04, z: -2.82 },
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
  // two-seat F-16D Block 70 (the model is a Block 60, with the conformal tanks the Block 70 carries)
  f16d70: {
    url: 'assets/models/cc-by/f16d70.glb', title: 'General Dynamics F-16D Block 60', author: 'MirzaArrafiERV_45',
    nozzles: [{ x: 0, y: 0.377, z: 7.127, r: 0.5 }],
    source: 'https://sketchfab.com/3d-models/general-dynamics-f-16d-block-60-ea8edb08d79e4eafa9c794c581f88cf3', license: 'CC BY 4.0',
    // single-primitive nodes load as the mesh itself, named after the node with '.' dropped (Object_9.001 → Object_9001)
    axes: 'game', gearDown: /\/Object_(9|11)\/$/, gearUp: NEVER, hide: /\/Object_21\/$/,
    cockpit: /\/Object_(1[023456]|2|3|20|22|9001|11001)\/$/,
    // nose and main gear doors are part of the lower fuselage mesh
    eye: { y: 1.27, z: -3.1 },
    gearDoors: { parts: /\/Object_5\/$/, boxes: [{ below: 0.9, z: [-3.2, -0.6] }, { below: 1.25, z: [-1.5, 2.5], x: [0.8, 1.35] }] },
  },
  // the Super Hornet model only: the legacy F/A-18C has a different (smaller) airframe and keeps the procedural model
  fa18e: {
    url: 'assets/models/cc-by-nc-sa/fa18f.glb', title: 'Boeing F/A-18F Super Hornet - Free', ...BOHMERANG,
    nozzles: [{ x: -0.445, y: 0.696, z: 8.209, r: 0.32 }, { x: 0.445, y: 0.696, z: 8.209, r: 0.32 }],
    source: 'https://sketchfab.com/3d-models/boeing-fa-18f-super-hornet-free-447caa975f534554a83f70f0877b73fb', ...BOH_PARTS,
    mfds: [
      { c: [-0.186, 1.268, -4.808], w: 0.125, h: 0.112, n: [0, 0.21, 0.98], screen: 0 },
      { c: [0.187, 1.268, -4.808], w: 0.125, h: 0.112, n: [0, 0.21, 0.98], screen: 1 },
    ],
  },
  // the F-15E only: its conformal tanks and two-seat canopy don't fit the F-15C/D
  f15e: {
    url: 'assets/models/cc-by-nc-sa/f15e.glb', title: 'F-15E Strike Eagle - Fighter Jet - Free', ...BOHMERANG,
    nozzles: [{ x: -0.684, y: 0.529, z: 8.101, r: 0.35 }, { x: 0.684, y: 0.529, z: 8.101, r: 0.35 }],
    source: 'https://sketchfab.com/3d-models/f-15e-strike-eagle-fighter-jet-free-fff7d75490474e9b964d90cc031c8d01', ...BOH_PARTS,
    mfds: [
      { c: [-0.2, 1.424, -5.645], w: 0.15, h: 0.14, n: [0, 0.2, 0.98], screen: 0 },
      { c: [0.209, 1.424, -5.645], w: 0.15, h: 0.14, n: [0, 0.2, 0.98], screen: 1 },
    ],
  },
  mig29a: {
    url: 'assets/models/cc-by-nc-sa/mig29.glb', title: 'MiG-29 - Fighter Jet - Free', ...BOHMERANG,
    nozzles: [{ x: -0.916, y: -0.089, z: 7.0, r: 0.42 }, { x: 0.916, y: -0.089, z: 7.0, r: 0.42 }],
    source: 'https://sketchfab.com/3d-models/mig-29-fighter-jet-free-0a21787096244220b246ec8747e7b09c', ...BOH_PARTS,
    // the HUD-derived eye point sits behind the seat: forward and up, over the HUD
    eye: { y: 1.45, z: -3.2 },
    // the radar/IRST display right of the HUD
    mfds: [{ c: [0.19, 1.06, -3.838], w: 0.11, h: 0.1, n: [0, 0.26, 0.97], screen: 0 }],
  },
  f4e: {
    url: 'assets/models/cc-by-nc-sa/f4.glb', title: 'F-4 Phantom II - Fighter Jet - Free', ...BOHMERANG,
    nozzles: [{ x: -0.65, y: 0.3, z: 5.85, r: 0.42 }, { x: 0.65, y: 0.3, z: 5.85, r: 0.42 }],
    source: 'https://sketchfab.com/3d-models/f-4-phantom-ii-fighter-jet-free-f0b9ac8bdab149f3b75352a9f4f4e1c8', ...BOH_PARTS,
  },
};

/** Distance (m) beyond which the cheaper procedural model is drawn instead: none — CFS is aimed at high-end PCs, and a
 *  jet that switches to a boxy stand-in in the distance is what playtesters notice. */
export const HD_RANGE = Infinity;

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
  game: new THREE.Matrix4(),
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
  const parts: { name: string; geo: THREE.BufferGeometry; mat: THREE.Material; wing: number; mover: number }[] = [];
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
    const mover = spec.movers?.findIndex((mv) => mv.parts.test(name)) ?? -1;
    parts.push({ name, geo: g, mat: m.material as THREE.Material, wing, mover });
  });
  const doors = spec.gearDoors;
  if (doors) {
    for (const p of [...parts]) {
      if (!doors.parts.test(p.name)) continue;
      const [rest, cut] = cutTriangles(p.geo, (c) => doors.boxes.some((b) => c.y < b.below && c.z > b.z[0] && c.z < b.z[1] && (!b.x || (Math.abs(c.x) >= b.x[0] && Math.abs(c.x) <= b.x[1]))));
      p.geo = rest;
      if (cut) parts.push({ ...p, name: p.name + GEAR_DOORS, geo: cut });
    }
  }
  const isGearDown = (name: string) => name.endsWith(GEAR_DOORS) || spec.gearDown.test(name);
  // scale + centre on the airframe bounding box (gear excluded)
  const box = new THREE.Box3();
  for (const p of parts) if (!isGearDown(p.name) && !spec.gearUp.test(p.name)) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
  const s = def.length / (box.max.z - box.min.z);
  let gearMin = Infinity;
  for (const p of parts) if (isGearDown(p.name)) { p.geo.computeBoundingBox(); gearMin = Math.min(gearMin, p.geo.boundingBox!.min.y); }
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
  const trim = spec.wings && !spec.wings.split ? gloveOutline(parts, root.userData.pivot) : null;
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
  const groups = new Map<string, { role: string; wing: number; mover: number; mat: THREE.Material; geos: THREE.BufferGeometry[]; name: string; hud: boolean }>();
  for (const p of parts) {
    const role = isGearDown(p.name) ? 'gearDown' : spec.gearUp.test(p.name) ? 'gearUp'
      : spec.cockpit.test(p.name) ? 'cockpit' : spec.hide?.test(p.name) ? 'hidden' : 'body';
    const hud = (spec.hud ?? /hud/i).test(p.name);
    const mats = (Array.isArray(p.mat) ? p.mat : [p.mat]) as THREE.MeshStandardMaterial[];
    for (const mt of mats) if (mt.isMeshStandardMaterial && mt.metalness > 0.4) mt.metalness = 0.4; // no env map: keep metal from going black
    const layout = Object.keys(p.geo.attributes).sort().join(',') + (p.geo.index ? ':i' : ':n');
    const key = `${role}|${p.wing}|${p.mover}|${hud}|${(p.mat as THREE.Material).uuid}|${layout}`;
    let g = groups.get(key);
    if (!g) { g = { role, wing: p.wing, mover: p.mover, mat: p.mat, geos: [], name: p.name, hud }; groups.set(key, g); }
    g.geos.push(p.geo);
  }
  for (const g of groups.values()) {
    // a merge that still fails must not drop parts: fall back to one mesh per part
    const merged = g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos, false);
    const mat = g.hud && spec.hudGlass ? hudGlassMaterial() : g.wing && trim && !Array.isArray(g.mat) ? trimmedWingMaterial(g.mat, trim, spec.url) : g.mat;
    for (const geo of merged ? [merged] : g.geos) {
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = g.name;
      mesh.userData.role = g.role;
      mesh.userData.wing = g.wing;
      mesh.userData.mover = g.mover;
      mesh.userData.hud = g.hud;
      root.add(mesh);
    }
  }
  return root;
}

const GEAR_DOORS = '#gearDoors';

/**
 * A model's wing root reaches forward of the pivot, hidden in the glove at the sweep it was built at. A real Tomcat's
 * root is rounded about the pivot so it stays inside the glove at any sweep; a modelled straight root swings its
 * forward corner out through the side of the glove instead. The wing's material therefore discards, per pixel, every
 * part of the wing that sits inside the glove outline at the reference sweep forward of the pivot: hidden anyway at
 * that sweep, and exactly the part that would poke out at higher ones.
 */
export interface RootTrim { pivotZ: number; z0: number; dz: number; edge: Float32Array }
const TRIM_N = 64;

/** the glove/fuselage half-width (game metres) along z forward of the pivot, from the airframe near wing height */
export function gloveOutline(parts: { name: string; geo: THREE.BufferGeometry; wing: number }[], pivot: { x: number; z: number }): RootTrim | null {
  const wings = parts.filter((p) => p.wing);
  if (!wings.length) return null;
  let wy = 0, wn = 0;
  for (const p of wings) { const a = p.geo.getAttribute('position'); for (let i = 0; i < a.count; i++) { wy += a.getY(i); wn++; } }
  wy /= wn;
  const dz = 0.125, z0 = pivot.z - dz * (TRIM_N - 1);
  const edge = new Float32Array(TRIM_N);
  for (const p of parts) {
    if (p.wing || /gear|wheel/i.test(p.name)) continue;
    const a = p.geo.getAttribute('position');
    for (let i = 0; i < a.count; i++) {
      if (Math.abs(a.getY(i) - wy) > 0.6) continue;
      const k = Math.round((a.getZ(i) - z0) / dz);
      if (k >= 0 && k < TRIM_N) edge[k] = Math.max(edge[k], Math.abs(a.getX(i)));
    }
  }
  // a little inside the outline, so the wing still meets the glove edge with no gap
  for (let k = 0; k < TRIM_N; k++) edge[k] = Math.max(0, edge[k] - 0.04);
  return { pivotZ: pivot.z, z0, dz, edge };
}

const trimmed = new Map<string, THREE.Material>();
/** the wing material with the glove cut-out (see RootTrim); cached per source material and trim */
export function trimmedWingMaterial(mat: THREE.Material, trim: RootTrim, key: string): THREE.Material {
  const k = `${mat.uuid}|${key}`;
  let m = trimmed.get(k);
  if (m) return m;
  m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTrimEdge = { value: Array.from(trim.edge) };
    sh.uniforms.uTrim = { value: new THREE.Vector3(trim.pivotZ, trim.z0, trim.dz) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRefPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRefPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRefPos;
uniform float uTrimEdge[${TRIM_N}];
uniform vec3 uTrim;`)
      .replace('void main() {', `void main() {
  if (vRefPos.z < uTrim.x) {
    float f = clamp((vRefPos.z - uTrim.y) / uTrim.z, 0.0, ${TRIM_N - 1}.0);
    int i = int(floor(f));
    float e = mix(uTrimEdge[i], uTrimEdge[min(i + 1, ${TRIM_N - 1})], fract(f));
    if (abs(vRefPos.x) < e) discard;
  }`);
  };
  m.customProgramCacheKey = () => `wingtrim|${k}`;
  trimmed.set(k, m);
  return m;
}

/** Split a geometry's triangles by their centroid: [rest, picked] (picked is null when no triangle matches). */
export function cutTriangles(g: THREE.BufferGeometry, pick: (c: THREE.Vector3, far: number) => boolean):
  [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const sel = new Uint8Array(pos.count / 3);
  const c = new THREE.Vector3();
  for (let t = 0; t < sel.length; t++) {
    let far = 0;
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(3 * t + k);
      if (Math.abs(x) > Math.abs(far)) far = x;
      c.x += x / 3; c.y += pos.getY(3 * t + k) / 3; c.z += pos.getZ(3 * t + k) / 3;
    }
    sel[t] = pick(c, far) ? 1 : 0;
  }
  const take = (want: number) => {
    const n = sel.reduce((a, s) => a + (s === want ? 1 : 0), 0);
    if (!n) return null;
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.getAttribute(name) as THREE.BufferAttribute;
      const arr = new Float32Array(n * 3 * a.itemSize);
      let o = 0;
      for (let t = 0; t < sel.length; t++) {
        if (sel[t] !== want) continue;
        for (let i = 3 * t * a.itemSize; i < (3 * t + 3) * a.itemSize; i++) arr[o++] = (a.array as ArrayLike<number>)[i];
      }
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  };
  return [take(0) ?? new THREE.BufferGeometry(), take(1)];
}

/** Cut the wing triangles out of a fused airframe geometry (game frame): [rest, left wing, right wing]. */
export function splitWings(g: THREE.BufferGeometry, reach: number, maxZ: number): [THREE.BufferGeometry, THREE.BufferGeometry | null, THREE.BufferGeometry | null] {
  const inWing = (side: number) => (c: THREE.Vector3, far: number) => Math.abs(far) > reach && c.z < maxZ && Math.sign(far) === side;
  const [rest, left] = cutTriangles(g, inWing(-1));
  const [body, right] = cutTriangles(rest, inWing(1));
  return [body, left, right];
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
  /** hinged parts: one group per mover, sitting on its hinge */
  movers: Array<{ group: THREE.Group; axis: THREE.Vector3; spec: Mover }>;
}

export function instantiateHd(t: { root: THREE.Group; spec: HdSpec }): HdInstance {
  const root = new THREE.Group();
  const inst: HdInstance = { root, wings: null, gearDown: [], gearUp: [], cockpit: [], glass: [], eye: new THREE.Vector3(), movers: [] };
  const pivot = t.root.userData.pivot as { x: number; z: number } | undefined;
  if (t.spec.wings && pivot) {
    const left = new THREE.Group(), right = new THREE.Group();
    left.position.set(-pivot.x, 0, pivot.z);
    right.position.set(pivot.x, 0, pivot.z);
    root.add(left, right);
    inst.wings = { left, right, refSweep: t.spec.wings.refSweep };
  }
  const hudBox = new THREE.Box3();
  const moverGroups = new Map<number, { group: THREE.Group; axis: THREE.Vector3; spec: Mover; a: THREE.Vector3 }>();
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
    const wingGrp = inst.wings && w ? (w < 0 ? inst.wings.left : inst.wings.right) : null;
    const mi = src.userData.mover as number ?? -1;
    if (mi >= 0 && t.spec.movers) {
      // a hinged part: its group sits on the hinge (inside the wing group for a part on a swing wing)
      let mv = moverGroups.get(mi);
      if (!mv) {
        const ms = t.spec.movers[mi];
        const a = new THREE.Vector3(...ms.hinge[0]), axis = new THREE.Vector3(...ms.hinge[1]).sub(a).normalize();
        if (Math.abs(axis.y) > 0.7 ? axis.y < 0 : axis.x < 0) axis.negate();
        const group = new THREE.Group();
        group.position.copy(a);
        if (wingGrp) { group.position.sub(wingGrp.position); wingGrp.add(group); } else root.add(group);
        mv = { group, axis, spec: ms, a };
        moverGroups.set(mi, mv);
        inst.movers.push(mv);
      }
      m.position.copy(mv.a).negate();
      m.userData.hinged = true;
      mv.group.add(m);
    } else if (wingGrp) {
      // the wing group sits at the pivot, so the mesh is offset back by it
      m.position.set(-wingGrp.position.x, 0, -wingGrp.position.z);
      wingGrp.add(m);
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

const RAD = Math.PI / 180;

export function updateHdInstance(inst: HdInstance, gearPos: number, sweepDeg: number, ctl?: HdControls) {
  const down = gearPos > 0.5;
  // gear legs with a hinge stay out while they travel; the rest of the gear swaps at half travel
  for (const g of inst.gearDown) g.visible = g.userData.hinged ? gearPos > 0.01 : down;
  for (const g of inst.gearUp) g.visible = !down;
  for (const mv of inst.movers) {
    const m = mv.spec;
    let a = (m.gear ?? 0) * (1 - gearPos) * RAD;
    if (ctl) {
      a += (m.elev ?? 0) * ctl.elev + (m.ail ?? 0) * ctl.ail + (m.rud ?? 0) * ctl.rud
        + ((m.flap ?? 0) * ctl.flap + (m.brake ?? 0) * ctl.brake) * RAD;
      if (m.spoiler && sweepDeg <= (m.spoiler.maxSweep ?? 90)) a -= m.spoiler.deg * Math.max(0, Math.min(1, m.spoiler.side * ctl.roll)) * RAD;
    }
    mv.group.quaternion.setFromAxisAngle(mv.axis, a);
  }
  if (inst.wings) {
    // swept back, both tips move aft (+z): the left wing (−x) turns positive about +y, the right one negative
    const a = wingRotation(sweepDeg, inst.wings.refSweep);
    inst.wings.left.rotation.y = a;
    inst.wings.right.rotation.y = -a;
  }
}
