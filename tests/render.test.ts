import { describe, expect, it } from './expect.js';
import * as THREE from 'three';
import { bake, instantiateHd, updateHdInstance, HD_SPECS } from '../src/render/hdModels.js';
import { getAircraft } from '../src/aircraft/defs.js';
import { loadGlbScene } from './glbScene.js';
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
    const inst = instantiateHd({ root: bake(scene, HD_SPECS.f14d, def), spec: HD_SPECS.f14d });
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

  it("bohmerang's F-14A (F-14A/B): the wings are cut out of the airframe mesh and sweep to the published spans", async () => {
    const def = getAircraft('f14a');
    const spec = HD_SPECS.f14a;
    expect(HD_SPECS.f14b1).toBe(spec);
    expect(HD_SPECS.f14d.url).toContain('f14d.glb');                      // the D keeps the KOG_THORNS model
    const inst = instantiateHd({ root: bake(await loadGlbScene('assets/models/cc-by-nc-sa/f14.glb'), spec, def), spec });
    const span = (sweep: number) => {
      updateHdInstance(inst, 0, sweep);
      inst.root.updateMatrixWorld(true);
      const r = new THREE.Box3().setFromObject(inst.wings!.right, true), l = new THREE.Box3().setFromObject(inst.wings!.left, true);
      return { half: r.max.x, halfL: -l.min.x, root: Math.min(r.min.x, -l.max.x) };
    };
    // published spans: 19.54 m at 20°, 11.65 m at 68°, 10.15 m oversweep (75°)
    for (const [sweep, full] of [[20, 19.54], [68, 11.65], [75, 10.15]]) {
      const s = span(sweep);
      expect(Math.abs(2 * s.half - full) < 0.15, `span at ${sweep}°: ${(2 * s.half).toFixed(2)} m, published ${full} m`).toBe(true);
      expect(s.halfL).toBeCloseTo(s.half, 3);
      expect(s.root > 0.05, `at ${sweep}° the wing reaches x=${s.root.toFixed(2)}, across the centreline`).toBe(true);
    }
    // the stabilators and the glove stay on the fuselage
    const body = new THREE.Box3();
    inst.root.children.filter((c) => (c as THREE.Mesh).isMesh && c.userData.role === 'body').forEach((c) => body.expandByObject(c));
    expect(body.max.x < 5, `fixed parts reach ${body.max.x.toFixed(2)} m out`).toBe(true);
  });

  it("KOG_THORNS' F-14B (F-14B(U) only): swing wings sweep to the published spans, gear retracts", async () => {
    const def = getAircraft('f14b');
    const spec = HD_SPECS.f14b;
    expect(spec.url).toContain('f14b.glb');
    const root = bake(await loadGlbScene(spec.url), spec, def);
    const inst = instantiateHd({ root, spec });
    const span = (sweep: number) => {
      updateHdInstance(inst, 0, sweep);
      inst.root.updateMatrixWorld(true);
      const r = new THREE.Box3().setFromObject(inst.wings!.right, true);
      return { half: r.max.x, root: r.min.x };
    };
    // the model is drawn ~2% short of the published 19.54 m at 20°. Its straight wing root only stays inside the glove
    // with the pivot ~0.45 m forward of where the published swept spans would put it, so the swept spans come out
    // ~6% short: a playtester saw the root corner poke out of the glove, nobody sees 0.7 m of span
    for (const [sweep, full, tol] of [[20, 19.54, 0.6], [68, 11.65, 0.75], [75, 10.15, 0.75]]) {
      const s = span(sweep);
      expect(Math.abs(2 * s.half - full) < tol, `span at ${sweep}°: ${(2 * s.half).toFixed(2)} m, published ${full} m`).toBe(true);
      expect(s.root > 0.05, `at ${sweep}° the wing reaches x=${s.root.toFixed(2)}, across the centreline`).toBe(true);
    }
    const gear = new THREE.Box3();
    root.children.filter((c) => c.userData.role === 'gearDown').forEach((c) => gear.expandByObject(c));
    expect(gear.min.y).toBeCloseTo(-def.gear.height, 2);
    expect(root.children.filter((c) => c.userData.role === 'cockpit').length > 0).toBe(true);
  });

  it('F-16D Block 70 model: only on the D Block 70, real size, gear and its doors retract', async () => {
    const def = getAircraft('f16d70');
    const spec = HD_SPECS.f16d70;
    for (const id of ['f16a', 'f16b', 'f16c40', 'f16d', 'f16d40']) expect(HD_SPECS[id]).toBe(undefined);
    const root = bake(await loadGlbScene('assets/models/cc-by/f16d70.glb'), spec, def);
    const box = (role: string) => {
      const b = new THREE.Box3();
      root.children.filter((c) => c.userData.role === role).forEach((c) => b.expandByObject(c));
      return b;
    };
    const body = box('body'), gear = box('gearDown');
    expect(body.max.z - body.min.z).toBeCloseTo(def.length, 1);
    // published span 9.96 m over the wingtip rails
    expect(Math.abs(body.max.x - body.min.x - 9.96) < 0.3, `span ${(body.max.x - body.min.x).toFixed(2)} m`).toBe(true);
    expect(gear.min.y).toBeCloseTo(-def.gear.height, 2);
    // the nose and main gear doors hang below the belly and ventral fins: they go with the gear
    const doors = new THREE.Box3();
    root.children.filter((c) => c.name.endsWith('#gearDoors')).forEach((c) => doors.expandByObject(c));
    expect(doors.isEmpty()).toBe(false);
    expect(root.children.find((c) => c.name.endsWith('#gearDoors'))!.userData.role).toBe('gearDown');
    expect(body.min.y > doors.min.y + 0.1, `airframe reaches y=${body.min.y.toFixed(2)} with the gear up`).toBe(true);
    expect(root.children.filter((c) => c.userData.role === 'cockpit').length > 0).toBe(true);
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

  it('the opaque HUD plates of the bohmerang models (F-16, F/A-18F, F-4E, Gripen) become see-through combiner glass', () => {
    for (const [key, id] of [['f16c', 'f16c'], ['fa18e', 'fa18e'], ['f4e', 'f4e'], ['JAS 39', 'jas39']] as const) {
      const scene = new THREE.Group();
      const airframe = new THREE.Group(); airframe.name = 'X-airframe_0';
      airframe.add(new THREE.Mesh(new THREE.BoxGeometry(150, 20, 80), new THREE.MeshStandardMaterial()));
      const hud = new THREE.Group(); hud.name = 'X-hud_3';
      hud.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2).translate(60, 10, 0), new THREE.MeshStandardMaterial({ color: 0x00cc00 })));
      scene.add(airframe, hud);
      const inst = instantiateHd({ root: bake(scene, HD_SPECS[key], getAircraft(id)), spec: HD_SPECS[key] });
      const plate = inst.root.children.find((c) => /hud/i.test(c.name)) as THREE.Mesh;
      const m = plate.material as THREE.MeshStandardMaterial;
      expect(m.transparent && m.opacity < 0.3, `${key}: HUD plate opacity ${m.opacity}`).toBe(true);
      expect(inst.glass.includes(plate), `${key}: the combiner stays visible from the cockpit`).toBe(false);
    }
  });

  it('seat height: the eye sits high under the canopy, with the model\'s own cockpit, in the F-14A/B, F-16 and Gripen', async () => {
    for (const [key, id] of [['f14a', 'f14a'], ['f14b', 'f14b'], ['f16c', 'f16c'], ['f16d70', 'f16d70'], ['JAS 39', 'jas39']] as const) {
      const spec = HD_SPECS[key];
      const inst = instantiateHd({ root: bake(await loadGlbScene(spec.url), spec, getAircraft(id)), spec });
      // a model without cockpit parts falls back to the procedural cockpit, which then shows through the HD one
      expect(inst.cockpit.length > 0, `${key}: no HD cockpit parts matched`).toBe(true);
      const meshes: THREE.Object3D[] = [];
      inst.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { ((o as THREE.Mesh).material as THREE.Material).side = THREE.DoubleSide; meshes.push(o); } });
      inst.root.updateMatrixWorld(true);
      const up = new THREE.Raycaster(inst.eye.clone(), new THREE.Vector3(0, 1, 0)).intersectObjects(meshes, false).find((h) => inst.glass.includes(h.object));
      expect(!!up, `${key}: no canopy above the eye`).toBe(true);
      expect(up!.distance > 0.04 && up!.distance < 0.25, `${key}: canopy ${up!.distance.toFixed(2)} m above the eye`).toBe(true);
    }
  });
});

describe('HD missiles', () => {
  it('turns a missile to nose-forward (-z), centres it and scales it to its real length', async () => {
    const { normaliseStore, storeSpecFor } = await import('../src/render/hdStores.js');
    for (const id of ['aim120c', 'aim54c', 'aim9m']) {
      const spec = storeSpecFor(id)!;
      const t = normaliseStore(await loadGlbScene(spec.url), spec.length, spec.roll);
      const box = new THREE.Box3().setFromObject(t);
      expect(box.max.z - box.min.z).toBeCloseTo(spec.length, 2);
      expect(Math.abs(box.max.z + box.min.z)).toBeLessThan(0.01);
      // the nose (-z end) is a point; the tail end carries the nozzle and fins
      let rNose = 0, rTail = 0;
      t.traverse((o) => {
        const g = (o as THREE.Mesh).geometry; if (!g) return;
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const z = p.getZ(i), r = Math.hypot(p.getX(i), p.getY(i));
          if (z < box.min.z + 0.05) rNose = Math.max(rNose, r);
          if (z > box.max.z - 0.05) rTail = Math.max(rTail, r);
        }
      });
      expect(rNose).toBeLessThan(rTail);
    }
  });
});
