// Scenery out to the horizon: towns and forests as cached tiles of instanced blocks and tree clumps beyond the
// detailed houses and trees that terrainMesh.ts places around the camera. Every instance is cut by its live distance
// from the camera in the vertex shader, so the detailed ring and the far tiles meet without a gap or a double row,
// however far the camera has moved since either was built.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, type TerrainPalette } from '../world/theater.js';
import { builtAt, coverAt, treeAt, type CoverGrid } from '../world/landcover.js';
import { realBuildings } from './buildings.js';
import { quality, workLeft } from './quality.js';

/** radius (m) of the detailed houses and trees around the camera; the far tiles take over from here */
export const NEAR_SCENERY = 5000;
/** how far towns (and, to FAR_TREES, forests) are drawn */
export const FAR_HOUSES = 32000, FAR_TREES = 16000;
const TILE = 4000, HOUSE_CELL = 105, TREE_CELL = 22;

/** live camera position and ring radii, shared by every scenery material */
export const sceneryUniforms = {
  uCam: { value: new THREE.Vector3() },
};

/** A material whose instances only show between `inner` and `outer` metres (horizontal) from the camera. Either radius
 *  can be a shared uniform ({ value }) to move the ring at run time (the detailed model ring takes over the inside). */
export function ringMaterial<M extends THREE.Material>(mat: M, inner: number | { value: number }, outer: number | { value: number }) {
  const uIn = typeof inner === 'number' ? { value: inner } : inner, uOut = typeof outer === 'number' ? { value: outer } : outer;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = sceneryUniforms.uCam;
    sh.uniforms.uRingIn = uIn;
    sh.uniforms.uRingOut = uOut;
    sh.vertexShader = 'uniform vec3 uCam;\nuniform float uRingIn;\nuniform float uRingOut;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 iw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dd = distance(iw.xz, uCam.xz);
        // collapsed to a point: nothing is rasterised
        if (dd < uRingIn || dd > uRingOut) transformed = vec3(0.0);
      #endif`);
  };
  mat.customProgramCacheKey = () => 'ring';
  return mat;
}

/** deterministic 0..1 hash of an integer cell */
export function hash2(i: number, j: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function paint(g: THREE.BufferGeometry, rgb: (y: number, ny: number) => [number, number, number]) {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const c = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    const [r, gr, b] = rgb(pos.getY(k), nrm ? nrm.getY(k) : 0);
    c[k * 3] = r; c[k * 3 + 1] = gr; c[k * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

interface Tile { meshes: THREE.InstancedMesh[]; used: number; stale?: boolean }
/** the outer radius of the far tree clumps (the quality level sets it) */
const clumpOuter = { value: FAR_TREES };

/**
 * Far towns and forests. A town block stands for a few houses (a lit wall box with a darker roof); a tree clump for a
 * stand of trees. Tiles are built once per theater, a few per frame, and drawn while they are within range.
 */
export class FarScenery {
  group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private blockGeo: THREE.BufferGeometry;
  private clumpGeo: THREE.BufferGeometry;
  private blockMat: THREE.Material;
  private clumpMat: THREE.Material;
  private frame = 0;
  private cover: CoverGrid | null = null;

  constructor() {
    this.group.name = 'far-scenery';
    // block: walls lit by the instance colour, roof (top face) a darker tile/slate
    this.blockGeo = paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed(), (_y, ny) => ny > 0.5 ? [0.55, 0.42, 0.38] : [0.85, 0.82, 0.78]);
    // (open: the base sits on the ground and is never seen — half the triangles of a closed cone)
    const cone = new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0).toNonIndexed();
    cone.deleteAttribute('uv');
    this.clumpGeo = mergeGeometries([paint(cone, () => [1, 1, 1])])!;
    this.blockMat = ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), NEAR_SCENERY, FAR_HOUSES);
    this.clumpMat = ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), NEAR_SCENERY, clumpOuter);
  }

  clear() {
    for (const t of this.tiles.values()) for (const m of t.meshes) { this.group.remove(m); m.dispose(); }
    this.tiles.clear();
  }

  /** the ground changed under these squares (streamed elevation arrived): their tiles are built again (the old ones
   *  show until then) */
  invalidate(rects: Array<{ x0: number; z0: number; x1: number; z1: number }>) {
    for (const [key, t] of this.tiles) {
      const [ti, tj] = key.split(',').map(Number), x0 = ti * TILE, z0 = tj * TILE;
      if (rects.some((r) => x0 < r.x1 && x0 + TILE > r.x0 && z0 < r.z1 && z0 + TILE > r.z0)) t.stale = true;
    }
    if (this.job && rects.some((r) => this.job!.x0 < r.x1 && this.job!.x0 + TILE > r.x0 && this.job!.z0 < r.z1 && this.job!.z0 + TILE > r.z0)) this.job = null;
  }

  private job: { key: string; x0: number; z0: number; it: Generator<void, THREE.InstancedMesh[]> } | null = null;

  update(cam: THREE.Vector3, cover: CoverGrid, pal: TerrainPalette, agl: number) {
    if (cover !== this.cover) { this.clear(); this.cover = cover; this.job = null; }
    this.frame++;
    sceneryUniforms.uCam.value.copy(cam);
    const q = quality.p;
    clumpOuter.value = q.clumpReach;
    // a town reads from far above; forests only from lower down
    const housesOn = agl < 14000, treesOn = agl < 7000 && pal.trees;
    const reach = housesOn ? FAR_HOUSES : treesOn ? q.clumpReach : 0;
    const ti0 = Math.floor((cam.x - reach) / TILE), ti1 = Math.floor((cam.x + reach) / TILE);
    const tj0 = Math.floor((cam.z - reach) / TILE), tj1 = Math.floor((cam.z + reach) / TILE);
    // nearest tiles first, so the ring fills in from the inside
    const want: Array<[number, number, number]> = [];
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const dx = Math.max(0, Math.abs(cam.x - (ti + 0.5) * TILE) - TILE / 2), dz = Math.max(0, Math.abs(cam.z - (tj + 0.5) * TILE) - TILE / 2);
      const d = Math.hypot(dx, dz);
      if (d < reach) want.push([d, ti, tj]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const seen = new Set<string>();
    let next: [number, number] | null = null;
    for (const [d, ti, tj] of want) {
      const key = `${ti},${tj}`;
      seen.add(key);
      const t = this.tiles.get(key);
      if ((!t || t.stale) && !next) next = [ti, tj];
      if (!t) continue;
      t.used = this.frame;
      for (const m of t.meshes) {
        if (m.userData.kind === 'block') { m.visible = housesOn && d < FAR_HOUSES; continue; }
        m.visible = treesOn && d < q.clumpReach;
        // beyond 6 km only a share of the clumps (they are stored in random order, so any prefix is an even thinning)
        m.count = d < 6000 ? m.userData.total : Math.max(1, Math.round(m.userData.total * q.clumpFar));
      }
    }
    // build the nearest missing (or outdated) tile in steps, in the time this frame has left
    if (this.job && !seen.has(this.job.key)) this.job = null;
    if (!this.job && next) {
      const [ti, tj] = next;
      this.job = { key: `${ti},${tj}`, x0: ti * TILE, z0: tj * TILE, it: this.tileSteps(ti, tj, cover, pal) };
    }
    for (let first = true; this.job && (first || workLeft()); first = false) {
      const r = this.job.it.next();
      if (!r.done) continue;
      const old = this.tiles.get(this.job.key);
      if (old) for (const m of old.meshes) { this.group.remove(m); m.dispose(); }
      for (const m of r.value) this.group.add(m);
      this.tiles.set(this.job.key, { meshes: r.value, used: this.frame });
      this.job = null;
    }
    for (const [key, t] of this.tiles) {
      if (seen.has(key)) continue;
      for (const m of t.meshes) m.visible = false;
      if (this.frame - t.used > 1800) { for (const m of t.meshes) { this.group.remove(m); m.dispose(); } this.tiles.delete(key); }
    }
  }

  /** a tile's blocks and clumps, built a few rows at a time (yields in between) */
  private *tileSteps(ti: number, tj: number, cover: CoverGrid, pal: TerrainPalette): Generator<void, THREE.InstancedMesh[]> {
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    // town blocks
    {
      const mats: number[] = [], cols: number[] = [];
      const n = TILE / HOUSE_CELL;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const ci = Math.round(ti * n) + i, cj = Math.round(tj * n) + j;
          const hsh = hash2(ci + 31, cj - 17);
          const x = (ci + 0.15 + hsh * 0.7) * HOUSE_CELL, z = (cj + 0.15 + hash2(cj - 17, ci + 31) * 0.7) * HOUSE_CELL;
          if (!builtAt(cover, x, z) || realBuildings.covers(x, z)) continue;
          const h = terrainHeight(x, z);
          if (h < 1.5) continue;
          const dense = coverAt(cover, x, z, 1);
          const core = dense > 0.6 && hsh > 0.5;
          const w = core ? 45 + hsh * 40 : 35 + hsh * 35, d = core ? 40 + hash2(ci, cj) * 35 : 30 + hash2(ci, cj) * 30;
          const ht = core ? 14 + hash2(cj, ci + 9) * (pal.style === 'desert' ? 10 : 26) : 6 + hash2(cj, ci + 9) * 5;
          q.setFromAxisAngle(up, (hash2(ci - 3, cj + 3) < 0.5 ? 0 : Math.PI / 2) + (hsh - 0.5) * 0.2);
          m.compose(p.set(x, h - 0.5, z), q, s.set(w, ht, d)).toArray(mats, mats.length);
          const v = hash2(ci + 5, cj + 5);
          if (pal.style === 'desert') cols.push(0.95 + v * 0.05, 0.88 + v * 0.06, 0.74 + v * 0.06);
          else cols.push(0.86 + v * 0.14, 0.82 + v * 0.12, 0.78 + v * 0.12);
        }
        if ((j & 7) === 7) yield;
      }
      if (mats.length) meshes.push(this.instanced(this.blockGeo, this.blockMat, mats, cols, 'block'));
    }
    // tree clumps
    if (pal.trees) {
      const mats: number[] = [], cols: number[] = [], rank: number[] = [];
      const n = TILE / TREE_CELL;
      q.identity();
      // a whole tile without forest is common: probe it coarsely first
      let any = false;
      for (let j = 0; j <= 20 && !any; j++) for (let i = 0; i <= 20; i++) if (treeAt(cover, ti * TILE + i * TILE / 20, tj * TILE + j * TILE / 20)) { any = true; break; }
      if (any) for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const ci = Math.round(ti * n) + i, cj = Math.round(tj * n) + j;
          const hsh = hash2(ci - 51, cj + 23);
          const x = (ci + hsh) * TREE_CELL, z = (cj + hash2(cj + 23, ci - 51)) * TREE_CELL;
          if (!treeAt(cover, x, z)) continue;
          const h = terrainHeight(x, z);
          if (h < 2 || h > pal.snowLine(x, z) - pal.rockBelowSnow - 150) continue;
          const r = 8 + hsh * 6, ht = 14 + hash2(ci, cj + 1) * 9;
          m.compose(p.set(x, h - 1, z), q, s.set(r, ht, r)).toArray(mats, mats.length);
          const v = hash2(ci - 11, cj + 4);
          cols.push(0.06 + v * 0.04, 0.12 + v * 0.045, 0.045 + v * 0.015);
          rank.push(hash2(ci + 77, cj - 91));
        }
        if ((j & 15) === 15) yield;
      }
      if (rank.length) {
        // random order, so drawing the first k of them thins the stand evenly
        const order = rank.map((_, k) => k).sort((a, b) => rank[a] - rank[b]);
        const mm: number[] = new Array(mats.length), cc: number[] = new Array(cols.length);
        order.forEach((o, k) => { for (let e = 0; e < 16; e++) mm[k * 16 + e] = mats[o * 16 + e]; for (let e = 0; e < 3; e++) cc[k * 3 + e] = cols[o * 3 + e]; });
        meshes.push(this.instanced(this.clumpGeo, this.clumpMat, mm, cc, 'clump'));
      }
    }
    return meshes;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: number[], cols: number[], kind: string) {
    const n = mats.length / 16;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.array.set(mats);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();   // per tile: frustum culling drops the tiles behind the camera
    im.userData.kind = kind;
    im.userData.total = n;
    im.visible = false;
    return im;
  }
}
