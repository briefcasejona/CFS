import * as THREE from 'three';
import type { World } from '../sim/world.js';
import type { Aircraft } from '../sim/entities.js';
import type { SceneRenderer } from '../render/scene.js';
import { WEAPONS } from '../weapons/stores.js';
import { DEG, RAD, clamp, wrap360 } from '../core/math.js';
import { FT, KT, NM, G0 } from '../sim/atmosphere.js';
import { surfaceHeight } from '../world/theater.js';

export interface HudState {
  autopilot: boolean;
  timeAccel: number;
  paused: boolean;
  labels: boolean;
  color: string;
  steerpoint: THREE.Vector3 | null;
  steerName: string;
}

type Pt = { x: number; y: number };

/** Estimated dynamic launch zone for an A-A missile (m). */
export function dlz(ac: Aircraft, target: Aircraft, wid: string) {
  const w = WEAPONS[wid];
  const los = target.pos.clone().sub(ac.pos);
  const range = los.length();
  los.normalize();
  const closure = -target.vel.clone().sub(ac.vel).dot(los);
  const altF = clamp(0.55 + ac.pos.y / 18000, 0.5, 1.4);
  const speedF = clamp(0.6 + ac.fm.mach * 0.45, 0.6, 1.5);
  const aspect = target.fm.forward().dot(los); // > 0: target flying away
  const aspF = aspect > 0 ? 1 - 0.55 * aspect : 1 + 0.15 * -aspect;
  const rmax = w.rangeKm * 1000 * altF * speedF * aspF * (w.kind === 'ir' ? 0.8 : 0.75);
  const rne = rmax * (w.kind === 'ir' ? 0.55 : 0.4);
  const rmin = w.minRange ?? 500;
  return { rmax, rne, rmin, range, closure };
}

export class Hud {
  private world: World | null = null;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0;
  private flash = 0;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }
  resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  draw(world: World, scene: SceneRenderer, st: HudState, dt: number) {
    this.world = world;
    const c = this.ctx;
    this.flash += dt;
    c.clearRect(0, 0, this.w, this.h);
    const p = world.player;
    this.drawMessages(world);
    if (p && st.labels) this.drawLabels(world, scene, p);
    if (!p) return;
    if (scene.view === 'cockpit' && p.alive) this.drawHud(world, scene, p, st);
    else this.drawDataStrip(world, p, st);
    if (p.gLoc > 0.02) {
      const a = clamp(p.gLoc, 0, 1);
      const r = Math.max(this.w, this.h);
      const g = c.createRadialGradient(this.w / 2, this.h / 2, r * Math.max(0.02, 0.55 - a * 0.5), this.w / 2, this.h / 2, r * 0.75);
      const red = p.fm.nz < 0;
      g.addColorStop(0, red ? `rgba(120,0,0,${a * 0.6})` : `rgba(0,0,0,${Math.max(0, a - 0.85) * 6})`);
      g.addColorStop(1, red ? `rgba(160,0,0,${a})` : `rgba(0,0,0,${Math.min(1, a * 1.1)})`);
      c.fillStyle = g;
      c.fillRect(0, 0, this.w, this.h);
    }
    if (st.paused) this.text('PAUSED', this.w / 2, this.h * 0.3, '#fff', 28, 'center');
    else if (st.timeAccel > 1) this.text(`x${st.timeAccel}`, this.w - 60, 30, '#ff0', 18);
  }

  private text(s: string, x: number, y: number, col: string, size = 14, align: CanvasTextAlign = 'left') {
    const c = this.ctx;
    c.font = `${Math.round(size)}px Consolas, "Courier New", monospace`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = col;
    c.fillText(s, x, y);
  }

  private drawMessages(world: World) {
    const msgs = world.messages.filter((m) => world.time - m.time < 12).slice(-7);
    let y = 24;
    for (const m of msgs) {
      this.ctx.globalAlpha = clamp(1.5 - (world.time - m.time) / 8, 0.2, 1);
      this.text(m.text, 16, y, m.color, 14);
      y += 18;
    }
    this.ctx.globalAlpha = 1;
  }

  private drawLabels(world: World, scene: SceneRenderer, p: Aircraft) {
    for (const a of world.aircraft) {
      if (a === p || !a.active) continue;
      const d = a.pos.distanceTo(p.pos);
      if (d > 60000) continue;
      const s = scene.project(a.pos, this.w, this.h);
      if (!s) continue;
      this.text(`${a.def.name} ${(d / NM).toFixed(1)}nm`, s.x + 8, s.y - 10, a.side === p.side ? '#7cf' : '#f77', 11);
    }
    for (const g of world.ground) {
      if (!g.alive || g.pos.distanceTo(p.pos) > 15000) continue;
      const s = scene.project(g.pos, this.w, this.h);
      if (s) this.text(g.name, s.x + 6, s.y - 8, g.side === p.side ? '#7cf' : '#f99', 10);
    }
  }

  /** Project a direction from the eye point (conformal symbology at infinity). */
  private projDir(scene: SceneRenderer, dir: THREE.Vector3): Pt | null {
    const far = scene.camera.position.clone().addScaledVector(dir.clone().normalize(), 10000);
    return scene.project(far, this.w, this.h);
  }

  private drawHud(world: World, scene: SceneRenderer, p: Aircraft, st: HudState) {
    const c = this.ctx;
    const fm = p.fm;
    const col = st.color;
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.6;
    c.shadowColor = col; c.shadowBlur = 3;
    const q = p.quat;
    const bodyDir = (az: number, el: number) => new THREE.Vector3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG)).applyQuaternion(q);
    const bore = this.projDir(scene, bodyDir(0, 0));
    const tl = this.projDir(scene, bodyDir(-14, 9));
    const br = this.projDir(scene, bodyDir(14, -16));
    if (!bore || !tl || !br) { c.shadowBlur = 0; this.drawDataStrip(world, p, st); return; }
    const hx0 = Math.min(tl.x, br.x), hx1 = Math.max(tl.x, br.x), hy0 = Math.min(tl.y, br.y), hy1 = Math.max(tl.y, br.y);
    const hh = hy1 - hy0;
    const scale = clamp(hh / 420, 0.6, 2.2);
    c.save();
    c.beginPath(); c.rect(hx0, hy0, hx1 - hx0, hh); c.clip();

    // gun cross / boresight
    c.beginPath();
    c.moveTo(bore.x - 10 * scale, bore.y); c.lineTo(bore.x - 4 * scale, bore.y);
    c.moveTo(bore.x + 4 * scale, bore.y); c.lineTo(bore.x + 10 * scale, bore.y);
    c.moveTo(bore.x, bore.y - 10 * scale); c.lineTo(bore.x, bore.y - 4 * scale);
    c.stroke();

    // flight path marker
    const v = fm.vel.clone();
    const fpm = (v.lengthSq() > 25 ? this.projDir(scene, v) : null) ?? bore;
    c.beginPath(); c.arc(fpm.x, fpm.y, 6 * scale, 0, Math.PI * 2);
    c.moveTo(fpm.x - 6 * scale, fpm.y); c.lineTo(fpm.x - 16 * scale, fpm.y);
    c.moveTo(fpm.x + 6 * scale, fpm.y); c.lineTo(fpm.x + 16 * scale, fpm.y);
    c.moveTo(fpm.x, fpm.y - 6 * scale); c.lineTo(fpm.x, fpm.y - 12 * scale);
    c.stroke();

    // pitch ladder, aligned with the flight path heading
    const vh = v.clone(); vh.y = 0;
    const hdgV = vh.lengthSq() > 1 ? Math.atan2(vh.x, -vh.z) : fm.attitude().hdg;
    const right = new THREE.Vector3(Math.cos(hdgV), 0, Math.sin(hdgV));
    for (let pa = -85; pa <= 85; pa += 5) {
      const ctr = new THREE.Vector3(Math.sin(hdgV) * Math.cos(pa * DEG), Math.sin(pa * DEG), -Math.cos(hdgV) * Math.cos(pa * DEG));
      const half = pa === 0 ? 0.35 : 0.075;
      const gap = pa === 0 ? 0.02 : 0.03;
      const pts = [-half, -gap, gap, half].map((k) => this.projDir(scene, ctr.clone().addScaledVector(right, k)));
      if (pts.some((x) => !x)) continue;
      const [a, b, cc, d] = pts as Pt[];
      c.setLineDash(pa < 0 ? [6, 4] : []);
      c.beginPath();
      c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      c.moveTo(cc.x, cc.y); c.lineTo(d.x, d.y);
      if (pa !== 0) {
        const tick = pa > 0 ? 6 : -6;
        const nx = -(b.y - a.y), ny = b.x - a.x;
        const nl = Math.hypot(nx, ny) || 1;
        c.moveTo(a.x, a.y); c.lineTo(a.x + nx / nl * tick, a.y + ny / nl * tick);
        c.moveTo(d.x, d.y); c.lineTo(d.x + nx / nl * tick, d.y + ny / nl * tick);
      }
      c.stroke();
      c.setLineDash([]);
      if (pa !== 0) {
        this.text(`${Math.abs(pa)}`, a.x - 14, a.y, col, 11 * scale, 'center');
        this.text(`${Math.abs(pa)}`, d.x + 14, d.y, col, 11 * scale, 'center');
      }
    }

    this.drawTargeting(world, scene, p, st, bore, fpm, scale, { hx0, hx1, hy0, hy1 });

    if (st.steerpoint) {
      const sp = this.projDir(scene, st.steerpoint.clone().sub(scene.camera.position));
      if (sp) { c.beginPath(); c.moveTo(sp.x, sp.y - 6); c.lineTo(sp.x + 6, sp.y); c.lineTo(sp.x, sp.y + 6); c.lineTo(sp.x - 6, sp.y); c.closePath(); c.stroke(); }
    }
    c.restore();

    // ---------------- fixed-format data
    const cx = (hx0 + hx1) / 2;
    const fs = 13 * scale;
    const hdg = wrap360(fm.attitude().hdg * RAD);
    const tapeY = hy0 + 18 * scale;
    c.save(); c.beginPath(); c.rect(cx - 120 * scale, tapeY - 14 * scale, 240 * scale, 30 * scale); c.clip();
    for (let d = Math.floor((hdg - 30) / 5) * 5; d <= hdg + 30; d += 5) {
      const x = cx + (d - hdg) * 4 * scale;
      c.beginPath(); c.moveTo(x, tapeY + 8 * scale); c.lineTo(x, tapeY + (d % 10 === 0 ? 2 : 5) * scale); c.stroke();
      if (d % 10 === 0) this.text(String(Math.round(wrap360(d) / 10) % 36).padStart(2, '0'), x, tapeY - 4 * scale, col, 11 * scale, 'center');
    }
    c.restore();
    c.beginPath(); c.moveTo(cx, tapeY + 9 * scale); c.lineTo(cx - 4 * scale, tapeY + 15 * scale); c.lineTo(cx + 4 * scale, tapeY + 15 * scale); c.closePath(); c.stroke();

    const ias = fm.ias / KT;
    const altFt = fm.pos.y / FT;
    const boxY = (hy0 + hy1) / 2 - 20 * scale;
    const lx = hx0 + 40 * scale, rx = hx1 - 40 * scale;
    c.strokeRect(lx - 30 * scale, boxY - 11 * scale, 60 * scale, 22 * scale);
    this.text(ias.toFixed(0), lx, boxY, col, fs + 2, 'center');
    c.strokeRect(rx - 38 * scale, boxY - 11 * scale, 76 * scale, 22 * scale);
    this.text(altFt.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','), rx, boxY, col, fs + 2, 'center');
    const agl = (fm.pos.y - surfaceHeight(fm.pos.x, fm.pos.z)) / FT;
    if (agl < 5000) this.text(`R ${agl.toFixed(0)}`, rx, boxY + 24 * scale, col, fs, 'center');
    const vvi = (fm.vel.y / FT) * 60;
    this.text(`${vvi >= 0 ? '+' : ''}${Math.round(vvi / 100) * 100}`, rx, boxY - 24 * scale, col, fs - 2, 'center');
    this.text(`M ${fm.mach.toFixed(2)}`, lx - 28 * scale, boxY + 26 * scale, col, fs);
    this.text(`G ${fm.nz.toFixed(1)}`, lx - 28 * scale, boxY + 44 * scale, col, fs);
    this.text(`α ${(fm.alpha * RAD).toFixed(1)}`, lx - 28 * scale, boxY + 62 * scale, col, fs);
    this.text(`T ${(p.ctrl.throttle * 100).toFixed(0)}%${fm.abFrac > 0.05 ? ' AB' : ''}`, lx - 28 * scale, boxY + 80 * scale, col, fs);

    const wid = p.selWeapon;
    const bl = hy1 - 70 * scale;
    let wtxt = 'NAV';
    if (wid === 'gun') wtxt = `GUN ${p.gunRounds}`;
    else if (wid) wtxt = `${WEAPONS[wid]?.name ?? wid} x${p.countOf(wid)}`;
    this.text(wtxt, hx0 + 10 * scale, bl, col, fs);
    const r = p.radar;
    if (r) this.text(`${r.mode} ${r.rangeScale / NM}`, hx0 + 10 * scale, bl + 18 * scale, col, fs);
    this.text(`CH ${p.chaff}  FL ${p.flares}`, hx0 + 10 * scale, bl + 36 * scale, col, fs);
    this.text(`FUEL ${Math.round(fm.totalFuel / 0.4536 / 10) * 10}`, hx1 - 10 * scale, bl, col, fs, 'right');
    const cfg: string[] = [];
    if (fm.gearPos > 0.05) cfg.push(fm.gearPos > 0.95 ? 'GEAR' : 'GEAR*');
    if (fm.flapPos > 0.05) cfg.push('FLAPS');
    if (fm.brakePos > 0.05) cfg.push('SPDBRK');
    if (p.ctrl.brakes > 0.1) cfg.push('BRK');
    if (st.autopilot) cfg.push('A/P');
    if (p.hook) cfg.push('HOOK');
    if (p.def.fcs.vtol) cfg.push(`NOZ ${(fm.nozzleAngle * RAD).toFixed(0)}`);
    if (p.def.fcs.swingWing) cfg.push(`SWP ${fm.sweep.toFixed(0)}`);
    this.text(cfg.join(' '), hx1 - 10 * scale, bl + 18 * scale, col, fs, 'right');
    if (st.steerpoint) {
      const d = st.steerpoint.clone().sub(p.pos); d.y = 0;
      const brg = wrap360(Math.atan2(d.x, -d.z) * RAD);
      this.text(`${st.steerName} ${brg.toFixed(0).padStart(3, '0')}/${(d.length() / NM).toFixed(1)}`, hx1 - 10 * scale, bl + 36 * scale, col, fs, 'right');
    }
    const warns = this.warnings(p);
    if (warns.length && this.flash % 0.8 < 0.55) {
      const red = warns[0] === 'PULL UP' || warns[0] === 'MISSILE';
      this.text(warns[0], cx, (hy0 + hy1) / 2 + 70 * scale, red ? '#ff4040' : col, 20 * scale, 'center');
    }
    // air-to-air refuelling director cue (like tanker director lights)
    const cue = this.world?.refuel.cue();
    if (cue) this.text(cue, cx, (hy0 + hy1) / 2 + 100 * scale, col, 14 * scale, 'center');
    if (this.world) this.drawCarrierCues(this.world, p, cx, (hy0 + hy1) / 2, hx1, scale, col);
    c.shadowBlur = 0;
  }

  /** catapult prompt and the "meatball" (IFLOLS-style glideslope + lineup) on approach to the carrier */
  private drawCarrierCues(world: World, p: Aircraft, cx: number, cy: number, hx1: number, scale: number, col: string) {
    if (!world.carriers.length) return;
    const c = this.ctx;
    const op = world.carrierOps.state(p);
    if (op === 'cat') this.text('ON CATAPULT — FULL POWER, THEN C TO LAUNCH', cx, cy - 115 * scale, col, 14 * scale, 'center');
    const a = world.carrierOps.approach(p, world.carriers);
    if (!a || a.range > 6000) return;
    // datum bar with the ball: one cell = 0.4°, ball limited to ±5 cells
    const x = hx1 - 40 * scale, y = cy, cell = 9 * scale;
    c.strokeStyle = col; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - 30 * scale, y); c.lineTo(x - 10 * scale, y); c.moveTo(x + 10 * scale, y); c.lineTo(x + 30 * scale, y); c.stroke();
    const k = clamp(a.glideDev / 0.4, -5, 5);
    const low = a.glideDev < -0.8;
    c.fillStyle = low ? '#ff5040' : '#ffc040';
    c.beginPath(); c.arc(x, y - k * cell, 5 * scale, 0, Math.PI * 2); c.fill();
    const lu = Math.abs(a.lineup) < 4 ? 'LINEUP OK' : a.lineup > 0 ? `◀ ${a.lineup.toFixed(0)} m` : `${(-a.lineup).toFixed(0)} m ▶`;
    this.text(lu, x, y + 60 * scale, col, 12 * scale, 'center');
    this.text(`${(a.range / NM).toFixed(1)} NM`, x, y - 60 * scale, col, 12 * scale, 'center');
  }

  warnings(p: Aircraft): string[] {
    const fm = p.fm;
    const w: string[] = [];
    if (!fm.wow) {
      const look = p.pos.clone().addScaledVector(p.vel, 5);
      if (fm.gearPos < 0.5 && (look.y < surfaceHeight(look.x, look.z) + 50 || (fm.agl < 150 && p.vel.y < -15))) w.push('PULL UP');
    }
    if (p.rwr.some((r) => r.kind === 'launch' || r.kind === 'missile')) w.push('MISSILE');
    if (fm.stalled) w.push('STALL');
    if (fm.nz > p.def.limits.gMax * 1.02) w.push('OVER G');
    if (fm.totalFuel < p.def.fuelInternal * 0.15) w.push('BINGO');
    if (fm.damage.engine < 0.6) w.push('ENGINE');
    if (fm.damage.fuelLeak > 0) w.push('FUEL LEAK');
    if (!fm.wow && fm.gearPos > 0.5 && fm.ias > 290 * KT) w.push('GEAR SPEED');
    return w;
  }

  private drawTargeting(world: World, scene: SceneRenderer, p: Aircraft, st: HudState,
    bore: Pt, fpm: Pt, scale: number, box: { hx0: number; hx1: number; hy0: number; hy1: number }) {
    const c = this.ctx;
    const col = st.color;
    const wid = p.selWeapon;
    const wdef = wid && wid !== 'gun' ? WEAPONS[wid] : null;
    const tgt = p.radar?.stt ?? null;
    const cx = (box.hx0 + box.hx1) / 2, cy = (box.hy0 + box.hy1) / 2;
    const inv = p.quat.clone().invert();
    if (tgt) {
      const s = this.projDir(scene, tgt.pos.clone().sub(scene.camera.position));
      const range = tgt.pos.distanceTo(p.pos);
      const inBox = s && s.x > box.hx0 && s.x < box.hx1 && s.y > box.hy0 && s.y < box.hy1;
      if (s && inBox) {
        const sz = 9 * scale;
        c.strokeRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
      } else {
        const dir = tgt.pos.clone().sub(p.pos).applyQuaternion(inv);
        const ang = Math.atan2(dir.x, dir.y);
        const L = 60 * scale;
        c.beginPath(); c.moveTo(bore.x, bore.y); c.lineTo(bore.x + Math.sin(ang) * L, bore.y - Math.cos(ang) * L); c.stroke();
        const off = Math.acos(clamp(-dir.z / dir.length(), -1, 1)) * RAD;
        this.text(off.toFixed(0), bore.x + Math.sin(ang) * (L + 12), bore.y - Math.cos(ang) * (L + 12), col, 11 * scale, 'center');
      }
      const los = tgt.pos.clone().sub(p.pos).normalize();
      const vc = -tgt.vel.clone().sub(p.vel).dot(los) / KT;
      this.text(`${(range / NM).toFixed(1)} NM  Vc ${vc.toFixed(0)}`, box.hx1 - 10 * scale, box.hy0 + 50 * scale, col, 12 * scale, 'right');
      this.text(`${tgt.def.name}  ${(tgt.pos.y / FT / 1000).toFixed(0)}K`, box.hx1 - 10 * scale, box.hy0 + 66 * scale, col, 12 * scale, 'right');
      if (wdef && (wdef.kind === 'arh' || wdef.kind === 'sarh' || wdef.kind === 'ir')) {
        const z = dlz(p, tgt, wid);
        const top = cy - 90 * scale, bot = cy + 90 * scale, x = box.hx1 - 30 * scale;
        const scaleMax = z.rmax * 1.3;
        const yOf = (rr: number) => bot - (clamp(rr, 0, scaleMax) / scaleMax) * (bot - top);
        c.beginPath();
        c.moveTo(x, yOf(z.rmax)); c.lineTo(x + 10, yOf(z.rmax));
        c.moveTo(x, yOf(z.rmax)); c.lineTo(x, yOf(z.rmin));
        c.moveTo(x, yOf(z.rmin)); c.lineTo(x + 10, yOf(z.rmin));
        c.stroke();
        c.fillRect(x, yOf(z.rne), 6, yOf(z.rmin) - yOf(z.rne));
        const ry = yOf(z.range);
        c.beginPath(); c.moveTo(x - 2, ry); c.lineTo(x - 12, ry - 5); c.lineTo(x - 12, ry + 5); c.closePath(); c.stroke();
        if (z.range < z.rmax && z.range > z.rmin && (wdef.kind !== 'ir' || p.irLock) && this.flash % 0.6 < 0.4) {
          this.text('SHOOT', cx, box.hy1 - 100 * scale, col, 18 * scale, 'center');
        }
        if (wdef.kind !== 'ir') {
          const R = 40 * scale;
          c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
          const d = tgt.pos.clone().sub(p.pos).applyQuaternion(inv).normalize();
          const dx = clamp(Math.atan2(d.x, -d.z) / (20 * DEG), -1.2, 1.2), dy = clamp(Math.atan2(d.y, -d.z) / (20 * DEG), -1.2, 1.2);
          c.beginPath(); c.arc(cx + dx * R, cy - dy * R, 3.5 * scale, 0, Math.PI * 2); c.fill();
        }
      }
    }
    if (wdef && wdef.kind === 'ir') {
      if (p.irLock) {
        const s = this.projDir(scene, p.irLock.pos.clone().sub(scene.camera.position));
        if (s) { c.beginPath(); c.arc(s.x, s.y, 14 * scale, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(s.x, s.y, 3, 0, Math.PI * 2); c.stroke(); }
      } else {
        c.setLineDash([4, 4]);
        c.beginPath(); c.arc(bore.x, bore.y, 22 * scale, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
      }
    }
    if (wid === 'gun' && p.def.gun) {
      const range = tgt ? clamp(tgt.pos.distanceTo(p.pos), 200, 2500) : 700;
      const mv = p.def.gun.muzzleVel;
      const gdir = p.fm.forward().addScaledVector(p.fm.up(), 0.026).normalize();
      const tof = range / (mv * 0.92 + 1);
      const bullet = gdir.clone().multiplyScalar(mv * tof * 0.92).add(new THREE.Vector3(0, -0.5 * G0 * tof * tof, 0));
      const s = this.projDir(scene, bullet);
      if (s) {
        c.beginPath(); c.arc(s.x, s.y, 12 * scale, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(s.x, s.y, 2, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(s.x, s.y, 16 * scale, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(range / 1200, 0, 1)); c.stroke();
      }
      if (tgt) this.text(`${(tgt.pos.distanceTo(p.pos) / FT).toFixed(0)} FT`, cx, box.hy1 - 120 * scale, col, 13 * scale, 'center');
    }
    if (wdef && (wdef.kind === 'bomb' || wdef.kind === 'lgb')) {
      const pred = world.predictImpact(p, wdef);
      if (pred) {
        const s = this.projDir(scene, pred.point.clone().sub(scene.camera.position));
        if (s) {
          c.beginPath(); c.moveTo(fpm.x, fpm.y); c.lineTo(s.x, s.y); c.stroke();
          c.beginPath(); c.arc(s.x, s.y, 7 * scale, 0, Math.PI * 2); c.stroke();
          c.beginPath(); c.arc(s.x, s.y, 1.5, 0, Math.PI * 2); c.fill();
        }
        this.text(`TOF ${pred.tof.toFixed(1)}s`, box.hx0 + 10 * scale, box.hy1 - 110 * scale, col, 12 * scale);
      }
    }
    if (wdef && (wdef.kind === 'agm' || wdef.kind === 'lgb')) {
      const g = p.agTarget;
      const pt = g?.alive ? g.pos : p.agPoint;
      if (pt) {
        const s = this.projDir(scene, pt.clone().sub(scene.camera.position));
        if (s) {
          c.beginPath(); c.moveTo(s.x, s.y - 9); c.lineTo(s.x + 9, s.y); c.lineTo(s.x, s.y + 9); c.lineTo(s.x - 9, s.y); c.closePath(); c.stroke();
          if (wdef.kind === 'agm') c.strokeRect(s.x - 14, s.y - 14, 28, 28);
        }
        this.text(`${g?.alive ? g.name : 'POINT'} ${(pt.distanceTo(p.pos) / NM).toFixed(1)}NM`, box.hx1 - 10 * scale, box.hy0 + 82 * scale, col, 12 * scale, 'right');
      } else {
        c.setLineDash([3, 3]); c.strokeRect(bore.x - 16, bore.y - 16, 32, 32); c.setLineDash([]);
        this.text('LOCK TO DESIGNATE', cx, box.hy1 - 100 * scale, col, 12 * scale, 'center');
      }
    }
    if (wdef && wdef.kind === 'arm') {
      const em = world.findEmitter(p, wdef);
      if (em) {
        const s = this.projDir(scene, em.pos.clone().sub(scene.camera.position));
        if (s) { c.strokeRect(s.x - 10, s.y - 10, 20, 20); this.text(em.symbol || 'SAM', s.x, s.y - 18, col, 11 * scale, 'center'); }
        this.text(`HARM ${em.name} ${(em.pos.distanceTo(p.pos) / NM).toFixed(0)}NM`, box.hx1 - 10 * scale, box.hy0 + 82 * scale, col, 12 * scale, 'right');
      } else this.text('HARM NO EMITTER', box.hx1 - 10 * scale, box.hy0 + 82 * scale, col, 12 * scale, 'right');
    }
  }

  private drawDataStrip(world: World, p: Aircraft, st: HudState) {
    const fm = p.fm;
    const y = this.h - 26;
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, y - 16, this.w, 32);
    const parts = [
      p.def.name,
      `IAS ${(fm.ias / KT).toFixed(0)} kt`,
      `M ${fm.mach.toFixed(2)}`,
      `ALT ${(fm.pos.y / FT).toFixed(0)} ft`,
      `HDG ${wrap360(fm.attitude().hdg * RAD).toFixed(0).padStart(3, '0')}`,
      `G ${fm.nz.toFixed(1)}`,
      `THR ${(p.ctrl.throttle * 100).toFixed(0)}%${fm.abFrac > 0.05 ? ' AB' : ''}`,
      `FUEL ${Math.round(fm.totalFuel / 0.4536)} lb`,
      p.selWeapon ? (p.selWeapon === 'gun' ? `GUN ${p.gunRounds}` : `${WEAPONS[p.selWeapon]?.name} x${p.countOf(p.selWeapon)}`) : '',
      st.autopilot ? 'A/P' : '',
      !p.alive ? 'DESTROYED' : p.landed ? 'LANDED' : '',
    ].filter(Boolean);
    this.text(parts.join('   '), 16, y, '#cfe', 14);
    const warns = this.warnings(p);
    if (warns.length && p.alive && this.flash % 0.8 < 0.55) this.text(warns[0], this.w / 2, this.h * 0.75, '#ff5050', 22, 'center');
    void world;
  }
}
