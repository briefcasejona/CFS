export type WeaponKind =
  | 'ir' | 'sarh' | 'arh'           // air-to-air
  | 'bomb' | 'lgb' | 'agm' | 'arm'  // air-to-ground
  | 'tank';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  mass: number;          // kg at launch
  cda: number;           // drag area Cd*A, m2
  // motor
  thrust?: number;       // N boost
  burn?: number;         // s
  sustain?: number;      // N sustainer
  sustainTime?: number;  // s
  propellant?: number;   // kg burned total
  // guidance
  maxG?: number;
  gimbal?: number;       // deg seeker gimbal limit
  seekerRange?: number;  // m  (IR: vs rear aspect fighter; ARH: pitbull range; AGM: lock range; ARM: emitter detect)
  navGain?: number;
  flareResist?: number;  // 0..1
  chaffResist?: number;  // 0..1
  loft?: boolean;
  fuze?: number;         // proximity radius m
  warhead: number;       // damage at 0 m
  blast?: number;        // ground blast radius m
  lifetime?: number;     // s
  rangeKm: number;       // nominal max range for display/AI (head-on, co-altitude ~ 30 kft)
  minRange?: number;     // m
}

const AA = (o: Omit<WeaponDef, 'lifetime' | 'navGain'> & Partial<WeaponDef>): WeaponDef => ({
  lifetime: 60, navGain: 4, minRange: 400, fuze: 10, ...o,
});

export const WEAPONS: Record<string, WeaponDef> = {
  // ---- IR air-to-air
  aim9m: AA({ id: 'aim9m', name: 'AIM-9M', kind: 'ir', mass: 86, cda: 0.0065, thrust: 10500, burn: 5.2, propellant: 27,
    maxG: 30, gimbal: 40, seekerRange: 16000, flareResist: 0.55, warhead: 70, fuze: 8, rangeKm: 16, lifetime: 40 }),
  aim9x: AA({ id: 'aim9x', name: 'AIM-9X', kind: 'ir', mass: 85, cda: 0.0062, thrust: 10500, burn: 5.2, propellant: 27,
    maxG: 50, gimbal: 90, seekerRange: 18000, flareResist: 0.85, warhead: 70, fuze: 8, rangeKm: 18, lifetime: 40 }),
  r73: AA({ id: 'r73', name: 'R-73', kind: 'ir', mass: 105, cda: 0.0085, thrust: 13000, burn: 5, propellant: 33,
    maxG: 40, gimbal: 60, seekerRange: 15000, flareResist: 0.7, warhead: 75, fuze: 8, rangeKm: 20, lifetime: 40 }),
  magic2: AA({ id: 'magic2', name: 'Magic II', kind: 'ir', mass: 89, cda: 0.0075, thrust: 10500, burn: 4.5, propellant: 26,
    maxG: 35, gimbal: 50, seekerRange: 14000, flareResist: 0.65, warhead: 65, fuze: 8, rangeKm: 15, lifetime: 40 }),
  mica_ir: AA({ id: 'mica_ir', name: 'MICA IR', kind: 'ir', mass: 112, cda: 0.0075, thrust: 14000, burn: 6, propellant: 40,
    maxG: 50, gimbal: 60, seekerRange: 17000, flareResist: 0.8, warhead: 70, fuze: 9, rangeKm: 30, lifetime: 50 }),
  iris_t: AA({ id: 'iris_t', name: 'IRIS-T', kind: 'ir', mass: 87, cda: 0.0062, thrust: 12000, burn: 5.5, propellant: 30,
    maxG: 60, gimbal: 90, seekerRange: 18000, flareResist: 0.9, warhead: 70, fuze: 8, rangeKm: 25, lifetime: 45 }),
  asraam: AA({ id: 'asraam', name: 'ASRAAM', kind: 'ir', mass: 88, cda: 0.006, thrust: 14000, burn: 6, propellant: 35,
    maxG: 50, gimbal: 90, seekerRange: 18000, flareResist: 0.85, warhead: 70, fuze: 8, rangeKm: 25, lifetime: 45 }),
  // ---- SARH
  aim7m: AA({ id: 'aim7m', name: 'AIM-7M', kind: 'sarh', mass: 231, cda: 0.017, thrust: 25000, burn: 4.5, sustain: 5000, sustainTime: 11,
    propellant: 70, maxG: 25, gimbal: 60, chaffResist: 0.5, warhead: 90, fuze: 12, rangeKm: 45, lifetime: 75, loft: true }),
  r27r: AA({ id: 'r27r', name: 'R-27R', kind: 'sarh', mass: 253, cda: 0.018, thrust: 27000, burn: 4, sustain: 5000, sustainTime: 9,
    propellant: 75, maxG: 25, gimbal: 55, chaffResist: 0.45, warhead: 90, fuze: 12, rangeKm: 50, lifetime: 75, loft: true }),
  r27er: AA({ id: 'r27er', name: 'R-27ER', kind: 'sarh', mass: 350, cda: 0.022, thrust: 36000, burn: 6, sustain: 6000, sustainTime: 10,
    propellant: 135, maxG: 25, gimbal: 55, chaffResist: 0.45, warhead: 90, fuze: 12, rangeKm: 80, lifetime: 90, loft: true }),
  s530d: AA({ id: 's530d', name: 'Super 530D', kind: 'sarh', mass: 275, cda: 0.018, thrust: 30000, burn: 4.5, sustain: 5500, sustainTime: 10,
    propellant: 90, maxG: 30, gimbal: 55, chaffResist: 0.55, warhead: 90, fuze: 12, rangeKm: 55, lifetime: 80, loft: true }),
  // ---- ARH
  aim120c: AA({ id: 'aim120c', name: 'AIM-120C', kind: 'arh', mass: 161, cda: 0.012, thrust: 16500, burn: 8,
    propellant: 52, maxG: 40, gimbal: 60, seekerRange: 18500, chaffResist: 0.7, warhead: 80, fuze: 12, rangeKm: 70, lifetime: 100, loft: true }),
  aim54c: AA({ id: 'aim54c', name: 'AIM-54C', kind: 'arh', mass: 463, cda: 0.04, thrust: 18000, burn: 20,
    propellant: 160, maxG: 20, gimbal: 60, seekerRange: 18500, chaffResist: 0.55, warhead: 120, fuze: 15, rangeKm: 130, lifetime: 140, loft: true }),
  r77: AA({ id: 'r77', name: 'R-77', kind: 'arh', mass: 175, cda: 0.016, thrust: 18000, burn: 7,
    propellant: 55, maxG: 40, gimbal: 55, seekerRange: 15000, chaffResist: 0.65, warhead: 80, fuze: 12, rangeKm: 60, lifetime: 100, loft: true }),
  mica_em: AA({ id: 'mica_em', name: 'MICA EM', kind: 'arh', mass: 112, cda: 0.0075, thrust: 14000, burn: 6,
    propellant: 40, maxG: 50, gimbal: 60, seekerRange: 12000, chaffResist: 0.7, warhead: 70, fuze: 10, rangeKm: 50, lifetime: 80, loft: true }),
  meteor: AA({ id: 'meteor', name: 'Meteor', kind: 'arh', mass: 190, cda: 0.012, thrust: 20000, burn: 3, sustain: 3800, sustainTime: 45,
    propellant: 75, maxG: 40, gimbal: 60, seekerRange: 18500, chaffResist: 0.8, warhead: 80, fuze: 12, rangeKm: 120, lifetime: 140, loft: true }),
  // ---- Air to ground
  mk82: { id: 'mk82', name: 'Mk-82', kind: 'bomb', mass: 241, cda: 0.025, warhead: 260, blast: 28, rangeKm: 0 },
  mk84: { id: 'mk84', name: 'Mk-84', kind: 'bomb', mass: 907, cda: 0.07, warhead: 600, blast: 45, rangeKm: 0 },
  fab500: { id: 'fab500', name: 'FAB-500', kind: 'bomb', mass: 500, cda: 0.06, warhead: 400, blast: 35, rangeKm: 0 },
  bdu33: { id: 'bdu33', name: 'BDU-33 (practice)', kind: 'bomb', mass: 11, cda: 0.003, warhead: 2, blast: 3, rangeKm: 0 },
  gbu12: { id: 'gbu12', name: 'GBU-12', kind: 'lgb', mass: 277, cda: 0.03, maxG: 3, gimbal: 35, navGain: 3, warhead: 260, blast: 28, rangeKm: 12 },
  kab500l: { id: 'kab500l', name: 'KAB-500L', kind: 'lgb', mass: 534, cda: 0.05, maxG: 3, gimbal: 35, navGain: 3, warhead: 400, blast: 35, rangeKm: 12 },
  agm65d: { id: 'agm65d', name: 'AGM-65D', kind: 'agm', mass: 220, cda: 0.02, thrust: 18000, burn: 3.5, propellant: 30, maxG: 15,
    gimbal: 30, seekerRange: 14000, navGain: 3, warhead: 160, blast: 10, lifetime: 60, rangeKm: 22 },
  kh29t: { id: 'kh29t', name: 'Kh-29T', kind: 'agm', mass: 680, cda: 0.045, thrust: 50000, burn: 4, propellant: 110, maxG: 12,
    gimbal: 25, seekerRange: 12000, navGain: 3, warhead: 320, blast: 15, lifetime: 60, rangeKm: 20 },
  agm88: { id: 'agm88', name: 'AGM-88 HARM', kind: 'arm', mass: 361, cda: 0.022, thrust: 26000, burn: 7, propellant: 120, maxG: 20,
    gimbal: 60, seekerRange: 120000, navGain: 3, warhead: 120, blast: 15, lifetime: 120, rangeKm: 90, loft: true },
  kh31p: { id: 'kh31p', name: 'Kh-31P', kind: 'arm', mass: 600, cda: 0.035, thrust: 30000, burn: 4, sustain: 9000, sustainTime: 20, propellant: 200,
    maxG: 15, gimbal: 60, seekerRange: 120000, navGain: 3, warhead: 150, blast: 15, lifetime: 120, rangeKm: 100 },
  tank: { id: 'tank', name: 'Fuel tank', kind: 'tank', mass: 140, cda: 0.06, warhead: 0, rangeKm: 0 },
  // ---- Surface-to-air (command / SARH guided from the site's tracking radar)
  sa10: AA({ id: 'sa10', name: '48N6 (SA-10)', kind: 'sarh', mass: 1800, cda: 0.12, thrust: 180000, burn: 12, propellant: 900,
    maxG: 25, gimbal: 80, chaffResist: 0.6, warhead: 140, fuze: 20, rangeKm: 90, lifetime: 120, minRange: 3000 }),
  sa6: AA({ id: 'sa6', name: '3M9 (SA-6)', kind: 'sarh', mass: 600, cda: 0.06, thrust: 60000, burn: 6, sustain: 15000, sustainTime: 15, propellant: 250,
    maxG: 20, gimbal: 80, chaffResist: 0.45, warhead: 110, fuze: 15, rangeKm: 24, lifetime: 45, minRange: 2000 }),
  sa2: AA({ id: 'sa2', name: 'V-750 (SA-2)', kind: 'sarh', mass: 2300, cda: 0.2, thrust: 250000, burn: 4, sustain: 30000, sustainTime: 22, propellant: 1100,
    maxG: 10, gimbal: 80, chaffResist: 0.35, warhead: 150, fuze: 25, rangeKm: 40, lifetime: 60, minRange: 6000 }),
  sa15: AA({ id: 'sa15', name: '9M330 (SA-15)', kind: 'sarh', mass: 165, cda: 0.02, thrust: 30000, burn: 4, propellant: 60,
    maxG: 30, gimbal: 80, chaffResist: 0.6, warhead: 80, fuze: 10, rangeKm: 12, lifetime: 25, minRange: 1500 }),
  patriot: AA({ id: 'patriot', name: 'MIM-104 (Patriot)', kind: 'sarh', mass: 900, cda: 0.08, thrust: 110000, burn: 11, propellant: 450,
    maxG: 25, gimbal: 80, chaffResist: 0.65, warhead: 130, fuze: 20, rangeKm: 80, lifetime: 100, minRange: 3000 }),
  hawk: AA({ id: 'hawk', name: 'MIM-23 (Hawk)', kind: 'sarh', mass: 630, cda: 0.06, thrust: 55000, burn: 5, sustain: 12000, sustainTime: 20, propellant: 260,
    maxG: 20, gimbal: 80, chaffResist: 0.5, warhead: 110, fuze: 15, rangeKm: 40, lifetime: 60, minRange: 2000 }),
};

export const isAA = (w: WeaponDef) => w.kind === 'ir' || w.kind === 'sarh' || w.kind === 'arh';
export const isAG = (w: WeaponDef) => w.kind === 'bomb' || w.kind === 'lgb' || w.kind === 'agm' || w.kind === 'arm';
