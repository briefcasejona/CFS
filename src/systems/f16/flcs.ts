// F-16 flight control system (FLCS) state and the pilot fault list, after TO 1F-16CM/AM-1 (BMS) sections 16
// (digital backup, limiters, gains), 17 (flight control panel, lights, built-in test) and 19.6 (pilot fault list
// display), with the fault names and test numbers of TO 1F-16CM/AM-34-1-1 section 7.1.
import type { FlcsHooks } from '../types.js';

const KT = 0.514444;

export type FaultSys = 'FLCS' | 'ENG' | 'AV';
export interface FaultDef { id: string; sys: FaultSys; level: 'warning' | 'caution'; text: string; test: number; mfl: string }

/** The faults this model can raise (34-1-1, 7.1.4). */
export const FAULTS: Record<string, FaultDef> = {
  stbyGain: { id: 'stbyGain', sys: 'FLCS', level: 'warning', text: 'STBY GAIN', test: 14, mfl: 'FLCS' },
  lefLock: { id: 'lefLock', sys: 'FLCS', level: 'warning', text: 'FLCS LEF LOCK', test: 43, mfl: 'FLCS' },
  bitFail: { id: 'bitFail', sys: 'FLCS', level: 'warning', text: 'FLCS BIT FAIL', test: 55, mfl: 'FLCS' },
  dualFail: { id: 'dualFail', sys: 'FLCS', level: 'warning', text: 'FLCS DUAL FAIL', test: 21, mfl: 'FLCS' },
  adcFail: { id: 'adcFail', sys: 'FLCS', level: 'caution', text: 'FLCS ADC FAIL', test: 13, mfl: 'FLCS' },
  isaAll: { id: 'isaAll', sys: 'FLCS', level: 'caution', text: 'ISA ALL FAIL', test: 36, mfl: 'FLCS' },
  snglFail: { id: 'snglFail', sys: 'FLCS', level: 'caution', text: 'FLCS SNGL FAIL', test: 49, mfl: 'FLCS' },
  apFail: { id: 'apFail', sys: 'FLCS', level: 'caution', text: 'FLCS A/P FAIL', test: 50, mfl: 'FLCS' },
  muxDegr: { id: 'muxDegr', sys: 'FLCS', level: 'caution', text: 'FLCS MUX DEGR', test: 71, mfl: 'FLCS' },
  abFail: { id: 'abFail', sys: 'ENG', level: 'caution', text: 'ENG A/B FAIL', test: 87, mfl: 'ENG' },
  fmsFail: { id: 'fmsFail', sys: 'AV', level: 'caution', text: 'FMS FAIL', test: 4, mfl: 'FMS' },
  fccFail: { id: 'fccFail', sys: 'AV', level: 'caution', text: 'FCC FAIL', test: 4, mfl: 'FCC' },
  insFail: { id: 'insFail', sys: 'AV', level: 'caution', text: 'INS BUS FAIL', test: 3, mfl: 'INS' },
  fcrFail: { id: 'fcrFail', sys: 'AV', level: 'caution', text: 'FCR BUS FAIL', test: 3, mfl: 'FCR' },
  gpsFail: { id: 'gpsFail', sys: 'AV', level: 'caution', text: 'GPS BUS FAIL', test: 3, mfl: 'GPS' },
};

interface Entry { def: FaultDef; active: boolean; acked: boolean; count: number; first: number }
export interface MflRow { mfl: string; test: number; count: number; time: number }

/**
 * Pilot fault list (19.6): what the PFLD shows, the F-ACK button and the maintenance fault list behind it.
 * A fault is displayed until it is acknowledged; a later F-ACK recalls the faults that are still present and
 * forgets those that are not.
 */
export class FaultList {
  private list = new Map<string, Entry>();
  private mflRows: MflRow[] = [];
  private page = 0;
  private recall = false;
  /** a fault came up since the last look: retriggers MASTER CAUTION and the voice message */
  fresh: Array<FaultDef> = [];

  reset() { this.list.clear(); this.mflRows = []; this.page = 0; this.recall = false; this.fresh = []; }

  /** Report whether a fault condition is present right now. */
  report(id: string, active: boolean, time: number) {
    const def = FAULTS[id];
    let e = this.list.get(id);
    if (!e) {
      if (!active) return;
      e = { def, active: false, acked: false, count: 0, first: time };
      this.list.set(id, e);
    }
    if (active && !e.active) {
      e.count = Math.min(9, e.count + 1);
      e.acked = false;
      this.recall = false; this.page = 0;
      this.fresh.push(def);
      this.addMfl(def.mfl, def.test, time);
    }
    e.active = active;
  }

  /** Remove a fault whose cause is gone, as a successful FLCS reset does. */
  clear(id: string) { this.list.delete(id); }
  has(id: string) { return !!this.list.get(id)?.active; }

  private addMfl(mfl: string, test: number, time: number) {
    const row = this.mflRows.find((r) => r.mfl === mfl && r.test === test);
    if (row) { row.count = Math.min(9, row.count + 1); return; }
    // 17 entries at most; the newest replaces the last (34-1-1, 7.1.2)
    if (this.mflRows.length >= 17) this.mflRows.pop();
    this.mflRows.push({ mfl, test, count: 1, time });
  }
  /** take-off and landing are logged as pseudo-faults */
  pseudo(mfl: 'TOF' | 'LAND', time: number) { this.mflRows.push({ mfl, test: 0, count: 1, time }); if (this.mflRows.length > 17) this.mflRows.splice(16, 1); }
  mfl(): MflRow[] { return this.mflRows; }
  /** CLR on the TEST page: empties the list; faults still present are logged again */
  clearMfl(time: number) {
    this.mflRows = [];
    for (const e of this.list.values()) if (e.active) this.addMfl(e.def.mfl, e.def.test, time);
  }

  private order(e: Entry) { return (e.def.sys === 'FLCS' ? (e.def.level === 'warning' ? 0 : 1) : e.def.sys === 'ENG' ? 2 : 3); }
  private shown(): Entry[] {
    const all = [...this.list.values()].filter((e) => (this.recall ? e.active : !e.acked));
    return all.sort((a, b) => this.order(a) - this.order(b));
  }

  /** F-ACK (FAULT ACK) button. */
  ack() {
    const shown = this.shown();
    if (shown.length) {
      if ((this.page + 1) * 3 < shown.length) { this.page++; return; }
      for (const e of shown) e.acked = true;
      this.recall = false; this.page = 0;
      return;
    }
    // nothing displayed: recall. Faults no longer reported are forgotten.
    for (const [id, e] of this.list) if (!e.active) this.list.delete(id);
    this.recall = true; this.page = 0;
  }

  /** system codes on the status line: a category with at least one fault still present */
  codes(): Record<FaultSys, boolean> {
    const c = { FLCS: false, ENG: false, AV: false };
    for (const e of this.list.values()) if (e.active) c[e.def.sys] = true;
    return c;
  }
  /** an active warning-level FLCS fault (the FLCS warning light) */
  warning() { for (const e of this.list.values()) if (e.active && e.def.level === 'warning') return true; return false; }
  /** a caution-level fault of this system that has not been acknowledged (the system's FAULT caution light) */
  caution(sys: FaultSys) { for (const e of this.list.values()) if (e.active && !e.acked && e.def.sys === sys && e.def.level === 'caution') return true; return false; }
  active(sys?: FaultSys): FaultDef[] { return [...this.list.values()].filter((e) => e.active && (!sys || e.def.sys === sys)).sort((a, b) => this.order(a) - this.order(b)).map((e) => e.def); }

  /** The four rows of the PFLD, `cols` wide. */
  rows(cols = 24): string[] {
    const c = this.codes();
    const pad = (s: string) => s.padEnd(cols).slice(0, cols);
    const centre = (s: string) => pad(' '.repeat(Math.max(0, Math.floor((cols - s.length) / 2))) + s);
    const status = `${c.FLCS ? 'FLCS' : '    '}      ${c.ENG ? 'ENG' : '   '}       ${c.AV ? 'AV' : '  '}`;
    const shown = this.shown();
    const pages = Math.ceil(shown.length / 3);
    const rows = [pad(` ${status}`)];
    const at = shown.slice(this.page * 3, this.page * 3 + 3);
    for (let i = 0; i < 3; i++) {
      const e = at[i];
      if (!e) { rows.push(pad('')); continue; }
      let t = e.def.level === 'warning' ? `>${e.def.text}<` : e.def.text;
      if (i === 2 && pages > 1) t = `↓${t}↓ P${this.page + 1}`;
      rows.push(centre(t));
    }
    return rows;
  }
}

export type GainMode = 'cruise' | 'tol' | 'standby';

export interface FlcsInput {
  dt: number;
  time: number;
  powered: boolean;
  wow: boolean;
  /** knots calibrated, altitude ft, AoA deg, dynamic pressure Pa, ground speed m/s */
  kias: number; altFt: number; aoa: number; qbar: number; gs: number;
  lgDown: boolean; altFlaps: boolean; airRefuelOpen: boolean;
  hydA: boolean; hydB: boolean;
  /** mission computer on line (the FLCC reports over the multiplex bus) */
  mmc: boolean;
  probeHeat: boolean;
  /** outside air temperature °C and whether the jet is in visible moisture */
  oat: number;
  controlsDamage: number;
  sw: { bit: number; dbu: number; mpo: number; storesConfig: number; leFlaps: number; reset: number };
}

/** FLCC: gains, digital backup, built-in test and the faults it reports. */
export class Flcs {
  mode: GainMode = 'tol';
  dbu = false;
  /** failed air-data branches: 1 = FLCS ADC FAIL, 2 = standby gains (16.3) */
  adc = 0;
  private adcLatched = false;
  private ice = 0;
  bit: { state: 'off' | 'run' | 'pass' | 'fail'; t: number } = { state: 'off', t: 0 };
  /** the BIT switch is solenoid-held: this is where it sits */
  bitSwitch = 0;
  lefLocked = false;
  apAvail = true;
  readonly hooks: FlcsHooks = { aoaMax: null, gMax: null, gMin: null, rollRate: null, rollScale: 1, gain: 1, liftLoss: 0, mpo: false };
  private wasReset = 0;

  init(cold: boolean) {
    this.mode = 'tol'; this.dbu = false; this.adc = 0; this.adcLatched = false; this.ice = 0;
    this.bit = { state: cold ? 'off' : 'pass', t: 0 };
    this.bitSwitch = 0; this.lefLocked = false; this.apAvail = true; this.wasReset = 0;
  }

  /** Inject an air-data failure (battle damage, tests). */
  failAirData(n: number) { this.adc = Math.max(this.adc, n); if (this.adc >= 2) this.adcLatched = true; }

  /** Moving the BIT switch to BIT. Returns why it will not stay there (17.12). */
  startBit(i: FlcsInput): string | null {
    if (!i.powered) return 'FLCS BIT: the flight control computer has no power.';
    this.bit = { state: 'run', t: 0 };
    this.bitSwitch = 1;
    return null;
  }

  step(i: FlcsInput, faults: FaultList, say: (t: string, l: 'info' | 'caution' | 'warning') => void) {
    const { dt, time } = i;
    if (!i.powered) {
      // without power the computer forgets a test in progress; the surfaces are not driven at all
      if (this.bit.state === 'run') { this.bit.state = 'off'; this.bitSwitch = 0; }
      this.dbu = false;
      return;
    }
    // ---- digital backup (16.1): selected with the DIGITAL BACKUP switch
    this.dbu = i.sw.dbu === 1;

    // ---- air data: an unheated probe ices up in freezing, fast air; two failed branches mean standby gains
    const icing = !i.probeHeat && !i.wow && i.oat < -5 && i.kias > 150;
    this.ice = icing ? this.ice + dt : Math.max(0, this.ice - dt * 4);
    if (this.ice > 150) this.adc = Math.max(this.adc, 1);
    if (this.ice > 300) { this.adc = 2; this.adcLatched = true; }
    if (i.controlsDamage < 0.75) this.adc = Math.max(this.adc, 1);
    if (i.controlsDamage < 0.5) { this.adc = 2; this.adcLatched = true; }

    // ---- FLCS RESET (16.3.3): standby gains go back to the first-failure condition if the cause has gone;
    // the first failure stays latched once a second one has happened
    if (i.sw.reset === 1 && this.wasReset === 0) {
      const causeGone = this.ice < 150 && i.controlsDamage >= 0.75;
      const dualGone = this.ice < 300 && i.controlsDamage >= 0.5;
      if (this.adc >= 2 && dualGone) this.adc = 1;
      if (this.adc === 1 && causeGone && !this.adcLatched) this.adc = 0;
      for (const id of ['stbyGain', 'adcFail', 'isaAll', 'snglFail', 'apFail', 'lefLock']) if (!this.cause(id, i)) faults.clear(id);
      say('FLCS reset.', 'info');
    }
    this.wasReset = i.sw.reset;

    // ---- built-in test (17.12): about 45 s on the ground; an interlock or a failure ends it
    const b = this.bit;
    if (b.state === 'run') {
      b.t += dt;
      const interlock = !i.wow || i.gs > 14 || !i.hydA || !i.hydB;
      if (interlock) {
        b.state = 'fail'; this.bitSwitch = 0;
        say(!i.wow || i.gs > 14 ? 'FLCS BIT failed: the jet must be stationary on the ground.' : 'FLCS BIT failed: it needs both hydraulic systems.', 'warning');
      } else if (b.t >= 45) {
        b.state = 'pass'; this.bitSwitch = 0;
        faults.clear('bitFail');
        say('FLCS BIT passed.', 'info');
        // run without the mission computer the test cannot check the bus (34-1-1, 7.1.4)
        if (!i.mmc) faults.report('muxDegr', true, time);
      }
    }
    if (b.state === 'pass') faults.report('muxDegr', false, time);

    // ---- leading-edge flaps: LE FLAPS switch in LOCK, or damage
    this.lefLocked = i.sw.leFlaps === 1 || i.controlsDamage < 0.6;

    // ---- gains (16.3)
    const slow = i.kias < 400;
    const standby = this.adc >= 2 && !this.dbu;
    this.mode = standby ? 'standby' : (i.lgDown || (i.altFlaps && slow) || (i.airRefuelOpen && slow)) ? 'tol' : 'cruise';

    // ---- faults
    for (const id of ['stbyGain', 'adcFail', 'isaAll', 'lefLock', 'bitFail']) faults.report(id, this.cause(id, i), time);

    // ---- autopilot (17.13)
    this.apAvail = !this.dbu && !standby && !i.lgDown && !i.airRefuelOpen && !(i.altFlaps && slow) && i.aoa <= 15 && i.sw.mpo === 0;

    // ---- what the control law gets
    const h = this.hooks;
    const cat3 = i.sw.storesConfig === 1;
    h.mpo = i.sw.mpo === 1;
    h.rollScale = 1; h.rollRate = null; h.gMax = null; h.gMin = null; h.aoaMax = null; h.gain = 1; h.liftLoss = 0;
    if (this.dbu) {
      // 16.1: stick commands essentially CAT III limited, a constant 167°/s roll command
      h.aoaMax = 17; h.rollRate = 167;
    } else if (this.mode === 'tol') {
      // 16.2.1: about 21° at 1 g; a fixed roll-rate limit
      h.aoaMax = 21; h.rollRate = 180;
    } else if (cat3) {
      // 16.2.1: CAT III holds the AoA to about 16–18°
      h.aoaMax = 17; h.rollScale = 0.6;
    }
    if (this.mode === 'standby') {
      // 16.3.3: response tailored for sea level and about 600 kt (LG handle up) or 230 kt (down)
      const ref = (i.lgDown ? 230 : 600) * KT;
      const qRef = 0.5 * 1.225 * ref * ref;
      h.gain = Math.max(0.2, Math.min(1.8, i.qbar / qRef));
      // the leading-edge flaps sit at zero with the handle up
      if (!i.lgDown && !i.altFlaps) h.liftLoss = 0.18;
    }
    if (this.lefLocked) h.liftLoss = Math.max(h.liftLoss, 0.18);
    if (h.mpo) h.gMin = -4;
  }

  private cause(id: string, i: FlcsInput): boolean {
    switch (id) {
      case 'stbyGain': return this.adc >= 2 && !this.dbu;
      case 'adcFail': return this.adc >= 1;
      case 'isaAll': return i.controlsDamage < 0.65;
      case 'lefLock': return this.lefLocked;
      case 'bitFail': return this.bit.state === 'fail';
      default: return false;
    }
  }
}
