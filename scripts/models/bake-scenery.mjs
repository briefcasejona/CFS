#!/usr/bin/env node
// Bake model packs (buildings, trees) into one scenery GLB for instancing: every object becomes one node, named
// <kind>_<n>, with its footprint centred on the origin and its base at y = 0, its parts merged per material.
// Objects are found by clustering the pack's mesh nodes by their ground footprint (packs exported from SketchUp
// split one house over dozens of nodes). Untextured materials collapse into one vertex-coloured material per object,
// normal/ORM maps are dropped (scenery is seen from the air), and the licence metadata of every pack is kept.
//
// Usage: node scripts/models/bake-scenery.mjs <out.glb> <pack.glb>:<kind>[:<options>] ...
//   kinds: house, block, panel, tree (any word works; the runtime picks by prefix)
//   options (comma separated): skip=<regex on node names>, minH=<m>, maxH=<m>, minW=<m>, maxW=<m>, merge=<m gap>
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, joinPrimitives, mergeDocuments, metalRough, prune, transformPrimitive, unpartition } from '@gltf-transform/functions';

const [, , output, ...packs] = process.argv;
if (!output || !packs.length) { console.error('usage: bake-scenery.mjs <out.glb> <pack.glb>:<kind>[:opts] ...'); process.exit(1); }
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const target = new Document();
const credits = [];
const counts = {};

const mul = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

for (const spec of packs) {
  const [file, kind, optStr = ''] = spec.split(':');
  const opt = { minH: 3, maxH: 200, minW: 2, maxW: 250, merge: 0.3, skip: null };
  for (const kv of optStr.split(',').filter(Boolean)) { const [k, v] = kv.split('='); opt[k] = k === 'skip' ? new RegExp(v) : Number(v); }
  const doc = await io.read(file);
  const asset = doc.getRoot().getAsset();
  if (asset.extras) credits.push(asset.extras);
  await doc.transform(metalRough());
  const scene = doc.getRoot().listScenes()[0];

  // every triangle-mesh node with its world-space bounds
  const parts = [];
  for (const top of scene.listChildren()) top.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh || (opt.skip && opt.skip.test(n.getName()))) return;
    // a node skipped by name hides its whole subtree
    for (let p = n; p; p = p.getParentNode()) if (opt.skip && opt.skip.test(p.getName())) return;
    const M = n.getWorldMatrix();
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const prims = mesh.listPrimitives().filter((p) => p.getMode() === 4 && p.getAttribute('POSITION'));
    for (const p of prims) {
      const pos = p.getAttribute('POSITION'), el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) { const w = mul(M, pos.getElement(i, el)); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } }
    }
    if (prims.length && mn[0] < Infinity) parts.push({ node: n, M, prims, mn, mx });
  });

  // cluster by footprint overlap (union-find)
  const parent = parts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const g = opt.merge;
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    const A = parts[a], B = parts[b];
    if (A.mn[0] - g <= B.mx[0] && B.mn[0] - g <= A.mx[0] && A.mn[2] - g <= B.mx[2] && B.mn[2] - g <= A.mx[2]) parent[find(a)] = find(b);
  }
  const clusters = new Map();
  parts.forEach((p, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(p); });

  const flat = doc.createMaterial(`${kind}_flat`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const outScene = doc.createScene('baked');
  const objects = [];
  for (const group of clusters.values()) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of group) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.mn[k]); mx[k] = Math.max(mx[k], p.mx[k]); }
    const w = Math.max(mx[0] - mn[0], mx[2] - mn[2]), h = mx[1] - mn[1];
    if (h < opt.minH || h > opt.maxH || w < opt.minW || w > opt.maxW) continue;
    objects.push({ group, mn, mx });
  }
  // a stable order: by footprint position in the pack
  objects.sort((a, b) => a.mn[0] - b.mn[0] || a.mn[2] - b.mn[2]);
  for (const { group, mn, mx } of objects) {
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
    const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -mn[1], -cz, 1];
    const byKey = new Map();
    for (const { M, prims } of group) for (const src of prims) {
      const mat = src.getMaterial();
      const textured = !!mat?.getBaseColorTexture();
      const q = doc.createPrimitive().setMode(4);
      const pos = src.getAttribute('POSITION').clone();
      q.setAttribute('POSITION', pos);
      const nrm = src.getAttribute('NORMAL');
      if (nrm) q.setAttribute('NORMAL', nrm.clone());
      const n = pos.getCount();
      if (textured) {
        const uv = src.getAttribute(`TEXCOORD_${mat.getBaseColorTextureInfo()?.getTexCoord() ?? 0}`);
        q.setAttribute('TEXCOORD_0', uv ? uv.clone() : doc.createAccessor().setType('VEC2').setArray(new Float32Array(n * 2)));
        q.setMaterial(mat);
      } else {
        const f = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
        const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) c.set([f[0], f[1], f[2], 1], i * 4);
        q.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(c));
        q.setMaterial(flat);
      }
      if (src.getIndices()) q.setIndices(src.getIndices().clone());
      transformPrimitive(q, M);
      transformPrimitive(q, shift);
      if (!q.getAttribute('NORMAL')) continue;   // unlit or broken parts
      const key = `${q.getMaterial().getName()}|${q.listSemantics().sort().join(',')}|${q.getMaterial() === flat ? 'flat' : q.getMaterial().getName()}`;
      if (!byKey.has(q.getMaterial())) byKey.set(q.getMaterial(), new Map());
      const sub = byKey.get(q.getMaterial());
      if (!sub.has(key)) sub.set(key, []);
      sub.get(key).push(q);
    }
    const idx = (counts[kind] = (counts[kind] ?? -1) + 1);
    const name = `${kind}_${idx}`;
    const mesh = doc.createMesh(name);
    for (const sub of byKey.values()) for (const list of sub.values()) {
      // joinPrimitives wants all-indexed or all-unindexed
      const ix = list.filter((p) => p.getIndices()), nx = list.filter((p) => !p.getIndices());
      for (const l of [ix, nx]) if (l.length) mesh.addPrimitive(l.length > 1 ? joinPrimitives(l) : l[0]);
    }
    const node = doc.createNode(name).setMesh(mesh);
    node.setExtras({ size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].map((v) => Math.round(v * 10) / 10) });
    outScene.addChild(node);
    console.log(name.padEnd(12), 'size', node.getExtras().size.join(' x '), 'prims', mesh.listPrimitives().length, 'tris',
      mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0));
  }
  for (const s of doc.getRoot().listScenes()) if (s !== outScene) s.dispose();
  doc.getRoot().setDefaultScene(outScene);
  // scenery is seen from the air: no normal, occlusion or metal/rough maps
  for (const m of doc.getRoot().listMaterials()) {
    m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    m.setMetallicFactor(0).setRoughnessFactor(0.9);
  }
  await doc.transform(prune({ keepLeaves: false }));
  mergeDocuments(target, doc);
}

// one scene holding every object
const scenes = target.getRoot().listScenes();
const all = scenes[0];
for (const s of scenes.slice(1)) { for (const n of s.listChildren()) all.addChild(n); s.dispose(); }
target.getRoot().setDefaultScene(all);
target.getRoot().getAsset().extras = { title: 'CFS scenery (baked)', sources: credits, note: 'Objects separated, recentred and merged per material; normal/ORM maps removed; textures re-encoded.' };
await target.transform(dedup(), prune(), unpartition());
await io.write(output, target);
console.log('wrote', output, Object.entries(counts).map(([k, v]) => `${k} ×${v + 1}`).join(', '));
