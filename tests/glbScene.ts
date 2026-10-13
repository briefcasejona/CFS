// Test helper: read a GLB's node tree and geometry (no textures) into a three.js scene, the way GLTFLoader would.
import * as THREE from 'three';
import { NodeIO, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

export async function loadGlbScene(file: string): Promise<THREE.Group> {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const scene = new THREE.Group();
  const build = (n: Node, parent: THREE.Object3D) => {
    const o = new THREE.Group();
    o.name = n.getName();
    o.matrix.fromArray(n.getMatrix());
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    parent.add(o);
    const mesh = n.getMesh();
    for (const prim of mesh?.listPrimitives() ?? []) {
      const g = new THREE.BufferGeometry();
      for (const [sem, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']] as const) {
        const a = prim.getAttribute(sem);
        // (quantized models store normalized integers: keep the flag so three.js scales them back)
        if (a) g.setAttribute(name, new THREE.BufferAttribute(a.getArray()!.slice() as THREE.TypedArray, a.getElementSize(), a.getNormalized()));
      }
      const idx = prim.getIndices();
      if (idx) g.setIndex(Array.from(idx.getArray()!));
      const m = prim.getMaterial();
      const mat = new THREE.MeshStandardMaterial({ name: m?.getName() ?? '', transparent: m?.getAlphaMode() === 'BLEND' });
      const mm = new THREE.Mesh(g, mat);
      mm.name = mesh!.getName();
      o.add(mm);
    }
    for (const c of n.listChildren()) build(c, o);
  };
  for (const n of doc.getRoot().getDefaultScene()!.listChildren()) build(n, scene);
  return scene;
}
