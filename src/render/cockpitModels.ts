// Cockpit models: a separate, detailed interior per flyable aircraft, loaded only while the player is in cockpit
// view (see cockpitView.ts). The exterior model (hdModels.ts) stays what everyone else sees, and what you see from
// the outside views.
//
// THE SLOT FOR THE NEW F-16 COCKPIT
// Drop the file at the `url` below (glTF binary). Until it is there the game falls back to the exterior model's own
// cockpit, so nothing breaks. Once it loads:
//  * `axes`, `scale` and `offset` put it in the game's body frame (metres, x right, y up, z aft, origin at the jet's
//    centre). Tune `offset` so the canopy sill lines up with the exterior canopy.
//  * `eye` is the design eye point the camera sits at.
//  * `mfds` are the two MFD glass faces (centre, size, outward normal) that the live displays are drawn on, and that
//    the clickable OSBs are laid around. Measure them on the model (the same way as the exterior specs in
//    hdModels.ts).
//  * The node hierarchy is kept as it is in the file (nothing is merged), so every switch stays its own node and can
//    later be bound to a control in the aircraft's systems by node name (`switches`).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AircraftDef } from '../aircraft/types.js';

export interface CockpitModelSpec {
  url: string;
  title: string; author: string; source: string; license: string;
  /** source axes: 'xfwd' = nose +X, right +Z; 'zfwd' = nose +Z, left +X; 'game' = already nose −Z, right +X */
  axes: 'xfwd' | 'zfwd' | 'game';
  /** source units → metres */
  scale: number;
  /** where the model's origin sits in the game body frame (metres) */
  offset: [number, number, number];
  /** pilot design eye point in the game body frame (metres); left out, the exterior model's eye point is used */
  eye?: [number, number, number];
  /** live MFD faces in the game body frame (metres): centre, size, outward normal, which display (0 left, 1 right) */
  mfds?: Array<{ c: [number, number, number]; w: number; h: number; n: [number, number, number]; screen: 0 | 1 }>;
  /** HUD combiner glass node(s): drawn as faint see-through glass (the symbology itself is the HUD overlay) */
  hudGlass?: RegExp;
  /** nodes not to draw (e.g. a pilot body or a canopy that duplicates the exterior's) */
  hide?: RegExp;
  /** node name → control id in the aircraft's systems (systems/<type>/panels.ts), for switches modelled in the file */
  switches?: Record<string, string>;
}

/** Keyed by aircraft family. Only flyable aircraft need one. */
export const COCKPIT_MODELS: Record<string, CockpitModelSpec> = {
  'F-16': {
    url: 'assets/models/cockpits/f16/cockpit.glb',
    title: 'F-16C cockpit', author: '', source: '', license: '',
    // placeholders until the model arrives: an export in metres, nose −Z, origin at the jet's centre
    axes: 'game', scale: 1, offset: [0, 0, 0],
  },
};

export function cockpitSpecFor(def: AircraftDef): CockpitModelSpec | undefined { return COCKPIT_MODELS[def.family ?? def.name]; }

const SRC_TO_GAME = {
  xfwd: new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1),
  zfwd: new THREE.Matrix4().makeRotationY(Math.PI),
  game: new THREE.Matrix4(),
};

/** urls that failed once (not there yet): not asked for again this session */
const missing = new Set<string>();
let loader: GLTFLoader | null = null;

/** The placed cockpit model, or null when the file is not there (or not loadable). A fresh copy every call: the
 *  caller owns it and disposes it when it leaves cockpit view. */
export function loadCockpitModel(spec: CockpitModelSpec): Promise<THREE.Group | null> {
  if (missing.has(spec.url) || typeof window === 'undefined') return Promise.resolve(null);
  loader ??= new GLTFLoader();
  const l = loader;
  return new Promise((resolve) => {
    l.load(spec.url, (gltf) => {
      try { resolve(place(gltf.scene, spec)); } catch (e) { console.warn('cockpit model failed', spec.url, e); missing.add(spec.url); resolve(null); }
    }, undefined, () => { missing.add(spec.url); resolve(null); });
  });
}

function place(scene: THREE.Object3D, spec: CockpitModelSpec): THREE.Group {
  const root = new THREE.Group();
  root.name = 'cockpit-model';
  const holder = new THREE.Group();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(new THREE.Matrix4().makeTranslation(...spec.offset).multiply(SRC_TO_GAME[spec.axes]).multiply(new THREE.Matrix4().makeScale(spec.scale, spec.scale, spec.scale)));
  holder.add(scene);
  root.add(holder);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (spec.hide?.test(o.name)) { o.visible = false; return; }
    if (spec.hudGlass?.test(o.name)) {
      m.material = new THREE.MeshStandardMaterial({ name: 'hud-combiner', color: 0x9fe8b8, roughness: 0.05, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    }
    m.castShadow = false; m.receiveShadow = true;
  });
  return root;
}

/** Free the GPU memory of a tree built for cockpit view (geometries, materials, textures). Shared materials that are
 *  used again later are simply uploaded again by three.js. `keep`: geometries owned by someone else. */
export function disposeTree(root: THREE.Object3D, keep?: Set<THREE.BufferGeometry>) {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
    if (m.geometry && !keep?.has(m.geometry)) m.geometry.dispose();
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (mt) mats.add(mt);
  });
  for (const mt of mats) {
    for (const v of Object.values(mt)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
    mt.dispose();
  }
  root.parent?.remove(root);
}

/** Credits for the cockpit models that are filled in. */
export function cockpitCredits() {
  return Object.values(COCKPIT_MODELS).filter((s) => s.author).map((s) => ({ title: s.title, author: s.author, source: s.source, license: s.license }));
}
