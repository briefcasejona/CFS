// F-16C/D avionics after TO 1F-16CM/AM-34-1-1 (BMS): the up-front controls (integrated control panel and data
// entry display, 2.2.1), the embedded GPS/INS and its alignment (2.2.3), fuel and altitude warnings (2.2.1.3) and
// the multifunction display formats (2.1.6). Section numbers in the comments refer to that manual.
import { INV_OFF, INV_ON, type FireControl, type MfdView, type MissionData, type NavPoint, type NavState, type TextDisplayDef } from '../types.js';
import type { FaultList } from './flcs.js';

const NM = 1852, FT = 0.3048, KT = 0.514444;
const ROWS = 5, COLS = 24;

export type IcpKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'ENTR' | 'RCL' | 'COM1' | 'COM2' | 'IFF' | 'LIST'
  | 'AA' | 'AG' | 'UP' | 'DOWN' | 'SEQ' | 'RTN' | 'INC' | 'DEC' | 'WARN';

/** What the avionics ask the rest of the jet to do (radar, stores). */
export type AvAction =
  | { t: 'radarMode'; mode: 'RWS' | 'TWS' | 'ACM' | 'OFF' }
  | { t: 'radarRange'; d: 1 | -1 }
  | { t: 'radarAz' }
  | { t: 'weaponNext' }
  | { t: 'master'; mode: NavState['masterMode'] };

export interface AvInput {
  dt: number; time: number; wow: boolean;
  x: number; z: number; alt: number; agl: number; gs: number; hdg: number; vs: number;
  fuelLb: number; fuselageLb: number; fuelFlowPph: number; fuelSelNorm: boolean; gearDown: boolean;
  /** electrical power to each box, with its own switch on */
  ufc: boolean; mmc: boolean; mfd: boolean; egiPower: boolean; gps: boolean; rdrAlt: boolean;
  /** EGI knob: 0 OFF, 1 STOR HDG, 2 NORM, 3 NAV, 4 IN FLT ALIGN */
  egiKnob: number;
  masterArm: number;
  fc: FireControl | null;
}
type Page = 'CNI' | 'COM1' | 'COM2' | 'IFF' | 'LIST' | 'MISC' | 'TILS' | 'ALOW' | 'DTS' | 'STPT' | 'CRUS' | 'TIME' | 'MARK' | 'FIX' | 'ACAL'
  | 'DEST' | 'BINGO' | 'VIP' | 'NAV' | 'MAN' | 'INS' | 'EWS' | 'MODE' | 'VRP' | 'INTG' | 'DLNK'
  | 'CORR' | 'MAGV' | 'OFP' | 'INSM' | 'LASR' | 'GPS' | 'DRNG' | 'BULL' | 'WPT' | 'HARM' | 'HMCS';

/** LIST and MISC menus (2.2.1.2.2.1), and the priority functions of the CNI page (2.2.1.2.3). */
const LIST: Record<string, Page> = { 1: 'DEST', 2: 'BINGO', 3: 'VIP', 4: 'NAV', 5: 'MAN', 6: 'INS', 7: 'EWS', 8: 'MODE', 9: 'VRP', 0: 'MISC', RCL: 'INTG', ENTR: 'DLNK' };
const MISC: Record<string, Page> = { 1: 'CORR', 2: 'MAGV', 3: 'OFP', 4: 'INSM', 5: 'LASR', 6: 'GPS', 7: 'DRNG', 8: 'BULL', 9: 'WPT', 0: 'HARM', RCL: 'HMCS' };
const PRIORITY: Record<string, Page> = { 1: 'TILS', 2: 'ALOW', 3: 'DTS', 4: 'STPT', 5: 'CRUS', 6: 'TIME', 7: 'MARK', 8: 'FIX', 9: 'ACAL' };

interface Field { r: number; c: number; w: number; text: () => string; enter?: (s: string) => boolean; msel?: () => void }

class Buf {
  ch: string[][] = [];
  inv: boolean[][] = [];
  constructor() { for (let r = 0; r < ROWS; r++) { this.ch.push(new Array(COLS).fill(' ')); this.inv.push(new Array(COLS).fill(false)); } }
  put(r: number, c: number, s: string, inv = false) {
    for (let k = 0; k < s.length; k++) { const x = c + k; if (x >= 0 && x < COLS && r >= 0 && r < ROWS) { this.ch[r][x] = s[k]; this.inv[r][x] = inv; } }
  }
  centre(r: number, s: string, inv = false) { this.put(r, Math.floor((COLS - s.length) / 2), s, inv); }
  rows(): string[] {
    return this.ch.map((row, r) => {
      let out = '', on = false;
      row.forEach((c, x) => { const i = this.inv[r][x]; if (i !== on) { out += i ? INV_ON : INV_OFF; on = i; } out += c; });
      return on ? out + INV_OFF : out;
    });
  }
}

const hms = (s: number) => { s = ((Math.floor(s) % 86400) + 86400) % 86400; const p = (n: number) => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`; };
const fmtLat = (v: number) => { const a = Math.abs(v), d = Math.floor(a); return `${v >= 0 ? 'N' : 'S'} ${String(d).padStart(2, '0')}°${((a - d) * 60).toFixed(3).padStart(6, '0')}'`; };
const fmtLon = (v: number) => { const a = Math.abs(v), d = Math.floor(a); return `${v >= 0 ? 'E' : 'W'} ${String(d).padStart(3, '0')}°${((a - d) * 60).toFixed(3).padStart(6, '0')}'`; };
const deg360 = (rad: number) => (((rad * 180 / Math.PI) % 360) + 360) % 360;

export const MFD_MENU: Array<[number, string]> = [[1, 'BLANK'], [2, 'HAD'], [3, 'RWR'], [4, 'RCCE'], [5, 'RESET'], [6, 'SMS'], [7, 'HSD'], [8, 'DTE'], [9, 'TEST'], [10, 'FLCS'],
  [16, 'FLIR'], [17, 'TFR'], [18, 'WPN'], [19, 'TGP'], [20, 'FCR']];
const HSD_RANGES = [15, 30, 60, 120, 240];

interface MfdUnit { slots: string[]; slot: number; menu: boolean }

export class F16Avionics {
  readonly displays: TextDisplayDef[] = [
    { id: 'ded', label: 'DED', panel: 'ICP', rows: ROWS, cols: COLS },
    { id: 'pfld', label: 'PFLD', panel: 'CAUTION', rows: 4, cols: COLS },
  ];
  readonly mfdCount = 2;
  private in!: AvInput;
  private faults: FaultList;
  private mission: MissionData | null = null;
  /** the cartridge is in the jet but its contents are only in the computer after a DTE load */
  private loaded = false;
  private msgs: Array<{ text: string; level: 'info' | 'caution' | 'warning' }> = [];
  actions: AvAction[] = [];

  // ---- navigation
  stpts: Array<(NavPoint & { tos: number }) | undefined> = [];
  steer = 0;
  autoSeq = true;
  private destSel = 0;
  private markNext = 25;
  egi = { t: 0, cep: 10, state: 'off' as 'off' | 'align' | 'ifa' | 'nav', ready: false, drift: 0, driftDir: 0.7, moved: false };
  // ---- up-front controls
  page: Page = 'CNI';
  private cursor = 0;
  private scratch = '';
  private rclOnce = false;
  private wind = false;
  private flash = 0;
  com = { uhf: 6, vhf: 10, uhfFreq: [0, 225.0, 229.3, 236.6, 243.0, 251.0, 292.3, 300.4, 305.2, 317.5, 324.5, 339.75, 349.0, 357.1, 363.8, 371.0, 377.1, 381.3, 385.4, 391.2, 397.5] };
  iff = { m1: 13, m3: 6400, on: true };
  tils = { chan: 0, band: 'X' as 'X' | 'Y', aa: false, ils: 0, crs: 0, cmdStrg: true };
  alow = { cara: 300, floor: 10000, warned: false };
  bingo = { lb: 2500, warn: false, reset: false };
  time = { hack: 0, hackOn: false, deltaTos: 0 };
  crus: 'TOS' | 'RNG' | 'HOME' | 'EDR' = 'TOS';
  private home = 0;
  bull = { on: true, stpt: 25 };
  man = 35;
  masterMode: NavState['masterMode'] = 'NAV';
  // ---- displays
  private mfds: MfdUnit[] = [{ slots: ['FCR', 'HSD', 'TEST'], slot: 0, menu: false }, { slots: ['RWR', 'SMS', 'HSD'], slot: 0, menu: false }];
  hsd = { range: 2, cen: false, coupled: true };
  private testPage = 0;
  dte = { t: -1 };
  private tookOff = false;

  constructor(faults: FaultList) { this.faults = faults; }

  // ------------------------------------------------------------------ set-up
  init(cold: boolean) {
    this.page = 'CNI'; this.cursor = 0; this.scratch = ''; this.masterMode = 'NAV';
    this.egi = { t: cold ? 0 : 480, cep: cold ? 10 : 0.8, state: cold ? 'off' : 'nav', ready: !cold, drift: 0, driftDir: 0.7, moved: false };
    this.loaded = false; this.stpts = []; this.steer = 0;
    this.dte.t = -1; this.tookOff = !cold && false;
    if (!cold) this.applyCartridge();
  }

  loadMission(m: MissionData) {
    this.mission = m;
    // a jet that starts running has had its cartridge loaded by the crew chief
    if (this.egi.state === 'nav' || this.loaded) this.applyCartridge();
  }

  /** DTE load: flight plan, bingo and radio aids from the cartridge into the computers (2.1.6.13). */
  private applyCartridge() {
    const m = this.mission;
    this.loaded = true;
    if (!m) return;
    this.stpts = [];
    let t = m.zuluStart + 300, px = m.steerpoints[0]?.x ?? 0, pz = m.steerpoints[0]?.z ?? 0;
    m.steerpoints.forEach((s, k) => {
      t += Math.hypot(s.x - px, s.z - pz) / 230; px = s.x; pz = s.z;
      this.stpts[k] = { ...s, tos: t };
    });
    this.steer = 0;
    this.home = Math.max(0, m.steerpoints.findIndex((s) => s.kind === 'home'));
    this.bingo.lb = Math.round(m.bingoKg / 0.45359237 / 100) * 100;
    const homeAid = m.navaids.find((n) => { const h = m.steerpoints[this.home]; return h && Math.hypot(n.x - h.x, n.z - h.z) < 5000; }) ?? m.navaids[0];
    if (homeAid) { this.tils.chan = homeAid.tacan; this.tils.band = homeAid.band; this.tils.ils = homeAid.ils; this.tils.crs = homeAid.crs; }
    // bullseye on steerpoint 25, as the cartridge sets it (2.2.1.2.6.1.5.13.9)
    const c = m.steerpoints.length ? m.steerpoints[Math.min(1, m.steerpoints.length - 1)] : null;
    if (c && !this.stpts[24]) this.stpts[24] = { name: 'BULL', x: c.x, z: c.z, alt: c.alt, tos: 0 };
  }

  get dteLoaded() { return this.loaded; }
  /** start a DTE load, as LOAD on the DTE page does */
  loadCartridge() { if (this.dte.t < 0 && this.in?.mmc) this.dte.t = 0; }

  private say(text: string, level: 'info' | 'caution' | 'warning' = 'info') { this.msgs.push({ text, level }); }
  drainMessages() { const m = this.msgs; this.msgs = []; return m; }
  drainActions() { const a = this.actions; this.actions = []; return a; }

  private geo(x: number, z: number) { return this.mission ? this.mission.geo(x, z) : { lat: 0, lon: 0 }; }
  /** lat/lon → game metres, by inverting the mission's projection numerically */
  private ungeo(lat: number, lon: number, x0: number, z0: number) {
    let x = x0, z = z0;
    for (let k = 0; k < 8; k++) {
      const g = this.geo(x, z), gx = this.geo(x + 1000, z), gz = this.geo(x, z + 1000);
      const a = (gx.lat - g.lat) / 1000, b = (gz.lat - g.lat) / 1000, c = (gx.lon - g.lon) / 1000, d = (gz.lon - g.lon) / 1000;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-18) break;
      const el = lat - g.lat, eo = lon - g.lon;
      x += (el * d - b * eo) / det; z += (a * eo - el * c) / det;
    }
    return { x, z };
  }

  // ------------------------------------------------------------------ step
  step(i: AvInput) {
    this.in = i;
    this.flash += i.dt;
    this.stepEgi(i);
    const zulu = this.zulu();
    if (this.time.hackOn) this.time.hack += i.dt;
    // DTE load takes a few seconds, block by block
    if (this.dte.t >= 0) { this.dte.t += i.dt; if (this.dte.t > 6) { this.dte.t = -1; this.applyCartridge(); this.say('DTE load complete.'); } }
    // ---- automatic steerpoint sequencing: inside 2 NM with the range opening (2.2.1.2.6.1.9)
    const sp = this.stpts[this.steer];
    if (sp && this.egi.ready && !i.wow) {
      const d = Math.hypot(sp.x - i.x, sp.z - i.z);
      if (this.autoSeq && d < 2 * NM && this.nextStpt(1) > this.steer && this.steer < 24) {
        this.steer = this.nextStpt(1);
        this.say(`Steerpoint ${this.steer + 1}: ${this.stpts[this.steer]?.name ?? ''}`);
      }
    }
    // ---- bingo (2.2.1.3.1): the lesser of fuselage and total fuel with FUEL QTY SEL in NORM
    const fuel = i.fuelSelNorm ? Math.min(i.fuelLb, i.fuselageLb) : i.fuelLb;
    const below = i.mmc && fuel < this.bingo.lb && !i.wow;
    if (!below) { this.bingo.warn = false; this.bingo.reset = false; }
    else if (!this.bingo.warn && !this.bingo.reset) { this.bingo.warn = true; this.say('BINGO, BINGO.', 'caution'); }
    // ---- ALOW: radar altitude below the set value with the gear up
    const low = i.rdrAlt && i.mmc && !i.gearDown && !i.wow && i.agl < this.alow.cara * FT && i.vs < 0;
    if (low && !this.alow.warned) { this.alow.warned = true; this.say('ALTITUDE, ALTITUDE.', 'warning'); }
    if (i.agl > this.alow.cara * FT * 1.2) this.alow.warned = false;
    // ---- take-off and landing pseudo-faults (2.1.6.14)
    if (!this.tookOff && !i.wow && !i.gearDown && i.gs > 120 * KT) { this.tookOff = true; this.faults.pseudo('TOF', i.time); }
    if (this.tookOff && i.wow && i.gs < 80 * KT) { this.tookOff = false; this.faults.pseudo('LAND', i.time); }
    void zulu;
  }

  private zulu() { return (this.mission?.zuluStart ?? 36000) + this.in.time; }

  /** 2.2.3.3: gyrocompass alignment in about four minutes, usable (degraded) after a minute and a half. */
  private stepEgi(i: AvInput) {
    const e = this.egi;
    if (!i.egiPower || i.egiKnob === 0) { e.state = 'off'; e.t = 0; e.cep = 10; e.ready = false; e.moved = false; return; }
    const moving = i.gs > 1.5;
    const curve = (t: number, tDeg: number, tFull: number) => t < 18 ? 10 : t < tDeg ? 10 - (10 - 5.6) * (t - 18) / (tDeg - 18) : t < tFull ? 5.6 - (5.6 - 0.8) * (t - tDeg) / (tFull - tDeg) : 0.8;
    if (i.egiKnob === 3) {
      // NAV: navigate on whatever alignment there is
      if (e.state !== 'nav') { e.state = 'nav'; e.ready = e.cep <= 5.6; if (!e.ready) this.say('INS taken to NAV before it was aligned: no attitude or steering. Realign (NORM on the ground, IN FLT ALIGN in the air).', 'caution'); }
    } else if (i.egiKnob === 4 || (i.egiKnob === 2 && (e.moved || !i.wow))) {
      // in-flight alignment, also what a jet that taxies during a ground alignment falls into: needs GPS, 4 and 15 minutes
      if (e.state !== 'ifa') { e.state = 'ifa'; e.t = 0; e.cep = 9.9; }
      if (i.gps) { e.t += i.dt; e.cep = Math.min(e.cep, curve(e.t, 240, 900)); }
      e.ready = e.cep <= 5.6;
    } else {
      if (e.state !== 'align') { e.state = 'align'; e.t = 0; e.cep = 10; e.moved = false; }
      if (moving) { e.moved = true; this.say('INS: the jet moved during the alignment. It continues as an in-flight alignment (needs GPS, takes longer).', 'caution'); return; }
      e.t += i.dt;
      // STOR HDG reuses the heading stored at shutdown: about 90 s to full performance
      e.cep = i.egiKnob === 1 ? curve(e.t, 45, 90) : curve(e.t, 90, 240);
      e.ready = e.cep <= 5.6;
    }
    // free-inertial drift at the alignment's quality; GPS holds the blended solution
    if (e.state === 'nav' && !i.gps) e.drift += e.cep * NM / 3600 * i.dt; else if (i.gps) e.drift = Math.max(0, e.drift - 50 * i.dt);
  }

  private nextStpt(d: number) {
    let k = this.steer;
    for (let n = 0; n < 99; n++) { k = (k + d + 99) % 99; if (this.stpts[k]) return k; }
    return this.steer;
  }

  // ------------------------------------------------------------------ navigation state
  nav(): NavState {
    const i = this.in;
    const e = this.egi;
    const aligning = e.state === 'align' || e.state === 'ifa';
    const align = !aligning ? '' : e.cep <= 0.81 ? 'ALIGN*' : e.cep <= 5.6 ? 'ALIGN' : '';
    let tacan: NavState['tacan'] = null, ils: NavState['ils'] = null;
    if (this.mission && i && i.ufc) {
      const st = this.mission.navaids.find((n) => n.tacan === this.tils.chan && n.band === this.tils.band);
      if (st && !this.tils.aa) {
        const d = Math.hypot(st.x - i.x, st.z - i.z);
        // line of sight, roughly: 1.23·√ft NM
        if (d < 1.23 * Math.sqrt(Math.max(0, (i.alt - st.elev) / FT) + 50) * NM * 1.5) tacan = { name: st.id, bearing: deg360(Math.atan2(st.x - i.x, -(st.z - i.z))), range: d / NM };
      }
      const il = this.mission.navaids.find((n) => Math.abs(n.ils - this.tils.ils) < 0.01);
      if (il) {
        const dx = i.x - il.x, dz = i.z - il.z, h = il.crs * Math.PI / 180;
        const along = -(dx * Math.sin(h) - dz * Math.cos(h)), across = dx * Math.cos(h) + dz * Math.sin(h);
        if (along > 0 && along < 25 * NM && Math.abs(across) < along * 0.2) {
          ils = { name: il.id, loc: Math.atan2(across, along + 1500) * 180 / Math.PI, gs: Math.atan2(i.alt - il.elev, along + 300) * 180 / Math.PI - 3, crs: this.tils.crs || il.crs };
        }
      }
    }
    return {
      steer: this.steer,
      steerpoints: Array.from({ length: this.stpts.length }, (_, k) => this.stpts[k] ?? { name: '', x: 0, z: 0, alt: 0 }),
      insReady: e.ready && (e.state === 'nav' || aligning),
      align, drift: e.drift,
      masterMode: this.masterMode,
      masterArm: i ? (['SIM', 'OFF', 'ARM'] as const)[i.masterArm] ?? 'OFF' : 'OFF',
      bingo: this.bingo.warn,
      alow: this.alow.cara,
      tacan, ils,
    };
  }
  /** the selected steerpoint as the inertial set believes it (its drift included), or null */
  steerPoint(): NavPoint | null {
    const s = this.stpts[this.steer];
    if (!s || !this.egi.ready || this.egi.state === 'off') return null;
    const d = this.egi.drift;
    return d > 1 ? { ...s, x: s.x + Math.cos(this.egi.driftDir) * d, z: s.z + Math.sin(this.egi.driftDir) * d } : s;
  }

  setMasterMode(m: NavState['masterMode']) {
    this.masterMode = this.masterMode === m && (m === 'AA' || m === 'AG') ? 'NAV' : m;
    this.actions.push({ t: 'master', mode: this.masterMode });
  }

  // ------------------------------------------------------------------ integrated control panel
  key(k: IcpKey) {
    if (!this.in?.ufc) return;
    const digit = /^[0-9]$/.test(k);
    switch (k) {
      case 'AA': this.setMasterMode('AA'); return;
      case 'AG': this.setMasterMode('AG'); return;
      case 'COM1': case 'COM2': case 'IFF': case 'LIST':
        // override buttons: a second press returns to the CNI page (2.2.1.2.2)
        this.open(this.page === k ? 'CNI' : k); return;
      case 'RTN': this.open('CNI'); return;
      case 'WARN': if (this.bingo.warn) { this.bingo.warn = false; this.bingo.reset = true; } this.alow.warned = true; return;
    }
    const fields = this.fields();
    if (k === 'UP' || k === 'DOWN') {
      this.scratch = '';
      if (fields.length) this.cursor = (this.cursor + (k === 'DOWN' ? 1 : -1) + fields.length) % fields.length;
      return;
    }
    if (k === 'SEQ') { this.scratch = ''; this.seq(); return; }
    if (k === 'INC' || k === 'DEC') { this.incDec(k === 'INC' ? 1 : -1); return; }
    // menus
    if (this.page === 'LIST' && (digit || k === 'RCL' || k === 'ENTR')) { const p = LIST[k]; if (p) this.open(p); return; }
    if (this.page === 'MISC' && (digit || k === 'RCL')) { const p = MISC[k]; if (p) this.open(p); return; }
    if (this.page === 'CNI' && digit && !this.scratch) { const p = PRIORITY[k]; if (p) this.open(p); return; }
    const f = fields[this.cursor];
    if (digit) {
      // M-SEL (0) on a mode option selects it (2.2.1.2.5.2)
      if (k === '0' && !this.scratch && f?.msel) { f.msel(); return; }
      if (f?.enter && this.scratch.length < 9) { this.scratch += k; this.rclOnce = false; }
      return;
    }
    if (k === 'RCL') {
      // first press drops the last digit, the second clears the entry (2.2.1.2.5.5)
      if (this.rclOnce) { this.scratch = ''; this.rclOnce = false; } else { this.scratch = this.scratch.slice(0, -1); this.rclOnce = true; }
      return;
    }
    if (k === 'ENTR') {
      if (this.scratch && f?.enter) {
        if (f.enter(this.scratch)) { this.scratch = ''; if (fields.length > 1 && this.page !== 'TILS' && this.page !== 'STPT' && this.page !== 'CNI') this.cursor = (this.cursor + 1) % fields.length; }
        else this.scratch = '';
      } else if (this.page === 'MARK') this.takeMark();
    }
  }

  private open(p: Page) {
    this.page = p; this.cursor = 0; this.scratch = ''; this.rclOnce = false; this.wind = false;
    if (p === 'MARK') this.takeMark();
    if (p === 'DEST') this.destSel = this.steer;
  }

  private takeMark() {
    const i = this.in;
    if (!this.egi.ready) return;
    // overfly markpoints go into steerpoints 26–30 (2.2.3.5.3)
    const k = this.markNext;
    this.stpts[k] = { name: `MARK${k - 24}`, x: i.x, z: i.z, alt: i.alt - i.agl, kind: 'mark', tos: this.zulu() };
    this.markNext = k >= 29 ? 25 : k + 1;
  }

  private seq() {
    switch (this.page) {
      case 'CNI': this.wind = !this.wind; break;
      case 'STPT': case 'DEST': this.autoSeq = !this.autoSeq; break;
      case 'TILS': this.tils.aa = !this.tils.aa; break;
      case 'CRUS': this.crus = ({ TOS: 'RNG', RNG: 'HOME', HOME: 'EDR', EDR: 'TOS' } as const)[this.crus]; break;
      case 'LIST': this.open('MISC'); break;
      case 'MISC': this.open('LIST'); break;
    }
  }

  private incDec(d: number) {
    switch (this.page) {
      case 'CNI': case 'STPT': case 'INS': case 'CRUS': this.steer = this.nextStpt(d); break;
      case 'DEST': { let k = this.destSel; for (let n = 0; n < 99; n++) { k = (k + d + 99) % 99; if (this.stpts[k]) break; } this.destSel = k; break; }
      case 'TIME': if (d > 0) this.time.hackOn = !this.time.hackOn; else { this.time.hack = 0; this.time.hackOn = false; } break;
      case 'COM1': this.com.uhf = ((this.com.uhf - 1 + d + 20) % 20) + 1; break;
      case 'COM2': this.com.vhf = ((this.com.vhf - 1 + d + 20) % 20) + 1; break;
      case 'BULL': this.bull.stpt = ((this.bull.stpt - 1 + d + 99) % 99) + 1; break;
    }
  }

  private num(s: string, lo: number, hi: number, set: (v: number) => void) { const v = Number(s); if (!Number.isFinite(v) || v < lo || v > hi) return false; set(v); return true; }

  /** Enterable fields of the page on show, top to bottom. */
  private fields(): Field[] {
    const t = this;
    const stptFields = (sel: () => number, setSel: (k: number) => void): Field[] => {
      const sp = () => this.stpts[sel()];
      const g = () => { const s = sp(); return s ? this.geo(s.x, s.z) : { lat: 0, lon: 0 }; };
      const move = (lat: number, lon: number) => { const s = sp(); if (!s) return false; const q = this.ungeo(lat, lon, s.x, s.z); s.x = q.x; s.z = q.z; return true; };
      return [
        { r: 0, c: 13, w: 2, text: () => String(sel() + 1).padStart(2), enter: (s) => this.num(s, 1, 99, (v) => { if (!this.stpts[v - 1]) { const i = this.in; this.stpts[v - 1] = { name: `STPT${v}`, x: i.x, z: i.z, alt: 0, tos: 0 }; } setSel(v - 1); }) },
        // latitude: 2 (N) or 8 (S) first, then degrees, minutes and thousandths; longitude with 6 (E) or 4 (W)
        { r: 1, c: 8, w: 12, text: () => fmtLat(g().lat), enter: (s) => { const m = /^([28])(\d{2})(\d{2})(\d{0,3})$/.exec(s); if (!m) return false; const v = Number(m[2]) + (Number(m[3]) + Number((m[4] || '0').padEnd(3, '0')) / 1000) / 60; return v <= 90 && move(m[1] === '2' ? v : -v, g().lon); } },
        { r: 2, c: 8, w: 13, text: () => fmtLon(g().lon), enter: (s) => { const m = /^([46])(\d{3})(\d{2})(\d{0,3})$/.exec(s); if (!m) return false; const v = Number(m[2]) + (Number(m[3]) + Number((m[4] || '0').padEnd(3, '0')) / 1000) / 60; return v <= 180 && move(g().lat, m[1] === '6' ? v : -v); } },
        { r: 3, c: 8, w: 5, text: () => String(Math.round((sp()?.alt ?? 0) / FT)).padStart(5), enter: (s) => this.num(s, 0, 80000, (v) => { const p = sp(); if (p) p.alt = v * FT; }) },
        { r: 4, c: 8, w: 8, text: () => hms(sp()?.tos ?? 0), enter: (s) => { const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s.padStart(6, '0')); const p = sp(); if (!m || !p) return false; p.tos = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); return true; } },
      ];
    };
    switch (this.page) {
      case 'CNI': return [{ r: 0, c: 21, w: 2, text: () => String(this.steer + 1).padStart(2), enter: (s) => this.num(s, 1, 99, (v) => { if (this.stpts[v - 1]) this.steer = v - 1; }) }];
      case 'COM1': return [{ r: 1, c: 9, w: 6, text: () => '', enter: (s) => this.comEntry(s, 'uhf') }];
      case 'COM2': return [{ r: 1, c: 9, w: 6, text: () => '', enter: (s) => this.comEntry(s, 'vhf') }];
      case 'IFF': return [{ r: 1, c: 9, w: 5, text: () => '', enter: (s) => {
        // first digit selects the mode: 1xx mode 1, 3xxxx mode 3
        if (/^1[0-7][0-3]$/.test(s)) { this.iff.m1 = Number(s.slice(1)); return true; }
        if (/^3[0-7]{4}$/.test(s)) { this.iff.m3 = Number(s.slice(1)); return true; }
        return false;
      } }];
      case 'TILS': return [
        { r: 1, c: 8, w: 6, text: () => '', enter: (s) => {
          // 0 toggles the band, 1–126 is a TACAN channel, four or five digits an ILS frequency (2.2.1.2.6.1.6)
          if (s === '0') { this.tils.band = this.tils.band === 'X' ? 'Y' : 'X'; return true; }
          const v = Number(s);
          if (s.length <= 3) return this.num(s, 1, 126, (c) => { this.tils.chan = c; });
          const f = s.length === 4 ? v / 10 : v / 100;
          if (f < 108.1 || f > 111.95) return false;
          this.tils.ils = f; return true;
        } },
        { r: 2, c: 13, w: 8, text: () => 'CMD STRG', msel: () => { t.tils.cmdStrg = !t.tils.cmdStrg; } },
        { r: 4, c: 18, w: 3, text: () => String(Math.round(this.tils.crs)).padStart(3, '0'), enter: (s) => this.num(s, 0, 360, (v) => { this.tils.crs = v % 360; }) },
      ];
      case 'ALOW': return [
        { r: 2, c: 15, w: 5, text: () => String(this.alow.cara).padStart(5), enter: (s) => this.num(s, 0, 50000, (v) => { this.alow.cara = v; this.alow.warned = false; }) },
        { r: 3, c: 15, w: 5, text: () => String(this.alow.floor).padStart(5), enter: (s) => this.num(s, 0, 80000, (v) => { this.alow.floor = v; }) },
      ];
      case 'STPT': return stptFields(() => this.steer, (k) => { this.steer = k; });
      case 'DEST': return stptFields(() => this.destSel, (k) => { this.destSel = k; });
      case 'BINGO': return [{ r: 2, c: 11, w: 5, text: () => String(this.bingo.lb).padStart(5), enter: (s) => this.num(s, 0, 20000, (v) => { this.bingo.lb = v; this.bingo.reset = false; this.bingo.warn = false; }) }];
      case 'TIME': return [{ r: 3, c: 13, w: 8, text: () => hms(Math.abs(this.time.deltaTos)), enter: (s) => {
        // a leading 0 makes it negative: arrive earlier everywhere (2.2.1.2.6.1.11)
        const neg = s.length > 1 && s[0] === '0';
        const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s.slice(neg ? 1 : 0).padStart(6, '0'));
        if (!m) return false;
        const d = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * (neg ? -1 : 1);
        for (const p of this.stpts) if (p && p.tos) p.tos += d - this.time.deltaTos;
        this.time.deltaTos = d; return true;
      } }];
      case 'MAN': return [{ r: 2, c: 13, w: 3, text: () => String(this.man).padStart(3), enter: (s) => this.num(s, 10, 200, (v) => { this.man = v; }) }];
      case 'BULL': return [{ r: 1, c: 7, w: 8, text: () => 'BULLSEYE', msel: () => { t.bull.on = !t.bull.on; } }];
      case 'MARK': return [{ r: 0, c: 10, w: 4, text: () => 'OFLY', msel: () => { const k = (t.markNext + 4 - 25) % 5 + 25; if (t.stpts[k]) t.steer = k; } }];
      default: return [];
    }
  }

  private comEntry(s: string, r: 'uhf' | 'vhf') {
    const v = Number(s);
    if (s.length <= 2) return this.num(s, 1, 20, (c) => { this.com[r] = c; });
    const f = s.length === 5 ? v / 100 : v / 1000;
    if (r === 'uhf' && (f < 225 || f > 399.975)) return false;
    if (r === 'vhf') return f >= 108 && f <= 151.975;
    this.com.uhfFreq[this.com.uhf] = f;
    return true;
  }

  // ------------------------------------------------------------------ data entry display
  display(id: string): string[] {
    if (id === 'pfld') return this.in?.ufc ? this.faults.rows(COLS) : ['', '', '', ''];
    if (id !== 'ded' || !this.in?.ufc) return new Array(ROWS).fill('');
    const b = new Buf();
    this.draw(b);
    const fields = this.fields();
    fields.forEach((f, k) => {
      const active = k === this.cursor;
      const txt = active && this.scratch ? this.scratch.padStart(f.w).slice(-f.w) : f.text();
      if (txt) b.put(f.r, f.c, txt.padEnd(f.w).slice(0, f.w), !!f.msel && this.mselOn(f));
      if (active) { b.put(f.r, f.c - 1, '*'); b.put(f.r, f.c + f.w, '*'); }
    });
    return b.rows();
  }
  private mselOn(f: Field) { const s = f.text(); return (s === 'CMD STRG' && this.tils.cmdStrg) || (s === 'BULLSEYE' && this.bull.on); }

  private draw(b: Buf) {
    const i = this.in;
    const zulu = this.zulu();
    const sp = this.stpts[this.steer];
    const here = this.geo(i.x, i.z);
    const arrow = '↕';
    const na = (title: string) => { b.centre(0, title); b.centre(2, 'NOT IMPLEMENTED'); };
    switch (this.page) {
      case 'CNI': {
        b.put(0, 0, `UHF  ${this.com.uhfFreq[this.com.uhf].toFixed(2)}`);
        b.put(0, 14, `STPT ${arrow}`);
        if (this.autoSeq) b.put(0, 23, 'A');
        b.put(2, 0, `VHF  ${String(this.com.vhf).padStart(2)}`);
        b.put(2, 16, hms(zulu));
        if (this.wind) b.put(1, 15, `${String(Math.round(deg360(0.6 + i.time * 1e-4))).padStart(3, '0')}° ${String(i.wow ? 0 : 12).padStart(2)}KT`);
        if (this.time.hackOn || this.time.hack > 0) b.put(3, 16, hms(this.time.hack));
        b.put(4, 0, `M1 ${String(this.iff.m1).padStart(2, '0')}3C ${String(this.iff.m3).padStart(4, '0')}`);
        b.put(4, 15, `MAN T${String(this.tils.chan).padStart(3)}${this.tils.band}`);
        break;
      }
      case 'COM1': case 'COM2': {
        const u = this.page === 'COM1';
        b.put(0, 0, `${u ? 'UHF' : 'VHF'}  ON`); b.put(0, 17, u ? 'MAIN' : '');
        b.put(2, 2, u ? this.com.uhfFreq[this.com.uhf].toFixed(2) : `${(118 + this.com.vhf * 0.5).toFixed(2)}`);
        b.put(3, 0, `PRE ${String(u ? this.com.uhf : this.com.vhf).padStart(2)}${arrow}`); b.put(3, 18, 'TOD');
        b.put(4, 2, u ? this.com.uhfFreq[this.com.uhf].toFixed(2) : `${(118 + this.com.vhf * 0.5).toFixed(2)}`); b.put(4, 18, 'WB');
        break;
      }
      case 'IFF':
        b.put(0, 0, 'IFF  ON'); b.put(0, 13, 'MAN');
        b.put(2, 0, `M1 ${String(this.iff.m1).padStart(2, '0')}`); b.put(2, 9, 'M4 B(6)');
        b.put(3, 0, `M3 ${String(this.iff.m3).padStart(4, '0')}`); b.put(3, 9, 'MC (5)');
        b.put(4, 0, 'M2 0000'); b.put(4, 9, 'MS (8)');
        break;
      case 'LIST':
        b.centre(0, 'LIST');
        b.put(1, 0, '1DEST 2BNGO 3VIP  RINTG');
        b.put(2, 0, '4NAV  5MAN  6INS  EDLNK');
        b.put(3, 0, '7EWS  8MODE 9VRP  0MISC');
        break;
      case 'MISC':
        b.centre(0, 'MISC');
        b.put(1, 0, '1CORR 2MAGV 3OFP  RHMCS');
        b.put(2, 0, '4INSM 5LASR 6GPS  E');
        b.put(3, 0, '7DRNG 8BULL 9WPT  0HARM');
        break;
      case 'TILS':
        b.put(0, 0, `TCN ${this.tils.aa ? 'A/A TR' : 'T/R'}`); b.put(0, 13, 'ILS ON');
        b.put(2, 0, `CHAN ${String(this.tils.chan).padStart(3)}`);
        b.put(3, 0, `BAND   ${this.tils.band}(0)`); b.put(3, 12, `FRQ  ${this.tils.ils ? this.tils.ils.toFixed(2) : '------'}`);
        b.put(4, 12, 'CRS'); b.put(4, 21, '°');
        break;
      case 'ALOW':
        b.centre(0, 'ALOW');
        b.put(2, 3, 'CARA ALOW'); b.put(2, 21, 'FT');
        b.put(3, 3, 'MSL FLOOR'); b.put(3, 21, 'FT');
        b.put(4, 0, 'TF ADV (MSL)     400FT');
        break;
      case 'STPT': case 'DEST': {
        const dest = this.page === 'DEST';
        b.put(0, 6, dest ? 'DEST' : 'STPT'); b.put(0, 17, arrow); b.put(0, 20, dest ? 'DIR' : this.autoSeq ? 'AUTO' : 'MAN');
        b.put(1, 3, 'LAT'); b.put(2, 3, 'LNG'); b.put(3, 2, 'ELEV'); b.put(3, 14, 'FT'); b.put(4, 3, 'TOS');
        break;
      }
      case 'CRUS': {
        const gs = Math.max(i.gs, 1);
        const d = sp ? Math.hypot(sp.x - i.x, sp.z - i.z) : 0;
        const hp = this.stpts[this.home];
        const burn = (dist: number) => i.fuelFlowPph * (dist / gs) / 3600;
        b.put(0, 5, 'CRUS'); b.put(0, 11, this.crus, true);
        if (this.crus === 'TOS') {
          b.put(1, 4, `SYSTEM   ${hms(zulu)}`);
          b.put(2, 4, `DES TOS  ${hms(sp?.tos ?? 0)}`);
          b.put(3, 7, `ETA   ${hms(zulu + d / gs)}`);
          const left = (sp?.tos ?? 0) - zulu;
          b.put(4, 3, `RQD G/S   ${left > 5 ? String(Math.min(1700, Math.round(d / left / KT))).padStart(4) : '----'}KTS`);
        } else if (this.crus === 'RNG') {
          b.put(1, 6, `STPT ${arrow} ${String(this.steer + 1).padStart(2)}`);
          b.put(2, 6, `FUEL  ${String(Math.max(0, Math.round(i.fuelLb - burn(d)))).padStart(5, '0')}LBS`);
          b.put(4, 6, 'WIND  036° 12KTS');
        } else if (this.crus === 'HOME') {
          const dh = hp ? Math.hypot(hp.x - i.x, hp.z - i.z) : 0;
          b.put(1, 6, `HMPT ${arrow} ${String(this.home + 1).padStart(2)}`);
          b.put(2, 6, `FUEL  ${String(Math.max(0, Math.round(i.fuelLb - burn(dh)))).padStart(5, '0')}LBS`);
          b.put(3, 3, 'OPT ALT  32000FT');
          b.put(4, 6, 'WIND  036° 12KTS');
        } else {
          const tb = i.fuelFlowPph > 50 ? Math.max(0, (i.fuelLb - this.bingo.lb) / i.fuelFlowPph * 3600) : 0;
          b.put(1, 6, `STPT ${arrow} ${String(this.steer + 1).padStart(2)}`);
          b.put(2, 3, `TO BNGO  ${hms(tb)}`);
          b.put(3, 2, 'OPT MACH      0.62');
          b.put(4, 6, 'WIND  036° 12KTS');
        }
        break;
      }
      case 'TIME':
        b.centre(0, 'TIME');
        b.put(1, 3, `SYSTEM   ${hms(zulu)}`);
        b.put(2, 5, `HACK   ${hms(this.time.hack)}`);
        b.put(3, 2, `DELTA TOS${this.time.deltaTos < 0 ? '-' : ' '}`);
        b.put(4, 3, 'MM/DD/YY  11/14/26');
        break;
      case 'MARK': {
        const k = (this.markNext + 4 - 25) % 5 + 25, m = this.stpts[k];
        const g = m ? this.geo(m.x, m.z) : here;
        b.put(0, 4, 'MARK'); b.put(0, 17, `${arrow}${k + 1}`);
        b.put(1, 3, `LAT  ${fmtLat(g.lat)}`); b.put(2, 3, `LNG  ${fmtLon(g.lon)}`);
        b.put(3, 2, `ELEV  ${String(Math.round((m?.alt ?? 0) / FT)).padStart(5)}FT`);
        if (!this.egi.ready) b.centre(4, 'INS NOT ALIGNED');
        break;
      }
      case 'BINGO':
        b.centre(0, 'BINGO');
        b.put(2, 5, 'SET'); b.put(2, 17, 'LBS');
        b.put(3, 3, `TOTAL    ${String(Math.round(i.fuelLb)).padStart(5, '0')}LBS`);
        break;
      case 'INS': {
        const e = this.egi;
        const st = e.state === 'off' ? 'OFF' : e.state === 'nav' ? 'NAV' : `${(e.t / 60).toFixed(1).padStart(4, '0')}/${e.cep.toFixed(1).padStart(4)}`;
        b.put(0, 0, `INS ${st}`);
        // RDY: steady when a degraded alignment is available, flashing at full accuracy (2.2.3.3.1)
        const rdy = (e.state === 'align' || e.state === 'ifa') && e.cep <= 5.6 && (e.cep > 0.81 || this.flash % 1 < 0.6);
        if (rdy) b.put(0, 15, 'RDY');
        b.put(0, 20, `${arrow}${String(this.steer + 1).padStart(2)}`);
        if (e.state !== 'off') {
          b.put(1, 1, `LAT  ${fmtLat(here.lat)}`); b.put(2, 1, `LNG  ${fmtLon(here.lon)}`);
          b.put(3, 0, `SALT ${String(Math.round(i.alt / FT)).padStart(6)}FT`);
          b.put(4, 0, `THDG ${deg360(i.hdg).toFixed(1).padStart(5)}°`); b.put(4, 14, `G/S ${String(Math.round(i.gs / KT)).padStart(4)}`);
        }
        break;
      }
      case 'EWS': {
        const fc = i.fc;
        b.put(0, 3, 'EWS  CHAFF  FLARE');
        b.put(1, 8, `${String(fc?.chaff ?? 0).padStart(4)}   ${String(fc?.flares ?? 0).padStart(4)}`);
        b.put(2, 1, 'REQJAM  OFF'); b.put(3, 1, 'FDBK    ON'); b.put(4, 1, 'BINGO   ON');
        break;
      }
      case 'MODE':
        b.centre(0, 'MODE'); b.put(2, 4, `A-A   ${this.masterMode === 'AA' ? 'SEL' : '   '}`); b.put(3, 4, `A-G   ${this.masterMode === 'AG' ? 'SEL' : '   '}`);
        break;
      case 'MAN':
        b.centre(0, 'MAN'); b.put(2, 4, 'WSPAN'); b.put(2, 17, 'FT'); b.put(3, 4, 'MBAL');
        break;
      case 'MAGV': b.centre(0, 'MAGV  AUTO'); b.centre(2, `${here.lon >= 0 ? 'E' : 'W'} ${(Math.abs(here.lon) % 7).toFixed(1)}°`); break;
      case 'OFP':
        b.centre(0, 'OFP1');
        b.put(1, 1, 'UFC  P07A   FCR  7010'); b.put(2, 1, 'MFD  P07A   FCC  P07B'); b.put(3, 1, 'SMS  P07A   DTE  P010'); b.put(4, 1, 'FDR  P30A   GPS  P040');
        break;
      case 'LASR': b.centre(0, 'LASER'); b.put(1, 2, 'TGP CODE    1688'); b.put(2, 2, 'LST CODE    1688'); b.put(3, 2, 'A-G: CMBT  A-A: TRNG'); b.put(4, 2, 'LASER ST TIME   8SEC'); break;
      case 'GPS': b.centre(0, 'GPS'); b.put(1, 2, `GPS ${i.gps ? 'HIGH ACCURACY' : 'OFF'}`); b.put(2, 2, `TIME  ${hms(zulu)}`); b.put(3, 2, `DRIFT ${String(Math.round(this.egi.drift)).padStart(5)} M`); break;
      case 'BULL': b.put(1, 16, `BULL ${arrow}${String(this.bull.stpt).padStart(2)}`); break;
      case 'INSM': b.centre(0, 'INSM'); b.put(1, 2, 'HDG ERR   0.0°'); b.put(2, 2, 'X VEL ERR 0.0'); break;
      case 'DRNG': b.centre(0, 'DRNG'); b.put(2, 2, 'DRNG       0FT'); b.put(3, 2, 'XRNG       0FT'); break;
      case 'HARM': b.centre(0, 'HARM'); b.put(1, 2, 'TBL1'); b.put(2, 2, 'T1 103   T2 115'); b.put(3, 2, 'T3 117   T4 119'); break;
      case 'HMCS': b.centre(0, 'HMCS DISPLAY'); b.put(1, 2, 'HUD BLNK'); b.put(2, 2, 'CKPT BLNK'); b.put(3, 2, 'DECLUTTER LVL1'); break;
      case 'WPT': b.centre(0, 'WPT'); b.centre(2, 'NO WEAPON STATION'); break;
      case 'CORR': b.centre(0, 'CORR HUD'); b.put(2, 2, 'CTVS  0.0   CAMERA 0.0'); break;
      case 'VIP': b.put(0, 3, 'VIP-TO-TGT'); b.put(1, 4, `VIP  ${arrow} ${String(this.steer + 1).padStart(2)}`); b.put(2, 3, 'TBRG   0.0°'); b.put(3, 4, 'RNG       0FT'); b.put(4, 3, 'ELEV       0FT'); break;
      case 'VRP': b.put(0, 3, 'TGT-TO-VRP'); b.put(1, 4, `TGT  ${arrow} ${String(this.steer + 1).padStart(2)}`); b.put(2, 3, 'TBRG   0.0°'); b.put(3, 4, 'RNG       0FT'); b.put(4, 3, 'ELEV       0FT'); break;
      case 'INTG': b.put(0, 0, 'INTG  ON'); b.put(1, 0, 'M1 13'); b.put(2, 0, 'M2 0000'); b.put(3, 0, 'M3 6400'); b.put(4, 0, 'M4 B(6)   COUPLE(0)'); break;
      case 'DLNK': b.centre(0, 'A-G DL'); b.put(1, 1, 'COMM UHF   OWN #11'); b.put(2, 1, 'DATA 16K   LASER IDM'); b.put(3, 1, 'FILL ALL'); break;
      case 'NAV': na('NAV STATUS'); break;
      case 'DTS': na('DTS'); break;
      case 'FIX': na('FIX'); break;
      case 'ACAL': na('ACAL'); break;
    }
  }

  // ------------------------------------------------------------------ multifunction displays (2.1.6)
  /** step a display to its next format slot (the DMS on the stick does this) */
  mfdNext(i: number) { const u = this.mfds[i]; if (u) { u.slot = (u.slot + 1) % 3; u.menu = false; } }

  mfdPress(i: number, osb: number) {
    const u = this.mfds[i];
    if (!u || !this.in?.mfd) return;
    // bottom row: OSB 15 swaps the two displays, 14–12 are the three format slots (2.1.6.2)
    if (osb === 15) { const a = this.mfds[0], b = this.mfds[1]; this.mfds = [b, a]; return; }
    if (osb >= 12 && osb <= 14) {
      const s = 14 - osb;
      if (u.slot === s) u.menu = !u.menu; else { u.slot = s; u.menu = false; }
      return;
    }
    if (u.menu) {
      const m = MFD_MENU.find(([o]) => o === osb);
      if (m) { u.slots[u.slot] = m[1]; u.menu = false; }
      return;
    }
    const f = u.slots[u.slot];
    const fc = this.in.fc;
    switch (f) {
      case 'FCR':
        if (osb === 1) this.actions.push({ t: 'radarMode', mode: fc?.radarMode === 'ACM' ? 'RWS' : 'ACM' });
        if (osb === 2) this.actions.push({ t: 'radarMode', mode: fc?.radarMode === 'TWS' ? 'RWS' : 'TWS' });
        if (osb === 4) this.actions.push({ t: 'radarMode', mode: fc?.radarMode === 'OFF' ? 'RWS' : 'OFF' });
        if (osb === 18) this.actions.push({ t: 'radarAz' });
        if (osb === 19) this.actions.push({ t: 'radarRange', d: -1 });
        if (osb === 20) this.actions.push({ t: 'radarRange', d: 1 });
        break;
      case 'HSD':
        if (osb === 1) this.hsd.cen = !this.hsd.cen;
        if (osb === 2) this.hsd.coupled = !this.hsd.coupled;
        if (osb === 19) this.hsd.range = Math.max(0, this.hsd.range - 1);
        if (osb === 20) this.hsd.range = Math.min(HSD_RANGES.length - 1, this.hsd.range + 1);
        break;
      case 'SMS':
        if (osb === 1) this.setMasterMode(this.masterMode === 'AA' ? 'AG' : 'AA');
        if (osb === 6) this.actions.push({ t: 'weaponNext' });
        break;
      case 'TEST':
        if (osb === 1) this.testPage = (this.testPage + 1) % 3;
        if (osb === 3) this.faults.clearMfl(this.in.time);
        break;
      case 'DTE':
        // LOAD reads the whole cartridge (2.1.6.13)
        if (osb === 3 && this.dte.t < 0 && this.in.mmc) this.dte.t = 0;
        break;
    }
  }

  mfd(i: number): MfdView {
    const u = this.mfds[i];
    const osb: MfdView['osb'] = new Array(20).fill(null);
    const set = (n: number, text: string, on = false) => { osb[n - 1] = { text, on }; };
    if (!u || !this.in?.mfd) return { format: 'OFF', osb };
    const f = u.menu ? 'MENU' : u.slots[u.slot];
    // the three slots along the bottom, the one on show highlighted
    u.slots.forEach((s, k) => set(14 - k, s === 'BLANK' ? '' : s, k === u.slot));
    set(15, 'SWAP');
    const lines: NonNullable<MfdView['lines']> = [];
    const data: NonNullable<MfdView['data']> = {};
    const fc = this.in.fc;
    switch (f) {
      case 'MENU': for (const [o, name] of MFD_MENU) set(o, name === 'RESET' ? 'RESET MENU' : name, name === u.slots[u.slot]); break;
      case 'FCR':
        set(1, fc?.radarMode === 'ACM' ? 'ACM' : 'CRM'); set(2, fc?.radarMode === 'TWS' ? 'TWS' : 'RWS'); set(3, 'NORM'); set(4, 'OVRD', fc?.radarMode === 'OFF'); set(5, 'CNTL');
        set(18, `A${Math.max(1, Math.round((fc?.radarAz ?? 60) / 10))}`); set(17, '4B'); set(19, '▼'); set(20, '▲'); set(11, 'DCLT');
        break;
      case 'HSD':
        set(1, this.hsd.cen ? 'CEN' : 'DEP'); set(2, this.hsd.coupled ? 'CPL' : 'DCPL'); set(3, 'NORM'); set(5, 'CNTL'); set(7, 'FZ'); set(19, '▼'); set(20, '▲'); set(11, 'DCLT');
        data.rangeNm = this.hsd.coupled && fc ? Math.max(15, Math.min(240, fc.radarRangeNm * (this.hsd.cen ? 1 : 1.5))) : HSD_RANGES[this.hsd.range] * (this.hsd.cen ? 2 / 3 : 1);
        data.cen = this.hsd.cen;
        data.bull = this.bull.on ? this.bull.stpt - 1 : -1;
        break;
      case 'SMS':
        set(1, this.masterMode === 'AG' ? 'A-G' : this.masterMode === 'AA' ? 'A-A' : 'STBY'); set(4, 'INV', true); set(6, fc?.selWeapon ? 'STEP' : ''); set(11, 'S-J');
        break;
      case 'TEST': {
        set(1, `BIT${this.testPage + 1}`); set(3, 'CLR');
        const names = [['MFDS', 'RALT', 'TGP', 'FINS', 'TFR'], ['IFF', 'CMDS', 'MIDS', 'BLKR', 'IDM'], ['EHSIS', 'EHSIM', 'HMCS', 'RECCE', '']][this.testPage];
        const right = [['INS', 'SMS', 'FCR', 'DTE', ''], ['MMC', 'FDR', 'GPS', 'UFC', ''], ['', '', '', '', '']][this.testPage];
        names.forEach((n, k) => { if (n) set(20 - k, n); });
        right.forEach((n, k) => { if (n) set(6 + k, n); });
        const t = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        // subsystem, test number, occurrences, time of the first one (7.1.2)
        this.faults.mfl().slice(0, 12).forEach((r, k) => lines.push({ text: `${r.mfl.padEnd(5)} ${r.test ? String(r.test).padStart(3, '0') : '   '} ${r.count}  ${t(r.time)}`, x: 0.5, y: 0.2 + k * 0.05, align: 'center' }));
        if (!this.faults.mfl().length) lines.push({ text: 'NO FAULTS', x: 0.5, y: 0.45, align: 'center' });
        break;
      }
      case 'FLCS': {
        const list = this.faults.active('FLCS');
        lines.push({ text: 'FLCS', x: 0.5, y: 0.14, align: 'center' });
        list.slice(0, 5).forEach((d, k) => lines.push({ text: d.level === 'warning' ? `>${d.text}<` : d.text, x: 0.5, y: 0.3 + k * 0.07, align: 'center', on: d.level === 'warning' }));
        data.flcs = true;
        break;
      }
      case 'DTE': {
        set(3, 'LOAD', this.dte.t >= 0);
        const blocks = ['FCR', 'DLNK', 'MPD', 'COMM', 'INV', 'PROF', 'ELINT', 'NCTR'];
        const done = this.dte.t < 0 ? (this.loaded ? blocks.length : 0) : Math.floor(this.dte.t / 6 * blocks.length);
        blocks.forEach((n, k) => { const o = k < 4 ? 20 - k : 6 + (k - 4); set(o, n, this.dte.t >= 0 && k === done); });
        lines.push({ text: this.dte.t >= 0 ? 'LOADING' : this.loaded ? 'DTC LOADED' : 'DTC ID 000', x: 0.5, y: 0.45, align: 'center' });
        if (!this.in.mmc) lines.push({ text: 'MMC OFF', x: 0.5, y: 0.55, align: 'center' });
        break;
      }
      case 'RESET':
        set(6, 'SBC DAY RESET'); set(7, 'SBC NIGHT RESET'); set(8, 'SBC DFLT RESET'); set(10, 'NVIS OVRD'); set(20, 'MSMD RESET'); set(19, 'PROG DCLT RESET');
        break;
      case 'BLANK': case 'RWR': break;
      default:
        lines.push({ text: f, x: 0.5, y: 0.42, align: 'center', size: 1.4 });
        lines.push({ text: f === 'TGP' || f === 'FLIR' || f === 'TFR' ? 'NO POD' : 'NOT INSTALLED', x: 0.5, y: 0.52, align: 'center' });
    }
    return { format: f, osb, lines, data };
  }
}
