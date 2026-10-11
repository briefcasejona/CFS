import * as THREE from 'three';
import type { AircraftDef } from '../aircraft/types.js';
import { WEAPONS } from '../weapons/stores.js';
import type { Aircraft, GroundType } from '../sim/entities.js';

const DEG = Math.PI / 180;
type P2 = [number, number];

/** Flat planform in the XZ plane: points are (span x, chordwise y with +y = forward). */
function planform(points: P2[], thickness: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2); // shape y -> -z (forward)
  return new THREE.Mesh(g, mat);
}

/** Vertical surface in the YZ plane: points are (height y, chordwise c with +c = forward). */
function finSurface(points: P2[], thickness: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  s.moveTo(points[0][1], points[0][0]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][1], points[i][0]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2); // shape x (forward) -> -z, extrusion -> x
  return new THREE.Mesh(g, mat);
}

import { HD_RANGE, hdModelsEnabled, requestHdModel, updateHdInstance, type HdInstance } from './hdModels.js';

export interface AircraftModel {
  root: THREE.Group;
  body: THREE.Group;
  stores: (THREE.Object3D | null)[];
  burners: THREE.Mesh[];
  gear: THREE.Group;
  wingL: THREE.Object3D | null;
  wingR: THREE.Object3D | null;
  /** procedural canopy (hidden from inside in the cockpit view) */
  canopy: THREE.Object3D;
  /** fuselage parts around the cockpit (hidden in the F1 view, where the cockpit model takes over) */
  fuselage: THREE.Object3D[];
  /** procedural parts (hidden while the HD model is shown) */
  proc: THREE.Object3D[];
  /** optional high-detail glTF model (see hdModels.ts) */
  hd: HdInstance | null;
  /** stores hung against the HD airframe (done once after it loads) */
  storesSnapped?: boolean;
}

const storeMats = {
  missile: new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }),
  bomb: new THREE.MeshLambertMaterial({ color: 0x4d5a3a }),
  tank: new THREE.MeshLambertMaterial({ color: 0x9aa0a4 }),
  arm: new THREE.MeshLambertMaterial({ color: 0xd8d8cc }),
};

export function storeMesh(id: string): THREE.Object3D {
  const w = WEAPONS[id];
  const g = new THREE.Group();
  if (!w) return g;
  if (w.kind === 'tank') {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 3.2, 4, 10), storeMats.tank);
    m.rotation.x = Math.PI / 2;
    g.add(m);
  } else if (w.kind === 'bomb' || w.kind === 'lgb') {
    const r = Math.max(0.08, Math.cbrt(w.mass / 900) * 0.45);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, r * 6, 4, 8), storeMats.bomb);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    if (w.kind === 'lgb') {
      const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.6, r * 2, 8), storeMats.missile);
      s.rotation.x = -Math.PI / 2; s.position.z = -r * 4.5;
      g.add(s);
    }
  } else {
    const len = Math.min(5, 1.5 + w.mass / 70);
    const r = Math.min(0.35, 0.08 + w.mass / 4000);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), w.kind === 'arm' ? storeMats.arm : storeMats.missile);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r, r * 3, 8), storeMats.missile);
    nose.rotation.x = -Math.PI / 2; nose.position.z = -len / 2 - r * 1.5;
    g.add(nose);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 5, 0.02, r * 3), storeMats.missile);
    fin.position.z = len / 2 - r * 2;
    g.add(fin);
    const fin2 = fin.clone(); fin2.rotation.z = Math.PI / 2; g.add(fin2);
  }
  return g;
}

export function buildAircraftModel(def: AircraftDef, side: 'blue' | 'red'): AircraftModel {
  const md = def.model;
  const L = def.length;
  const color = new THREE.Color(md.color);
  if (side !== def.side) color.offsetHSL(side === 'red' ? 0.05 : -0.05, 0.05, -0.04);
  const mat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.7) });
  const glass = new THREE.MeshLambertMaterial({ color: 0x223344, transparent: true, opacity: 0.85 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fuselage: THREE.Object3D[] = [];

  const R = Math.max(0.55, L * 0.042) * (md.engines === 2 ? 1.15 : 1);
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.8, L * 0.62, 12), mat);
  fus.rotation.x = Math.PI / 2;
  fus.position.z = L * 0.02;
  if (md.engines === 2) fus.scale.set(1.35, 1, 0.85);
  body.add(fus); fuselage.push(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(R * 0.85, L * 0.28, 12), mat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -L * 0.41;
  body.add(nose); fuselage.push(nose);
  const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.8, R * 0.6, L * 0.12, 12), dark);
  tailCone.rotation.x = Math.PI / 2;
  tailCone.position.z = L * 0.39;
  if (md.engines === 2) tailCone.scale.set(1.4, 1, 0.8);
  body.add(tailCone); fuselage.push(tailCone);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(R * 0.65, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.8, 0.9, 2.6);
  canopy.position.set(0, R * 0.6, -L * 0.22);
  body.add(canopy);

  if (md.intake === 'side' || md.intake === 'shoulder') {
    for (const s of [-1, 1]) {
      const it = new THREE.Mesh(new THREE.BoxGeometry(R * 0.6, R * 1.1, L * 0.32), dark);
      it.position.set(s * R * 1.05, md.intake === 'shoulder' ? R * 0.2 : -R * 0.1, -L * 0.04);
      body.add(it); fuselage.push(it);
    }
  } else if (md.intake === 'chin') {
    const it = new THREE.Mesh(new THREE.BoxGeometry(R * 1.1, R * 0.7, L * 0.3), dark);
    it.position.set(0, -R * 0.95, -L * 0.03);
    body.add(it); fuselage.push(it);
  } else {
    for (const s of [-1, 1]) {
      const it = new THREE.Mesh(new THREE.BoxGeometry(R * 0.7, R * 0.75, L * 0.3), dark);
      it.position.set(s * R * 0.75, -R * 0.85, -L * 0.02);
      body.add(it); fuselage.push(it);
    }
  }

  const burners: THREE.Mesh[] = [];
  const burnMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const nozMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, side: THREE.DoubleSide });
  for (const x of md.engines === 2 ? [-R * 0.6, R * 0.6] : [0]) {
    const nz = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.45, R * 0.5, L * 0.06, 10, 1, true), nozMat);
    nz.rotation.x = Math.PI / 2;
    nz.position.set(x, 0, L * 0.47);
    body.add(nz);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(R * 0.42, L * 0.35, 10, 1, true), burnMat);
    plume.rotation.x = -Math.PI / 2;
    plume.position.set(x, 0, L * 0.67);
    plume.visible = false;
    body.add(plume);
    burners.push(plume);
  }

  // wings
  const halfSpan = def.span / 2;
  const S = def.wingArea;
  const sweep = md.sweep * DEG;
  const wingZ = md.wing === 'delta' || md.wing === 'cdelta' ? L * 0.08 : -L * 0.02;
  const makeWing = (sgn: number) => {
    const span = halfSpan - R;
    const le = Math.tan(sweep) * span;
    let pts: P2[];
    if (md.wing === 'delta') {
      const root = (2 * S) / (def.span * 1.12);
      pts = [[0, root * 0.55], [span, root * 0.55 - le], [span, root * 0.55 - le - root * 0.08], [0, -root * 0.45]];
    } else if (md.wing === 'cdelta') {
      const root = (2 * S) / (def.span * 1.25);
      pts = [[0, root * 0.6], [span, root * 0.6 - le], [span, root * 0.6 - le - root * 0.22], [0, -root * 0.4]];
    } else {
      const taper = md.wing === 'swing' ? 0.35 : 0.3;
      const root = (2 * S) / (def.span * (1 + taper));
      pts = [[0, root * 0.5], [span, root * 0.5 - le], [span, root * 0.5 - le - root * taper], [0, -root * 0.5]];
    }
    if (sgn < 0) pts = pts.map(([x, y]) => [-x, y] as P2).reverse();
    const w = planform(pts, 0.18, mat);
    const pivot = new THREE.Group();
    pivot.position.set(sgn * R * 0.9, md.wing === 'shoulder' ? R * 0.6 : -R * 0.15, wingZ);
    pivot.add(w);
    return pivot;
  };
  const wingR = makeWing(1), wingL = makeWing(-1);
  body.add(wingR, wingL);
  if (md.wing === 'swing') {
    const glove = planform([[-R * 2.4, L * 0.05], [R * 2.4, L * 0.05], [R * 1.6, L * 0.12 + 1], [-R * 1.6, L * 0.12 + 1]], 0.25, mat);
    body.add(glove); fuselage.push(glove);
  }
  if (md.canard) {
    for (const sgn of [-1, 1]) {
      const c = L * 0.08;
      let pts: P2[] = [[0, c * 0.6], [c * 1.3, -c * 0.2], [c * 1.3, -c * 0.5], [0, -c * 0.5]];
      if (sgn < 0) pts = pts.map(([x, y]) => [-x, y] as P2).reverse();
      const cm = planform(pts, 0.1, mat);
      cm.position.set(sgn * R * 0.85, R * 0.2, -L * 0.24);
      body.add(cm);
    }
  }
  if (md.tailplane) {
    for (const sgn of [-1, 1]) {
      const c = L * 0.13;
      const span = def.span * 0.2;
      let pts: P2[] = [[0, c * 0.5], [span, -c * 0.1], [span, -c * 0.45], [0, -c * 0.5]];
      if (sgn < 0) pts = pts.map(([x, y]) => [-x, y] as P2).reverse();
      const t = planform(pts, 0.1, mat);
      t.position.set(sgn * R * 0.8, 0, L * 0.38);
      body.add(t);
    }
  }
  const finH = L * 0.22;
  const finC = L * 0.2;
  for (const sgn of md.twinTail ? [-1, 1] : [0]) {
    const fin = finSurface([[0, finC * 0.5], [finH, finC * 0.5 - finH * 0.9], [finH, finC * 0.5 - finH * 0.9 - finC * 0.35], [0, -finC * 0.5]], 0.12, mat);
    fin.position.set(sgn * R * 0.75, R * 0.6, L * 0.36);
    fin.rotation.z = -sgn * (md.tailCant ?? 0) * DEG;
    body.add(fin);
  }

  const gear = new THREE.Group();
  const gmat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const smat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
  const gd = def.gear;
  const strutH = Math.max(0.3, gd.height - 0.35);
  const wheel = (x: number, z: number) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, strutH, 0.12), smat);
    s.position.set(x, -strutH / 2 - 0.3, z);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12), gmat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, -gd.height + 0.35, z);
    gear.add(s, w);
  };
  wheel(0, -gd.nose);
  wheel(-gd.track / 2, gd.main);
  wheel(gd.track / 2, gd.main);
  body.add(gear);

  const model: AircraftModel = { root, body, stores: [], burners, gear, wingL, wingR, canopy, fuselage, proc: body.children.filter((c) => !burners.includes(c as THREE.Mesh)), hd: null };
  requestHdModel(def, (inst) => { model.hd = inst; body.add(inst.root); });
  return model;
}

/** Rebuild / show-hide store meshes to match the aircraft's stores. */
export function syncStores(model: AircraftModel, ac: Aircraft, stationOffset: (i: number) => THREE.Vector3) {
  if (model.stores.length !== ac.stores.length) {
    for (const s of model.stores) if (s) model.body.remove(s);
    model.stores = ac.stores.map((id, i) => {
      if (!id) return null;
      const m = storeMesh(id);
      m.position.copy(stationOffset(i));
      model.body.add(m);
      return m;
    });
  }
  for (let i = 0; i < ac.stores.length; i++) {
    const m = model.stores[i];
    if (m) m.visible = !!ac.stores[i] && ac.def.id !== 'su57';
  }
  // once the HD airframe is in, hang every store right under the surface above its station
  if (model.hd && !model.storesSnapped) { snapStores(model, stationOffset); model.storesSnapped = true; }
}

const snapRay = new THREE.Raycaster();
/** raise/lower each store so its top touches the airframe (wing, pylon or fuselage) directly above its station */
function snapStores(model: AircraftModel, stationOffset: (i: number) => THREE.Vector3) {
  const hd = model.hd!;
  const targets: THREE.Object3D[] = [];
  hd.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.userData.role === 'body' && !hd.glass.includes(o)) targets.push(o); });
  model.root.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(model.body.matrixWorld);
  model.stores.forEach((m, i) => {
    if (!m) return;
    const st = stationOffset(i);
    const box = new THREE.Box3().setFromObject(m, true);
    const top = box.max.y - m.getWorldPosition(new THREE.Vector3()).y;   // store top above its origin (≈ radius)
    snapRay.set(model.body.localToWorld(new THREE.Vector3(st.x, st.y - 4, st.z)), up);
    snapRay.far = 8;
    const hit = snapRay.intersectObjects(targets, false)[0];
    if (!hit) return;
    const local = model.body.worldToLocal(hit.point.clone());
    m.position.set(st.x, local.y - top - 0.04, st.z);   // a hand's width of pylon/rail between store and skin
  });
}

export function updateAircraftModel(model: AircraftModel, ac: Aircraft, t: number, camDist = 0) {
  const fm = ac.fm;
  model.root.position.copy(fm.pos);
  model.root.quaternion.copy(fm.quat);
  const ab = fm.abFrac;
  for (const b of model.burners) {
    b.visible = ab > 0.05 && ac.alive;
    b.scale.set(1, 0.6 + ab * 0.6 + Math.sin(t * 60 + b.id) * 0.05, 1);
  }
  model.gear.visible = fm.gearPos > 0.3;
  model.gear.scale.y = Math.max(0.05, fm.gearPos);
  if (ac.def.fcs.swingWing && model.wingL && model.wingR) {
    const sw = (fm.sweep - 20) * DEG;
    model.wingR.rotation.y = sw;
    model.wingL.rotation.y = -sw;
  }
  if (model.hd) {
    const useHd = hdModelsEnabled() && camDist < HD_RANGE;
    model.hd.root.visible = useHd;
    for (const p of model.proc) p.visible = !useHd;
    if (useHd) { model.gear.visible = false; updateHdInstance(model.hd, fm.gearPos, fm.sweep); }
    else model.gear.visible = fm.gearPos > 0.3;
  }
}

// ------------------------------------------------------------------ ground units
const groundCache = new Map<string, THREE.Object3D>();
export function groundMesh(type: GroundType, side: 'blue' | 'red'): THREE.Object3D {
  const key = type + side;
  let proto = groundCache.get(key);
  if (!proto) { proto = buildGroundProto(type, side); groundCache.set(key, proto); }
  return proto.clone();
}

function buildGroundProto(type: GroundType, side: 'blue' | 'red'): THREE.Object3D {
  const g = new THREE.Group();
  const camo = new THREE.MeshLambertMaterial({ color: side === 'blue' ? 0x5d6448 : 0x5a5c44 });
  const conc = new THREE.MeshLambertMaterial({ color: 0x8f8c84 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x5f6266 });
  const box = (w: number, h: number, d: number, m: THREE.Material, y = h / 2, x = 0, z = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };
  switch (type) {
    case 'tank': box(3.6, 1.3, 7, camo, 0.9); box(2.2, 0.8, 2.8, camo, 1.9); box(0.25, 0.25, 4, camo, 1.95, 0, -2.6); break;
    case 'apc': box(3, 2, 6.5, camo, 1.3); break;
    case 'truck': box(2.4, 2.4, 3, camo, 1.4, 0, -2); box(2.4, 2.8, 5, camo, 1.6, 0, 1.8); break;
    case 'artillery': box(3.2, 1.6, 7, camo, 1.0); box(2.6, 1.4, 3, camo, 2.2); box(0.3, 0.3, 6, camo, 2.6, 0, -3.5); break;
    case 'sam_radar': {
      box(3, 2.2, 7, camo, 1.3);
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 16), steel);
      dish.rotation.x = Math.PI / 2.4; dish.position.set(0, 4.5, 0); g.add(dish);
      break;
    }
    case 'sam_launcher': {
      box(3, 1.6, 7, camo, 1.0);
      for (const x of [-0.7, 0.7]) { const t = box(0.6, 0.6, 6, steel, 3.0, x, 0); t.rotation.x = 0.6; }
      break;
    }
    case 'ewr': { box(4, 3, 4, conc, 1.5); const a = box(10, 2.5, 0.4, steel, 6); a.rotation.y = 0.4; break; }
    case 'aaa': box(3, 1.4, 6.5, camo, 1); box(2, 1, 2, camo, 2); for (const x of [-0.5, 0.5]) box(0.12, 0.12, 2.5, steel, 2.4, x, -1.2); break;
    case 'building': box(25, 12, 25, conc); break;
    case 'hangar': box(40, 14, 36, conc); break;
    case 'bridge': box(12, 3, 160, conc, 10); for (const z of [-60, -20, 20, 60]) box(3, 10, 3, conc, 5, 0, z); break;
    case 'fuel': for (const x of [-8, 8]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9, 16), conc); c.position.set(x, 4.5, 0); g.add(c); } break;
    case 'factory': box(60, 16, 40, conc); box(4, 35, 4, conc, 17.5, 20, 10); break;
    case 'bunker': box(18, 5, 18, conc, 2.5); break;
  }
  return g;
}
