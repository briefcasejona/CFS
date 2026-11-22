// The start-up checklist for a cold and dark ramp start, in the order of the DCS F-16C Viper Guide, part 4 (A – E).
// Each step ticks itself off when the cockpit or the systems show it done. The steps are short paraphrases with the
// guide's step numbers; the guide is the reference for the full procedure.
import type { CockpitPanel } from './cockpit/controls.js';
import { ENG_FEED, AIR_SOURCE, JFS, MAIN_POWER, PBRAKE, type F16Systems } from './systems.js';

export interface StartupStep {
  /** the guide's step number(s) */
  ref: string;
  text: string;
  done: (p: CockpitPanel, s: F16Systems, seen: Set<string>) => boolean;
}

/** INS knob detents, counted from fully anticlockwise: OFF, STOR HDG, NORM, NAV, … (ASSUMED order of the model's 6-detent knob) */
const INS_NORM = 2, INS_NAV = 3;

export const STARTUP_STEPS: StartupStep[] = [
  { ref: 'A3', text: 'MAIN PWR – MAIN PWR', done: (p) => p.get('MAIN_POWER') === MAIN_POWER.MAIN },
  { ref: 'B6', text: 'Parking brake – PARKING BRAKE', done: (p, _s, seen) => seen.has('pbrake') || p.get('PBRAKE') === PBRAKE.PARK },
  { ref: 'C10', text: 'ENG FEED – NORM', done: (p) => p.get('ENG_FEED') === ENG_FEED.NORM },
  { ref: 'C11', text: 'AIR SOURCE – NORM', done: (p) => p.get('AIR_SOURCE') === AIR_SOURCE.NORM },
  { ref: 'C12', text: 'Throttle – OFF', done: (_p, s, seen) => seen.has('jfs') || s.throttleOff },
  { ref: 'C13', text: 'JFS – START 2', done: (p, s, seen) => seen.has('jfs') || p.get('JFS') === JFS.START2 || s.jfsOn },
  { ref: 'C14', text: 'JFS RUN light on', done: (_p, s, seen) => seen.has('jfsRun') || s.jfsOn },
  { ref: 'C16', text: 'At 20 – 25 % rpm: throttle – IDLE', done: (_p, s) => s.lit },
  { ref: 'C19–22', text: 'Main generator on, engine stable at idle', done: (_p, s) => s.lit && s.mainGen && s.rpm >= 60 },
  { ref: 'D23–27', text: 'MMC, ST STA, MFD, GPS – ON', done: (p) => ['MCC', 'ST_STA', 'MFD', 'GPS'].every((id) => p.get(id) === 1) },
  { ref: 'D34–36', text: 'UHF radio – ON (BOTH)', done: (p) => p.get('UHF_PWR') >= 1 },
  { ref: 'D37', text: 'HUD SYM wheel – up', done: (p) => p.get('ICP_SYM') > 0.1 },
  { ref: 'E39', text: 'INS – NORM (align)', done: (p, _s, seen) => seen.has('insNorm') || p.get('INS_FUNCTION') === INS_NORM },
  { ref: 'E43', text: 'INS – NAV', done: (p) => p.get('INS_FUNCTION') === INS_NAV },
  { ref: 'Taxi', text: 'Parking brake – release (ANTI-SKID)', done: (p, _s, seen) => seen.has('pbrake') && p.get('PBRAKE') !== PBRAKE.PARK },
];

/** Tracks the start-up: what has been seen done once stays done where the procedure moves on from it. */
export class StartupChecklist {
  private seen = new Set<string>();
  constructor(readonly panel: CockpitPanel, readonly sys: F16Systems) {}

  /** Each frame: the state of every step. */
  update(): boolean[] {
    const p = this.panel, s = this.sys;
    if (p.get('PBRAKE') === PBRAKE.PARK) this.seen.add('pbrake');
    if (p.get('JFS') === JFS.START2 || p.get('JFS') === JFS.START1 || s.jfsOn) this.seen.add('jfs');
    if (s.jfsOn) this.seen.add('jfsRun');
    if (p.get('INS_FUNCTION') === INS_NORM) this.seen.add('insNorm');
    return STARTUP_STEPS.map((st) => st.done(p, s, this.seen));
  }

  /** The checklist as text: done steps ticked, the next one marked. */
  text(): string {
    const st = this.update();
    const next = st.indexOf(false);
    return 'START-UP (DCS F-16C guide, part 4)\n' + STARTUP_STEPS.map((s, i) =>
      `${st[i] ? '✓' : i === next ? '›' : ' '} ${s.ref.padEnd(7)} ${s.text}`).join('\n');
  }

  get complete() { return this.update().every(Boolean); }
}
