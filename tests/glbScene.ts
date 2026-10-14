// Test helper: read a GLB's node tree and geometry (no textures) into a three.js scene the way GLTFLoader does, so
// node-path patterns in hdModels.ts are tested against the names the game really sees: names are sanitized
// (PropertyBinding.sanitizeNodeName drops '.', ':', '/', '[', ']' and turns spaces into '_') and made unique, a node
// whose mesh has a single primitive *is* that mesh (named after the node), and a multi-primitive mesh becomes a group
// named after the node holding one mesh per primitive.
import * as THREE from 'three';
import { NodeIO, type Node, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export async function loadGlbScene(file: string): Promise<THREE.Group> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const used: Record<string, number> = {};
  const unique = (name: string) => {
    const s = THREE.PropertyBinding.sanitizeNodeName(name);
    if (s in used) return `${s}_${++used[s]}`;
    used[s] = 0;
    return s;
  };
  const primMesh = (prim: Primitive) => {
    const g = new THREE.BufferGeometry();
    for (const [sem, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']] as const) {
      const a = prim.getAttribute(sem);
      // (quantized models store normalized integers: keep the flag so three.js scales them back)
      if (a) g.setAttribute(name, new THREE.BufferAttribute(a.getArray()!.slice() as THREE.TypedArray, a.getElementSize(), a.getNormalized()));
    }
    const idx = prim.getIndices();
    if (idx) g.setIndex(Array.from(idx.getArray()!));
    const m = prim.getMaterial();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: m?.getName() ?? '', transparent: m?.getAlphaMode() === 'BLEND' }));
  };
  const build = (n: Node, parent: THREE.Object3D) => {
    const mesh = n.getMesh();
    const prims = mesh?.listPrimitives() ?? [];
    let o: THREE.Object3D;
    if (prims.length === 1) o = primMesh(prims[0]);
    else {
      o = new THREE.Group();
      for (const p of prims) { const pm = primMesh(p); pm.name = unique(mesh!.getName() || 'mesh'); o.add(pm); }
    }
    o.name = n.getName() ? unique(n.getName()) : '';
    o.matrix.fromArray(n.getMatrix());
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    parent.add(o);
    for (const c of n.listChildren()) build(c, o);
  };
  const scene = new THREE.Group();
  scene.name = 'Scene';
  for (const n of doc.getRoot().getDefaultScene()!.listChildren()) build(n, scene);
  return scene;
}
