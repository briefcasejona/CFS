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
    // The F-16 HUD symbology is rebuilt from TO 1F-16CMAM-34-1-1 separately; until then every view shows the game's
    // own data strip (not a cockpit display).
    this.drawDataStrip(world, p, st);
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
    if (!fm.wow && (fm.alpha * RAD > p.def.limits.aoaMax || fm.alpha * RAD < -(p.def.limits.aoaNeg ?? 10))) w.push('AOA');
    if (fm.totalFuel < p.def.fuelInternal * 0.15) w.push('BINGO');
    if (fm.damage.engine < 0.6 && !w.includes('ENGINE')) w.push('ENGINE');
    if (fm.damage.fuelLeak > 0) w.push('FUEL LEAK');
    if (!fm.wow && fm.gearPos > 0.5 && fm.ias > 290 * KT) w.push('GEAR SPEED');
    return w;
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
