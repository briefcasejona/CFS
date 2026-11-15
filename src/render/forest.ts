// Forests near the camera at a real forest's density: a tree every ~8 m wherever the landcover says forest, so the
// crowns close into a canopy instead of standing apart on a green floor. The trees live in cached 1 km tiles (built a
// tile a frame, nearest first), each one instanced mesh per species; a tile close to the camera draws full trees and
// casts shadows, one further out the same trees as simple crowns. The textured model trees (modelScenery.ts) take the
// innermost ring from the same tiles, so every range shows the same forest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, runwaysOf, fieldsNear, type TerrainPalette } from '../world/theater.js';
import { treeAt, type CoverGrid } from '../world/landcover.js';
import { hash2, NEAR_SCENERY, ringMaterial } from './scenery.js';

/** spacing (m) of the tree grid: one tree per cell, jittered across it */
export const TREE_CELL = 8;
const TILE = 1000, FULL_DIST = 1500, SHADOW_DIST = 700;
/** inner radius of the procedural trees: the model trees' radius while those are shown, else 0 */
export const treeInner = { value: 0 };

/** keep airfields clear of trees and houses */
export function nearRunway(x: number, z: number) {
  for (const ab of fieldsNear(x, z)) for (const rw of runwaysOf(ab)) {
    const dx = x - rw.x, dz = z - rw.z;
    if (!ab.kind) { if (Math.abs(dx) < rw.length / 2 + 1500 && Math.abs(dz) < rw.length / 2 + 1500) return true; continue; }
    // a civil field: the strip, its approaches and the terminal side, with the woods left standing around it
    const hr = rw.hdg * Math.PI / 180;
    if (Math.abs(dx * Math.sin(hr) - dz * Math.cos(hr)) < rw.length / 2 + 700 && Math.abs(dx * Math.cos(hr) + dz * Math.sin(hr)) < 750) return true;
  }
  return false;
}

/** per tree: x, ground height, z (world), size factor, turn (rad), species (0 conifer, 1 broadleaf) + a 0..1 shade */
const STRIDE = 6;
interface Tile { x0: number; z0: number; data: Float32Array; n: [number, number]; meshes: THREE.InstancedMesh[]; full: boolean; used: number }

function shade(g: THREE.BufferGeometry, f: (y: number) => number) {
  const pos = g.getAttribute('position'), c = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) c[k * 3] = c[k * 3 + 1] = c[k * 3 + 2] = f(pos.getY(k));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const plain = (g: THREE.BufferGeometry) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };

export class Forest {
  readonly group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private cover: CoverGrid | null = null;
  private frame = 0;
  /** [conifer, broadleaf] × [full, simple] */
  private geo: THREE.BufferGeometry[][];
  private mat: THREE.Material;
  /** bumped whenever a tile is added or dropped (the model trees re-pick then) */
  version = 0;

  constructor() {
    this.group.name = 'forest';
    // a spruce: trunk and four drooping tiers, darker towards the inside and the foot; ~16 m
    const tiers = [[4.0, 5.5, 2.6], [3.3, 5.0, 6.0], [2.5, 4.6, 9.4], [1.5, 4.2, 12.4]] as const;
    const conifer = mergeGeometries([
      shade(plain(new THREE.CylinderGeometry(0.28, 0.45, 3.2, 5, 1, true).translate(0, 1.6, 0)), () => 0.42),
      ...tiers.map(([r, h, y]) => shade(plain(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0)), (yy) => 0.62 + 0.38 * Math.min(1, (yy - y) / h + y / 16))),
    ])!;
    // a broadleaf: trunk and a crown of four lobes; ~14 m
    const lobes = [[0, 9.2, 0, 4.4], [2.3, 7.6, 0.8, 3.1], [-1.9, 7.9, 1.6, 3.2], [0.2, 7.4, -2.4, 3.0]] as const;
    const broadleaf = mergeGeometries([
      shade(plain(new THREE.CylinderGeometry(0.3, 0.5, 5.5, 5, 1, true).translate(0, 2.75, 0)), () => 0.45),
      ...lobes.map(([x, y, z, r]) => shade(plain(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.82, 1).translate(x, y, z)), (yy) => 0.58 + 0.42 * Math.min(1, Math.max(0, (yy - 4.5) / 8)))),
    ])!;
    // further out only the crown's outline counts
    const coniferFar = shade(plain(new THREE.ConeGeometry(3.8, 14, 5, 1, true).translate(0, 9, 0)), (yy) => 0.6 + 0.4 * Math.min(1, (yy - 2) / 14));
    const broadleafFar = shade(plain(new THREE.IcosahedronGeometry(4.6, 0).scale(1, 0.95, 1).translate(0, 8.6, 0)), (yy) => 0.58 + 0.42 * Math.min(1, Math.max(0, (yy - 4.5) / 8)));
    this.geo = [[conifer, coniferFar], [broadleaf, broadleafFar]];
    this.mat = ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), treeInner, NEAR_SCENERY);
  }

  clear() {
    for (const t of this.tiles.values()) this.drop(t);
    this.tiles.clear();
    this.version++;
  }
  /** the ground changed under a square (streamed elevation arrived): its trees are planted again */
  invalidate(x0: number, z0: number, x1: number, z1: number) {
    for (const [k, t] of this.tiles) if (t.x0 < x1 && t.x0 + TILE > x0 && t.z0 < z1 && t.z0 + TILE > z0) { this.drop(t); this.tiles.delete(k); this.version++; }
  }
  private drop(t: Tile) { for (const m of t.meshes) { this.group.remove(m); m.dispose(); } }

  /** show the tiles within reach of the camera, building up to `budget` missing ones */
  update(cam: THREE.Vector3, cover: CoverGrid, pal: TerrainPalette, on: boolean, budget = 1) {
    if (cover !== this.cover) { this.clear(); this.cover = cover; }
    this.frame++;
    this.group.visible = on;
    if (!on) return;
    const reach = NEAR_SCENERY;
    const i0 = Math.floor((cam.x - reach) / TILE), i1 = Math.floor((cam.x + reach) / TILE), j0 = Math.floor((cam.z - reach) / TILE), j1 = Math.floor((cam.z + reach) / TILE);
    const want: Array<[number, number, number]> = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(Math.max(0, Math.abs(cam.x - (i + 0.5) * TILE) - TILE / 2), Math.max(0, Math.abs(cam.z - (j + 0.5) * TILE) - TILE / 2));
      if (d < reach) want.push([d, i, j]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [d, i, j] of want) {
      const key = `${i},${j}`;
      let t = this.tiles.get(key);
      if (!t) {
        if (budget-- <= 0) continue;
        t = this.build(i, j, cover, pal);
        this.tiles.set(key, t);
        this.version++;
      }
      t.used = this.frame;
      // full trees close by; a little hysteresis so a tile on the boundary doesn't flip every frame
      const full = t.full ? d < FULL_DIST * 1.15 : d < FULL_DIST;
      if (full !== t.full) { t.full = full; t.meshes.forEach((m) => { m.geometry = this.geo[m.userData.kind as number][full ? 0 : 1]; }); }
      for (const m of t.meshes) { m.visible = true; m.castShadow = d < SHADOW_DIST; }
    }
    for (const [key, t] of this.tiles) {
      if (t.used === this.frame) continue;
      for (const m of t.meshes) m.visible = false;
      if (this.frame - t.used > 900) { this.drop(t); this.tiles.delete(key); this.version++; }
    }
  }

  private build(ti: number, tj: number, cover: CoverGrid, pal: TerrainPalette): Tile {
    const x0 = ti * TILE, z0 = tj * TILE, n = TILE / TREE_CELL, ci0 = Math.round(x0 / TREE_CELL), cj0 = Math.round(z0 / TREE_CELL);
    const buf = new Float32Array(n * n * STRIDE);
    const count: [number, number] = [0, 0];
    let k = 0;
    // a whole tile without forest (open farmland, sea, a town) is the common case: probe it coarsely first
    let any = false;
    for (let j = 0; j <= 20 && !any; j++) for (let i = 0; i <= 20; i++) if (treeAt(cover, x0 + i * TILE / 20, z0 + j * TILE / 20)) { any = true; break; }
    if (any) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const ci = ci0 + i, cj = cj0 + j, hsh = hash2(ci, cj);
      const x = (ci + hsh) * TREE_CELL, z = (cj + hash2(cj, ci)) * TREE_CELL;
      if (!treeAt(cover, x, z)) continue;
      const h = terrainHeight(x, z);
      if (h < 2 || h > pal.snowLine(x, z) - pal.rockBelowSnow - 150 || nearRunway(x, z)) continue;
      // stands of one species: conifers take over with height, broadleaf woods in the lowlands, mixed at the seams
      const stand = hash2(Math.floor(x / 260) + 91, Math.floor(z / 260) - 37) * 0.75 + hash2(ci + 3, cj - 5) * 0.25;
      const kind = stand < 0.35 + h / 1200 ? 0 : 1;
      buf[k] = x; buf[k + 1] = h; buf[k + 2] = z;
      buf[k + 3] = 0.72 + hash2(ci + 7, cj) * 0.62; buf[k + 4] = hsh * 6.283; buf[k + 5] = kind + hash2(ci - 11, cj + 4) * 0.999;
      k += STRIDE; count[kind]++;
    }
    const data = buf.slice(0, k);
    const meshes: THREE.InstancedMesh[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const kind of [0, 1]) {
      if (!count[kind]) continue;
      const im = new THREE.InstancedMesh(this.geo[kind][1], this.mat, count[kind]);
      let c = 0;
      for (let o = 0; o < k; o += STRIDE) {
        if (Math.floor(data[o + 5]) !== kind) continue;
        const sc = data[o + 3], v = data[o + 5] - kind;
        q.setFromAxisAngle(up, data[o + 4]);
        m.compose(p.set(data[o] - x0, data[o + 1] - 0.4, data[o + 2] - z0), q, s.set(sc * (0.9 + v * 0.25), sc, sc * (0.9 + v * 0.25)));
        im.setMatrixAt(c, m);
        im.setColorAt(c, kind === 0 ? col.setRGB(0.05 + v * 0.03, 0.105 + v * 0.04, 0.045 + v * 0.012) : col.setRGB(0.075 + v * 0.05, 0.14 + v * 0.05, 0.04 + v * 0.02));
        c++;
      }
      im.position.set(x0, 0, z0);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.userData.kind = kind;
      meshes.push(im); this.group.add(im);
    }
    return { x0, z0, data, n: count, meshes, full: false, used: this.frame };
  }

  /** every built tree within r of x, z: fn(x, ground height, z, size factor, turn, conifer, shade 0..1) */
  eachNear(cx: number, cz: number, r: number, fn: (x: number, h: number, z: number, size: number, rot: number, conifer: boolean, v: number) => void) {
    for (const t of this.tiles.values()) {
      if (t.x0 > cx + r || t.x0 + TILE < cx - r || t.z0 > cz + r || t.z0 + TILE < cz - r) continue;
      const d = t.data;
      for (let o = 0; o < d.length; o += STRIDE) {
        if ((d[o] - cx) ** 2 + (d[o + 2] - cz) ** 2 > r * r) continue;
        const kind = Math.floor(d[o + 5]);
        fn(d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4], kind === 0, d[o + 5] - kind);
      }
    }
  }
}
