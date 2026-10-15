// Engine exhaust anchored at a nozzle exit: a glowing nozzle (hot turbine and liner), and with afterburner a layered
// flame — a white-yellow core with a train of shock diamonds inside a longer, fainter orange and blue envelope —
// plus a soft glare at the nozzle. All shader-driven and additive, so it costs a few draw calls per engine.
// The same burner is built at the HD model's fitted nozzles and at the procedural model's, so the flame stays put
// whichever model is drawn.
import * as THREE from 'three';

export interface BurnerState {
  /** afterburner stage 0..1 */
  ab: number;
  /** core (dry) power 0..1 */
  core: number;
  alive: boolean;
}

const VS = `
uniform float uLen;
uniform float uR;
uniform float uTime;
uniform float uDiamonds;   // number of shock diamonds
uniform float uPinch;      // how strongly the diamonds pinch the flame
varying float vT;          // 0 at the nozzle .. 1 at the tip
varying vec3 vN;
varying vec3 vView;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = position;
  float t = clamp(-p.y, 0.0, 1.0);   // lathe built along -y, 0..1
  // radius: leaves the nozzle at its exit radius, swells a little, then tapers to a point; the diamonds pinch it
  float env = (1.0 + 0.25 * sin(t * 3.14159)) * pow(1.0 - t, 0.75);
  float dia = 1.0 - uPinch * (0.5 - 0.5 * cos(t * uDiamonds * 6.28318)) * (1.0 - t);
  float wob = 1.0 + 0.04 * sin(uTime * 53.0 + t * 19.0) + 0.03 * sin(uTime * 31.0 - t * 11.0);
  float rad = uR * env * dia * wob;
  vec2 xz = normalize(p.xz + vec2(1e-6)) * rad;
  vec3 q = vec3(xz.x, xz.y, t * uLen);   // body frame: aft is +z
  vT = t;
  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  vN = normalize(normalMatrix * normalize(vec3(xz.x, xz.y, uR * 0.35)));
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FS = `
uniform float uTime;
uniform float uDiamonds;
uniform float uGain;
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uCool;
uniform float uDiamondGain;
varying float vT;
varying vec3 vN;
varying vec3 vView;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // optical depth: bright where you look through the middle of the plume, soft at its edges
  float face = abs(dot(normalize(vN), normalize(vView)));
  float thick = pow(face, 1.6);
  // colour runs hot → mid → cool along the plume
  vec3 col = mix(uHot, uMid, smoothstep(0.0, 0.45, vT));
  col = mix(col, uCool, smoothstep(0.4, 1.0, vT));
  // shock diamonds: bright bands that fade down the plume
  float d = pow(0.5 + 0.5 * cos(vT * uDiamonds * 6.28318), 6.0) * (1.0 - smoothstep(0.1, 0.85, vT));
  float flick = 0.9 + 0.1 * sin(uTime * 71.0 + vT * 23.0) * sin(uTime * 17.0);
  float fade = (1.0 - smoothstep(0.55, 1.0, vT)) * smoothstep(0.0, 0.04, vT + 0.02);
  vec3 c = col * (thick * fade + d * uDiamondGain * thick) * uGain * flick;
  gl_FragColor = vec4(c, 1.0);
}`;

function latheGeometry(rings = 48, seg = 24) {
  // unit lathe along -y (0..1), radius 1; the vertex shader shapes it
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rings; i++) pts.push(new THREE.Vector2(1, -i / rings));
  return new THREE.LatheGeometry(pts, seg);
}

let latheGeo: THREE.LatheGeometry | null = null;
let glareTex: THREE.Texture | null = null;
const discGeo = new THREE.CircleGeometry(1, 32);

function glareTexture() {
  if (glareTex) return glareTex;
  const n = 128, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const x = cv.getContext('2d')!;
  const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,240,210,1)');
  g.addColorStop(0.15, 'rgba(255,190,110,0.55)');
  g.addColorStop(0.45, 'rgba(255,120,40,0.12)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, n, n);
  glareTex = new THREE.CanvasTexture(cv);
  glareTex.colorSpace = THREE.SRGBColorSpace;
  return glareTex;
}

const shared = { uTime: { value: 0 } };
export function setBurnerTime(t: number) { shared.uTime.value = t; }

function plumeMaterial(r: number, len: number, o: { hot: number; mid: number; cool: number; diamonds: number; pinch: number; dgain: number }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime, uLen: { value: len }, uR: { value: r }, uDiamonds: { value: o.diamonds }, uPinch: { value: o.pinch },
      uGain: { value: 0 }, uDiamondGain: { value: o.dgain },
      uHot: { value: new THREE.Color(o.hot) }, uMid: { value: new THREE.Color(o.mid) }, uCool: { value: new THREE.Color(o.cool) },
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

export interface Burner {
  group: THREE.Group;
  update(s: BurnerState): void;
}

/** A burner at nozzle exit (x, y, z) with exit radius r, body frame (z aft). */
export function createBurner(x: number, y: number, z: number, r: number): Burner {
  latheGeo ??= latheGeometry();
  const group = new THREE.Group();
  group.name = 'burner';
  group.position.set(x, y, z);
  // core: short, hot, with the diamonds; envelope: long, faint, orange then blue
  const coreLen = r * 9, envLen = r * 16;
  const core = new THREE.Mesh(latheGeo, plumeMaterial(r * 0.72, coreLen, { hot: 0xfff2d0, mid: 0xffb35a, cool: 0xff6a20, diamonds: 4.5, pinch: 0.35, dgain: 3.5 }));
  const env = new THREE.Mesh(latheGeo, plumeMaterial(r * 1.0, envLen, { hot: 0xffa050, mid: 0xd0602a, cool: 0x3040a0, diamonds: 0, pinch: 0, dgain: 0 }));
  for (const m of [core, env]) { m.frustumCulled = false; m.renderOrder = 3; group.add(m); }
  // the nozzle's hot interior, set a little inside the exit and facing aft
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const glow = new THREE.Mesh(discGeo, glowMat);
  glow.scale.setScalar(r * 0.95);
  glow.position.z = -0.06;
  group.add(glow);
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  glare.position.z = r * 0.6;
  glare.renderOrder = 4;
  group.add(glare);
  const cm = core.material as THREE.ShaderMaterial, em = env.material as THREE.ShaderMaterial;
  let lenK = -1;
  return {
    group,
    update(s) {
      const ab = s.alive ? s.ab : 0;
      const dry = s.alive ? s.core : 0;
      const on = ab > 0.02;
      core.visible = env.visible = on;
      glare.visible = on;
      glow.visible = s.alive;
      // dry power: only the nozzle glows (dull red at idle, orange at military)
      glowMat.color.setRGB(1, 0.32 + 0.35 * ab, 0.1 + 0.2 * ab).multiplyScalar(0.12 + 0.35 * dry + 1.4 * ab);
      if (!on) return;
      const k = 0.55 + 0.45 * ab;   // the plume lengthens through the AB stages
      if (Math.abs(k - lenK) > 0.01) { core.scale.set(1, 1, k); env.scale.set(1, 1, k); lenK = k; }
      cm.uniforms.uGain.value = 0.55 + 0.6 * ab;
      em.uniforms.uGain.value = 0.18 + 0.22 * ab;
      glare.scale.setScalar(r * (4 + 4 * ab) * (0.92 + Math.random() * 0.16));
      glare.material.opacity = 0.35 + 0.4 * ab;
    },
  };
}
