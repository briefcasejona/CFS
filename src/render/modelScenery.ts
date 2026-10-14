// Detailed scenery from real 3D models (Europe): Dutch town houses, landmark buildings, city blocks, eastern panel
// blocks and textured trees, instanced within DETAIL_SCENERY of the camera. They stand on exactly the cells where the
// procedural houses and trees would (same hashes), and the procedural ring then starts at DETAIL_SCENERY, so the
// hand-off is seamless. The models come from one baked GLB (scripts/models/bake-scenery.mjs), loaded on demand.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ringMaterial, hash2 } from './scenery.js';

export const DETAIL_SCENERY = 2000;
/** inner radius of the procedural houses/trees ring: DETAIL_SCENERY while the models are shown, else 0 */
export const proceduralInner = { value: 0 };
const PLACE_R = DETAIL_SCENERY + 1100;   // placed this far, rebuilt every ~1 km of travel
export const SCENERY_URL = 'assets/models/cc-by/scenery-eu.glb';

export const SCENERY_CREDITS = [
  { title: 'European Buildings Asset Pack 1', author: 'EddyNL', source: 'https://sketchfab.com/3d-models/european-buildings-asset-pack-1-b35bb99dac624919b40fb3fdf59b438a' },
  { title: 'Buildings', author: 'Elbolillo', source: 'https://sketchfab.com/3d-models/buildings-53fdd165f327434e9a88873253f710a5' },
  { title: 'Detailed 12 storey panel apartment building', author: 'bean(alwayshasbean)', source: 'https://sketchfab.com/3d-models/detailed-12-storey-panel-apartment-building-cb7064bec48845fea62a830b2c692fb1' },
  { title: 'Low Poly Forest Tree Pack', author: '99.Miles', source: 'https://sketchfab.com/3d-models/low-poly-forest-tree-pack-5ff5a51e74324845a4e4905f182dfb2b' },
];

interface Variant {
  name: string;
  size: [number, number, number];
  meshes: THREE.InstancedMesh[];
  n: number;
  cap: number;
}

/** what goes on a house or tree cell */
export interface CellPick { x: number; z: number; h: number; rot: number; scale: number; variant: string }

export class ModelScenery {
  readonly group = new THREE.Group();
  ready = false;
  private loading = false;
  private failed = false;
  private variants = new Map<string, Variant>();
  /** variant names by family */
  fam: Record<'small' | 'landmark' | 'block' | 'panel' | 'conifer' | 'broadleaf', string[]> = { small: [], landmark: [], block: [], panel: [], conifer: [], broadleaf: [] };

  constructor() { this.group.name = 'model-scenery'; }

  load(base = '') {
    if (this.loading || this.ready || this.failed) return;
    this.loading = true;
    new GLTFLoader().loadAsync(base + SCENERY_URL).then((g) => { this.build(g.scene); this.ready = true; }, (err) => {
      this.failed = true;
      console.warn('Scenery models could not be loaded; procedural houses and trees stay.', err);
    });
  }

  /** turn the baked scene into instanced meshes, one per variant and material */
  build(scene: THREE.Object3D) {
    for (const node of [...scene.children]) {
      const name = node.name;
      const size = ((node.userData.size as number[]) ?? [10, 10, 10]) as [number, number, number];
      const kind = name.split('_')[0];
      const tree = kind === 'tree';
      const meshes: THREE.Mesh[] = [];
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const cap = tree ? 4000 : kind === 'panel' ? 300 : 1500;
      const v: Variant = { name, size, meshes: [], n: 0, cap };
      for (const m of meshes) {
        const src = m.material as THREE.MeshStandardMaterial;
        // Lambert: thousands of instances, seen from a cockpit — the PBR model costs too much and adds nothing here
        const mat = new THREE.MeshLambertMaterial({
          map: src.map ?? null, color: src.color, vertexColors: !!m.geometry.getAttribute('color'),
          side: src.side, alphaTest: tree ? 0.45 : src.alphaTest, transparent: false,
        });
        const geo = m.geometry.clone();
        m.updateWorldMatrix(true, false);
        geo.applyMatrix4(m.matrixWorld);
        const im = new THREE.InstancedMesh(geo, ringMaterial(mat, 0, DETAIL_SCENERY), cap);
        im.count = 0;
        im.frustumCulled = false;
        im.name = name;
        v.meshes.push(im);
        this.group.add(im);
      }
      this.variants.set(name, v);
      const [w, h, d] = size, foot = Math.max(w, d);
      if (tree) { if (h >= 9) this.fam[w / h < 0.36 ? 'conifer' : 'broadleaf'].push(name); }
      else if (kind === 'panel') this.fam.panel.push(name);
      else if (kind === 'block') this.fam.block.push(name);
      else if (foot > 20) this.fam.landmark.push(name);
      else this.fam.small.push(name);
    }
  }

  sizeOf(name: string) { return this.variants.get(name)?.size; }

  /** replace all instances with `picks` */
  set(picks: CellPick[]) {
    for (const v of this.variants.values()) v.n = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of picks) {
      const v = this.variants.get(c.variant);
      if (!v || v.n >= v.cap) continue;
      m.compose(p.set(c.x, c.h, c.z), q.setFromAxisAngle(up, c.rot), s.setScalar(c.scale));
      for (const im of v.meshes) im.setMatrixAt(v.n, m);
      v.n++;
    }
    for (const v of this.variants.values()) for (const im of v.meshes) { im.count = v.n; im.instanceMatrix.needsUpdate = true; }
  }
}

/** pick a variant from a family by a 0..1 hash */
export function pick(list: string[], u: number) { return list[Math.min(list.length - 1, Math.floor(u * list.length))]; }
export { hash2 };
