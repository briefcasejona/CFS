// The underside of an airframe as a height field (body frame: x right, y up, z aft), and where a store hangs under
// it: on the pylon or missile rail that is really on the model at its station, at the rail's own height and fore/aft
// position, instead of at a guessed offset.
import * as THREE from 'three';

export interface Underside {
  /** lowest surface above (x, z), or +Infinity where there is none */
  at(x: number, z: number): number;
  cell: number;
}

const CELL = 0.04;

/** Rasterise the lowest surface of `meshes` (triangles taken into the frame of `frame`) into a grid. */
export function buildUnderside(meshes: THREE.Mesh[], frame: THREE.Object3D): Underside {
  frame.updateWorldMatrix(true, true);
  const inv = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const mats: THREE.Matrix4[] = [];
  for (const m of meshes) {
    const mat = inv.clone().multiply(m.matrixWorld);
    mats.push(mat);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(mat));
  }
  if (box.isEmpty()) return { at: () => Infinity, cell: CELL };
  const x0 = box.min.x - CELL, z0 = box.min.z - CELL;
  const nx = Math.ceil((box.max.x - x0) / CELL) + 2, nz = Math.ceil((box.max.z - z0) / CELL) + 2;
  const h = new Float32Array(nx * nz).fill(Infinity);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const put = (ix: number, iz: number, y: number) => { if (ix >= 0 && iz >= 0 && ix < nx && iz < nz && y < h[iz * nx + ix]) h[iz * nx + ix] = y; };
  meshes.forEach((m, mi) => {
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.index, mat = mats[mi];
    if (!pos) return;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(mat);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mat);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mat);
      for (const v of [a, b, c]) put(Math.floor((v.x - x0) / CELL), Math.floor((v.z - z0) / CELL), v.y);
      const ix0 = Math.floor((Math.min(a.x, b.x, c.x) - x0) / CELL), ix1 = Math.floor((Math.max(a.x, b.x, c.x) - x0) / CELL);
      const iz0 = Math.floor((Math.min(a.z, b.z, c.z) - z0) / CELL), iz1 = Math.floor((Math.max(a.z, b.z, c.z) - z0) / CELL);
      if (ix0 === ix1 && iz0 === iz1) continue;
      const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(den) < 1e-12) continue;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const px = x0 + (ix + 0.5) * CELL, pz = z0 + (iz + 0.5) * CELL;
        const u = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / den;
        const v = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / den;
        const w = 1 - u - v;
        if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
        put(ix, iz, u * a.y + v * b.y + w * c.y);
      }
    }
  });
  return {
    cell: CELL,
    at(x, z) {
      const ix = Math.floor((x - x0) / CELL), iz = Math.floor((z - z0) / CELL);
      return ix >= 0 && iz >= 0 && ix < nx && iz < nz ? h[iz * nx + ix] : Infinity;
    },
  };
}

export interface Hang {
  /** store centre fore/aft */
  z: number;
  /** height of the surface the store's top goes against */
  y: number;
  /** a pylon or rail of the model carries it (otherwise it is the bare skin) */
  rail: boolean;
  /** rise of that surface per metre aft (a rail's own incidence; 0 on bare skin) */
  slope: number;
}

/**
 * Where a store of length `len` hangs at station (x, z). A pylon or rail shows as a narrow ridge: lower than the skin
 * 0.3 m to either side of it (or with nothing beside it, as on a wingtip). On one, a missile sits with its tail just
 * behind the rail's aft end and its nose ahead of it, the way launchers carry them; anything else is centred under
 * the pylon. Without one the store stays at its station, clear of the lowest skin along its middle.
 */
export function hangPoint(u: Underside, x: number, z: number, len: number, missile: boolean): Hang {
  const step = u.cell, side = 0.3, reach = 2.6;
  const n = Math.round(2 * reach / step) + 1;
  const ridge: boolean[] = new Array(n), y: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const zz = z - reach + i * step;
    // the lowest of three neighbouring columns: a rail a few centimetres off the measured station still counts
    const p = Math.min(u.at(x, zz), u.at(x - step, zz), u.at(x + step, zz));
    y[i] = p;
    const l = u.at(x - side, zz), r = u.at(x + side, zz);
    ridge[i] = Number.isFinite(p) && (l === Infinity || l > p + 0.04) && (r === Infinity || r > p + 0.04) && !(l === Infinity && r === Infinity && !missile);
  }
  // ridge runs (bridging small gaps); take the one nearest the station that is long enough to be a rail
  let best: [number, number] | null = null, bestD = Infinity;
  const maxGap = Math.round(0.16 / step);
  for (let i = 0; i < n; i++) {
    if (!ridge[i]) continue;
    let j = i, gap = 0;
    for (let k = i + 1; k < n && gap <= maxGap; k++) {
      // (a step in height ends it: that is something else behind or ahead of the rail)
      if (ridge[k] && Math.abs(y[k] - y[j]) > 0.035 + 0.02 * (k - j)) break;
      if (ridge[k]) { j = k; gap = 0; } else gap++;
    }
    const zA = z - reach + i * step, zB = z - reach + j * step;
    if (zB - zA >= 0.6) {
      const d = z < zA ? zA - z : z > zB ? z - zB : 0;
      if (d < bestD) { bestD = d; best = [i, j]; }
    }
    i = j;
  }
  if (best && bestD <= 0.8) {
    const [i, j] = best;
    const zA = z - reach + i * step, zB = z - reach + j * step, mid = (zA + zB) / 2;
    let zc = mid;
    if (missile && zB - zA < len) zc = Math.min(mid, zB + 0.1 * len - len / 2);
    // the rail's underside as a line (rails often sit a few degrees nose-down), kept below nearly all of it
    let sz = 0, sy = 0, szz = 0, szy = 0, m = 0;
    for (let k = i; k <= j; k++) if (ridge[k]) { const zz = z - reach + k * step; sz += zz; sy += y[k]; szz += zz * zz; szy += zz * y[k]; m++; }
    const den = m * szz - sz * sz;
    let slope = Math.abs(den) > 1e-9 ? (m * szy - sz * sy) / den : 0;
    if (Math.abs(slope) > 0.12) slope = 0;
    const res: number[] = [];
    for (let k = i; k <= j; k++) if (ridge[k]) res.push(y[k] - slope * (z - reach + k * step - zc));
    res.sort((p, q) => p - q);
    return { z: zc, y: res[Math.floor(res.length * 0.08)], rail: true, slope };
  }
  let low = Infinity;
  for (let i = 0; i < n; i++) { const zz = z - reach + i * step; if (Math.abs(zz - z) <= 0.3 * len && y[i] < low) low = y[i]; }
  return { z, y: low, rail: false, slope: 0 };
}
