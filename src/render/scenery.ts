// Scenery out to the horizon: towns and forests as cached tiles of instanced blocks and tree clumps beyond the
// detailed houses and trees that terrainMesh.ts places around the camera. Every instance is cut by its live distance
// from the camera in the vertex shader, so the detailed ring and the far tiles meet without a gap or a double row,
// however far the camera has moved since either was built.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, type TerrainPalette } from '../world/theater.js';
import { builtAt, coverAt, treeAt, type CoverGrid } from '../world/landcover.js';

/** radius (m) of the detailed houses and trees around the camera; the far tiles take over from here */
export const NEAR_SCENERY = 5000;
/** how far towns (and, to FAR_TREES, forests) are drawn */
export const FAR_HOUSES = 32000, FAR_TREES = 16000;
const TILE = 4000, HOUSE_CELL = 105, TREE_CELL = 75;

/** live camera position and ring radii, shared by every scenery material */
export const sceneryUniforms = {
  uCam: { value: new THREE.Vector3() },
};

/** A material whose instances only show between `inner` and `outer` metres (horizontal) from the camera. */
export function ringMaterial(mat: THREE.Material, inner: number, outer: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = sceneryUniforms.uCam;
    sh.vertexShader = 'uniform vec3 uCam;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 iw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dd = distance(iw.xz, uCam.xz);
        // collapsed to a point: nothing is rasterised
        if (dd < ${inner.toFixed(1)} || dd > ${outer.toFixed(1)}) transformed = vec3(0.0);
      #endif`);
  };
  mat.customProgramCacheKey = () => `ring${inner}-${outer}`;
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

interface Tile { meshes: THREE.InstancedMesh[]; used: number }

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
    const cone = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0).toNonIndexed();
    cone.deleteAttribute('uv');
    this.clumpGeo = mergeGeometries([paint(cone, () => [1, 1, 1])])!;
    this.blockMat = ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), NEAR_SCENERY, FAR_HOUSES);
    this.clumpMat = ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), NEAR_SCENERY, FAR_TREES);
  }

  clear() {
    for (const t of this.tiles.values()) for (const m of t.meshes) { this.group.remove(m); m.dispose(); }
    this.tiles.clear();
  }

  update(cam: THREE.Vector3, cover: CoverGrid, pal: TerrainPalette, agl: number) {
    if (cover !== this.cover) { this.clear(); this.cover = cover; }
    this.frame++;
    sceneryUniforms.uCam.value.copy(cam);
    // a town reads from far above; forests only from lower down
    const housesOn = agl < 14000, treesOn = agl < 7000 && pal.trees;
    const reach = housesOn ? FAR_HOUSES : treesOn ? FAR_TREES : 0;
    const ti0 = Math.floor((cam.x - reach) / TILE), ti1 = Math.floor((cam.x + reach) / TILE);
    const tj0 = Math.floor((cam.z - reach) / TILE), tj1 = Math.floor((cam.z + reach) / TILE);
    let budget = 3;
    // nearest tiles first, so the ring fills in from the inside
    const want: Array<[number, number, number]> = [];
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const dx = Math.max(0, Math.abs(cam.x - (ti + 0.5) * TILE) - TILE / 2), dz = Math.max(0, Math.abs(cam.z - (tj + 0.5) * TILE) - TILE / 2);
      const d = Math.hypot(dx, dz);
      if (d < reach) want.push([d, ti, tj]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const seen = new Set<string>();
    for (const [d, ti, tj] of want) {
      const key = `${ti},${tj}`;
      seen.add(key);
      let t = this.tiles.get(key);
      if (!t) {
        if (budget-- <= 0) continue;
        t = this.buildTile(ti, tj, cover, pal);
        this.tiles.set(key, t);
      }
      t.used = this.frame;
      for (const m of t.meshes) m.visible = m.userData.kind === 'block' ? housesOn && d < FAR_HOUSES : treesOn && d < FAR_TREES;
    }
    for (const [key, t] of this.tiles) {
      if (seen.has(key)) continue;
      for (const m of t.meshes) m.visible = false;
      if (this.frame - t.used > 1800) { for (const m of t.meshes) { this.group.remove(m); m.dispose(); } this.tiles.delete(key); }
    }
  }

  private buildTile(ti: number, tj: number, cover: CoverGrid, pal: TerrainPalette): Tile {
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    // town blocks
    {
      const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
      const n = TILE / HOUSE_CELL;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const ci = Math.round(ti * n) + i, cj = Math.round(tj * n) + j;
        const hsh = hash2(ci + 31, cj - 17);
        const x = (ci + 0.15 + hsh * 0.7) * HOUSE_CELL, z = (cj + 0.15 + hash2(cj - 17, ci + 31) * 0.7) * HOUSE_CELL;
        if (!builtAt(cover, x, z)) continue;
        const h = terrainHeight(x, z);
        if (h < 1.5) continue;
        const dense = coverAt(cover, x, z, 1);
        const core = dense > 0.6 && hsh > 0.5;
        const w = core ? 45 + hsh * 40 : 35 + hsh * 35, d = core ? 40 + hash2(ci, cj) * 35 : 30 + hash2(ci, cj) * 30;
        const ht = core ? 14 + hash2(cj, ci + 9) * (pal.style === 'desert' ? 10 : 26) : 6 + hash2(cj, ci + 9) * 5;
        q.setFromAxisAngle(up, (hash2(ci - 3, cj + 3) < 0.5 ? 0 : Math.PI / 2) + (hsh - 0.5) * 0.2);
        mats.push(m.compose(p.set(x, h - 0.5, z), q, s.set(w, ht, d)).clone());
        const v = hash2(ci + 5, cj + 5);
        cols.push(pal.style === 'desert' ? new THREE.Color(0.95 + v * 0.05, 0.88 + v * 0.06, 0.74 + v * 0.06) : new THREE.Color(0.86 + v * 0.14, 0.82 + v * 0.12, 0.78 + v * 0.12));
      }
      if (mats.length) meshes.push(this.instanced(this.blockGeo, this.blockMat, mats, cols, 'block'));
    }
    // tree clumps
    if (pal.trees) {
      const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
      const n = TILE / TREE_CELL;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const ci = Math.round(ti * n) + i, cj = Math.round(tj * n) + j;
        const hsh = hash2(ci - 51, cj + 23);
        const x = (ci + hsh) * TREE_CELL, z = (cj + hash2(cj + 23, ci - 51)) * TREE_CELL;
        if (!treeAt(cover, x, z)) continue;
        const h = terrainHeight(x, z);
        if (h < 2 || h > pal.snowLine(x, z) - pal.rockBelowSnow - 150) continue;
        const r = 9 + hsh * 7, ht = 15 + hash2(ci, cj + 1) * 9;
        mats.push(m.compose(p.set(x, h - 1, z), q.identity(), s.set(r, ht, r)).clone());
        const v = hash2(ci - 11, cj + 4);
        cols.push(col.setRGB(0.14 + v * 0.06, 0.23 + v * 0.07, 0.12 + v * 0.03).clone());
      }
      if (mats.length) meshes.push(this.instanced(this.clumpGeo, this.clumpMat, mats, cols, 'clump'));
    }
    for (const mm of meshes) this.group.add(mm);
    return { meshes, used: this.frame };
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cols: THREE.Color[], kind: string) {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, k) => { im.setMatrixAt(k, mm); im.setColorAt(k, cols[k]); });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();   // per tile: frustum culling drops the tiles behind the camera
    im.userData.kind = kind;
    return im;
  }
}
