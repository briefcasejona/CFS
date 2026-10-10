import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { addSwingAttribute, bake, HD_SPECS } from '../src/render/hdModels.js';
import { getAircraft } from '../src/aircraft/defs.js';

describe('HD models', () => {
  it('swing-wing classification moves whole outer-wing triangles only', () => {
    // triangles in game frame: right outer wing, fuselage, left outer wing, aft tailplane
    const tri = (cx: number, cz: number) => [cx - 0.5, 0, cz, cx + 0.5, 0, cz, cx, 0, cz - 0.5];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...tri(6, 0), ...tri(0, 0), ...tri(-6, 0), ...tri(4.5, 6)], 3));
    addSwingAttribute(g, HD_SPECS.f14b.swing!);
    const a = Array.from(g.getAttribute('aSwing').array as Float32Array);
    expect(a).toEqual([1, 1, 1, 0, 0, 0, -1, -1, -1, 0, 0, 0]);
  });

  it('bake converts a source-frame model to game frame, scaled to the aircraft length with gear on the ground', () => {
    const def = getAircraft('jas39');
    // source frame: nose +X, up +Y, right +Z, decimetres
    const scene = new THREE.Group();
    const airframe = new THREE.Group(); airframe.name = 'Gripen-airframe_0';
    airframe.add(new THREE.Mesh(new THREE.BoxGeometry(150, 20, 80).translate(10, 0, 0), new THREE.MeshStandardMaterial()));
    const gear = new THREE.Group(); gear.name = 'Gripen-landingOn_5';
    gear.add(new THREE.Mesh(new THREE.BoxGeometry(10, 20, 10).translate(0, -20, 0), new THREE.MeshStandardMaterial()));
    scene.add(airframe, gear);
    const root = bake(scene, HD_SPECS.jas39, def);
    const box = new THREE.Box3();
    root.children.filter((c) => c.userData.role === 'body').forEach((c) => box.expandByObject(c));
    expect(box.max.z - box.min.z).toBeCloseTo(def.length, 2);            // length along game Z
    expect(box.max.x - box.min.x).toBeCloseTo(80 * def.length / 150, 2); // span along game X
    expect((box.max.z + box.min.z) / 2).toBeCloseTo(0, 2);               // centred fore-aft
    const gb = new THREE.Box3().setFromObject(root.children.find((c) => c.userData.role === 'gearDown')!);
    expect(gb.min.y).toBeCloseTo(-def.gear.height, 2);                     // wheels at the gear height
  });
});
