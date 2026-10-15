// Particle effects: billowing lit smoke, fire with a heat colour ramp, velocity-stretched sparks and tracers.
// Every particle is a camera-facing quad (instanced), so a fireball can fill the screen and a spark or tracer is a
// proper streak along its path. Systems: smoke (alpha-blended, lit by the sun), fire and sparks (additive).
import * as THREE from 'three';
import type { World } from '../sim/world.js';
import { surfaceHeight } from '../world/theater.js';

type Mode = 'smoke' | 'fire' | 'spark';

const VS = `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;   // size (m), alpha, rotation (rad) / twinkle phase, heat 0..1
attribute vec3 iCol;
uniform float uPixel;   // metres per pixel at 1 m distance
uniform float uMinPx;   // never thinner than this many pixels (tracers and flares stay visible far out)
uniform float uStretch; // seconds of velocity drawn as a streak (sparks)
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vRot;
varying vec3 vCol;
varying vec3 vSun;
varying float vFogDepth;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iData.x;
  float depth = max(0.1, -mv.z);
  float minSize = uMinPx * uPixel * depth;
  float a = iData.y;
  // a particle shrunk below its minimum on screen keeps its energy: wider but fainter
  if (size < minSize) { a *= max(0.15, size / minSize); size = minSize; }
  vec2 c = position.xy;
  if (uStretch > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz * uStretch;
    vec4 tail = vec4(mv.xyz - vv, 1.0);
    vec4 p0 = projectionMatrix * mv, p1 = projectionMatrix * tail;
    vec2 d = p0.xy / p0.w - p1.xy / p1.w;
    float l = length(d);
    d = l > 1e-6 ? d / l : vec2(1.0, 0.0);
    vec3 side = normalize(vec3(-d.y, d.x, 0.0));
    float along = c.x + 0.5;   // 0 tail .. 1 head
    vec3 p = mix(tail.xyz, mv.xyz, along) + side * c.y * size;
    p += normalize(mv.xyz - tail.xyz + vec3(1e-5)) * (c.x * size * 0.5);   // round the ends
    mv.xyz = p;
  } else {
    float cr = cos(iData.z), sr = sin(iData.z);
    mv.xy += mat2(cr, sr, -sr, cr) * c * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = c + 0.5;
  vAlpha = a;
  vHeat = iData.w;
  vRot = iData.z;
  vCol = iCol;
  vSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vFogDepth = -mv.z;
  #include <logdepthbuf_vertex>
}`;

const FS_HEAD = `
uniform sampler2D uTex;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform float uTime;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vRot;
varying vec3 vCol;
varying vec3 vSun;
varying float vFogDepth;
#include <common>
#include <logdepthbuf_pars_fragment>
float fogF() { float f = fogDensity * vFogDepth; return 1.0 - exp(-f * f); }
// one of the four puffs in the 2x2 atlas, picked by the particle's rotation
vec4 puff(vec2 uv) {
  float k = floor(fract(vRot * 0.6180339) * 4.0);
  return texture2D(uTex, (uv + vec2(mod(k, 2.0), floor(k / 2.0))) * 0.5);
}
`;

const FS: Record<Mode, string> = {
  // smoke: a noisy puff lit from the sun's side, darker underneath
  smoke: FS_HEAD + `
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = puff(vUv);
  vec2 c = vUv - 0.5;
  vec3 n = normalize(vec3(c * 1.6, 0.55));
  float lit = clamp(dot(n, vSun) * 0.5 + 0.5, 0.0, 1.0);
  float self = mix(0.55, 1.0, t.r);                 // the puff's own crevices
  vec3 col = vCol * (uAmb + uSunCol * lit) * self;
  col += vec3(1.0, 0.55, 0.2) * vHeat * vHeat * 1.6;  // embers glowing through fresh smoke
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(col, fogColor, fogF()), a);
}`,
  // fire: heat ramp from white-hot through yellow and orange to dull red, flickering with the puff's noise
  fire: FS_HEAD + `
vec3 ramp(float h) {
  vec3 c = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(1.0, 0.75, 0.25), smoothstep(0.35, 0.7, h));
  return mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.7, 1.0, h));
}
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = puff(vUv);
  vec2 c = vUv - 0.5;
  float core = exp(-dot(c, c) * 18.0);
  float h = clamp(vHeat * (0.65 + 0.5 * t.r) + core * 0.25 * vHeat, 0.0, 1.0);
  vec3 col = ramp(h) * vCol * (1.0 + core * 1.5 * vHeat);
  float a = vAlpha * (t.a * 0.75 + core * 0.6);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a * (1.0 - fogF()), 1.0);
}`,
  // sparks and tracers: a hot white core inside a coloured glow, along the streak; chaff glitters (rotation = phase)
  spark: FS_HEAD + `
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = vUv - 0.5;
  float across = exp(-c.y * c.y * 28.0);
  float coreW = exp(-c.y * c.y * 260.0);
  float along = smoothstep(0.0, 0.25, vUv.x) * (0.5 + 0.5 * smoothstep(0.4, 1.0, vUv.x));
  float tw = vHeat < 0.0 ? 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 23.0 + vRot * 40.0), 6.0) : 1.0;
  vec3 col = mix(vCol, vec3(1.0, 0.98, 0.9), coreW * 0.9);
  float a = vAlpha * along * (across * 0.6 + coreW) * tw;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a * (1.0 - fogF()), 1.0);
}`,
};

/** 2x2 atlas of soft noisy puffs (white = lit side of the billow) */
function puffAtlas(): THREE.DataTexture {
  const S = 128, H = 64;
  const data = new Uint8Array(S * S * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const grid = (n: number) => {
    const g = Array.from({ length: n * n }, rnd);
    return (u: number, v: number) => {
      const fx = u * n, fy = v * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  for (let q = 0; q < 4; q++) {
    const o = [grid(3), grid(6), grid(12), grid(24)];
    const ox = (q % 2) * H, oy = Math.floor(q / 2) * H;
    for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) {
      const u = (i + 0.5) / H, v = (j + 0.5) / H;
      const n = o[0](u, v) * 0.45 + o[1](u, v) * 0.28 + o[2](u, v) * 0.17 + o[3](u, v) * 0.1;
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2 + (n - 0.5) * 0.7;   // ragged edge
      const a = Math.max(0, Math.min(1, (1 - r) * 1.8)) * (0.55 + 0.6 * n);
      const k = ((oy + j) * S + ox + i) * 4;
      const lit = Math.max(0, Math.min(1, 0.35 + n * 0.9 - dy * 0.4));
      data[k] = data[k + 1] = data[k + 2] = Math.round(lit * 255);
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const shared = {
  uPixel: { value: 0.001 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, -0.4).normalize() },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uAmb: { value: new THREE.Color(0.5, 0.55, 0.6) },
  uTime: { value: 0 },
  uTex: { value: null as THREE.Texture | null },
};

export interface EmitOpts {
  /** per-second velocity damping (air drag) */
  drag?: number;
  /** upward acceleration, m/s² (hot gas rises; negative = falls) */
  buoy?: number;
  /** spin rate, rad/s */
  spin?: number;
  /** starting heat 0..1 (fire colour, smoke embers); chaff glitter uses −1 */
  heat?: number;
  /** alpha fades in over this fraction of the life */
  fadeIn?: number;
}

/** A pool of simulated quads drawn in one instanced call. */
export class Particles {
  readonly mesh: THREE.Mesh;
  count = 0;
  private geo = new THREE.InstancedBufferGeometry();
  private aPos: Float32Array; private aVel: Float32Array; private aData: Float32Array; private aCol: Float32Array;
  private vel: Float32Array; private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private a0: Float32Array; private h0: Float32Array;
  private drag: Float32Array; private buoy: Float32Array; private spin: Float32Array; private fadeIn: Float32Array;

  constructor(readonly max: number, readonly mode: Mode, opts: { stretch?: number; minPx?: number } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new Float32Array(max * 3); this.aVel = new Float32Array(max * 3);
    this.aData = new Float32Array(max * 4); this.aCol = new Float32Array(max * 3);
    const add = (n: string, a: Float32Array, s: number) => this.geo.setAttribute(n, new THREE.InstancedBufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage));
    add('iPos', this.aPos, 3); add('iVel', this.aVel, 3); add('iData', this.aData, 4); add('iCol', this.aCol, 3);
    this.geo.instanceCount = 0;
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.h0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.buoy = new Float32Array(max); this.spin = new Float32Array(max); this.fadeIn = new Float32Array(max);
    if (!shared.uTex.value) shared.uTex.value = puffAtlas();
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS[mode],
      uniforms: {
        ...shared,
        uStretch: { value: opts.stretch ?? 0 },
        uMinPx: { value: opts.minPx ?? 0 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
      },
      transparent: true, depthWrite: false, fog: true,
      blending: mode === 'smoke' ? THREE.NormalBlending : THREE.CustomBlending,
    });
    if (mode !== 'smoke') {
      // premultiplied additive: the shaders output colour × alpha
      mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneFactor; mat.blendEquation = THREE.AddEquation;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 'smoke' ? 1 : 2;
  }

  emit(px: number, py: number, pz: number, vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number, alpha: number, r: number, g: number, b: number, o: EmitOpts = {}) {
    let i = this.count;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.count++;
    this.aPos[i * 3] = px; this.aPos[i * 3 + 1] = py; this.aPos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.aCol[i * 3] = r; this.aCol[i * 3 + 1] = g; this.aCol[i * 3 + 2] = b;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha;
    this.h0[i] = o.heat ?? 0; this.drag[i] = o.drag ?? 0.8; this.buoy[i] = o.buoy ?? 0;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 0.6; this.fadeIn[i] = o.fadeIn ?? 0.05;
    this.aData[i * 4 + 2] = Math.random() * 6.283;
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }

  update(dt: number) {
    const v = this.vel, p = this.aPos, d = this.aData;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.move(--this.count, i); i--; continue; }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      v[i * 3] *= k; v[i * 3 + 1] = v[i * 3 + 1] * k + this.buoy[i] * dt; v[i * 3 + 2] *= k;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const t = this.age[i] / this.life[i];
      // smoke grows fast then slows (expanding puff); others grow linearly
      const g = this.mode === 'smoke' ? 1 - (1 - t) * (1 - t) : t;
      d[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * g;
      const fi = this.fadeIn[i];
      d[i * 4 + 1] = this.a0[i] * (t < fi ? t / fi : 1) * (this.mode === 'smoke' ? (1 - t) * (1 - t * 0.3) : 1 - t * t);
      d[i * 4 + 2] += this.spin[i] * dt;
      d[i * 4 + 3] = this.h0[i] < 0 ? -1 : this.h0[i] * Math.pow(1 - t, 1.6);
      this.aVel[i * 3] = v[i * 3]; this.aVel[i * 3 + 1] = v[i * 3 + 1]; this.aVel[i * 3 + 2] = v[i * 3 + 2];
    }
    this.commit(this.count);
  }

  /** draw `n` instances as they are (for systems filled every frame, such as tracers) */
  commit(n: number) {
    this.geo.instanceCount = n;
    for (const a of ['iPos', 'iVel', 'iData', 'iCol']) {
      const attr = this.geo.getAttribute(a) as THREE.InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  /** write one instance directly (immediate systems) */
  put(i: number, px: number, py: number, pz: number, vx: number, vy: number, vz: number, size: number, alpha: number, rot: number, heat: number, r: number, g: number, b: number) {
    this.aPos[i * 3] = px; this.aPos[i * 3 + 1] = py; this.aPos[i * 3 + 2] = pz;
    this.aVel[i * 3] = vx; this.aVel[i * 3 + 1] = vy; this.aVel[i * 3 + 2] = vz;
    this.aData[i * 4] = size; this.aData[i * 4 + 1] = alpha; this.aData[i * 4 + 2] = rot; this.aData[i * 4 + 3] = heat;
    this.aCol[i * 3] = r; this.aCol[i * 3 + 1] = g; this.aCol[i * 3 + 2] = b;
  }

  private move(j: number, i: number) {
    if (i === j) return;
    for (let k = 0; k < 3; k++) {
      this.aPos[i * 3 + k] = this.aPos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; this.aCol[i * 3 + k] = this.aCol[j * 3 + k];
    }
    this.aData[i * 4 + 2] = this.aData[j * 4 + 2];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.a0[i] = this.a0[j];
    this.h0[i] = this.h0[j]; this.drag[i] = this.drag[j]; this.buoy[i] = this.buoy[j]; this.spin[i] = this.spin[j]; this.fadeIn[i] = this.fadeIn[j];
  }
}

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _a = new THREE.Vector3();

/**
 * All in-flight effects. Trails are laid along each emitter's path since the last frame, so a missile doing
 * 1000 m/s leaves a continuous plume rather than a dotted line.
 */
export class Effects {
  readonly group = new THREE.Group();
  smoke = new Particles(24000, 'smoke');
  fire = new Particles(4000, 'fire', { minPx: 1.2 });
  sparks = new Particles(3000, 'spark', { stretch: 0.045, minPx: 1.4 });
  /** tracers, flare cores and muzzle flashes: rebuilt every frame */
  hot = new Particles(5000, 'spark', { stretch: 0.03, minPx: 2 });
  glare = new Particles(600, 'fire', { minPx: 3 });
  private last = new Map<number, THREE.Vector3>();
  private seenChaff = new Set<number>();
  private time = 0;

  constructor() {
    this.group.name = 'effects';
    this.group.add(this.smoke.mesh, this.fire.mesh, this.sparks.mesh, this.hot.mesh, this.glare.mesh);
  }

  clear() {
    for (const p of [this.smoke, this.fire, this.sparks, this.hot, this.glare]) p.clear();
    this.last.clear(); this.seenChaff.clear();
  }

  /** lighting and screen scale for this frame */
  setView(camera: THREE.PerspectiveCamera, heightPx: number, sunDir: THREE.Vector3, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight) {
    shared.uPixel.value = 2 * Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, heightPx) / Math.max(0.1, camera.zoom);
    shared.uSunDir.value.copy(sunDir);
    shared.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.42);
    shared.uAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.5);
  }

  /** a trail from the emitter's last position to `p`, one puff every `step` metres; returns the count laid */
  private trail(id: number, p: THREE.Vector3, step: number, fn: (x: number, y: number, z: number, f: number) => void) {
    const prev = this.last.get(id);
    if (!prev) { this.last.set(id, p.clone()); fn(p.x, p.y, p.z, 1); return; }
    const d = prev.distanceTo(p);
    const n = Math.min(40, Math.max(1, Math.floor(d / step)));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      fn(prev.x + (p.x - prev.x) * f, prev.y + (p.y - prev.y) * f, prev.z + (p.z - prev.z) * f, f);
    }
    prev.copy(p);
  }

  update(world: World, dt: number) {
    this.time += dt;
    shared.uTime.value = this.time;
    const live = new Set<number>();
    const S = this.smoke, F = this.fire, K = this.sparks;
    let hot = 0, glare = 0;
    const H = this.hot, G = this.glare;

    // ---- missiles: white-hot motor plume and a thick, slowly spreading smoke trail
    for (const ms of world.missiles) {
      if (!ms.motorOn) continue;
      live.add(ms.id);
      _f.copy(ms.vel); const spd = _f.length(); if (spd > 1) _f.multiplyScalar(1 / spd); else _f.set(0, 0, -1);
      _v.copy(ms.pos).addScaledVector(_f, -1.8);
      // a soft halo for distance (the motor flame itself is a burner on the missile model, see afterburner.ts)
      if (glare < G.max) G.put(glare++, _v.x, _v.y, _v.z, 0, 0, 0, 1.6 + Math.random() * 0.5, 0.35, Math.random() * 6, 1, 1, 0.85, 0.6);
      if (hot < H.max) H.put(hot++, _v.x, _v.y, _v.z, -_f.x * 120, -_f.y * 120, -_f.z * 120, 0.5, 1, 0, 1, 1, 0.75, 0.4);
      // smoke: a tight, continuous column right behind the motor (short-lived puffs every half metre, lit orange by the
      // flame) that hands over to a trail which billows out over ~20 s into broad, drifting cloud; the grey varies a
      // little puff to puff
      live.add(ms.id + 0.5);
      this.trail(ms.id + 0.5, _v, 0.5, (x, y, z) => {
        const g = 0.93 + Math.random() * 0.05;
        S.emit(x, y, z, -_f.x * 20 + rnd(1), -_f.y * 20 + rnd(1), -_f.z * 20 + rnd(1), 0.5 + Math.random() * 0.3, 1.0, 3.2, 0.55,
          g, g, g * 0.97, { drag: 2.5, heat: 0.25, fadeIn: 0.01 });
      });
      this.trail(ms.id, _v, Math.max(2.5, spd / 160), (x, y, z, f) => {
        const g = 0.86 + Math.random() * 0.1;
        S.emit(x + rnd(0.25), y + rnd(0.25), z + rnd(0.25), rnd(2.5), rnd(2.5), rnd(2.5), 14 + Math.random() * 10, 1.6, 13 + Math.random() * 8, 0.6,
          g, g, g * 0.98, { drag: 0.5, buoy: 0.2, heat: f > 0.85 ? 0.2 : 0, fadeIn: 0.004 });
      });
    }

    // ---- aircraft: contrails, battle damage, burning wrecks, gun fire
    for (const ac of world.aircraft) {
      if (ac.removed) continue;
      const fwd = ac.fm.forward();
      _a.copy(ac.pos).addScaledVector(fwd, -ac.def.length * 0.55);
      const key = -(ac.id * 4 + 1);   // aircraft trail keys stay clear of missile and flare ids
      if (ac.fm.crashed) {
        if (Math.random() < dt * 14) {
          const gy = surfaceHeight(ac.pos.x, ac.pos.z) + 2;
          S.emit(ac.pos.x + rnd(6), gy, ac.pos.z + rnd(6), rnd(1.5), 5, rnd(1.5), 16 + Math.random() * 10, 7, 70, 0.6, 0.1, 0.1, 0.1, { drag: 0.15, buoy: 0.6 });
          if (Math.random() < 0.6) F.emit(ac.pos.x + rnd(5), gy, ac.pos.z + rnd(5), 0, 4, 0, 0.9, 5, 9, 0.8, 1, 1, 1, { heat: 0.85, buoy: 3 });
        }
        continue;
      }
      if (!ac.alive || ac.health < 45) {
        live.add(key);
        const burning = !ac.alive || ac.health < 20;
        this.trail(key, _a, 5, (x, y, z) => {
          S.emit(x, y, z, rnd(1.5), rnd(1.5), rnd(1.5), burning ? 9 : 6, 2.5, burning ? 30 : 18, burning ? 0.7 : 0.45, 0.13, 0.12, 0.11, { drag: 0.5, buoy: 0.4, heat: burning ? 0.5 : 0 });
          if (burning) F.emit(x, y, z, rnd(3), rnd(3), rnd(3), 0.35 + Math.random() * 0.3, 3, 6, 0.9, 1, 1, 1, { heat: 0.95 });
        });
      }
      if (ac.alive && ac.pos.y > 8800 && ac.fm.tas > 100) {
        live.add(key - 1);
        this.trail(key - 1, _a, 8, (x, y, z) => S.emit(x + rnd(0.5), y, z + rnd(0.5), 0, 0, 0, 14, 1.2, 9, 0.32, 1, 1, 1, { drag: 0, fadeIn: 0.1 }));
      }
      if (ac.alive && ac.gunFiring && ac.gunRounds > 0 && ac.def.gun) {
        _v.copy(ac.pos).addScaledVector(fwd, ac.def.length * 0.3).addScaledVector(ac.fm.right(), 0.6);
        const fl = 0.9 + Math.random() * 0.9;
        if (glare < G.max) G.put(glare++, _v.x, _v.y, _v.z, 0, 0, 0, fl * 1.4, 1, Math.random() * 6, 1, 1, 0.9, 0.7);
        if (hot < H.max) H.put(hot++, _v.x + fwd.x * fl, _v.y + fwd.y * fl, _v.z + fwd.z * fl, fwd.x * 70 * fl, fwd.y * 70 * fl, fwd.z * 70 * fl, 0.5 * fl, 1, 0, 1, 1, 0.8, 0.45);
        if (Math.random() < 0.5) S.emit(_v.x, _v.y, _v.z, ac.vel.x * 0.85, ac.vel.y * 0.85, ac.vel.z * 0.85, 1.4, 0.8, 7, 0.22, 0.75, 0.75, 0.72, { drag: 2.5 });
      }
    }

    // ---- countermeasures
    for (const cm of world.countermeasures) {
      if (cm.kind === 'flare') {
        live.add(cm.id);
        // a magnesium flare: blinding white core, a halo, a dense white smoke trail and sparks dripping off it
        const burn = Math.min(1, cm.life / 0.6);
        const fl = 0.85 + Math.random() * 0.3;
        if (glare < G.max) G.put(glare++, cm.pos.x, cm.pos.y, cm.pos.z, 0, 0, 0, 1.8 * fl * burn, 0.9, Math.random() * 6, 1, 1, 0.95, 0.9);
        if (glare < G.max) G.put(glare++, cm.pos.x, cm.pos.y, cm.pos.z, 0, 0, 0, 9 * fl * burn, 0.07 * burn, Math.random() * 6, 0.6, 1, 0.8, 0.55);
        if (hot < H.max) H.put(hot++, cm.pos.x, cm.pos.y, cm.pos.z, cm.vel.x, cm.vel.y, cm.vel.z, 0.9 * burn, 1, 0, 1, 1, 1, 0.95);
        this.trail(cm.id, cm.pos, 2.5, (x, y, z) => {
          S.emit(x + rnd(0.4), y + rnd(0.4), z + rnd(0.4), rnd(0.8), rnd(0.8), rnd(0.8), 3.5 + Math.random() * 2, 1.4, 9 + Math.random() * 4, 0.5 * burn, 0.97, 0.97, 0.97, { drag: 0.7, buoy: 0.2, heat: 0.15 });
        });
        if (Math.random() < dt * 40 * burn) K.emit(cm.pos.x, cm.pos.y, cm.pos.z, cm.vel.x * 0.6 + rnd(12), cm.vel.y * 0.6 - 5 + rnd(8), cm.vel.z * 0.6 + rnd(12), 0.4 + Math.random() * 0.5, 0.25, 0.15, 1, 1, 0.85, 0.55, { drag: 1.2, buoy: -9.8 });
      } else if (!this.seenChaff.has(cm.id)) {
        // chaff: a glittering cloud of foil that blooms and drifts
        this.seenChaff.add(cm.id);
        for (let k = 0; k < 50; k++) K.emit(cm.pos.x, cm.pos.y, cm.pos.z, cm.vel.x * 0.3 + rnd(14), cm.vel.y * 0.3 + rnd(14), cm.vel.z * 0.3 + rnd(14), 2.5 + Math.random() * 2, 0.12, 0.12, 0.9, 0.85, 0.9, 1, { drag: 2.2, buoy: -0.6, heat: -1 });
        for (let k = 0; k < 3; k++) S.emit(cm.pos.x + rnd(2), cm.pos.y + rnd(2), cm.pos.z + rnd(2), cm.vel.x * 0.3, cm.vel.y * 0.3, cm.vel.z * 0.3, 2.5, 2, 10, 0.12, 0.8, 0.82, 0.85, { drag: 2 });
      }
    }
    if (this.seenChaff.size > 500) this.seenChaff.clear();

    // ---- one-off effects
    for (const e of world.effects) {
      const { x, y, z } = e.pos, s = e.size;
      switch (e.type) {
        case 'fireball': case 'explosion': {
          const ground = e.type === 'explosion';
          F.emit(x, y, z, 0, 0, 0, 0.22, s * 2.5, s * 5, 1, 1, 1, 1, { heat: 1 });   // flash
          for (let k = 0; k < 22; k++) {
            _v.set(rnd(), ground ? Math.random() * 0.9 + 0.1 : rnd(), rnd()).normalize().multiplyScalar(s * (1.5 + Math.random() * 2.5));
            F.emit(x, y, z, _v.x, _v.y, _v.z, 0.9 + Math.random() * 1.1, s * 0.9, s * (2.5 + Math.random() * 1.5), 0.95, 1, 1, 1, { heat: 0.9 + Math.random() * 0.1, drag: 1.8, buoy: 4 });
          }
          for (let k = 0; k < 16; k++) {
            _v.set(rnd(), Math.random() * 0.8 + (ground ? 0.3 : 0), rnd()).multiplyScalar(s * 1.2);
            S.emit(x + rnd(s * 0.5), y + rnd(s * 0.3), z + rnd(s * 0.5), _v.x, _v.y + 3, _v.z, 12 + Math.random() * 10, s * 1.2, s * (6 + Math.random() * 4), 0.7, 0.09, 0.085, 0.08, { drag: 0.6, buoy: 0.9, heat: 0.7, fadeIn: 0.02 });
          }
          for (let k = 0; k < 36; k++) {
            _v.set(rnd(), ground ? Math.random() : rnd(), rnd()).normalize().multiplyScalar(40 + Math.random() * 90);
            K.emit(x, y, z, _v.x, _v.y, _v.z, 0.8 + Math.random() * 1.6, 0.35, 0.2, 1, 1, 0.65, 0.25, { drag: 0.6, buoy: -9.8 });
          }
          if (ground) for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2;
            S.emit(x, y + 1, z, Math.cos(a) * s * 3, 1, Math.sin(a) * s * 3, 5 + Math.random() * 3, s, s * 4, 0.45, 0.42, 0.37, 0.3, { drag: 1.4 });
          }
          break;
        }
        case 'airburst':
          F.emit(x, y, z, 0, 0, 0, 0.18, s * 2.5, s * 5, 1, 1, 1, 1, { heat: 1 });
          for (let k = 0; k < 10; k++) {
            _v.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(s * 3);
            F.emit(x, y, z, _v.x, _v.y, _v.z, 0.5 + Math.random() * 0.4, s, s * 2.6, 0.9, 1, 1, 1, { heat: 0.95, drag: 2.5 });
          }
          for (let k = 0; k < 60; k++) {
            _v.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(150 + Math.random() * 250);
            K.emit(x, y, z, _v.x, _v.y, _v.z, 0.3 + Math.random() * 0.5, 0.25, 0.15, 1, 1, 0.75, 0.35, { drag: 2, buoy: -9.8 });
          }
          for (let k = 0; k < 9; k++) {
            _v.set(rnd(), rnd(), rnd()).multiplyScalar(s * 1.5);
            S.emit(x + _v.x * 0.3, y + _v.y * 0.3, z + _v.z * 0.3, _v.x, _v.y, _v.z, 7 + Math.random() * 5, s * 1.2, s * 5, 0.55, 0.16, 0.15, 0.14, { drag: 0.8, heat: 0.5 });
          }
          break;
        case 'hit':
          F.emit(x, y, z, 0, 0, 0, 0.08, 1.5, 3, 1, 1, 1, 1, { heat: 1 });
          for (let k = 0; k < 10; k++) K.emit(x, y, z, rnd(70), rnd(70), rnd(70), 0.2 + Math.random() * 0.4, 0.15, 0.1, 1, 1, 0.8, 0.45, { drag: 1.5, buoy: -9.8 });
          S.emit(x, y, z, 0, 0, 0, 2, 1, 5, 0.4, 0.2, 0.2, 0.2, { drag: 1 });
          break;
        case 'dust':
          // a 20 mm round in the dirt: a spurt of soil and a brown puff
          for (let k = 0; k < 3; k++) S.emit(x + rnd(), y, z + rnd(), rnd(2), 6 + Math.random() * 8, rnd(2), 2 + Math.random() * 1.5, 1.2, 5 + Math.random() * 3, 0.55, 0.42, 0.36, 0.28, { drag: 1.6, buoy: -3 });
          if (Math.random() < 0.5) F.emit(x, y + 0.5, z, 0, 0, 0, 0.06, 0.8, 1.6, 1, 1, 1, 1, { heat: 1 });
          break;
        case 'launch':
          for (let k = 0; k < 6; k++) S.emit(x + rnd(2), y + rnd(1), z + rnd(2), rnd(4), rnd(3), rnd(4), 3 + Math.random() * 2, 2.5 * s, 12 * s, 0.5, 0.9, 0.9, 0.9, { drag: 1.2, buoy: 0.3 });
          F.emit(x, y, z, 0, 0, 0, 0.12, 2 * s, 4 * s, 1, 1, 1, 1, { heat: 1 });
          break;
      }
    }
    world.effects.length = 0;

    // ---- gun rounds: tracers as glowing streaks (every bullet, so the stream is visible; the tracer rounds brighter)
    const b = world.bullets;
    for (let i = 0; i < b.count && hot < H.max; i++) {
      const tr = b.tracer[i] === 1;
      if (!tr && b.owner[i] === null) continue;      // AAA: only its tracers show
      // a just-fired AAA round: muzzle flash at the gun
      if (b.owner[i] === null && b.life[i] > 3.97 && glare < G.max) G.put(glare++, b.ox[i], b.oy[i], b.oz[i], 0, 0, 0, 2.5, 1, Math.random() * 6, 1, 1, 0.85, 0.6);
      if (tr) H.put(hot++, b.px[i], b.py[i], b.pz[i], b.vx[i], b.vy[i], b.vz[i], 0.55, 1, 0, 1, 1, 0.55, 0.15);
      else H.put(hot++, b.px[i], b.py[i], b.pz[i], b.vx[i], b.vy[i], b.vz[i], 0.12, 0.12, 0, 1, 1, 0.8, 0.5);
    }

    for (const id of this.last.keys()) if (!live.has(id)) this.last.delete(id);
    S.update(dt); F.update(dt); K.update(dt);
    H.commit(hot); G.commit(glare);
  }
}
