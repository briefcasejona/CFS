// Weapon stations: where each store of a loadout hangs on the airframe (body frame, metres: x right, y up, z aft).
// Slots follow the real layout of each type — wing pylons spread over the semi-span, wingtip rails where the jet has
// them, centreline and fuselage stations — and stores are assigned the way real loadouts are: tanks inboard / on the
// centreline, bombs and air-to-ground missiles inboard to mid-wing, radar missiles on fuselage stations, heat-seekers
// outboard and on the tips. The renderer snaps each store up against the model's underside.
import * as THREE from 'three';
import type { AircraftDef } from './types.js';
import { WEAPONS } from '../weapons/stores.js';

type SlotKind = 'tip' | 'wing' | 'fuse' | 'center';
interface Slot { pos: THREE.Vector3; kind: SlotKind; rank: number }   // rank: 0 = innermost

/** wingtip missile rails */
const TIP_RAILS = /F-16|F\/A-18|JAS 39|Rafale|Su-27|Su-30|Su-57|F-5|T-38/;
/** fuselage missile stations (semi-recessed AIM-7/AIM-120 or tunnel stations) */
const FUSE_AAM = /F-15|F\/A-18|F-14|F-4|Su-27|Su-30|Typhoon|EF-2000|Su-57/;

function fuselageRadius(def: AircraftDef) {
  return Math.max(0.55, def.length * 0.042) * (def.model.engines === 2 ? 1.15 : 1);
}

/**
 * Stations measured on the HD models (right side, metres in the game frame: x out along the wing, z aft): the pylon or
 * missile rail centre each store hangs from. Listed per kind from the inside out; the left side mirrors them. Types
 * without an entry keep the generic layout below.
 */
type Measured = Array<[x: number, z: number, kind: SlotKind]>;
const MEASURED: Array<{ match: (def: AircraftDef) => boolean; slots: Measured }> = [
  // F-16: station 4 wet pylon, LAU-129 rails on stations 3 and 2, wingtip rail
  { match: (d) => (d.family ?? d.name) === 'F-16', slots: [[2.1, 1.2, 'wing'], [3.03, 1.57, 'wing'], [3.97, 2.18, 'wing'], [4.59, 2.39, 'tip']] },
  // F/A-18E/F: inboard, mid and outboard wing pylons, wingtip rail; the nacelle stations stay generic
  { match: (d) => d.id === 'fa18e', slots: [[3.48, 0.97, 'wing'], [4.33, 2.08, 'wing'], [5.08, 3.1, 'wing'], [6.46, 2.66, 'tip']] },
  // F-15E: wing pylon with its two shoulder rails, forward fuselage station and the three conformal-tank stubs
  { match: (d) => d.id === 'f15e', slots: [[2.93, 2.17, 'wing'], [2.67, 0.82, 'tip'], [3.19, 0.82, 'tip'], [1.19, -1.2, 'fuse'], [2.03, -0.15, 'fuse'], [2.03, 2.33, 'fuse'], [2.03, 4.93, 'fuse']] },
  // MiG-29: three pylons under each wing
  { match: (d) => d.id === 'mig29a', slots: [[2.36, 2.0, 'wing'], [3.1, 2.67, 'wing'], [3.76, 3.05, 'wing']] },
  // F-4E: inboard pylon with LAU-7 shoulder rails, outboard pylon (the tank station, so listed with the centreline)
  { match: (d) => d.id === 'f4e', slots: [[2.1, -0.4, 'wing'], [3.4, 2.02, 'center'], [1.85, -0.6, 'tip'], [2.34, -0.6, 'tip']] },
  // Gripen: inboard and mid wing pylons, wingtip rail, the station under each intake
  { match: (d) => d.id === 'jas39', slots: [[1.86, 1.8, 'wing'], [2.74, 2.6, 'wing'], [3.85, 3.44, 'tip'], [0.77, -0.8, 'fuse']] },
];

function slotsFor(def: AircraftDef): Slot[] {
  const fam = def.family ?? def.name;
  const R = fuselageRadius(def), L = def.length, half = def.span / 2;
  const slots: Slot[] = [];
  const pair = (x: number, y: number, z: number, kind: SlotKind, rank: number) => {
    slots.push({ pos: new THREE.Vector3(-x, y, z), kind, rank }, { pos: new THREE.Vector3(x, y, z), kind, rank });
  };
  slots.push({ pos: new THREE.Vector3(0, -R - 0.35, -L * 0.02), kind: 'center', rank: 0 });
  const measured = MEASURED.find((m) => m.match(def));
  if (measured) {
    const rank: Partial<Record<SlotKind, number>> = {};
    const y: Record<SlotKind, number> = { wing: -R * 0.15 - 0.45, tip: -R * 0.15 - 0.05, fuse: -R * 0.75, center: -R - 0.35 };
    for (const [x, z, kind] of measured.slots) { pair(x, y[kind], z, kind, rank[kind] ?? 0); rank[kind] = (rank[kind] ?? 0) + 1; }
    if (FUSE_AAM.test(fam) && !measured.slots.some((s) => s[2] === 'fuse')) {
      pair(R * 0.75, -R * 0.75, -L * 0.1, 'fuse', 0);
      pair(R * 0.75, -R * 0.75, L * 0.12, 'fuse', 1);
    }
    return slots;
  }
  if (def.fcs.swingWing) {
    // F-14: four tunnel stations between the nacelles and a pylon under each glove — nothing on the moving wing
    pair(R * 0.55, -R - 0.15, -L * 0.12, 'fuse', 0);
    pair(R * 0.55, -R - 0.15, L * 0.1, 'fuse', 1);
    pair(R * 1.9, -R * 0.7, -L * 0.03, 'wing', 0);
    pair(R * 1.9, -R * 0.35, -L * 0.03, 'tip', 0);    // glove shoulder rail (Sidewinders)
    pair(R * 1.25, -R - 0.25, L * 0.02, 'center', 1);  // external tanks under the intake nacelles
    return slots;
  }
  if (FUSE_AAM.test(fam)) {
    pair(R * 0.75, -R * 0.75, -L * 0.1, 'fuse', 0);
    pair(R * 0.75, -R * 0.75, L * 0.12, 'fuse', 1);
  }
  // wing pylons: wing root sits ~0.9 R out; sweep moves the pylons aft with span
  const sweep = (def.model.sweep ?? 30) * Math.PI / 180;
  const wingZ = def.model.wing === 'delta' || def.model.wing === 'cdelta' ? L * 0.08 : -L * 0.02;
  const fr = [0.32, 0.5, 0.68, 0.84];
  fr.forEach((f, i) => {
    const x = half * f;
    if (x < R * 1.35) return;
    pair(x, -R * 0.15 - 0.45, wingZ + Math.tan(sweep) * (x - R) * 0.6, 'wing', i);
  });
  if (TIP_RAILS.test(fam)) pair(half - 0.05, -R * 0.15 - 0.05, wingZ + Math.tan(sweep) * (half - R) * 0.75, 'tip', 0);
  return slots;
}

type StoreClass = 'tank' | 'heavy' | 'ir' | 'radar' | 'other';
function storeClass(id: string): StoreClass {
  const w = WEAPONS[id];
  if (!w) return 'other';
  if (w.kind === 'tank') return 'tank';
  if (w.kind === 'ir') return 'ir';
  if (w.kind === 'sarh' || w.kind === 'arh') return 'radar';
  return 'heavy';
}

/** slot preference per store class (first = most preferred); wing slots go innermost-first unless noted */
const PREFS: Record<StoreClass, Array<{ kind: SlotKind; outerFirst?: boolean }>> = {
  tank: [{ kind: 'center' }, { kind: 'wing' }],
  heavy: [{ kind: 'wing' }, { kind: 'center' }, { kind: 'fuse' }],
  radar: [{ kind: 'fuse' }, { kind: 'wing', outerFirst: true }, { kind: 'tip' }],
  ir: [{ kind: 'tip' }, { kind: 'wing', outerFirst: true }, { kind: 'fuse' }],
  other: [{ kind: 'wing' }, { kind: 'center' }, { kind: 'fuse' }, { kind: 'tip' }],
};
const CLASS_ORDER: StoreClass[] = ['tank', 'heavy', 'radar', 'ir', 'other'];

/**
 * Station position for every entry of a loadout (same order as the stores array). Symmetric pairs of the same store
 * go left/right of one slot pair; when slots run out, the old generic spread is used.
 */
export function stationLayout(def: AircraftDef, stores: string[]): THREE.Vector3[] {
  const slots = slotsFor(def);
  const used = new Set<Slot>();
  const held = new Map<Slot, { id: string; n: number }>();
  const out: THREE.Vector3[] = new Array(stores.length);
  const mirrorOf = (k: Slot) => slots.find((o) => o !== k && Math.abs(o.pos.x + k.pos.x) < 1e-6 && Math.abs(o.pos.z - k.pos.z) < 1e-6 && Math.abs(o.pos.y - k.pos.y) < 1e-6 && o.kind === k.kind);
  // by store type — tanks and heavy stores first so they get the inboard stations, then the missiles; an even count
  // fills mirrored slot pairs, an odd one-off takes a centreline slot
  const ids = [...new Set(stores.filter(Boolean))].sort((a, b) => CLASS_ORDER.indexOf(storeClass(a)) - CLASS_ORDER.indexOf(storeClass(b)));
  for (const id of ids) {
    const idx = stores.map((s, i) => (s === id ? i : -1)).filter((i) => i >= 0);
    const prefs = PREFS[storeClass(id)];
    const take = (pairWanted: boolean): Slot[] | null => {
      for (const pref of prefs) {
        const cands = slots.filter((k) => k.kind === pref.kind && !used.has(k))
          .sort((a, b) => (pref.outerFirst ? b.rank - a.rank : a.rank - b.rank) || a.pos.x - b.pos.x);
        for (const k of cands) {
          if (!pairWanted) { if (Math.abs(k.pos.x) < 1e-6) return [k]; continue; }
          const m = mirrorOf(k);
          if (m && !used.has(m) && k.pos.x < 0) return [k, m];
        }
      }
      return null;
    };
    const rackFor = () => slots.find((k) => k.pos.x < 0 && k.kind === 'wing' && held.get(k)?.id === id && held.get(k)!.n < 3);
    const canRack = () => storeClass(id) === 'heavy' && idx.length >= 2 && !!rackFor();
    while (idx.length) {
      const got = idx.length % 2 === 1 ? take(false) ?? take(true) : take(true) ?? (canRack() ? null : take(false));
      if (got) {
        for (const k of got) { const i = idx.shift(); if (i === undefined) break; used.add(k); out[i] = k.pos.clone(); held.set(k, { id, n: 1 }); }
        continue;
      }
      // out of pylons: bombs double up on a triple ejector rack — the next two ride the rack's shoulders
      if (storeClass(id) !== 'heavy' || idx.length < 2) break;
      const rack = rackFor();
      const twin = rack && mirrorOf(rack);
      if (!rack || !twin || held.get(twin)?.id !== id) break;
      const side = held.get(rack)!.n === 1 ? -1 : 1;   // first shoulder outboard, then inboard
      for (const k of [rack, twin]) {
        const i = idx.shift()!;
        out[i] = k.pos.clone().add(new THREE.Vector3(Math.sign(k.pos.x) * side * -0.3, 0.12, 0));
        held.get(k)!.n++;
      }
    }
  }
  // fallback: the previous generic spread
  const n = Math.max(stores.length, 1);
  for (let i = 0; i < stores.length; i++) if (!out[i]) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = Math.floor(i / 2) / Math.max(1, Math.ceil(n / 2));
    out[i] = new THREE.Vector3(side * (0.6 + along * def.span * 0.38), -0.8, 0.5);
  }
  return out;
}
