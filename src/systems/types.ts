// Per-aircraft systems: the interface every modelled aircraft implements.
//
// Until now every jet flew on one generic set of assumptions ("the mainframe"): the engine always runs, the
// gear always moves, fuel is one number. An aircraft that has its own `AircraftSystems` replaces those assumptions
// with its real electrical, hydraulic, fuel, engine and landing-gear systems, driven by the switches in its own
// cockpit. An aircraft without one keeps flying on the generic set, so jets can be moved over one at a time.
//
// The contract has three parts:
//   1. Controls, lights and gauges are declared as data (`ControlDef`, `LightDef`, `GaugeDef`), so the cockpit
//      panel, key bindings, a clickable 3D cockpit and the checklist can all be built without knowing the type.
//   2. `step()` reads what the airframe is doing (`SystemsEnv`) and advances the systems.
//   3. `hooks` (`FmHooks`) is what the systems give back to the flight model: is the engine lit, may the gear
//      move, how much hydraulic power do the flight controls have, and so on.

/** A switch, knob, handle or button in the cockpit. */
export interface ControlDef {
  id: string;
  label: string;
  /** cockpit panel the control sits on, e.g. "ELEC" */
  panel: string;
  /** position labels, index = position */
  positions: string[];
  /** position with everything running (runway / air start) */
  hot: number;
  /** position in a cold and dark jet */
  cold: number;
  /** spring-loaded: returns to `rest` when released */
  momentary?: boolean;
  rest?: number;
  /** guarded switch: needs a deliberate second click in the panel */
  guard?: boolean;
  help?: string;
}

export interface LightDef {
  id: string;
  label: string;
  kind: 'warning' | 'caution' | 'indicator';
  panel: string;
  /** indicator colour; warnings are red and cautions amber */
  color?: 'green' | 'amber' | 'red' | 'blue';
}

export interface GaugeDef {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  panel: string;
  /** values above (or below, with `redBelow`) this are shown red */
  redAbove?: number;
  redBelow?: number;
}

/** What the systems need to know about the airframe each step (SI units). */
export interface SystemsEnv {
  wow: boolean;
  /** calibrated airspeed m/s */
  ias: number;
  /** true airspeed m/s (≈ ground speed on the runway) */
  tas: number;
  mach: number;
  /** altitude m MSL */
  alt: number;
  /** vertical speed m/s, + = up */
  vs: number;
  nz: number;
  /** throttle lever 0..1 (as the pilot holds it) */
  throttle: number;
  /** throttle position of the afterburner detent */
  abDetent: number;
  /** engine core 0 = idle … 1 = MIL, and afterburner stage 0..1, from the flight model */
  core: number;
  abFrac: number;
  /** fuel flow the flight model asks for, kg/s */
  fuelFlow: number;
  gearPos: number;
  flapPos: number;
  /** toe brakes 0..1 */
  brakes: number;
  /** how hard the pilot is working the stick, 0..1 (hydraulic demand) */
  stick: number;
  /** battle damage, same scale as FlightModel.damage */
  damage: { engine: number; hydraulics: number; fuelLeak: number; controls?: number };
  /** angle of attack (rad), dynamic pressure (Pa) and height above the ground (m) */
  alpha?: number;
  qbar?: number;
  agl?: number;
  /** navigation truth for the inertial set: position (game metres, x east, z south), ground speed (m/s),
   *  true heading (rad) and mission clock (s) */
  x?: number;
  z?: number;
  gs?: number;
  hdg?: number;
  clock?: number;
  /** the autopilot is flying the jet */
  autopilot?: boolean;
  /** radar and stores as the fire-control displays show them */
  fc?: FireControl | null;
  /** fuel as the rest of the sim sees it (kg): refuelling and jettison write these */
  fuel: number;
  extFuel: number;
  /** external tanks carried */
  extTanks: number;
  unlimitedFuel: boolean;
}

/** What the systems give back to the flight model. Defaults (`defaultHooks`) change nothing. */
export interface FmHooks {
  /** engine is lit and self-sustaining */
  engineOn: boolean;
  /** engine rpm in percent, or null to let the flight model derive it */
  rpm: number | null;
  thrustScale: number;
  abInhibit: boolean;
  /** the systems move fuel between tanks and burn it; the flight model must not */
  ownsFuel: boolean;
  /** where the gear is being driven, and how fast (1 = normal, 0 = no power to move it) */
  gearCmd: boolean | null;
  gearRate: number;
  /** trailing-edge flap command 0..1, or null if the pilot sets flaps directly */
  flapCmd: number | null;
  /** speedbrake travel available 0..1, and whether it can move at all */
  speedbrakeMax: number;
  speedbrakeAvail: boolean;
  /** flight-control power 0..1 (hydraulics and flight-control computer) */
  controlPower: number;
  /** wheel brakes: scale on the pedals, and a set parking brake */
  brakeScale: number;
  parkingBrake: boolean;
  nws: boolean;
  /** gun drive, stores release and sensors */
  gunAvail: boolean;
  weaponsAvail: boolean;
  /** what the flight-control computer changes in the control law; null = the aircraft's normal law */
  flcs: FlcsHooks | null;
  /** the autopilot may be engaged */
  autopilotAvail: boolean;
}

export interface FireControl {
  radarMode: string; radarRangeNm: number; radarAz: number; radarOn: boolean;
  selWeapon: string; weapons: Array<{ id: string; name: string; n: number; kind: string }>; gunRounds: number; chaff: number; flares: number;
}

/** Flight-control computer state the control law follows (fly-by-wire aircraft). */
export interface FlcsHooks {
  /** AoA limit in degrees, or null for the airframe's own */
  aoaMax: number | null;
  /** positive and negative G command limits, or null */
  gMax: number | null;
  gMin: number | null;
  /** a fixed roll-rate limit in deg/s (takeoff-and-landing gains, digital backup), or null for the scheduled one */
  rollRate: number | null;
  /** scale on the scheduled roll rate (CAT III loading) */
  rollScale: number;
  /** control response against the scheduled one: 1 normal, < 1 sluggish, > 1 over-sensitive (standby gains) */
  gain: number;
  /** leading-edge flaps not following their schedule: fraction of maximum lift lost */
  liftLoss: number;
  /** manual pitch override held: the negative-G limiter is bypassed */
  mpo: boolean;
}

export const defaultHooks = (): FmHooks => ({
  engineOn: true, rpm: null, thrustScale: 1, abInhibit: false, ownsFuel: false,
  gearCmd: null, gearRate: 1, flapCmd: null, speedbrakeMax: 1, speedbrakeAvail: true,
  controlPower: 1, brakeScale: 1, parkingBrake: false, nws: true, gunAvail: true, weaponsAvail: true,
  flcs: null, autopilotAvail: true,
});

export type StartState = 'cold' | 'ground' | 'air';
export type Consumer = 'hud' | 'mfd' | 'radar' | 'rwr';

export interface ChecklistStep {
  text: string;
  done: boolean;
  /** what the pilot is waiting for, when the step is a "monitor" item */
  note?: string;
}

/** A character display in the cockpit (the F-16's DED and PFLD). */
export interface TextDisplayDef {
  id: string;
  label: string;
  panel: string;
  rows: number;
  cols: number;
}
/** Inverse-video markers inside a text-display row: text between INV_ON and INV_OFF is highlighted. */
export const INV_ON = '\u0001', INV_OFF = '\u0002';

/** One multifunction display as the avionics drive it: the format shown and the 20 option-select-button labels
 *  (index 0 = OSB 1, top left, numbered clockwise as on the real bezel). */
export interface MfdView {
  format: string;
  osb: Array<{ text: string; on?: boolean } | null>;
  /** free text lines for formats that are mostly text (TEST, FLCS, DTE, menus) */
  lines?: Array<{ text: string; x?: number; y?: number; on?: boolean; size?: number; align?: 'left' | 'center' | 'right' }>;
  /** format-specific numbers the display drawer reads (range scale, declutter, …) */
  data?: Record<string, number | string | boolean>;
}

/** A point of the flight plan as the navigation system holds it (game metres; alt m MSL). */
export interface NavPoint { name: string; x: number; z: number; alt: number; kind?: 'stpt' | 'tgt' | 'ip' | 'mark' | 'home' }

/** What the mission hands the avionics, as a data cartridge would. */
export interface MissionData {
  steerpoints: NavPoint[];
  /** game x/z → latitude/longitude in degrees */
  geo: (x: number, z: number) => { lat: number; lon: number };
  /** radio aids: TACAN channel and ILS frequency of the fields in the theatre */
  navaids: Array<{ id: string; name: string; x: number; z: number; elev: number; tacan: number; band: 'X' | 'Y'; ils: number; crs: number }>;
  bingoKg: number;
  callsign: string;
  /** seconds since midnight (zulu) at mission time 0 */
  zuluStart: number;
}

/** Navigation and fire-control state the rest of the sim reads back from the avionics. */
export interface NavState {
  /** index into `steerpoints` of the selected steerpoint */
  steer: number;
  steerpoints: NavPoint[];
  /** the inertial platform can be used (attitude, heading, steering) */
  insReady: boolean;
  /** HUD ALIGN mnemonic: '' | 'ALIGN' (steady) | 'ALIGN*' (flashing: alignment complete) */
  align: string;
  /** position error of the inertial set in metres (grows when it was taken to NAV early, or without GPS) */
  drift: number;
  masterMode: 'NAV' | 'AA' | 'AG' | 'DGFT' | 'MSL';
  masterArm: 'OFF' | 'ARM' | 'SIM';
  bingo: boolean;
  alow: number;
  /** selected TACAN / ILS station, or null */
  tacan: { name: string; bearing: number; range: number } | null;
  ils: { name: string; loc: number; gs: number; crs: number } | null;
}

/** The avionics suite of an aircraft that has one: up-front controls, displays, navigation. */
export interface Avionics {
  readonly displays: TextDisplayDef[];
  /** the rows of a text display, exactly `cols` wide; '' rows when it is unpowered */
  display(id: string): string[];
  loadMission(m: MissionData): void;
  nav(): NavState;
  /** number of multifunction displays, their state and their option-select buttons (1–20) */
  readonly mfdCount: number;
  mfd(i: number): MfdView;
  mfdPress(i: number, osb: number): void;
  /** master-mode requests from HOTAS-style keys (the ICP buttons call the same thing) */
  setMasterMode(m: NavState['masterMode']): void;
}

export interface AircraftSystems {
  /** systems type, e.g. "f16" */
  readonly type: string;
  readonly title: string;
  readonly controls: ControlDef[];
  readonly lights: LightDef[];
  readonly gauges: GaugeDef[];
  readonly hooks: FmHooks;

  /** set every switch for a cold jet, a running jet on the ground, or a jet in flight */
  init(state: StartState, env: SystemsEnv): void;
  step(dt: number, env: SystemsEnv): void;

  get(id: string): number;
  /** move a control; returns a reason when the real control would not move */
  set(id: string, pos: number): string | null;
  light(id: string): boolean;
  gauge(id: string): number;
  /** is this piece of avionics powered and switched on */
  powered(c: Consumer): boolean;
  /** fuel after this step, written back to the flight model (kg) */
  fuelState(): { internal: number; external: number };

  /** crew alerts since the last call (voice messages, switch feedback) */
  drainMessages(): Array<{ text: string; level: 'info' | 'caution' | 'warning' }>;
  /** an audible warning horn or tone is sounding */
  horn(): boolean;
  /** extra HUD warnings, most urgent first */
  hudWarnings(): string[];

  /** the procedure that applies now (start-up when the engine is off) */
  checklist(): ChecklistStep[];
  /** let the crew chief run the start-up for you */
  autoStart: boolean;
  /** avionics suite, when the aircraft has its own */
  readonly avionics?: Avionics;
}
