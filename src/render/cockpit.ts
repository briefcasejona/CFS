// Procedural 3D cockpit around the pilot's eye (F1 view). Generic per layout rather than full-fidelity: it gives
// spatial reference (glareshield, panel, consoles, canopy frame, seat) and live MFDs; the HUD stays screen-space
// (collimated at infinity) and is drawn by ui/hud.ts on top.
import * as THREE from 'three';
import type { AircraftDef } from '../aircraft/types.js';

export interface Cockpit {
  group: THREE.Group;
  /** textures fed from the MFD canvases — flag needsUpdate each frame */
  screens: THREE.CanvasTexture[];
}

const MAT = {
  shell: new THREE.MeshLambertMaterial({ color: 0x2c3136 }),
  panel: new THREE.MeshLambertMaterial({ color: 0x1c1f22 }),
  frame: new THREE.MeshLambertMaterial({ color: 0x3a3f44 }),
  seat: new THREE.MeshLambertMaterial({ color: 0x3b3a30 }),
  bezel: new THREE.MeshLambertMaterial({ color: 0x111314 }),
};

/** One-piece bubble canopies have no front bow. */
const BUBBLE = new Set(['F-16', 'F-15', 'JAS 39', 'Rafale C', 'Typhoon', 'Su-57', 'F/A-18', 'Mirage 2000-5', 'MiG-29A', 'Su-27S', 'Su-30SM']);

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

/**
 * Build a cockpit in eye-relative coordinates (origin = pilot's eye, −Z forward, +Y up, metres).
 * `mfds` are the existing MFD canvases; they become live screens on the instrument panel.
 */
export function buildCockpit(def: AircraftDef, mfds: HTMLCanvasElement[]): Cockpit {
  const g = new THREE.Group();
  g.name = 'cockpit';
  const fam = def.family ?? def.name;
  const narrow = def.span < 10 ? 0.92 : 1; // light fighters have narrower tubs
  const W = 0.86 * narrow;

  // instrument panel (tilted back), glareshield above it, consoles and rails
  g.add(box(W, 0.34, 0.05, MAT.panel, 0, -0.5, -0.8, -0.25));
  g.add(box(W * 0.9, 0.05, 0.22, MAT.shell, 0, -0.29, -0.74));
  for (const s of [-1, 1]) {
    g.add(box(0.2, 0.1, 0.95, MAT.shell, s * (W / 2 + 0.02), -0.58, -0.12));    // side console
    g.add(box(0.06, 0.06, 1.7, MAT.frame, s * (W / 2 + 0.1), -0.2, -0.1));       // canopy rail
    g.add(box(0.07, 0.42, 0.9, MAT.shell, s * (W / 2 + 0.13), -0.42, -0.2));     // tub wall
  }
  // forward fuselage seen over the glareshield, the spine behind and the cockpit floor
  const L = def.length;
  const R = Math.max(0.55, L * 0.042) * (def.model.engines === 2 ? 1.15 : 1);
  const skin = new THREE.MeshLambertMaterial({ color: def.model.color });
  const noseLen = L * 0.3, noseR = R * 0.78;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(noseR, noseLen, 18), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, -0.31 - noseR, -0.85 - noseLen / 2);
  g.add(nose);
  const coaming = new THREE.Mesh(new THREE.CylinderGeometry(noseR, noseR, 0.5, 18, 1, false, -Math.PI / 2, Math.PI), skin);
  coaming.rotation.x = Math.PI / 2;
  coaming.position.set(0, -0.31 - noseR, -0.62);
  g.add(coaming);
  g.add(box(R * 1.3, 0.25, L * 0.35, skin, 0, -0.42, 0.55 + L * 0.175)); // spine
  g.add(box(W + 0.3, 0.05, 2.4, MAT.shell, 0, -0.98, 0.1));                 // floor
  // canopy bow (windscreen frame) — not on one-piece bubble canopies
  if (!BUBBLE.has(fam)) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.028, 6, 28, Math.PI), MAT.frame);
    bow.position.set(0, -0.2, -0.5);
    g.add(bow);
  }
  // ejection seat headrest behind the pilot (visible when checking six)
  g.add(box(0.36, 0.5, 0.16, MAT.seat, 0, -0.12, 0.28));
  g.add(box(0.44, 0.75, 0.12, MAT.seat, 0, -0.62, 0.32));
  // tandem rear cockpit for two-seaters
  if (def.seats === 2) {
    g.add(box(W, 0.3, 0.05, MAT.panel, 0, -0.35, 0.68, -0.2));
    g.add(box(0.36, 0.5, 0.16, MAT.seat, 0, -0.1, 1.45));
    if (!BUBBLE.has(fam)) {
      const bow2 = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.025, 6, 28, Math.PI), MAT.frame);
      bow2.position.set(0, -0.2, 0.62);
      g.add(bow2);
    }
  }
  // live MFDs
  const screens: THREE.CanvasTexture[] = [];
  mfds.forEach((cv, i) => {
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    screens.push(tex);
    const s = mfds.length === 1 ? 0 : i === 0 ? -1 : 1;
    const bezel = box(0.2, 0.2, 0.02, MAT.bezel, s * 0.2, -0.52, -0.77, -0.25);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.165, 0.165), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 0, 0.0115);
    bezel.add(scr);
    g.add(bezel);
  });
  g.visible = false;
  return { group: g, screens };
}
