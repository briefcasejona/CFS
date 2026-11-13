// F-16C/D aircraft systems, after TO 1F-16CM/AM-1 (BMS): engine and jet fuel starter (section 2), fuel (3),
// environmental control (5), electrical (6), hydraulic (7), emergency power unit (8), landing gear (9),
// nosewheel steering, brakes, speedbrakes and flaps (10–15) and the warning / caution lights (19).
// Section numbers in the comments refer to that manual. The numbers the manual gives are used as they are;
// where it gives none (spool rates, tank split) the values are estimates and are marked as such.
import { approach, clamp, smoothstep } from '../../core/math.js';
import type { AircraftDef } from '../../aircraft/types.js';
import {
  defaultHooks, type AircraftSystems, type ChecklistStep, type Consumer, type FmHooks, type StartState, type SystemsEnv,
} from '../types.js';
import { F16_CONTROLS, F16_GAUGES, F16_LIGHTS } from './panels.js';

const LB = 0.45359237;
const KT = 0.514444;
const FT = 0.3048;
const PPH = 3600 / LB;          // kg/s → lb/h

/** Engine-family differences the manual calls out (PW220/229 against GE100/129). */
interface EngineParams {
  idle: number; mil: number;
  /** rpm at which the FLCS PMG carries the flight controls (6.9) */
  flcsPmg: number;
  /** rpm at which the standby generator comes on line; the main generator follows 10 s later (6.9) */
  stbyGen: number;
  /** rpm needed to run the EPU on bleed air alone (8.3) */
  epuBleed: number;
  /** FTIT that makes it a hot start (38.3.2) */
  startLimit: number;
  ftitIdle: number; ftitMil: number; ftitStart: number;
}
const PW: EngineParams = { idle: 70, mil: 93, flcsPmg: 40, stbyGen: 55, epuBleed: 80, startLimit: 680, ftitIdle: 510, ftitMil: 925, ftitStart: 610 };
const GE: EngineParams = { idle: 72, mil: 97, flcsPmg: 44, stbyGen: 60, epuBleed: 86, startLimit: 935, ftitIdle: 560, ftitMil: 900, ftitStart: 720 };

type TankId = 'lw' | 'rw' | 'f' | 'a' | 'fr' | 'ar' | 'el' | 'er' | 'ec';
const INTERNAL: TankId[] = ['fr', 'ar', 'f', 'a', 'rw', 'lw'];
const EXTERNAL: TankId[] = ['ec', 'el', 'er'];
/** Share of internal fuel per tank (estimate): two wing tanks, forward fuselage (F-1 + F-2), aft fuselage (A-1)
 *  and the two reservoirs. It leaves the forward system about 350 lb heavier than the aft, inside the 0–600 lb
 *  the manual calls normal for the C model (3.5). */
const SPLIT: Record<string, number> = { lw: 0.075, rw: 0.075, f: 0.385, a: 0.335, fr: 0.065, ar: 0.065 };

interface Msg { text: string; level: 'info' | 'caution' | 'warning' }

export class F16Systems implements AircraftSystems {
  readonly type = 'f16';
  readonly title: string;
  readonly controls = F16_CONTROLS;
  readonly lights = F16_LIGHTS;
  readonly gauges = F16_GAUGES;
  readonly hooks: FmHooks = defaultHooks();
  autoStart = false;

  readonly p: EngineParams;
  private readonly def: AircraftDef;
  private sw: Record<string, number> = {};
  private lit: Record<string, boolean> = {};
  private msgs: Msg[] = [];
  private env!: SystemsEnv;
  private time = 0;

  elec = { battery: 1, mainGen: false, stbyGen: false, genTimer: 0, relays: false, pmg: false, faultAck: 0, fault: 0 };
  bus = { batt: false, emerg: false, ess: false, nonEss: false, flcs: false };
  jfs = { on: false, speed: 0, accum: [1, 1] };
  eng = { n2: 0, lit: false, running: false, hot: false, lightTimer: 0, hotTimer: 0, ftit: 15, oil: 0, nozzle: 0, sec: false, valve: 1, health: 1, oilLow: 0, overTemp: 0, negG: 0, starved: false };
  hyd = { a: 0, b: 0, accum: 1 };
  epu = { commanded: false, latched: false, speed: 0, hydrazine: 100, armedSinceWow: false, usingHydrazine: false, test: false };
  tank: Record<TankId, number> = { lw: 0, rw: 0, f: 0, a: 0, fr: 0, ar: 0, el: 0, er: 0, ec: 0 };
  cap: Record<TankId, number> = { lw: 0, rw: 0, f: 0, a: 0, fr: 0, ar: 0, el: 0, er: 0, ec: 0 };
  fuelSys = { lastInt: 0, lastExt: 0, tanks: -1, fwdTransfer: false, trapped: 0, pressurized: false };
  gear = { altUsed: false, hornSilenced: false, horn: false, flapCmd: 0 };
  ecs = { cabinAlt: 0, hot: 0 };
  private caution = { ack: new Set<string>(), master: false, cautionT: -1, warnT: -1, warnSaid: new Set<string>() };
  private auto = { wait: 0 };

  constructor(def: AircraftDef) {
    this.def = def;
    this.title = def.name;
    this.p = /F100/.test(def.engine.name) ? PW : GE;
    for (const c of this.controls) this.sw[c.id] = c.hot;
    for (const k of INTERNAL) this.cap[k] = def.fuelInternal * SPLIT[k];
  }

  // ------------------------------------------------------------------ set-up
  init(state: StartState, env: SystemsEnv) {
    this.env = env;
    const cold = state === 'cold';
    for (const c of this.controls) this.sw[c.id] = cold ? c.cold : c.hot;
    this.sw.lgHandle = env.gearPos > 0.5 || env.wow ? 1 : 0;
    const e = this.eng;
    e.lit = e.running = !cold;
    e.n2 = cold ? 0 : this.p.idle + (this.p.mil - this.p.idle) * env.core;
    e.ftit = cold ? 15 : this.p.ftitIdle;
    e.oil = cold ? 0 : 40;
    e.valve = this.sw.fuelMaster;
    e.hot = false; e.health = 1; e.starved = false;
    this.elec.mainGen = this.elec.stbyGen = this.elec.relays = this.elec.pmg = !cold;
    this.elec.genTimer = cold ? 0 : 10;
    this.elec.battery = 1;
    this.hyd.a = this.hyd.b = cold ? 0 : 3000;
    this.hyd.accum = 1;
    this.jfs = { on: false, speed: 0, accum: [1, 1] };
    this.epu = { commanded: false, latched: false, speed: 0, hydrazine: 100, armedSinceWow: !cold, usingHydrazine: false, test: false };
    this.fuelSys.tanks = -1;
    for (const id of [...INTERNAL, ...EXTERNAL]) this.tank[id] = 0;
    this.fuelSys.lastInt = this.fuelSys.lastExt = -1;
    this.syncFuel(env);
    this.ecs.cabinAlt = this.cabinTarget(env);
    this.autoStart = false;
    this.computeBuses();
    this.updateHooks(0, env);
    this.updateLights(0, env);
    // a jet that starts with everything running has nothing to announce
    this.caution.ack = new Set(this.lights.filter((l) => l.kind === 'caution' && this.lit[l.id]).map((l) => l.id));
    this.caution.master = false;
    this.caution.warnSaid = new Set(this.lights.filter((l) => l.kind === 'warning' && this.lit[l.id]).map((l) => l.id));
    this.elec.faultAck = this.elec.fault;
    this.lit.elecSys = false;
    this.msgs = [];
  }

  // ------------------------------------------------------------------ controls
  get(id: string) { return this.sw[id] ?? 0; }

  set(id: string, pos: number): string | null {
    const c = this.controls.find((x) => x.id === id);
    if (!c) return `No such control: ${id}`;
    pos = clamp(Math.round(pos), 0, c.positions.length - 1);
    const was = this.sw[id];
    if (pos === was) return null;
    const env = this.env;
    switch (id) {
      case 'lgHandle':
        // 9.3: the handle is locked down with weight on the left main gear
        if (pos === 0 && env.wow) return 'LG handle is locked down: weight on wheels.';
        break;
      case 'throttleCutoff':
        if (pos === 0 && env.throttle > 0.06) return 'Retard the throttle to IDLE before lifting it over the cutoff.';
        break;
      case 'jfs':
        if (pos > 0) {
          const why = this.startJfs(pos);
          if (why) return why;
        } else this.jfs.on = false;
        break;
      case 'mainPwr':
        // 6.9: taking MAIN PWR out of MAIN PWR opens the FLCS relays
        if (pos < 2) this.elec.relays = false;
        break;
      case 'flcsPwrTest':
        // on battery alone the relays close for the test but do not latch (6.9)
        if (pos === 0 && this.sw.mainPwr === 1 && !this.jfs.on && !this.eng.lit) this.elec.relays = false;
        break;
      case 'altGear':
        if (pos === 1 && !this.gear.altUsed) {
          this.gear.altUsed = true;
          this.say('Alternate gear extension: pneumatic bottle discharged. No nosewheel steering.', 'caution');
        }
        break;
      case 'hornSilencer': if (pos === 1) this.gear.hornSilenced = true; break;
      case 'masterCaution':
        // 19.3: resets everything except a master caution that the ELEC SYS light is holding on
        if (pos === 1) for (const l of this.lights) if (l.kind === 'caution' && l.id !== 'elecSys' && this.lit[l.id]) this.caution.ack.add(l.id);
        break;
      case 'elecReset':
        if (pos === 1) { this.elec.faultAck = this.elec.fault; this.caution.ack.add('elecSys'); }
        break;
      case 'epu':
        if (pos === 0 && (env.wow || this.elec.mainGen || this.elec.stbyGen)) this.epu.latched = false;
        break;
    }
    this.sw[id] = pos;
    return null;
  }

  /** 2.25–2.29: the JFS is spun by one or both brake/JFS accumulators. */
  private startJfs(mode: number): string | null {
    if (!this.bus.batt) return 'JFS: no battery power (MAIN PWR is OFF).';
    if (this.jfs.speed > 0.02) return 'JFS has not spooled down yet (about 17 s).';
    const j = this.jfs;
    const charge = mode === 2 ? Math.max(j.accum[0], j.accum[1]) : j.accum[0];
    if (mode === 2) j.accum[0] = j.accum[1] = 0; else j.accum[0] = 0;
    if (charge < 0.9) {
      this.say('JFS did not start: brake/JFS accumulators are not charged.', 'caution');
      return 'JFS: accumulators discharged. They recharge from hydraulic system B with the engine turning.';
    }
    j.on = true;
    // 6.9: starting the JFS closes the FLCS relays
    this.elec.relays = true;
    return null;
  }

  // ------------------------------------------------------------------ step
  step(dt: number, env: SystemsEnv) {
    this.env = env;
    this.time += dt;
    this.syncFuel(env);
    if (this.autoStart) this.runAutoStart(dt);
    // releasing the throttle past idle releases the parking brake (12.5)
    if (this.sw.antiSkid === 2 && env.throttle > 0.12) { this.sw.antiSkid = 1; this.say('Parking brake released.', 'info'); }
    this.stepEngine(dt, env);
    this.stepElectrical(dt, env);
    this.stepEpu(dt, env);
    this.computeBuses();
    this.stepHydraulics(dt, env);
    this.stepFuel(dt, env);
    this.stepGear(dt, env);
    this.stepEcs(dt, env);
    this.updateHooks(dt, env);
    this.updateLights(dt, env);
    this.stepAlerts(dt, env);
  }

  // ------------------------------------------------------------------ engine (section 2)
  private stepEngine(dt: number, env: SystemsEnv) {
    const e = this.eng, P = this.p, j = this.jfs;
    // JFS: governed speed inside 30 s (2.28), spools down in about 17 s (2.29)
    if (j.on) j.speed = Math.min(1, j.speed + dt / 20);
    else j.speed = Math.max(0, j.speed - dt / 17);
    if (j.on && env.wow && e.n2 >= 50) { j.on = false; this.sw.jfs = 0; }
    if (!j.on && this.sw.jfs !== 0) this.sw.jfs = 0;

    // main fuel shutoff valve: 2–4 s travel (3.4)
    e.valve = approach(e.valve, this.sw.fuelMaster, 1 / 3, dt);
    // negative g: the reservoirs feed for 30 s at MIL or below, 10 s in afterburner (34.6)
    if (env.nz < -0.1 && !env.wow) e.negG += dt * (env.abFrac > 0.1 ? 3 : 1); else e.negG = Math.max(0, e.negG - dt * 3);
    const feed = e.valve > 0.5 && !e.starved && e.negG < 30;
    const throttleOn = this.sw.throttleCutoff === 1;
    // 2.24: ignition is continuous with the throttle at or above IDLE and 12 % rpm or more
    const ignition = throttleOn && e.n2 >= 12;
    // a windmilling engine turns at roughly 12 % at 250 kt: just enough for ignition, not for hydraulics (estimate)
    const windmill = env.wow ? 0 : clamp(env.ias / KT / 450 * 22, 0, 25);
    const jfsDrive = j.speed >= 1 ? 25 : 0;

    if (e.lit && (!throttleOn || !feed || env.damage.engine <= 0.02)) {
      if (throttleOn && e.running) this.say(e.starved ? 'Engine flameout: fuel starvation.' : 'Engine flameout.', 'warning');
      e.lit = e.running = false;
      e.hot = false;
    }
    if (!e.lit) {
      if (ignition && feed && env.damage.engine > 0.02) {
        e.lightTimer += dt;
        if (e.lightTimer > 2) {
          e.lit = true;
          // lighting off below about 20 % rpm on the ground over-fuels the engine: a hot start (38.3.2)
          e.hot = env.wow && e.n2 < 18;
          e.hotTimer = 0;
        }
      } else e.lightTimer = 0;
      const drive = Math.max(jfsDrive, windmill);
      if (e.n2 < drive) e.n2 = Math.min(drive, e.n2 + 1.6 * dt);
      else e.n2 = Math.max(drive, e.n2 - (0.05 * e.n2 + 0.8) * dt);
    } else if (!e.running) {
      // light-off to idle; without the JFS (or airflow) to help below 30 % the start hangs
      const helped = jfsDrive > 0 || windmill >= 12 || e.n2 >= 30;
      const accel = !helped ? -0.6 : e.hot ? 0.7 : 0.9 + 0.045 * e.n2;
      e.n2 = Math.max(0, e.n2 + accel * dt);
      if (e.n2 >= P.idle - 0.5) { e.running = true; e.hot = false; }
      if (e.n2 < 10) { e.lit = false; }
    } else {
      e.n2 = P.idle + (P.mil - P.idle) * Math.pow(clamp(env.core, 0, 1), 0.8) + 0.5 * env.abFrac;
    }

    // SEC: selected by the pilot, or by the DEEC after a major fault (2.6, 2.46.4)
    e.sec = this.sw.engCont === 1 || (env.damage.engine < 0.7 && env.damage.engine > 0.02);

    // FTIT
    let ftit = 15;
    if (e.running) ftit = P.ftitIdle + (P.ftitMil - P.ftitIdle) * Math.pow(clamp(env.core, 0, 1), 1.2) + 10 * env.abFrac;
    else if (e.lit) ftit = e.hot || (e.n2 < 30 && jfsDrive === 0 && windmill < 12) ? P.startLimit + 170 : P.ftitStart;
    e.ftit += (ftit - e.ftit) * Math.min(1, dt / (e.lit ? 3.5 : 30));
    if (e.lit && !e.running && e.ftit > P.startLimit) {
      if (e.hotTimer === 0) this.say(`Hot start: FTIT over ${P.startLimit} °C. Throttle OFF.`, 'warning');
      e.hotTimer += dt;
      // every second over the limit costs turbine life
      e.health = Math.max(0.4, e.health - dt * 0.02);
    }
    // oil pressure follows rpm, about 15 psi more at MIL than at idle (2.17)
    const oil = e.n2 <= 1 ? 0 : clamp(8 + e.n2 * 0.45, 0, 45) + (e.running ? 15 * env.core : 0);
    e.oil += (oil - e.oil) * Math.min(1, dt / 1.5);
    // nozzle: wide open at idle with the LG handle down, near closed otherwise, open again in afterburner (2.15)
    let noz = 0;
    if (!e.sec) {
      const idleArea = this.sw.lgHandle === 1 ? 82 : 12;
      noz = idleArea + (8 - idleArea) * smoothstep(0, 0.55, env.core);
      if (env.abFrac > 0) noz = 25 + 65 * env.abFrac;
    }
    e.nozzle = approach(e.nozzle, e.running || e.lit ? noz : e.nozzle, 60, dt);
  }

  // ------------------------------------------------------------------ electrical (section 6)
  private stepElectrical(dt: number, env: SystemsEnv) {
    const el = this.elec, P = this.p, n2 = this.eng.n2;
    const mainPwr = this.sw.mainPwr === 2;
    // both generators and the FLCS PMG hang off the accessory gearbox, which turns with the engine
    const stby = mainPwr && n2 >= P.stbyGen - (el.stbyGen ? 4 : 0);
    el.genTimer = stby ? el.genTimer + dt : 0;
    el.stbyGen = stby;
    el.mainGen = stby && el.genTimer >= 10;
    el.pmg = n2 >= P.flcsPmg;
    // FLCS PWR TEST closes the relays; they latch if MAIN PWR is selected (6.9)
    if (this.sw.flcsPwrTest === 1 && this.sw.mainPwr >= 1) el.relays = true;
    const gen = el.mainGen || el.stbyGen || this.epu.speed > 0.95;
    if (gen) { if (el.mainGen || el.stbyGen) el.battery = Math.min(1, el.battery + dt / 600); }
    else if (this.sw.mainPwr >= 1) {
      // battery alone: roughly half an hour of bus loads, far less while it also carries the flight controls
      const flcsLoad = el.relays && !el.pmg ? 1 / 700 : 0;
      el.battery = Math.max(0, el.battery - dt * (1 / 1800 + flcsLoad));
    }
    void env;
  }

  private computeBuses() {
    const el = this.elec, b = this.bus;
    const epuGen = this.epu.speed > 0.95;
    const on = this.sw.mainPwr >= 1;
    b.batt = on && (el.mainGen || el.stbyGen || epuGen || el.battery > 0.02);
    b.emerg = el.mainGen || el.stbyGen || epuGen;
    b.ess = el.mainGen || el.stbyGen;
    b.nonEss = el.mainGen;
    // 6.7: FLCS PMG, any generator, the EPU PMG, or the battery through the FLCS relays
    b.flcs = el.pmg || b.emerg || (on && el.relays && el.battery > 0.02);
  }

  // ------------------------------------------------------------------ EPU (section 8)
  private stepEpu(dt: number, env: SystemsEnv) {
    const u = this.epu, e = this.eng;
    const pos = this.sw.epu;
    if (env.wow) u.armedSinceWow = pos >= 1;
    else if (pos >= 1) u.armedSinceWow = true;
    const gensOut = !this.elec.mainGen && !this.elec.stbyGen;
    const hydOut = this.hyd.a < 1000 && this.hyd.b < 1000;
    // no automatic start during a shutdown on the ground (throttle OFF with weight on wheels)
    const inhibit = env.wow && this.sw.throttleCutoff === 0;
    const armed = pos === 1 || (pos === 0 && !env.wow && u.armedSinceWow && gensOut);
    if (armed && (gensOut || hydOut) && !inhibit && this.bus.batt && !u.latched) {
      u.latched = true;
      this.say('EPU running.', 'caution');
    }
    if (pos === 0 && (env.wow || !gensOut)) u.latched = false;
    u.test = this.sw.epuGenTest === 1 && env.wow && !u.latched && pos !== 2;
    u.commanded = (pos === 2 || u.latched || u.test) && (this.bus.batt || u.speed > 0.5);
    // bleed air keeps it turning above about 80 % rpm; below that hydrazine makes up the difference (8.3)
    const bleed = e.running ? clamp((e.n2 - (this.p.epuBleed - 12)) / 12, 0, 1) : 0;
    const need = u.commanded ? 1 - bleed : 0;
    u.usingHydrazine = need > 0.02 && !u.test && u.hydrazine > 0;
    const power = u.commanded ? bleed + (u.usingHydrazine ? need : 0) : 0;
    if (u.usingHydrazine) {
      // about 10 minutes on hydrazine alone, less with a lot of control movement
      u.hydrazine = Math.max(0, u.hydrazine - dt * need * (100 / 600) * (1 + 1.5 * env.stick));
      if (u.hydrazine === 0) this.say('EPU fuel exhausted.', 'warning');
    }
    // about 2 s to come up to speed
    u.speed = approach(u.speed, power > 0.9 ? 1 : 0, power > 0.9 ? 0.5 : 0.25, dt);
  }

  // ------------------------------------------------------------------ hydraulics (section 7)
  private stepHydraulics(dt: number, env: SystemsEnv) {
    const h = this.hyd, n2 = this.eng.n2;
    const pump = 3000 * smoothstep(10, 30, n2);
    // battle damage takes system B first, then A
    const bOk = clamp((env.damage.hydraulics - 0.5) / 0.3, 0, 1);
    const aOk = clamp((env.damage.hydraulics - 0.2) / 0.3, 0, 1);
    let a = pump * aOk;
    // the EPU pump feeds system A (7, 8)
    if (aOk > 0) a = Math.max(a, 3000 * this.epu.speed);
    h.a += (a - h.a) * Math.min(1, dt / 0.8);
    h.b += (pump * bOk - h.b) * Math.min(1, dt / 0.8);
    // FLCS accumulators carry the controls for a few seconds while the EPU comes up
    if (h.a >= 1000 || h.b >= 1000) h.accum = Math.min(1, h.accum + dt / 5);
    else h.accum = Math.max(0, h.accum - dt * (0.04 + 0.5 * env.stick));
    // brake/JFS accumulators: recharged by system B once the engine is past 12 % rpm, in 40–60 s (7)
    const j = this.jfs;
    for (let i = 0; i < 2; i++) {
      if (h.b >= 2000 && n2 >= 12 && !j.on) j.accum[i] = Math.min(1, j.accum[i] + dt / 50);
    }
    // toe brakes without system B bleed the accumulators down in about 75 s (11)
    if (h.b < 1000 && env.brakes > 0.05 && env.wow) {
      for (let i = 0; i < 2; i++) j.accum[i] = Math.max(0, j.accum[i] - dt * env.brakes / 75);
    }
  }

  // ------------------------------------------------------------------ fuel (section 3)
  /** Pick up fuel changes made by the rest of the sim: tanker, mission set-up, jettisoned tanks. */
  private syncFuel(env: SystemsEnv) {
    const fs = this.fuelSys, t = this.tank, c = this.cap;
    if (fs.tanks !== env.extTanks) {
      // one tank hangs on the centerline, two on the wings, three on all stations
      const per = this.def.pylonFuel;
      c.ec = env.extTanks === 1 || env.extTanks >= 3 ? per : 0;
      c.el = c.er = env.extTanks >= 2 ? per : 0;
      const capExt = c.ec + c.el + c.er;
      const k = capExt > 0 ? clamp(env.extFuel / capExt, 0, 1) : 0;
      for (const id of EXTERNAL) t[id] = c[id] * k;
      fs.tanks = env.extTanks;
      fs.lastExt = env.extFuel;
    }
    if (Math.abs(env.fuel - fs.lastInt) > 0.5) {
      let d = env.fuel - (fs.lastInt < 0 ? 0 : this.sum(INTERNAL));
      if (d > 0) for (const id of INTERNAL) { const m = Math.min(d, c[id] - t[id]); t[id] += m; d -= m; }
      else for (const id of [...INTERNAL].reverse()) { const m = Math.min(-d, t[id]); t[id] -= m; d += m; }
      fs.lastInt = env.fuel;
    }
    if (Math.abs(env.extFuel - fs.lastExt) > 0.5) {
      const have = this.sum(EXTERNAL), capExt = c.ec + c.el + c.er;
      if (env.extFuel > have && capExt > 0) for (const id of EXTERNAL) t[id] = c[id] * clamp(env.extFuel / capExt, 0, 1);
      else if (have > 0) for (const id of EXTERNAL) t[id] *= env.extFuel / have;
      fs.lastExt = env.extFuel;
    }
  }

  private sum(ids: TankId[]) { let s = 0; for (const id of ids) s += this.tank[id]; return s; }
  private move(from: TankId, to: TankId, kg: number) {
    const m = Math.max(0, Math.min(kg, this.tank[from], this.cap[to] - this.tank[to]));
    this.tank[from] -= m; this.tank[to] += m;
    return m;
  }

  private stepFuel(dt: number, env: SystemsEnv) {
    const t = this.tank, fs = this.fuelSys, e = this.eng;
    // ---- engine feed: the fuel flow proportioner (driven by hydraulic system A) draws equally from both
    // reservoirs; the ENG FEED knob can favour one side (3.4)
    if (!env.unlimitedFuel) {
      let need = (e.running ? env.fuelFlow : e.lit ? 0.09 : this.jfs.on ? 0.02 : 0) * dt;
      const feed = this.sw.engFeed;
      const share = feed === 2 ? 0 : feed === 3 ? 1 : this.hyd.a >= 1000 ? 0.5 : 0.62;   // fraction from the forward reservoir
      const fwd = Math.min(t.fr, need * share), aft = Math.min(t.ar, need * (1 - share));
      t.fr -= fwd; t.ar -= aft; need -= fwd + aft;
      if (need > 1e-9) { const m = Math.min(t.fr, need); t.fr -= m; need -= m; }
      if (need > 1e-9) { const m = Math.min(t.ar, need); t.ar -= m; need -= m; }
      e.starved = t.fr + t.ar < 0.01 && t.f + t.a < 0.01;
      // a leak drains the fuselage tanks
      let leak = env.damage.fuelLeak * dt;
      for (const id of ['a', 'f', 'lw', 'rw', 'ar', 'fr'] as TankId[]) { const m = Math.min(leak, t[id]); t[id] -= m; leak -= m; }
    } else e.starved = false;

    // ---- external tanks are pushed into the wing tanks by ECS air (3.2, 3.3): none with AIR SOURCE in OFF or
    // RAM, with the engine not running, or with the air-refuel door open (4.2.1)
    fs.pressurized = (this.sw.airSource === 1 || this.sw.airSource === 2) && e.running && this.sw.airRefuel === 0;
    if (fs.pressurized) {
      const r = 1.2 * dt;
      const wingFirst = this.sw.extFuelTrans === 1;
      const wings = t.el + t.er > 0.01, ctr = t.ec > 0.01;
      if (ctr && !(wingFirst && wings)) { this.move('ec', 'lw', r); this.move('ec', 'rw', r); }
      else if (wings) { this.move('el', 'lw', r); this.move('er', 'rw', r); }
    }
    // ---- wing tanks → fuselage tanks → reservoirs: right wing and F-1/F-2 feed forward, left wing and A-1 aft
    this.move('rw', 'f', 5 * dt); this.move('lw', 'a', 5 * dt);
    this.move('f', 'fr', 12 * dt); this.move('a', 'ar', 12 * dt);
    // ---- automatic forward fuel transfer: below 2800 lb forward, starts when the forward system is less than
    // 300 lb heavier than the aft and stops at 450 lb; only with the FUEL QTY SEL knob in NORM (3.2)
    const fwdTot = t.f + t.fr, aftTot = t.a + t.ar;
    if (this.sw.fuelQtySel === 1 && this.bus.emerg && fwdTot < 2800 * LB) {
      const diff = (fwdTot - aftTot) / LB;
      if (diff < 300) fs.fwdTransfer = true; else if (diff >= 450) fs.fwdTransfer = false;
    } else fs.fwdTransfer = false;
    if (fs.fwdTransfer) this.move('a', 'f', 0.6 * dt);

    // ---- trapped external fuel (3.9): fuselage not full, fuel still outside, modest fuel flow, for 30 s
    const fusCap = this.cap.f + this.cap.a + this.cap.fr + this.cap.ar;
    const trapped = this.sw.fuelQtySel === 1 && fwdTot + aftTot < fusCap - 500 * LB && this.sum(EXTERNAL) > 500 * LB && env.fuelFlow * PPH < 18000;
    fs.trapped = trapped ? fs.trapped + dt : 0;

    fs.lastInt = this.sum(INTERNAL);
    fs.lastExt = this.sum(EXTERNAL);
  }

  fuelState() { return { internal: this.fuelSys.lastInt, external: this.fuelSys.lastExt }; }

  // ------------------------------------------------------------------ gear, flaps, brakes (sections 9–15)
  private stepGear(dt: number, env: SystemsEnv) {
    const g = this.gear;
    const kt = env.ias / KT;
    // LG warning horn: gear not down and locked below 190 kt and 10 000 ft with more than 250 fpm down (9.7)
    const cond = !env.wow && env.gearPos < 0.98 && kt < 190 && env.alt < 10000 * FT && env.vs < -250 * FT / 60;
    if (!cond) g.hornSilenced = false;
    g.horn = cond && !g.hornSilenced && this.bus.batt;
    // trailing-edge flaps follow the LG handle or ALT FLAPS: full down below 240 kt, faired by 370 kt (15.4)
    if (this.bus.flcs && (this.hyd.a >= 1000 || this.hyd.b >= 1000)) {
      const down = this.sw.lgHandle === 1 || this.sw.altFlaps === 1;
      g.flapCmd = down ? 1 - smoothstep(240, 370, kt) : 0;
    }
    void dt;
  }

  // ------------------------------------------------------------------ ECS (section 5)
  private cabinTarget(env: SystemsEnv) {
    const ft = env.alt / FT;
    const pressurised = this.sw.airSource === 1 && this.eng.running;
    if (!pressurised || ft < 8000) return ft;
    return ft < 23000 ? 8000 : 8000 + (ft - 23000) * 0.48;
  }
  private stepEcs(dt: number, env: SystemsEnv) {
    this.ecs.cabinAlt = approach(this.ecs.cabinAlt, this.cabinTarget(env), 400, dt);
    // no cooling air: EQUIP HOT shortly after (5.4)
    const noCooling = (this.sw.airSource === 0 || this.sw.airSource === 3) && this.bus.ess;
    this.ecs.hot = noCooling ? this.ecs.hot + dt : 0;
  }

  // ------------------------------------------------------------------ outputs
  private updateHooks(dt: number, env: SystemsEnv) {
    const h = this.hooks, e = this.eng, hy = this.hyd;
    const aOk = hy.a >= 1000, bOk = hy.b >= 1000;
    h.engineOn = e.running;
    h.rpm = e.n2;
    h.ownsFuel = true;
    h.abInhibit = e.sec;
    // SEC gives 80–100 % of MIL thrust (2.46.4)
    h.thrustScale = e.health * (e.sec ? 0.9 : 1);
    // gear: retracted hydraulically by system B, lowered by B or by the pneumatic bottle (9, 9.6)
    const want = this.sw.lgHandle === 1 || this.gear.altUsed;
    h.gearCmd = want;
    h.gearRate = want ? (bOk ? 1 : this.gear.altUsed ? 0.6 : 0) : bOk && this.bus.emerg ? 1 : 0;
    h.flapCmd = this.gear.flapCmd;
    // speedbrakes: system A; limited to 43° of 60° with the gear down until the nosewheel is on the runway (13)
    h.speedbrakeAvail = aOk;
    h.speedbrakeMax = env.gearPos > 0.98 && !env.wow ? 43 / 60 : 1;
    // flight controls: both systems share the load; one alone slows the actuators; none leaves the accumulators
    const hydPower = aOk && bOk ? 1 : aOk || bOk ? 0.75 : hy.accum > 0 ? 0.5 : 0;
    h.controlPower = this.bus.flcs ? hydPower : 0;
    // toe brakes: FLCC power, a battery bus, and system B or the brake/JFS accumulators; CHAN 1 needs the LG handle down (12)
    const brakePress = bOk || this.jfs.accum[0] + this.jfs.accum[1] > 0.02;
    const chanOk = this.sw.brakesChan === 1 || this.sw.lgHandle === 1;
    h.brakeScale = this.bus.flcs && this.bus.batt && brakePress && chanOk ? 1 : 0;
    h.parkingBrake = this.sw.antiSkid === 2 && env.wow && this.bus.batt && (bOk || this.jfs.accum[1] > 0.02);
    h.nws = bOk && this.bus.emerg && !this.gear.altUsed;
    const mission = this.sw.mmc === 1 && this.sw.stSta === 1 && this.bus.ess;
    h.weaponsAvail = mission;
    h.gunAvail = mission && bOk;
    void dt;
  }

  powered(c: Consumer): boolean {
    const b = this.bus;
    switch (c) {
      case 'hud': return this.sw.ufc === 1 && this.sw.mmc === 1 && b.emerg;
      case 'mfd': return this.sw.mfd === 1 && b.ess;
      // EQUIP HOT cuts power to the radar (5.5)
      case 'radar': return this.sw.fcr === 1 && this.sw.mmc === 1 && b.nonEss && !this.lit.equipHot;
      case 'rwr': return this.sw.rwr === 1 && b.emerg;
    }
  }

  private updateLights(dt: number, env: SystemsEnv) {
    const L = this.lit, e = this.eng, el = this.elec, b = this.bus, u = this.epu, t = this.tank;
    const batt = b.batt;
    // ---- ELEC panel (6.9)
    L.mainGen = batt && !el.mainGen;
    L.stbyGen = batt && !el.stbyGen;
    L.flcsRly = batt && !el.relays;
    L.flcsPmg = batt && el.relays && !el.pmg;
    L.battToFlcs = batt && el.relays && !el.pmg && !b.emerg;
    L.epuGen = batt && u.commanded && !u.test && u.speed < 0.95;
    L.epuPmg = L.epuGen;
    L.battFail = batt && el.battery < 0.1;
    let sig = 0, bit = 1;
    for (const id of ['mainGen', 'stbyGen', 'flcsRly', 'flcsPmg', 'battToFlcs', 'epuGen', 'battFail']) { if (L[id]) sig |= bit; bit <<= 1; }
    el.fault = sig;
    el.faultAck &= sig;
    L.elecSys = (sig & ~el.faultAck) !== 0;
    if (!L.elecSys) this.caution.ack.delete('elecSys');
    L.flcsPwr = batt && b.flcs && (this.sw.flcsPwrTest === 1 || (u.test && u.speed > 0.95));
    // ---- start and EPU panels
    L.jfsRun = batt && this.jfs.on && this.jfs.speed >= 1;
    L.epuRun = u.speed > 0.95;
    L.hydrazn = batt && u.commanded && !u.test && u.usingHydrazine;
    L.epuAir = batt && u.commanded;
    // ---- glareshield warnings, all on battery bus No. 1
    // ENGINE: rpm below sub-idle (55 %) or FTIT over 1000 °C for 2 s (2.43)
    e.overTemp = e.ftit > 1000 ? e.overTemp + dt : 0;
    L.engine = batt && (e.n2 < 55 || e.overTemp > 2);
    // HYD/OIL PRESS: either system under 1000 psi, or oil under 10 psi for 30 s (off again above 20 psi) (2.42)
    if (e.oil < 10) e.oilLow += dt; else if (e.oil > 20) e.oilLow = 0;
    L.hydOil = batt && (this.hyd.a < 1000 || this.hyd.b < 1000 || e.oilLow > 30);
    const kt = env.ias / KT;
    const low = !env.wow && kt < 190 && env.alt < 10000 * FT && env.vs < -250 * FT / 60;
    // TO/LDG CONFIG: in that same corner with the flaps not full down or the gear not down (9.9)
    L.toLdgConfig = batt && low && (env.flapPos < 0.9 || env.gearPos < 0.98);
    // ---- landing gear panel (9.3, 9.10)
    const down = env.gearPos > 0.98, up = env.gearPos < 0.02;
    L.wheelNose = L.wheelLeft = L.wheelRight = batt && down;
    L.lgWarn = batt && ((!down && !up) || (this.sw.lgHandle === 1 ? !down : !up) || (low && !down));
    L.nws = batt && env.wow && this.hooks.nws;
    // ---- caution panel
    L.sec = b.emerg && e.sec;
    L.fwdFuelLow = b.emerg && t.fr < 400 * LB;      // 3.7
    L.aftFuelLow = b.emerg && t.ar < 250 * LB;
    L.equipHot = b.ess && this.ecs.hot > 15;
    L.cabinPress = b.emerg && this.ecs.cabinAlt > 27000;   // 5.7
    L.antiSkid = b.emerg && this.sw.lgHandle === 1 && this.sw.antiSkid === 0;   // 12.6
    L.seatNotArmed = b.emerg && this.sw.seatArm === 0;
    // MAL & IND LTS lights everything (19.5)
    if (this.sw.malIndTest === 1 && batt) for (const l of this.lights) L[l.id] = true;
    else {
      // ---- MASTER CAUTION: comes on with any caution light until it is reset (19.3)
      let master = false;
      for (const l of this.lights) {
        if (l.kind !== 'caution' || l.id === 'masterCaution') continue;
        if (!L[l.id]) this.caution.ack.delete(l.id);
        else if (!this.caution.ack.has(l.id)) master = true;
      }
      this.caution.master = master;
      L.masterCaution = master;
    }
  }

  /** Voice message system: WARNING 1.5 s after a warning light, CAUTION 7 s after a caution light that has not
   *  been reset; silent with weight on wheels (19.1). */
  private stepAlerts(dt: number, env: SystemsEnv) {
    const c = this.caution;
    if (c.master) {
      c.cautionT = c.cautionT < 0 ? 0 : c.cautionT + dt;
      if (c.cautionT >= 7 && c.cautionT - dt < 7 && !env.wow) this.say('CAUTION, CAUTION.', 'caution');
    } else c.cautionT = -1;
    let fresh = false;
    for (const l of this.lights) {
      if (l.kind !== 'warning' || l.id === 'lgWarn') continue;
      if (!this.lit[l.id]) c.warnSaid.delete(l.id);
      else if (!c.warnSaid.has(l.id)) fresh = true;
    }
    if (fresh) {
      c.warnT = c.warnT < 0 ? 0 : c.warnT + dt;
      if (c.warnT >= 1.5) {
        for (const l of this.lights) if (l.kind === 'warning' && this.lit[l.id]) c.warnSaid.add(l.id);
        c.warnT = -1;
        if (!env.wow) this.say('WARNING, WARNING.', 'warning');
      }
    } else c.warnT = -1;
  }

  light(id: string) { return !!this.lit[id]; }

  gauge(id: string): number {
    const e = this.eng, t = this.tank, b = this.bus;
    switch (id) {
      case 'rpm': return b.batt ? e.n2 : 0;
      case 'ftit': return b.batt ? e.ftit : 0;
      case 'nozzle': return b.emerg ? e.nozzle : 0;
      case 'oil': return b.emerg ? e.oil : 0;
      case 'fuelFlow': return b.emerg ? (e.running ? this.env.fuelFlow : e.lit ? 0.09 : 0) * PPH : 0;
      case 'hydA': return b.emerg ? this.hyd.a : 0;
      case 'hydB': return b.emerg ? this.hyd.b : 0;
      case 'epuFuel': return b.batt ? this.epu.hydrazine : 0;
      case 'cabinAlt': return this.ecs.cabinAlt;
    }
    if (!b.emerg) return 0;
    // 3.5: the totalizer shows everything; the AL and FR pointers show what the FUEL QTY SEL knob selects
    const sel = this.sw.fuelQtySel;
    const lb = (kg: number) => kg / LB;
    if (id === 'fuelTotal') return sel === 0 ? 6000 : lb(this.sum(INTERNAL) + this.sum(EXTERNAL));
    const al = [2000 * LB, t.a + t.ar, t.ar, t.lw, t.el, 0][sel];
    const fr = [2000 * LB, t.f + t.fr, t.fr, t.rw, t.er, t.ec][sel];
    if (id === 'fuelAL') return lb(al);
    if (id === 'fuelFR') return lb(fr);
    return 0;
  }

  horn() { return this.gear.horn; }

  hudWarnings(): string[] {
    const w: string[] = [];
    const L = this.lit;
    if (L.engine && !this.env.wow) w.push('ENGINE');
    if (L.hydOil && !this.env.wow) w.push('HYD/OIL');
    if (this.gear.horn) w.push('GEAR');
    else if (L.toLdgConfig) w.push('CONFIG');
    if (this.fuelSys.trapped > 30) w.push('TRP FUEL');
    if (L.fwdFuelLow || L.aftFuelLow) w.push('FUEL LOW');
    return w;
  }

  private say(text: string, level: Msg['level']) { this.msgs.push({ text, level }); }
  drainMessages() { const m = this.msgs; this.msgs = []; return m; }

  // ------------------------------------------------------------------ procedures
  /** The steps of the procedure that applies now, each with the switch action that completes it. */
  private procedure(): Array<ChecklistStep & { act?: () => void; wait?: number }> {
    const s = this.sw, e = this.eng, el = this.elec;
    const set = (id: string, pos: number) => () => { this.set(id, pos); };
    const started = e.running;
    return [
      { text: 'MAIN PWR switch: MAIN PWR', done: s.mainPwr === 2, act: set('mainPwr', 2), note: 'Check FLCS RLY, MAIN GEN and STBY GEN lights on.' },
      { text: 'FUEL MASTER switch: MASTER', done: s.fuelMaster === 1, act: set('fuelMaster', 1) },
      { text: 'ENG FEED knob: NORM', done: s.engFeed === 1, act: set('engFeed', 1) },
      { text: 'AIR SOURCE knob: NORM', done: s.airSource === 1, act: set('airSource', 1) },
      { text: 'EPU switch: OFF until the engine runs', done: started || s.epu === 0, act: set('epu', 0) },
      { text: 'JFS switch: START 2', done: started || this.jfs.on, act: set('jfs', 2), wait: 1.5 },
      { text: 'JFS RUN light on, RPM 20 % minimum', done: started || e.lit || (this.jfs.speed >= 1 && e.n2 >= 20), note: `JFS ${Math.round(this.jfs.speed * 100)} %, RPM ${e.n2.toFixed(0)} %` },
      { text: 'Throttle: IDLE', done: s.throttleCutoff === 1, act: set('throttleCutoff', 1) },
      { text: `Engine light-off, FTIT below ${this.p.startLimit} °C`, done: started || (e.lit && e.n2 > 30), note: `FTIT ${Math.round(e.ftit)} °C` },
      { text: 'RPM at idle; JFS off at 50 %; HYD/OIL PRESS light off', done: started && !this.lit.hydOil, note: `RPM ${e.n2.toFixed(0)} %` },
      { text: 'STBY GEN and MAIN GEN lights off', done: el.mainGen, note: 'The main generator follows the standby generator after about 10 s.' },
      { text: 'EPU switch: NORM', done: started && s.epu >= 1, act: set('epu', 1), wait: 1 },
      { text: 'Avionics power: MMC, ST STA, MFD, UFC', done: s.mmc + s.stSta + s.mfd + s.ufc === 4, act: () => { for (const id of ['mmc', 'stSta', 'mfd', 'ufc']) this.set(id, 1); }, wait: 1 },
      { text: 'Sensor power: FCR, THREAT WARN', done: s.fcr + s.rwr === 2, act: () => { this.set('fcr', 1); this.set('rwr', 1); }, wait: 1 },
      { text: 'PROBE HEAT switch: PROBE HEAT', done: s.probeHeat === 1, act: set('probeHeat', 1) },
      { text: 'Ejection safety lever: ARMED', done: s.seatArm === 1, act: set('seatArm', 1) },
      { text: 'ELEC CAUTION RESET and MASTER CAUTION: reset', done: !this.lit.masterCaution && !this.lit.elecSys, act: () => { this.set('elecReset', 1); this.set('elecReset', 0); this.set('masterCaution', 1); this.set('masterCaution', 0); } },
      { text: 'Parking brake: release when ready to taxi (ANTI-SKID)', done: s.antiSkid !== 2, act: set('antiSkid', 1), wait: 1 },
    ];
  }

  checklist(): ChecklistStep[] {
    return this.procedure().map(({ text, done, note }) => ({ text, done, note }));
  }

  private runAutoStart(dt: number) {
    const steps = this.procedure();
    const next = steps.find((x) => !x.done);
    if (!next) { this.autoStart = false; this.say('Start complete. Ready to taxi.', 'info'); return; }
    if (!next.act) { this.auto.wait = 0; return; }       // a "monitor" item: wait for the jet
    this.auto.wait += dt;
    if (this.auto.wait >= (next.wait ?? 0.7)) { this.auto.wait = 0; next.act(); }
  }
}
