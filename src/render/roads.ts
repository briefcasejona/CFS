// Roads, railways and stations of the real-world theaters (world/transport.ts): every motorway down to the tertiary
// roads and every railway across the whole map, plus the local streets in the detail squares around the airfields.
//
// Drawn as ribbons on the terrain, one mesh per cell of the baked blocks, built a few milliseconds a frame as the
// camera comes within range. The ribbons are drawn straight after the ground and never write depth: the vertex shader
// pulls each point a little towards the eye so it wins against the ground under it (whatever level of detail that
// ground mesh is at), and everything drawn later — houses, trees, aircraft — covers the road as it should. A road far
// away is kept a pixel wide and faded instead, so the network reads from altitude without shimmering.
import * as THREE from 'three';
import { gunzip } from '../world/demTheater.js';
import { currentTheater, terrainHeight, fieldsNear, runwaysOf } from '../world/theater.js';
import { buildRibbons, cellPolylines, parseBlock, parseStations, RAILWAY, RESIDENTIAL, UNCLASSIFIED, TERTIARY, type Polyline, type RoadBlock, type Station } from '../world/transport.js';
import { realBuildings } from './buildings.js';

/** how far the main network is drawn, and within what range every class / the local streets are */
export const ROADS_FAR = 44000, ROADS_ALL = 20000, STREETS = 7000;
const NEAR_STEP = 30, FAR_STEP = 350, STATION_RANGE = 9000;

interface Index { half: number; block: number; cell: number; blocks: Array<[number, number]>; local: Array<{ id: string; x0: number; z0: number; size: number }>; localCell: number }
interface CellMesh { mesh: THREE.Mesh | null; lod: number; used: number; box: [number, number, number, number] }

function roadMaterial(uniforms: { uPix: { value: number } }) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  // blended in the opaque pass (after the ground, before everything else)
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPix = uniforms.uPix;
    sh.vertexShader = 'attribute vec4 aRoad;\nuniform float uPix;\nvarying vec4 vRoad;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = position;
      vec3 camL = cameraPosition - modelMatrix[3].xyz;
      float rDist = distance(camL, position);
      // never thinner than about a pixel
      float rW = max(aRoad.z, rDist * uPix);
      transformed.xz += aRoad.xy * (rW * uv.x);
      // towards the eye: in front of the ground it lies on
      vec3 toCam = camL - transformed;
      float tl = max(length(toCam), 0.001);
      transformed += toCam / tl * min(tl * 0.5, 1.0 + tl * 0.012);
      vRoad = vec4(uv.x * rW / aRoad.z, uv.y, aRoad.z / rW, aRoad.w);`);
    sh.fragmentShader = 'varying vec4 vRoad;\nfloat rHash(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }\n' + sh.fragmentShader.replace('#include <color_fragment>', `
      {
        float u = vRoad.x, au = abs(u), v = vRoad.y, t = vRoad.w;
        float fu = fwidth(u), fv = fwidth(v);
        vec3 c;
        if (t > 9.5) {
          // ballast, sleepers and the two rails
          c = vec3(0.33, 0.30, 0.27) * (0.9 + 0.2 * rHash(floor(vec2(u * 9.0, v * 4.0))));
          float sleeper = step(fract(v / 0.65), 0.4) * step(au, 0.76) * (1.0 - smoothstep(0.12, 0.4, fv));
          c = mix(c, vec3(0.2, 0.17, 0.15), sleeper * 0.8);
          float rail = (1.0 - smoothstep(0.035, 0.035 + fu * 1.2, abs(au - 0.44))) * (1.0 - smoothstep(0.08, 0.4, fu));
          c = mix(c, vec3(0.5, 0.47, 0.45), rail);
          // from above a line is a dark-brown thread
          c = mix(c, vec3(0.27, 0.24, 0.22), smoothstep(0.1, 0.5, fu));
        } else {
          // asphalt: worn lighter in the wheel tracks, patched here and there
          float grain = rHash(floor(vec2(u * 6.0, v * 1.5)));
          c = (t < 4.5 ? vec3(0.235, 0.24, 0.25) : vec3(0.27, 0.27, 0.275)) * (0.93 + 0.14 * grain);
          c *= 1.0 + 0.06 * cos(u * 6.283 * (t < 1.5 ? 2.0 : 1.0));
          float lines = 1.0 - smoothstep(0.03, 0.16, fu);
          float mark = 0.0;
          // edge lines on the classified roads; lane dashes on a carriageway, a dashed centre line on a two-way road
          if (t < 3.5) mark = max(mark, 1.0 - smoothstep(0.02, 0.02 + fu, abs(au - 0.9)));
          if (t < 4.5) {
            float dash = t < 1.5 ? step(fract(v / 18.0), 0.34) : step(fract(v / 12.0), 0.5);
            mark = max(mark, (1.0 - smoothstep(0.022, 0.022 + fu, au)) * dash * (1.0 - smoothstep(1.0, 4.0, fv)));
          }
          c = mix(c, vec3(0.82, 0.82, 0.78), mark * lines);
        }
        diffuseColor.rgb = c * vec3(0.4, 0.385, 0.365);
        // feathered edge; a road thinner than a pixel fades instead of flickering
        diffuseColor.a = vRoad.z * (1.0 - smoothstep(1.0 - fu * 1.5, 1.0, au * vRoad.z + (1.0 - vRoad.z)));
      }
      #include <color_fragment>`).replace('#include <opaque_fragment>', `
      {
        // the light's brightness without its tint: asphalt under a blue sky still reads grey
        const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
        outgoingLight = diffuseColor.rgb * (dot(outgoingLight, LUM) / max(dot(diffuseColor.rgb, LUM), 1e-4));
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'road';
  return mat;
}

export class Roads {
  readonly group = new THREE.Group();
  private theaterId = '';
  private index: Index | null = null;
  private blockSet = new Set<string>();
  private blocks = new Map<string, RoadBlock | 'loading' | 'none'>();
  private cells = new Map<string, CellMesh>();
  private frame = 0;
  /** milliseconds a frame may spend building road meshes */
  budgetMs = 3.5;
  private uniforms = { uPix: { value: 0.001 } };
  private mat = roadMaterial(this.uniforms);
  private stations: Station[] = [];
  private stationAt = new THREE.Vector2(Infinity, Infinity);
  private stationMeshes: THREE.InstancedMesh[] = [];
  /** set by the scene: vertical field of view (rad) and drawing-buffer height, for the one-pixel minimum width */
  setView(fovRad: number, heightPx: number) { this.uniforms.uPix.value = Math.tan(fovRad / 2) / Math.max(1, heightPx) * 0.75; }

  constructor() { this.group.name = 'roads'; }

  clear() {
    for (const c of this.cells.values()) if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
    this.cells.clear();
    this.stationAt.set(Infinity, Infinity);
    for (const m of this.stationMeshes) m.count = 0;
  }

  /** the ground changed under a square (streamed elevation arrived): its cells are rebuilt, the old ones showing until then */
  invalidate(x0: number, z0: number, x1: number, z1: number) {
    for (const c of this.cells.values()) if (c.box[0] < x1 && c.box[2] > x0 && c.box[1] < z1 && c.box[3] > z0) c.lod = -1;
    if (this.stationAt.x > x0 - 6000 && this.stationAt.x < x1 + 6000 && this.stationAt.y > z0 - 6000 && this.stationAt.y < z1 + 6000) this.stationAt.set(Infinity, Infinity);
  }

  private base() { return `assets/theaters/${this.theaterId}/roads`; }

  private loadIndex() {
    const id = this.theaterId;
    fetch(`${this.base()}/index.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((ix: Index) => {
      if (id !== this.theaterId) return;
      this.index = ix;
      this.blockSet = new Set(ix.blocks.map(([i, j]) => `${i}_${j}`));
      return fetch(`${this.base()}/stations.json`).then((r) => (r.ok ? r.json() : [])).then((rows) => { if (id === this.theaterId) this.stations = parseStations(rows); });
    }).catch(() => { /* a theater without baked roads */ });
  }

  /** the block file `name` (major/<i>_<j> or local/<patch>), fetched on first use */
  private block(name: string): RoadBlock | null {
    const b = this.blocks.get(name);
    if (b) return typeof b === 'string' ? null : b;
    this.blocks.set(name, 'loading');
    const id = this.theaterId;
    fetch(`${this.base()}/${name}.bin.gz`).then((r) => (r.ok ? gunzip(r) : Promise.reject(new Error(String(r.status))))).then((buf) => {
      if (id === this.theaterId) this.blocks.set(name, parseBlock(buf));
    }, () => { if (id === this.theaterId) this.blocks.set(name, 'none'); });
    return null;
  }

  update(cam: THREE.Vector3, agl: number) {
    const th = currentTheater();
    if (th.id !== this.theaterId) {
      this.clear();
      this.theaterId = th.id; this.index = null; this.blocks.clear(); this.blockSet.clear(); this.stations = [];
      if (th.geo) this.loadIndex();
    }
    const ix = this.index;
    this.group.visible = !!ix;
    if (!ix) return;
    this.frame++;
    const t0 = performance.now(), budget = this.budgetMs;
    // nearest first: [distance, key, block file, cell i, j, level]
    const want: Array<[number, string, string, number, number, number, number, number, number]> = [];
    const ring = (reach: number, size: number, fn: (i: number, j: number, d: number, x0: number, z0: number) => void, ox: number, oz: number) => {
      const i0 = Math.floor((cam.x - reach - ox) / size), i1 = Math.floor((cam.x + reach - ox) / size), j0 = Math.floor((cam.z - reach - oz) / size), j1 = Math.floor((cam.z + reach - oz) / size);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x0 = ox + i * size, z0 = oz + j * size;
        const d = Math.hypot(Math.max(0, Math.abs(cam.x - x0 - size / 2) - size / 2), Math.max(0, Math.abs(cam.z - z0 - size / 2) - size / 2));
        if (d < reach) fn(i, j, d, x0, z0);
      }
    };
    const per = ix.block / ix.cell;
    ring(ROADS_FAR, ix.cell, (i, j, d, x0, z0) => {
      const bi = Math.floor(i / per), bj = Math.floor(j / per);
      if (!this.blockSet.has(`${bi}_${bj}`)) return;
      // level 0: every class, following the ground closely; 1: every class; 2: the main roads and railways only
      const lod = d < 5000 ? 0 : d < ROADS_ALL ? 1 : 2;
      want.push([d, `M${i},${j}`, `major/${bi}_${bj}`, i - bi * per, j - bj * per, lod, x0, z0, ix.cell]);
    }, -ix.half, -ix.half);
    if (agl < 6000) for (const p of ix.local) {
      if (cam.x < p.x0 - STREETS || cam.z < p.z0 - STREETS || cam.x > p.x0 + p.size + STREETS || cam.z > p.z0 + p.size + STREETS) continue;
      const T = Math.ceil(p.size / ix.localCell);
      ring(STREETS, ix.localCell, (i, j, d, x0, z0) => { if (i >= 0 && j >= 0 && i < T && j < T) want.push([d, `L${p.id},${i},${j}`, `local/${p.id}`, i, j, 0, x0, z0, ix.localCell]); }, p.x0, p.z0);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, key, file, ci, cj, lod, bx, bz, bs] of want) {
      let c = this.cells.get(key);
      if (!c || c.lod !== lod) {
        if (performance.now() - t0 < budget) {
          const b = this.block(file);
          if (b) {
            const mesh = this.buildCell(b, ci, cj, lod, key[0] === 'L');
            if (c?.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
            c = { mesh, lod, used: this.frame, box: [bx, bz, bx + bs, bz + bs] };
            this.cells.set(key, c);
            if (mesh) this.group.add(mesh);
          }
        }
      }
      if (c) { c.used = this.frame; if (c.mesh) c.mesh.visible = true; }
    }
    for (const [key, c] of this.cells) {
      if (c.used === this.frame) continue;
      if (c.mesh) c.mesh.visible = false;
      if (this.frame - c.used > 900) { if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); } this.cells.delete(key); }
    }
    this.updateStations(cam, agl);
  }

  private buildCell(b: RoadBlock, ci: number, cj: number, lod: number, local: boolean): THREE.Mesh | null {
    let polys = cellPolylines(b, ci, cj);
    if (lod === 2) polys = polys.filter((p) => p.cls < TERTIARY || p.cls === RAILWAY);
    polys = polys.map(clearOfRunways).filter((p): p is Polyline => !!p);
    if (!polys.length) return null;
    const ox = b.x0 + (ci + 0.5) * b.cell, oz = b.z0 + (cj + 0.5) * b.cell;
    const r = buildRibbons(polys, ox, oz, lod === 0 ? NEAR_STEP : lod === 1 ? 90 : FAR_STEP, terrainHeight);
    if (!r.index.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(r.road, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
    const nrm = new Float32Array(r.position.length);
    for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(r.index, 1));
    geo.computeBoundingSphere();
    geo.boundingSphere!.radius += 200;   // pieces reach a little beyond their cell; the shader widens them
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set(ox, 0, oz);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    // after the ground (−8), streets under the main network
    mesh.renderOrder = local ? -6.5 : -6;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------- stations
  private updateStations(cam: THREE.Vector3, agl: number) {
    const on = agl < 5000 && this.stations.length > 0;
    for (const m of this.stationMeshes) m.visible = on;
    if (!on || Math.hypot(cam.x - this.stationAt.x, cam.z - this.stationAt.y) < 1500) return;
    this.stationAt.set(cam.x, cam.z);
    if (!this.stationMeshes.length) {
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.frustumCulled = false; m.count = 0; m.castShadow = true; m.receiveShadow = true;
        this.stationMeshes.push(m); this.group.add(m);
        return m;
      };
      const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      mk(unit, new THREE.MeshLambertMaterial({ color: 0x8d8a83 }), 600);                                     // platforms
      mk(unit, new THREE.MeshStandardMaterial({ color: 0x59646c, roughness: 0.4, metalness: 0.5 }), 600);    // canopies and halls
      mk(unit, new THREE.MeshLambertMaterial({ color: 0x70757a }), 2400);                                    // canopy posts
      mk(stationHouse(), new THREE.MeshLambertMaterial({ vertexColors: true }), 300);                        // station buildings
    }
    const [plat, roof, post, house] = this.stationMeshes;
    const n = [0, 0, 0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const R = STATION_RANGE + 1500;
    for (const st of this.stations) {
      if (Math.abs(st.x - cam.x) > R || Math.abs(st.z - cam.z) > R) continue;
      const hr = st.hdg * Math.PI / 180, fx = Math.sin(hr), fz = -Math.cos(hr), sx = Math.cos(hr), sz = Math.sin(hr);
      const y = Math.max(0.5, terrainHeight(st.x, st.z));
      q.setFromAxisAngle(up, -hr);
      const put = (im: THREE.InstancedMesh, k: number, along: number, across: number, yy: number, w: number, h: number, l: number) => {
        if (n[k] >= im.instanceMatrix.count) return;
        m.compose(p.set(st.x + fx * along + sx * across, y + yy, st.z + fz * along + sz * across), q, s.set(w, h, l));
        im.setMatrixAt(n[k]++, m);
      };
      // a big station (many tracks) has longer platforms, islands between the tracks and a hall over them
      const span = st.hi - st.lo, big = span > 22, L = big ? 340 : span > 6 ? 240 : 160;
      const sides = [st.lo - 4.6, st.hi + 4.6];
      if (big) for (let a = st.lo + 9; a < st.hi - 6; a += 13.5) sides.push(a);
      for (const a of sides) {
        put(plat, 0, 0, a, -0.4, a === sides[0] || a === sides[1] ? 5 : 6.5, 1.35, L);
        if (!big) {
          put(roof, 1, 0, a, 4.3, 4.6, 0.25, L * 0.4);
          for (let k = -2; k <= 2; k++) put(post, 2, k * L * 0.09, a, 0.9, 0.3, 3.5, 0.3);
        }
      }
      if (big) {
        // the train shed: a roof across every track, on rows of columns
        put(roof, 1, 0, (st.lo + st.hi) / 2, 13, span + 20, 1.2, L * 0.55);
        for (const a of [st.lo - 8, st.hi + 8]) for (let k = -4; k <= 4; k++) put(post, 2, k * L * 0.065, a, 0.9, 0.8, 12.2, 0.8);
      }
      // the station building on the right-hand side, unless the real footprints already have it
      if (!realBuildings.covers(st.x, st.z)) put(house, 3, 0, st.hi + (big ? 26 : 15), -0.3, big ? 30 : 11, big ? 15 : 7, big ? 120 : 34);
    }
    this.stationMeshes.forEach((im, k) => { im.count = n[k]; im.instanceMatrix.needsUpdate = true; });
  }
}

/** a pitched-roof hall along z: light walls, slate roof (per vertex) */
function stationHouse() {
  const walls = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  const roof = new THREE.CylinderGeometry(0.62, 0.62, 1.03, 3, 1).rotateX(Math.PI / 2).scale(1, 0.5, 1).translate(0, 1.16, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
    const n = g.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { c[k * 3] = r; c[k * 3 + 1] = gr; c[k * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const g = new THREE.BufferGeometry();
  const a = paint(walls, 0.8, 0.74, 0.64), b = paint(roof, 0.3, 0.3, 0.33);
  for (const name of ['position', 'normal', 'color']) {
    const x = a.getAttribute(name), y = b.getAttribute(name), arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array); arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

/** drop the part of a polyline that would cross a runway (the data has service roads and old alignments there) */
function clearOfRunways(pl: Polyline): Polyline | null {
  const n = pl.pts.length / 2;
  const near = fieldsNear(pl.pts[0], pl.pts[1]);
  if (!near.length) return pl;
  let cut = false;
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pl.pts[i * 2], z = pl.pts[i * 2 + 1];
    let on = false;
    for (const ab of near) for (const rw of runwaysOf(ab)) {
      const hr = rw.hdg * Math.PI / 180, dx = x - rw.x, dz = z - rw.z;
      if (Math.abs(dx * Math.sin(hr) - dz * Math.cos(hr)) < rw.length / 2 + 80 && Math.abs(dx * Math.cos(hr) + dz * Math.sin(hr)) < 75) { on = true; break; }
    }
    if (on) { cut = true; break; }
    keep.push(x, z);
  }
  if (!cut) return pl;
  // keep the longer clear end (the other is usually a stub on the field)
  return keep.length >= 4 ? { ...pl, pts: Float64Array.from(keep) } : null;
}
