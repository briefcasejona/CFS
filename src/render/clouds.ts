// Volumetric clouds: a post pass that ray-marches a layer of 3D-noise cloud between the cloud base and its tops,
// in front of whatever the scene drew there (read back from the logarithmic depth buffer). Lit by the sun with a short
// march towards it (self-shadowing, Beer–powder), a forward-scattering phase (silver linings) and the sky's light
// from above; faded into the haze with distance. Scattered weather builds cumulus, overcast a thick grey deck.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const N = 64;

/** tileable 3D noise, N³: low-frequency billows (R) and a finer erosion layer (G) */
function noiseTexture() {
  const lattice = (p: number) => {
    const g = new Float32Array(p * p * p);
    let s = 1234567 + p * 7919;
    for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; }
    return g;
  };
  const sample = (g: Float32Array, p: number, x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const at = (i: number, j: number, k: number) => g[(((k % p) + p) % p) * p * p + (((j % p) + p) % p) * p + (((i % p) + p) % p)];
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(at(xi, yi, zi), at(xi + 1, yi, zi), sx), l(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), sx), sy),
      l(l(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), sx), l(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), sx), sy), sz);
  };
  const octaves = [4, 8, 16, 32].map((p) => ({ p, g: lattice(p) }));
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0, b = 0;
    octaves.forEach(({ p, g }, o) => {
      const v = sample(g, p, (x / N) * p, (y / N) * p, (z / N) * p);
      if (o < 3) a += v * [0.55, 0.3, 0.15][o];
      if (o > 0) b += v * [0, 0.5, 0.3, 0.2][o];
    });
    // billows: a puffy, cauliflower response (1 − |2n − 1| folds the noise into round lobes)
    const billow = 1 - Math.abs(a * 2 - 1);
    const k = ((z * N + y) * N + x) * 4;
    data[k] = Math.round(Math.min(1, Math.max(0, a * 0.6 + billow * 0.4)) * 255);
    data[k + 1] = Math.round(b * 255);
    data[k + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tNoise: { value: null as THREE.Texture | null },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uLogFar: { value: 1 },
    uBase: { value: 3500 },
    uTop: { value: 5000 },
    uCover: { value: 0.45 },
    uDensity: { value: 0.035 },
    uScale: { value: 1 / 9000 },
    uWind: { value: new THREE.Vector2() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.8) },
    uFogCol: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uFogDensity: { value: 0.00002 },
    uFrame: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `precision highp float;
precision highp sampler3D;
uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler3D tNoise;
uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform float uLogFar;
uniform float uBase; uniform float uTop; uniform float uCover; uniform float uDensity; uniform float uScale; uniform vec2 uWind;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uFogCol; uniform float uFogDensity; uniform float uFrame;
varying vec2 vUv;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// cloud density at a world point
float density(vec3 p, bool detail) {
  float h = (p.y - uBase) / (uTop - uBase);
  if (h < 0.0 || h > 1.0) return 0.0;
  vec3 q = vec3(p.x + uWind.x, p.y, p.z + uWind.y) * uScale;
  // large-scale weather: where cells may grow at all
  float weather = texture(tNoise, vec3(q.xz * 0.23, 0.37)).r;
  float cov = clamp(uCover + (weather - 0.5) * 0.6, 0.0, 1.0);
  float shape = texture(tNoise, q * vec3(1.0, 2.2, 1.0)).r;
  // rounded bottoms flat at the base, tops that taper (cumulus); a deck stays full height when overcast
  float profile = smoothstep(0.0, 0.08, h) * mix(smoothstep(1.0, 0.35, h), smoothstep(1.0, 0.85, h), step(0.9, uCover));
  float d = clamp((shape * profile - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
  if (detail && d > 0.0) {
    float er = texture(tNoise, q * 5.3 + vec3(0.0, uFrame * 0.0, 0.0)).g;
    d = clamp(d - (1.0 - er) * 0.45 * (1.0 - h * 0.4), 0.0, 1.0);
  }
  return d * uDensity;
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  // view ray
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 vdir = normalize(vp.xyz / vp.w);
  vec3 dir = normalize((uCamWorld * vec4(vdir, 0.0)).xyz);
  // scene distance from the logarithmic depth (w = 2^(d·log2(far+1)) − 1 is the view depth)
  float dz = texture2D(tDepth, vUv).x;
  float sceneT = dz >= 0.99999 ? 1e9 : (exp2(dz * uLogFar) - 1.0) / max(1e-4, -vdir.z);
  // the cloud slab along the ray
  float t0, t1;
  if (abs(dir.y) < 1e-5) { if (uCamPos.y < uBase || uCamPos.y > uTop) { gl_FragColor = scene; return; } t0 = 0.0; t1 = 60000.0; }
  else {
    float ta = (uBase - uCamPos.y) / dir.y, tb = (uTop - uCamPos.y) / dir.y;
    t0 = max(0.0, min(ta, tb)); t1 = max(ta, tb);
  }
  t1 = min(t1, min(sceneT, 110000.0));
  if (t1 <= t0) { gl_FragColor = scene; return; }
  // steps grow with distance: fine close in, coarse where a cloud is a few pixels across (grazing rays at the horizon
  // cross tens of km of the layer)
  const int STEPS = 96;
  float t = t0 + clamp(t0 * 0.02, 40.0, 1200.0) * hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0);
  float cosT = dot(dir, uSunDir);
  float phase = mix(hg(cosT, 0.6), hg(cosT, -0.2), 0.35) * 4.0 * 3.14159;
  vec3 light = vec3(0.0);
  float trans = 1.0;
  float firstT = -1.0;
  for (int i = 0; i < STEPS; i++) {
    if (t > t1 || trans < 0.015) break;
    float dt = clamp(t * 0.02, 40.0, 1200.0);
    vec3 p = uCamPos + dir * t;
    // the fine erosion only where it can be resolved: far out it is just grain
    float d = density(p, t < 14000.0);
    if (d > 0.0) {
      if (firstT < 0.0) firstT = t;
      // light march towards the sun through the cloud above this point
      float od = 0.0, ls = (uTop - uBase) * 0.18;
      for (int j = 1; j <= 4; j++) od += density(p + uSunDir * ls * float(j), false) * ls;
      float sunT = exp(-od) ;
      float powder = 1.0 - exp(-d * dt * 2.0);
      float h = (p.y - uBase) / (uTop - uBase);
      vec3 S = uSunCol * sunT * phase * mix(1.0, powder * 2.0, 0.5) + uSkyCol * (0.5 + 0.5 * h);
      float a = exp(-d * dt);
      // energy-conserving integration over the step
      light += trans * S * (1.0 - a);
      trans *= a;
    }
    t += dt;
  }
  if (firstT < 0.0) { gl_FragColor = scene; return; }
  // opaque once the march gave up: no sliver of the sun disc leaking through a thick deck
  if (trans < 0.015) trans = 0.0;
  // the haze between the eye and the cloud
  float fog = 1.0 - exp(-pow(uFogDensity * firstT, 2.0));
  light = mix(light, uFogCol * (1.0 - trans), fog);
  // far out the layer thins to the horizon haze instead of ending in a hard edge
  // far out the layer melts into the haze instead of ending in a hard edge
  float fade = smoothstep(55000.0, 100000.0, firstT);
  light = mix(light, uFogCol * (1.0 - trans), fade);
  float cloudA = (1.0 - trans) * (1.0 - fade * 0.6);
  gl_FragColor = vec4(scene.rgb * (1.0 - cloudA) + light * (1.0 - fade * 0.6), scene.a);
}`,
};

export class CloudPass extends Pass {
  readonly uniforms = THREE.UniformsUtils.clone(SHADER.uniforms);
  private quad: FullScreenQuad;
  private camera: THREE.PerspectiveCamera;
  enabledByWeather = true;

  constructor(camera: THREE.PerspectiveCamera) {
    super();
    this.camera = camera;
    this.uniforms.tNoise.value = noiseTexture();
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SHADER.vertexShader, fragmentShader: SHADER.fragmentShader, depthTest: false, depthWrite: false }));
  }

  /** cloud deck from the weather: scattered cumulus or a thick overcast */
  setWeather(clouds: 'clear' | 'scattered' | 'overcast', base: number) {
    this.enabledByWeather = clouds !== 'clear';
    const u = this.uniforms;
    u.uBase.value = base;
    u.uTop.value = base + (clouds === 'overcast' ? 1400 : 2200);
    u.uCover.value = clouds === 'overcast' ? 0.92 : 0.3;
    u.uDensity.value = clouds === 'overcast' ? 0.03 : 0.04;
    u.uScale.value = clouds === 'overcast' ? 1 / 14000 : 1 / 6000;
  }

  /** per frame: camera, sun and sky light, haze and the wind's drift */
  update(sunDir: THREE.Vector3, sun: THREE.DirectionalLight, sky: THREE.Color, fog: THREE.FogExp2, time: number) {
    const u = this.uniforms, cam = this.camera;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uLogFar.value = Math.log2(cam.far + 1);
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 1.1);
    u.uSkyCol.value.copy(sky);
    u.uFogCol.value.copy(fog.color);
    u.uFogDensity.value = fog.density;
    u.uWind.value.set(time * 6, time * 2.5);
    u.uFrame.value = (u.uFrame.value + 1) % 1000;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() { this.quad.dispose(); (this.uniforms.tNoise.value as THREE.Texture).dispose(); }
}
