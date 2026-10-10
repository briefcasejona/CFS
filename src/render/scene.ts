import * as THREE from 'three';
import type { World } from '../sim/world.js';
import type { Aircraft, GroundUnit } from '../sim/entities.js';
import type { Missile } from '../weapons/missile.js';
import { TerrainRenderer, buildScenery } from './terrainMesh.js';
import { buildAircraftModel, updateAircraftModel, syncStores, groundMesh, storeMesh, type AircraftModel } from './models.js';
import { surfaceHeight, theaterVersion } from '../world/theater.js';
import { clamp } from '../core/math.js';

export type ViewMode = 'cockpit' | 'chase' | 'flyby' | 'target' | 'weapon' | 'enemy';

export interface Weather {
  visibilityKm: number;
  clouds: 'clear' | 'scattered' | 'overcast';
  cloudBase: number;   // m
  timeOfDay: number;   // hours 0..24
}

// ------------------------------------------------------------------ particles
const PARTICLE_VS = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
varying float vAlpha;
varying vec3 vColor;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * 900.0 / -mv.z, 1.0, 256.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = alpha;
  vColor = pcolor;
  #include <logdepthbuf_vertex>
}`;
const PARTICLE_FS = `
varying float vAlpha;
varying vec3 vColor;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = vAlpha * smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  max: number;
  count = 0;
  pos: Float32Array; vel: Float32Array; age: Float32Array; life: Float32Array;
  size0: Float32Array; size1: Float32Array; a0: Float32Array; col: Float32Array;
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  private sizeAttr: Float32Array; private alphaAttr: Float32Array;
  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.sizeAttr = new Float32Array(max); this.alphaAttr = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizeAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphaAttr, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3 | null, life: number, s0: number, s1: number, alpha: number, r: number, g: number, b: number) {
    let i = this.count;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.count++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v?.x ?? 0; this.vel[i * 3 + 1] = v?.y ?? 0; this.vel[i * 3 + 2] = v?.z ?? 0;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = s0; this.size1[i] = s1; this.a0[i] = alpha;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.count;
        for (let k = 0; k < 3; k++) {
          this.pos[i * 3 + k] = this.pos[j * 3 + k];
          this.vel[i * 3 + k] = this.vel[j * 3 + k];
          this.col[i * 3 + k] = this.col[j * 3 + k];
        }
        this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j]; this.a0[i] = this.a0[j];
        i--;
        continue;
      }
      const k = 1 - 0.8 * dt;
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] *= k; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      this.sizeAttr[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alphaAttr[i] = this.a0[i] * (1 - t) * (t < 0.05 ? t / 0.05 : 1);
    }
    this.geo.setDrawRange(0, this.count);
    for (const n of ['position', 'size', 'alpha', 'pcolor']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
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
  fovBase = 75;
  zoom = 1;
  viewDist = 150000;
  private acModels = new Map<number, AircraftModel>();
  private groundModels = new Map<number, THREE.Object3D>();
  private missileModels = new Map<number, THREE.Object3D>();
  private smoke = new ParticleSystem(6000, false);
  private glow = new ParticleSystem(2500, true);
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(4000 * 6);
  private flybyPos = new THREE.Vector3();
  private flybyTimer = 0;
  private emitAccum = 0;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private smoothQuat = new THREE.Quaternion();
  private deadMat = new THREE.MeshLambertMaterial({ color: 0x222018 });
  private theaterVer = theaterVersion;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(this.fovBase, 1, 0.3, 450000);
    this.scene.add(this.camera);
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
    this.scene.add(this.smoke.points, this.glow.points);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    const tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    tracers.frustumCulled = false;
    this.scene.add(tracers);
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
    this.smoke.count = 0; this.glow.count = 0;
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
      updateAircraftModel(m, ac, t, m.root.position.distanceTo(this.camera.position));
      m.root.visible = !(ac.isPlayer && this.view === 'cockpit');
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
      if (!m) { m = storeMesh(ms.def.id); this.missileModels.set(ms.id, m); this.scene.add(m); }
      m.position.copy(ms.pos);
      const v = ms.vel.clone();
      if (v.lengthSq() > 1) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), v.normalize());
    }
    for (const [id, m] of this.missileModels) if (!mseen.has(id)) { this.scene.remove(m); this.missileModels.delete(id); }
  }

  private updateParticles(world: World, dt: number) {
    this.emitAccum += dt;
    if (this.emitAccum >= 1 / 40) {
      this.emitAccum = 0;
      for (const ms of world.missiles) {
        if (ms.motorOn) {
          this.smoke.emit(ms.pos, null, 5 + Math.random() * 3, 2, 12, 0.55, 0.9, 0.9, 0.9);
          this.glow.emit(ms.pos, null, 0.08, 3, 1, 1.0, 1.0, 0.7, 0.3);
        }
      }
      for (const ac of world.aircraft) {
        if (ac.removed) continue;
        const tail = ac.pos.clone().addScaledVector(ac.fm.forward(), -ac.def.length * 0.55);
        if (!ac.fm.crashed && (!ac.alive || ac.health < 45)) {
          this.smoke.emit(tail, null, 6, 4, 25, 0.6, 0.15, 0.14, 0.13);
          if (!ac.alive) this.glow.emit(tail, null, 0.3, 6, 3, 0.9, 1, 0.5, 0.1);
        }
        if (ac.alive && ac.pos.y > 8800 && ac.fm.tas > 100) this.smoke.emit(tail, null, 12, 1.5, 8, 0.35, 0.95, 0.95, 0.97);
        if (ac.fm.crashed && Math.random() < 0.5) {
          this.smoke.emit(ac.pos.clone().setY(surfaceHeight(ac.pos.x, ac.pos.z) + 2), new THREE.Vector3(0, 6, 0), 14, 8, 60, 0.5, 0.12, 0.12, 0.12);
        }
      }
      for (const cm of world.countermeasures) {
        if (cm.kind === 'flare') this.glow.emit(cm.pos, null, 0.15, 6, 3, 1, 1, 0.95, 0.7);
        else this.smoke.emit(cm.pos, null, 1.2, 3, 8, 0.25, 0.8, 0.8, 0.8);
      }
    }
    for (const e of world.effects) {
      switch (e.type) {
        case 'fireball': case 'explosion': {
          const n = e.type === 'fireball' ? 14 : 10;
          for (let i = 0; i < n; i++) {
            const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(e.size * 2);
            this.glow.emit(e.pos, v, 0.8 + Math.random() * 0.6, e.size * 1.2, e.size * 3, 0.9, 1, 0.55, 0.15);
            this.smoke.emit(e.pos, v.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 4, 0)), 8 + Math.random() * 6, e.size, e.size * 6, 0.65, 0.1, 0.1, 0.1);
          }
          break;
        }
        case 'airburst':
          for (let i = 0; i < 6; i++) {
            const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(30);
            this.glow.emit(e.pos, v, 0.4, e.size * 1.5, e.size * 3, 1, 1, 0.7, 0.3);
            this.smoke.emit(e.pos, v.multiplyScalar(0.3), 6, e.size, e.size * 5, 0.5, 0.25, 0.25, 0.25);
          }
          break;
        case 'hit': this.glow.emit(e.pos, null, 0.12, 3, 4, 1, 1, 0.8, 0.4); break;
        case 'dust': this.smoke.emit(e.pos, new THREE.Vector3(0, 3, 0), 1.5, 2, 6, 0.4, 0.45, 0.4, 0.32); break;
        case 'launch': this.smoke.emit(e.pos, null, 3, 3, 15, 0.5, 0.85, 0.85, 0.85); break;
      }
    }
    world.effects.length = 0;
    this.smoke.update(dt);
    this.glow.update(dt);
    const b = world.bullets;
    let n = 0;
    for (let i = 0; i < b.count && n < 4000; i++) {
      if (!b.tracer[i]) continue;
      const k = n * 6;
      this.tracerPos[k] = b.px[i]; this.tracerPos[k + 1] = b.py[i]; this.tracerPos[k + 2] = b.pz[i];
      this.tracerPos[k + 3] = b.px[i] - b.vx[i] * 0.025; this.tracerPos[k + 4] = b.py[i] - b.vy[i] * 0.025; this.tracerPos[k + 5] = b.pz[i] - b.vz[i] * 0.025;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    (this.tracerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  eyeOffset(ac: Aircraft) {
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
        this.smoothQuat.slerp(tgt.quat, 1 - Math.exp(-dt * 4));
        const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.chasePitch, this.chaseYaw, 0, 'YXZ'));
        const q = this.smoothQuat.clone().multiply(rot);
        const dist = this.chaseDist * Math.max(1, tgt.def.length / 15);
        cam.position.copy(tgt.pos).add(new THREE.Vector3(0, 0, dist).applyQuaternion(q));
        const gh = surfaceHeight(cam.position.x, cam.position.z) + 2;
        if (cam.position.y < gh) cam.position.y = gh;
        cam.up.set(0, 1, 0).applyQuaternion(this.smoothQuat);
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
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
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

  render(world: World, dt: number) {
    this.syncEntities(world);
    this.updateParticles(world, dt);
    this.updateCamera(world, dt);
    const cp = this.camera.position;
    this.sky.position.copy(cp);
    this.terrain.update(cp, this.viewDist);
    this.clouds.position.x = cp.x; this.clouds.position.z = cp.z;
    const tex = (this.clouds.material as THREE.MeshLambertMaterial).map!;
    tex.offset.set(cp.x / 10000, -cp.z / 10000);
    this.sun.target.position.copy(cp);
    this.sun.position.copy(cp).addScaledVector(this.sunDir, 10000);
    this.renderer.render(this.scene, this.camera);
  }

  /** Project world point to screen pixels; null if behind the camera. */
  project(p: THREE.Vector3, w: number, h: number): { x: number; y: number } | null {
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (p.clone().sub(this.camera.position).dot(camDir) <= 0) return null;
    const v = p.clone().project(this.camera);
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
