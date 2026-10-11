#!/usr/bin/env node
// Reduce a GLB's geometry for the web with pure-JS / WASM tools (gltf-transform + meshoptimizer, no native binaries):
// weld + simplify the parts named by --simplify (regex on the node path, e.g. landing gear and cockpit clutter, which
// are only ever seen up close), drop vertex colours that are all white, and quantize vertex attributes
// (KHR_mesh_quantization — read natively by three.js). Node names and hierarchy are kept, so articulated parts
// (wings, flaps) still work. Licence metadata in asset.extras is preserved.
//
// Usage: node scripts/models/reduce-glb.mjs <in.glb> <out.glb> [--simplify "gear_|wheel_"] [--ratio 0.3] [--error 0.002]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) { console.error('usage: reduce-glb.mjs <in.glb> <out.glb> [--simplify REGEX] [--ratio R] [--error E]'); process.exit(1); }
const opt = { simplify: '', ratio: 0.3, error: 0.002 };
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const countVerts = () => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getAttribute('POSITION').getCount(), 0), 0);
const before = countVerts();

const pathOf = (node) => { let path = '', a = node; while (a) { path = `${a.getName()}/${path}`; a = a.getParentNode(); } return path; };

// Parts to simplify are often triangle soup (flat-shaded, per-face normals and UV seams), which neither welds nor
// simplifies — so they lose normals/UVs first (the loader recomputes smooth normals; small close-up parts such as
// landing gear don't need their texture detail).
if (opt.simplify) {
  const re0 = new RegExp(opt.simplify, 'i');
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !re0.test(pathOf(node))) continue;
    for (const prim of mesh.listPrimitives()) for (const sem of prim.listSemantics()) if (sem !== 'POSITION') prim.setAttribute(sem, null);
  }
}
await doc.transform(dedup(), weld());

// selective simplification: path = all ancestor names joined
if (opt.simplify) {
  const re = new RegExp(opt.simplify, 'i');
  const done = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || done.has(mesh)) continue;
    let path = '', a = node;
    while (a) { path = `${a.getName()}/${path}`; a = a.getParentNode(); }
    if (!re.test(path)) continue;
    done.add(mesh);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute("POSITION").getCount() < 48) continue;
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Number(opt.ratio), error: Number(opt.error) });
    }
  }
}

// vertex colours that are (nearly) all white add nothing
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const c = prim.getAttribute('COLOR_0');
  if (!c) continue;
  const arr = c.getArray(); let white = true;
  const scale = arr instanceof Float32Array ? 1 : arr instanceof Uint16Array ? 65535 : 255;
  for (let i = 0; i < arr.length; i++) if (arr[i] / scale < 0.97) { white = false; break; }
  if (white) prim.setAttribute('COLOR_0', null);
}

await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), prune());
const extras = doc.getRoot().getAsset().extras ?? {};
doc.getRoot().getAsset().extras = { ...extras, modified: `${extras.modified ? extras.modified + ' ' : ''}CFS: geometry welded, landing gear / cockpit detail simplified, attributes quantized.` };
await io.write(output, doc);
console.log(`${input}: ${before} → ${countVerts()} vertices; ${(statSync(input).size / 1e6).toFixed(1)} → ${(statSync(output).size / 1e6).toFixed(2)} MB`);
