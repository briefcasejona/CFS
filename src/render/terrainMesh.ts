import * as THREE from 'three';
import { terrainHeight, AIRBASES, OBJECTIVES, THEATER_HALF, runwayEnds, fbm } from '../world/theater.js';

const CHUNK = 16000; // m
const LODS = [
  { dist: 18000, res: 96 },
  { dist: 45000, res: 48 },
  { dist: 100000, res: 20 },
  { dist: 260000, res: 8 },
];

function terrainColor(h: number, slope: number, x: number, z: number, out: THREE.Color) {
  const n = fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5;
  if (h <= 0.5) return out.setRGB(0.12, 0.2, 0.28);
  if (h < 8) return out.setRGB(0.55, 0.52, 0.42);
  if (slope > 0.55 || h > 1700) {
    const snow = h > 1900 ? Math.min(1, (h - 1900) / 300) : 0;
    out.setRGB(0.38 + n * 0.08, 0.36 + n * 0.06, 0.33 + n * 0.05);
    if (snow > 0) out.lerp(new THREE.Color(0.9, 0.92, 0.95), snow);
    return out;
  }
  if (n > 0.55) return out.setRGB(0.16 + n * 0.05, 0.25 + n * 0.06, 0.13);
  const field = fbm(x * 0.003, z * 0.003, 2);
  return out.setRGB(0.32 + field * 0.08 + h * 0.00004, 0.36 + field * 0.06, 0.2 + h * 0.00003);
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
    let v = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = hs[j * n + i];
        const hx = hs[j * n + Math.min(n - 1, i + 1)] - hs[j * n + Math.max(0, i - 1)];
        const hz = hs[Math.min(n - 1, j + 1) * n + i] - hs[Math.max(0, j - 1) * n + i];
        const slope = Math.hypot(hx, hz) / (2 * step);
        pos[v * 3] = i * step; pos[v * 3 + 1] = Math.max(h, -2); pos[v * 3 + 2] = j * step;
        terrainColor(h, slope, x0 + i * step, z0 + j * step, c);
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

  const rwyTex = makeRunwayTexture();
  for (const ab of AIRBASES) {
    const len = ab.length, wid = 45;
    const hr = ab.hdg * Math.PI / 180;
    const rwy = new THREE.Mesh(new THREE.PlaneGeometry(wid, len),
      new THREE.MeshLambertMaterial({ map: rwyTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    rwy.rotation.order = 'YXZ';
    rwy.rotation.set(-Math.PI / 2, -hr, 0);
    rwy.position.set(ab.x, ab.elev + 0.15, ab.z);
    g.add(rwy);
    const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
    const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(300, len * 0.5),
      new THREE.MeshLambertMaterial({ color: 0x55585a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    apron.rotation.order = 'YXZ';
    apron.rotation.set(-Math.PI / 2, -hr, 0);
    apron.position.set(ab.x + side.x * 260, ab.elev + 0.1, ab.z + side.z * 260);
    g.add(apron);
    const hangarMat = new THREE.MeshLambertMaterial({ color: ab.side === 'blue' ? 0x7d8278 : 0x7a7466 });
    for (let k = -3; k <= 3; k++) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 36), hangarMat);
      h.position.copy(new THREE.Vector3(ab.x, ab.elev + 7, ab.z).addScaledVector(side, 470).addScaledVector(fwd, k * 90));
      h.rotation.y = -hr;
      g.add(h);
    }
    const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 30, 10), new THREE.MeshLambertMaterial({ color: 0xbbbbaa }));
    tower.position.copy(new THREE.Vector3(ab.x, ab.elev + 15, ab.z).addScaledVector(side, 380).addScaledVector(fwd, -len * 0.35));
    g.add(tower);
    const ends = runwayEnds(ab);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });
    for (const [e, out] of [[ends.start, -1], [ends.end, 1]] as const) {
      for (let k = 1; k <= 10; k++) {
        const lx = e.x + fwd.x * out * k * 30, lz = e.z + fwd.z * out * k * 30;
        const l = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 1.5), lightMat);
        l.position.set(lx, terrainHeight(lx, lz) + 0.6, lz);
        l.rotation.y = -hr;
        g.add(l);
      }
    }
  }
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

function makeRunwayTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 1024;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#3b3d3f'; x.fillRect(0, 0, 64, 1024);
  x.fillStyle = '#dcdcd2';
  for (let y = 40; y < 984; y += 40) x.fillRect(31, y, 2, 20);
  for (let k = 0; k < 6; k++) {
    x.fillRect(4 + k * 4, 6, 2, 30); x.fillRect(36 + k * 4, 6, 2, 30);
    x.fillRect(4 + k * 4, 988, 2, 30); x.fillRect(36 + k * 4, 988, 2, 30);
  }
  x.fillRect(1, 0, 1, 1024); x.fillRect(62, 0, 1, 1024);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
