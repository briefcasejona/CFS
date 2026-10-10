import type { AeroDef, AircraftDef, Capability, DeepPartial, EngineDef, GearDef, VariantDef } from './types.js';
import { WEAPONS } from '../weapons/stores.js';

// Approximate public-domain figures (Wikipedia, NATOPS/-1 excerpts, manufacturer data).
// Aerodynamic derivatives are generic fighter values tuned so the performance envelope
// (stall speed, top speed, sustained turn, climb) lands near published numbers.

const TSFC_MIL = 2.2e-5; // kg/(N s)  ~0.78 lb/lbf/h
const TSFC_AB = 5.6e-5;  // kg/(N s)  ~1.98 lb/lbf/h

function aero(o: Partial<AeroDef> & Pick<AeroDef, 'CLa' | 'CLmax' | 'CD0' | 'k'>): AeroDef {
  return {
    CL0: 0.04, Mcrit: 0.88, waveDrag: 2.3,
    Cma: -0.25, Cmq: -6, Cmde: 0.9,
    Clb: -0.08, Clp: -0.35, Clda: 0.12, Clr: 0.05,
    Cnb: 0.14, Cnr: -0.25, Cndr: 0.09,
    CYb: -0.8,
    flapCL: 0.35, flapCD: 0.03, brakeCD: 0.05, gearCD: 0.025,
    ...o,
  };
}

function eng(name: string, count: number, milKN: number, abKN: number, inletMach: number, o: Partial<EngineDef> = {}): EngineDef {
  return {
    name, count, milThrust: milKN * 1000, abThrust: abKN * 1000,
    tsfcMil: TSFC_MIL, tsfcAB: abKN > milKN ? TSFC_AB : TSFC_MIL,
    spoolTime: 4.5, inletMach, ...o,
  };
}

function gear(length: number, track: number, height: number, hook = false): GearDef {
  return { nose: 0.3 * length, main: 0.045 * length, track, height, hook };
}

const BASE: AircraftDef[] = [
  // ------------------------------------------------------------------ USA
  {
    id: 'f15c', name: 'F-15C', fullName: 'McDonnell Douglas F-15C Eagle', role: 'Air superiority', country: 'USA', side: 'blue',
    description: 'Twin-engine air superiority fighter. Big radar, big wing, huge thrust. Mechanical controls with CAS — it will let you over-G.',
    massEmpty: 12700, massMax: 30845, fuelInternal: 6100, pylonFuel: 1830,
    wingArea: 56.5, span: 13.05, chord: 4.86, length: 19.43, inertia: [38000, 196000, 225000],
    aero: aero({ CLa: 3.6, CLmax: 1.5, CD0: 0.021, k: 0.12, Mcrit: 0.88, waveDrag: 1.9 }),
    engine: eng('2× F100-PW-220', 2, 65, 106, 2.4),
    limits: { gMax: 9, gMin: -3, aoaMax: 30, rollRate: 220, maxMach: 2.5, vmaxKcas: 800 },
    fcs: { type: 'cas' }, controls: { elev: 25, ail: 20, rud: 30 },
    gear: gear(19.43, 2.75, 1.9), radar: { name: 'AN/APG-63(V)1', range: 120000, azLimit: 60, tws: true },
    rcs: 10, gun: { name: 'M61A1 20mm', rounds: 940, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 11,
    loadouts: [
      { name: 'CAP: 4× AIM-120C, 4× AIM-9M, tank', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9m', 'aim9m', 'aim9m', 'aim9m', 'tank'] },
      { name: 'Legacy: 4× AIM-7M, 4× AIM-9M', stores: ['aim7m', 'aim7m', 'aim7m', 'aim7m', 'aim9m', 'aim9m', 'aim9m', 'aim9m'] },
      { name: 'Sweep: 6× AIM-120C, 2× AIM-9X', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 120, flares: 60, approachKts: 140, rotateKts: 135,
    model: { wing: 'trapezoid', twinTail: true, tailCant: 2, engines: 2, intake: 'side', tailplane: true, color: 0x8a9399, sweep: 45 },
  },
  {
    id: 'f16c', name: 'F-16C', fullName: 'General Dynamics F-16C Fighting Falcon (Block 50)', role: 'Multirole', country: 'USA', side: 'blue',
    description: 'The Viper. Relaxed stability, fly-by-wire with 9 G / 25° AoA limiter, side-stick. Superb dogfighter and SEAD platform.',
    massEmpty: 8570, massMax: 19200, fuelInternal: 3200, pylonFuel: 1100,
    wingArea: 27.87, span: 9.96, chord: 3.45, length: 15.06, inertia: [12875, 75674, 85552],
    aero: aero({ CLa: 3.9, CLmax: 1.55, CD0: 0.0175, k: 0.12, Cma: -0.12, Mcrit: 0.88, waveDrag: 2.4 }),
    engine: eng('F110-GE-129', 1, 76.3, 131, 2.0),
    limits: { gMax: 9, gMin: -3, aoaMax: 25, rollRate: 300, maxMach: 2.05, vmaxKcas: 800 },
    fcs: { type: 'fbw' }, controls: { elev: 25, ail: 21, rud: 30 },
    gear: gear(15.06, 2.36, 1.65), radar: { name: 'AN/APG-68(V)9', range: 80000, azLimit: 60, tws: true },
    rcs: 1.2, gun: { name: 'M61A1 20mm', rounds: 511, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 9,
    loadouts: [
      { name: 'CAP: 4× AIM-120C, 2× AIM-9X, 2 tanks', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank', 'tank'] },
      { name: 'Strike: 4× Mk-82, 2× AIM-120C, 2× AIM-9X', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
      { name: 'Precision: 2× GBU-12, 2× AIM-120C, 2× AIM-9X, 2 tanks', stores: ['gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank', 'tank'] },
      { name: 'SEAD: 2× AGM-88, 2× AIM-120C, 2× AIM-9X, 2 tanks', stores: ['agm88', 'agm88', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank', 'tank'] },
      { name: 'CAS: 4× AGM-65D, 2× AIM-9X', stores: ['agm65d', 'agm65d', 'agm65d', 'agm65d', 'aim9x', 'aim9x'] },
      { name: 'BFM: 2× AIM-9X', stores: ['aim9x', 'aim9x'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 60, flares: 30, approachKts: 140, rotateKts: 150,
    model: { wing: 'trapezoid', engines: 1, intake: 'chin', tailplane: true, color: 0x8b949a, sweep: 40 },
  },
  {
    id: 'fa18c', name: 'F/A-18C', fullName: 'McDonnell Douglas F/A-18C Hornet (Lot 20)', role: 'Carrier multirole', country: 'USA', side: 'blue',
    description: 'Carrier strike fighter. Excellent high-AoA handling thanks to its LEX — nose authority at slow speed is its trump card.',
    massEmpty: 10400, massMax: 23400, fuelInternal: 4900, pylonFuel: 1000,
    wingArea: 37.16, span: 12.31, chord: 3.51, length: 17.07, inertia: [31184, 165700, 189500],
    aero: aero({ CLa: 4.0, CLmax: 1.9, CD0: 0.022, k: 0.13, Cma: -0.18, Mcrit: 0.85, waveDrag: 2.6, flapCL: 0.4 }),
    engine: eng('2× F404-GE-402', 2, 48.9, 79.2, 1.75),
    limits: { gMax: 7.5, gMin: -3, aoaMax: 35, rollRate: 220, maxMach: 1.8, vmaxKcas: 750 },
    fcs: { type: 'fbw' }, controls: { elev: 24, ail: 25, rud: 30 },
    gear: gear(17.07, 3.11, 1.8, true), radar: { name: 'AN/APG-73', range: 90000, azLimit: 70, tws: true },
    rcs: 1.5, gun: { name: 'M61A1 20mm', rounds: 578, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 9,
    loadouts: [
      { name: 'CAP: 4× AIM-120C, 2× AIM-9X, tank', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank'] },
      { name: 'Strike: 4× Mk-82, 2× AIM-120C, 2× AIM-9M, tank', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'aim120c', 'aim120c', 'aim9m', 'aim9m', 'tank'] },
      { name: 'SEAD: 2× AGM-88, 2× AIM-120C, 2× AIM-9M', stores: ['agm88', 'agm88', 'aim120c', 'aim120c', 'aim9m', 'aim9m'] },
      { name: 'Precision: 4× GBU-12, 2× AIM-9X, tank', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim9x', 'aim9x', 'tank'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 60, flares: 60, approachKts: 135, rotateKts: 145,
    model: { wing: 'trapezoid', twinTail: true, tailCant: 20, engines: 2, intake: 'under', tailplane: true, color: 0x8f989e, sweep: 26 },
  },
  {
    id: 'f14b', name: 'F-14B(U)', fullName: 'Grumman F-14B Tomcat (Upgrade)', role: 'Fleet defense interceptor', country: 'USA', side: 'blue',
    description: 'Variable-geometry fleet interceptor with the long-range AIM-54C Phoenix. Wing sweep is automatic with Mach. Watch out at high AoA — it bites with rudder misuse.',
    massEmpty: 19800, massMax: 33720, fuelInternal: 7348, pylonFuel: 860,
    wingArea: 52.5, span: 19.55, chord: 3.3, length: 19.1, inertia: [65000, 330000, 380000],
    aero: aero({ CLa: 3.9, CLmax: 1.75, CD0: 0.021, k: 0.075, Mcrit: 0.8, waveDrag: 2.6, Cnb: 0.11 }),
    engine: eng('2× F110-GE-400', 2, 61.4, 124.7, 2.3),
    limits: { gMax: 7.5, gMin: -3, aoaMax: 30, rollRate: 180, maxMach: 2.34, vmaxKcas: 800 },
    fcs: { type: 'cas', swingWing: true }, controls: { elev: 25, ail: 20, rud: 30 },
    gear: gear(19.1, 5.0, 2.1, true), radar: { name: 'AN/AWG-9 (upgraded)', range: 160000, azLimit: 65, tws: true },
    rcs: 12, gun: { name: 'M61A1 20mm', rounds: 675, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 10,
    loadouts: [
      { name: 'Fleet defense: 4× AIM-54C, 2× AIM-7M, 2× AIM-9M, 2 tanks', stores: ['aim54c', 'aim54c', 'aim54c', 'aim54c', 'aim7m', 'aim7m', 'aim9m', 'aim9m', 'tank', 'tank'] },
      { name: 'Fighter: 2× AIM-54C, 2× AIM-7M, 2× AIM-9M', stores: ['aim54c', 'aim54c', 'aim7m', 'aim7m', 'aim9m', 'aim9m'] },
      { name: 'Bombcat: 4× GBU-12, 2× AIM-7M, 2× AIM-9M', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim7m', 'aim7m', 'aim9m', 'aim9m'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 60, flares: 60, approachKts: 135, rotateKts: 140,
    model: { wing: 'swing', twinTail: true, tailCant: 5, engines: 2, intake: 'side', tailplane: true, color: 0x9aa3a8, sweep: 20 },
  },
  {
    id: 'f4e', name: 'F-4E', fullName: 'McDonnell Douglas F-4E Phantom II', role: 'Fighter-bomber', country: 'USA', side: 'blue',
    description: 'Cold-war workhorse. No fly-by-wire: heavy, fast, unforgiving. Use rudder, not ailerons, to roll at high AoA or it will depart.',
    massEmpty: 13757, massMax: 28030, fuelInternal: 5900, pylonFuel: 1100,
    wingArea: 49.2, span: 11.7, chord: 4.89, length: 19.2, inertia: [34000, 160000, 185000],
    aero: aero({ CLa: 3.4, CLmax: 1.4, CD0: 0.024, k: 0.14, Mcrit: 0.85, waveDrag: 2.0, Cma: -0.3, Clda: 0.07, Cnb: 0.11, Clb: -0.1 }),
    engine: eng('2× J79-GE-17', 2, 52.8, 79.6, 2.2, { tsfcMil: 2.4e-5, spoolTime: 6 }),
    limits: { gMax: 7.33, gMin: -3, aoaMax: 28, rollRate: 150, maxMach: 2.2, vmaxKcas: 750 },
    fcs: { type: 'manual' }, controls: { elev: 21, ail: 18, rud: 30 },
    gear: gear(19.2, 5.4, 1.9, true), radar: { name: 'AN/APQ-120', range: 55000, azLimit: 60, tws: false },
    rcs: 15, gun: { name: 'M61A1 20mm', rounds: 640, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 9,
    loadouts: [
      { name: 'CAP: 4× AIM-7M, 4× AIM-9M, tank', stores: ['aim7m', 'aim7m', 'aim7m', 'aim7m', 'aim9m', 'aim9m', 'aim9m', 'aim9m', 'tank'] },
      { name: 'Strike: 6× Mk-82, 2× AIM-7M, 2 tanks', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'mk82', 'mk82', 'aim7m', 'aim7m', 'tank', 'tank'] },
      { name: 'Heavy: 2× Mk-84, 4× AIM-7M', stores: ['mk84', 'mk84', 'aim7m', 'aim7m', 'aim7m', 'aim7m'] },
      { name: 'CAS: 4× AGM-65D, 4× AIM-9M', stores: ['agm65d', 'agm65d', 'agm65d', 'agm65d', 'aim9m', 'aim9m', 'aim9m', 'aim9m'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 60, flares: 30, approachKts: 150, rotateKts: 165,
    model: { wing: 'swept', engines: 2, intake: 'side', tailplane: true, color: 0x7d8466, sweep: 45 },
  },
  {
    id: 't38c', name: 'T-38C', fullName: 'Northrop T-38C Talon', role: 'Advanced jet trainer', country: 'USA', side: 'blue',
    description: 'Supersonic trainer. No radar, no gun — a pure stick-and-rudder airplane with a huge roll rate. Practice bombs only.',
    massEmpty: 3270, massMax: 5670, fuelInternal: 1780, pylonFuel: 0,
    wingArea: 15.8, span: 7.7, chord: 2.36, length: 14.1, inertia: [2200, 30000, 31000],
    aero: aero({ CLa: 3.6, CLmax: 1.2, CD0: 0.016, k: 0.12, Mcrit: 0.9, waveDrag: 2.0, Clda: 0.1, Clp: -0.3 }),
    engine: eng('2× J85-GE-5', 2, 12.0, 17.1, 1.35, { spoolTime: 3.5 }),
    limits: { gMax: 7.33, gMin: -3, aoaMax: 25, rollRate: 720, maxMach: 1.3, vmaxKcas: 710 },
    fcs: { type: 'cas' }, controls: { elev: 20, ail: 20, rud: 25 },
    gear: gear(14.1, 3.3, 1.2), radar: null,
    rcs: 2, gun: null, stations: 1,
    loadouts: [
      { name: 'Clean (trainer)', stores: [] },
      { name: 'SUU-20: 6× BDU-33 practice', stores: ['bdu33', 'bdu33', 'bdu33', 'bdu33', 'bdu33', 'bdu33'] },
    ],
    chaff: 0, flares: 0, approachKts: 155, rotateKts: 155,
    model: { wing: 'trapezoid', engines: 2, intake: 'side', tailplane: true, color: 0x2c3540, sweep: 32 },
  },
  {
    id: 'fa18e', name: 'F/A-18E/F', fullName: 'Boeing F/A-18E/F Super Hornet (Block II)', role: 'Carrier multirole', country: 'USA', side: 'blue',
    description: 'Bigger, heavier Hornet with AESA radar and more stations. Draggier but carries a lot; exceptional at high AoA.',
    massEmpty: 14550, massMax: 29937, fuelInternal: 6780, pylonFuel: 1450,
    wingArea: 46.45, span: 13.62, chord: 3.95, length: 18.31, inertia: [45000, 240000, 270000],
    aero: aero({ CLa: 4.1, CLmax: 2.0, CD0: 0.024, k: 0.12, Cma: -0.18, Mcrit: 0.84, waveDrag: 2.7, flapCL: 0.4 }),
    engine: eng('2× F414-GE-400', 2, 62.3, 98, 1.65),
    limits: { gMax: 7.6, gMin: -3, aoaMax: 40, rollRate: 200, maxMach: 1.8, vmaxKcas: 750 },
    fcs: { type: 'fbw' }, controls: { elev: 24, ail: 25, rud: 30 },
    gear: gear(18.31, 3.11, 1.85, true), radar: { name: 'AN/APG-79 AESA', range: 150000, azLimit: 70, tws: true },
    rcs: 1.0, gun: { name: 'M61A2 20mm', rounds: 412, rpm: 6000, muzzleVel: 1030, damage: 9 },
    stations: 11,
    loadouts: [
      { name: 'CAP: 6× AIM-120C, 2× AIM-9X, tank', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank'] },
      { name: 'Strike: 4× GBU-12, 2× AIM-120C, 2× AIM-9X, tank', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank'] },
      { name: 'SEAD: 4× AGM-88, 2× AIM-120C, 2× AIM-9X', stores: ['agm88', 'agm88', 'agm88', 'agm88', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 60, flares: 60, approachKts: 140, rotateKts: 150,
    model: { wing: 'trapezoid', twinTail: true, tailCant: 20, engines: 2, intake: 'under', tailplane: true, color: 0x8f989e, sweep: 29 },
  },
  {
    id: 'av8b', name: 'Harrier II', fullName: 'Hawker / BAe / McDonnell Douglas AV-8B Harrier II', role: 'V/STOL attack', country: 'USA/UK', side: 'blue',
    description: 'Vectored-thrust V/STOL jet descended from the Hawker Harrier. Nozzles rotate 0–98°; below ~120 kt you fly on thrust and reaction controls. Subsonic.',
    massEmpty: 6340, massMax: 14100, fuelInternal: 3500, pylonFuel: 900,
    wingArea: 22.6, span: 9.25, chord: 2.7, length: 14.12, inertia: [9000, 35000, 42000],
    aero: aero({ CLa: 4.2, CLmax: 1.6, CD0: 0.028, k: 0.11, Mcrit: 0.83, waveDrag: 3.0, Cma: -0.3 }),
    engine: eng('Rolls-Royce Pegasus 105', 1, 105.9, 105.9, 0.98, { tsfcMil: 2.15e-5, spoolTime: 3 }),
    limits: { gMax: 8, gMin: -3, aoaMax: 25, rollRate: 200, maxMach: 0.98, vmaxKcas: 585 },
    fcs: { type: 'cas', vtol: true }, controls: { elev: 20, ail: 18, rud: 25 },
    gear: { nose: 4.2, main: 0.4, track: 5.2, height: 1.6 }, radar: { name: 'AN/APG-65', range: 70000, azLimit: 60, tws: true },
    rcs: 3, gun: { name: 'GAU-12 25mm', rounds: 300, rpm: 3600, muzzleVel: 1040, damage: 12 },
    stations: 7,
    loadouts: [
      { name: 'CAS: 4× Mk-82, 2× AIM-9M', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'aim9m', 'aim9m'] },
      { name: 'Precision: 2× GBU-12, 2× AGM-65D, 2× AIM-9M', stores: ['gbu12', 'gbu12', 'agm65d', 'agm65d', 'aim9m', 'aim9m'] },
      { name: 'Air defense: 2× AIM-120C, 2× AIM-9M', stores: ['aim120c', 'aim120c', 'aim9m', 'aim9m'] },
      { name: 'Clean (VTOL practice)', stores: [] },
    ],
    chaff: 60, flares: 60, approachKts: 120, rotateKts: 120,
    model: { wing: 'shoulder', engines: 1, intake: 'shoulder', tailplane: true, color: 0x6d7563, sweep: 34 },
  },
  // ------------------------------------------------------------------ Russia
  {
    id: 'mig29a', name: 'MiG-29A', fullName: 'Mikoyan MiG-29A (9.12) Fulcrum', role: 'Light air superiority', country: 'Russia', side: 'red',
    description: 'Agile twin-engine fighter with helmet-cued R-73 and IRST. Short-legged, but brutal within visual range.',
    massEmpty: 11000, massMax: 18000, fuelInternal: 3500, pylonFuel: 1200,
    wingArea: 38, span: 11.36, chord: 3.9, length: 17.32, inertia: [14000, 113000, 125000],
    aero: aero({ CLa: 3.7, CLmax: 1.7, CD0: 0.021, k: 0.13, Mcrit: 0.88, waveDrag: 2.3 }),
    engine: eng('2× RD-33', 2, 49.4, 81.4, 2.25),
    limits: { gMax: 9, gMin: -3, aoaMax: 26, rollRate: 240, maxMach: 2.25, vmaxKcas: 810 },
    fcs: { type: 'cas' }, controls: { elev: 25, ail: 20, rud: 30 },
    gear: gear(17.32, 3.1, 1.75), radar: { name: 'N019 Rubin', range: 70000, azLimit: 60, tws: false, irst: 15000 },
    rcs: 5, gun: { name: 'GSh-30-1 30mm', rounds: 150, rpm: 1800, muzzleVel: 860, damage: 25 },
    stations: 7,
    loadouts: [
      { name: 'CAP: 2× R-27R, 4× R-73, tank', stores: ['r27r', 'r27r', 'r73', 'r73', 'r73', 'r73', 'tank'] },
      { name: 'Strike: 4× FAB-500, 2× R-73', stores: ['fab500', 'fab500', 'fab500', 'fab500', 'r73', 'r73'] },
      { name: 'Dogfight: 6× R-73', stores: ['r73', 'r73', 'r73', 'r73', 'r73', 'r73'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 30, flares: 30, approachKts: 140, rotateKts: 135,
    model: { wing: 'trapezoid', twinTail: true, tailCant: 6, engines: 2, intake: 'under', tailplane: true, color: 0x8ea0a8, sweep: 42 },
  },
  {
    id: 'su27', name: 'Su-27S', fullName: 'Sukhoi Su-27S Flanker-B', role: 'Air superiority', country: 'Russia', side: 'red',
    description: 'Long-range heavy fighter with enormous internal fuel and 10 hardpoints. Analog FBW in pitch with AoA limiter.',
    massEmpty: 16380, massMax: 30450, fuelInternal: 9400, pylonFuel: 0,
    wingArea: 62, span: 14.7, chord: 4.0, length: 21.9, inertia: [38000, 215000, 250000],
    aero: aero({ CLa: 3.8, CLmax: 1.75, CD0: 0.0215, k: 0.11, Cma: -0.15, Mcrit: 0.88, waveDrag: 2.2 }),
    engine: eng('2× AL-31F', 2, 74.5, 122.6, 2.3),
    limits: { gMax: 9, gMin: -3, aoaMax: 30, rollRate: 270, maxMach: 2.35, vmaxKcas: 755 },
    fcs: { type: 'fbw' }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(21.9, 4.34, 2.0), radar: { name: 'N001 Myech', range: 100000, azLimit: 60, tws: false, irst: 40000 },
    rcs: 12, gun: { name: 'GSh-30-1 30mm', rounds: 150, rpm: 1800, muzzleVel: 860, damage: 25 },
    stations: 10,
    loadouts: [
      { name: 'CAP: 4× R-27ER, 2× R-27R, 4× R-73', stores: ['r27er', 'r27er', 'r27er', 'r27er', 'r27r', 'r27r', 'r73', 'r73', 'r73', 'r73'] },
      { name: 'Light: 2× R-27ER, 4× R-73', stores: ['r27er', 'r27er', 'r73', 'r73', 'r73', 'r73'] },
      { name: 'Strike: 6× FAB-500, 2× R-73', stores: ['fab500', 'fab500', 'fab500', 'fab500', 'fab500', 'fab500', 'r73', 'r73'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 48, flares: 48, approachKts: 140, rotateKts: 145,
    model: { wing: 'trapezoid', twinTail: true, tailCant: 0, engines: 2, intake: 'under', tailplane: true, color: 0x9bb0bd, sweep: 42 },
  },
  {
    id: 'su30', name: 'Su-30SM', fullName: 'Sukhoi Su-30SM Flanker-H', role: 'Multirole', country: 'Russia', side: 'red',
    description: 'Two-seat supermaneuverable Flanker with canards and 3D thrust vectoring. Post-stall capable; Bars PESA radar with TWS.',
    massEmpty: 18800, massMax: 34500, fuelInternal: 9640, pylonFuel: 0,
    wingArea: 62, span: 14.7, chord: 4.0, length: 21.94, inertia: [42000, 240000, 280000],
    aero: aero({ CLa: 3.9, CLmax: 1.85, CD0: 0.023, k: 0.11, Cma: -0.12, Mcrit: 0.87, waveDrag: 2.3 }),
    engine: eng('2× AL-31FP (TVC)', 2, 74.5, 123, 2.0),
    limits: { gMax: 9, gMin: -3, aoaMax: 35, rollRate: 250, maxMach: 2.0, vmaxKcas: 755 },
    fcs: { type: 'fbw', tvc: 15, canard: true }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(21.94, 4.4, 2.0), radar: { name: 'N011M Bars', range: 140000, azLimit: 70, tws: true, irst: 50000 },
    rcs: 15, gun: { name: 'GSh-30-1 30mm', rounds: 150, rpm: 1800, muzzleVel: 860, damage: 25 },
    stations: 12,
    loadouts: [
      { name: 'CAP: 4× R-77, 2× R-27ER, 4× R-73', stores: ['r77', 'r77', 'r77', 'r77', 'r27er', 'r27er', 'r73', 'r73', 'r73', 'r73'] },
      { name: 'Strike: 4× KAB-500L, 2× R-77, 2× R-73', stores: ['kab500l', 'kab500l', 'kab500l', 'kab500l', 'r77', 'r77', 'r73', 'r73'] },
      { name: 'SEAD: 4× Kh-31P, 2× R-77, 2× R-73', stores: ['kh31p', 'kh31p', 'kh31p', 'kh31p', 'r77', 'r77', 'r73', 'r73'] },
      { name: 'Anti-armor: 4× Kh-29T, 2× R-73', stores: ['kh29t', 'kh29t', 'kh29t', 'kh29t', 'r73', 'r73'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 64, flares: 64, approachKts: 140, rotateKts: 145,
    model: { wing: 'trapezoid', canard: true, twinTail: true, engines: 2, intake: 'under', tailplane: true, color: 0x8c9ba3, sweep: 42 },
  },
  {
    id: 'su57', name: 'Su-57', fullName: 'Sukhoi Su-57 Felon', role: '5th gen multirole', country: 'Russia', side: 'red',
    description: 'Low-observable fighter with internal weapon bays, thrust vectoring and supercruise. Small RCS shortens enemy detection ranges.',
    massEmpty: 18000, massMax: 35000, fuelInternal: 10300, pylonFuel: 0,
    wingArea: 78.8, span: 14.1, chord: 5.0, length: 20.1, inertia: [40000, 250000, 285000],
    aero: aero({ CLa: 3.8, CLmax: 1.9, CD0: 0.0195, k: 0.11, Cma: -0.1, Mcrit: 0.9, waveDrag: 2.0 }),
    engine: eng('2× AL-41F1 (TVC)', 2, 88, 142, 2.0),
    limits: { gMax: 9, gMin: -3, aoaMax: 40, rollRate: 270, maxMach: 2.0, vmaxKcas: 800 },
    fcs: { type: 'fbw', tvc: 20 }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(20.1, 4.0, 2.0), radar: { name: 'N036 Byelka AESA', range: 170000, azLimit: 70, tws: true, irst: 50000 },
    rcs: 0.1, gun: { name: 'GSh-30-1 30mm', rounds: 150, rpm: 1800, muzzleVel: 860, damage: 25 },
    stations: 6,
    loadouts: [
      { name: 'Internal: 4× R-77, 2× R-73', stores: ['r77', 'r77', 'r77', 'r77', 'r73', 'r73'] },
      { name: 'Strike (int.): 2× KAB-500L, 2× R-77, 2× R-73', stores: ['kab500l', 'kab500l', 'r77', 'r77', 'r73', 'r73'] },
      { name: 'SEAD (int.): 2× Kh-31P, 2× R-77, 2× R-73', stores: ['kh31p', 'kh31p', 'r77', 'r77', 'r73', 'r73'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 64, flares: 64, approachKts: 140, rotateKts: 145,
    model: { wing: 'cdelta', twinTail: true, tailCant: 25, engines: 2, intake: 'under', tailplane: true, color: 0x6f7c84, sweep: 48 },
  },
  // ------------------------------------------------------------------ Europe
  {
    id: 'm2000', name: 'Mirage 2000-5', fullName: 'Dassault Mirage 2000-5', role: 'Multirole', country: 'France', side: 'blue',
    description: 'Tailless delta with FBW. Very high instantaneous turn and nose authority, bleeds energy fast. RDY radar with MICA.',
    massEmpty: 7500, massMax: 17000, fuelInternal: 3160, pylonFuel: 1340,
    wingArea: 41, span: 9.13, chord: 5.9, length: 14.36, inertia: [12000, 70000, 78000],
    aero: aero({ CLa: 2.8, CLmax: 1.5, CD0: 0.019, k: 0.18, Cma: -0.08, Cmde: 0.6, Mcrit: 0.92, waveDrag: 1.7, flapCL: 0 }),
    engine: eng('SNECMA M53-P2', 1, 64.3, 95.1, 2.2),
    limits: { gMax: 9, gMin: -3.2, aoaMax: 29, rollRate: 270, maxMach: 2.2, vmaxKcas: 750 },
    fcs: { type: 'fbw' }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(14.36, 3.4, 1.6), radar: { name: 'Thales RDY', range: 90000, azLimit: 60, tws: true },
    rcs: 2, gun: { name: '2× DEFA 554 30mm', rounds: 250, rpm: 3600, muzzleVel: 815, damage: 22 },
    stations: 9,
    loadouts: [
      { name: 'CAP: 4× MICA EM, 2× Magic II, tank', stores: ['mica_em', 'mica_em', 'mica_em', 'mica_em', 'magic2', 'magic2', 'tank'] },
      { name: 'Legacy: 2× Super 530D, 2× Magic II, tank', stores: ['s530d', 's530d', 'magic2', 'magic2', 'tank'] },
      { name: 'Strike: 4× Mk-82, 2× MICA IR', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'mica_ir', 'mica_ir'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 112, flares: 16, approachKts: 145, rotateKts: 160,
    model: { wing: 'delta', engines: 1, intake: 'side', tailplane: false, color: 0x8f9aa2, sweep: 58 },
  },
  {
    id: 'rafale', name: 'Rafale C', fullName: 'Dassault Rafale C (F3-R)', role: 'Omnirole', country: 'France', side: 'blue',
    description: 'Close-coupled canard delta with AESA radar, OSF IRST and Meteor. Carefree handling, strong low-speed performance.',
    massEmpty: 10300, massMax: 24500, fuelInternal: 4700, pylonFuel: 1600,
    wingArea: 45.7, span: 10.9, chord: 5.2, length: 15.27, inertia: [15000, 100000, 110000],
    aero: aero({ CLa: 3.2, CLmax: 1.8, CD0: 0.020, k: 0.15, Cma: -0.08, Cmde: 0.7, Mcrit: 0.9, waveDrag: 2.2, flapCL: 0 }),
    engine: eng('2× SNECMA M88-2', 2, 50, 75, 1.85),
    limits: { gMax: 9, gMin: -3.2, aoaMax: 32, rollRate: 270, maxMach: 1.8, vmaxKcas: 750 },
    fcs: { type: 'fbw', canard: true }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(15.27, 2.7, 1.6), radar: { name: 'RBE2-AA AESA', range: 140000, azLimit: 70, tws: true, irst: 40000 },
    rcs: 0.8, gun: { name: 'GIAT 30M791 30mm', rounds: 125, rpm: 2500, muzzleVel: 1025, damage: 22 },
    stations: 14,
    loadouts: [
      { name: 'CAP: 2× Meteor, 4× MICA EM, 2× MICA IR, tank', stores: ['meteor', 'meteor', 'mica_em', 'mica_em', 'mica_em', 'mica_em', 'mica_ir', 'mica_ir', 'tank'] },
      { name: 'Strike: 4× GBU-12, 2× MICA EM, 2× MICA IR', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'mica_em', 'mica_em', 'mica_ir', 'mica_ir'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 112, flares: 32, approachKts: 130, rotateKts: 140,
    model: { wing: 'delta', canard: true, engines: 2, intake: 'under', tailplane: false, color: 0x7e8a92, sweep: 48 },
  },
  {
    id: 'jas39', name: 'JAS-39C Gripen', fullName: 'Saab JAS 39C Gripen', role: 'Multirole', country: 'Sweden', side: 'blue',
    description: 'Small, cheap-to-operate canard delta designed for road bases. Good AoA authority, low RCS, PS-05/A radar with Meteor.',
    massEmpty: 6800, massMax: 14000, fuelInternal: 2270, pylonFuel: 900,
    wingArea: 30, span: 8.4, chord: 4.6, length: 14.1, inertia: [9000, 55000, 60000],
    aero: aero({ CLa: 3.0, CLmax: 1.65, CD0: 0.019, k: 0.16, Cma: -0.08, Cmde: 0.7, Mcrit: 0.9, waveDrag: 1.8, flapCL: 0 }),
    engine: eng('Volvo RM12', 1, 54, 80.5, 2.0),
    limits: { gMax: 9, gMin: -3, aoaMax: 26, rollRate: 280, maxMach: 2.0, vmaxKcas: 750 },
    fcs: { type: 'fbw', canard: true }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(14.1, 2.4, 1.5), radar: { name: 'PS-05/A', range: 100000, azLimit: 60, tws: true },
    rcs: 0.5, gun: { name: 'Mauser BK-27 27mm', rounds: 120, rpm: 1700, muzzleVel: 1025, damage: 20 },
    stations: 8,
    loadouts: [
      { name: 'CAP: 2× Meteor, 2× AIM-120C, 2× IRIS-T, tank', stores: ['meteor', 'meteor', 'aim120c', 'aim120c', 'iris_t', 'iris_t', 'tank'] },
      { name: 'Strike: 2× GBU-12, 2× AIM-120C, 2× IRIS-T', stores: ['gbu12', 'gbu12', 'aim120c', 'aim120c', 'iris_t', 'iris_t'] },
      { name: 'CAS: 2× AGM-65D, 2× Mk-82, 2× IRIS-T', stores: ['agm65d', 'agm65d', 'mk82', 'mk82', 'iris_t', 'iris_t'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 80, flares: 40, approachKts: 130, rotateKts: 135,
    model: { wing: 'delta', canard: true, engines: 1, intake: 'side', tailplane: false, color: 0x868f96, sweep: 45 },
  },
  {
    id: 'ef2000', name: 'Typhoon', fullName: 'Eurofighter EF-2000 Typhoon (Tranche 3)', role: 'Swing-role', country: 'Europe', side: 'blue',
    description: 'Unstable canard delta with outstanding thrust-to-weight. Supercruises, climbs like a rocket, CAPTOR radar + PIRATE IRST.',
    massEmpty: 11000, massMax: 23500, fuelInternal: 4500, pylonFuel: 1200,
    wingArea: 51.2, span: 10.95, chord: 5.0, length: 15.96, inertia: [17000, 120000, 130000],
    aero: aero({ CLa: 3.1, CLmax: 1.7, CD0: 0.019, k: 0.155, Cma: -0.06, Cmde: 0.7, Mcrit: 0.9, waveDrag: 2.1, flapCL: 0 }),
    engine: eng('2× Eurojet EJ200', 2, 60, 90, 2.0),
    limits: { gMax: 9, gMin: -3, aoaMax: 30, rollRate: 300, maxMach: 2.0, vmaxKcas: 750 },
    fcs: { type: 'fbw', canard: true }, controls: { elev: 25, ail: 20, rud: 25 },
    gear: gear(15.96, 3.5, 1.6), radar: { name: 'CAPTOR-M', range: 130000, azLimit: 60, tws: true, irst: 50000 },
    rcs: 0.5, gun: { name: 'Mauser BK-27 27mm', rounds: 150, rpm: 1700, muzzleVel: 1025, damage: 20 },
    stations: 13,
    loadouts: [
      { name: 'CAP: 4× Meteor, 2× ASRAAM, tank', stores: ['meteor', 'meteor', 'meteor', 'meteor', 'asraam', 'asraam', 'tank'] },
      { name: 'CAP (legacy): 4× AIM-120C, 2× IRIS-T, tank', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'iris_t', 'iris_t', 'tank'] },
      { name: 'Swing: 4× GBU-12, 4× AIM-120C, 2× ASRAAM', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'asraam', 'asraam'] },
      { name: 'Clean', stores: [] },
    ],
    chaff: 80, flares: 40, approachKts: 135, rotateKts: 140,
    model: { wing: 'delta', canard: true, engines: 2, intake: 'chin', tailplane: false, color: 0x8b949c, sweep: 53 },
  },
];

// ------------------------------------------------------------------ variants
/** Family / variant labels and crew for the base airframes. */
const META: Record<string, { family: string; variant?: string; seats?: 1 | 2; capabilities?: Capability[] }> = {
  f14b: { family: 'F-14', variant: 'B(U)', seats: 2, capabilities: ['carrier', 'probe'] },
  f15c: { family: 'F-15', variant: 'C' },
  f16c: { family: 'F-16', variant: 'C Block 50' },
  fa18c: { family: 'F/A-18', variant: 'C', capabilities: ['carrier', 'probe'] },
  fa18e: { family: 'F/A-18', variant: 'E', capabilities: ['carrier', 'probe'] },
  jas39: { family: 'JAS 39', variant: 'C' },
};

const F16_A2A9 = ['aim9m', 'aim9m'];
/**
 * Variants of the base airframes (each may extend a base or an earlier variant). Figures are approximate public
 * data: engine thrust (SL static), empty mass, internal fuel (incl. CFTs), radar generation and weapons clearance.
 */
const VARIANTS: VariantDef[] = [
  // ---------------------------------------------------------------- F-14 Tomcat
  {
    id: 'f14a', extends: 'f14b', overrides: {
      name: 'F-14A', fullName: 'Grumman F-14A Tomcat', variant: 'A',
      description: 'The original Tomcat with TF30-P-414A engines: slow to spool, underpowered, and prone to compressor stalls at high AoA, in sideslip or with abrupt throttle movements in afterburner — a stall on one engine yaws the jet hard. Fly the engines as carefully as the jet.',
      massEmpty: 18200,
      engine: eng('2× TF30-P-414A', 2, 54.9, 93.0, 2.2, { spoolTime: 6.5, stallProne: 1 }),
      radar: { name: 'AN/AWG-9', range: 150000, azLimit: 65, tws: true },
      model: { color: 0xa7b0b6 },
    },
  },
  {
    id: 'f14b1', extends: 'f14b', overrides: {
      name: 'F-14B', fullName: 'Grumman F-14B Tomcat', variant: 'B',
      description: 'F-14A airframe re-engined with the F110-GE-400: 30% more thrust, no compressor-stall vice, carrier take-offs without afterburner. Original analogue AWG-9 avionics.',
      massEmpty: 19400,
      radar: { name: 'AN/AWG-9', range: 150000, azLimit: 65, tws: true },
    },
  },
  {
    id: 'f14d', extends: 'f14b', overrides: {
      name: 'F-14D', fullName: 'Grumman F-14D Super Tomcat', variant: 'D',
      description: 'The last Tomcat: F110 engines, digital avionics, AN/APG-71 radar and the chin-mounted IRST/TCS — the most capable fleet interceptor of its day.',
      massEmpty: 19838,
      radar: { name: 'AN/APG-71 + IRST', range: 175000, azLimit: 65, tws: true, irst: 60000 },
      model: { color: 0x8f989d },
    },
  },
  // ---------------------------------------------------------------- F-16 Fighting Falcon
  {
    id: 'f16a', extends: 'f16c', overrides: {
      name: 'F-16A', fullName: 'General Dynamics F-16A Fighting Falcon (Block 15)', variant: 'A Block 15',
      description: 'The original lightweight day fighter: APG-66 radar without beyond-visual-range missiles — Sidewinders, gun and dumb bombs. Light and nimble, but you must get close.',
      massEmpty: 7390, massMax: 17000, fuelInternal: 3160,
      engine: eng('F100-PW-200', 1, 64.9, 106, 1.9),
      radar: { name: 'AN/APG-66', range: 60000, azLimit: 60, tws: false },
      rcs: 1.2,
      loadouts: [
        { name: 'BFM: 2× AIM-9M', stores: [...F16_A2A9] },
        { name: 'CAP: 4× AIM-9M, 2 tanks', stores: ['aim9m', 'aim9m', 'aim9m', 'aim9m', 'tank', 'tank'] },
        { name: 'Strike: 6× Mk-82, 2× AIM-9M, 2 tanks', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'mk82', 'mk82', 'aim9m', 'aim9m', 'tank', 'tank'] },
        { name: 'Strike: 2× Mk-84, 2× AIM-9M, 2 tanks', stores: ['mk84', 'mk84', 'aim9m', 'aim9m', 'tank', 'tank'] },
        { name: 'Clean', stores: [] },
      ],
      allowedStores: ['aim9m', 'mk82', 'mk84', 'bdu33', 'tank'],
      stations: 10,
      model: { color: 0x9aa2a8 },
    },
  },
  { id: 'f16b', extends: 'f16a', overrides: { name: 'F-16B', fullName: 'General Dynamics F-16B Fighting Falcon (Block 15)', variant: 'B Block 15', seats: 2, massEmpty: 7720, fuelInternal: 2720, description: 'Two-seat Block 15 — trainer and combat capable, with less internal fuel.' } },
  {
    id: 'f16c40', extends: 'f16c', overrides: {
      name: 'F-16C Blk 40', fullName: 'General Dynamics F-16C Fighting Falcon (Block 40)', variant: 'C Block 40',
      description: 'Night/precision-attack Viper: F110-GE-100, APG-68(V)5 and LANTIRN pods for laser-guided bombs. AMRAAM-capable, but no HARM targeting system — not a SEAD jet.',
      massEmpty: 8600,
      engine: eng('F110-GE-100', 1, 76.3, 128.9, 2.0),
      radar: { name: 'AN/APG-68(V)5', range: 75000, azLimit: 60, tws: true },
      loadouts: [
        { name: 'CAP: 4× AIM-120C, 2× AIM-9M, 2 tanks', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9m', 'aim9m', 'tank', 'tank'] },
        { name: 'Precision: 4× GBU-12, 2× AIM-120C, 2× AIM-9M, 2 tanks', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim9m', 'aim9m', 'tank', 'tank'] },
        { name: 'Strike: 4× Mk-82, 2× AIM-120C, 2× AIM-9M', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'aim120c', 'aim120c', 'aim9m', 'aim9m'] },
        { name: 'CAS: 4× AGM-65D, 2× AIM-9M', stores: ['agm65d', 'agm65d', 'agm65d', 'agm65d', 'aim9m', 'aim9m'] },
        { name: 'BFM: 2× AIM-9M', stores: [...F16_A2A9] },
        { name: 'Clean', stores: [] },
      ],
      allowedStores: ['aim120c', 'aim7m', 'aim9m', 'mk82', 'mk84', 'bdu33', 'gbu12', 'agm65d', 'tank'],
      stations: 10,
    },
  },
  { id: 'f16d40', extends: 'f16c40', overrides: { name: 'F-16D Blk 40', fullName: 'General Dynamics F-16D Fighting Falcon (Block 40)', variant: 'D Block 40', seats: 2, massEmpty: 8950, fuelInternal: 2650, description: 'Two-seat Block 40: a second crewman for the targeting pod at night, at the cost of internal fuel.' } },
  { id: 'f16d', extends: 'f16c', overrides: { name: 'F-16D Blk 50', fullName: 'General Dynamics F-16D Fighting Falcon (Block 50)', variant: 'D Block 50', seats: 2, massEmpty: 8900, fuelInternal: 2650, description: 'Two-seat Block 50 — Wild Weasel and training, less internal fuel.' } },
  {
    id: 'f16c70', extends: 'f16c', overrides: {
      name: 'F-16C Blk 70', fullName: 'Lockheed Martin F-16 Block 70 (F-16V)', variant: 'C Block 70',
      description: 'The newest Viper: AN/APG-83 AESA radar (longer range, better tracking), modern cockpit and conformal fuel tanks for range without pylon tanks.',
      massEmpty: 9300, massMax: 21800, fuelInternal: 4560,
      aero: { CD0: 0.0187 },
      radar: { name: 'AN/APG-83 SABR (AESA)', range: 110000, azLimit: 70, tws: true },
      rcs: 1.3,
      capabilities: ['cft'],
      loadouts: [
        { name: 'CAP: 6× AIM-120C, 2× AIM-9X', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
        { name: 'Strike: 4× Mk-82, 2× AIM-120C, 2× AIM-9X', stores: ['mk82', 'mk82', 'mk82', 'mk82', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
        { name: 'Precision: 4× GBU-12, 2× AIM-120C, 2× AIM-9X', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
        { name: 'SEAD: 2× AGM-88, 2× AIM-120C, 2× AIM-9X, 2 tanks', stores: ['agm88', 'agm88', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank', 'tank'] },
        { name: 'CAS: 4× AGM-65D, 2× AIM-9X', stores: ['agm65d', 'agm65d', 'agm65d', 'agm65d', 'aim9x', 'aim9x'] },
        { name: 'Clean', stores: [] },
      ],
      model: { color: 0x7f888e },
    },
  },
  { id: 'f16d70', extends: 'f16c70', overrides: { name: 'F-16D Blk 70', fullName: 'Lockheed Martin F-16D Block 70 (F-16V)', variant: 'D Block 70', seats: 2, massEmpty: 9650, fuelInternal: 4010, description: 'Two-seat Block 70 with CFTs.' } },
  // ---------------------------------------------------------------- F-15 Eagle
  { id: 'f15d', extends: 'f15c', overrides: { name: 'F-15D', fullName: 'McDonnell Douglas F-15D Eagle', variant: 'D', seats: 2, massEmpty: 13100, fuelInternal: 5650, description: 'Two-seat Eagle: full air-to-air capability, slightly heavier, less internal fuel.' } },
  {
    id: 'f15e', extends: 'f15c', overrides: {
      name: 'F-15E', fullName: 'McDonnell Douglas F-15E Strike Eagle', role: 'Strike fighter', variant: 'E', seats: 2,
      description: 'Two-seat dual-role Eagle with conformal fuel tanks, a WSO in the back seat and the AN/APG-82 AESA. Hauls a heavy bomb load deep and still fights its way out with AMRAAMs.',
      massEmpty: 14300, massMax: 36700, fuelInternal: 10200,
      aero: { CD0: 0.024 },
      engine: eng('2× F100-PW-229', 2, 79.2, 129.7, 2.3),
      radar: { name: 'AN/APG-82(V)1 (AESA)', range: 150000, azLimit: 60, tws: true },
      rcs: 14,
      gun: { name: 'M61A1 20mm', rounds: 500, rpm: 6000, muzzleVel: 1030, damage: 9 },
      capabilities: ['cft'],
      stations: 12,
      loadouts: [
        { name: 'Strike: 6× GBU-12, 2× AIM-120C, 2× AIM-9X', stores: ['gbu12', 'gbu12', 'gbu12', 'gbu12', 'gbu12', 'gbu12', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
        { name: 'Deep strike: 4× Mk-84, 2× AIM-120C, 2× AIM-9X, 2 tanks', stores: ['mk84', 'mk84', 'mk84', 'mk84', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'tank', 'tank'] },
        { name: 'CAS: 6× AGM-65D, 2× AIM-120C, 2× AIM-9X', stores: ['agm65d', 'agm65d', 'agm65d', 'agm65d', 'agm65d', 'agm65d', 'aim120c', 'aim120c', 'aim9x', 'aim9x'] },
        { name: 'Air: 4× AIM-120C, 4× AIM-9X', stores: ['aim120c', 'aim120c', 'aim120c', 'aim120c', 'aim9x', 'aim9x', 'aim9x', 'aim9x'] },
        { name: 'Clean', stores: [] },
      ],
      model: { color: 0x5d6367 },
    },
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge: plain objects merge recursively, arrays and primitives replace, `null` clears. */
export function mergeDeep<T>(base: T, over: DeepPartial<T>): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? mergeDeep(out[k], v as DeepPartial<unknown>) : v;
  }
  return out as T;
}

/** Capabilities implied by loadouts and systems (explicit `capabilities` are added on top). */
export function deriveCapabilities(d: AircraftDef): Capability[] {
  const caps = new Set<Capability>(d.capabilities ?? []);
  for (const id of d.allowedStores ?? []) {
    const k = WEAPONS[id]?.kind;
    if (k === 'arh' || k === 'sarh') caps.add('bvr');
    else if (k === 'ir') caps.add('ir');
    else if (k === 'bomb') caps.add('bombs');
    else if (k === 'lgb') caps.add('lgb');
    else if (k === 'agm') caps.add('agm');
    else if (k === 'arm') caps.add('sead');
  }
  if (d.gun) caps.add('gun');
  if (d.fcs.swingWing) caps.add('swing-wing');
  if (d.fcs.vtol) caps.add('stovl');
  return [...caps];
}

/** Fill in variant-system defaults (family, seats, allowed stores, capabilities). */
function finalize(d: AircraftDef): AircraftDef {
  const allowed = d.allowedStores ?? [...new Set(d.loadouts.flatMap((l) => l.stores).filter(Boolean))];
  const out: AircraftDef = { ...d, family: d.family ?? d.name, seats: d.seats ?? 1, allowedStores: allowed };
  out.capabilities = deriveCapabilities(out);
  // loadouts may only use allowed stores
  out.loadouts = out.loadouts.filter((l) => l.stores.every((s) => !s || allowed.includes(s)));
  return out;
}

export function resolveVariant(base: AircraftDef, v: VariantDef): AircraftDef {
  return { ...mergeDeep(base, v.overrides), id: v.id };
}

const RESOLVED: Record<string, AircraftDef> = Object.fromEntries(BASE.map((a) => [a.id, { ...a, ...META[a.id] }]));
const ORDER = BASE.map((a) => a.id);
for (const v of VARIANTS) {
  const base = RESOLVED[v.extends];
  if (!base) throw new Error(`variant ${v.id} extends unknown aircraft ${v.extends}`);
  if (RESOLVED[v.id]) throw new Error(`duplicate aircraft id ${v.id}`);
  // a variant inherits family/seats but not the parent's explicit store list unless it gives none of its own loadouts
  const inherited = v.overrides.loadouts ? { ...base, allowedStores: undefined } : base;
  RESOLVED[v.id] = resolveVariant(inherited, v);
  ORDER.push(v.id);
}
// keep families together: each variant is listed right after the last member of its family
const familyOrder: string[] = [];
for (const id of ORDER) {
  const fam = RESOLVED[id].family ?? RESOLVED[id].name;
  let at = familyOrder.length;
  for (let i = familyOrder.length - 1; i >= 0; i--) if ((RESOLVED[familyOrder[i]].family ?? RESOLVED[familyOrder[i]].name) === fam) { at = i + 1; break; }
  familyOrder.splice(at, 0, id);
}
export const AIRCRAFT: AircraftDef[] = familyOrder.map((id) => finalize(RESOLVED[id]));

export const AIRCRAFT_BY_ID: Record<string, AircraftDef> = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a]));

/** All aircraft of a family, in definition order. */
export function familyOf(family: string): AircraftDef[] { return AIRCRAFT.filter((a) => a.family === family); }
export function hasCapability(d: AircraftDef, c: Capability) { return d.capabilities?.includes(c) ?? false; }
export function getAircraft(id: string): AircraftDef {
  const d = AIRCRAFT_BY_ID[id];
  if (!d) throw new Error(`Unknown aircraft ${id}`);
  return d;
}
