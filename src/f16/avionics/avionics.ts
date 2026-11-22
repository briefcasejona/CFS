// The player F-16's displays: MFDs, DED and HUD, fed from the jet, its systems and the mission's steerpoints.
// Their power follows the cockpit switches (DCS F-16C Viper Guide part 4, steps 23 – 37: MFD switch for the MFDs,
// the SYM wheel turns the HUD on) and the electrical buses (Dash-1 6).
import * as THREE from 'three';
import type { Aircraft } from '../../sim/entities.js';
import type { CockpitPanel } from '../cockpit/controls.js';
import type { F16Systems } from '../systems.js';
import type { CockpitScreens } from '../cockpit/screens.js';
import { WEAPONS } from '../../weapons/stores.js';
import { NM } from '../../sim/atmosphere.js';
import { Mfds, drawMfd, type MfdData } from './mfd.js';
import { dedLines, drawDed } from './ded.js';
import { bodyAngles, drawHud, HUD_PX } from './hud.js';

const M_TO_FT = 3.28084;

export class F16Avionics {
  readonly mfds = new Mfds();
  steerIndex = 0;
  alowFt = 300;
  gMax = 1;
  private nextSlow = 0;

  constructor(readonly panel: CockpitPanel) {
    // OSB presses: the ROSB buttons are the left MFD's, the LOSB buttons the right MFD's (Jonathan, 2026-11-22)
    panel.listeners.push((ch) => {
      if (ch.to !== 1) return;
      const m = /^([LR])OSB(\d+)$/.exec(ch.id);
      if (m) this.mfds.press(m[1] === 'R' ? 0 : 1, +m[2]);
    });
  }

  /** Draw every display (each frame; the MFDs and DED at 10 Hz). */
  draw(scr: CockpitScreens, ac: Aircraft, sys: F16Systems, steerpoints: Array<{ pos: THREE.Vector3; name: string }>, time: number) {
    const fm = ac.fm;
    this.gMax = Math.max(this.gMax, fm.nz);
    const pwr = sys.emergencyBus;
    // ---- HUD
    if (scr.hud) {
      const att = fm.attitude();
      const vel = fm.vel.lengthSq() > 4 ? bodyAngles(fm.quat, fm.vel) : { az: 0, el: -fm.alpha * 180 / Math.PI };
      const sp = steerpoints[this.steerIndex];
      let stpt = null;
      if (sp) {
        const d = sp.pos.clone().sub(ac.pos);
        const a = bodyAngles(fm.quat, d);
        const brg = Math.atan2(d.x, -d.z) * 180 / Math.PI;
        let rel = brg - att.hdg * 180 / Math.PI; rel = ((rel + 540) % 360) - 180;
        const gs = Math.max(1, Math.hypot(fm.vel.x, fm.vel.z));
        stpt = { az: a.az, el: a.el, nm: Math.hypot(d.x, d.z) / NM, n: this.steerIndex + 1, ttgS: Math.hypot(d.x, d.z) / gs, bearingRel: rel };
      }
      drawHud(scr.hud.ctx, {
        fpmAz: vel.az, fpmEl: vel.el, pitch: att.pitch * 180 / Math.PI, roll: att.roll * 180 / Math.PI,
        hdg: ((att.hdg * 180 / Math.PI) + 360) % 360, cas: fm.ias / 0.514444, mach: fm.mach, g: fm.nz, gMax: this.gMax,
        altFt: ac.pos.y * M_TO_FT, radarAltFt: null, vviFpm: fm.vel.y * M_TO_FT * 60, alowFt: this.alowFt, stpt,
        masterMode: 'NAV', sym: pwr ? this.panel.get('ICP_SYM') : 0, warn: sys.warnings.size > 0 && !fm.wow,
      }, time);
      scr.hud.tex.needsUpdate = true;
    }
    if (time < this.nextSlow) return;
    this.nextSlow = time + 0.1;
    // ---- MFDs
    const mfdOn = pwr && this.panel.get('MFD') === 1;
    const hdg = fm.attitude().hdg * 180 / Math.PI;
    const data: MfdData = {
      powered: mfdOn, hdgDeg: hdg,
      route: steerpoints.map((s, k) => ({ e: (s.pos.x - ac.pos.x) / NM, n: -(s.pos.z - ac.pos.z) / NM, cur: k === this.steerIndex })),
      stores: ac.stores.map((s, k) => ({ sta: k + 1, name: s ? (WEAPONS[s]?.name ?? s) : '' })).filter((s) => s.name),
      gun: ac.gunRounds,
      flcs: { run: sys.bitRun, fail: sys.bitFail, passed: sys.bitPassed, secondsLeft: Math.max(0, Math.ceil(45 - sys.bitTime)) },
      cautions: [...sys.warnings, ...sys.cautions],
    };
    scr.mfd.forEach((s, i) => { if (s) { drawMfd(s.ctx, s.canvas.width, this.mfds, i as 0 | 1, data); s.tex.needsUpdate = true; } });
    // ---- DED
    if (scr.ded) {
      const t = new Date(time * 1000);
      const hh = (x: number) => String(x).padStart(2, '0');
      const lines = pwr ? dedLines({ uhf: '292.30', vhf: '1', stpt: this.steerIndex + 1, time: `${hh(t.getUTCHours())}:${hh(t.getUTCMinutes())}:${hh(t.getUTCSeconds())}`, iff: 'M1 3 C', tacan: '75X' }) : null;
      drawDed(scr.ded.ctx, scr.ded.canvas.width, scr.ded.canvas.height, lines, pwr ? Math.max(0.3, this.panel.get('DED_DISPLAY_BRT')) : 0);
      scr.ded.tex.needsUpdate = true;
    }
    void HUD_PX;
  }
}
