export type FcsType = 'fbw' | 'cas' | 'manual';
export type Side = 'blue' | 'red';

export interface AeroDef {
  CLa: number;        // lift curve slope, per rad (low subsonic)
  CL0: number;        // lift at zero alpha (camber)
  CLmax: number;      // stall alpha is derived from CLa/CLmax (see aero.ts)
  CD0: number;        // clean subsonic zero-lift drag
  k: number;          // induced drag factor  CDi = k * CL^2
  Mcrit: number;      // drag divergence Mach
  waveDrag: number;   // CD0 multiplier at Mach ~1.1
  // Stability & control derivatives (per rad, controls positive in commanded direction)
  Cma: number; Cmq: number; Cmde: number;
  Clb: number; Clp: number; Clda: number; Clr: number;
  Cnb: number; Cnr: number; Cndr: number;
  CYb: number;
  flapCL: number; flapCD: number; brakeCD: number; gearCD: number;
}

export interface EngineDef {
  name: string;
  count: number;
  milThrust: number;  // N, per engine, sea level static
  abThrust: number;   // N, per engine, sea level static (== mil if no AB)
  tsfcMil: number;    // kg / (N s)
  tsfcAB: number;
  spoolTime: number;  // s, idle -> mil
  inletMach: number;  // Mach where inlet/engine limits start to cut thrust
  /** compressor-stall susceptibility (TF30 ≈ 1); undefined = robust engine */
  stallProne?: number;
}

export interface LimitsDef {
  gMax: number; gMin: number;
  aoaMax: number;       // deg: hard FBW limiter, soft (warning + fading stick) on CAS/analog jets
  /** negative AoA limit (deg, positive number); default 10 */
  aoaNeg?: number;
  rollRate: number;     // deg/s max commanded (FBW) / typical
  maxMach: number;
  vmaxKcas: number;
}

export interface FcsDef {
  type: FcsType;
  tvc?: number;          // thrust vectoring max deflection deg
  swingWing?: boolean;   // F-14 auto sweep
  vtol?: boolean;        // Harrier vectored nozzles
  canard?: boolean;
  /** control law: 'f16' = the F-16 FLCS (dynamic inversion on all three axes, see FlightModel.f16Flcs) */
  law?: 'f16';
}

export interface GearDef {
  nose: number;   // m forward of CG
  main: number;   // m aft of CG
  track: number;  // m between main wheels
  height: number; // m, CG height above ground when static
  hook?: boolean;
}

export interface RadarDef {
  name: string;
  range: number;     // m, detection range vs 5 m^2 target
  azLimit: number;   // deg
  tws: boolean;
  irst?: number;     // IRST range m (0/undefined = none)
}

export interface GunDef {
  name: string;
  rounds: number;
  rpm: number;
  muzzleVel: number;  // m/s
  damage: number;     // per hit
}

export interface Loadout {
  name: string;
  stores: string[];   // weapon ids (one per station, '' = empty), plus 'tank' for fuel tanks
}

export interface ModelDef {
  wing: 'swept' | 'delta' | 'cdelta' | 'trapezoid' | 'swing' | 'shoulder';
  canard?: boolean;
  twinTail?: boolean;
  tailCant?: number;    // deg outward
  engines: 1 | 2;
  intake: 'side' | 'chin' | 'under' | 'shoulder';
  tailplane?: boolean;  // horizontal tail
  color: number;
  sweep: number;        // deg leading edge sweep
}

export interface AircraftDef {
  id: string;
  name: string;
  fullName: string;
  role: string;
  country: string;
  side: Side;
  description: string;
  massEmpty: number;      // kg
  massMax: number;        // kg MTOW
  fuelInternal: number;   // kg
  pylonFuel: number;      // kg per external tank
  wingArea: number;       // m2
  span: number;           // m
  chord: number;          // m MAC
  length: number;         // m
  inertia: [number, number, number]; // Ixx, Iyy, Izz kg m2 (at empty + half fuel)
  aero: AeroDef;
  engine: EngineDef;
  limits: LimitsDef;
  fcs: FcsDef;
  controls: { elev: number; ail: number; rud: number }; // max deflection deg
  gear: GearDef;
  radar: RadarDef | null;
  rcs: number;            // m2 frontal
  gun: GunDef | null;
  stations: number;
  loadouts: Loadout[];
  chaff: number;
  flares: number;
  model: ModelDef;
  approachKts: number;    // typical approach speed
  rotateKts: number;
  // ---- variant system (filled in by defs.ts when not given explicitly)
  /** aircraft family, e.g. "F-16" — variants of one family share a model and menu group */
  family?: string;
  /** variant label within the family, e.g. "Block 50" */
  variant?: string;
  /** crew seats (2 = two-seater: pilot + WSO/RIO or trainer) */
  seats?: 1 | 2;
  /** what the jet can do — used for loadouts, campaign tasking and AI */
  capabilities?: Capability[];
  /** stores this airframe may carry (default: everything used in its loadouts) */
  allowedStores?: string[];
  /** shares/receives the coalition air picture (Link 16); false for older jets */
  datalink?: boolean;
  /** selectable as a player aircraft (false for AWACS / tankers) */
  playable?: boolean;
  /** air-to-air refuelling tanker: boom and/or drogue, transfer rate kg/s */
  tanker?: { boom: boolean; drogue: boolean; rateKgS: number };
}

export type Capability =
  | 'bvr'         // radar-guided air-to-air missiles
  | 'ir'          // IR missiles
  | 'gun'
  | 'bombs'       // unguided bombs
  | 'lgb'         // laser-guided bombs (needs a targeting pod)
  | 'agm'         // air-to-ground missiles
  | 'sead'        // anti-radiation missiles
  | 'carrier'     // carrier capable (hook + catapult gear)
  | 'probe'       // probe-and-drogue refuelling
  | 'boom'        // flying-boom refuelling receptacle
  | 'swing-wing'
  | 'stovl'
  | 'cft';        // conformal fuel tanks

/** A variant: a base airframe plus overrides (deep-merged objects; arrays replace). */
export interface VariantDef {
  id: string;
  extends: string;
  overrides: DeepPartial<AircraftDef>;
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? DeepPartial<T[K]> | null : T[K] };
