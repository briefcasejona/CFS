// The F-16 HUD, drawn to TO 1F-16CM/AM-34-1-1 (BMS), 2.1.7: the HUD control panel switches (2.1.7.4), the NAV master
// mode symbology figure (2.1.7.5.1) and the symbol descriptions (2.1.7.6). Everything is laid out in milliradians
// (mR) from the boresight cross, as the manual gives it; conformal symbols (flight path marker, attitude bars,
// steerpoint) are projected through the real view, so they sit on the world 1:1.
//
// Where the manual gives no number the position is measured off the NAV figure (about 2 px per mR at the
// resolution it is printed at), and noted as such below.
import * as THREE from 'three';
import type { Aircraft } from '../sim/entities.js';
import { DEG, RAD, clamp, wrap360 } from '../core/math.js';
import { FT, KT, NM } from '../sim/atmosphere.js';
import { surfaceHeight } from '../world/theater.js';

type Pt = { x: number; y: number };

/** The HUD control panel, as the systems have it (index = position, see systems/f16/panels.ts). */
export interface HudPanel {
  scales: 0 | 1 | 2;    // VV/VAH, VAH, OFF
  fpm: 0 | 1 | 2;       // ATT/FPM, FPM, OFF
  ded: 0 | 1 | 2;       // DED DATA, PFL, OFF
  ret: 0 | 1 | 2;       // STBY, PRI, OFF
  vel: 0 | 1 | 2;       // CAS, TAS, GND SPD
  alt: 0 | 1 | 2;       // RADAR, BARO, AUTO
  brt: 0 | 1 | 2;       // DAY, AUTO BRT, NIGHT
  driftCo: boolean;
  /** reticle depression, mR */
  depr: number;
}

export function hudPanel(p: Aircraft): HudPanel {
  const s = p.systems;
  const g = (id: string, d: number) => (s && s.controls.some((c) => c.id === id) ? s.get(id) : d);
  return {
    scales: g('hudScales', 0) as 0 | 1 | 2, fpm: g('hudFpm', 0) as 0 | 1 | 2, ded: g('hudDed', 2) as 0 | 1 | 2, ret: g('hudRet', 2) as 0 | 1 | 2,
    vel: g('hudVel', 0) as 0 | 1 | 2, alt: g('hudAlt', 1) as 0 | 1 | 2, brt: g('hudBrt', 0) as 0 | 1 | 2,
    driftCo: g('driftCo', 0) === 1, depr: g('retDepr', 0) * 20,
  };
}

// ---- layout, mR from the boresight cross (x right, y down)
/** the middle of the field of view: the boresight sits near the top of the HUD (NAV figure) */
const FOV_MID = 125;
/** the field of view the symbology is clipped to (NAV figure: the horizon line spans about ±150 mR) */
const FOV = { x0: -155, x1: 155, y0: -40, y1: 290 };
const SPEED = { tapeX: -103, boxX: -128, y: 98 };            // NAV figure
const ALT = { tapeX: 92, boxX: 124, y: 98 };                  // NAV figure
const VV_X = 72;                                                // NAV figure: the tic column left of the altitude scale
const HDG = { y: 158 };                                         // NAV figure: heading box
const LEFT_X = -98, RIGHT_X = 69;                               // NAV figure: the data windows
const ROLL = { cy: FOV_MID + 50, r: 70 };                       // 2.1.7.6: 70 mR radius, centred 50 mR below the FOV middle

/** maximum G since the last reset (the HUD shows it under the Mach number) */
const maxG = new WeakMap<Aircraft, number>();
export function resetMaxG(p: Aircraft) { maxG.delete(p); }

export interface F16HudInput {
  ctx: CanvasRenderingContext2D;
  col: string;
  p: Aircraft;
  /** screen point of a world direction from the eye, or null behind the viewer */
  proj: (dir: THREE.Vector3) => Pt | null;
  steerpoint: THREE.Vector3 | null;
  steerName: string;
  eye: THREE.Vector3;
  masterMode: string;
  bullseye?: THREE.Vector3 | null;
  time: number;
}

export interface F16HudFrame {
  /** screen point of an mR position on the combiner */
  at: (x: number, y: number) => Pt;
  /** screen pixels per mR */
  k: number;
  bore: Pt;
  fpm: Pt;
  clip: { x0: number; x1: number; y0: number; y1: number };
}

/** Draws the HUD. Returns its frame (for the weapon symbology drawn on top), or null when it is out of view. */
export function drawF16Hud(h: F16HudInput): F16HudFrame | null {
  const { ctx: c, col, p } = h;
  const fm = p.fm, q = p.quat;
  const panel = hudPanel(p);
  const body = (azMr: number, elMr: number) => new THREE.Vector3(Math.sin(azMr / 1000) * Math.cos(elMr / 1000), Math.sin(elMr / 1000), -Math.cos(azMr / 1000) * Math.cos(elMr / 1000)).applyQuaternion(q);
  const bore = h.proj(body(0, 0)), px = h.proj(body(100, 0)), py = h.proj(body(0, -100));
  if (!bore || !px || !py) return null;
  const ex = { x: (px.x - bore.x) / 100, y: (px.y - bore.y) / 100 }, ey = { x: (py.x - bore.x) / 100, y: (py.y - bore.y) / 100 };
  const k = Math.hypot(ex.x, ex.y);
  const at = (x: number, y: number): Pt => ({ x: bore.x + ex.x * x + ey.x * y, y: bore.y + ex.y * x + ey.y * y });
  // screen-space roll of the combiner (head tilt is not modelled, so this is ~0, but keeps text upright on it)
  const rot = Math.atan2(ex.y, ex.x);

  c.save();
  c.globalAlpha = panel.brt === 2 ? 0.5 : 1;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = Math.max(1, 0.55 * k);
  c.shadowColor = col; c.shadowBlur = 2;
  c.lineCap = 'round';
  // the combiner's field of view
  const corners = [at(FOV.x0, FOV.y0), at(FOV.x1, FOV.y0), at(FOV.x1, FOV.y1), at(FOV.x0, FOV.y1)];
  c.beginPath(); corners.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y))); c.closePath(); c.clip();

  const line = (pts: Array<[number, number]>) => { c.beginPath(); pts.forEach(([x, y], i) => { const s = at(x, y); if (i) c.lineTo(s.x, s.y); else c.moveTo(s.x, s.y); }); c.stroke(); };
  const text = (s: string, x: number, y: number, mr = 7, align: CanvasTextAlign = 'left') => {
    const pt = at(x, y);
    c.save(); c.translate(pt.x, pt.y); c.rotate(rot);
    c.font = `${Math.max(9, mr * k)}px "B612 Mono", Consolas, "Courier New", monospace`;
    c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, 0, 0);
    c.restore();
  };
  const box = (x: number, y: number, w: number, hgt: number, pointer: 'left' | 'right' | null) => {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - hgt / 2, y1 = y + hgt / 2, t = hgt / 2;
    if (pointer === 'right') line([[x0, y0], [x1, y0], [x1 + t, y], [x1, y1], [x0, y1], [x0, y0]]);
    else if (pointer === 'left') line([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0 - t, y], [x0, y0]]);
    else line([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
  };
  const scales = panel.scales !== 2, vv = panel.scales === 0;

  // ---- boresight cross (gun cross): 2.1.7.6
  line([[-7, 0], [-2, 0]]); line([[2, 0], [7, 0]]); line([[0, -7], [0, -2]]); line([[0, 2], [0, 7]]);

  // ---- flight path marker: 10 mR circle, 10 mR wings, 5 mR tail (2.1.7.6)
  let fpmDir = fm.vel.lengthSq() > 25 ? fm.vel.clone().normalize() : body(0, 0);
  if (panel.driftCo) {
    // DRIFT C/O: the marker stays on the aircraft's centreline in azimuth (only its elevation follows the velocity)
    const loc = fpmDir.clone().applyQuaternion(q.clone().invert());
    const el = Math.asin(clamp(loc.y, -1, 1));
    fpmDir = body(0, el * 1000);
  }
  const fpmS = h.proj(fpmDir) ?? bore;
  // the marker in combiner mR (for the symbols drawn around it)
  const inv = 1 / (ex.x * ey.y - ex.y * ey.x);
  const toMr = (s: Pt): [number, number] => { const dx = s.x - bore.x, dy = s.y - bore.y; return [(dx * ey.y - dy * ey.x) * inv, (dy * ex.x - dx * ex.y) * inv]; };
  const [fx, fy] = toMr(fpmS);
  if (panel.fpm !== 2) {
    c.beginPath(); c.arc(fpmS.x, fpmS.y, 5 * k, 0, Math.PI * 2); c.stroke();
    line([[fx - 15, fy], [fx - 5, fy]]); line([[fx + 5, fy], [fx + 15, fy]]); line([[fx, fy - 5], [fx, fy - 10]]);
  }

  const att = fm.attitude();
  const roll = att.roll, pitch = att.pitch;
  // ---- bank angle indicator: a 120° arc about the marker, 3 mR marks at 0/30/60°, 1 mR at 10/20° (2.1.7.6)
  if (panel.fpm !== 2 && vv) {
    for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
      const ang = (a * DEG) - roll;   // the 0 mark points to the sky
      const len = Math.abs(a) % 30 === 0 ? 3 : 1;
      const r0 = 12, r1 = r0 + len * 2;
      line([[fx + Math.sin(ang) * r0, fy - Math.cos(ang) * r0], [fx + Math.sin(ang) * r1, fy - Math.cos(ang) * r1]]);
    }
  }

  // ---- attitude bars and horizon: 2.1.7.6. Bars every 5° (±5 to ±85), 1:1, solid above the horizon and dashed below,
  // elbows towards the horizon, the bars below tilted into a funnel. Aligned on the flight path azimuth.
  if (panel.fpm === 0) {
    const vh = fm.vel.clone(); vh.y = 0;
    const hdgV = vh.lengthSq() > 1 ? Math.atan2(vh.x, -vh.z) : att.hdg;
    const right = new THREE.Vector3(Math.cos(hdgV), 0, Math.sin(hdgV));
    const dirAt = (pa: number, off: number) => new THREE.Vector3(Math.sin(hdgV) * Math.cos(pa * DEG), Math.sin(pa * DEG), -Math.cos(hdgV) * Math.cos(pa * DEG)).addScaledVector(right, off);
    for (let pa = -85; pa <= 85; pa += 5) {
      const ctr = h.proj(dirAt(pa, 0));
      if (!ctr) continue;
      const [cxm, cym] = toMr(ctr);
      if (cym < FOV.y0 - 30 || cym > FOV.y1 + 30) continue;
      // the bar's own direction on the combiner (follows the bank)
      const r = h.proj(dirAt(pa, 0.02));
      if (!r) continue;
      const [rx, ry] = toMr(r);
      let ux = rx - cxm, uy = ry - cym; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      if (pa === 0) {
        // the horizon line: long, with a gap where the marker is
        line([[cxm - ux * 150, cym - uy * 150], [cxm - ux * 20, cym - uy * 20]]);
        line([[cxm + ux * 20, cym + uy * 20], [cxm + ux * 150, cym + uy * 150]]);
        continue;
      }
      // bars 25 mR long, starting 20 mR either side of the centre (NAV figure)
      const gap = 20, len = 25;
      const nx = -uy, ny = ux;                        // towards the sky on the combiner
      // below the horizon the outer ends turn towards it, a funnel (half the pitch angle)
      const th = pa < 0 ? (-pa / 2) * DEG : 0, ct = Math.cos(th), st = Math.sin(th);
      const el = pa > 0 ? -5 : 5;                      // the elbow points to the horizon
      c.setLineDash(pa < 0 ? [3 * k, 2.2 * k] : []);
      for (const side of [-1, 1]) {
        const bx = side * ux * ct + nx * st, by = side * uy * ct + ny * st;
        const ix = cxm + ux * gap * side, iy = cym + uy * gap * side;
        const ox = ix + bx * len, oy = iy + by * len;
        line([[ix + nx * el, iy + ny * el], [ix, iy], [ox, oy]]);
        text(String(Math.abs(pa)), ox + bx * 3, oy + by * 3, 7, side < 0 ? 'right' : 'left');
      }
      c.setLineDash([]);
    }
  }

  // ---- airspeed scale and box: tens of knots, marks every 50 kt (2.1.7.6). CAS / TAS / GND SPD from the VELOCITY
  // switch; CAS whenever the gear handle is down.
  const gearDn = (p.systems?.get?.('lgHandle') ?? (fm.gearPos > 0.5 ? 1 : 0)) === 1;
  const velMode = gearDn ? 0 : panel.vel;
  const ground = Math.hypot(fm.vel.x, fm.vel.z);
  const kt = (velMode === 0 ? fm.ias : velMode === 1 ? fm.vel.length() : ground) / KT;
  if (scales) {
    const per10 = 5.3;   // mR per 10 kt (NAV figure: "40" to "30" is about 53 mR)
    c.save(); c.beginPath(); const a0 = at(SPEED.tapeX - 30, SPEED.y - 46), a1 = at(SPEED.tapeX + 8, SPEED.y + 46);
    c.rect(Math.min(a0.x, a1.x), Math.min(a0.y, a1.y), Math.abs(a1.x - a0.x), Math.abs(a1.y - a0.y)); c.clip();
    for (let v = Math.floor((kt - 100) / 10) * 10; v <= kt + 100; v += 10) {
      if (v < 0) continue;
      const y = SPEED.y - (v - kt) / 10 * per10;
      line([[SPEED.tapeX, y], [SPEED.tapeX + (v % 50 === 0 ? 5 : 3), y]]);
      if (v % 50 === 0) text(String(v / 10), SPEED.tapeX - 4, y, 7, 'right');
    }
    c.restore();
  }
  box(SPEED.boxX, SPEED.y, 30, 11, 'right');
  text(String(Math.round(kt)), SPEED.boxX, SPEED.y, 8, 'center');
  text(['C', 'T', 'G'][velMode], SPEED.boxX - 20, SPEED.y, 7, 'center');

  // ---- altitude: barometric scale with 100 ft tics and a readout every 500 ft (thousands, comma, hundreds); AUTO
  // switches to a radar thermometer scale below 1200 ft descending / 1500 ft climbing (2.1.7.6).
  const baro = fm.pos.y / FT;
  const agl = (fm.pos.y - surfaceHeight(fm.pos.x, fm.pos.z)) / FT;
  const radarOk = agl < 5000 && (p.systems?.get?.('rdrAlt') ?? 2) === 2;
  const climbing = fm.vel.y > 0;
  const autoRadar = panel.alt === 2 && radarOk && agl < (climbing ? 1500 : 1200);
  const altRadar = panel.alt === 0 || autoRadar;
  const alt = altRadar && radarOk ? agl : baro;
  const fmtAlt = (ft: number) => { const r = Math.round(ft); return r >= 1000 ? `${Math.floor(r / 1000)},${String(r % 1000).padStart(3, '0')}` : String(r); };
  if (scales) {
    if (autoRadar) {
      // the thermometer scale: 0 to 1500 ft, a bar from the bottom up to the radar altitude
      const top = ALT.y - 45, bot = ALT.y + 45, yOf = (ft: number) => bot - clamp(ft, 0, 1500) / 1500 * (bot - top);
      for (let ft = 0; ft <= 1500; ft += 100) line([[ALT.tapeX - (ft % 500 === 0 ? 5 : 3), yOf(ft)], [ALT.tapeX, yOf(ft)]]);
      for (const ft of [0, 500, 1000, 1500]) text(ft === 0 ? '0' : ft === 1500 ? '1,5' : ft === 1000 ? '1,0' : '.5', ALT.tapeX + 3, yOf(ft), 6.5);
      line([[ALT.tapeX - 2, bot], [ALT.tapeX - 2, yOf(agl)]]);
      line([[ALT.tapeX - 4, bot], [ALT.tapeX - 4, yOf(agl)]]);
    } else {
      const per100 = 5.1;   // mR per 100 ft (NAV figure: "22,0" to "21,5" is about 26 mR); ×5 expanded with the gear down
      const sc = gearDn ? per100 * 5 : per100;
      c.save(); c.beginPath(); const a0 = at(ALT.tapeX - 8, ALT.y - 46), a1 = at(ALT.tapeX + 32, ALT.y + 46);
      c.rect(Math.min(a0.x, a1.x), Math.min(a0.y, a1.y), Math.abs(a1.x - a0.x), Math.abs(a1.y - a0.y)); c.clip();
      const step = gearDn ? 20 : 100, span = 50 / sc * 100;
      for (let ft = Math.floor((alt - span) / step) * step; ft <= alt + span; ft += step) {
        const y = ALT.y - (ft - alt) / 100 * sc;
        const major = gearDn ? ft % 100 === 0 : ft % 500 === 0;
        line([[ALT.tapeX - (major ? 5 : 3), y], [ALT.tapeX, y]]);
        if (major) { const f = Math.round(ft / 100); text(`${Math.trunc(f / 10)},${Math.abs(f % 10)}`, ALT.tapeX + 3, y, 7); }
      }
      c.restore();
    }
  }
  box(ALT.boxX, ALT.y, 40, 11, 'left');
  text(fmtAlt(alt), ALT.boxX, ALT.y, 8, 'center');
  if (altRadar && radarOk) text('R', ALT.boxX - 28, ALT.y - 1, 7, 'center');

  // ---- vertical velocity scale: tics every 500 fpm, a caret against it (VV/VAH only)
  if (vv) {
    const per500 = 10;
    for (let f = -2000; f <= 2000; f += 500) line([[VV_X, ALT.y - f / 500 * per500], [VV_X + (f === 0 ? 5 : 3), ALT.y - f / 500 * per500]]);
    const fpmv = fm.vel.y / FT * 60;
    const y = ALT.y - clamp(fpmv, -2000, 2000) / 500 * per500;
    line([[VV_X - 7, y - 3], [VV_X - 1, y], [VV_X - 7, y + 3], [VV_X - 7, y - 3]]);
  }

  // ---- heading scale: under the field of view, with the heading in a box (2.1.7.6, NAV figure)
  const hdg = wrap360(att.hdg * RAD);
  if (scales) {
    const per10 = 27;   // mR per 10° (NAV figure: "35" and "01" are about 27 mR either side of 000)
    c.save(); c.beginPath(); const a0 = at(-60, HDG.y - 22), a1 = at(60, HDG.y + 8);
    c.rect(Math.min(a0.x, a1.x), Math.min(a0.y, a1.y), Math.abs(a1.x - a0.x), Math.abs(a1.y - a0.y)); c.clip();
    for (let d = Math.floor((hdg - 30) / 5) * 5; d <= hdg + 30; d += 5) {
      const x = (d - hdg) / 10 * per10;
      if (Math.abs(x) < 17) continue;
      line([[x, HDG.y - 14], [x, HDG.y - (d % 10 === 0 ? 20 : 17)]]);
      if (d % 10 === 0) text(String(Math.round(wrap360(d) / 10) % 36).padStart(2, '0'), x, HDG.y - 5, 8, 'center');
    }
    c.restore();
    line([[0, HDG.y - 14], [0, HDG.y - 20]]);
  }
  box(0, HDG.y, 26, 11, null);
  text(String(Math.round(hdg) % 360).padStart(3, '0'), 0, HDG.y, 8, 'center');

  // ---- roll indicator: 70 mR radius, 50 mR below the FOV middle, tics every 10° and the outer ones at 45°
  if (vv && panel.fpm === 0) {
    for (const a of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) {
      const ang = a * DEG, r0 = ROLL.r - (Math.abs(a) === 45 || a === 0 ? 9 : 6), r1 = ROLL.r - 2;
      line([[Math.sin(ang) * r0, ROLL.cy + Math.cos(ang) * r0], [Math.sin(ang) * r1, ROLL.cy + Math.cos(ang) * r1]]);
    }
    // the caret moves round the scale with the bank
    const ang = clamp(-roll, -Math.PI / 2, Math.PI / 2), r = ROLL.r + 1;
    const tip: [number, number] = [Math.sin(ang) * r, ROLL.cy + Math.cos(ang) * r];
    const bx = Math.sin(ang) * (r + 7), by = ROLL.cy + Math.cos(ang) * (r + 7), tx = Math.cos(ang) * 3.5, ty = -Math.sin(ang) * 3.5;
    line([tip, [bx + tx, by + ty], [bx - tx, by - ty], tip]);
  }

  // ---- left data windows: G, Mach, max G, master mode, bullseye (NAV figure)
  text(fm.nz.toFixed(1), LEFT_X + 2, 41, 8);
  text(fm.mach.toFixed(2).replace(/^0/, '0'), LEFT_X, 160, 8);
  const mg = Math.max(maxG.get(p) ?? 1, fm.nz);
  maxG.set(p, mg);
  text(mg.toFixed(1), LEFT_X, 173, 8);
  text(h.masterMode, LEFT_X, 186, 8);
  if (h.bullseye) {
    const d = h.eye.clone().sub(h.bullseye); d.y = 0;
    const brg = wrap360(Math.atan2(d.x, -d.z) * RAD);
    text(`${String(Math.round(brg) % 360).padStart(3, '0')} ${String(Math.round(d.length() / NM)).padStart(3, '0')}`, LEFT_X - 32, 198, 8);
  }

  // ---- right data windows: altitude (AGL / ALOW), slant range, time and distance to the steerpoint (NAV figure)
  if (radarOk) { text('AR', RIGHT_X, 156, 8); box(RIGHT_X + 34, 156, 40, 10, null); text(fmtAlt(agl), RIGHT_X + 34, 156, 8, 'center'); }
  const alow = (p.systems?.avionics as { alow?: { cara: number } } | undefined)?.alow?.cara;
  if (alow !== undefined) text(`AL ${String(Math.round(alow)).padStart(5, ' ')}`, RIGHT_X, 173, 8);
  if (h.steerpoint) {
    const d3 = h.steerpoint.clone().sub(h.eye);
    const d = d3.clone(); d.y = 0;
    text(`B${(d3.length() / NM).toFixed(1).padStart(5, '0')}`, RIGHT_X, 186, 8);
    const gs = Math.max(1, ground);
    const s = Math.round(d.length() / gs);
    text(`${String(Math.floor(s / 3600)).padStart(3, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`, RIGHT_X, 199, 8);
    const num = /^\D*(\d+)/.exec(h.steerName)?.[1] ?? '1';
    text(`${String(Math.round(d.length() / NM)).padStart(3, '0')}>${num.padStart(2, '0')}`, RIGHT_X, 213, 8);
    // the steerpoint diamond, on the world; out of the HUD it sits at the bottom (NAV figure)
    const sp = h.proj(d3);
    const [sx, sy] = sp ? toMr(sp) : [0, 1e9];
    if (sp && sx > FOV.x0 && sx < FOV.x1 && sy > FOV.y0 && sy < FOV.y1) line([[sx, sy - 4], [sx + 4, sy], [sx, sy + 4], [sx - 4, sy], [sx, sy - 4]]);
    // the great circle steering cue: a circle with a tail on the horizon at the steerpoint's bearing
    const brgRel = Math.atan2(d.x, -d.z) - att.hdg;
    const rel = Math.atan2(Math.sin(brgRel), Math.cos(brgRel)) * 1000;
    const hz = h.proj(new THREE.Vector3(Math.sin(att.hdg + rel / 1000), 0, -Math.cos(att.hdg + rel / 1000)));
    if (hz) {
      const [hx, hy] = toMr(hz);
      const gx = clamp(hx, FOV.x0 + 10, FOV.x1 - 10), gy = clamp(hy, FOV.y0 + 10, FOV.y1 - 10);
      c.beginPath(); const g = at(gx, gy); c.arc(g.x, g.y, 3 * k, 0, Math.PI * 2); c.stroke();
      line([[gx + 2.2, gy + 2.2], [gx + 9, gy + 9]]);
    }
  }

  // ---- reticle: PRI = 2 mR pipper, dashed 50 mR and solid 100 mR circles; STBY = dotted circles with 6 mR tics.
  // Depressed by RET DEPR (mR) from the boresight.
  if (panel.ret !== 2) {
    const ry = panel.depr;
    const pt = at(0, ry);
    c.beginPath(); c.arc(pt.x, pt.y, 1 * k, 0, Math.PI * 2); c.fill();
    if (panel.ret === 1) {
      c.setLineDash([3 * k, 3 * k]); c.beginPath(); c.arc(pt.x, pt.y, 25 * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(pt.x, pt.y, 50 * k, 0, Math.PI * 2); c.stroke();
    } else {
      c.setLineDash([0.6 * k, 3 * k]);
      for (const r of [25, 50]) { c.beginPath(); c.arc(pt.x, pt.y, r * k, 0, Math.PI * 2); c.stroke(); }
      c.setLineDash([]);
      for (let a = 0; a < 360; a += 45) { const s = Math.sin(a * DEG), co = Math.cos(a * DEG); line([[s * 50, ry - co * 50], [s * 56, ry - co * 56]]); }
    }
  }

  c.restore();
  const clipPts = corners;
  return {
    at, k, bore, fpm: fpmS,
    clip: { x0: Math.min(...clipPts.map((p2) => p2.x)), x1: Math.max(...clipPts.map((p2) => p2.x)), y0: Math.min(...clipPts.map((p2) => p2.y)), y1: Math.max(...clipPts.map((p2) => p2.y)) },
  };
}
