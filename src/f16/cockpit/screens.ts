// The cockpit model's displays: the two MFD screens, the DED and the HUD glass (Jonathan's node names,
// 2026-11-22). Each screen gets a canvas texture laid flat over its face; the HUD is projected through the angled
// glass from the pilot's eye, so the symbology lies on the outside world as a collimated HUD does.
import * as THREE from 'three';
import { HUD_FIELD, HUD_PX } from '../avionics/hud.js';

/** node names: MFD_LEFT_SCREEN, "MFD_RIGHT SCREEN" (sanitized), the DED (Object_42.004 now, DED_DISPLAY later), the
 *  HUD glass Object_22.001 */
export const SCREEN_NODES = {
  mfdLeft: ['MFD_LEFT_SCREEN'],
  mfdRight: ['MFD_RIGHT_SCREEN'],
  ded: ['DED_DISPLAY', 'Object_42004'],
  hud: ['Object_22001'],
};

export interface Screen { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh }

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D } | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    return ctx ? { canvas: c, ctx } : null;
  }
  return null;
}

/** UVs from the face's own plane: u to the right, v up, as the pilot sees it from `eye` */
function planarUv(geo: THREE.BufferGeometry, eye: THREE.Vector3, matrix: THREE.Matrix4) {
  const pos = geo.getAttribute('position');
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix));
  const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, pts.length));
  const n = c.clone().sub(eye).normalize().negate();   // towards the pilot
  const up = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y)).normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const uv = pts.map((p) => { const d = p.clone().sub(c); const u = d.dot(right), v = d.dot(up); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); return [u, v]; });
  const arr = new Float32Array(pos.count * 2);
  uv.forEach(([u, v], i) => { arr[i * 2] = (u - u0) / Math.max(1e-6, u1 - u0); arr[i * 2 + 1] = (v - v0) / Math.max(1e-6, v1 - v0); });
  geo.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
}

export class CockpitScreens {
  mfd: [Screen | null, Screen | null] = [null, null];
  ded: Screen | null = null;
  hud: Screen | null = null;

  constructor(root: THREE.Object3D, byName: Map<string, THREE.Object3D>, eye: THREE.Vector3) {
    const find = (names: string[]) => { for (const n of names) { const o = byName.get(n); if (o) return o; } return null; };
    const mesh = (o: THREE.Object3D | null): THREE.Mesh | null => {
      if (!o) return null;
      if ((o as THREE.Mesh).isMesh) return o as THREE.Mesh;
      let m: THREE.Mesh | null = null;
      o.traverse((x) => { if (!m && (x as THREE.Mesh).isMesh) m = x as THREE.Mesh; });
      return m;
    };
    root.updateMatrixWorld(true);
    const flat = (names: string[], w: number, h: number): Screen | null => {
      const m = mesh(find(names));
      const cv = makeCanvas(w, h);
      if (!m || !cv) return null;
      m.geometry = m.geometry.clone();
      planarUv(m.geometry, eye, m.matrixWorld);
      const tex = new THREE.CanvasTexture(cv.canvas as HTMLCanvasElement);
      tex.colorSpace = THREE.SRGBColorSpace;
      // the screen face lies about a millimetre over the bezel behind it: pull it forward in depth, or the two fight
      m.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
      m.renderOrder = 1;
      return { ...cv, tex, mesh: m };
    };
    this.mfd = [flat(SCREEN_NODES.mfdLeft, 512, 512), flat(SCREEN_NODES.mfdRight, 512, 512)];
    this.ded = flat(SCREEN_NODES.ded, 480, 100);
    // the HUD: a copy of the glass, in the cockpit's frame, that looks up the symbology by the direction from the
    // eye to each point of the glass
    const g = mesh(find(SCREEN_NODES.hud));
    const cv = makeCanvas(HUD_PX, HUD_PX);
    if (g && cv) {
      const geo = g.geometry.clone();
      geo.applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(g.matrixWorld));
      const tex = new THREE.CanvasTexture(cv.canvas as HTMLCanvasElement);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, eye: { value: eye.clone() }, field: { value: new THREE.Vector3(HUD_FIELD.az, HUD_FIELD.elTop, HUD_FIELD.elBottom) } },
        vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform vec3 eye; uniform vec3 field; varying vec3 vP;
          void main() {
            vec3 d = vP - eye;
            float az = degrees(atan(d.x, -d.z));
            float el = degrees(atan(d.y, length(d.xz)));
            vec2 uv = vec2(0.5 + az / (2.0 * field.x), 1.0 - (field.y - el) / (field.y - field.z));
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
            vec3 c = texture2D(map, uv).rgb;
            gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
          }`,
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const hm = new THREE.Mesh(geo, mat);
      hm.name = 'hud-projection';
      hm.renderOrder = 10;
      root.add(hm);
      this.hud = { ...cv, tex, mesh: hm };
    }
  }

  dispose() {
    for (const s of [...this.mfd, this.ded, this.hud]) s?.tex.dispose();
  }
}
