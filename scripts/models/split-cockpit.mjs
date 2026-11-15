// Split the grouped switches, buttons and knobs of a cockpit model into parts of their own, so each can move.
//
//   node scripts/models/split-cockpit.mjs <in.glb> <out.glb>
//
// The source merges whole panels into a few meshes. Every connected piece of a mesh (after welding vertices that
// share a position) that is small (under MAX_SIZE across) becomes its own node, named `part_<mesh>_<n>` in a stable
// order, with its origin at the centre of its bounds. The rest of each mesh stays as it was. Which part is which
// control is set in src/render/cockpitModels.ts (`switches`).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const MAX_SIZE = 0.06;   // m (after the model's own transforms)
const MIN_TRIS = 4;

const [, , src, dst] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const buffer = root.listBuffers()[0];
let parts = 0;

const meshNodes = root.listNodes().filter((n) => n.getMesh());
meshNodes.forEach((node, mi) => {
  const wm = node.getWorldMatrix();
  const mesh = node.getMesh();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const n = pos.getCount();
    const W = [];
    for (let i = 0; i < n; i++) {
      const v = pos.getElement(i, []);
      W.push([0, 1, 2].map((j) => wm[j] * v[0] + wm[4 + j] * v[1] + wm[8 + j] * v[2] + wm[12 + j]));
    }
    const key = new Map(), rep = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = W[i].map((c) => Math.round(c * 2000)).join(','); if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
    const par = Int32Array.from({ length: n }, (_, i) => i);
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const triCount = idx ? idx.getCount() / 3 : n / 3;
    const T = (t, k) => (idx ? idx.getScalar(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triCount; t++) {
      const a = find(rep[T(t, 0)]);
      par[a] = find(rep[T(t, 1)]);
      par[find(rep[T(t, 2)])] = find(rep[T(t, 1)]);
    }
    // components in order of their first triangle (stable)
    const comps = new Map();
    for (let t = 0; t < triCount; t++) {
      const r = find(rep[T(t, 0)]);
      let c = comps.get(r);
      if (!c) { c = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; comps.set(r, c); }
      c.tris.push(t);
      for (let k = 0; k < 3; k++) { const p = W[T(t, k)]; for (let j = 0; j < 3; j++) { c.min[j] = Math.min(c.min[j], p[j]); c.max[j] = Math.max(c.max[j], p[j]); } }
    }
    const small = [...comps.values()].filter((c) => c.tris.length >= MIN_TRIS && Math.max(...c.max.map((v, j) => v - c.min[j])) < MAX_SIZE);
    if (!small.length) continue;
    const taken = new Set(small.flatMap((c) => c.tris));
    // a new primitive from a set of triangles, its vertices in world space minus `origin`
    const attrs = prim.listSemantics();
    const build = (tris, origin) => {
      const map = new Map(), order = [];
      const newIdx = [];
      for (const t of tris) for (let k = 0; k < 3; k++) { const v = T(t, k); if (!map.has(v)) { map.set(v, order.length); order.push(v); } newIdx.push(map.get(v)); }
      const p = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
      for (const sem of attrs) {
        const a = prim.getAttribute(sem);
        const size = a.getElementSize();
        const arr = new Float32Array(order.length * size);
        order.forEach((v, i) => {
          let e = a.getElement(v, []);
          if (sem === 'POSITION') e = W[v].map((c, j) => c - origin[j]);
          else if (sem === 'NORMAL') { const x = e; e = [0, 1, 2].map((j) => wm[j] * x[0] + wm[4 + j] * x[1] + wm[8 + j] * x[2]); const l = Math.hypot(...e) || 1; e = e.map((c) => c / l); }
          arr.set(e.slice(0, size), i * size);
        });
        p.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(arr).setBuffer(buffer));
      }
      const IA = order.length > 65535 ? Uint32Array : Uint16Array;
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(IA.from(newIdx)).setBuffer(buffer));
      return p;
    };
    small.forEach((c, k) => {
      const ctr = c.min.map((v, j) => (v + c.max[j]) / 2);
      const part = doc.createNode(`part_${mi}_${k}`).setTranslation(ctr)
        .setMesh(doc.createMesh(`part_${mi}_${k}`).addPrimitive(build(c.tris, ctr)));
      part.setExtras({ size: c.max.map((v, j) => +(v - c.min[j]).toFixed(4)) });
      scene.addChild(part);
      parts++;
    });
    // what is left of the panel, in world space too (the node's transform is dropped below)
    const rest = [];
    for (let t = 0; t < triCount; t++) if (!taken.has(t)) rest.push(t);
    const restNode = doc.createNode(`panel_${mi}`).setMesh(doc.createMesh(`panel_${mi}`).addPrimitive(build(rest, [0, 0, 0])));
    scene.addChild(restNode);
    mesh.removePrimitive(prim);
    prim.dispose();
  }
  if (!mesh.listPrimitives().length) { node.setMesh(null); mesh.dispose(); }
});
await io.write(dst, doc);
console.log(`${parts} parts split out`);
