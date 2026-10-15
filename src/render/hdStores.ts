// High-detail glTF missiles. Each file is normalised once when it loads (long axis along z with the nose at -z,
// centred, scaled to the real missile's length, merged into one mesh per material) and then cloned onto every rail
// and every missile in flight. Until a file is in, storeMesh() shows the simple procedural shape.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hdModelsEnabled } from './hdModels.js';

export interface StoreSpec {
  url: string;
  /** weapon ids drawn with this model */
  ids: string[];
  /** real length (m); the model is scaled to it */
  length: number;
  /** extra roll about the long axis (rad), to bring the rail lugs to the top */
  roll?: number;
  title: string; author: string; source: string; license: string;
}

export const STORE_SPECS: StoreSpec[] = [
  { url: 'assets/models/cc-by/aim120.glb', ids: ['aim120c'], length: 3.66, roll: Math.PI,
    title: 'Game Ready Low Poly Aim-120', author: 'Mustafa Garip',
    source: 'https://sketchfab.com/3d-models/game-ready-low-poly-aim-120-81b5a823252f49e7846efb5cd81f1725', license: 'CC BY 4.0' },
  { url: 'assets/models/cc-by/aim54.glb', ids: ['aim54c'], length: 3.96,
    title: 'AIM-54 Phoenix (Low Poly)', author: 'Mustafa Garip',
    source: 'https://sketchfab.com/3d-models/aim-54-phoenix-low-poly-0f93756f393d498f95c4364244f8bda0', license: 'CC BY 4.0' },
  { url: 'assets/models/cc-by-nc/aim9m.glb', ids: ['aim9m'], length: 2.87,
    title: 'AIM-9M Sidewinder', author: 'Civorsky',
    source: 'https://sketchfab.com/3d-models/aim-9m-sidewinder-50fd78cf94424a42ae8538a0f09b421d', license: 'CC BY-NC 4.0' },
];

const byId = new Map<string, StoreSpec>();
for (const s of STORE_SPECS) for (const id of s.ids) byId.set(id, s);
export function storeSpecFor(id: string) { return byId.get(id); }


const templates = new Map<string, THREE.Group | null>();
const pending = new Map<string, ((t: THREE.Group | null) => void)[]>();
let loader: GLTFLoader | null = null;
/** bumps every time a model finishes loading, so stores already hung can be re-snapped to the airframe */
let version = 0;
export function hdStoreVersion() { return version; }

/**
 * Normalise a loaded missile: bake node transforms, merge per material, point the long axis along -z (nose forward),
 * centre it and scale it to `length`. The nose is the end whose last 2 % is thinnest (a point, not a nozzle or fins).
 */
export function normaliseStore(scene: THREE.Object3D, length: number, roll = 0): THREE.Group {
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      if (!(a.array instanceof Float32Array) || a.normalized) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
  });
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (const [mat, list] of byMat) {
    // uv present on some parts only → drop it so they can merge
    if (list.some((g) => !g.attributes.uv)) for (const g of list) g.deleteAttribute('uv');
    const geo = list.length === 1 ? list[0] : mergeGeometries(list);
    if (geo) parts.push({ geo, mat });
  }
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const centre = box.getCenter(new THREE.Vector3());
  const lo = box.min.getComponent(axis), hi = box.max.getComponent(axis), span = hi - lo;
  // thickness of each end
  let rLo = 0, rHi = 0;
  const v = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).sub(centre);
      const a = v.getComponent(axis) + centre.getComponent(axis);
      v.setComponent(axis, 0);
      const r = v.length();
      if (a < lo + span * 0.02) rLo = Math.max(rLo, r);
      else if (a > hi - span * 0.02) rHi = Math.max(rHi, r);
    }
  }
  const noseAtHi = rHi < rLo;
  // rotation taking the long axis (nose end) onto -z
  const from = new THREE.Vector3().setComponent(axis, noseAtHi ? 1 : -1);
  const q = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, 0, -1))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const s = length / span;
  const xf = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z)
    .premultiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
    .premultiply(new THREE.Matrix4().makeScale(s, s, s));
  const root = new THREE.Group();
  for (const p of parts) {
    p.geo.applyMatrix4(xf);
    p.geo.computeBoundingSphere();
    const mat = p.mat.clone() as THREE.MeshStandardMaterial;
    if (mat.isMeshStandardMaterial && mat.metalness > 0.4) mat.metalness = 0.4;   // no env map: keep metal from going black
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.castShadow = true;
    root.add(mesh);
  }
  return root;
}

function loadStore(spec: StoreSpec, cb: (t: THREE.Group | null) => void) {
  if (templates.has(spec.url)) { cb(templates.get(spec.url)!); return; }
  const waiting = pending.get(spec.url);
  if (waiting) { waiting.push(cb); return; }
  pending.set(spec.url, [cb]);
  loader ??= new GLTFLoader();
  const done = (t: THREE.Group | null) => {
    templates.set(spec.url, t);
    if (t) version++;
    for (const f of pending.get(spec.url)!) f(t);
    pending.delete(spec.url);
  };
  loader.load(spec.url, (gltf) => {
    try { done(normaliseStore(gltf.scene, spec.length, spec.roll)); } catch (e) { console.warn('HD store failed', spec.url, e); done(null); }
  }, undefined, (err) => { console.warn('HD store not available', spec.url, err); done(null); });
}

/** Swap the procedural shape in `group` for the HD missile once its file is loaded (immediately if already cached). */
export function attachHdStore(group: THREE.Object3D, id: string) {
  const spec = byId.get(id);
  if (!spec || !hdModelsEnabled() || typeof window === 'undefined') return;
  loadStore(spec, (t) => {
    if (!t) return;
    // the procedural shape is removed, not hidden (the rail snap measures the group's bounds); a motor flame stays
    for (const c of [...group.children]) if (c.name !== 'burner') group.remove(c);
    const m = t.clone();
    m.userData.hdStore = true;
    group.add(m);
  });
}

/** Credits for the credits screen. */
export function hdStoreCredits() {
  return STORE_SPECS.map((s) => ({ title: s.title, author: s.author, source: s.source, license: s.license }));
}
