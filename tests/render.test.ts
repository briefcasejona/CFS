import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { bake, instantiateHd, updateHdInstance, HD_SPECS } from '../src/render/hdModels.js';
import { getAircraft } from '../src/aircraft/defs.js';
import { buildCockpit } from '../src/render/cockpit.js';

describe('procedural cockpit', () => {
  it('builds an eye-relative cockpit; two-seaters get a rear cockpit, framed canopies a bow', () => {
    const single = buildCockpit(getAircraft('f16c'), []);
    const twin = buildCockpit(getAircraft('f16d'), []);
    const tomcat = buildCockpit(getAircraft('f14a'), []);
    expect(twin.group.children.length).toBeGreaterThan(single.group.children.length);
    const hasBow = (g: THREE.Group) => g.children.some((c) => (c as THREE.Mesh).geometry?.type === 'TorusGeometry');
    expect(hasBow(single.group)).toBe(false); // F-16 bubble canopy
    expect(hasBow(tomcat.group)).toBe(true);
    // everything in front of the eye is below the sight line (nothing blocks the HUD view)
    const box = new THREE.Box3();
    single.group.children.filter((c) => c.position.z < -0.3).forEach((c) => box.expandByObject(c));
    expect(box.max.y).toBeLessThan(0);
    expect(single.group.visible).toBe(false);
  });
});

describe('HD models', () => {
  it('F-14 wings sweep as whole parts about the real pivot: published spans, nothing crosses the fuselage', () => {
    const def = getAircraft('f14b');
    // source frame of the F-14 model: nose +Z, left +X, metres; wing panel + a flap and a slat per side, plus the glove
    const box = (name: string, x0: number, x1: number, z0: number, z1: number, y = 0.6) => {
      const n = new THREE.Group(); n.name = name;
      n.add(new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.1, z1 - z0).translate((x0 + x1) / 2, y, (z0 + z1) / 2), new THREE.MeshStandardMaterial()));
      return n;
    };
    const scene = new THREE.Group();
    scene.add(box('vehicle#fuse_79', -1.6, 1.6, -9.55, 9.55, 0.3));
    for (const [s, side] of [[1, 'l'], [-1, 'r']] as const) {
      const lo = (a: number, b: number) => (s > 0 ? [a, b] : [-b, -a]) as [number, number];
      // wing panel: trapezoid, root chord z −2.7…1.1 at x 2.3, tip chord −2.7…−1.6 at x 9.76 (20° leading-edge sweep)
      const wing = new THREE.Group(); wing.name = `vehicle#wing_${side}_166`;
      const g = new THREE.BufferGeometry();
      const P = [[2.3, 1.1], [2.3, -2.7], [9.76, -2.7], [9.76, -1.6]].map(([x, z]) => [s * x, 0.6, z]);
      g.setAttribute('position', new THREE.Float32BufferAttribute([...P[0], ...P[1], ...P[2], ...P[0], ...P[2], ...P[3]], 3));
      wing.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
      scene.add(wing);
      scene.add(box(`vehicle#flap_${side}_168`, ...lo(3.8, 8.98), -2.65, -1.55));
      scene.add(box(`vehicle#slat_${side}_167`, ...lo(3.34, 9.1), 0.5, 0.86));
      scene.add(box(`vehicle#wing3_${side}_88`, ...lo(1.72, 2.67), 2.2, 4.7));   // glove vane: fixed
    }
    const inst = instantiateHd({ root: bake(scene, HD_SPECS['F-14'], def), spec: HD_SPECS['F-14'] });
    // per side the panel, flap and slat move with the wing (the glove vane does not)
    expect(inst.wings!.left.children.length).toBe(3);
    expect(inst.wings!.right.children.length).toBe(3);
    const halfSpan = (sweep: number) => {
      updateHdInstance(inst, 0, sweep);
      inst.root.updateMatrixWorld(true);
      // the panel (first part) sets the span; flaps and slats only need to move along
      const b = new THREE.Box3().setFromObject(inst.wings!.right.children[0], true);
      const l = new THREE.Box3().setFromObject(inst.wings!.left.children[0], true);
      return { tip: b.max.x, tipL: -l.min.x, root: Math.min(b.min.x, -l.max.x) };
    };
    const s = def.length / 19.1;
    const at20 = halfSpan(20), at68 = halfSpan(68);
    // (the pivot itself is fitted to the real model's vertices so the published 68°/75° spans come out —
    //  see scripts/models/wing-tmp analysis in docs; this synthetic wing only checks the mechanics)
    expect(at20.tip / s).toBeCloseTo(9.76, 1);
    expect(at68.tip < at20.tip * 0.75, `68° half-span ${(at68.tip / s).toFixed(2)} m should be well inside 9.76`).toBe(true);
    expect(at68.tipL).toBeCloseTo(at68.tip, 3);                         // symmetric
    // the inboard trailing corner tucks into the glove (as on the real jet) but never crosses the centreline — the
    // old shader sweep made the wings cross over the fuselage
    expect(at68.root > 0.05, `swept wing reaches x=${at68.root.toFixed(2)} — across the centreline`).toBe(true);
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
    const root = bake(scene, HD_SPECS['JAS 39'], def);
    const box = new THREE.Box3();
    root.children.filter((c) => c.userData.role === 'body').forEach((c) => box.expandByObject(c));
    expect(box.max.z - box.min.z).toBeCloseTo(def.length, 2);            // length along game Z
    expect(box.max.x - box.min.x).toBeCloseTo(80 * def.length / 150, 2); // span along game X
    expect((box.max.z + box.min.z) / 2).toBeCloseTo(0, 2);               // centred fore-aft
    const gb = new THREE.Box3().setFromObject(root.children.find((c) => c.userData.role === 'gearDown')!);
    expect(gb.min.y).toBeCloseTo(-def.gear.height, 2);                     // wheels at the gear height
  });
});
