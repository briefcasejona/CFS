// Military airfields: runway with real markings (designators from the heading, threshold "piano keys", touchdown-zone
// and aiming-point bars, centreline, edge lines), parallel taxiway with connectors, apron with stands, hangars,
// hardened aircraft shelters, control tower with a glass cab, fuel farm, runway edge lights, approach lights and a
// PAPI whose lights turn red/white with the viewer's glidepath. Textures are shared (runway numbers cached per
// designator) and repeated elements instanced, so dozens of fields stay cheap.
import * as THREE from 'three';
import { apronSide, runwayEnds, terrainHeight, type Airbase, type BaseLayout, type Runway } from '../world/theater.js';

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

/** Runway surface, end markings, designators, edge lights and approach lights for one runway. */
function addRunway(g: THREE.Group, rw: Runway, y0: number) {
  const T = textures();
  const len = rw.length, hr = rw.hdg * Math.PI / 180;
  const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
  const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
  const at = (along: number, across: number, y = y0) => new THREE.Vector3(rw.x, y, rw.z).addScaledVector(fwd, along).addScaledVector(side, across);
  // runway: surface (repeating), end markings + designators at both ends
  g.add(flat(RWY_W, len, decal(T.surface, 4, [1, len / 90]), rw.x, y0 + 0.15, rw.z, hr));
  const endsMat = decal(T.ends, 6);
  for (const dir of [1, -1]) {
    // the end decal starts at the threshold and runs 600 m into the runway; at the far end it is turned around
    const c = at(dir * (len / 2 - 300), 0, y0 + 0.17);
    g.add(flat(RWY_W, 600, endsMat, c.x, c.y, c.z, hr + (dir > 0 ? Math.PI : 0)));
    const num = designator(rw.hdg + (dir > 0 ? 180 : 0));
    const p = at(dir * (len / 2 - 70), 0, y0 + 0.19);
    g.add(flat(18, 30, decal(numberTexture(num), 8), p.x, p.y, p.z, hr + (dir > 0 ? Math.PI : 0)));
  }

  const mtx = new THREE.Matrix4();
  // lights: edge lights every 60 m, approach bars, PAPI
  const edgeN = Math.floor(len / 60) + 1;
  const edge = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }), edgeN * 2);
  for (let k = 0; k < edgeN; k++) for (const s of [-1, 1]) {
    const p = at(-len / 2 + k * 60, s * (RWY_W / 2 + 1.5), y0 + 0.4);
    mtx.makeTranslation(p.x, p.y, p.z); edge.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), mtx);
  }
  g.add(edge);
  const ends = runwayEnds(rw);
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
}

/** Build one airfield in world coordinates. */
export function buildAirfield(ab: Airbase): Airfield {
  const T = textures();
  const g = new THREE.Group();
  const len = ab.length, hr = ab.hdg * Math.PI / 180, y0 = ab.elev;
  const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
  const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
  const at = (along: number, across: number, y = y0) => new THREE.Vector3(ab.x, y, ab.z).addScaledVector(fwd, along).addScaledVector(side, across);
  // taxiway, apron and buildings go on the side clear of the field's other runways
  const S = apronSide(ab);
  const atS = (along: number, across: number, y = y0) => at(along, S * across, y);

  addRunway(g, ab, y0);
  for (const rw of ab.extra ?? []) addRunway(g, rw, y0);
  if (ab.layout) {
    buildLayout(g, ab.layout, y0, ab.side, T);
    return { group: g, ...addPapi(g, ab, y0) };
  }

  // parallel taxiway + three connectors, apron beyond it
  const tw = atS(0, TWY_OFF, y0 + 0.12);
  g.add(flat(TWY_W, len * 0.9, decal(T.taxi, 3, [1, len * 0.9 / 45]), tw.x, tw.y, tw.z, hr));
  const connMat = decal(T.taxi, 3, [1, (TWY_OFF - RWY_W / 2) / 45]);
  for (const a of [-len * 0.44, 0, len * 0.44]) {
    const c = atS(a, (TWY_OFF + RWY_W / 2) / 2, y0 + 0.13);
    g.add(flat(TWY_W, TWY_OFF - RWY_W / 2, connMat, c.x, c.y, c.z, hr + Math.PI / 2));
  }
  const apronL = len * 0.45;
  const ap = atS(0, APRON_OFF, y0 + 0.1);
  g.add(flat(220, apronL, decal(T.apron, 2, [220 / 80, apronL / 80]), ap.x, ap.y, ap.z, hr));

  if (ab.kind && ab.kind !== 'military') {
    addCivil(g, ab, atS, hr, y0, S);
    return { group: g, ...addPapi(g, ab, y0) };
  }

  // buildings: hangars where the gameplay hangars are, shelters, tower, fuel farm
  const wall = new THREE.MeshLambertMaterial({ color: ab.side === 'blue' ? 0x7d8278 : 0x7a7466 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x5c605f });
  const roofQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hr, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
  for (let k = -3; k <= 3; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 36), wall);
    h.position.copy(atS(k * 90, 470, y0 + 6)); h.rotation.y = -hr; g.add(h);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 36, 12, 1, false, 0, Math.PI), roof);   // barrel roof
    r.quaternion.copy(roofQ); r.scale.set(0.35, 1, 1); r.position.copy(atS(k * 90, 470, y0 + 12)); g.add(r);
  }
  // hardened aircraft shelters: concrete half-cylinders, doors facing the taxiway
  const has = new THREE.InstancedMesh(new THREE.CylinderGeometry(12, 13, 34, 14, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8c8a80 }), 8);
  const mtx = new THREE.Matrix4();
  const hasQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hr + Math.PI / 2, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  for (let k = 0; k < 8; k++) {
    const p = atS((k < 4 ? -1 : 1) * len * 0.22 + ((k % 4) - 1.5) * 70, -TWY_OFF - 110, 0);
    p.y = Math.max(0, terrainHeight(p.x, p.z));
    mtx.compose(p, hasQ, new THREE.Vector3(1, 1, 1));
    has.setMatrixAt(k, mtx);
  }
  g.add(has);
  const tw2 = atS(-len * 0.35, 380, y0);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), new THREE.MeshLambertMaterial({ color: 0xc8c6b8 }));
  shaft.position.copy(tw2).setY(y0 + 13); g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5.5, 4.5, 8), new THREE.MeshLambertMaterial({ color: 0x23344a, emissive: 0x0b1220 }));
  cab.position.copy(tw2).setY(y0 + 28.2); g.add(cab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.8, 8), roof);
  cap.position.copy(tw2).setY(y0 + 30.8); g.add(cap);
  const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(9, 9, 10, 16), new THREE.MeshLambertMaterial({ color: 0xd8d6cc }), 4);
  for (let k = 0; k < 4; k++) { const p = atS(len * 0.38 + (k % 2) * 26, 560 + Math.floor(k / 2) * 26, y0 + 5); mtx.makeTranslation(p.x, p.y, p.z); tank.setMatrixAt(k, mtx); }
  g.add(tank);

  return { group: g, ...addPapi(g, ab, y0) };
}

/** A civilian field beside the generic taxiway and apron: a terminal (with piers and a car park at an airport),
 *  hangars, a control tower and a fuel farm, sized by the kind of field. */
function addCivil(g: THREE.Group, ab: Airbase, atS: (along: number, across: number, y?: number) => THREE.Vector3, hr: number, y0: number, S: number) {
  const len = ab.length, hub = ab.kind === 'hub', regional = ab.kind === 'regional';
  const glass = new THREE.MeshStandardMaterial({ color: 0x5d7890, roughness: 0.25, metalness: 0.6 });
  const wall = new THREE.MeshLambertMaterial({ color: 0xd4d2ca });
  const roof = new THREE.MeshLambertMaterial({ color: 0x6a6e70 });
  const metal = new THREE.MeshLambertMaterial({ color: 0xa9adb0 });
  const tarmac = new THREE.MeshLambertMaterial({ color: 0x3c3d40 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, along: number, across: number, rot = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.copy(atS(along, across, y0 + h / 2)); m.rotation.y = -hr + rot;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // (box: w runs across the runway axis, d along it)
  const apronL = len * 0.45;
  // terminal along the far edge of the apron: a glazed hall under an overhanging roof
  const tl = hub ? Math.min(520, apronL * 0.55) : regional ? 150 : 46, td = hub ? 70 : regional ? 38 : 16, th = hub ? 21 : regional ? 11 : 6;
  const tAcross = APRON_OFF + 110 + td / 2;
  box(td, th, tl, glass, 0, tAcross);
  box(td + 8, 1.2, tl + 10, roof, 0, tAcross).position.y = y0 + th + 0.6;
  box(td * 0.5, th * 0.45, tl * 0.96, wall, 0, tAcross + td * 0.3).position.y = y0 + th * 0.225;
  if (hub) {
    // piers reaching onto the apron, with a gate lounge at each tip
    const n = Math.max(2, Math.round(tl / 170));
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * (tl / n);
      box(150, 9, 22, glass, a, tAcross - td / 2 - 75);
      box(152, 0.8, 26, roof, a, tAcross - td / 2 - 75).position.y = y0 + 9.4;
      box(34, 11, 46, glass, a, tAcross - td / 2 - 150);
      box(38, 0.8, 50, roof, a, tAcross - td / 2 - 150).position.y = y0 + 11.4;
    }
    // multi-storey car parks and the forecourt road behind the terminal
    for (const a of [-tl * 0.28, tl * 0.28]) {
      box(95, 15, tl * 0.38, wall, a, tAcross + td / 2 + 95);
      for (let f = 1; f < 5; f++) box(96, 0.5, tl * 0.38 + 1, roof, a, tAcross + td / 2 + 95).position.y = y0 + f * 3;
    }
    box(16, 0.3, tl + 260, tarmac, 0, tAcross + td / 2 + 24).position.y = y0 + 0.15;
    // maintenance hangars and cargo sheds further along the apron
    for (const [a, w, d, h] of [[apronL * 0.42, 90, 110, 26], [apronL * 0.42 + 135, 90, 110, 26], [-apronL * 0.44, 60, 140, 12], [-apronL * 0.44 - 170, 60, 140, 12]] as const) {
      box(w, h, d, metal, a, APRON_OFF + 110 + w / 2);
      box(w + 2, 1, d + 2, roof, a, APRON_OFF + 110 + w / 2).position.y = y0 + h + 0.5;
    }
  } else {
    const hn = regional ? 3 : 4, hw = regional ? 46 : 26, hh = regional ? 13 : 8;
    for (let k = 0; k < hn; k++) {
      const a = tl / 2 + 60 + k * (hw + 22);
      box(hw * 0.9, hh, hw, metal, a, APRON_OFF + 110 + hw * 0.45);
      box(hw * 0.9 + 1.5, 0.8, hw + 1.5, roof, a, APRON_OFF + 110 + hw * 0.45).position.y = y0 + hh + 0.4;
    }
    box(60, 0.3, tl + 40, tarmac, 0, tAcross + td / 2 + 40).position.y = y0 + 0.15;   // car park
  }
  // control tower: a slender shaft, a flared cab with dark glazing, a roof and a mast
  const towerH = hub ? 62 : regional ? 30 : 16, tp = atS(-tl / 2 - (hub ? 120 : 45), APRON_OFF + 120 + (hub ? 30 : 10));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(hub ? 4.2 : 3, hub ? 5.5 : 3.6, towerH, 12), wall);
  shaft.position.copy(tp).setY(y0 + towerH / 2); shaft.castShadow = true; g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(hub ? 9 : 6, hub ? 6.5 : 4.6, hub ? 7 : 4.6, 12), new THREE.MeshStandardMaterial({ color: 0x1c2b3c, roughness: 0.15, metalness: 0.7 }));
  cab.position.copy(tp).setY(y0 + towerH + (hub ? 3.5 : 2.3)); g.add(cab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(hub ? 9.8 : 6.6, hub ? 9.8 : 6.6, 0.9, 12), roof);
  cap.position.copy(tp).setY(y0 + towerH + (hub ? 7.5 : 5)); g.add(cap);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 5), metal);
  mast.position.copy(tp).setY(y0 + towerH + (hub ? 12.5 : 10)); g.add(mast);
  // a wider apron in front of an airport terminal
  if (hub) {
    const T = textures(), ap = atS(0, APRON_OFF + 150, y0 + 0.09);
    g.add(flat(260, Math.max(apronL, tl + 420), decal(T.apron, 2, [260 / 80, Math.max(apronL, tl + 420) / 80]), ap.x, ap.y, ap.z, hr));
  }
  // fuel farm
  const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(hub ? 13 : 7, hub ? 13 : 7, hub ? 14 : 8, 18), new THREE.MeshLambertMaterial({ color: 0xe2e0d8 }), hub ? 6 : 2);
  const mtx = new THREE.Matrix4();
  for (let k = 0; k < tank.count; k++) { const p = atS(-len * 0.4 - (k % 3) * (hub ? 34 : 20), APRON_OFF + 160 + Math.floor(k / 3) * 34, y0 + (hub ? 7 : 4)); mtx.makeTranslation(p.x, p.y, p.z); tank.setMatrixAt(k, mtx); }
  tank.castShadow = true;
  g.add(tank);
  void S;
}

/** PAPI: 4 boxes left of the runway, 300 m in from the start threshold (landing towards the "end") */
function addPapi(g: THREE.Group, ab: Airbase, y0: number) {
  const hr = ab.hdg * Math.PI / 180, len = ab.length;
  const side = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
  const fwd = new THREE.Vector3(Math.sin(hr), 0, -Math.cos(hr));
  const at = (along: number, across: number, y = y0) => new THREE.Vector3(ab.x, y, ab.z).addScaledVector(fwd, along).addScaledVector(side, across);
  const mtx = new THREE.Matrix4();
  const papi = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1, 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 4);
  const papiPos = at(-len / 2 + 300, -(RWY_W / 2 + 15), y0 + 0.8);
  for (let k = 0; k < 4; k++) {
    const p = papiPos.clone().addScaledVector(side, -k * 9);
    mtx.makeTranslation(p.x, p.y, p.z); papi.setMatrixAt(k, mtx); papi.setColorAt(k, new THREE.Color(0xffffff));
  }
  g.add(papi);
  return { papi, papiPos, papiDir: fwd.clone() };
}

/** A mapped field (BaseLayout): taxiway ribbons, apron polygons, shelters, hangars and offices where they really are. */
function buildLayout(g: THREE.Group, L: BaseLayout, y0: number, sideOf: 'blue' | 'red', T: ReturnType<typeof textures>) {
  // taxiways: ribbons along the polylines, mitred at the bends, the centreline texture running along them
  const twyMat = new THREE.MeshLambertMaterial({ map: T.taxi.clone(), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  twyMat.map!.wrapT = THREE.RepeatWrapping; twyMat.map!.needsUpdate = true;
  for (const tw of L.taxiways) {
    const pts = tw.pts, n = pts.length, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let run = 0;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // mitre: widen the joint by 1/cos of half the bend so the width stays even
      let miter = 1;
      if (k > 0 && k < n - 1) {
        const ax = pts[k].x - pts[k - 1].x, az = pts[k].z - pts[k - 1].z, al = Math.hypot(ax, az) || 1;
        miter = 1 / Math.max(0.5, (ax / al) * dx + (az / al) * dz);
      }
      if (k > 0) run += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      const hw = tw.width / 2 * miter;
      pos.push(pts[k].x - dz * hw, y0 + 0.12, pts[k].z + dx * hw, pts[k].x + dz * hw, y0 + 0.12, pts[k].z - dx * hw);
      uv.push(0, run / 45, 1, run / 45);
      if (k > 0) { const o = (k - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // both windings face up
    const m = new THREE.Mesh(geo, twyMat); m.material.side = THREE.DoubleSide;
    g.add(m);
    // a round pad at each end and bend, so joints and junctions don't show notches
    for (const p of pts) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(tw.width / 2, 16), apronMat(T));
      c.rotation.x = -Math.PI / 2; c.position.set(p.x, y0 + 0.11, p.z); g.add(c);
    }
  }
  for (const poly of L.aprons) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const uvs = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) / 80, uvs.getY(k) / 80);
    const m = new THREE.Mesh(geo, apronMat(T));
    m.position.y = y0 + 0.1;
    g.add(m);
  }
  // shelters: each opens towards the nearest taxiway
  const has = new THREE.InstancedMesh(new THREE.CylinderGeometry(12, 13, 34, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8c8a80 }), L.shelters.length);
  const door = new THREE.InstancedMesh(new THREE.BoxGeometry(22, 11, 1.2), new THREE.MeshLambertMaterial({ color: 0x4d5048 }), L.shelters.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  L.shelters.forEach((s, k) => {
    let best = Infinity, bx = 0, bz = 0;
    for (const tw of L.taxiways) for (let i = 1; i < tw.pts.length; i++) {
      const a = tw.pts[i - 1], b = tw.pts[i], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((s.x - a.x) * ex + (s.z - a.z) * ez) / l2));
      const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(px - s.x, pz - s.z);
      if (d < best) { best = d; bx = px; bz = pz; }
    }
    // the shelter's axis (local +z after the rotations above) points at the taxiway
    const yaw = Math.atan2(bx - s.x, bz - s.z);
    q.setFromAxisAngle(up, yaw);
    const y = Math.max(y0, terrainHeight(s.x, s.z));
    mtx.compose(new THREE.Vector3(s.x, y, s.z), q, one); has.setMatrixAt(k, mtx);
    mtx.compose(new THREE.Vector3(s.x + Math.sin(yaw) * 17, y + 5.5, s.z + Math.cos(yaw) * 17), q, one); door.setMatrixAt(k, mtx);
  });
  g.add(has, door);
  const wall = new THREE.MeshLambertMaterial({ color: sideOf === 'blue' ? 0x7d8278 : 0x7a7466 });
  const office = new THREE.MeshLambertMaterial({ color: 0xa49a88 });
  const roof = new THREE.MeshLambertMaterial({ color: 0x5c605f });
  for (const b of L.buildings) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), b.kind === 'office' ? office : wall);
    body.position.set(b.x, y0 + b.h / 2, b.z); body.rotation.y = -b.rot; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.6, 0.6, b.d + 0.6), roof);
    top.position.set(b.x, y0 + b.h + 0.3, b.z); top.rotation.y = -b.rot; g.add(top);
  }
  // tower and fuel farm
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 26, 7), new THREE.MeshLambertMaterial({ color: 0xc8c6b8 }));
  shaft.position.set(L.tower.x, y0 + 13, L.tower.z); g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 5.5, 4.5, 8), new THREE.MeshLambertMaterial({ color: 0x23344a, emissive: 0x0b1220 }));
  cab.position.set(L.tower.x, y0 + 28.2, L.tower.z); g.add(cab);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.8, 8), roof);
  cap.position.set(L.tower.x, y0 + 30.8, L.tower.z); g.add(cap);
  const tank = new THREE.InstancedMesh(new THREE.CylinderGeometry(9, 9, 10, 16), new THREE.MeshLambertMaterial({ color: 0xd8d6cc }), 4);
  for (let k = 0; k < 4; k++) { mtx.makeTranslation(L.fuel.x + (k % 2) * 24, y0 + 5, L.fuel.z + Math.floor(k / 2) * 24); tank.setMatrixAt(k, mtx); }
  g.add(tank);
}

let apronMatCache: THREE.Material | null = null;
function apronMat(T: ReturnType<typeof textures>) {
  if (!apronMatCache) {
    const t = T.apron.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    apronMatCache = new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  return apronMatCache;
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
