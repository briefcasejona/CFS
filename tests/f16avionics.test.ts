// The F-16 displays: MFD format switching by OSB (Dash-34 2.1.6.7 – 2.1.6.9), the DED CNI page, the OSB wiring to
// the cockpit buttons, and the start-up checklist.
import { describe, expect, it } from './expect.js';
import { CockpitPanel } from '../src/f16/cockpit/controls.js';
import { Mfds } from '../src/f16/avionics/mfd.js';
import { dedLines, DED_COLS } from '../src/f16/avionics/ded.js';
import { F16Avionics } from '../src/f16/avionics/avionics.js';
import { F16Systems, MAIN_POWER } from '../src/f16/systems.js';
import { StartupChecklist, STARTUP_STEPS } from '../src/f16/startup.js';

describe('F-16 MFDs', () => {
  it('pressing the selected format opens MENU; a MENU OSB puts that format in the slot', () => {
    const m = new Mfds();
    expect(m.shown(0)).toBe('FLCS');
    m.press(0, 13);                 // the selected slot again
    expect(m.shown(0)).toBe('MENU');
    m.press(0, 7);                  // HSD on the MENU page
    expect(m.shown(0)).toBe('HSD');
    expect(m.mfd[0].slots[1]).toBe('HSD');
  });
  it('another slot selects its format, SWAP exchanges the displays', () => {
    const m = new Mfds();
    m.press(0, 12);
    expect(m.shown(0)).toBe('TEST');
    m.press(0, 15);
    expect(m.shown(0)).toBe('HSD');
    expect(m.shown(1)).toBe('TEST');
  });
  it('ROSB buttons drive the left MFD, LOSB the right one', () => {
    const panel = new CockpitPanel();
    const av = new F16Avionics(panel);
    panel.set('ROSB12', 1); panel.set('ROSB12', 0);
    expect(av.mfds.shown(0)).toBe('TEST');
    panel.set('LOSB14', 1); panel.set('LOSB14', 0);
    expect(av.mfds.shown(1)).toBe('SMS');
  });
});

describe('F-16 DED', () => {
  it('CNI page: 5 lines of 24 characters with the steerpoint', () => {
    const l = dedLines({ uhf: '292.30', vhf: '1', stpt: 3, time: '12:00:00', iff: 'M1 3 C', tacan: '75X' });
    expect(l.length).toBe(5);
    expect(l.every((s) => s.length === DED_COLS)).toBe(true);
    expect(l[0].includes('STPT')).toBe(true);
    expect(l[0].trimEnd().endsWith('3')).toBe(true);
  });
});

describe('F-16 start-up checklist', () => {
  it('ticks MAIN PWR when it is set, and is not complete in a cold jet', () => {
    const panel = new CockpitPanel();
    const sys = new F16Systems(panel, 'F100-PW-229');
    sys.setCold(1000);
    const c = new StartupChecklist(panel, sys);
    expect(c.update()[0]).toBe(false);
    panel.set('MAIN_POWER', MAIN_POWER.MAIN);
    expect(c.update()[0]).toBe(true);
    expect(c.complete).toBe(false);
    expect(c.text().split('\n').length).toBe(STARTUP_STEPS.length + 1);
  });
});
