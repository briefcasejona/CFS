// Leeuwarden Air Base (EHLW) as it is laid out: taxiways, aprons, the hardened aircraft shelters (HAS) in their
// dispersal groups, the hangars and the base buildings. Digitised in pixels from an aerial view Jonathan supplied
// (north up, ~2.9 m per pixel) and tied to the game frame through the two runways (OurAirports thresholds): a
// least-squares similarity fit (scale, rotation, shift) of the image onto the projected runway ends.
import type { BaseLayout } from '../theater.js';

type P = [number, number];
/** image pixel ↔ lat/lon control points: the 09 and 27 thresholds and the middle of runway 05/23 (its OurAirports
 *  ends sit ~140 m inside the paved ends seen in the image, so only its midpoint is used) */
const CONTROL: Array<[P, [number, number]]> = [
  [[260, 237], [53.2287, 5.73967]],   // 09
  [[949, 237], [53.2285, 5.76967]],   // 27
  [[575, 383], [(53.2192 + 53.2313) / 2, (5.73783 + 5.76733) / 2]],   // 05/23 midpoint
];

/** taxiways: [width m, polyline px] */
const TAXIWAYS: Array<[number, P[]]> = [
  // north: west loop, the long northern taxiway past the hangar line, on to the 23 end
  [20, [[205, 226], [205, 135], [215, 123], [262, 120], [420, 116], [560, 117], [700, 128], [850, 147], [890, 152]]],
  [20, [[262, 120], [262, 230]]],
  // west and south-west dispersal, round to the 05 end
  [18, [[262, 246], [275, 330], [300, 380], [305, 455], [292, 472], [230, 510], [190, 545], [168, 568]]],
  [18, [[226, 640], [245, 665], [262, 682], [300, 683], [450, 687], [620, 695], [780, 700], [905, 705]]],
  // east side: from the 27 end down past the east shelters to the south taxiway
  [20, [[915, 150], [935, 162], [948, 180], [948, 420], [945, 560], [932, 620], [912, 680], [905, 705]]],
  // the diagonal link across the field
  [15, [[420, 116], [470, 237], [560, 420], [685, 695]]],
  // north-east dispersal
  [16, [[850, 147], [905, 75], [945, 55], [975, 62], [985, 85]]],
  [18, [[1000, 102], [1030, 140], [1048, 175]]],
];

/** aprons and pads: polygons px */
const APRONS: P[][] = [
  [[558, 118], [735, 126], [722, 157], [560, 146]],          // north apron
  [[800, 688], [902, 692], [900, 722], [800, 718]],          // south-east pad
  [[408, 664], [482, 664], [482, 686], [408, 686]],          // south pad
  [[163, 548], [200, 548], [200, 582], [163, 582]],          // south-west pad
  [[935, 40], [990, 48], [995, 80], [940, 75]],              // north-east stands
];

/** hardened aircraft shelters px */
const SHELTERS: P[] = [
  // north-west group
  [241, 142], [281, 165], [310, 137], [347, 134], [407, 145], [390, 157], [390, 92],
  // north-east group
  [944, 30], [905, 59], [810, 120], [780, 157], [1017, 165], [1065, 167],
  // west column and south-west
  [300, 342], [307, 381], [315, 425], [267, 482], [237, 502], [200, 527],
  // south row
  [305, 662], [350, 665], [257, 694], [229, 715], [480, 662], [520, 662],
  // east column
  [929, 330], [973, 327], [966, 359], [922, 375], [973, 387], [932, 420], [969, 435], [930, 557], [972, 560], [916, 609], [960, 612],
];

/** buildings: centre px, width × depth px, height m, kind */
const BUILDINGS: Array<[number, number, number, number, number, 'hangar' | 'office' | 'shed']> = [
  // north hangar line
  [460, 88, 30, 15, 12, 'hangar'], [535, 90, 55, 18, 13, 'hangar'], [592, 90, 28, 18, 11, 'hangar'], [630, 91, 40, 15, 12, 'hangar'],
  [725, 102, 40, 28, 6, 'office'], [775, 100, 70, 14, 5, 'shed'],
  // east: squadron buildings, headquarters, maintenance hangars
  [1045, 411, 40, 22, 14, 'hangar'], [1020, 406, 18, 12, 8, 'office'], [1015, 455, 30, 10, 7, 'office'], [1020, 515, 20, 30, 8, 'office'],
  [932, 707, 25, 35, 14, 'hangar'], [965, 695, 20, 20, 9, 'office'], [958, 722, 17, 15, 7, 'office'], [1013, 745, 23, 30, 10, 'hangar'],
  [1081, 693, 28, 33, 12, 'hangar'], [942, 780, 25, 30, 10, 'hangar'], [960, 675, 15, 10, 6, 'office'],
];
const TOWER: P = [700, 112];
const FUEL: P = [1015, 470];
/** the hangars that missions treat as the base's targets (indices into BUILDINGS) */
const TARGET_HANGARS = [0, 1, 3, 6, 10, 13, 14];

/** fit X = c·U + d (complex numbers: x + i z ↔ u + i v), least squares */
export function fitSimilarity(pairs: Array<[P, P]>) {
  const n = pairs.length;
  let mu = [0, 0], mx = [0, 0];
  for (const [u, x] of pairs) { mu = [mu[0] + u[0] / n, mu[1] + u[1] / n]; mx = [mx[0] + x[0] / n, mx[1] + x[1] / n]; }
  let nr = 0, ni = 0, den = 0;
  for (const [u, x] of pairs) {
    const a = u[0] - mu[0], b = u[1] - mu[1], c = x[0] - mx[0], d = x[1] - mx[1];
    // (c + i d)(a − i b)
    nr += c * a + d * b; ni += d * a - c * b; den += a * a + b * b;
  }
  const cr = nr / den, ci = ni / den;
  const map = (p: P): P => { const a = p[0] - mu[0], b = p[1] - mu[1]; return [mx[0] + cr * a - ci * b, mx[1] + ci * a + cr * b]; };
  const rms = Math.sqrt(pairs.reduce((s, [u, x]) => { const m = map(u); return s + (m[0] - x[0]) ** 2 + (m[1] - x[1]) ** 2; }, 0) / n);
  return { map, scale: Math.hypot(cr, ci), rot: Math.atan2(ci, cr), rms };
}

/** the layout in game coordinates, given the theater's projection */
export function leeuwardenLayout(forward: (lat: number, lon: number) => { x: number; z: number }): BaseLayout {
  const fit = fitSimilarity(CONTROL.map(([px, [lat, lon]]) => { const p = forward(lat, lon); return [px, [p.x, p.z]]; }));
  const m = (p: P) => { const [x, z] = fit.map(p); return { x, z }; };
  const s = fit.scale;
  return {
    fitRms: fit.rms,
    taxiways: TAXIWAYS.map(([w, pts]) => ({ width: w, pts: pts.map(m) })),
    aprons: APRONS.map((poly) => poly.map(m)),
    shelters: SHELTERS.map(m),
    buildings: BUILDINGS.map(([u, v, w, d, h, kind]) => ({ ...m([u, v]), w: w * s, d: d * s, h, rot: fit.rot, kind })),
    tower: m(TOWER),
    fuel: m(FUEL),
    hangars: TARGET_HANGARS.map((k) => m([BUILDINGS[k][0], BUILDINGS[k][1]])),
  };
}
