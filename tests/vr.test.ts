import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { hudQuadSize, VR_HUD_DIST } from '../src/render/scene.js';

describe('VR HUD', () => {
  it('the HUD quad covers exactly the view the HUD was drawn for, so its symbology overlays the world 1:1', () => {
    const fov = 75, aspect = 16 / 9;
    const [w, h] = hudQuadSize(fov, aspect, VR_HUD_DIST);
    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    cam.updateMatrixWorld();
    // the quad's corners project onto the corners of the screen
    const corner = new THREE.Vector3(w / 2, h / 2, -VR_HUD_DIST).project(cam);
    expect(corner.x).toBeCloseTo(1, 6);
    expect(corner.y).toBeCloseTo(1, 6);
    // far enough away to read as collimated: < 0.2° of parallax for a 10 cm head offset
    expect(Math.atan(0.1 / VR_HUD_DIST) * 180 / Math.PI).toBeLessThan(0.2);
  });
});
