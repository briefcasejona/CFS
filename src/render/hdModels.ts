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
  /** landing gear modelled as one "gear down" set: the legs, wheels and doors are told apart at bake time and given
   *  hinges (see rigGear). Which way the nose and main legs swing up — forward, aft, or (mains) in towards the
   *  centreline — and optionally by how many degrees (default: until the wheels are level with the hinge) and how far the main legs
   *  are drawn up into the well (m) */
  gearRig?: GearRig;
}

export interface GearRig { nose: 'fwd' | 'aft'; main: 'fwd' | 'aft' | 'in'; noseDeg?: number; mainDeg?: number; mainLift?: number }

/**
 * A part that turns about a hinge line a→b. Horizontal hinges are taken pointing +x (whichever order they are given in)
 * and vertical ones pointing up, so a positive angle is trailing edge down, or trailing edge to the right for a rudder.
 * The angle is the sum of the drives: surface deflections in radians times a gain (elev/ail/rud), and degrees at
 * full travel for flaps (0..1), speedbrake (0..1), spoilers (rising with the roll command towards `side`, locked out
 * above `maxSweep`) and gear (0 down .. 1 stowed; a stowed gear leg is hidden).
 */
export interface Mover {
  parts: RegExp;
  /** hinge line; left out, it is fitted to the part: its leading edge ('le', the default: flaps, ailerons,
   *  rudders), trailing edge ('te': slats, leading-edge flaps) or a third of the way back ('spindle': all-moving
   *  stabilators) */
  hinge?: [[number, number, number], [number, number, number]];
  auto?: 'le' | 'te' | 'spindle';
  /** the part is modelled into a larger mesh (one-piece airframes): the triangles of the `parts` nodes whose centre
   *  lies inside this outline (game body frame, metres: [x, z] corners, or [z, y] corners with `side` for a fin-like
   *  part) and, if given, within y[0]..y[1] (or x[0]..x[1] for a side outline) are cut out. With `shells`, whole
   *  connected shells are taken instead (surfaces modelled as separate pieces of the mesh): those whose bounds lie
   *  inside the outline's bounds and whose centre lies inside the outline */
  cut?: { poly: Array<[number, number]>; y?: [number, number]; x?: [number, number]; side?: boolean; shells?: boolean };
  elev?: number; ail?: number; rud?: number;
  flap?: number; brake?: number; gear?: number;
  /** the part of the retraction (0 = down .. 1 = up) over which the gear drive turns this part (default: all of it) */
  gearPhase?: [number, number];
  /** metres the part is drawn up into its well over the same travel */
  lift?: number;
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
const rigOf = (nose: GearRig['nose'], main: GearRig['main'], more: Partial<GearRig> = {}): GearRig => ({ nose, main, ...more });
const NEVER = /(?!)/;
const RAD = Math.PI / 180;

// bohmerang's F-14A: the wings are part of the one airframe mesh, so they are cut out of it at bake time
const BOH_F14: HdSpec = {
  url: 'assets/models/cc-by-nc-sa/f14.glb', title: 'F-14 Tomcat - Fighter Jet - Free', ...BOHMERANG,
  gearRig: rigOf('fwd', 'fwd', { mainDeg: 70, mainLift: 0 }),
  // flaps (cut out of the swinging wing pieces), stabilators, rudders; the spoilers stay painted on
  movers: [
    { parts: /airframe/, cut: { poly: [[3.7, 2], [9.1, 2.6], [9.1, 3.2], [3.7, 2.9]] }, flap: 35 },
    { parts: /airframe/, cut: { poly: [[-3.7, 2], [-9.1, 2.6], [-9.1, 3.2], [-3.7, 2.9]] }, flap: 35 },
    { parts: /airframe/, cut: { poly: [[1.95, 5.2], [5, 5.2], [5, 9.6], [1.95, 9.6]], shells: true }, auto: 'spindle', elev: -1, ail: -0.6 },
    { parts: /airframe/, cut: { poly: [[-1.95, 5.2], [-5, 5.2], [-5, 9.6], [-1.95, 9.6]], shells: true }, auto: 'spindle', elev: -1, ail: 0.6 },
    { parts: /airframe/, cut: { side: true, poly: [[8.25, 0.86], [8.95, 3.11], [9.5, 3.11], [8.8, 0.86]], x: [0.8, 2.6] }, rud: 1 },
    { parts: /airframe/, cut: { side: true, poly: [[8.25, 0.86], [8.95, 3.11], [9.5, 3.11], [8.8, 0.86]], x: [-2.6, -0.8] }, rud: 1 },
  ],
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
  gearRig: rigOf('aft', 'fwd'),
  nozzles: [{ x: 0, y: 0.242, z: 6.963, r: 0.39 }],
  movers: [
    // flaperons (roll, and down as flaps), all-moving stabilators (pitch plus differential roll), rudder
    { parts: /airframe/, cut: { poly: [[1.05, 2.68], [3.46, 3.08], [3.46, 3.7], [1.05, 3.7]], y: [-0.3, 0.6] }, ail: -1, flap: 20 },
    { parts: /airframe/, cut: { poly: [[-1.05, 2.68], [-3.46, 3.08], [-3.46, 3.7], [-1.05, 3.7]], y: [-0.3, 0.6] }, ail: 1, flap: 20 },
    { parts: /airframe/, cut: { poly: [[1.0, 4.6], [2.9, 4.6], [2.9, 7.2], [1.0, 7.2]], y: [-0.3, 0.4] }, auto: 'spindle', elev: -1, ail: -0.5 },
    { parts: /airframe/, cut: { poly: [[-1.0, 4.6], [-2.9, 4.6], [-2.9, 7.2], [-1.0, 7.2]], y: [-0.3, 0.4] }, auto: 'spindle', elev: -1, ail: 0.5 },
    { parts: /airframe/, cut: { side: true, poly: [[5.74, 1.4], [7.05, 3.29], [7.6, 3.29], [6.6, 1.4]], x: [-0.2, 0.2] }, rud: 1 },
  ],
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
    gearRig: rigOf('fwd', 'fwd'),
    cockpit: /MFD Display|DISPLAY|\/HUD\/|cockpit|Meshpart|RIO|\/Glass\//i,
    hud: /\/HUD\//,
    wings: { parts: /vehicle#(wing_[lr]_|slat_[lr]_|flap\w*?_[lr]_|aileron_interceptor_[lr]_)/i, pivot: { x: 2.72, z: 0.32 }, refSweep: 20 },
    // every control surface is its own node: flaps, slats and spoilers ride on the swinging wings
    movers: [
      { parts: /vehicle#flap\w*_r_/, flap: 35 },
      { parts: /vehicle#flap\w*_l_/, flap: 35 },
      { parts: /vehicle#slat_r_/, auto: 'te', flap: -17 },
      { parts: /vehicle#slat_l_/, auto: 'te', flap: -17 },
      { parts: /vehicle#aileron_interceptor_r_/, spoiler: { deg: 55, side: 1, maxSweep: 57 } },
      { parts: /vehicle#aileron_interceptor_l_/, spoiler: { deg: 55, side: -1, maxSweep: 57 } },
      { parts: /elevator1_159/, auto: 'spindle', elev: -1, ail: -0.6 },
      { parts: /elevator0_158/, auto: 'spindle', elev: -1, ail: 0.6 },
      { parts: /vehicle#rudder1/, rud: 1 },
      { parts: /vehicle#rudder0/, rud: 1 },
      // speedbrake: the upper panel opens up, the lower one down
      { parts: /vehicle#airbrake_l/, hinge: [[-0.8, 0.4, 7.32], [0.8, 0.4, 7.32]], brake: -55 },
      { parts: /vehicle#airbrake_r/, hinge: [[-0.7, 0.27, 7.12], [0.7, 0.27, 7.12]], brake: 55 },
    ],
    mfds: [
      { c: [0.007, 1.164, -5.652], w: 0.11, h: 0.105, n: [0, 0.17, 0.99], screen: 0 },
      { c: [0.187, 1.176, -5.653], w: 0.11, h: 0.105, n: [0, 0.17, 0.99], screen: 1 },
    ],
  },
  'JAS 39': {
    url: 'assets/models/cc-by-nc-sa/gripen.glb', title: 'Saab JAS 39 Gripen - Fighter Jet - Free', ...BOHMERANG,
    gearRig: rigOf('aft', 'fwd'),
    movers: [
      // inboard and outboard elevons (pitch and roll), all-moving canards, rudder
      { parts: /airframe/, cut: { poly: [[1, 3.75], [2.44, 3.8], [2.44, 4.65], [1, 4.7]], y: [-0.4, 0.8] }, elev: -0.8, ail: -0.5 },
      { parts: /airframe/, cut: { poly: [[-1, 3.75], [-2.44, 3.8], [-2.44, 4.65], [-1, 4.7]], y: [-0.4, 0.8] }, elev: -0.8, ail: 0.5 },
      { parts: /airframe/, cut: { poly: [[2.46, 3.8], [3.85, 3.88], [3.85, 4.4], [2.46, 4.65]], y: [-0.4, 0.8] }, elev: -0.6, ail: -1 },
      { parts: /airframe/, cut: { poly: [[-2.46, 3.8], [-3.85, 3.88], [-3.85, 4.4], [-2.46, 4.65]], y: [-0.4, 0.8] }, elev: -0.6, ail: 1 },
      { parts: /airframe/, cut: { poly: [[0.97, -2.4], [2.2, -2.4], [2.2, 0.15], [0.97, 0.15]], y: [-0.3, 1.2] }, auto: 'spindle', elev: 1 },
      { parts: /airframe/, cut: { poly: [[-0.97, -2.4], [-2.2, -2.4], [-2.2, 0.15], [-0.97, 0.15]], y: [-0.3, 1.2] }, auto: 'spindle', elev: 1 },
      { parts: /airframe/, cut: { side: true, poly: [[5.67, 0.98], [5.78, 2.19], [6.25, 2.19], [6.36, 0.98]], x: [-0.3, 0.3] }, rud: 1 },
    ],
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
    gearRig: rigOf('aft', 'fwd'),
    cockpit: /\/Object_(1[023456]|2|3|20|22|9001|11001)\/$/,
    // nose and main gear doors are part of the lower fuselage mesh
    eye: { y: 1.27, z: -3.1 },
    gearDoors: { parts: /\/Object_5\/$/, boxes: [{ below: 0.9, z: [-3.2, -0.6] }, { below: 1.25, z: [-1.5, 2.5], x: [0.8, 1.35] }] },
    // flaperons cut out of the wing mesh, the stabilators are their own nodes, the rudder is cut out of the fin
    movers: [
      { parts: /\/Object_[46]\/$/, cut: { poly: [[1.05, 2.68], [3.46, 3.08], [3.46, 3.7], [1.05, 3.7]], y: [-0.3, 0.7] }, ail: -1, flap: 20 },
      { parts: /\/Object_[46]\/$/, cut: { poly: [[-1.05, 2.68], [-3.46, 3.08], [-3.46, 3.7], [-1.05, 3.7]], y: [-0.3, 0.7] }, ail: 1, flap: 20 },
      { parts: /\/Object_23002\/$/, auto: 'spindle', elev: -1, ail: -0.5 },
      { parts: /\/Object_23001\/$/, auto: 'spindle', elev: -1, ail: 0.5 },
      { parts: /\/Object_23\/$/, cut: { side: true, poly: [[5.74, 1.4], [7.05, 3.29], [7.6, 3.29], [6.6, 1.4]], x: [-0.2, 0.2] }, rud: 1 },
    ],
  },
  // the Super Hornet model only: the legacy F/A-18C has a different (smaller) airframe and keeps the procedural model
  fa18e: {
    url: 'assets/models/cc-by-nc-sa/fa18f.glb', title: 'Boeing F/A-18F Super Hornet - Free', ...BOHMERANG,
    gearRig: rigOf('fwd', 'aft'),
    movers: [
      // trailing-edge flaps and ailerons (flaps droop the ailerons too), leading-edge flaps, stabilators, rudders
      { parts: /airframe/, cut: { poly: [[1.2, 2.85], [4.36, 2.85], [4.36, 4.5], [1.2, 4.5]], shells: true }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[-1.2, 2.85], [-4.36, 2.85], [-4.36, 4.5], [-1.2, 4.5]], shells: true }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[4.3, 3.2], [6.44, 3.2], [6.44, 4.35], [4.3, 4.35]], shells: true }, ail: -1, flap: 20 },
      { parts: /airframe/, cut: { poly: [[-4.3, 3.2], [-6.44, 3.2], [-6.44, 4.35], [-4.3, 4.35]], shells: true }, ail: 1, flap: 20 },
      { parts: /airframe/, cut: { poly: [[1.8, -0.05], [4.66, -0.05], [4.66, 2.05], [1.8, 2.05]], shells: true }, auto: 'te', flap: -12 },
      { parts: /airframe/, cut: { poly: [[-1.8, -0.05], [-4.66, -0.05], [-4.66, 2.05], [-1.8, 2.05]], shells: true }, auto: 'te', flap: -12 },
      { parts: /airframe/, cut: { poly: [[4.6, 1.25], [6.35, 1.25], [6.35, 2.7], [4.6, 2.7]], shells: true }, auto: 'te', flap: -12 },
      { parts: /airframe/, cut: { poly: [[-4.6, 1.25], [-6.35, 1.25], [-6.35, 2.7], [-4.6, 2.7]], shells: true }, auto: 'te', flap: -12 },
      { parts: /airframe/, cut: { poly: [[0.95, 5.2], [3.7, 5.2], [3.7, 9.3], [0.95, 9.3]], shells: true, y: [0.3, 1.05] }, auto: 'spindle', elev: -1, ail: -0.5 },
      { parts: /airframe/, cut: { poly: [[-0.95, 5.2], [-3.7, 5.2], [-3.7, 9.3], [-0.95, 9.3]], shells: true, y: [0.3, 1.05] }, auto: 'spindle', elev: -1, ail: 0.5 },
      { parts: /airframe/, cut: { side: true, poly: [[5.76, 1.19], [6.38, 2.94], [6.85, 2.94], [6.55, 1.19]], x: [0.6, 2.5] }, rud: 1 },
      { parts: /airframe/, cut: { side: true, poly: [[5.76, 1.19], [6.38, 2.94], [6.85, 2.94], [6.55, 1.19]], x: [-2.5, -0.6] }, rud: 1 },
    ],
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
    gearRig: rigOf('fwd', 'fwd'),
    movers: [
      // plain flaps, ailerons, all-moving stabilators, rudders
      { parts: /airframe/, cut: { poly: [[2.05, 4.38], [3.93, 4.38], [3.93, 5.32], [2.05, 5.32]], y: [-0.3, 1.2] }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[-2.05, 4.38], [-3.93, 4.38], [-3.93, 5.32], [-2.05, 5.32]], y: [-0.3, 1.2] }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[3.97, 4.42], [5.61, 5], [5.61, 5.58], [3.97, 5.32]], y: [-0.3, 1.2] }, ail: -1 },
      { parts: /airframe/, cut: { poly: [[-3.97, 4.42], [-5.61, 5], [-5.61, 5.58], [-3.97, 5.32]], y: [-0.3, 1.2] }, ail: 1 },
      { parts: /airframe/, cut: { poly: [[1.82, 6.2], [4.5, 6.2], [4.5, 9.9], [1.82, 9.9]], y: [-0.6, 0.9] }, auto: 'spindle', elev: -1, ail: -0.5 },
      { parts: /airframe/, cut: { poly: [[-1.82, 6.2], [-4.5, 6.2], [-4.5, 9.9], [-1.82, 9.9]], y: [-0.6, 0.9] }, auto: 'spindle', elev: -1, ail: 0.5 },
      { parts: /airframe/, cut: { side: true, poly: [[7.59, 1.08], [7.91, 2.54], [8.45, 2.54], [8.4, 1.08]], x: [1.2, 2.8] }, rud: 1 },
      { parts: /airframe/, cut: { side: true, poly: [[7.59, 1.08], [7.91, 2.54], [8.45, 2.54], [8.4, 1.08]], x: [-2.8, -1.2] }, rud: 1 },
    ],
    nozzles: [{ x: -0.684, y: 0.529, z: 8.101, r: 0.35 }, { x: 0.684, y: 0.529, z: 8.101, r: 0.35 }],
    source: 'https://sketchfab.com/3d-models/f-15e-strike-eagle-fighter-jet-free-fff7d75490474e9b964d90cc031c8d01', ...BOH_PARTS,
    mfds: [
      { c: [-0.2, 1.424, -5.645], w: 0.15, h: 0.14, n: [0, 0.2, 0.98], screen: 0 },
      { c: [0.209, 1.424, -5.645], w: 0.15, h: 0.14, n: [0, 0.2, 0.98], screen: 1 },
    ],
  },
  mig29a: {
    url: 'assets/models/cc-by-nc-sa/mig29.glb', title: 'MiG-29 - Fighter Jet - Free', ...BOHMERANG,
    // the real wheels turn flat into the thin wing root: ours stop short of level so they stay under the skin
    gearRig: rigOf('aft', 'fwd', { mainDeg: 53, mainLift: 0 }),
    movers: [
      // flaps, ailerons, all-moving stabilators, rudders
      { parts: /airframe/, cut: { poly: [[1.7, 3.4], [3.55, 3.4], [3.55, 4.65], [1.7, 4.65]], shells: true }, flap: 25 },
      { parts: /airframe/, cut: { poly: [[-1.7, 3.4], [-3.55, 3.4], [-3.55, 4.65], [-1.7, 4.65]], shells: true }, flap: 25 },
      { parts: /airframe/, cut: { poly: [[3.5, 3.9], [4.85, 3.9], [4.85, 4.9], [3.5, 4.9]], shells: true }, ail: -1 },
      { parts: /airframe/, cut: { poly: [[-3.5, 3.9], [-4.85, 3.9], [-4.85, 4.9], [-3.5, 4.9]], shells: true }, ail: 1 },
      { parts: /airframe/, cut: { poly: [[1.65, 5.2], [3.9, 5.2], [3.9, 8.6], [1.65, 8.6]], shells: true, y: [-0.3, 0.5] }, auto: 'spindle', elev: -1, ail: -0.5 },
      { parts: /airframe/, cut: { poly: [[-1.65, 5.2], [-3.9, 5.2], [-3.9, 8.6], [-1.65, 8.6]], shells: true, y: [-0.3, 0.5] }, auto: 'spindle', elev: -1, ail: 0.5 },
      { parts: /airframe/, cut: { side: true, poly: [[6.41, 0.75], [6.76, 1.95], [7.25, 1.95], [7.2, 0.75]], x: [0.5, 2.5] }, rud: 1 },
      { parts: /airframe/, cut: { side: true, poly: [[6.41, 0.75], [6.76, 1.95], [7.25, 1.95], [7.2, 0.75]], x: [-2.5, -0.5] }, rud: 1 },
    ],
    nozzles: [{ x: -0.916, y: -0.089, z: 7.0, r: 0.42 }, { x: 0.916, y: -0.089, z: 7.0, r: 0.42 }],
    source: 'https://sketchfab.com/3d-models/mig-29-fighter-jet-free-0a21787096244220b246ec8747e7b09c', ...BOH_PARTS,
    // the HUD-derived eye point sits behind the seat: forward and up, over the HUD
    eye: { y: 1.45, z: -3.2 },
    // the radar/IRST display right of the HUD
    mfds: [{ c: [0.19, 1.06, -3.838], w: 0.11, h: 0.1, n: [0, 0.26, 0.97], screen: 0 }],
  },
  f4e: {
    url: 'assets/models/cc-by-nc-sa/f4.glb', title: 'F-4 Phantom II - Fighter Jet - Free', ...BOHMERANG,
    gearRig: rigOf('aft', 'in'),
    movers: [
      // inboard flaps, ailerons, the anhedral all-moving stabilator, rudder
      { parts: /airframe/, cut: { poly: [[1.27, 2.78], [2.64, 3.18], [2.64, 4.15], [1.27, 3.9]], y: [-0.3, 1.0] }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[-1.27, 2.78], [-2.64, 3.18], [-2.64, 4.15], [-1.27, 3.9]], y: [-0.3, 1.0] }, flap: 30 },
      { parts: /airframe/, cut: { poly: [[2.66, 3.18], [4, 3.52], [4, 4.6], [2.66, 4.15]], y: [-0.3, 1.0] }, ail: -1, flap: 15 },
      { parts: /airframe/, cut: { poly: [[-2.66, 3.18], [-4, 3.52], [-4, 4.6], [-2.66, 4.15]], y: [-0.3, 1.0] }, ail: 1, flap: 15 },
      { parts: /airframe/, cut: { poly: [[0.5, 6.6], [2.6, 6.6], [2.6, 9.5], [0.5, 9.5]], y: [-0.5, 1.6] }, auto: 'spindle', elev: -1 },
      { parts: /airframe/, cut: { poly: [[-0.5, 6.6], [-2.6, 6.6], [-2.6, 9.5], [-0.5, 9.5]], y: [-0.5, 1.6] }, auto: 'spindle', elev: -1 },
      { parts: /airframe/, cut: { side: true, poly: [[8.9, 1.82], [9.02, 3.32], [9.5, 3.32], [9.4, 1.82]], x: [-0.3, 0.3] }, rud: 1 },
    ],
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
    const mover = spec.movers?.findIndex((mv) => !mv.cut && mv.parts.test(name)) ?? -1;
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
  const movers: Mover[] = [...(spec.movers ?? [])];
  if (spec.gearRig) rigGear(parts, isGearDown, spec.gearRig, movers, spec.url);
  root.userData.movers = movers;
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
  // control surfaces and doors modelled into one-piece meshes: cut them out by outline
  movers.forEach((mv, mi) => {
    const c = mv.cut;
    if (!c) return;
    for (const p of [...parts]) {
      if (p.mover >= 0 || !mv.parts.test(p.name)) continue;
      const inside = (v: THREE.Vector3) => (!c.y || (v.y >= c.y[0] && v.y <= c.y[1]))
        && (!c.x || (v.x >= c.x[0] && v.x <= c.x[1])) && (c.side ? inPoly(c.poly, v.z, v.y) : inPoly(c.poly, v.x, v.z));
      let rest: THREE.BufferGeometry, piece: THREE.BufferGeometry | null;
      if (c.shells) {
        // the outline's bounds, in the outline's plane
        const u0 = Math.min(...c.poly.map((q) => q[0])) - 0.05, u1 = Math.max(...c.poly.map((q) => q[0])) + 0.05;
        const w0 = Math.min(...c.poly.map((q) => q[1])) - 0.05, w1 = Math.max(...c.poly.map((q) => q[1])) + 0.05;
        const within = (b: THREE.Box3) => c.side ? b.min.z >= u0 && b.max.z <= u1 && b.min.y >= w0 && b.max.y <= w1
          : b.min.x >= u0 && b.max.x <= u1 && b.min.z >= w0 && b.max.z <= w1;
        [rest, piece] = cutShells(p.geo, (b) => within(b) && inside(b.getCenter(new THREE.Vector3())));
      } else [rest, piece] = cutSurface(p.geo, inside);
      if (!piece) continue;
      p.geo = rest;
      parts.push({ ...p, geo: piece, mover: mi });
    }
  });
  // hinge lines: given, or fitted to the parts' edges
  root.userData.hinges = movers.map((mv, mi) => mv.hinge ?? fitHinge(parts.filter((p) => p.mover === mi).map((p) => p.geo), mv.auto ?? 'le'));
  // merge parts that share role, wing side, material and attribute layout
  const groups = new Map<string, { role: string; wing: number; mover: number; mat: THREE.Material; geos: THREE.BufferGeometry[]; name: string; hud: boolean }>();
  for (const p of parts) {
    const role = isGearDown(p.name) ? 'gearDown' : spec.gearUp.test(p.name) ? 'gearUp'
      : spec.cockpit.test(p.name) ? 'cockpit' : spec.hide?.test(p.name) ? 'hidden' : 'body';
    const hud = (spec.hud ?? /hud/i).test(p.name);
    const mats = (Array.isArray(p.mat) ? p.mat : [p.mat]) as THREE.MeshStandardMaterial[];
    for (const mt of mats) if (mt.isMeshStandardMaterial && mt.metalness > 0.75) mt.metalness = 0.75; // painted airframes: no mirror chrome
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

/** point-in-polygon (even-odd) on [x, z] corners */
export function inPoly(poly: Array<[number, number]>, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Hinge line of a surface from its vertices: at each end of its span (along |x|, or along y for a fin-like part that
 * is taller than it is wide), the mean of the vertices on its leading (or trailing) edge.
 */
export function fitHinge(geos: THREE.BufferGeometry[], edge: 'le' | 'te' | 'spindle'): [[number, number, number], [number, number, number]] | undefined {
  if (edge === 'spindle') {
    const le = fitHinge(geos, 'le'), te = fitHinge(geos, 'te');
    if (!le || !te) return undefined;
    const mix = (a: number[], b: number[]) => a.map((v, k) => +(v + (b[k] - v) * 0.33).toFixed(3)) as [number, number, number];
    return [mix(le[0], te[0]), mix(le[1], te[1])];
  }
  const P: THREE.Vector3[] = [];
  for (const g of geos) { const a = g.getAttribute('position'); for (let i = 0; i < a.count; i++) P.push(new THREE.Vector3().fromBufferAttribute(a, i)); }
  if (P.length < 3) return undefined;
  const box = new THREE.Box3().setFromPoints(P), size = box.getSize(new THREE.Vector3());
  const vertical = size.y > size.x;
  const span = (p: THREE.Vector3) => (vertical ? p.y : Math.abs(p.x));
  let lo = Infinity, hi = -Infinity;
  for (const p of P) { lo = Math.min(lo, span(p)); hi = Math.max(hi, span(p)); }
  const band = Math.max(0.05, (hi - lo) * 0.06);
  const end = (at: number) => {
    const sel = P.filter((p) => Math.abs(span(p) - at) < band);
    const zz = edge === 'le' ? Math.min(...sel.map((p) => p.z)) : Math.max(...sel.map((p) => p.z));
    const e = sel.filter((p) => Math.abs(p.z - zz) < 0.06);
    const m = e.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(e.length);
    return [+m.x.toFixed(3), +m.y.toFixed(3), +m.z.toFixed(3)] as [number, number, number];
  };
  return [end(lo), end(hi)];
}

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
export function cutTriangles(g: THREE.BufferGeometry, pick: (c: THREE.Vector3, far: number, t: number) => boolean):
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
    sel[t] = pick(c, far, t) ? 1 : 0;
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

/** Connected shells of a non-indexed geometry (vertices welded by position): the shell id of every triangle. */
function shellOfTriangles(src: THREE.BufferGeometry): Int32Array {
  const pos = src.getAttribute('position'), n = pos.count;
  const ids = new Map<string, number>(), vid = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let v = ids.get(k);
    if (v === undefined) { v = ids.size; ids.set(k, v); }
    vid[i] = v;
  }
  const par = new Int32Array(ids.size).map((_, i) => i);
  const find = (a: number) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let t = 0; t < n / 3; t++) { const a = find(vid[3 * t]); for (let k = 1; k < 3; k++) { const b = find(vid[3 * t + k]); if (a !== b) par[b] = a; } }
  const out = new Int32Array(n / 3);
  for (let t = 0; t < out.length; t++) out[t] = find(vid[3 * t]);
  return out;
}

/** Split a geometry by connected shells (vertices welded by position): [rest, picked] for the shells `pick` accepts. */
export function cutShells(g: THREE.BufferGeometry, pick: (box: THREE.Box3) => boolean): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const shell = shellOfTriangles(src);
  const boxes = new Map<number, THREE.Box3>(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const r = shell[Math.floor(i / 3)]; let b = boxes.get(r); if (!b) boxes.set(r, b = new THREE.Box3()); b.expandByPoint(v.fromBufferAttribute(pos, i)); }
  const chosen = new Set<number>();
  for (const [r, b] of boxes) if (pick(b)) chosen.add(r);
  return cutTriangles(src, (_c, _f, t) => chosen.has(shell[t]));
}

/**
 * Cut a control surface out of a one-piece mesh by outline, without the neighbours the outline clips: the triangles
 * inside the outline are grouped by the connected shell they come from, and only those of the surface itself are
 * taken — the shell with the most area inside the outline, shells that lie (almost) wholly inside it (static wicks,
 * hinge fairings) and shells with a comparable share inside (a surface built from separate skins). A sliver of some
 * other part that reaches into the outline (a fuselage shelf, a tail boom, a pylon or missile rail) stays put.
 */
export function cutSurface(g: THREE.BufferGeometry, inside: (c: THREE.Vector3) => boolean): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const shell = shellOfTriangles(src);
  const nT = shell.length;
  const sel = new Uint8Array(nT);
  const total = new Map<number, number>(), cut = new Map<number, number>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
  for (let t = 0; t < nT; t++) {
    a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
    m.copy(a).add(b).add(c).divideScalar(3);
    const area = b.sub(a).cross(c.sub(a)).length() / 2;
    total.set(shell[t], (total.get(shell[t]) ?? 0) + area);
    if (inside(m)) { sel[t] = 1; cut.set(shell[t], (cut.get(shell[t]) ?? 0) + area); }
  }
  let main = 0;
  for (const v of cut.values()) main = Math.max(main, v);
  const keep = new Set<number>();
  for (const [r, v] of cut) if (v === main || v >= 0.9 * total.get(r)! || v >= 0.35 * main) keep.add(r);
  return cutTriangles(src, (_c, _f, t) => sel[t] === 1 && keep.has(shell[t]));
}

/** eigenvectors of a symmetric 3×3 matrix (Jacobi), sorted by falling eigenvalue: [values, vectors] */
function eigenSym3(m: number[][]): [number[], THREE.Vector3[]] {
  const a = m.map((r) => [...r]), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let p = 0, q = 1;
    if (Math.abs(a[0][2]) > Math.abs(a[p][q])) { p = 0; q = 2; }
    if (Math.abs(a[1][2]) > Math.abs(a[p][q])) { p = 1; q = 2; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return [order.map((i) => Math.max(0, a[i][i])), order.map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]))];
}

/**
 * Rig a landing gear that the model only has as one "gear down" set. Its connected shells are sorted into the nose
 * leg and the two main legs (by where the wheels stand), and within each into the leg with its wheels (whatever
 * reaches down), the doors (thin plates hanging from the edge of the well) and the well itself (stays put). Each leg
 * gets a hinge across its top and swings up the way the real one does; each door gets a hinge along its upper edge
 * and closes towards the well once the leg is in. The movers are appended to `movers` and the parts split to match.
 */
export function rigGear(parts: { name: string; geo: THREE.BufferGeometry; mat: THREE.Material; wing: number; mover: number }[],
  isGear: (name: string) => boolean, rig: GearRig, movers: Mover[], label = '') {
  interface Shell { part: number; id: number; box: THREE.Box3; c: THREE.Vector3; area: number; plate: boolean; normal: THREE.Vector3; long: THREE.Vector3; leg: number; kind: 'leg' | 'door' | 'well' }
  const shells: Shell[] = [];
  const srcs = new Map<number, { geo: THREE.BufferGeometry; shell: Int32Array }>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
  parts.forEach((p, pi) => {
    if (p.mover >= 0 || !isGear(p.name)) return;
    const geo = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) return;
    const shell = shellOfTriangles(geo);
    srcs.set(pi, { geo, shell });
    const acc = new Map<number, { box: THREE.Box3; c: THREE.Vector3; area: number; tris: number[] }>();
    for (let t = 0; t < shell.length; t++) {
      a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
      let s = acc.get(shell[t]);
      if (!s) acc.set(shell[t], s = { box: new THREE.Box3(), c: new THREE.Vector3(), area: 0, tris: [] });
      s.box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      m.copy(a).add(b).add(c).divideScalar(3);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2 + 1e-9;
      s.c.addScaledVector(m, area); s.area += area; s.tris.push(t);
    }
    for (const [id, s] of acc) {
      s.c.divideScalar(s.area);
      // area-weighted spread of the shell about its centre: a plate has one direction with (almost) none
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const t of s.tris) {
        a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
        const w = b.clone().sub(a).cross(c.clone().sub(a)).length() / 6 + 1e-9;
        for (const v of [a, b, c]) { const d = [v.x - s.c.x, v.y - s.c.y, v.z - s.c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += w * d[i] * d[j]; }
      }
      const [val, vec] = eigenSym3(cov.map((r) => r.map((x) => x / s.area)));
      const e = val.map(Math.sqrt);
      shells.push({ part: pi, id, box: s.box, c: s.c, area: s.area, plate: e[2] < 0.22 * e[1] && e[1] > 0.04, normal: vec[2], long: vec[0], leg: -1, kind: 'well' });
    }
  });
  if (!shells.length) return;
  // nose leg forward, main legs aft: split at the widest gap along the gear that leaves a real share of it on both
  // sides; anything else the model files under "gear" far from both (an arrestor hook, say) is left alone
  const byZ = [...shells].sort((p, q) => p.c.z - q.c.z);
  const totalArea = byZ.reduce((n, s) => n + s.area, 0);
  let zSplit = (byZ[0].c.z + byZ[byZ.length - 1].c.z) / 2, gap = 0, before = 0;
  for (let i = 0; i + 1 < byZ.length; i++) {
    before += byZ[i].area;
    const g = byZ[i + 1].c.z - byZ[i].c.z;
    if (g > gap && before > 0.1 * totalArea && before < 0.9 * totalArea) { gap = g; zSplit = (byZ[i].c.z + byZ[i + 1].c.z) / 2; }
  }
  const median = (list: Shell[]) => list.map((s) => s.c.z).sort((p, q) => p - q)[Math.floor(list.length / 2)] ?? 0;
  const zNose = median(shells.filter((s) => s.c.z < zSplit)), zMain = median(shells.filter((s) => s.c.z >= zSplit));
  for (const s of shells) s.leg = Math.abs(s.c.z - (s.c.z < zSplit ? zNose : zMain)) > 3 ? -1 : s.c.z < zSplit ? 0 : s.c.x < 0 ? 1 : 2;
  const split = new Map<number, Map<number, number>>();   // part → shell → mover
  for (let leg = 0; leg < 3; leg++) {
    const mine = shells.filter((s) => s.leg === leg);
    if (!mine.length) continue;
    const top = Math.max(...mine.map((s) => s.box.max.y)), bot = Math.min(...mine.map((s) => s.box.min.y)), H = top - bot;
    if (H < 0.3) continue;
    for (const s of mine) {
      const hangs = s.box.max.y > top - 0.35 * H && s.box.min.y > bot + 0.22 * H;
      if (s.plate && hangs && s.area > 0.04) s.kind = 'door';
      else if (s.box.min.y < bot + 0.5 * H || (s.box.min.y + s.box.max.y) / 2 < top - 0.4 * H) s.kind = 'leg';
    }
    const legs = mine.filter((s) => s.kind === 'leg');
    if (!legs.length) continue;
    // the leg's hinge: across the top of the strut (the tallest part of the leg above the wheels)
    const wheels = legs.filter((s) => s.box.min.y < bot + 0.12);
    const tall = (s: Shell) => s.box.max.y - s.box.min.y;
    const strut = [...(legs.some((s) => !wheels.includes(s)) ? legs.filter((s) => !wheels.includes(s)) : legs)].sort((p, q) => tall(q) - tall(p))[0];
    const legTop = strut.box.max.y;
    const P = new THREE.Vector3((strut.box.min.x + strut.box.max.x) / 2, legTop, (strut.box.min.z + strut.box.max.z) / 2);
    {
      // centre of the strut's top end
      const { geo, shell } = srcs.get(strut.part)!;
      const pos = geo.getAttribute('position');
      const sum = new THREE.Vector3(); let n = 0;
      for (let t = 0; t < shell.length; t++) if (shell[t] === strut.id) for (let k = 0; k < 3; k++) { a.fromBufferAttribute(pos, 3 * t + k); if (a.y > legTop - 0.08) { sum.add(a); n++; } }
      if (n) P.copy(sum.divideScalar(n));
    }
    // how far it swings: until the wheels (the lowest shells) are level with the hinge
    const W = new THREE.Vector3(); let wa = 0;
    for (const s of wheels) { W.addScaledVector(s.c, s.area); wa += s.area; }
    W.divideScalar(wa || 1);
    const d = W.sub(P);
    const dir = leg === 0 ? rig.nose : rig.main;
    const lead = dir === 'in' ? Math.atan2(-Math.sign(P.x || 1) * d.x, -d.y) : Math.atan2(dir === 'fwd' ? -d.z : d.z, -d.y);
    const deg = (leg === 0 ? rig.noseDeg : rig.mainDeg) ?? Math.max(55, Math.min(130, 90 - lead / RAD));
    const lift = leg === 0 ? 0.12 : rig.mainLift ?? 0.12;
    const legMover: Mover = dir === 'in'
      ? { parts: NEVER, hinge: [[P.x, P.y, P.z], [P.x, P.y, P.z + 1]], gear: P.x > 0 ? -deg : deg, gearPhase: [0, 0.72], lift }
      : { parts: NEVER, hinge: [[P.x - 0.5, P.y, P.z], [P.x + 0.5, P.y, P.z]], gear: dir === 'fwd' ? deg : -deg, gearPhase: [0, 0.72], lift };
    movers.push(legMover);
    if ((globalThis as { CFS_GEAR_DEBUG?: boolean }).CFS_GEAR_DEBUG) console.log('GEAR', label.split('/').pop(), 'leg', leg, 'W', W.clone().add(P).toArray().map((v) => v.toFixed(2)).join(','), 'shells', mine.length, 'legs', legs.length, 'doors', mine.filter((s) => s.kind === 'door').length, 'top', top.toFixed(2), 'bot', bot.toFixed(2), 'deg', deg.toFixed(0), 'P', P.toArray().map((v) => v.toFixed(2)).join(','), 'strut', strut.box.min.toArray().map((v) => v.toFixed(2)).join(','), strut.box.max.toArray().map((v) => v.toFixed(2)).join(','), 'zSplit', zSplit.toFixed(2));
    const legIdx = movers.length - 1;
    for (const s of legs) { let mp = split.get(s.part); if (!mp) split.set(s.part, mp = new Map()); mp.set(s.id, legIdx); }
    // doors: hinged along their upper edge, closing towards the well
    for (const s of mine) {
      if (s.kind !== 'door') continue;
      const { geo, shell } = srcs.get(s.part)!;
      const pos = geo.getAttribute('position');
      const h = s.box.max.y - s.box.min.y;
      const sum = new THREE.Vector3(); let n = 0;
      for (let t = 0; t < shell.length; t++) if (shell[t] === s.id) for (let k = 0; k < 3; k++) { a.fromBufferAttribute(pos, 3 * t + k); if (a.y > s.box.max.y - Math.max(0.03, 0.12 * h)) { sum.add(a); n++; } }
      if (!n) continue;
      const hp = sum.divideScalar(n);
      // hinge axis: the door's long direction, laid flat
      const ax = s.long.clone(); ax.y = 0;
      if (ax.lengthSq() < 0.2) continue;
      ax.normalize();
      // (the same convention instantiateHd applies: horizontal hinges point +x, else as given)
      if (ax.x < 0) ax.negate();
      // angle that lays the door's face flat; the sense that brings its centre towards the well
      const nrm = s.normal.clone().addScaledVector(ax, -s.normal.dot(ax));
      if (nrm.lengthSq() < 1e-6) continue;
      nrm.normalize();
      const tilt = Math.acos(Math.min(1, Math.abs(nrm.y)));   // 0 = already flat
      if (tilt < 0.26) continue;
      const rel = s.c.clone().sub(hp);
      const dist = (ang: number) => rel.clone().applyAxisAngle(ax, ang).add(hp).distanceTo(P);
      const sense = dist(tilt) < dist(-tilt) ? 1 : -1;
      movers.push({ parts: NEVER, hinge: [[hp.x, hp.y, hp.z], [hp.x + ax.x, hp.y, hp.z + ax.z]], gear: sense * tilt / RAD, gearPhase: [0.62, 0.99] });
      let mp = split.get(s.part); if (!mp) split.set(s.part, mp = new Map());
      mp.set(s.id, movers.length - 1);
    }
  }
  // split the parts: one piece per mover, the wells stay
  for (const [pi, mp] of split) {
    const p = parts[pi], { geo, shell } = srcs.get(pi)!;
    let rest: THREE.BufferGeometry = geo;
    let restShell = shell;
    for (const mi of new Set(mp.values())) {
      const sh = restShell;
      const keepT: number[] = [];
      const [r, piece] = cutTriangles(rest, (_c, _f, t) => { const hit = mp.get(sh[t]) === mi; if (!hit) keepT.push(sh[t]); return hit; });
      rest = r; restShell = Int32Array.from(keepT);
      if (piece) parts.push({ ...p, geo: piece, mover: mi });
    }
    p.geo = rest;
  }
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
  movers: Array<{ group: THREE.Group; axis: THREE.Vector3; spec: Mover; base: THREE.Vector3 }>;
  /** the gear is rigged (legs and doors travel): the whole gear-down set shows until the gear is up and locked */
  rigged: boolean;
}

export function instantiateHd(t: { root: THREE.Group; spec: HdSpec }): HdInstance {
  const root = new THREE.Group();
  const inst: HdInstance = { root, wings: null, gearDown: [], gearUp: [], cockpit: [], glass: [], eye: new THREE.Vector3(), movers: [], rigged: !!t.spec.gearRig };
  const pivot = t.root.userData.pivot as { x: number; z: number } | undefined;
  if (t.spec.wings && pivot) {
    const left = new THREE.Group(), right = new THREE.Group();
    left.position.set(-pivot.x, 0, pivot.z);
    right.position.set(pivot.x, 0, pivot.z);
    root.add(left, right);
    inst.wings = { left, right, refSweep: t.spec.wings.refSweep };
  }
  const hudBox = new THREE.Box3();
  const moverGroups = new Map<number, HdInstance['movers'][number] & { a: THREE.Vector3 }>();
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
    const movers = (t.root.userData.movers as Mover[] | undefined) ?? t.spec.movers;
    if (mi >= 0 && movers) {
      // a hinged part: its group sits on the hinge (inside the wing group for a part on a swing wing)
      let mv = moverGroups.get(mi);
      if (!mv) {
        const ms = movers[mi];
        const h = (t.root.userData.hinges as Mover['hinge'][] | undefined)?.[mi] ?? ms.hinge ?? [[0, 0, 0], [1, 0, 0]];
        const a = new THREE.Vector3(...h[0]), axis = new THREE.Vector3(...h[1]).sub(a).normalize();
        if (Math.abs(axis.y) > 0.7 ? axis.y < 0 : axis.x < 0) axis.negate();
        const group = new THREE.Group();
        group.position.copy(a);
        if (wingGrp) { group.position.sub(wingGrp.position); wingGrp.add(group); } else root.add(group);
        mv = { group, axis, spec: ms, a, base: group.position.clone() };
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

export function updateHdInstance(inst: HdInstance, gearPos: number, sweepDeg: number, ctl?: HdControls) {
  const down = gearPos > 0.5;
  // gear legs with a hinge stay out while they travel; the rest of the gear swaps at half travel (a rigged gear
  // shows all of it, wells and doors too, until it is up and the closed doors take over)
  for (const g of inst.gearDown) g.visible = g.userData.hinged || inst.rigged ? gearPos > 0.01 : down;
  for (const g of inst.gearUp) g.visible = inst.rigged ? gearPos <= 0.01 : !down;
  const up = 1 - gearPos;
  for (const mv of inst.movers) {
    const m = mv.spec;
    let k = up;
    if (m.gearPhase) { k = Math.max(0, Math.min(1, (up - m.gearPhase[0]) / (m.gearPhase[1] - m.gearPhase[0]))); k = k * k * (3 - 2 * k); }
    let a = (m.gear ?? 0) * k * RAD;
    if (m.lift) mv.group.position.set(mv.base.x, mv.base.y + m.lift * k, mv.base.z);
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
