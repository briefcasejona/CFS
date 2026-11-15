// Everything that exists only while the player is in cockpit view: the cockpit model, the clickable switches,
// lights, gauges and displays, and the live MFD screens. It is built when the player enters cockpit view and
// unloaded (removed and its GPU memory freed) when the player leaves it, so the outside views draw only the exterior
// model. The aircraft's systems keep running either way: the engine, fuel and electrics do not stop when you look
// at the jet from outside.
//
// Which cockpit is used, best first:
//  1. the aircraft's own cockpit model (cockpitModels.ts), once its file is there and has loaded;
//  2. the exterior HD model's built-in cockpit;
//  3. the procedural cockpit (cockpit.ts).
import * as THREE from 'three';
import type { Aircraft } from '../sim/entities.js';
import type { AircraftModel } from './models.js';
import { hdSpecFor } from './hdModels.js';
import { buildCockpit, type Cockpit } from './cockpit.js';
import { Cockpit3D, type PitHit } from './cockpit3d.js';
import { cockpitSpecFor, disposeTree, loadCockpitModel, type CockpitModelSpec } from './cockpitModels.js';

type Source = 'model' | 'hd' | 'procedural';
type Screen = { c: [number, number, number]; w: number; h: number; n: [number, number, number]; screen: 0 | 1 };

export class CockpitView {
  /** the clickable cockpit of a jet with its own systems (null outside cockpit view) */
  pit: Cockpit3D | null = null;
  /** which cockpit is in use, or null when nothing is loaded */
  source: Source | null = null;
  private acId = -1;
  private model: THREE.Group | null = null;
  private modelSpec: CockpitModelSpec | null = null;
  private loading = false;
  /** bumped on every unload, so a model that finishes loading after the player left cockpit view is thrown away */
  private gen = 0;
  private proc: Cockpit | null = null;
  private screens: THREE.Mesh[] = [];
  private screenTex: THREE.CanvasTexture[] = [];
  private body: THREE.Object3D | null = null;
  private hdHidden: THREE.Object3D[] = [];

  constructor(private mfdCanvases: () => HTMLCanvasElement[]) {}

  get loaded() { return this.source !== null || this.loading; }

  /** Each frame for the player's jet. `inside`: the camera is in cockpit view. */
  update(m: AircraftModel, ac: Aircraft, inside: boolean, dt: number) {
    if (!inside) { if (this.loaded) this.unload(m); this.setExterior(m, true); return; }
    if (this.acId !== ac.id || this.body !== m.body) this.unload(m);
    this.acId = ac.id; this.body = m.body;
    this.setExterior(m, false);
    this.requestModel(ac);
    const hdOn = !!m.hd && m.hd.root.visible;
    const src: Source = this.model ? 'model' : hdOn && m.hd!.cockpit.length > 0 ? 'hd' : 'procedural';
    if (src !== this.source) this.switchSource(m, ac, src);
    const eye = this.eye(m, ac);
    // the procedural fuselage encloses the eye: the cockpit provides nose, spine and floor instead
    if (!hdOn) for (const f of m.fuselage) f.visible = src !== 'procedural';
    if (this.proc) { this.proc.group.position.copy(eye); for (const s of this.proc.screens) s.needsUpdate = true; }
    for (const t of this.screenTex) t.needsUpdate = true;
    this.updatePit(m, ac, eye, dt);
  }

  /** The eye point in the body frame, for the cockpit in use. */
  eye(m: AircraftModel | undefined, ac: Aircraft): THREE.Vector3 {
    if (m?.hd && m.hd.root.visible && m.hd.cockpit.length) return m.hd.eye.clone();
    const L = ac.def.length;
    const R = Math.max(0.55, L * 0.042) * (ac.def.model.engines === 2 ? 1.15 : 1);
    return new THREE.Vector3(0, R * 0.95, -L * 0.22);
  }

  pick(cam: THREE.Camera, ndcX: number, ndcY: number): PitHit | null {
    return this.pit && this.pit.group.visible ? this.pit.pick(cam, ndcX, ndcY) : null;
  }

  /** From the outside the canopy glass shows; from inside it is hidden. */
  private setExterior(m: AircraftModel, outside: boolean) {
    const hdOn = !!m.hd && m.hd.root.visible;
    m.canopy.visible = outside && !hdOn;
    if (m.hd) for (const gl of m.hd.glass) gl.visible = outside;
    if (outside && !hdOn) for (const f of m.fuselage) f.visible = true;
  }

  private requestModel(ac: Aircraft) {
    if (this.model || this.loading) return;
    const spec = cockpitSpecFor(ac.def);
    if (!spec || this.modelSpec === spec) return;   // none, or this one already failed for this visit
    this.modelSpec = spec;
    this.loading = true;
    const gen = this.gen;
    void loadCockpitModel(spec).then((root) => {
      if (gen !== this.gen) { if (root) disposeTree(root); return; }
      this.loading = false;
      this.model = root;
    });
  }

  private switchSource(m: AircraftModel, ac: Aircraft, src: Source) {
    this.dropDrawn(m);
    this.source = src;
    if (src === 'model') {
      // the model's design eye goes where the exterior's eye is, so it lines up with the canopy
      this.model!.position.copy(this.eye(m, ac)).sub(new THREE.Vector3(...this.modelSpec!.eye));
      m.body.add(this.model!);
      // the exterior's own cockpit (and its HUD glass) would show through the new one
      if (m.hd) for (const c of m.hd.cockpit) { if (c.visible) { c.visible = false; this.hdHidden.push(c); } }
      this.addScreens(m.body, this.modelFaces());
    } else if (src === 'hd') {
      this.addScreens(m.body, hdSpecFor(ac.def)?.mfds);
    } else {
      this.proc = buildCockpit(ac.def, this.mfdCanvases());
      this.proc.group.visible = true;
      m.body.add(this.proc.group);
    }
  }

  /** the cockpit model's MFD faces in the body frame */
  private modelFaces(): Screen[] | undefined {
    const o = this.model?.position;
    return o && this.modelSpec?.mfds?.map((d) => ({ ...d, c: [d.c[0] + o.x, d.c[1] + o.y, d.c[2] + o.z] as [number, number, number] }));
  }

  /** Live MFD pages laid over a cockpit's painted screens. */
  private addScreens(parent: THREE.Object3D, faces: Screen[] | undefined) {
    if (!faces?.length) return;
    this.screenTex = this.mfdCanvases().map((c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
    for (const d of faces) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshBasicMaterial({ map: this.screenTex[d.screen] ?? null, toneMapped: false }));
      const c = new THREE.Vector3(...d.c), n = new THREE.Vector3(...d.n).normalize();
      q.position.copy(c).addScaledVector(n, 0.003);   // just proud of the painted screen
      q.lookAt(c.clone().add(n));
      q.renderOrder = 2;
      parent.add(q);
      this.screens.push(q);
    }
  }

  private updatePit(m: AircraftModel, ac: Aircraft, eye: THREE.Vector3, dt: number) {
    const sys = ac.systems, layout = sys?.cockpit;
    if (!sys || !layout) return;
    if (!this.pit || this.pit.sys !== sys) {
      if (this.pit) disposeTree(this.pit.group);
      this.pit = new Cockpit3D(sys, layout);
    }
    const pit = this.pit;
    if (pit.group.parent !== m.body) m.body.add(pit.group);
    pit.group.position.copy(eye);
    pit.group.visible = true;
    const key = `${ac.id}:${this.source}`;
    if (pit.fitted !== key) {
      m.body.updateWorldMatrix(true, true);
      const meshes = this.source === 'model' ? [this.model!] : this.source === 'hd' ? m.hd!.cockpit : this.proc ? [this.proc.group] : [];
      pit.fit(meshes, key);
      const faces = this.source === 'model' ? this.modelFaces() : this.source === 'hd' ? hdSpecFor(ac.def)?.mfds : undefined;
      if (faces?.length) for (const d of faces) {
        const n = new THREE.Vector3(...d.n).normalize();
        pit.placeMfd(d.screen, new THREE.Vector3(...d.c).sub(eye).addScaledVector(n, 0.002), n, d.w, d.h);
      } else layout.mfds.forEach((d, i) => pit.placeMfd(i, new THREE.Vector3(...d.c), new THREE.Vector3(...d.n), d.w, d.h));
    }
    pit.update(sys, dt);
  }

  /** Take down what is drawn for the current cockpit source (the loaded model file itself is kept). */
  private dropDrawn(m: AircraftModel | null) {
    for (const q of this.screens) disposeTree(q);
    for (const t of this.screenTex) t.dispose();
    this.screens = []; this.screenTex = [];
    if (this.proc) { disposeTree(this.proc.group); this.proc = null; }
    if (this.model) this.model.parent?.remove(this.model);
    for (const c of this.hdHidden) c.visible = true;
    this.hdHidden = [];
    if (this.pit) this.pit.fitted = '';
    if (m && !(m.hd && m.hd.root.visible)) for (const f of m.fuselage) f.visible = true;
    this.source = null;
  }

  /** Leave cockpit view: remove everything and free its memory. */
  unload(m: AircraftModel | null = null) {
    this.dropDrawn(m);
    if (this.model) { disposeTree(this.model); this.model = null; }
    if (this.pit) { disposeTree(this.pit.group); this.pit = null; }
    this.modelSpec = null;
    this.loading = false;
    this.gen++;
    this.acId = -1; this.body = null;
  }
}
