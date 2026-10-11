// Military airfields: runway with real markings (designators from the heading, threshold "piano keys", touchdown-zone
// and aiming-point bars, centreline, edge lines), parallel taxiway with connectors, apron with stands, hangars,
// hardened aircraft shelters, control tower with a glass cab, fuel farm, runway edge lights, approach lights and a
// PAPI whose lights turn red/white with the viewer's glidepath. Textures are shared (runway numbers cached per
// designator) and repeated elements instanced, so dozens of fields stay cheap.
import * as THREE from 'three';
import { runwayEnds, terrainHeight, type Airbase } from '../world/theater.js';

const RWY_W = 45, TWY_W = 23, TWY_OFF = 180, APRON_OFF = 330;

// ------------------------------------------------------------------ shared textures
let tex: { surface: THREE.Texture; ends: THREE.Texture; taxi: THREE.Texture; apron: THREE.Texture } | null = null;
const numberTex = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; }
function finish(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
/** asphalt with grain */
function asphalt(x: CanvasRenderingContext2D, w: number, h: number, base: number) {
  x.fillStyle = `rgb(${base},${base + 2},${base + 4})`; x.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 40; i++) {
    const v = base + (Math.random() - 0.5) * 18;
    x.fillStyle = `rgb(${v | 0},${(v + 2) | 0},${(v + 4) | 0})`;
    x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function textures() {
  if (tex) return tex;
  // runway surface: one 45 m × 90 m tile — edge lines and a 30 m dash / 20 m gap centreline (repeats along)
  const [s, sx] = canvas(256, 512);
  asphalt(sx, 256, 512, 58);
  sx.fillStyle = '#d8d8cc';
  sx.fillRect(6, 0, 5, 512); sx.fillRect(245, 0, 5, 512);
  sx.fillRect(124, 0, 8, 170); sx.fillRect(124, 284, 8, 170);
  // runway end markings: 45 m × 600 m from the threshold (top of the texture = threshold)
  const [e, ex] = canvas(256, 2048);
  ex.clearRect(0, 0, 256, 2048);
  ex.fillStyle = '#d8d8cc';
  const m = (metres: number) => metres * 2048 / 600;
  for (let k = 0; k < 8; k++) {                                   // threshold piano keys
    const off = k < 4 ? 14 + k * 26 : 256 - 14 - (k - 3) * 26;
    ex.fillRect(off, m(6), 16, m(30));
  }
  for (const [d, n] of [[150, 3], [300, 2], [450, 2], [580, 1]] as const) {   // touchdown-zone bars
    for (let k = 0; k < n; k++) { ex.fillRect(40 + k * 18, m(d), 10, m(22)); ex.fillRect(256 - 50 - k * 18, m(d), 10, m(22)); }
  }
  ex.fillRect(52, m(300), 30, m(45)); ex.fillRect(256 - 82, m(300), 30, m(45));     // aiming-point blocks
  ex.fillStyle = 'rgba(20,20,20,0.35)';                                              // rubber from touchdowns
  for (let i = 0; i < 400; i++) ex.fillRect(90 + Math.random() * 76, m(120 + Math.random() * 400), 2 + Math.random() * 4, 4 + Math.random() * 30);
  // taxiway: darker asphalt, yellow centreline and edge lines
  const [t, tx] = canvas(128, 256);
  asphalt(tx, 128, 256, 50);
  tx.fillStyle = '#d6b23a'; tx.fillRect(61, 0, 6, 256);
  tx.fillStyle = '#c8b046'; tx.fillRect(3, 0, 3, 256); tx.fillRect(122, 0, 3, 256);
  // apron: concrete slabs with stand markings
  const [a, ax] = canvas(512, 512);
  ax.fillStyle = '#7d7f80'; ax.fillRect(0, 0, 512, 512);
  ax.strokeStyle = 'rgba(40,40,40,0.35)'; ax.lineWidth = 2;
  for (let k = 0; k <= 512; k += 64) { ax.beginPath(); ax.moveTo(k, 0); ax.lineTo(k, 512); ax.moveTo(0, k); ax.lineTo(512, k); ax.stroke(); }
  ax.strokeStyle = '#d6b23a'; ax.lineWidth = 4;
  for (let k = 64; k < 512; k += 128) { ax.beginPath(); ax.moveTo(k, 80); ax.lineTo(k, 430); ax.stroke(); ax.beginPath(); ax.arc(k, 430, 30, 0, Math.PI); ax.stroke(); }
  tex = { surface: finish(s, true), ends: finish(e), taxi: finish(t, true), apron: finish(a, true) };
  return tex;
}
function numberTexture(n: string) {
  let t = numberTex.get(n);
  if (!t) {
    const [c, x] = canvas(256, 256);
    x.clearRect(0, 0, 256, 256);
    x.fillStyle = '#d8d8cc'; x.font = 'bold 200px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(128, 128); x.scale(0.62, 1.2); x.fillText(n, 0, 0); x.restore();
    t = finish(c); numberTex.set(n, t);
  }
  return t;
}
/** runway designator: magnetic-ish heading / 10, "36" for north */
export const designator = (hdg: number) => String(Math.round((((hdg % 360) + 360) % 360) / 10) || 36).padStart(2, '0');

// ------------------------------------------------------------------ geometry helpers
function flat(w: number, l: number, mat: THREE.Material, x: number, y: number, z: number, hr: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2, -hr, 0);
  m.position.set(x, y, z);
  return m;
}
const decal = (map: THREE.Texture, order: number, repeat?: [number, number]) => {
  const t = repeat ? map.clone() : map;
  if (repeat) { t.repeat.set(...repeat); t.needsUpdate = true; }
  return new THREE.MeshLambertMaterial({ map: t, transparent: !repeat, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });
};

export interface Airfield { group: THREE.Group; papi: THREE.InstancedMesh; papiPos: THREE.Vector3; papiDir: THREE.Vector3 }

/** Build one airfield in world coordinates. */
export function buildAirfield(ab: Airbase): Airfield {
  const T = textures();
  const g = new THREE.Group();
  const len = ab.length, hr = ab.hdg * Math.PI / 180, y0 = ab.elev;
  const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
  const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
  const at = (along: number, across: number, y = y0) => new THREE.Vector3(ab.x, y, ab.z).addScaledVector(fwd, along).addScaledVector(side, across);

  // runway: surface (repeating), end markings + designators at both ends
  g.add(flat(RWY_W, len, decal(T.surface, 4, [1, len / 90]), ab.x, y0 + 0.15, ab.z, hr));
  const endsMat = decal(T.ends, 6);
  for (const dir of [1, -1]) {
    // the end decal starts at the threshold and runs 600 m into the runway; at the far end it is turned around
    const c = at(dir * (len / 2 - 300), 0, y0 + 0.17);
    g.add(flat(RWY_W, 600, endsMat, c.x, c.y, c.z, hr + (dir > 0 ? Math.PI : 0)));
    const num = designator(ab.hdg + (dir > 0 ? 180 : 0));
    const p = at(dir * (len / 2 - 70), 0, y0 + 0.19);
    g.add(flat(18, 30, decal(numberTexture(num), 8), p.x, p.y, p.z, hr + (dir > 0 ? Math.PI : 0)));
  }

  // parallel taxiway + three connectors, apron beyond it
  const tw = at(0, TWY_OFF, y0 + 0.12);
  g.add(flat(TWY_W, len * 0.9, decal(T.taxi, 3, [1, len * 0.9 / 45]), tw.x, tw.y, tw.z, hr));
  const connMat = decal(T.taxi, 3, [1, (TWY_OFF - RWY_W / 2) / 45]);
  for (const a of [-len * 0.44, 0, len * 0.44]) {
    const c = at(a, (TWY_OFF + RWY_W / 2) / 2, y0 + 0.13);
    g.add(flat(TWY_W, TWY_OFF - RWY_W / 2, connMat, c.x, c.y, c.z, hr + Math.PI / 2));
  }
  const apronL = len * 0.45;
  const ap = at(0, APRON_OFF, y0 + 0.1);
  g.add(flat(220, apronL, decal(T.apron, 2, [220 / 80, apronL / 80]), ap.x, ap.y, ap.z, hr));

  // buildings: hangars where the gameplay hangars are, shelters, tower, fuel farm
  const wall = new THREE.MeshLambertMaterial({ color: ab.side === 'blue' ? 0x7d8278 : 0x7a7466 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x5c605f });
  const roofQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hr, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
  for (let k = -3; k <= 3; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 36), wall);
    h.position.copy(at(k * 90, 470, y0 + 6)); h.rotation.y = -hr; g.add(h);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 36, 12, 1, false, 0, Math.PI), roof);   // barrel roof
    r.quaternion.copy(roofQ); r.scale.set(0.35, 1, 1); r.position.copy(at(k * 90, 470, y0 + 12)); g.add(r);
  }
  // hardened aircraft shelters: concrete half-cylinders, doors facing the taxiway
  const has = new THREE.InstancedMesh(new THREE.CylinderGeometry(12, 13, 34, 14, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8c8a80 }), 8);
  const mtx = new THREE.Matrix4();
  const hasQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hr + Math.PI / 2, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  for (let k = 0; k < 8; k++) {
    const p = at((k < 4 ? -1 : 1) * len * 0.22 + ((k % 4) - 1.5) * 70, -TWY_OFF - 110, 0);
    p.y = Math.max(0, terrainHeight(p.x, p.z));
    mtx.compose(p, hasQ, new THREE.Vector3(1, 1, 1));
    has.setMatrixAt(k, mtx);
  }
  g.add(has);
  const tw2 = at(-len * 0.35, 380, y0);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), new THREE.MeshLambertMaterial({ color: 0xc8c6b8 }));
  shaft.position.copy(tw2).setY(y0 + 13); g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5.5, 4.5, 8), new THREE.MeshLambertMaterial({ color: 0x23344a, emissive: 0x0b1220 }));
  cab.position.copy(tw2).setY(y0 + 28.2); g.add(cab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.8, 8), roof);
  cap.position.copy(tw2).setY(y0 + 30.8); g.add(cap);
  const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(9, 9, 10, 16), new THREE.MeshLambertMaterial({ color: 0xd8d6cc }), 4);
  for (let k = 0; k < 4; k++) { const p = at(len * 0.38 + (k % 2) * 26, 560 + Math.floor(k / 2) * 26, y0 + 5); mtx.makeTranslation(p.x, p.y, p.z); tank.setMatrixAt(k, mtx); }
  g.add(tank);

  // lights: edge lights every 60 m, approach bars, PAPI
  const edgeN = Math.floor(len / 60) + 1;
  const edge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }), edgeN * 2);
  for (let k = 0; k < edgeN; k++) for (const s of [-1, 1]) {
    const p = at(-len / 2 + k * 60, s * (RWY_W / 2 + 1.5), y0 + 0.4);
    mtx.makeTranslation(p.x, p.y, p.z); edge.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), mtx);
  }
  g.add(edge);
  const ends = runwayEnds(ab);
  const appr = new THREE.InstancedMesh(new THREE.BoxGeometry(18, 0.6, 1.5), new THREE.MeshBasicMaterial({ color: 0xffeeaa }), 20);
  const apprQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -hr);
  let n = 0;
  for (const [e, out] of [[ends.start, -1], [ends.end, 1]] as const) {
    for (let k = 1; k <= 10; k++) {
      const lx = e.x + fwd.x * out * k * 30, lz = e.z + fwd.z * out * k * 30;
      mtx.compose(new THREE.Vector3(lx, terrainHeight(lx, lz) + 0.6, lz), apprQ, new THREE.Vector3(1, 1, 1));
      appr.setMatrixAt(n++, mtx);
    }
  }
  g.add(appr);
  // PAPI: 4 boxes left of the runway, 300 m in from the start threshold (landing towards the "end")
  const papi = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1, 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 4);
  const papiPos = at(-len / 2 + 300, -(RWY_W / 2 + 15), y0 + 0.8);
  for (let k = 0; k < 4; k++) {
    const p = papiPos.clone().addScaledVector(side, -k * 9);
    mtx.makeTranslation(p.x, p.y, p.z); papi.setMatrixAt(k, mtx); papi.setColorAt(k, new THREE.Color(0xffffff));
  }
  g.add(papi);
  return { group: g, papi, papiPos, papiDir: fwd.clone() };
}

const RED = new THREE.Color(0xff2a1a), WHITE = new THREE.Color(0xfff6e8);
/** PAPI lights switch red→white at 2.5°, 2.83°, 3.17° and 3.5°: on a 3° glidepath you see two of each */
export function papiColors(angleDeg: number): boolean[] {
  const steps = [3.5, 3.17, 2.83, 2.5];   // light 0 (nearest the runway) needs the highest angle to go white
  return steps.map((s) => angleDeg > s);
}
export function updatePapi(f: Airfield, eye: THREE.Vector3) {
  const d = eye.clone().sub(f.papiPos);
  const along = -d.dot(f.papiDir);   // distance out on the approach, behind the PAPI
  if (along < 50 || along > 15000) return;
  const white = papiColors(Math.atan2(d.y, along) * 180 / Math.PI);
  for (let k = 0; k < 4; k++) f.papi.setColorAt(k, white[k] ? WHITE : RED);
  f.papi.instanceColor!.needsUpdate = true;
}
