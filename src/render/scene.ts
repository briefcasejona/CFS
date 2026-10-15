import * as THREE from 'three';
import type { World } from '../sim/world.js';
import type { Aircraft, GroundUnit } from '../sim/entities.js';
import type { Missile } from '../weapons/missile.js';
import { TerrainRenderer, buildScenery } from './terrainMesh.js';
import { buildCarrierMesh } from './carrierMesh.js';
import { buildAircraftModel, updateAircraftModel, syncStores, groundMesh, storeMesh, missileDims, type AircraftModel } from './models.js';
import { createBurner, type Burner } from './afterburner.js';
import { hdSpecFor } from './hdModels.js';
import { updatePapi, type Airfield } from './airfield.js';
import { Effects } from './particles.js';

/** the VR HUD quad sits far out so it reads as collimated (at infinity) */
export const VR_HUD_DIST = 30;
/** size (w, h) of a quad at distance d that covers a camera's view (vertical fov in degrees) */
export function hudQuadSize(fovDeg: number, aspect: number, d: number): [number, number] {
  const h = 2 * d * Math.tan((fovDeg * Math.PI / 180) / 2);
  return [h * aspect, h];
}
import { surfaceHeight, theaterVersion } from '../world/theater.js';
import { buildCockpit, type Cockpit } from './cockpit.js';
import { clamp } from '../core/math.js';

export type ViewMode = 'cockpit' | 'chase' | 'flyby' | 'target' | 'weapon' | 'enemy';

export interface Weather {
  visibilityKm: number;
  clouds: 'clear' | 'scattered' | 'overcast';
  cloudBase: number;   // m
  timeOfDay: number;   // hours 0..24
}

// ------------------------------------------------------------------ renderer
export class SceneRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  terrain = new TerrainRenderer();
  scenery: THREE.Group;
  sun = new THREE.DirectionalLight(0xffffff, 2.2);
  hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4436, 1.0);
  sky: THREE.Mesh;
  clouds: THREE.Mesh;
  view: ViewMode = 'cockpit';
  headYaw = 0; headPitch = 0;
  chaseYaw = 0; chasePitch = 0.15; chaseDist = 30;
  /** chase camera keeps the horizon level instead of rolling with the jet (toggle: F2 again) */
  chaseLevel = false;
  fovBase = 75;
  zoom = 1;
  viewDist = 150000;
  /** fog density set by the weather (at ground level) */
  private baseFog = 0.00004;
  private acModels = new Map<number, AircraftModel>();
  private groundModels = new Map<number, THREE.Object3D>();
  private missileModels = new Map<number, THREE.Object3D>();
  private fx = new Effects();
  private flybyPos = new THREE.Vector3();
  private flybyTimer = 0;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private smoothQuat = new THREE.Quaternion();
  private deadMat = new THREE.MeshLambertMaterial({ color: 0x222018 });
  private theaterVer = theaterVersion;
  /** MFD canvases shown as live screens in the 3D cockpit (set by the flight session) */
  mfdCanvases: HTMLCanvasElement[] = [];
  private cockpit: Cockpit | null = null;
  private cockpitDef = '';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(this.fovBase, 1, 0.3, 450000);
    // the camera lives in a rig: on a monitor the rig stays at the origin; in VR it carries the cockpit eye point and
    // the jet's attitude while the headset pose moves the camera inside it
    this.rig.add(this.camera);
    this.scene.add(this.rig);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.terrain.group);
    this.scenery = buildScenery();
    this.scene.add(this.scenery);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x3a6fb0) }, horizon: { value: new THREE.Color(0xb8cde0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h,0.0), 0.5));
        if (h < 0.0) c = horizon * 0.9;
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += vec3(1.0,0.9,0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    const ctex = makeCloudTexture();
    ctex.wrapS = ctex.wrapT = THREE.RepeatWrapping;
    ctex.repeat.set(30, 30);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(300000, 300000),
      new THREE.MeshLambertMaterial({ map: ctex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 }));
    this.clouds.rotation.x = -Math.PI / 2;
    this.scene.add(this.clouds);
    this.scene.add(this.fx.group);
    this.scene.fog = new THREE.FogExp2(0xb8cde0, 0.00002);
    this.setWeather({ visibilityKm: 60, clouds: 'scattered', cloudBase: 3500, timeOfDay: 11 });
  }

  setWeather(w: Weather) {
    const sunAngle = ((w.timeOfDay - 6) / 12) * Math.PI;
    const elev = Math.sin(sunAngle);
    this.sunDir.set(Math.cos(sunAngle) * 0.8, Math.max(-0.2, elev), -0.45).normalize();
    const day = clamp(elev * 3, 0, 1);
    const dusk = elev > -0.1 ? clamp(1 - Math.abs(elev) * 4, 0, 1) : 0;
    const top = new THREE.Color(0x0a1020).lerp(new THREE.Color(0x3a6fb0), day);
    const horizon = new THREE.Color(0x151a24).lerp(new THREE.Color(0xb8cde0), day).lerp(new THREE.Color(0xe09060), dusk * 0.6);
    const sm = this.sky.material as THREE.ShaderMaterial;
    sm.uniforms.top.value.copy(top);
    sm.uniforms.horizon.value.copy(horizon);
    sm.uniforms.sunDir.value.copy(this.sunDir);
    this.sun.intensity = 0.15 + 2.2 * day;
    this.sun.color.setRGB(1, 0.9 + 0.1 * day, 0.75 + 0.25 * day);
    this.hemi.intensity = 0.25 + 0.85 * day;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(horizon);
    fog.density = 3.0 / (Math.max(5, w.visibilityKm) * 1000);
    this.baseFog = fog.density;
    this.viewDist = Math.min(260000, w.visibilityKm * 1000 * 2.2);
    this.clouds.visible = w.clouds !== 'clear';
    const cm = this.clouds.material as THREE.MeshLambertMaterial;
    cm.opacity = w.clouds === 'overcast' ? 0.97 : 0.75;
    cm.alphaTest = w.clouds === 'overcast' ? 0 : 0.35;
    cm.needsUpdate = true;
    this.clouds.position.y = w.cloudBase;
    this.renderer.setClearColor(horizon);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  reset() {
    if (this.theaterVer !== theaterVersion) {
      // a different theater is active: rebuild terrain chunks and airbase scenery
      this.theaterVer = theaterVersion;
      this.terrain.clear();
      this.scene.remove(this.scenery);
      this.scenery = buildScenery();
      this.scene.add(this.scenery);
    }
    for (const m of this.acModels.values()) this.scene.remove(m.root);
    for (const m of this.groundModels.values()) this.scene.remove(m);
    for (const m of this.missileModels.values()) this.scene.remove(m);
    this.acModels.clear(); this.groundModels.clear(); this.missileModels.clear();
    this.fx.clear();
  }

  private syncEntities(world: World) {
    const t = world.time;
    const seen = new Set<number>();
    for (const ac of world.aircraft) {
      if (ac.removed) continue;
      seen.add(ac.id);
      let m = this.acModels.get(ac.id);
      if (!m) { m = buildAircraftModel(ac.def, ac.side); this.acModels.set(ac.id, m); this.scene.add(m.root); }
      syncStores(m, ac, (i) => world.stationOffset(ac, i));
      updateAircraftModel(m, ac, t, m.root.position.distanceTo(this.viewCam.position));
      m.root.visible = true;
      if (ac.isPlayer) this.updatePlayerCockpit(m, ac, this.view === 'cockpit');
    }
    for (const [id, m] of this.acModels) if (!seen.has(id)) { this.scene.remove(m.root); this.acModels.delete(id); }
    for (const g of world.ground) {
      let m = this.groundModels.get(g.id);
      if (!m) { m = groundMesh(g.type, g.side); this.groundModels.set(g.id, m); this.scene.add(m); }
      m.position.copy(g.pos);
      m.rotation.y = -g.heading;
      if (!g.alive && !m.userData.dead) {
        m.userData.dead = true;
        m.scale.y = 0.35;
        m.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.deadMat; });
      }
    }
    const mseen = new Set<number>();
    for (const ms of world.missiles) {
      mseen.add(ms.id);
      let m = this.missileModels.get(ms.id);
      if (!m) {
        m = storeMesh(ms.def.id);
        // the motor's flame at the tail, the same burner the jets use
        const { len, r } = missileDims(ms.def.id);
        const b = createBurner(0, 0, len / 2, r * 0.75);
        m.add(b.group); m.userData.burner = b;
        this.missileModels.set(ms.id, m); this.scene.add(m);
      }
      (m.userData.burner as Burner).update({ ab: ms.motorOn ? 1 : 0, core: ms.motorOn ? 1 : 0, alive: ms.motorOn });
      m.position.copy(ms.pos);
      const v = ms.vel.clone();
      if (v.lengthSq() > 1) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), v.normalize());
    }
    for (const [id, m] of this.missileModels) if (!mseen.has(id)) { this.scene.remove(m); this.missileModels.delete(id); }
  }

  /**
   * F1 view: keep your own jet visible (nose, wings) but hide canopy glass from inside, and show a cockpit —
   * the HD model's own cockpit when it is loaded, otherwise the procedural one (with live MFD screens).
   */
  private updatePlayerCockpit(m: AircraftModel, ac: Aircraft, inside: boolean) {
    const hdOn = !!m.hd && m.hd.root.visible;
    m.canopy.visible = !inside && !hdOn;
    if (m.hd) for (const gl of m.hd.glass) gl.visible = !inside;
    const useHdPit = hdOn && m.hd!.cockpit.length > 0;
    // the procedural fuselage encloses the eye: the cockpit model provides nose/spine/floor instead
    const hideFus = inside && !useHdPit;
    if (!hdOn) for (const f of m.fuselage) f.visible = !hideFus;
    if (inside && !useHdPit) {
      if (!this.cockpit || this.cockpitDef !== ac.def.id) {
        if (this.cockpit) this.cockpit.group.parent?.remove(this.cockpit.group);
        this.cockpit = buildCockpit(ac.def, this.mfdCanvases);
        this.cockpitDef = ac.def.id;
      }
      if (this.cockpit.group.parent !== m.body) m.body.add(this.cockpit.group);
      this.cockpit.group.position.copy(this.eyeOffset(ac));
      this.cockpit.group.visible = true;
      for (const s of this.cockpit.screens) s.needsUpdate = true;
    } else if (this.cockpit) {
      this.cockpit.group.visible = false;
    }
    // HD cockpits: live MFD pages on the model's own screens
    if (m.hd) this.updateHdMfds(m, ac, inside && useHdPit);
  }

  private hdMfdTextures: THREE.CanvasTexture[] = [];
  private updateHdMfds(m: AircraftModel, ac: Aircraft, show: boolean) {
    const spec = hdSpecFor(ac.def);
    if (!spec?.mfds || !m.hd) return;
    let quads = m.hd.root.userData.mfdQuads as THREE.Mesh[] | undefined;
    if (!quads) {
      if (!this.hdMfdTextures.length) this.hdMfdTextures = this.mfdCanvases.map((c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
      quads = spec.mfds.map((d) => {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshBasicMaterial({ map: this.hdMfdTextures[d.screen] ?? null, toneMapped: false }));
        const c = new THREE.Vector3(...d.c), n = new THREE.Vector3(...d.n).normalize();
        q.position.copy(c).addScaledVector(n, 0.003);   // just proud of the painted screen
        q.lookAt(c.clone().add(n));
        q.renderOrder = 2;
        m.hd!.root.add(q);
        return q;
      });
      m.hd.root.userData.mfdQuads = quads;
    }
    for (const q of quads) q.visible = show;
    if (show) for (const t of this.hdMfdTextures) t.needsUpdate = true;
  }

  eyeOffset(ac: Aircraft) {
    if (ac.isPlayer) {
      const m = this.acModels.get(ac.id);
      if (m?.hd && m.hd.root.visible && m.hd.cockpit.length) return m.hd.eye.clone();
    }
    const L = ac.def.length;
    const R = Math.max(0.55, L * 0.042) * (ac.def.model.engines === 2 ? 1.15 : 1);
    return new THREE.Vector3(0, R * 0.95, -L * 0.22);
  }

  private updateCamera(world: World, dt: number) {
    const cam = this.camera;
    const p = world.player;
    const focus: Aircraft | null = p && !p.removed ? p : world.aircraft.find((a) => !a.removed) ?? null;
    let fov = this.fovBase;
    if (!focus) { cam.position.set(0, 3000, 0); cam.lookAt(0, 0, -10000); return; }
    let view = this.view;
    if (view === 'weapon' && !(world.lastLaunched && world.lastLaunched.alive)) view = 'chase';
    if (view === 'target' && !this.pickTarget(world, focus)) view = 'chase';
    if (view === 'enemy' && !this.pickEnemy(world, focus)) view = 'chase';
    switch (view) {
      case 'cockpit': {
        cam.position.copy(this.eyeOffset(focus).applyQuaternion(focus.quat).add(focus.pos));
        const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.headPitch, this.headYaw, 0, 'YXZ'));
        cam.quaternion.copy(focus.quat).multiply(look);
        cam.up.set(0, 1, 0).applyQuaternion(focus.quat);
        cam.position.addScaledVector(focus.fm.up(), -clamp((focus.fm.nz - 1) * 0.008, -0.05, 0.08));
        fov = this.fovBase / this.zoom;
        break;
      }
      case 'chase': case 'enemy': {
        const tgt = view === 'enemy' ? this.pickEnemy(world, focus)! : focus;
        // 'level' mode follows the heading only (world-up horizon); 'locked' rolls and pitches with the jet
        let goal = tgt.quat;
        if (this.chaseLevel) {
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(tgt.quat);
          goal = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-fwd.x, -fwd.z), 0, 'YXZ'));
        }
        this.smoothQuat.slerp(goal, 1 - Math.exp(-dt * 4));
        const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.chasePitch, this.chaseYaw, 0, 'YXZ'));
        const q = this.smoothQuat.clone().multiply(rot);
        const dist = this.chaseDist * Math.max(1, tgt.def.length / 15);
        cam.position.copy(tgt.pos).add(new THREE.Vector3(0, 0, dist).applyQuaternion(q));
        const gh = surfaceHeight(cam.position.x, cam.position.z) + 2;
        if (cam.position.y < gh) cam.position.y = gh;
        cam.up.set(0, 1, 0).applyQuaternion(this.chaseLevel ? new THREE.Quaternion() : this.smoothQuat);
        cam.lookAt(tgt.pos);
        fov = 60 / this.zoom;
        break;
      }
      case 'flyby': {
        this.flybyTimer -= dt;
        if (this.flybyTimer <= 0 || this.flybyPos.distanceTo(focus.pos) > 1500) {
          this.flybyTimer = 8;
          this.flybyPos.copy(focus.pos).addScaledVector(focus.vel, 4).add(new THREE.Vector3((Math.random() - 0.5) * 80, 15 + Math.random() * 20, (Math.random() - 0.5) * 80));
          const gh = surfaceHeight(this.flybyPos.x, this.flybyPos.z) + 3;
          if (this.flybyPos.y < gh) this.flybyPos.y = gh;
        }
        cam.position.copy(this.flybyPos);
        cam.up.set(0, 1, 0);
        cam.lookAt(focus.pos);
        fov = clamp(4000 / Math.max(50, this.flybyPos.distanceTo(focus.pos)), 10, 70);
        break;
      }
      case 'target': {
        const tgt = this.pickTarget(world, focus)!;
        const dir = tgt.pos.clone().sub(focus.pos).normalize();
        cam.position.copy(focus.pos).addScaledVector(dir, -40 * Math.max(1, focus.def.length / 15)).add(new THREE.Vector3(0, 8, 0));
        cam.up.set(0, 1, 0);
        cam.lookAt(tgt.pos);
        fov = 55 / this.zoom;
        break;
      }
      case 'weapon': {
        const m = world.lastLaunched as Missile;
        const v = m.vel.clone().normalize();
        cam.position.copy(m.pos).addScaledVector(v, -12).add(new THREE.Vector3(0, 2, 0));
        cam.up.set(0, 1, 0);
        cam.lookAt(m.pos.clone().addScaledVector(v, 100));
        fov = 60;
        break;
      }
    }
    // closer near plane inside the cockpit (panel and frames are within a metre of the eye)
    const near = view === 'cockpit' ? 0.08 : 0.3;
    if (Math.abs(cam.fov - fov) > 0.01 || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
    this.placeRig(view === 'cockpit' ? focus : null);
  }

  // ------------------------------------------------------------------ VR (WebXR, seated)
  readonly rig = new THREE.Group();
  private vrHud: THREE.Mesh | null = null;
  private vrHudTex: THREE.CanvasTexture | null = null;
  /** recentre offset: undoes where the head was when "Center view" was pressed */
  private vrCenter = { pos: new THREE.Vector3(), yaw: 0 };
  get vrActive() { return this.renderer.xr.isPresenting; }
  /** the monitor-equivalent camera (pose before VR takes over): HUD symbology and screen projections use it */
  private flatCam = new THREE.PerspectiveCamera();
  get viewCam(): THREE.PerspectiveCamera { return this.vrActive ? this.flatCam : this.camera; }

  /** Start an immersive-vr session (call from a click). Resolves when it ends. */
  async enterVr(hudCanvas: HTMLCanvasElement): Promise<void> {
    const xr = (navigator as Navigator & { xr?: { requestSession(m: string, o?: object): Promise<XRSession> } }).xr;
    if (!xr) throw new Error('WebXR is not available in this browser');
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    await this.renderer.xr.setSession(session as never);
    this.vrHudTex = new THREE.CanvasTexture(hudCanvas);
    this.vrHudTex.colorSpace = THREE.SRGBColorSpace;
    const [w, h] = hudQuadSize(this.fovBase, hudCanvas.width / Math.max(1, hudCanvas.height), VR_HUD_DIST);
    this.vrHud = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.vrHudTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.vrHud.renderOrder = 999;
    this.vrHud.position.set(0, 0, -VR_HUD_DIST);
    this.rig.add(this.vrHud);
    this.vrCenter = { pos: new THREE.Vector3(), yaw: 0 };
    await new Promise<void>((done) => session.addEventListener('end', () => {
      if (this.vrHud) { this.rig.remove(this.vrHud); this.vrHud.geometry.dispose(); }
      this.vrHud = null; this.vrHudTex?.dispose(); this.vrHudTex = null;
      done();
    }));
  }

  /** "Center view" in VR: the current head position/heading becomes the design eye looking forward */
  recenterVr() {
    if (!this.vrActive) return;
    const head = this.renderer.xr.getCamera();
    const e = new THREE.Euler().setFromQuaternion(head.quaternion, 'YXZ');
    this.vrCenter = { pos: head.position.clone(), yaw: e.y };
  }

  /** in VR the rig takes the eye point + attitude (cockpit view) or the camera pose (other views) */
  private placeRig(cockpitOf: Aircraft | null) {
    const cam = this.camera;
    if (!this.vrActive) { this.rig.position.set(0, 0, 0); this.rig.quaternion.identity(); return; }
    this.flatCam.copy(cam); this.flatCam.updateMatrixWorld();
    this.rig.position.copy(cam.position);
    this.rig.quaternion.copy(cockpitOf ? cockpitOf.quat : cam.quaternion);
    // recentre: undo the head offset/heading captured at "Center view"
    this.rig.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.vrCenter.yaw));
    this.rig.position.sub(this.vrCenter.pos.clone().applyQuaternion(this.rig.quaternion));
    cam.position.set(0, 0, 0); cam.quaternion.identity();
    if (this.vrHudTex) this.vrHudTex.needsUpdate = true;
  }

  pickTarget(world: World, focus: Aircraft): Aircraft | GroundUnit | null {
    const r = focus.radar;
    if (r?.stt?.active) return r.stt;
    if (focus.agTarget?.alive) return focus.agTarget;
    return this.pickEnemy(world, focus);
  }
  pickEnemy(world: World, focus: Aircraft): Aircraft | null {
    let best: Aircraft | null = null, bd = Infinity;
    for (const a of world.aircraft) {
      if (!a.active || a.side === focus.side) continue;
      const d = a.pos.distanceTo(focus.pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** carrier meshes, keyed by carrier object (a new mission builds new carriers) */
  private carrierMeshes = new Map<object, THREE.Group>();
  private syncCarriers(world: World) {
    for (const [k, m] of this.carrierMeshes) if (!world.carriers.includes(k as never)) { this.scene.remove(m); this.carrierMeshes.delete(k); }
    for (const c of world.carriers) {
      let m = this.carrierMeshes.get(c);
      if (!m) { m = buildCarrierMesh(); m.rotation.y = -c.hdg; this.scene.add(m); this.carrierMeshes.set(c, m); }
      m.position.copy(c.pos);
      const radar = m.getObjectByName('radar');
      if (radar) radar.rotation.y = world.time * 2.5;
    }
  }

  render(world: World, dt: number) {
    this.syncCarriers(world);
    this.syncEntities(world);
    this.fx.update(world, dt);
    this.updateCamera(world, dt);
    // world eye point (in VR the camera is posed inside the rig)
    const cp = this.vrActive ? this.rig.position : this.camera.position;
    this.sky.position.copy(cp);
    // haze sits in the lower atmosphere: looking out from altitude the air is clearer
    (this.scene.fog as THREE.FogExp2).density = this.baseFog * (0.45 + 0.55 * Math.exp(-Math.max(0, cp.y) / 5000));
    this.terrain.update(cp, this.viewDist);
    this.terrain.updateTrees(cp);
    // PAPI lights of the nearest field show red/white for the viewer's glidepath
    let near: Airfield | null = null, nd = 20000;
    for (const f of (this.scenery.userData.airfields ?? []) as Airfield[]) { const d = f.papiPos.distanceTo(cp); if (d < nd) { nd = d; near = f; } }
    if (near) updatePapi(near, cp);
    this.clouds.position.x = cp.x; this.clouds.position.z = cp.z;
    const tex = (this.clouds.material as THREE.MeshLambertMaterial).map!;
    tex.offset.set(cp.x / 10000, -cp.z / 10000);
    this.sun.target.position.copy(cp);
    this.sun.position.copy(cp).addScaledVector(this.sunDir, 10000);
    this.fx.setView(this.camera, this.renderer.domElement.height, this.sunDir, this.sun, this.hemi);
    this.renderer.render(this.scene, this.camera);
  }

  /** Project world point to screen pixels; null if behind the camera. */
  project(p: THREE.Vector3, w: number, h: number): { x: number; y: number } | null {
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.viewCam.quaternion);
    if (p.clone().sub(this.viewCam.position).dot(camDir) <= 0) return null;
    const v = p.clone().project(this.viewCam);
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  prewarm(p: THREE.Vector3) { this.terrain.prewarm(p, Math.min(this.viewDist, 60000)); }
}

function makeCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d')!;
  const img = x.createImageData(size, size);
  const grid = (s: number) => {
    const g: number[] = [];
    for (let i = 0; i < s * s; i++) g.push(Math.random());
    return (u: number, v: number) => {
      const fx = u * s, fy = v * s;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => g[((j % s + s) % s) * s + ((i % s + s) % s)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const o = [grid(4), grid(8), grid(16), grid(32)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size;
    let n = o[0](u, v) * 0.5 + o[1](u, v) * 0.25 + o[2](u, v) * 0.15 + o[3](u, v) * 0.1;
    n = clamp((n - 0.45) * 3, 0, 1);
    const k = (j * size + i) * 4;
    const shade = 225 + n * 30;
    img.data[k] = shade; img.data[k + 1] = shade; img.data[k + 2] = Math.min(255, shade + 5); img.data[k + 3] = n * 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
