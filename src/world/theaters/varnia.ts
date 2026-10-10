// The Varnia theater: a fictional 400 x 400 km peninsula (procedural terrain).
// World x = east, z = south. Federation (RED) holds the north, Coalition (BLUE) the south.
import { clamp, smoothstep } from '../../core/math.js';
import { fbm, ridged } from '../noise.js';
import type { Theater } from '../theater.js';

/** Raw terrain without airbase flattening. Negative = sea floor. */
function rawHeight(x: number, z: number): number {
  const nx = x / 1000, nz = z / 1000; // km
  const coast = -150 + fbm(nz * 0.012, 3.3, 4) * 60 + (nz > 100 ? (nz - 100) * 0.35 : 0);
  const land = smoothstep(coast - 8, coast + 12, nx);
  const eastCoast = 185 + fbm(nz * 0.015, 9.1, 3) * 15;
  const land2 = 1 - smoothstep(eastCoast - 10, eastCoast + 5, nx);
  const landMask = land * land2;
  let h = 80 + fbm(nx * 0.02, nz * 0.02, 5) * 350 + fbm(nx * 0.08, nz * 0.08, 3) * 90;
  const mtnMask = smoothstep(-40, -140, nz) * smoothstep(-80, 20, nx) + 0.6 * Math.exp(-(((nx - 90) / 40) ** 2) - ((nz - 20) / 60) ** 2);
  h += Math.max(0, ridged(nx * 0.015, nz * 0.015, 5) - 0.45) * 4200 * clamp(mtnMask, 0, 1.2);
  const riverZ = -25 + fbm(nx * 0.01, 7.7, 3) * 25;
  h -= 120 * Math.exp(-(((nz - riverZ) / 3) ** 2));
  h = Math.max(h, 15);
  return h * landMask - 60 * (1 - landMask);
}

export const VARNIA: Theater = {
  id: 'varnia',
  name: 'Varnia Peninsula',
  description: 'Fictional 400 × 400 km peninsula: Coalition (south) vs Federation (north) across the Lenva river.',
  half: 200000,
  factions: { blue: 'Coalition', red: 'Federation' },
  nations: { blue: ['coalition'], red: ['federation'] },
  rawHeight,
  carriers: [{ id: 'cvn71', name: 'USS Theodore Roosevelt (CVN-71)', side: 'blue', x: -180000, z: 140000, hdg: 0, speedKt: 15 }],
  sectors: 8,
  initialFront: [5000, 0, -5000, 0, 8000, 5000, -3000, 0],
  airbases: [
    { id: 'halvorsen', name: 'Halvorsen AB', side: 'blue', x: -60000, z: 120000, hdg: 10, length: 3200, elev: 0 },
    { id: 'kestrel', name: 'Kestrel Field', side: 'blue', x: 45000, z: 85000, hdg: 350, length: 2800, elev: 0 },
    { id: 'aldren', name: 'Port Aldren NAS', side: 'blue', x: -100000, z: 150000, hdg: 40, length: 2600, elev: 0 },
    { id: 'southreach', name: 'Southreach AB', side: 'blue', x: 115000, z: 160000, hdg: 330, length: 3200, elev: 0 },
    { id: 'volsk', name: 'Volsk AB', side: 'red', x: -50000, z: -115000, hdg: 190, length: 3200, elev: 0 },
    { id: 'marovka', name: 'Marovka AB', side: 'red', x: 55000, z: -80000, hdg: 170, length: 2800, elev: 0 },
    { id: 'krasnyy', name: 'Krasnyy Bor AB', side: 'red', x: 125000, z: -155000, hdg: 200, length: 3200, elev: 0 },
    { id: 'zarech', name: 'Zarech Highway Strip', side: 'red', x: -110000, z: -70000, hdg: 160, length: 2400, elev: 0 },
  ],
  objectives: [
    // Federation (red)
    { id: 'r_fac1', name: 'Volsk Aircraft Plant', kind: 'factory', side: 'red', x: -35000, z: -135000, value: 8 },
    { id: 'r_fac2', name: 'Marovka Refinery', kind: 'factory', side: 'red', x: 75000, z: -105000, value: 7 },
    { id: 'r_dep1', name: 'Tavrin Supply Depot', kind: 'depot', side: 'red', x: -20000, z: -45000, value: 6 },
    { id: 'r_dep2', name: 'Orsk Ammunition Depot', kind: 'depot', side: 'red', x: 70000, z: -40000, value: 6 },
    { id: 'r_brg1', name: 'Lenva River Bridge', kind: 'bridge', side: 'red', x: 10000, z: -30000, value: 5 },
    { id: 'r_cmd', name: 'Federation Northern Command', kind: 'command', side: 'red', x: 20000, z: -140000, value: 9 },
    { id: 'r_rad1', name: 'Hill 812 EW Radar', kind: 'radar', side: 'red', x: 0, z: -60000, value: 5 },
    { id: 'r_sam1', name: 'SA-10 Volsk', kind: 'sam', side: 'red', samType: 'SA-10', x: -45000, z: -100000, value: 7 },
    { id: 'r_sam2', name: 'SA-6 Tavrin', kind: 'sam', side: 'red', samType: 'SA-6', x: -25000, z: -32000, value: 5 },
    { id: 'r_sam3', name: 'SA-6 Orsk', kind: 'sam', side: 'red', samType: 'SA-6', x: 60000, z: -30000, value: 5 },
    { id: 'r_sam4', name: 'SA-2 Marovka', kind: 'sam', side: 'red', samType: 'SA-2', x: 50000, z: -95000, value: 4 },
    { id: 'r_sam5', name: 'SA-15 Lenva', kind: 'sam', side: 'red', samType: 'SA-15', x: 12000, z: -25000, value: 4 },
    { id: 'r_aaa1', name: 'AAA Volsk', kind: 'sam', side: 'red', samType: 'AAA', x: -52000, z: -112000, value: 2 },
    { id: 'r_city', name: 'Volsk', kind: 'city', side: 'red', x: -40000, z: -125000, value: 3 },
    // Coalition (blue)
    { id: 'b_fac1', name: 'Aldren Shipyards', kind: 'factory', side: 'blue', x: -95000, z: 162000, value: 7 },
    { id: 'b_fac2', name: 'Southreach Power Plant', kind: 'factory', side: 'blue', x: 95000, z: 140000, value: 7 },
    { id: 'b_dep1', name: 'Mirren Logistics Hub', kind: 'depot', side: 'blue', x: -10000, z: 45000, value: 6 },
    { id: 'b_dep2', name: 'Eastgate Depot', kind: 'depot', side: 'blue', x: 80000, z: 50000, value: 6 },
    { id: 'b_brg1', name: 'Calder Bridge', kind: 'bridge', side: 'blue', x: 20000, z: 30000, value: 5 },
    { id: 'b_cmd', name: 'Coalition Joint HQ', kind: 'command', side: 'blue', x: -20000, z: 140000, value: 9 },
    { id: 'b_rad1', name: 'Ridge Station EW Radar', kind: 'radar', side: 'blue', x: 30000, z: 60000, value: 5 },
    { id: 'b_sam1', name: 'Patriot Halvorsen', kind: 'sam', side: 'blue', samType: 'Patriot', x: -50000, z: 110000, value: 7 },
    { id: 'b_sam2', name: 'Hawk Mirren', kind: 'sam', side: 'blue', samType: 'Hawk', x: -5000, z: 35000, value: 5 },
    { id: 'b_sam3', name: 'Hawk Eastgate', kind: 'sam', side: 'blue', samType: 'Hawk', x: 75000, z: 40000, value: 5 },
    { id: 'b_city', name: 'Mirren', kind: 'city', side: 'blue', x: 0, z: 55000, value: 3 },
  ],
};
