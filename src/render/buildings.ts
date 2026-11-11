// Real buildings around the European airfields: every footprint from OpenStreetMap / Overture Maps (baked by
// scripts/terrain/bake-buildings.mjs), drawn where it stands — so towns sit exactly on the satellite imagery and the
// landcover. Inside these areas they replace the hash-placed houses; elsewhere the procedural towns stay.
//
// Each 50 km area loads on demand and is cut into 2 km tiles. A near tile (within NEAR_REAL) draws every building —
// small ones as houses with a pitched roof along their long side, the rest as flat-roofed blocks — and a far tile
// only its large buildings, out to the far scenery range. Facades get floors of windows in the shader.
import * as THREE from 'three';
import { gunzip } from '../world/demTheater.js';
import { terrainHeight, runwaysOf, AIRBASES, currentTheater } from '../world/theater.js';
import { hash2, FAR_HOUSES } from './scenery.js';
import { proceduralInner } from './modelScenery.js';

export const NEAR_REAL = 9000;
/** footprints under this (m²) are houses with a pitched roof (and model houses close in) */
export const HOUSE_AREA = 260;
const BASE = 'assets/theaters/europe/buildings';

interface PatchInfo { id: string; x0: number; z0: number; tile: number; T: number; count: number }
interface Patch extends PatchInfo { data?: DataView; offs?: Uint32Array; big?: Uint32Array; loading?: boolean }
interface Tile { near?: THREE.InstancedMesh[]; far?: THREE.InstancedMesh; used: number }
/** one decoded building, world frame */
export interface Building { x: number; z: number; w: number; d: number; rot: number; wall: number; h: number; area: number; seed: number }

const decSize = (v: number) => (v <= 200 ? v / 4 : 50 + (v - 200) * 6);
const decH = (v: number) => (v === 0 ? 0 : v <= 200 ? v / 4 : 50 + (v - 200) * 2);

/** pitched house: walls (with gable ends) and a roof whose ridge runs along x; aRoof marks the roof faces */
function houseGeometry(roofH: number) {
  const P: number[] = [], R: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], roof: number) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) R.push(roof); };
  const tri = (a: number[], b: number[], c: number[], roof: number) => { P.push(...a, ...b, ...c); R.push(roof, roof, roof); };
  const lo = -0.15, top = 1, h = 1 + roofH, o = 0.05;   // walls start below the ground for slopes; eaves overhang
  quad([-0.5, lo, 0.5], [0.5, lo, 0.5], [0.5, top, 0.5], [-0.5, top, 0.5], 0);
  quad([0.5, lo, -0.5], [-0.5, lo, -0.5], [-0.5, top, -0.5], [0.5, top, -0.5], 0);
  quad([0.5, lo, 0.5], [0.5, lo, -0.5], [0.5, top, -0.5], [0.5, top, 0.5], 0);
  quad([-0.5, lo, -0.5], [-0.5, lo, 0.5], [-0.5, top, 0.5], [-0.5, top, -0.5], 0);
  tri([0.5, top, 0.5], [0.5, top, -0.5], [0.5, h, 0], 0);
  tri([-0.5, top, -0.5], [-0.5, top, 0.5], [-0.5, h, 0], 0);
  quad([-0.5 - o, top - o * roofH * 2, 0.5 + o], [0.5 + o, top - o * roofH * 2, 0.5 + o], [0.5 + o, h, 0], [-0.5 - o, h, 0], 1);
  quad([0.5 + o, top - o * roofH * 2, -0.5 - o], [-0.5 - o, top - o * roofH * 2, -0.5 - o], [-0.5 - o, h, 0], [0.5 + o, h, 0], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aRoof', new THREE.Float32BufferAttribute(R, 1));
  g.computeVertexNormals();
  return g;
}

/** flat-roofed block, a parapet's worth of roof edge */
function blockGeometry() {
  const g = new THREE.BoxGeometry(1, 1.15, 1).translate(0, 0.425, 0).toNonIndexed();
  const n = g.getAttribute('normal'), R = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) R[i] = n.getY(i) > 0.5 ? 1 : 0;
  g.setAttribute('aRoof', new THREE.BufferAttribute(R, 1));
  g.deleteAttribute('uv');
  return g;
}

/** walls from the instance colour with floors of windows; roofs in tile, slate or bitumen by a per-building hash */
function buildingMaterial(pitched: boolean, inner: { value: number } | null) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRingIn = inner ?? { value: 0 };
    sh.uniforms.uCam2 = { value: new THREE.Vector3() };
    sh.vertexShader = `attribute float aRoof;
varying float vRoof; varying vec3 vLoc; varying vec3 vSize; varying float vSeed; varying vec3 vN;
uniform float uRingIn;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vRoof = aRoof; vLoc = position; vN = normal;
      #ifdef USE_INSTANCING
        vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 iw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vSeed = fract(sin(dot(iw.xz, vec2(12.9898, 78.233))) * 43758.5453);
        // houses inside the model ring are drawn by the model scenery instead
        if (distance(iw.xz, cameraPosition.xz) < uRingIn) transformed = vec3(0.0);
      #else
        vSize = vec3(1.0); vSeed = 0.5;
      #endif`);
    sh.fragmentShader = `varying float vRoof; varying vec3 vLoc; varying vec3 vSize; varying float vSeed; varying vec3 vN;
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      float winMask = 0.0;
      if (vRoof > 0.5) {
        ${pitched
          ? `vec3 rc = vSeed < 0.55 ? vec3(0.42, 0.17, 0.11) : vSeed < 0.8 ? vec3(0.2, 0.19, 0.2) : vec3(0.3, 0.12, 0.09);`
          : `vec3 rc = vSeed < 0.6 ? vec3(0.32, 0.32, 0.31) : vSeed < 0.85 ? vec3(0.23, 0.23, 0.24) : vec3(0.5, 0.5, 0.48);`}
        // tile courses on pitched roofs
        ${pitched ? 'rc *= 0.9 + 0.1 * step(0.5, fract(vLoc.y * vSize.y * 3.0));' : ''}
        diffuseColor.rgb = rc;
      } else {
        // metres along the wall and up from the ground
        float u = abs(vN.x) > 0.5 ? vLoc.z * vSize.z : vLoc.x * vSize.x;
        float v = vLoc.y * vSize.y;
        float storey = ${pitched ? '2.7' : '3.3'};
        float bay = ${pitched ? '2.4' : '3.0'} + vSeed * 0.6;
        vec2 cell = vec2(u / bay, (v - 0.9) / storey);
        vec2 f = fract(cell);
        float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.25, f.y) * step(f.y, 0.78);
        // no windows below the first sill or in the gable / parapet
        win *= step(0.0, cell.y) * step(v + 0.6, vSize.y);
        ${pitched ? '' : `// big low halls are sheds and warehouses: blank cladding with a band of high windows; a few blocks are blank
        float hall = step(1200.0, vSize.x * vSize.z) * step(vSize.y, 11.0);
        win *= step(0.2, vSeed) * step(5.0, vSize.y) * (1.0 - hall);
        if (hall > 0.5) {
          win = step(vSize.y - 1.6, v) * step(v, vSize.y - 0.9) * step(0.15, fract(u / 6.0));
          diffuseColor.rgb *= 0.93 + 0.07 * step(0.5, fract(u / 0.9));
        }`}
        // fade to the average far away instead of shimmering
        float fw = max(fwidth(cell.x), fwidth(cell.y));
        winMask = mix(win, 0.22, smoothstep(0.25, 0.6, fw));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.1, 0.13), winMask * 0.85);
        // plinth
        diffuseColor.rgb *= 0.8 + 0.2 * smoothstep(0.3, 0.6, v);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.12, winMask);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.6, winMask * 0.5);`);
  };
  mat.customProgramCacheKey = () => 'bld' + (pitched ? 'p' : 'f') + (inner ? 'r' : '');
  return mat;
}

/** keep the airfields' own buildings: no real ones on the bases the game lays out itself */
function onAirbase(x: number, z: number) {
  for (const ab of AIRBASES) for (const rw of runwaysOf(ab)) if (Math.abs(x - rw.x) < rw.length / 2 + 700 && Math.abs(z - rw.z) < rw.length / 2 + 700) return true;
  return false;
}

export class RealBuildings {
  readonly group = new THREE.Group();
  private patches: Patch[] = [];
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private tiles = new Map<string, Tile>();
  private frame = 0;
  private houseGeo = houseGeometry(0.6);
  private blockGeo = blockGeometry();
  private houseMat = buildingMaterial(true, proceduralInner);
  private blockMat = buildingMaterial(false, null);
  /** called once the area index is in (the hash towns inside the areas must be rebuilt without their houses) */
  onIndex: (() => void) | null = null;

  constructor() { this.group.name = 'real-buildings'; }

  get ready() { return this.state === 'ready'; }

  load() {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    fetch(`${BASE}/index.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((ix: { patches: PatchInfo[] }) => {
      this.patches = ix.patches.map((p) => ({ ...p }));
      this.state = 'ready';
      this.onIndex?.();
    }, (err) => { this.state = 'failed'; console.warn('Real buildings not available; procedural towns stay.', err); });
  }

  /** inside an area whose buildings are real (so no procedural houses there) */
  covers(x: number, z: number) {
    if (this.state !== 'ready' || currentTheater().id !== 'europe') return false;
    for (const p of this.patches) if (x >= p.x0 && z >= p.z0 && x < p.x0 + p.T * p.tile && z < p.z0 + p.T * p.tile) return true;
    return false;
  }

  private fetchPatch(p: Patch) {
    if (p.data || p.loading) return;
    p.loading = true;
    fetch(`${BASE}/${p.id}.bin.gz`).then((r) => (r.ok ? gunzip(r) : Promise.reject(new Error(String(r.status))))).then((buf) => {
      const dv = new DataView(buf), T = dv.getUint32(8, true), n = T * T;
      p.offs = new Uint32Array(buf.slice(16, 16 + (n + 1) * 4));
      p.big = new Uint32Array(buf.slice(16 + (n + 1) * 4, 16 + (n + 1) * 4 + n * 4));
      p.data = new DataView(buf, 16 + (n + 1) * 4 + n * 4);
      p.loading = false;
    }, (err) => { console.warn('buildings of', p.id, 'not available', err); });
  }

  /** decode buildings [from, to) of tile (ti, tj) */
  decode(p: Patch, ti: number, tj: number, from: number, to: number, out: Building[]) {
    const dv = p.data!, base = p.offs![tj * p.T + ti];
    for (let k = from; k < to; k++) {
      const o = (base + k) * 8;
      const x = p.x0 + ti * p.tile + dv.getUint16(o, true) / 20, z = p.z0 + tj * p.tile + dv.getUint16(o + 2, true) / 20;
      let w = decSize(dv.getUint8(o + 4)), d = decSize(dv.getUint8(o + 5));
      let rot = dv.getUint8(o + 6) / 256 * Math.PI;
      const hk = decH(dv.getUint8(o + 7)), area = w * d, seed = hash2(Math.round(x * 3), Math.round(z * 3));
      // the ridge runs along the long side (x of the geometry)
      if (d > w) { [w, d] = [d, w]; rot += Math.PI / 2; }
      let wall: number;
      if (area < HOUSE_AREA) wall = hk > 0 ? Math.max(2.6, hk / (1 + 0.6)) : 4.2 + seed * 2.6;
      else wall = hk > 0 ? Math.max(3, hk) : area < 1500 ? 6 + seed * 7 : 7 + seed * 6;
      out.push({ x, z, w, d, rot, wall, h: hk, area, seed });
    }
    return out;
  }

  /** the small (house-sized) buildings within r of a point, for the model scenery */
  housesNear(x: number, z: number, r: number) {
    const out: Building[] = [];
    if (this.state !== 'ready') return out;
    for (const p of this.patches) {
      if (!p.data) continue;
      const i0 = Math.max(0, Math.floor((x - r - p.x0) / p.tile)), i1 = Math.min(p.T - 1, Math.floor((x + r - p.x0) / p.tile));
      const j0 = Math.max(0, Math.floor((z - r - p.z0) / p.tile)), j1 = Math.min(p.T - 1, Math.floor((z + r - p.z0) / p.tile));
      for (let tj = j0; tj <= j1; tj++) for (let ti = i0; ti <= i1; ti++) {
        const k = tj * p.T + ti, all = this.decode(p, ti, tj, 0, p.offs![k + 1] - p.offs![k], []);
        for (const b of all) if (b.area < HOUSE_AREA && (b.x - x) ** 2 + (b.z - z) ** 2 < r * r && !onAirbase(b.x, b.z)) out.push(b);
      }
    }
    return out;
  }

  update(cam: THREE.Vector3, agl: number) {
    this.frame++;
    const on = this.state === 'ready' && currentTheater().id === 'europe' && agl < 14000;
    this.group.visible = on;
    if (!on) return;
    let budget = 2;
    const want: Array<[number, Patch, number, number]> = [];
    for (const p of this.patches) {
      const size = p.T * p.tile;
      const dx = Math.max(0, p.x0 - cam.x, cam.x - (p.x0 + size)), dz = Math.max(0, p.z0 - cam.z, cam.z - (p.z0 + size));
      if (Math.hypot(dx, dz) > FAR_HOUSES) continue;
      this.fetchPatch(p);
      if (!p.data) continue;
      for (let tj = 0; tj < p.T; tj++) for (let ti = 0; ti < p.T; ti++) {
        const cx = p.x0 + (ti + 0.5) * p.tile, cz = p.z0 + (tj + 0.5) * p.tile;
        const d = Math.max(0, Math.hypot(cx - cam.x, cz - cam.z) - p.tile * 0.71);
        if (d < FAR_HOUSES) want.push([d, p, ti, tj]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    const seen = new Set<string>();
    for (const [d, p, ti, tj] of want) {
      const key = `${p.id}:${ti},${tj}`;
      seen.add(key);
      let t = this.tiles.get(key);
      if (!t) this.tiles.set(key, t = { used: this.frame });
      t.used = this.frame;
      const near = d < NEAR_REAL;
      if (near && !t.near && budget > 0) { budget--; t.near = this.buildNear(p, ti, tj); }
      if (!near && !t.far && !t.near && budget > 0) { budget--; t.far = this.buildFar(p, ti, tj); }
      // a near tile already built keeps drawing until the far one exists, then its detail is freed
      if (!near && t.near && t.far) { for (const m of t.near) { this.group.remove(m); m.dispose(); } t.near = undefined; }
      const showNear = !!t.near && (near || !t.far);
      for (const m of t.near ?? []) m.visible = showNear;
      if (t.far) t.far.visible = !showNear;
    }
    for (const [key, t] of this.tiles) {
      if (seen.has(key)) continue;
      for (const m of t.near ?? []) m.visible = false;
      if (t.far) t.far.visible = false;
      if (this.frame - t.used > 900) { this.dispose(t); this.tiles.delete(key); }
    }
  }

  clear() { for (const t of this.tiles.values()) this.dispose(t); this.tiles.clear(); }

  private dispose(t: Tile) {
    for (const m of [...(t.near ?? []), ...(t.far ? [t.far] : [])]) { this.group.remove(m); m.dispose(); }
  }

  private buildNear(p: Patch, ti: number, tj: number) {
    const k = tj * p.T + ti, all = this.decode(p, ti, tj, 0, p.offs![k + 1] - p.offs![k], []).filter((b) => !onAirbase(b.x, b.z));
    return [this.instanced(all.filter((b) => b.area < HOUSE_AREA), this.houseGeo, this.houseMat), this.instanced(all.filter((b) => b.area >= HOUSE_AREA), this.blockGeo, this.blockMat)];
  }

  private buildFar(p: Patch, ti: number, tj: number) {
    const all = this.decode(p, ti, tj, 0, p.big![tj * p.T + ti], []).filter((b) => !onAirbase(b.x, b.z));
    return this.instanced(all, this.blockGeo, this.blockMat);
  }

  private instanced(list: Building[], geo: THREE.BufferGeometry, mat: THREE.Material) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    list.forEach((b, i) => {
      const ground = terrainHeight(b.x, b.z);
      m.compose(pos.set(b.x, ground - 0.3, b.z), q.setFromAxisAngle(up, b.rot), s.set(b.w, b.wall, b.d));
      im.setMatrixAt(i, m);
      const v = b.seed;
      // brick, plaster and render in the house tones of the region; offices and sheds lighter and greyer
      if (b.area < HOUSE_AREA) c.setRGB(...(v < 0.45 ? [0.55 + v * 0.2, 0.32 + v * 0.1, 0.25] : v < 0.8 ? [0.86, 0.82, 0.74] : [0.72, 0.68, 0.62]) as [number, number, number]);
      else c.setRGB(...(v < 0.5 ? [0.74, 0.74, 0.73] : v < 0.75 ? [0.62, 0.6, 0.57] : [0.66, 0.45, 0.36]) as [number, number, number]);
      im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true;
    this.group.add(im);
    return im;
  }
}

/** the one set the terrain and scenery consult */
export const realBuildings = new RealBuildings();
