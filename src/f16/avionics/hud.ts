// The F-16 HUD in NAV master mode, laid out as the Dash-34 figure "HUD – Nav Master Mode Symbology"
// (TO 1F-16CMAM-34-1-1 BMS, 2.1.7.5.1) and the cues of 2.1.7.6.
//
// The symbology is drawn in angles: the canvas covers HUD_FIELD of azimuth and elevation around the boresight, so
// the cockpit view can project it through the angled HUD glass from the pilot's eye (cockpit/screens.ts). What the
// pilot sees is then fixed to the outside world, as a collimated HUD is.
import * as THREE from 'three';

/** degrees of the field the canvas covers: azimuth −15 … +15, elevation +5 … −25 (the boresight near the top, as in
 *  the figure) */
export const HUD_FIELD = { az: 15, elTop: 5, elBottom: -25 };
export const HUD_PX = 1024;
const PX_PER_DEG = HUD_PX / (2 * HUD_FIELD.az);

export interface HudData {
  /** body-frame flight path (deg): azimuth right +, elevation up + */
  fpmAz: number; fpmEl: number;
  pitch: number; roll: number; hdg: number;   // deg; heading magnetic = true here (no variation model)
  cas: number; mach: number; g: number; gMax: number;
  altFt: number; radarAltFt: number | null; vviFpm: number;
  /** ALOW (Dash-34 CARA ALOW) */
  alowFt: number;
  /** steerpoint: body-frame direction (deg) and distance (NM), number, time to go (s) */
  stpt: { az: number; el: number; nm: number; n: number; ttgS: number; bearingRel: number } | null;
  masterMode: string;
  /** brightness 0 … 1 (the SYM wheel) */
  sym: number;
  warn: boolean;
}

const deg = (az: number, el: number): [number, number] =>
  [HUD_PX / 2 + az * PX_PER_DEG, (HUD_FIELD.elTop - el) * PX_PER_DEG];

/** Draw the HUD onto `ctx` (HUD_PX square), green on black (the projection adds it onto the glass). */
export function drawHud(ctx: CanvasRenderingContext2D, d: HudData, time: number) {
  const W = HUD_PX;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  if (d.sym <= 0.01) return;
  const green = `rgba(70,255,110,${Math.min(1, 0.35 + d.sym)})`;
  ctx.strokeStyle = green; ctx.fillStyle = green;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textBaseline = 'middle';
  const line = (pts: Array<[number, number]>) => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'left') => { ctx.textAlign = align; ctx.fillText(s, x, y); };
  const box = (s: string, x: number, y: number, w: number, align: CanvasTextAlign = 'left') => {
    const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    ctx.strokeRect(x0, y - 20, w, 40);
    text(s, x0 + w / 2, y + 1, 'center');
  };

  // ---- boresight cross (2.1.7.6.6)
  const [bx, by] = deg(0, 0);
  line([[bx - 22, by], [bx - 7, by]]); line([[bx + 7, by], [bx + 22, by]]);
  line([[bx, by - 22], [bx, by - 7]]); line([[bx, by + 7], [bx, by + 22]]);

  // ---- flight path marker (2.1.7.6.2): circle with wings and a fin
  const [fx, fy] = deg(d.fpmAz, d.fpmEl);
  ctx.beginPath(); ctx.arc(fx, fy, 14, 0, Math.PI * 2); ctx.stroke();
  line([[fx - 40, fy], [fx - 14, fy]]); line([[fx + 14, fy], [fx + 40, fy]]); line([[fx, fy - 14], [fx, fy - 32]]);

  // ---- pitch ladder and horizon line, centred on the flight path marker, rolled with the jet
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(-d.roll * Math.PI / 180);
  const ladderPx = PX_PER_DEG;
  for (let p = -90; p <= 90; p += 5) {
    // the horizon is at −pitch from the boresight, so the p° line is at p − pitch; relative to the marker:
    const y = (d.pitch + d.fpmEl - p) * ladderPx;
    if (Math.abs(y) > W) continue;
    if (p === 0) { line([[-430, y], [-60, y]]); line([[60, y], [430, y]]); continue; }
    const tick = p > 0 ? 18 : -18;
    ctx.setLineDash(p < 0 ? [14, 10] : []);
    line([[-150, y + tick], [-150, y], [-60, y]]); line([[60, y], [150, y], [150, y + tick]]);
    ctx.setLineDash([]);
    text(String(Math.abs(p)), -165, y, 'right'); text(String(Math.abs(p)), 165, y, 'left');
  }
  ctx.restore();

  // ---- airspeed scale (left) with the CAS box, and altitude scale (right) with the altitude box
  const scaleTop = deg(0, -3)[1], scaleBot = deg(0, -15)[1];
  const midY = (scaleTop + scaleBot) / 2;
  const asX = deg(-10.5, 0)[0];
  for (let v = Math.floor((d.cas - 60) / 10) * 10; v <= d.cas + 60; v += 10) {
    const y = midY - (v - d.cas) * 2.4;
    if (y < scaleTop || y > scaleBot || v < 0) continue;
    line([[asX, y], [asX + (v % 50 === 0 ? 22 : 12), y]]);
    if (v % 50 === 0) text(String(v / 10), asX - 8, y, 'right');
  }
  box(String(Math.round(d.cas)), asX - 18, midY, 110, 'right');
  const alX = deg(10.5, 0)[0];
  for (let a = Math.floor((d.altFt - 600) / 100) * 100; a <= d.altFt + 600; a += 100) {
    const y = midY - (a - d.altFt) * 0.24;
    if (y < scaleTop || y > scaleBot) continue;
    line([[alX, y], [alX - (a % 500 === 0 ? 22 : 12), y]]);
    if (a % 500 === 0) text((a / 1000).toFixed(1).replace('.', ','), alX + 8, y, 'left');
  }
  const altTxt = Math.round(d.altFt / 10) * 10;
  box(altTxt >= 1000 ? `${Math.floor(altTxt / 1000)},${String(altTxt % 1000).padStart(3, '0')}` : String(altTxt), alX + 18, midY, 140, 'left');

  // ---- left column: G, Mach, max G, master mode (figure)
  const lx = deg(-13.5, 0)[0];
  text(d.g.toFixed(1), deg(-9, 0)[0], deg(0, 1.2)[1]);
  text(d.mach.toFixed(2), lx + 40, deg(0, -17)[1]);
  text(d.gMax.toFixed(1), lx + 10, deg(0, -18.4)[1]);
  text(d.masterMode, lx + 10, deg(0, -19.8)[1]);

  // ---- right column: radar altitude, ALOW, time and distance to the steerpoint (figure)
  const rx = deg(8, 0)[0];
  if (d.radarAltFt !== null) { text('AR', rx, deg(0, -17)[1]); box(String(Math.round(d.radarAltFt / 10) * 10).padStart(5, ' '), rx + 52, deg(0, -17)[1], 140); }
  text(`AL ${String(d.alowFt).padStart(5, ' ')}`, rx, deg(0, -18.5)[1]);
  if (d.stpt) {
    const t = Math.max(0, Math.round(d.stpt.ttgS));
    text(`${String(Math.floor(t / 60)).padStart(3, '0')}:${String(t % 60).padStart(2, '0')}`, rx, deg(0, -20)[1]);
    text(`${String(Math.min(999, Math.round(d.stpt.nm))).padStart(3, '0')}>${String(d.stpt.n).padStart(2, '0')}`, rx, deg(0, -21.5)[1]);
  }

  // ---- heading scale with the magnetic heading box (figure: below the horizon, in the middle)
  const hy = deg(0, -17)[1], hx = deg(0, 0)[0];
  for (let h = Math.floor((d.hdg - 25) / 5) * 5; h <= d.hdg + 25; h += 5) {
    const x = hx + (h - d.hdg) * 8;
    line([[x, hy - 40], [x, hy - (h % 10 === 0 ? 58 : 48)]]);
    if (h % 10 === 0 && Math.abs(h - d.hdg) > 4) text(String(((h % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, hy, 'center');
  }
  box(String(Math.round(((d.hdg % 360) + 360) % 360)).padStart(3, '0'), hx, hy, 100, 'center');

  // ---- roll indicator at the bottom (figure): ticks at 10, 20, 30, 45 and 60° with the bank pointer
  const rcx = hx, rcy = deg(0, -14)[1], rr = 230;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const t = (90 + a) * Math.PI / 180, len = Math.abs(a) % 30 === 0 ? 26 : 16;
    line([[rcx + Math.cos(t) * rr, rcy + Math.sin(t) * rr], [rcx + Math.cos(t) * (rr + len), rcy + Math.sin(t) * (rr + len)]]);
  }
  const rt = (90 + d.roll) * Math.PI / 180;
  const px = rcx + Math.cos(rt) * (rr - 8), py = rcy + Math.sin(rt) * (rr - 8);
  line([[px, py], [px - 10, py - 22], [px + 10, py - 22], [px, py]]);

  // ---- steerpoint diamond (2.1.7.6.4) and great-circle steering cue (2.1.7.6.3)
  if (d.stpt) {
    const [sx, sy] = deg(d.stpt.az, d.stpt.el);
    if (sx > 0 && sx < W && sy > 0 && sy < W) line([[sx, sy - 14], [sx + 14, sy], [sx, sy + 14], [sx - 14, sy], [sx, sy - 14]]);
    const gx = fx + Math.max(-300, Math.min(300, d.stpt.bearingRel * 12));
    ctx.beginPath(); ctx.arc(gx, fy, 11, 0, Math.PI * 2); ctx.stroke();
    line([[gx + 8, fy + 8], [gx + 30, fy + 26]]);
  }

  // ---- WARN (2.1.7.5.5): flashing in the middle
  if (d.warn && Math.floor(time * 2) % 2 === 0) text('WARN', hx, deg(0, -8)[1], 'center');
}

/** Body-frame direction (deg) of a world vector seen from the jet. */
export function bodyAngles(quat: THREE.Quaternion, v: THREE.Vector3): { az: number; el: number } {
  const b = v.clone().applyQuaternion(quat.clone().invert());
  const az = Math.atan2(b.x, -b.z) * 180 / Math.PI;
  const el = Math.atan2(b.y, Math.hypot(b.x, b.z)) * 180 / Math.PI;
  return { az, el };
}
