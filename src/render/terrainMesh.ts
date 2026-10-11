import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, AIRBASES, OBJECTIVES, THEATER_HALF, fbm, terrainPalette, type TerrainPalette } from '../world/theater.js';
import { buildAirfield } from './airfield.js';

const CHUNK = 16000; // m
const LODS = [
  { dist: 18000, res: 96 },
  { dist: 45000, res: 48 },
  { dist: 100000, res: 20 },
  { dist: 260000, res: 8 },
];

const SNOW = new THREE.Color(0.9, 0.92, 0.95);

function terrainColor(h: number, slope: number, x: number, z: number, pal: TerrainPalette, out: THREE.Color) {
  const n = fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5;
  if (h <= 0.5) return out.setRGB(0.12, 0.2, 0.28);
  if (h < pal.beach) return out.setRGB(0.55, 0.52, 0.42);
  const snowLine = pal.snowLine(x, z);
  if (pal.style === 'desert' && slope <= 0.55 && h <= snowLine - pal.rockBelowSnow) {
    // sand, gravel plains and darker stony patches; a hint of green on the lowest river plains
    const g = fbm(x * 0.0025, z * 0.0025, 2);
    if (h < 25 && n > 0.62) return out.setRGB(0.38 + g * 0.05, 0.42 + g * 0.05, 0.26);
    const stony = n > 0.6 ? 0.82 : 1;
    return out.setRGB((0.70 + g * 0.06 + h * 0.00003) * stony, (0.60 + g * 0.05) * stony, (0.43 + g * 0.04) * stony);
  }
  if (slope > 0.55 || h > snowLine - pal.rockBelowSnow) {
    // ragged snow edge: the noise moves the line up and down by ~150 m
    const sl = snowLine + (n - 0.5) * 300;
    const snow = h > sl ? Math.min(1, (h - sl) / 300) : 0;
    out.setRGB(0.38 + n * 0.08, 0.36 + n * 0.06, 0.33 + n * 0.05);
    if (snow > 0) out.lerp(SNOW, snow);
    return out;
  }
  if (n > 0.55) return out.setRGB(0.16 + n * 0.05, 0.25 + n * 0.06, 0.13);
  const field = fbm(x * 0.003, z * 0.003, 2);
  return out.setRGB(0.32 + field * 0.08 + h * 0.00004, 0.36 + field * 0.06, 0.2 + h * 0.00003);
}

/** forest patches: the same noise that paints the dark-green forest colour in terrainColor */
function isForest(x: number, z: number) { return fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5 > 0.55; }

const TREE_CELL = 70, TREE_RADIUS = 5000, TREE_MAX = 12000;
/** deterministic 0..1 hash of an integer cell */
function hash2(i: number, j: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** keep airfields clear of trees */
function nearRunway(x: number, z: number) {
  for (const ab of AIRBASES) if (Math.abs(x - ab.x) < ab.length / 2 + 1500 && Math.abs(z - ab.z) < ab.length / 2 + 1500) return true;
  return false;
}

interface ChunkEntry { mesh: THREE.Mesh; lod: number; used: number }

/** Chunked LOD terrain with skirts. Geometry is generated lazily and cached. */
export class TerrainRenderer {
  group = new THREE.Group();
  private chunks = new Map<string, ChunkEntry>();
  private material: THREE.MeshLambertMaterial;
  private frame = 0;
  private buildBudget = 3;

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.group.name = 'terrain';
  }

  /** Drop every cached chunk (after a theater switch). */
  clear() {
    for (const e of this.chunks.values()) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.treeAt.set(Infinity, Infinity);
  }

  private buildChunk(ci: number, cj: number, res: number): THREE.Mesh {
    const x0 = -THEATER_HALF + ci * CHUNK;
    const z0 = -THEATER_HALF + cj * CHUNK;
    const n = res + 1;
    const step = CHUNK / res;
    const vcount = n * n + 4 * n;
    const pos = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = terrainHeight(x0 + i * step, z0 + j * step);
    const c = new THREE.Color();
    const pal = terrainPalette();
    let v = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = hs[j * n + i];
        const hx = hs[j * n + Math.min(n - 1, i + 1)] - hs[j * n + Math.max(0, i - 1)];
        const hz = hs[Math.min(n - 1, j + 1) * n + i] - hs[Math.max(0, j - 1) * n + i];
        const slope = Math.hypot(hx, hz) / (2 * step);
        pos[v * 3] = i * step; pos[v * 3 + 1] = Math.max(h, -2); pos[v * 3 + 2] = j * step;
        terrainColor(h, slope, x0 + i * step, z0 + j * step, pal, c);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        v++;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    // skirts hide cracks between LOD levels
    const drop = step * 0.6 + 20;
    const edges: number[][] = [
      Array.from({ length: n }, (_, i) => i),
      Array.from({ length: n }, (_, i) => (n - 1) * n + i),
      Array.from({ length: n }, (_, j) => j * n),
      Array.from({ length: n }, (_, j) => j * n + n - 1),
    ];
    for (let e = 0; e < 4; e++) {
      const base = v;
      for (const k of edges[e]) {
        pos[v * 3] = pos[k * 3]; pos[v * 3 + 1] = pos[k * 3 + 1] - drop; pos[v * 3 + 2] = pos[k * 3 + 2];
        col[v * 3] = col[k * 3]; col[v * 3 + 1] = col[k * 3 + 1]; col[v * 3 + 2] = col[k * 3 + 2];
        v++;
      }
      for (let t = 0; t < n - 1; t++) {
        const a = edges[e][t], b = edges[e][t + 1], a2 = base + t, b2 = base + t + 1;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(x0, 0, z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Update visible chunks around the camera. */
  update(camPos: THREE.Vector3, viewDist: number) {
    this.frame++;
    const nC = Math.ceil((2 * THEATER_HALF) / CHUNK);
    const want = new Map<string, number>();
    const maxDist = Math.min(viewDist, LODS[LODS.length - 1].dist);
    // only chunks that can be within view distance (large theaters have tens of thousands of chunks)
    const span = Math.ceil(maxDist / CHUNK) + 1;
    const ic = Math.floor((camPos.x + THEATER_HALF) / CHUNK), jc = Math.floor((camPos.z + THEATER_HALF) / CHUNK);
    for (let cj = Math.max(0, jc - span); cj <= Math.min(nC - 1, jc + span); cj++) {
      for (let ci = Math.max(0, ic - span); ci <= Math.min(nC - 1, ic + span); ci++) {
        const cx = -THEATER_HALF + (ci + 0.5) * CHUNK;
        const cz = -THEATER_HALF + (cj + 0.5) * CHUNK;
        const d = Math.max(0, Math.hypot(cx - camPos.x, cz - camPos.z) - CHUNK * 0.7);
        if (d > maxDist) continue;
        let lod = LODS.findIndex((l) => d < l.dist);
        if (lod < 0) lod = LODS.length - 1;
        want.set(`${ci},${cj}`, lod);
      }
    }
    let budget = this.buildBudget;
    const entries = [...want.entries()].sort((a, b) => a[1] - b[1]);
    for (const [key, lod] of entries) {
      const ex = this.chunks.get(key);
      if (ex && ex.lod === lod) { ex.used = this.frame; ex.mesh.visible = true; continue; }
      if (budget <= 0) { if (ex) { ex.used = this.frame; ex.mesh.visible = true; } continue; }
      budget--;
      const [ci, cj] = key.split(',').map(Number);
      const mesh = this.buildChunk(ci, cj, LODS[lod].res);
      if (ex) { this.group.remove(ex.mesh); ex.mesh.geometry.dispose(); }
      this.group.add(mesh);
      this.chunks.set(key, { mesh, lod, used: this.frame });
    }
    for (const [key, e] of this.chunks) {
      if (!want.has(key)) {
        e.mesh.visible = false;
        if (this.frame - e.used > 600) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); this.chunks.delete(key); }
      }
    }
  }

  /** Forest trees near the camera (instanced); rebuilt when the camera has moved ~1 km. */
  private trees: THREE.InstancedMesh | null = null;
  private treeAt = new THREE.Vector2(Infinity, Infinity);
  updateTrees(camPos: THREE.Vector3) {
    const agl = camPos.y - Math.max(0, terrainHeight(camPos.x, camPos.z));
    if (!this.trees) {
      // one merged low-poly conifer: trunk + two cones, ~16 m tall, origin at the foot
      const parts = [
        new THREE.CylinderGeometry(0.5, 0.7, 3, 5).translate(0, 1.5, 0),
        new THREE.ConeGeometry(4.2, 9, 6).translate(0, 7, 0),
        new THREE.ConeGeometry(3.0, 7, 6).translate(0, 12, 0),
      ];
      const geo = mergeGeometries(parts);
      this.trees = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x2d4a24 }), TREE_MAX);
      this.trees.frustumCulled = false;
      this.trees.count = 0;
      this.group.add(this.trees);
    }
    // invisible (and not worth rebuilding) above ~3000 m AGL
    this.trees.visible = agl < 3000 && terrainPalette().trees;
    if (!this.trees.visible || Math.hypot(camPos.x - this.treeAt.x, camPos.z - this.treeAt.y) < 1000) return;
    this.treeAt.set(camPos.x, camPos.z);
    const pal = terrainPalette();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const ci = Math.floor(camPos.x / TREE_CELL), cj = Math.floor(camPos.z / TREE_CELL), r = Math.ceil(TREE_RADIUS / TREE_CELL);
    let k = 0;
    for (let j = cj - r; j <= cj + r && k < TREE_MAX; j++) {
      for (let i = ci - r; i <= ci + r && k < TREE_MAX; i++) {
        const hsh = hash2(i, j);
        const x = (i + hsh) * TREE_CELL, z = (j + hash2(j, i)) * TREE_CELL;
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 > TREE_RADIUS * TREE_RADIUS) continue;
        if (!isForest(x, z)) continue;
        const h = terrainHeight(x, z);
        if (h < 2 || h > pal.snowLine(x, z) - pal.rockBelowSnow - 150 || nearRunway(x, z)) continue;
        const sc = 0.7 + hsh * 0.7;
        q.setFromAxisAngle(up, hsh * 6.283);
        m.compose(p.set(x, h - 0.5, z), q, s.set(sc, sc * (0.85 + hash2(i + 7, j) * 0.4), sc));
        this.trees.setMatrixAt(k++, m);
      }
    }
    this.trees.count = k;
    this.trees.instanceMatrix.needsUpdate = true;
  }

  /** Pre-build chunks around a point (during loading). */
  prewarm(p: THREE.Vector3, viewDist: number) {
    const old = this.buildBudget;
    this.buildBudget = 1000;
    this.update(p, viewDist);
    this.buildBudget = old;
  }
}

/** Static scenery: sea plane, runways, airbase buildings, city blocks. */
export function buildScenery(): THREE.Group {
  const g = new THREE.Group();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(THEATER_HALF * 6, THEATER_HALF * 6),
    new THREE.MeshLambertMaterial({ color: 0x1d3446 }),
  );
  sea.rotation.x = -Math.PI / 2;
  g.add(sea);

  const fields = AIRBASES.map((ab) => buildAirfield(ab));
  for (const fld of fields) g.add(fld.group);
  g.userData.airfields = fields;
  const cityMat = new THREE.MeshLambertMaterial({ color: 0x8a8378 });
  for (const o of OBJECTIVES) {
    if (o.kind !== 'city') continue;
    const count = 260;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const r = 2500 * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
      const hgt = 8 + Math.random() * (r < 800 ? 50 : 18);
      const w = 15 + Math.random() * 25;
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) + hgt / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, hgt, w));
      inst.setMatrixAt(i, m);
    }
    g.add(inst);
  }
  return g;
}

