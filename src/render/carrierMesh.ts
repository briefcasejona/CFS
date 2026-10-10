import * as THREE from 'three';
import { DECK_H, DECK_GEOM, landingToDeck } from '../sim/carrier.js';

/**
 * Procedural Nimitz-class carrier. Local frame: origin = deck centre at the waterline, −Z = bow, +X = starboard
 * (matches the sim's deck frame u = −z, v = x). The flight deck is one textured plane with painted markings,
 * wires and catapult tracks; the hull is extruded under it.
 */
const U0 = -165, U1 = 170, V0 = -52, V1 = 36;   // deck texture bounds (m)
const PX = 6;                                      // texture pixels per metre

function poly(ctx: CanvasRenderingContext2D, pts: Array<{ u: number; v: number }>) {
  ctx.beginPath();
  pts.forEach((p, i) => { const x = (p.v - V0) * PX, y = (U1 - p.u) * PX; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
}
const angled = (s0: number, s1: number, t0: number, t1: number) =>
  [landingToDeck(s0, t0), landingToDeck(s1, t0), landingToDeck(s1, t1), landingToDeck(s0, t1)];
const { MAIN, ISLAND, LAND, CATS, WIRES } = DECK_GEOM;
const mainPts = [
  { u: MAIN.u0, v: MAIN.v0 }, { u: MAIN.u0, v: MAIN.v1 }, { u: MAIN.u1 - 40, v: MAIN.v1 },
  { u: MAIN.u1, v: MAIN.v1 - 12 }, { u: MAIN.u1, v: MAIN.v0 + 6 }, { u: MAIN.u1 - 20, v: MAIN.v0 },
];
const landPts = angled(LAND.s0, LAND.s1, -LAND.half, LAND.half);

function deckTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = (V1 - V0) * PX; cv.height = (U1 - U0) * PX;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#3c3f44';
  poly(c, mainPts); c.fill();
  poly(c, landPts); c.fill();
  // tyre-worn landing area
  c.fillStyle = 'rgba(255,255,255,0.05)';
  poly(c, angled(-70, 40, -6, 6)); c.fill();
  // landing area edges (white) and centreline (dashed white)
  c.strokeStyle = '#e8e8e0'; c.lineWidth = 0.5 * PX;
  poly(c, angled(LAND.s0 + 2, LAND.s1 - 2, -LAND.half + 1, LAND.half - 1)); c.stroke();
  c.setLineDash([4 * PX, 4 * PX]);
  poly(c, [landingToDeck(LAND.s0 + 4, 0), landingToDeck(LAND.s1 - 4, 0)]); c.stroke();
  c.setLineDash([]);
  // foul line along the starboard edge of the landing area
  c.strokeStyle = '#d33'; c.lineWidth = 0.4 * PX;
  poly(c, [landingToDeck(LAND.s0 + 2, LAND.half + 1), landingToDeck(LAND.s1 - 30, LAND.half + 1)]); c.stroke();
  // arresting wires (dark cables with light pendant markers)
  for (const s of WIRES) {
    c.strokeStyle = '#1a1a1a'; c.lineWidth = 0.35 * PX;
    poly(c, [landingToDeck(s, -LAND.half + 2), landingToDeck(s, LAND.half - 2)]); c.stroke();
    c.fillStyle = '#ddd';
    for (const t of [-LAND.half + 2, LAND.half - 2]) { const p = landingToDeck(s, t); c.fillRect((p.v - V0) * PX - 3, (U1 - p.u) * PX - 3, 6, 6); }
  }
  // catapult tracks + jet blast deflectors
  for (const k of CATS) {
    c.strokeStyle = '#25272a'; c.lineWidth = 0.6 * PX;
    poly(c, [{ u: k.u, v: k.v }, { u: k.u + k.stroke, v: k.v }]); c.stroke();
    c.fillStyle = '#5a5d62';
    c.fillRect((k.v - 6 - V0) * PX, (U1 - (k.u - 14)) * PX, 12 * PX, 1.2 * PX);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function extrude(pts: Array<{ u: number; v: number }>, y0: number, y1: number, mat: THREE.Material) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.v, -p.u)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(Math.PI / 2);       // shape XY → XZ (y up), extruded downwards from 0
  g.translate(0, y1, 0);
  return new THREE.Mesh(g, mat);
}

let deckTex: THREE.CanvasTexture | null = null;

export function buildCarrierMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'carrier';
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x6b7077, side: THREE.DoubleSide });
  // hull: narrower at the waterline than the flight deck
  const hullPts = [
    { u: -150, v: -18 }, { u: -150, v: 18 }, { u: 110, v: 18 }, { u: 160, v: 2 }, { u: 160, v: -2 }, { u: 110, v: -18 },
  ];
  g.add(extrude(hullPts, -11, DECK_H - 4, hullMat));
  g.add(extrude(mainPts, DECK_H - 4, DECK_H - 0.05, hullMat));
  g.add(extrude(landPts, DECK_H - 3, DECK_H - 0.05, hullMat));
  // flight deck surface
  deckTex ??= deckTexture();
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(V1 - V0, U1 - U0),
    new THREE.MeshLambertMaterial({ map: deckTex, transparent: true, alphaTest: 0.5 }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set((V0 + V1) / 2, DECK_H, -(U0 + U1) / 2);
  g.add(deck);
  // island with bridge windows, mast and radar
  const isl = new THREE.Mesh(new THREE.BoxGeometry(ISLAND.v1 - ISLAND.v0, ISLAND.h, ISLAND.u1 - ISLAND.u0), hullMat);
  isl.position.set((ISLAND.v0 + ISLAND.v1) / 2, DECK_H + ISLAND.h / 2, -(ISLAND.u0 + ISLAND.u1) / 2);
  g.add(isl);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(ISLAND.v1 - ISLAND.v0 + 0.4, 2.2, ISLAND.u1 - ISLAND.u0 - 10), new THREE.MeshLambertMaterial({ color: 0x1b2430 }));
  glass.position.set(isl.position.x, DECK_H + ISLAND.h - 4, isl.position.z + 3);
  g.add(glass);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 18, 6), hullMat);
  mast.position.set(isl.position.x, DECK_H + ISLAND.h + 9, isl.position.z + 6);
  g.add(mast);
  const radar = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.6), new THREE.MeshLambertMaterial({ color: 0x3a3d42 }));
  radar.position.set(isl.position.x, DECK_H + ISLAND.h + 15, isl.position.z + 6);
  radar.name = 'radar';
  g.add(radar);
  // wake: a long pale strip astern
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(34, 900), new THREE.MeshBasicMaterial({ color: 0xcfe0ea, transparent: true, opacity: 0.35, depthWrite: false }));
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0.3, 150 + 450);
  g.add(wake);
  return g;
}
