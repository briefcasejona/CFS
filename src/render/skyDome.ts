// The visible sky: a deep blue overhead that pales to the haze in a narrow band at the horizon, with the sun's disc
// and glow. Colours are set per weather and time of day (linear, before tone mapping), so the dome, the distance haze
// and the far clouds all meet in the same colour at the horizon.
import * as THREE from 'three';

export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor() {
    super(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uBand: { value: 14 },
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHaze; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uBand;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  // the haze layer seen edge-on: a pale band hugging the horizon (wider on a hazy day)
  col = mix(col, uHaze, exp(-h * uBand));
  float c = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunCol * (smoothstep(0.99992, 0.99997, c) * 30.0 + pow(c, 900.0) * 1.2 + pow(c, 48.0) * 0.1 + pow(c, 6.0) * 0.035) * step(-0.02, d.y);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }));
    this.frustumCulled = false;
    this.renderOrder = -10;
  }
}
