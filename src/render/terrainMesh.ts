import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainHeight, runwaysOf, AIRBASES, OBJECTIVES, THEATER_HALF, fbm, terrainPalette, currentTheater, type TerrainPalette } from '../world/theater.js';
import { buildAirfield } from './airfield.js';
import { coverAt, coverOf, detailNoise, DETAIL_N, PATCH, treeAt, builtAt, type CoverGrid } from '../world/landcover.js';
import { FarScenery, hash2, NEAR_SCENERY, ringMaterial } from './scenery.js';
import { Imagery, IMAGERY_GLSL, mercator } from './imagery.js';

const CHUNK = 16000; // m
const LODS = [
  { dist: 6000, res: 192 },     // ~83 m spacing close in: ridges and valleys read properly at low level
  { dist: 18000, res: 112 },
  { dist: 45000, res: 48 },
  { dist: 100000, res: 20 },
  { dist: 260000, res: 8 },
];

const SNOW = new THREE.Color(0.9, 0.92, 0.95);

/** Ground colour from height and slope, and how much the landcover (forest, fields, towns, water — painted per pixel
 *  in the shader) shows over it: none on sea, beaches, rock and snow. Only gentle, low-frequency variation lives here,
 *  so a chunk looks the same at every level of detail; the fine patterns come from textures in the shader. */
function terrainColor(h: number, slope: number, x: number, z: number, pal: TerrainPalette, out: THREE.Color): number {
  const n = fbm(x * 0.0007, z * 0.0007, 3) * 0.5 + 0.5;
  if (h <= 0.5) { out.setRGB(0.12, 0.2, 0.28); return 0; }
  if (h < pal.beach) { out.setRGB(0.55, 0.52, 0.42); return 0; }
  const snowLine = pal.snowLine(x, z);
  if (pal.style === 'desert' && slope <= 0.55 && h <= snowLine - pal.rockBelowSnow) {
    // sand, gravel plains and darker stony patches
    const stony = n > 0.6 ? 0.82 : 1;
    out.setRGB((0.70 + n * 0.04 + h * 0.00003) * stony, (0.60 + n * 0.03) * stony, (0.43 + n * 0.03) * stony);
    return 1;
  }
  if (slope > 0.55 || h > snowLine - pal.rockBelowSnow) {
    // ragged snow edge: the noise moves the line up and down by ~150 m
    const sl = snowLine + (n - 0.5) * 300;
    const snow = h > sl ? Math.min(1, (h - sl) / 300) : 0;
    out.setRGB(0.38 + n * 0.08, 0.36 + n * 0.06, 0.33 + n * 0.05);
    if (snow > 0) out.lerp(SNOW, snow);
    // the landcover fades out over the last stretch below the rock line instead of ending at a hard edge
    return slope > 0.55 ? 0 : Math.max(0, 1 - (h - (snowLine - pal.rockBelowSnow)) / 150);
  }
  // meadow and pasture; a little drier and paler higher up
  out.setRGB(0.31 + n * 0.05 + h * 0.00004, 0.37 + n * 0.04, 0.2 + h * 0.00003);
  return 1;
}

// the detailed ring is built 1 km wider than it is drawn (it is rebuilt every km); FarScenery takes over beyond
const TREE_CELL = 38, TREE_RADIUS = NEAR_SCENERY + 1000, TREE_MAX = 48000;
const HOUSE_CELL = 42, HOUSE_RADIUS = NEAR_SCENERY + 1000, HOUSE_MAX = 30000;
/** keep airfields clear of trees and houses */
function nearRunway(x: number, z: number) {
  for (const ab of AIRBASES) for (const rw of runwaysOf(ab)) if (Math.abs(x - rw.x) < rw.length / 2 + 1500 && Math.abs(z - rw.z) < rw.length / 2 + 1500) return true;
  return false;
}

/** the shared tiling noise (landcover.ts) as a texture: patch shapes far out, soil and grass grain close in */
function detailTexture() {
  const N = DETAIL_N, d = detailNoise(), rgba = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) { rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = d[k]; rgba[k * 4 + 3] = 255; }
  const t = new THREE.DataTexture(rgba, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function coverTexture(g: CoverGrid) {
  const t = new THREE.DataTexture(g.data, g.n, g.n);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Per-pixel ground: vertex colours carry height/slope colour (aCover.x = how much landcover shows, aCover.y = the
 *  slope shading), and the fragment shader paints forests, field patchworks, towns and lakes from the theater's cover
 *  grid. Being per pixel, none of it changes when a chunk swaps its level of detail. */
function addGroundShader(mat: THREE.MeshLambertMaterial, uniforms: Record<string, THREE.IUniform>) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `attribute vec2 aCover;\nattribute vec2 aMerc;\nvarying vec2 vCover;\nvarying vec2 vMerc;\nvarying vec3 vWorldPos;\n` + sh.vertexShader.replace('#include <worldpos_vertex>',
      `#include <worldpos_vertex>\n vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vCover = aCover;\n vMerc = aMerc;`);
    sh.fragmentShader = `uniform sampler2D uDetail;\nuniform sampler2D uCover;\nuniform vec3 uCoverGrid;\nvarying vec2 vCover;\nvarying vec3 vWorldPos;
float patchN(vec2 p, float s, float o) {
  float a = texture2D(uDetail, p / s + o).r, b = texture2D(uDetail, p / (s * 0.37) + o * 1.7).r;
  return clamp((a * 0.65 + b * 0.35 - 0.5) * 1.36 + 0.5, 0.0, 1.0);
}
float coverMask(float f, float n) { return smoothstep(-0.06, 0.06, f - (1.0 - n)) * smoothstep(0.0, 0.05, f); }
float hash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
${IMAGERY_GLSL}
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float dist = length(vWorldPos - cameraPosition);
      vec2 p = vWorldPos.xz;
      if (vCover.x > 0.01) {
        vec4 lc = texture2D(uCover, ((p + uCoverGrid.x) / uCoverGrid.y + 0.5) / uCoverGrid.z);
        // crisp patches near by; far out the fractions blend smoothly (the noise would only alias there)
        float far = smoothstep(7000.0, 30000.0, dist);
        float mT = mix(coverMask(lc.r, patchN(p, ${PATCH.tree[0]}.0, ${PATCH.tree[1]})), lc.r, far);
        float mB = mix(coverMask(lc.g, patchN(p, ${PATCH.built[0]}.0, ${PATCH.built[1]})), lc.g, far);
        float mC = mix(coverMask(lc.b, patchN(p, ${PATCH.crop[0]}.0, ${PATCH.crop[1]})), lc.b, far);
        float mW = smoothstep(0.42, 0.58, lc.a);
        // fields: a warped patchwork of wheat, ploughed soil and green crops
        // (each 7 km district turns its grid a little and the parcel edges bend, so it doesn't read as one endless grid)
        vec2 dc = floor(p / 7000.0);
        float fa = (hash(dc + 3.1) - 0.5) * 1.4;
        vec2 lp = p - dc * 7000.0;
        vec2 fp = mat2(cos(fa), sin(fa), -sin(fa), cos(fa)) * lp + dc * 131.0 + (vec2(texture2D(uDetail, p / 1900.0).r, texture2D(uDetail, p / 1700.0 + 0.5).r) - 0.5) * 70.0;
        float fh = hash(floor(fp / vec2(330.0, 210.0)));
        vec3 cropC = (fh < 0.25 ? vec3(0.56, 0.5, 0.3) : fh < 0.5 ? vec3(0.4, 0.32, 0.22) : fh < 0.8 ? vec3(0.3, 0.4, 0.17) : vec3(0.45, 0.48, 0.24)) * (0.9 + 0.2 * fract(fh * 13.0));
        cropC = mix(cropC, vec3(0.42, 0.42, 0.24), smoothstep(9000.0, 30000.0, dist));
        // towns: roofs (grey, red tile) on blocks between streets
        vec2 bc = floor(p / 48.0), bp = fract(p / 48.0);
        float street = step(0.8, max(bp.x, bp.y));
        float rh = hash(bc + 7.0);
        vec3 builtC = mix(mix(vec3(0.47, 0.45, 0.42), vec3(0.5, 0.43, 0.39), step(0.5, rh)) * (0.88 + 0.24 * hash(bc)), vec3(0.36, 0.36, 0.37), street);
        builtC = mix(builtC, vec3(0.46, 0.42, 0.39), smoothstep(3000.0, 14000.0, dist));
        vec3 treeC = vec3(0.12, 0.19, 0.1) * (0.85 + 0.3 * texture2D(uDetail, p / 160.0).r);
        vec3 g = diffuseColor.rgb;
        // meadows and pasture: parcels of slightly different greens (the field grid, offset)
        float gh = hash(floor((fp + 97.0) / vec2(250.0, 160.0)));
        g *= mix(vec3(0.86 + 0.22 * gh, 0.9 + 0.16 * gh, 0.85 + 0.2 * fract(gh * 7.0)), vec3(1.0), smoothstep(6000.0, 20000.0, dist));
        g = mix(g, cropC, mC);
        g = mix(g, treeC, mT);
        g = mix(g, builtC, mB);
        g = mix(g, vec3(0.12, 0.2, 0.28), mW);
        diffuseColor.rgb = mix(diffuseColor.rgb, g, vCover.x);
      }
      // satellite imagery over land (real-world theaters); the sea keeps its own colour
      if (vWorldPos.y > -1.0) { float icov; vec3 ic = imagery(diffuseColor.rgb, icov); diffuseColor.rgb = ic; }
      diffuseColor.rgb *= vCover.y;
      float fine = texture2D(uDetail, p / 45.0).r;
      float coarse = texture2D(uDetail, p / 420.0).r;
      float fade = 1.0 - smoothstep(1500.0, 9000.0, dist);
      float fadeC = 1.0 - smoothstep(6000.0, 40000.0, dist);
      diffuseColor.rgb *= mix(1.0, 0.88 + 0.24 * fine, 0.5 * fade) * mix(1.0, 0.9 + 0.2 * coarse, 0.6 * fadeC);`);
  };
  mat.customProgramCacheKey = () => 'cfs-terrain-ground';
}

interface ChunkEntry { mesh: THREE.Mesh; lod: number; used: number }

/** Chunked LOD terrain with skirts. Geometry is generated lazily and cached. */
export class TerrainRenderer {
  group = new THREE.Group();
  private chunks = new Map<string, ChunkEntry>();
  readonly imagery = new Imagery();
  private material: THREE.MeshLambertMaterial;
  private frame = 0;
  private buildBudget = 3;
  private uniforms: Record<string, THREE.IUniform> = {
    uDetail: { value: detailTexture() },
    uCover: { value: null },
    uCoverGrid: { value: new THREE.Vector3() },  // half, res, n
    ...this.imagery.uniforms,
  };
  private cover: CoverGrid | null = null;

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    addGroundShader(this.material, this.uniforms);
    this.group.name = 'terrain';
    this.group.add(this.far.group);
  }

  /** the active theater's cover grid, uploaded as a texture when it changes */
  private syncCover(): CoverGrid {
    const g = coverOf(currentTheater());
    if (g !== this.cover) {
      this.cover = g;
      (this.uniforms.uCover.value as THREE.Texture | null)?.dispose();
      this.uniforms.uCover.value = coverTexture(g);
      (this.uniforms.uCoverGrid.value as THREE.Vector3).set(g.half, g.res, g.n);
    }
    return g;
  }

  /** Drop every cached chunk (after a theater switch). */
  clear() {
    for (const e of this.chunks.values()) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.treeAt.set(Infinity, Infinity);
    this.houseAt.set(Infinity, Infinity);
    this.far.clear();
  }

  private buildChunk(ci: number, cj: number, res: number): THREE.Mesh {
    const x0 = -THEATER_HALF + ci * CHUNK;
    const z0 = -THEATER_HALF + cj * CHUNK;
    const n = res + 1;
    const step = CHUNK / res;
    const vcount = n * n + 4 * n;
    const pos = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const cov = new Float32Array(vcount * 2);
    const merc = new Float32Array(vcount * 2);
    const geoOf = currentTheater().geo, mp = { x: 0, y: 0 };
    const nrm = new Float32Array(vcount * 3);
    // heights with a one-sample border from the neighbouring chunks: slopes, colours and normals at the chunk edges
    // then match the neighbour's exactly, so no seam line shows where two chunks meet
    const m = n + 2;
    const hs = new Float32Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) hs[j * m + i] = terrainHeight(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const H = (i: number, j: number) => hs[(j + 1) * m + i + 1];
    const c = new THREE.Color();
    const pal = terrainPalette();
    let v = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = H(i, j);
        // (the sea floor is drawn flat at -2 m, so its normal is up)
        const hx = Math.max(H(i + 1, j), -2) - Math.max(H(i - 1, j), -2);
        const hz = Math.max(H(i, j + 1), -2) - Math.max(H(i, j - 1), -2);
        const slope = Math.hypot(hx, hz) / (2 * step);
        pos[v * 3] = i * step; pos[v * 3 + 1] = Math.max(h, -2); pos[v * 3 + 2] = j * step;
        const nl = Math.hypot(hx, 2 * step, hz);
        nrm[v * 3] = -hx / nl; nrm[v * 3 + 1] = 2 * step / nl; nrm[v * 3 + 2] = -hz / nl;
        cov[v * 2] = terrainColor(h, slope, x0 + i * step, z0 + j * step, pal, c);
        // steeper ground a little darker: cheap ambient occlusion that gives the relief depth
        cov[v * 2 + 1] = h > 0.5 ? 1 - 0.22 * Math.min(1, slope * 1.6) : 1;
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        if (geoOf) {
          const ll = geoOf(x0 + i * step, z0 + j * step);
          mercator(ll.lat, ll.lon, mp);
          merc[v * 2] = mp.x; merc[v * 2 + 1] = mp.y;
        }
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
        // the skirt is shaded like the edge it hangs from: where it shows through a crack it reads as ground
        for (let a = 0; a < 3; a++) { pos[v * 3 + a] = pos[k * 3 + a]; col[v * 3 + a] = col[k * 3 + a]; nrm[v * 3 + a] = nrm[k * 3 + a]; }
        cov[v * 2] = cov[k * 2]; cov[v * 2 + 1] = cov[k * 2 + 1];
        merc[v * 2] = merc[k * 2]; merc[v * 2 + 1] = merc[k * 2 + 1];
        pos[v * 3 + 1] -= drop;
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
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aCover', new THREE.BufferAttribute(cov, 2));
    geo.setAttribute('aMerc', new THREE.BufferAttribute(merc, 2));
    geo.setIndex(idx);
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
    this.syncCover();
    this.imagery.update(camPos, currentTheater().geo ?? null);
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
        // hysteresis: a chunk keeps its level until the camera is well past the boundary, so flying along a boundary
        // doesn't swap it back and forth (each swap is a visible pop)
        const key = `${ci},${cj}`, ex = this.chunks.get(key);
        if (ex && Math.abs(ex.lod - lod) === 1 && Math.abs(d - LODS[Math.min(ex.lod, lod)].dist) < LODS[Math.min(ex.lod, lod)].dist * 0.12) lod = ex.lod;
        want.set(key, lod);
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

  /** Forest trees and town houses near the camera (instanced), placed on the patches the ground shader paints as
   *  forest and built-up land; each set is rebuilt when the camera has moved ~1 km. */
  private trees: THREE.InstancedMesh[] = [];
  private treeAt = new THREE.Vector2(Infinity, Infinity);
  private houses: THREE.InstancedMesh | null = null;
  private houseAt = new THREE.Vector2(Infinity, Infinity);
  private pitchedHouse: THREE.BufferGeometry | null = null;
  private far = new FarScenery();
  private flatHouse: THREE.BufferGeometry | null = null;
  updateTrees(camPos: THREE.Vector3) {
    const agl = camPos.y - Math.max(0, terrainHeight(camPos.x, camPos.z));
    const cover = this.syncCover();
    if (!this.trees.length) {
      // two merged low-poly trees, origin at the foot: a ~16 m conifer and a ~13 m broadleaf
      const conifer = mergeGeometries([
        new THREE.CylinderGeometry(0.5, 0.7, 3, 5).translate(0, 1.5, 0),
        new THREE.ConeGeometry(4.2, 9, 6).translate(0, 7, 0),
        new THREE.ConeGeometry(3.0, 7, 6).translate(0, 12, 0),
      ]);
      const broadleaf = mergeGeometries([
        new THREE.CylinderGeometry(0.45, 0.65, 5, 5).translate(0, 2.5, 0).toNonIndexed(),
        new THREE.IcosahedronGeometry(4.6, 0).scale(1, 0.85, 1).translate(0, 8.4, 0),
      ]);
      for (const geo of [conifer, broadleaf]) {
        const m = new THREE.InstancedMesh(geo, ringMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), 0, NEAR_SCENERY), TREE_MAX);
        m.frustumCulled = false;
        m.count = 0;
        this.trees.push(m);
        this.group.add(m);
      }
      // a house: walls and a pitched roof, coloured per vertex (the instance colour tints both)
      const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const roof = new THREE.CylinderGeometry(0.72, 0.72, 1.04, 3, 1).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 1.2, 0);
      const paint = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
        const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) { c[k * 3] = r; c[k * 3 + 1] = gr; c[k * 3 + 2] = b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        return g;
      };
      const house = mergeGeometries([paint(walls.toNonIndexed(), 0.82, 0.78, 0.72), paint(roof.toNonIndexed(), 0.55, 0.3, 0.24)]);
      // desert towns: flat roofs
      this.flatHouse = paint(walls.clone().toNonIndexed(), 0.82, 0.78, 0.72);
      this.pitchedHouse = house;
      this.houses = new THREE.InstancedMesh(house, ringMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 0, NEAR_SCENERY), HOUSE_MAX);
      this.houses.frustumCulled = false;
      this.houses.count = 0;
      this.group.add(this.houses);
    }
    const pal = terrainPalette();
    this.far.update(camPos, cover, pal, agl);
    // invisible (and not worth rebuilding) higher up, where the far tiles alone carry the scene
    const treesOn = agl < 3500 && pal.trees;
    for (const t of this.trees) t.visible = treesOn;
    this.houses!.visible = agl < 5000;
    if (treesOn && Math.hypot(camPos.x - this.treeAt.x, camPos.z - this.treeAt.y) > 1000) {
      this.treeAt.set(camPos.x, camPos.z);
      this.placeTrees(camPos, cover, pal);
    }
    if (this.houses!.visible && Math.hypot(camPos.x - this.houseAt.x, camPos.z - this.houseAt.y) > 1000) {
      this.houseAt.set(camPos.x, camPos.z);
      this.placeHouses(camPos, cover, pal);
    }
  }

  private placeTrees(camPos: THREE.Vector3, cover: CoverGrid, pal: TerrainPalette) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const ci = Math.floor(camPos.x / TREE_CELL), cj = Math.floor(camPos.z / TREE_CELL), r = Math.ceil(TREE_RADIUS / TREE_CELL);
    const k = [0, 0];
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const hsh = hash2(i, j);
        const x = (i + hsh) * TREE_CELL, z = (j + hash2(j, i)) * TREE_CELL;
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 > TREE_RADIUS * TREE_RADIUS) continue;
        if (!treeAt(cover, x, z)) continue;
        const h = terrainHeight(x, z);
        if (h < 2 || h > pal.snowLine(x, z) - pal.rockBelowSnow - 150 || nearRunway(x, z)) continue;
        // conifers take over with height; broadleaf woods in the lowlands
        const kind = hash2(i + 3, j - 5) < 0.35 + h / 1200 ? 0 : 1;
        if (k[kind] >= TREE_MAX) continue;
        const sc = 0.7 + hsh * 0.7;
        q.setFromAxisAngle(up, hsh * 6.283);
        m.compose(p.set(x, h - 0.5, z), q, s.set(sc, sc * (0.85 + hash2(i + 7, j) * 0.4), sc));
        this.trees[kind].setMatrixAt(k[kind], m);
        const v = hash2(i - 11, j + 4);
        this.trees[kind].setColorAt(k[kind], kind === 0 ? col.setRGB(0.15 + v * 0.05, 0.25 + v * 0.06, 0.13) : col.setRGB(0.2 + v * 0.1, 0.32 + v * 0.08, 0.13 + v * 0.04));
        k[kind]++;
      }
    }
    this.trees.forEach((t, n) => {
      t.count = k[n];
      t.instanceMatrix.needsUpdate = true;
      if (t.instanceColor) t.instanceColor.needsUpdate = true;
    });
  }

  private placeHouses(camPos: THREE.Vector3, cover: CoverGrid, pal: TerrainPalette) {
    const houses = this.houses!;
    houses.geometry = pal.style === 'desert' ? this.flatHouse! : this.pitchedHouse!;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const ci = Math.floor(camPos.x / HOUSE_CELL), cj = Math.floor(camPos.z / HOUSE_CELL), r = Math.ceil(HOUSE_RADIUS / HOUSE_CELL);
    let k = 0;
    for (let j = cj - r; j <= cj + r && k < HOUSE_MAX; j++) {
      for (let i = ci - r; i <= ci + r && k < HOUSE_MAX; i++) {
        const hsh = hash2(i + 101, j - 77);
        const x = (i + 0.2 + hsh * 0.6) * HOUSE_CELL, z = (j + 0.2 + hash2(j - 77, i + 101) * 0.6) * HOUSE_CELL;
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 > HOUSE_RADIUS * HOUSE_RADIUS) continue;
        if (!builtAt(cover, x, z)) continue;
        const h = terrainHeight(x, z);
        if (h < 1.5 || nearRunway(x, z)) continue;
        // dense cores grow taller blocks; the edges are houses
        const dense = coverAt(cover, x, z, 1);
        const tall = dense > 0.6 && hsh > 0.55;
        const w = tall ? 18 + hsh * 16 : 9 + hsh * 8, d = tall ? 16 + hash2(i, j) * 14 : 8 + hash2(i, j) * 6;
        const ht = tall ? 12 + hash2(j, i + 9) * (pal.style === 'desert' ? 10 : 22) : 5 + hash2(j, i + 9) * 3;
        // streets run along the grid: houses face one of its axes
        q.setFromAxisAngle(up, (hash2(i - 3, j + 3) < 0.5 ? 0 : Math.PI / 2) + (hsh - 0.5) * 0.15);
        m.compose(p.set(x, h - 0.3, z), q, s.set(w, ht, d));
        houses.setMatrixAt(k, m);
        const v = hash2(i + 5, j + 5);
        houses.setColorAt(k, pal.style === 'desert' ? col.setRGB(0.95 + v * 0.05, 0.88 + v * 0.06, 0.74 + v * 0.06) : v < 0.3 ? col.setRGB(0.75, 0.75, 0.78) : col.setRGB(0.9 + v * 0.1, 0.85 + v * 0.1, 0.8 + v * 0.1));
        k++;
      }
    }
    houses.count = k;
    houses.instanceMatrix.needsUpdate = true;
    if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
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
    // finely divided: with the logarithmic depth buffer, a two-triangle plane thousands of km across gets its depth
    // wrong near the camera and is drawn over the land (the terrain "flashing" on and off as the view moved)
    new THREE.PlaneGeometry(THEATER_HALF * 6, THEATER_HALF * 6, 240, 240),
    new THREE.MeshLambertMaterial({ color: 0x1d3446 }),
  );
  sea.rotation.x = -Math.PI / 2;
  // below the terrain's own sea surface (-2 m): low coasts sit within a metre of sea level and would z-fight with it
  // at a distance (the flicker along the horizon); the plane only fills in beyond the built terrain
  sea.position.y = -8;
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

