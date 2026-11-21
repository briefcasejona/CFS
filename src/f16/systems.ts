// The F-16's aircraft systems: electrical power, the jet fuel starter (JFS) and engine start, the emergency power
// unit (EPU), hydraulic systems A and B, the fuel feed, the parking brake, and the warning and caution lights.
//
// Source: TO 1F-16CM/AM-1 BMS (the Dash-1) only. The section numbers in the comments are that manual's. Anything
// the manual does not give is marked ASSUMED. Those values were chosen here, and nothing else should be read into
// them.
//
// The systems read the cockpit switches from the CockpitPanel (the positions of the cockpit model's controls) and
// tell the flight model whether the engine is lit. While the engine is starting or spooling down, they own the
// engine rpm. Once it is lit, the rpm follows the flight model's engine core.
//
// Controls in the cockpit model that the systems read (index 0 is the down / aft / anticlockwise position):
//   MAIN_POWER_S3  OFF / BATT / MAIN PWR                  (Dash-1 6.9)
//   JFS_S3         START 1 / OFF / START 2                (2.27)
//   ENG_FEED_K4    OFF / NORM / AFT / FWD                 (3.4, 3.5)
//   AIR_SOURCE_K4  OFF / NORM / DUMP / RAM                (5.4)
//   PBRAKE_S3      OFF / ANTI-SKID / PARKING BRAKE        (12.5)
//   Gear_Lever_S2  DN / UP
//   Master_Caution_B, WARN_RESET_S3                       (19.1, 19.3)
// The model has no EPU switch, ELEC panel, FUEL MASTER switch or ENG CONT switch. The EPU switch is taken as NORM
// (guarded, 8.1.2), FUEL MASTER as MASTER, and ENG CONT as PRI.
import type { CockpitPanel } from './cockpit/controls.js';
import type { EngineId } from './blocks.js';

export const MAIN_POWER = { OFF: 0, BATT: 1, MAIN: 2 } as const;
export const JFS = { START1: 0, OFF: 1, START2: 2 } as const;
export const ENG_FEED = { OFF: 0, NORM: 1, AFT: 2, FWD: 3 } as const;
export const AIR_SOURCE = { OFF: 0, NORM: 1, DUMP: 2, RAM: 3 } as const;
export const PBRAKE = { OFF: 0, ANTI_SKID: 1, PARK: 2 } as const;
export const GEAR = { DN: 0, UP: 1 } as const;

/** Lights on the caution light panel that the systems drive (19.4; each one's own section in brackets). */
export const CAUTIONS = ['ELEC SYS', 'FWD FUEL LOW', 'AFT FUEL LOW', 'ANTI SKID', 'EQUIP HOT', 'CABIN PRESS', 'SEC'] as const;
export type Caution = typeof CAUTIONS[number];
/** Red warning lights on the glareshield (2.42, 2.43). */
export const WARNINGS = ['ENGINE', 'HYD/OIL PRESS'] as const;
export type Warning = typeof WARNINGS[number];

/** Failures a test or the damage model can set. */
export type SysFailure = 'mainGen' | 'stbyGen' | 'hydA' | 'hydB' | 'epu' | 'battery';

const LB_PER_KG = 1 / 0.45359237;
const PPH_PER_KGS = 3600 * LB_PER_KG;

/** Engine-type numbers the Dash-1 gives separately for the Pratt & Whitney and General Electric engines. */
interface EngineNumbers {
  /** the FLCS PMG light goes off (6.9) */
  pmgRpm: number;
  /** the STBY GEN light goes off (6.9) */
  stbyRpm: number;
  /** engine rpm that keeps the EPU on bleed air (8.3: 75-85 % PW, 82-90 % GE; the middle of each range) */
  epuBleedRpm: number;
}
function engineNumbers(engine: EngineId): EngineNumbers {
  return engine.startsWith('F110')
    ? { pmgRpm: 44, stbyRpm: 60, epuBleedRpm: 86 }
    : { pmgRpm: 40, stbyRpm: 55, epuBleedRpm: 80 };
}

// ---------------------------------------------------------------- times and rates
/** the MAIN GEN light goes off about 10 s after the STBY GEN light (6.9) */
const MAIN_GEN_DELAY = 10;
/** the brake/JFS accumulators recharge in 40 s (hot) to 60 s (cold) (2.25, 7) */
const ACCUM_RECHARGE = 50;
/** JFS spooldown from governed speed takes about 17 s (2.29) */
const JFS_SPOOLDOWN = 17;
/** ASSUMED: time to governed speed. The Dash-1 only says the RUN light comes on within 30 s (2.28). */
const JFS_SPOOLUP = { one: 16, both: 10 };
/** the EPU comes up to speed in about 2 s (8.3) */
const EPU_SPOOLUP = 2;
/** hydrazine alone lasts about 10 minutes (8.3) */
const HYDRAZINE_TIME = 600;
/** ignition is continuous at 12 % rpm and above with the throttle at IDLE or above (2.24) */
const IGNITION_RPM = 12;
/** ASSUMED: the rpm the JFS motors the engine to, and the rpm to bring the throttle to IDLE at */
const MOTOR_RPM = 25;
const LIGHTOFF_RPM = 20;
/** ASSUMED: rates (%/s) of the engine motoring on the JFS, accelerating after light-off, and spooling down */
const MOTOR_RATE = 2.5, ACCEL_RATE = 1.6, SPOOLDOWN_RATE = 0.06;
/** ASSUMED: idle rpm, the flight model's engine at zero core (sim/flightModel.ts rpm) */
export const IDLE_RPM = 62;
/** ASSUMED: hydraulic pump pressure rises between these engine rpms */
const HYD_RPM = [10, 40];
/** the throttle more than about 1 inch past IDLE returns the ANTI-SKID switch from PARKING BRAKE (12.5). ASSUMED:
 *  1 inch is this much of the throttle's travel. */
const PBRAKE_THROTTLE = 0.08;
/** the caution voice message comes 7 s after a caution light, the warning message 1.5 s after a warning light (19.1) */
const VMS_CAUTION_DELAY = 7, VMS_WARNING_DELAY = 1.5;
/** ASSUMED: EQUIP HOT comes on "shortly after" AIR SOURCE OFF (5.4) */
const EQUIP_HOT_DELAY = 5;

export interface SysInput {
  /** throttle 0 (IDLE) … 1 (MAX AB). The OFF position is `throttleOff`. */
  throttle: number;
  wow: boolean;
  /** pressure altitude, m */
  altM: number;
  groundSpeed: number;
  /** internal and external fuel, kg */
  fuel: number;
  extFuel: number;
  /** the flight model's engine: core 0 (idle) … 1 (MIL), afterburner share, fuel flow kg/s */
  core: number;
  abFrac: number;
  fuelFlow: number;
  /** the damage model's engine health 0 … 1 */
  engineHealth: number;
  /** ASSUMED: rpm the airflow alone turns a dead engine to (windmilling). The Dash-1 airstart charts are not used. */
  windmillRpm: number;
}

export interface Gauges {
  rpm: number; ftit: number; oil: number; noz: number; fuelFlowPph: number;
  hydA: number; hydB: number; epuFuel: number;
  fuelFwdLb: number; fuelAftLb: number; fuelTotalLb: number;
}

export class F16Systems {
  readonly num: EngineNumbers;
  /** the throttle is in OFF (aft of the IDLE detent, 2.45) */
  throttleOff = false;
  readonly failures = new Set<SysFailure>();

  // ---- engine
  rpm = 0;
  /** combustion: from light-off on */
  burning = false;
  /** at idle or above: the flight model's engine runs */
  lit = false;
  ftit = 15; oil = 0; noz = 0;
  private oilLowTime = 0;
  private ftitHighTime = 0;

  // ---- JFS (2.25 – 2.29)
  jfsSpeed = 0;
  /** started and not yet commanded off */
  jfsOn = false;
  private jfsRate = 0;
  /** brake/JFS accumulators: 0 … 2 charged */
  accumulators = 2;

  // ---- electrical (6)
  mainGen = false; stbyGen = false;
  private stbyTime = 0;
  /** the four FLCS relays (6.7, 6.9) */
  flcsRelays = false;

  // ---- EPU (8)
  epuSpeed = 0;
  epuCommanded = false;
  hydrazine = 100;
  /** the EPU is using hydrazine (HYDRAZN light, 8.1.4) */
  epuHydrazine = false;

  // ---- hydraulics (7), psi
  hydA = 0; hydB = 0;

  // ---- fuel (3), lb: the forward and aft systems
  fuelFwd = 0; fuelAft = 0;
  private fuelInit = false;

  // ---- lights
  readonly cautions = new Set<Caution>();
  readonly warnings = new Set<Warning>();
  masterCaution = false;
  private airOffTime = 0;
  private vms: { caution: number; warning: number; cautionDone: boolean; warningDone: boolean } = { caution: 0, warning: 0, cautionDone: false, warningDone: false };
  private messages: string[] = [];
  private lastMainPower = 0;

  constructor(readonly panel: CockpitPanel, engine: EngineId) {
    this.num = engineNumbers(engine);
  }

  /** Switches and state of a jet whose engine is already running (air start, runway start, hot ramp). */
  setRunning(fuelKg: number) {
    const p = this.panel;
    p.set('MAIN_POWER', MAIN_POWER.MAIN); p.set('JFS', JFS.OFF); p.set('ENG_FEED', ENG_FEED.NORM);
    p.set('AIR_SOURCE', AIR_SOURCE.NORM); p.set('PBRAKE', PBRAKE.ANTI_SKID);
    p.drainChanges();
    this.lastMainPower = MAIN_POWER.MAIN;
    this.throttleOff = false;
    this.rpm = IDLE_RPM; this.burning = true; this.lit = true;
    this.ftit = 480; this.oil = 35; this.noz = 90;
    this.jfsSpeed = 0; this.jfsOn = false; this.accumulators = 2;
    this.mainGen = true; this.stbyGen = false; this.stbyTime = MAIN_GEN_DELAY; this.flcsRelays = true;
    this.hydA = 3000; this.hydB = 3000;
    this.splitFuel(fuelKg * LB_PER_KG);
  }

  /** Cold and dark: every switch off, the throttle in OFF, the parking brake set. */
  setCold(fuelKg: number) {
    const p = this.panel;
    p.set('MAIN_POWER', MAIN_POWER.OFF); p.set('JFS', JFS.OFF); p.set('ENG_FEED', ENG_FEED.NORM);
    p.set('AIR_SOURCE', AIR_SOURCE.NORM); p.set('PBRAKE', PBRAKE.PARK); p.set('GEAR_LEVER', GEAR.DN);
    p.drainChanges();
    this.lastMainPower = MAIN_POWER.OFF;
    this.throttleOff = true;
    this.rpm = 0; this.burning = false; this.lit = false;
    this.ftit = 15; this.oil = 0; this.noz = 0;
    this.jfsSpeed = 0; this.jfsOn = false; this.accumulators = 2;
    this.mainGen = false; this.stbyGen = false; this.stbyTime = 0; this.flcsRelays = false;
    this.hydA = 0; this.hydB = 0;
    this.splitFuel(fuelKg * LB_PER_KG);
  }

  /** The F-16C carries 0-600 lb more forward than aft (3.5): start in the middle of that. */
  private splitFuel(totalLb: number) {
    const diff = Math.min(300, totalLb);
    this.fuelFwd = (totalLb + diff) / 2;
    this.fuelAft = (totalLb - diff) / 2;
    this.fuelInit = true;
  }

  /** battery buses No. 1 and 2 (6.6): powered whenever MAIN PWR is out of OFF */
  get batteryBus() { return this.panel.get('MAIN_POWER') >= MAIN_POWER.BATT && !(this.failures.has('battery') && !this.anyGen); }
  get epuGen() { return this.epuSpeed > 0.95; }
  get anyGen() { return this.mainGen || this.stbyGen || this.epuGen; }
  /** emergency ac / dc buses: any generator (6.4 – 6.6) */
  get emergencyBus() { return this.batteryBus && this.anyGen; }
  /** essential buses: main or standby generator. The essential dc bus is off while the EPU runs (8). */
  get essentialBus() { return this.mainGen || this.stbyGen; }
  /** nonessential buses: the main generator only (6.2) */
  get nonessentialBus() { return this.mainGen; }

  /** JFS RUN light (2.28): governed speed */
  get jfsRun() { return this.batteryBus && this.jfsOn && this.jfsSpeed > 0.98; }
  /** EPU run light (8.1.3): turbine at speed and its pump above 2000 psi */
  get epuRun() { return this.batteryBus && this.epuSpeed > 0.95 && !this.failures.has('epu'); }

  // ELEC control panel lights (6.9, 6.10). The cockpit model has no ELEC panel; the lights feed ELEC SYS.
  get mainGenLight() { return this.batteryBus && !this.mainGen; }
  get stbyGenLight() { return this.batteryBus && (!this.stbyAvailable || this.panel.get('MAIN_POWER') !== MAIN_POWER.MAIN); }
  get flcsRlyLight() { return this.batteryBus && !this.flcsRelays; }
  get flcsPmgLight() { return this.batteryBus && this.flcsRelays && this.rpm < this.num.pmgRpm; }
  get acftBattToFlcsLight() { return this.batteryBus && this.flcsRelays && this.rpm < this.num.pmgRpm && !this.anyGen; }
  /** the standby generator turns whenever the ADG does, and is up to speed above the STBY GEN rpm (6.4, 6.9) */
  private get stbyAvailable() { return this.rpm >= this.num.stbyRpm && !this.failures.has('stbyGen'); }

  /** Brakes have pressure from system B or the brake/JFS accumulators (2.25). */
  get brakePressure() { return this.hydB >= 1000 || this.accumulators > 0.2; }
  /** The parking brake holds (12.5). */
  get parkingBrake() { return this.panel.get('PBRAKE') === PBRAKE.PARK && this.brakePressure; }
  /** System B retracts the gear (9). */
  get gearCanRetract() { return this.hydB >= 1000; }

  gauges(): Gauges {
    const b1 = this.batteryBus, e = this.emergencyBus;
    return {
      rpm: b1 ? this.rpm : 0,                                  // battery bus No. 1 (2.37)
      ftit: b1 ? this.ftit : 0,                                // battery bus No. 1 (2.39)
      noz: e ? this.noz : 0,                                   // emergency ac bus No. 2 (2.38)
      oil: e ? this.oil : 0,                                   // emergency ac bus No. 2 (2.41)
      fuelFlowPph: e ? this.fuelFlowPph : 0,                   // emergency ac bus No. 1 (2.40)
      hydA: e ? this.hydA : 0, hydB: e ? this.hydB : 0,        // emergency ac bus No. 2 (7.2)
      epuFuel: b1 ? this.hydrazine : 0,                        // battery bus No. 2 (8.1.7)
      fuelFwdLb: this.fuelFwd, fuelAftLb: this.fuelAft, fuelTotalLb: this.fuelFwd + this.fuelAft,
    };
  }
  fuelFlowPph = 0;

  /** Voice messages and system events since the last call (for the radio log and the sounds). */
  drainMessages(): string[] { const m = this.messages; this.messages = []; return m; }

  /** Move the throttle into or out of OFF. Only from IDLE (2.45). Returns false if the throttle is not at IDLE. */
  setThrottleOff(off: boolean, throttle: number): boolean {
    if (throttle > 0.02) return false;
    this.throttleOff = off;
    return true;
  }

  step(dt: number, inp: SysInput) {
    if (dt <= 0) return;
    const p = this.panel;
    // switch changes since the last step
    for (const ch of p.drainChanges()) {
      if (ch.id === 'MASTER_CAUTION' && ch.to === 1 && !this.cautions.has('ELEC SYS')) { this.masterCaution = false; this.vms.cautionDone = true; }
      if (ch.id === 'WARN_RESET' && ch.to === 0) this.vms.warningDone = true;
    }
    const mp = p.get('MAIN_POWER');
    // moving MAIN PWR to BATT or OFF opens the FLCS relays (6.9)
    if (mp < MAIN_POWER.MAIN && this.lastMainPower === MAIN_POWER.MAIN) this.flcsRelays = false;
    if (mp === MAIN_POWER.OFF) this.flcsRelays = false;
    this.lastMainPower = mp;

    this.stepJfs(dt, inp);
    this.stepEngine(dt, inp);
    this.stepElectrical(dt);
    this.stepHydraulics(dt);
    this.stepEpu(dt, inp);
    this.stepHydraulics(0);
    this.stepFuel(inp);
    // the parking brake lets go when the throttle is advanced (12.5)
    if (p.get('PBRAKE') === PBRAKE.PARK && !this.throttleOff && inp.throttle > PBRAKE_THROTTLE) p.set('PBRAKE', PBRAKE.ANTI_SKID);
    this.stepLights(dt, inp);
    p.drainChanges();   // our own switch moves (JFS to OFF, parking brake) are not pilot inputs
  }

  // ---------------------------------------------------------------- JFS (2.25 – 2.29)
  private stepJfs(dt: number, inp: SysInput) {
    const p = this.panel;
    const sw = p.get('JFS');
    if (sw !== JFS.OFF && !this.jfsOn) {
      // a start: the accumulators drive the hydraulic start motor; it needs the battery buses (Emergency Power
      // Distribution: JFS on battery bus No. 1) and cannot re-engage until the JFS has spooled down (2.29)
      const need = sw === JFS.START2 ? 2 : 1;
      if (this.batteryBus && this.accumulators >= 0.99 && this.jfsSpeed < 0.05) {
        const used = Math.min(need, Math.floor(this.accumulators + 1e-6));
        this.accumulators -= used;
        this.jfsOn = true;
        this.jfsRate = 1 / (used >= 2 ? JFS_SPOOLUP.both : JFS_SPOOLUP.one);
        // a JFS start closes the FLCS relays (6.7, 6.9)
        this.flcsRelays = true;
      }
    }
    if (sw === JFS.OFF && this.jfsOn) this.jfsOn = false;
    if (this.jfsOn) this.jfsSpeed = Math.min(1, this.jfsSpeed + this.jfsRate * dt);
    else this.jfsSpeed = Math.max(0, this.jfsSpeed - dt / JFS_SPOOLDOWN);
    // on a ground start the JFS switch returns to OFF at 50 % rpm and the JFS shuts down (2.27, 2.29)
    if (this.jfsOn && inp.wow && this.rpm >= 50) { p.set('JFS', JFS.OFF); this.jfsOn = false; }
    // the accumulators recharge from system B: on the ground once the engine is past 12 % rpm, in flight from 70 %
    // JFS speed (2.29, 7)
    const charging = this.hydB >= 1000 && (this.rpm >= IGNITION_RPM || (!inp.wow && this.jfsSpeed >= 0.7));
    if (charging) this.accumulators = Math.min(2, this.accumulators + 2 * dt / ACCUM_RECHARGE);
  }

  // ---------------------------------------------------------------- engine
  private stepEngine(dt: number, inp: SysInput) {
    const fuel = inp.fuel + inp.extFuel > 0;
    const healthy = inp.engineHealth > 0.05;
    // the throttle in OFF ends ignition and fuel flow (2.45); no fuel or a dead engine flames out
    if (this.throttleOff || !fuel || !healthy) { this.burning = false; this.lit = false; }
    // light-off: ignition at 12 % rpm and up with the throttle at IDLE (2.24). The throttle is brought to IDLE at
    // LIGHTOFF_RPM in a normal start (ASSUMED).
    if (!this.burning && !this.throttleOff && fuel && healthy && this.rpm >= LIGHTOFF_RPM) this.burning = true;
    const jfsTorque = this.jfsSpeed > 0.9;
    if (this.lit) {
      // at idle and above: the flight model's engine sets the rpm (sim/flightModel.ts)
      this.rpm = IDLE_RPM + 38 * inp.core + 3 * inp.abFrac;
    } else if (this.burning) {
      this.rpm += (ACCEL_RATE + (jfsTorque ? 0.5 : 0)) * dt;
      if (this.rpm >= IDLE_RPM) { this.rpm = IDLE_RPM; this.lit = true; }
    } else {
      const floor = Math.max(jfsTorque ? MOTOR_RPM : 0, inp.windmillRpm);
      if (this.rpm < floor) this.rpm = Math.min(floor, this.rpm + MOTOR_RATE * dt);
      else this.rpm = Math.max(floor, this.rpm - (this.rpm * SPOOLDOWN_RATE + 0.3) * dt);
    }
    // ASSUMED gauge behaviour: FTIT, oil pressure and nozzle position (the Dash-1 gives the ranges and limits, not
    // the values at each power setting)
    const ftitTarget = this.lit ? 480 + 370 * inp.core + 60 * inp.abFrac : this.burning ? 640 : 15;
    this.ftit += (ftitTarget - this.ftit) * Math.min(1, dt * (this.burning ? 0.5 : 0.05));
    const oilTarget = Math.min(55, this.rpm * 0.6);
    this.oil += (oilTarget - this.oil) * Math.min(1, dt * 1.5);
    const nozTarget = !this.lit ? 0 : inp.abFrac > 0 ? 25 + 75 * inp.abFrac : inp.wow && inp.core < 0.05 ? 90 : 80 * (1 - inp.core);
    this.noz += (nozTarget - this.noz) * Math.min(1, dt * 1.2);
    this.fuelFlowPph = this.lit ? inp.fuelFlow * PPH_PER_KGS : this.burning ? 900 + 30 * this.rpm : 0;
  }

  // ---------------------------------------------------------------- electrical (6)
  private stepElectrical(dt: number) {
    const mainPwr = this.panel.get('MAIN_POWER') === MAIN_POWER.MAIN;
    // the standby generator comes online above the STBY GEN rpm when the main generator is not supplying power, as
    // long as MAIN PWR is in MAIN PWR (6.4); the main generator follows about 10 s later (6.9)
    if (this.stbyAvailable && mainPwr) this.stbyTime += dt; else this.stbyTime = 0;
    this.mainGen = mainPwr && this.stbyTime >= MAIN_GEN_DELAY && !this.failures.has('mainGen');
    this.stbyGen = mainPwr && this.stbyAvailable && !this.mainGen;
  }

  // ---------------------------------------------------------------- hydraulics (7)
  private stepHydraulics(dt: number) {
    void dt;
    // two pumps on the ADG, which turns with the engine (2.22, 7)
    const k = Math.max(0, Math.min(1, (this.rpm - HYD_RPM[0]) / (HYD_RPM[1] - HYD_RPM[0])));
    this.hydA = this.failures.has('hydA') ? 0 : 3000 * k;
    this.hydB = this.failures.has('hydB') ? 0 : 3000 * k;
    // the EPU's pump supplies system A (7, 8)
    if (this.epuRun) this.hydA = Math.max(this.hydA, 3000);
  }

  // ---------------------------------------------------------------- EPU (8)
  private stepEpu(dt: number, inp: SysInput) {
    // automatic start for a main and standby generator failure or both hydraulic systems below 1000 psi (8, 8.3);
    // it needs the battery buses. With weight on wheels the EPU safety pin is taken as installed (8.1.1, ASSUMED:
    // the ground crew pulls it at the end of the runway), so it never runs on the ground.
    const genFail = !this.mainGen && !this.stbyGen;
    const hydFail = this.hydA < 1000 && this.hydB < 1000;
    this.epuCommanded = !inp.wow && this.batteryBus && (genFail || hydFail);
    const canRun = this.epuCommanded && !this.failures.has('epu') && (this.hydrazine > 0 || this.rpm >= this.num.epuBleedRpm);
    this.epuSpeed = canRun ? Math.min(1, this.epuSpeed + dt / EPU_SPOOLUP) : Math.max(0, this.epuSpeed - dt / EPU_SPOOLUP);
    // bleed air keeps it running above the bleed rpm; below that, and at every start, hydrazine (8, 8.3)
    this.epuHydrazine = this.epuCommanded && (this.epuSpeed < 0.95 || this.rpm < this.num.epuBleedRpm);
    if (this.epuHydrazine && this.epuSpeed > 0) this.hydrazine = Math.max(0, this.hydrazine - 100 * dt / HYDRAZINE_TIME);
  }

  // ---------------------------------------------------------------- fuel (3)
  private stepFuel(inp: SysInput) {
    const total = inp.fuel * LB_PER_KG;
    if (!this.fuelInit) this.splitFuel(total);
    const was = this.fuelFwd + this.fuelAft;
    const d = was - total;
    if (d > 0) {
      // the fuel flow proportioner takes equal amounts from both reservoirs (3.4); ENG FEED FWD or AFT feeds from one
      // system to correct an imbalance (3.5)
      const feed = this.panel.get('ENG_FEED');
      let fromFwd = feed === ENG_FEED.FWD ? d : feed === ENG_FEED.AFT ? 0 : d / 2;
      let fromAft = d - fromFwd;
      if (fromFwd > this.fuelFwd) { fromAft += fromFwd - this.fuelFwd; fromFwd = this.fuelFwd; }
      if (fromAft > this.fuelAft) { fromFwd += fromAft - this.fuelAft; fromAft = this.fuelAft; }
      this.fuelFwd = Math.max(0, this.fuelFwd - fromFwd);
      this.fuelAft = Math.max(0, this.fuelAft - fromAft);
    } else if (d < 0) {
      // fuel added (refuelling or external transfer): to both systems alike (3.2)
      this.fuelFwd -= d / 2; this.fuelAft -= d / 2;
    }
  }

  // ---------------------------------------------------------------- lights (2.42, 2.43, 3.7, 5.4 – 5.7, 6.9, 12.6, 19)
  private stepLights(dt: number, inp: SysInput) {
    const b = this.batteryBus, e = this.emergencyBus, p = this.panel;
    const before = new Set(this.cautions);
    this.cautions.clear();
    const set = (c: Caution, on: boolean) => { if (on) this.cautions.add(c); };
    // ELEC SYS with any ELEC panel light (6.9); battery bus No. 2
    set('ELEC SYS', b && (this.mainGenLight || this.stbyGenLight || this.flcsRlyLight || this.flcsPmgLight || this.acftBattToFlcsLight));
    // reservoir fuel low: forward below 400 lb, aft below 250 lb (3.7); emergency dc bus No. 1. ASSUMED: the
    // reservoirs are the last fuel of each system, so the system totals stand in for them.
    set('FWD FUEL LOW', e && this.fuelFwd < 400);
    set('AFT FUEL LOW', e && this.fuelAft < 250);
    // ANTI SKID: the gear handle down with the ANTI-SKID switch in OFF (12.6); battery bus No. 2
    set('ANTI SKID', b && p.get('GEAR_LEVER') === GEAR.DN && p.get('PBRAKE') === PBRAKE.OFF);
    // EQUIP HOT shortly after AIR SOURCE OFF (5.4). ASSUMED: RAM too ("most functions are lost", 5), with the engine
    // running (no cooling air is needed with the jet shut down).
    const air = p.get('AIR_SOURCE');
    const noCooling = (air === AIR_SOURCE.OFF || air === AIR_SOURCE.RAM) && this.lit;
    this.airOffTime = noCooling ? this.airOffTime + dt : 0;
    set('EQUIP HOT', e && this.airOffTime > EQUIP_HOT_DELAY);
    // CABIN PRESS: cockpit pressure altitude above 27 000 ft (5.7). ASSUMED: without pressurization (AIR SOURCE out of
    // NORM, or no bleed air) the cockpit is at the outside pressure altitude.
    const pressurized = air === AIR_SOURCE.NORM && this.lit;
    set('CABIN PRESS', e && !pressurized && inp.altM > 27000 * 0.3048);
    // SEC: the engine in SEC or low main fuel pump pressure (2.34). The model has no ENG CONT switch: never on.
    set('SEC', false);

    // MASTER CAUTION: a new caution light lights it; it stays on while a caution light is on unless reset (19.3)
    for (const c of this.cautions) if (!before.has(c)) { this.masterCaution = true; this.vms.caution = 0; this.vms.cautionDone = false; }
    if (!this.cautions.size) this.masterCaution = false;
    if (!b) this.masterCaution = false;   // battery bus No. 1

    // warnings (battery bus No. 1)
    const wasWarn = this.warnings.size;
    this.warnings.clear();
    // ENGINE: rpm below 55 % (sub-idle), or FTIT above 1000 °C for about 2 s (2.43)
    this.ftitHighTime = this.ftit > 1000 ? this.ftitHighTime + dt : 0;
    if (b && (this.rpm < 55 || this.ftitHighTime > 2)) this.warnings.add('ENGINE');
    // HYD/OIL PRESS: system A or B below 1000 psi, or oil below 10 psi for 30 s; the oil part goes out above 20 psi (2.42)
    if (this.oil < 10) this.oilLowTime += dt; else if (this.oil > 20) this.oilLowTime = 0;
    if (b && (this.hydA < 1000 || this.hydB < 1000 || this.oilLowTime > 30)) this.warnings.add('HYD/OIL PRESS');
    if (this.warnings.size > wasWarn) { this.vms.warning = 0; this.vms.warningDone = false; }

    // the voice message system does not work with weight on wheels (19.1)
    if (!inp.wow && b) {
      if (this.warnings.size && !this.vms.warningDone) {
        this.vms.warning += dt;
        if (this.vms.warning >= VMS_WARNING_DELAY) { this.messages.push('WARNING, WARNING'); this.vms.warningDone = true; }
      }
      if (this.masterCaution && !this.vms.cautionDone) {
        this.vms.caution += dt;
        if (this.vms.caution >= VMS_CAUTION_DELAY) { this.messages.push('CAUTION, CAUTION'); this.vms.cautionDone = true; }
      }
    }
  }

  /** One line for the systems strip: the lights that are on. */
  lightsText(): string {
    const w = [...this.warnings], c = [...this.cautions];
    const parts: string[] = [];
    if (w.length) parts.push(w.join(' · '));
    if (this.masterCaution) parts.push('MASTER CAUTION');
    if (c.length) parts.push(c.join(' · '));
    if (this.jfsRun) parts.push('JFS RUN');
    if (this.epuRun) parts.push('EPU RUN');
    return parts.join('  |  ');
  }
}
