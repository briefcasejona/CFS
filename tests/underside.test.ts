import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { buildUnderside, hangPoint } from '../src/render/underside.js';

/** a flat wing at y = 0.3 with a rail under it (x = 3, z from 1 to 3.4, underside y = 0.1 rising 0.05 per metre aft) */
function wingWithRail() {
  const frame = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 4));
  wing.position.set(3, 0.35, 2);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 2.4));
  rail.position.set(3, 0.2, 2.2);
  rail.rotation.x = -Math.atan(0.05);
  frame.add(wing, rail);
  // any attitude: the result is measured in the frame of the airframe
  frame.rotation.set(0.4, 1.1, -0.7); frame.position.set(100, 2000, -50);
  return { frame, meshes: [wing, rail] };
}

describe('store hang points', () => {
  it('finds the skin above a station whatever the attitude', () => {
    const { frame, meshes } = wingWithRail();
    const u = buildUnderside(meshes, frame);
    expect(u.at(1, 2)).toBeCloseTo(0.3, 2);
    expect(u.at(8, 2)).toBe(Infinity);
  });
  it('puts a missile on the rail: at its height and slope, tail just behind the rail, nose ahead of it', () => {
    const { frame, meshes } = wingWithRail();
    const u = buildUnderside(meshes, frame);
    const h = hangPoint(u, 3, 2.6, 3.66, true);
    expect(h.rail).toBe(true);
    expect(h.slope).toBeGreaterThan(0.03); expect(h.slope).toBeLessThan(0.07);
    expect(h.y).toBeLessThan(0.2);
    const tail = h.z + 1.83, nose = h.z - 1.83;
    expect(tail).toBeGreaterThan(3.3); expect(tail).toBeLessThan(4);
    expect(nose).toBeLessThan(1);
  });
  it('leaves a store on bare skin at its station', () => {
    const { frame, meshes } = wingWithRail();
    const u = buildUnderside(meshes, frame);
    const h = hangPoint(u, 1.2, 2, 4, false);
    expect(h.rail).toBe(false);
    expect(h.z).toBe(2);
    expect(h.y).toBeCloseTo(0.3, 2);
  });
});
