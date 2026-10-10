import type { World } from '../sim/world.js';
import type { Aircraft } from '../sim/entities.js';
import { WEAPONS } from '../weapons/stores.js';
import { RANGE_SCALES_NM } from '../avionics/radar.js';
import { RAD, clamp, wrap360 } from '../core/math.js';
import { FT, NM } from '../sim/atmosphere.js';

export type MfdPage = 'FCR' | 'HSD' | 'RWR' | 'SMS' | 'ENG';
const LEFT_PAGES: MfdPage[] = ['FCR', 'HSD', 'ENG'];
const RIGHT_PAGES: MfdPage[] = ['RWR', 'SMS', 'HSD'];

const GREEN = '#40ff70';
const DIM = '#1d6b33';

export class Mfds {
  private world: World | null = null;
  left: HTMLCanvasElement;
  right: HTMLCanvasElement;
  leftPage: MfdPage = 'FCR';
  rightPage: MfdPage = 'RWR';
  private timer = 0;
  private flash = 0;
  constructor(left: HTMLCanvasElement, right: HTMLCanvasElement) {
    this.left = left; this.right = right;
    for (const c of [left, right]) { c.width = 300; c.height = 300; }
    left.addEventListener('click', () => this.cycle('left'));
    right.addEventListener('click', () => this.cycle('right'));
  }
  cycle(side: 'left' | 'right') {
    if (side === 'left') this.leftPage = LEFT_PAGES[(LEFT_PAGES.indexOf(this.leftPage) + 1) % LEFT_PAGES.length];
    else this.rightPage = RIGHT_PAGES[(RIGHT_PAGES.indexOf(this.rightPage) + 1) % RIGHT_PAGES.length];
  }

  draw(world: World, dt: number) {
    this.timer -= dt;
    this.flash += dt;
    if (this.timer > 0) return;
    this.timer = 1 / 20;
    const p = world.player;
    this.world = world;
    const panels: Array<[HTMLCanvasElement, MfdPage, MfdPage[]]> = [[this.left, this.leftPage, LEFT_PAGES], [this.right, this.rightPage, RIGHT_PAGES]];
    for (const [cv, page, pages] of panels) {
      const c = cv.getContext('2d')!;
      c.fillStyle = '#050a06';
      c.fillRect(0, 0, 300, 300);
      if (!p || !p.alive) { this.txt(c, 'OFF', 150, 150, DIM, 20, 'center'); continue; }
      switch (page) {
        case 'FCR': this.fcr(c, p); break;
        case 'HSD': this.hsd(c, world, p); break;
        case 'RWR': this.rwr(c, p); break;
        case 'SMS': this.sms(c, p); break;
        case 'ENG': this.eng(c, p); break;
      }
      pages.forEach((pg, i) => this.txt(c, pg, 60 + i * 90, 290, pg === page ? GREEN : DIM, 12, 'center'));
      c.strokeStyle = DIM; c.lineWidth = 2; c.strokeRect(1, 1, 298, 298);
    }
  }

  private txt(c: CanvasRenderingContext2D, s: string, x: number, y: number, col: string, size = 12, align: CanvasTextAlign = 'left') {
    c.font = `${size}px Consolas, monospace`;
    c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = col;
    c.fillText(s, x, y);
  }

  private fcr(c: CanvasRenderingContext2D, p: Aircraft) {
    const r = p.radar;
    if (!r) { this.txt(c, 'NO RADAR', 150, 140, GREEN, 18, 'center'); return; }
    const x0 = 20, x1 = 280, y0 = 30, y1 = 270;
    const az = r.def.azLimit;
    const scanX = (a: number) => x0 + (a + az) / (2 * az) * (x1 - x0);
    c.strokeStyle = DIM; c.lineWidth = 1;
    c.strokeRect(x0, y0, x1 - x0, y1 - y0);
    for (let i = 1; i < 4; i++) { const y = y0 + (y1 - y0) * i / 4; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + 8, y); c.moveTo(x1, y); c.lineTo(x1 - 8, y); c.stroke(); }
    for (const a of [-30, 0, 30]) { const x = scanX(a); c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y1 - 6); c.stroke(); }
    c.setLineDash([3, 5]);
    c.beginPath(); c.moveTo(scanX(-r.azScan), y0); c.lineTo(scanX(-r.azScan), y1); c.moveTo(scanX(r.azScan), y0); c.lineTo(scanX(r.azScan), y1); c.stroke();
    c.setLineDash([]);
    const scale = r.rangeScale;
    this.txt(c, r.mode, 22, 16, GREEN, 13);
    this.txt(c, `${RANGE_SCALES_NM[r.rangeIdx]}`, 278, 16, GREEN, 13, 'right');
    this.txt(c, `EL ${r.elevCenter >= 0 ? '+' : ''}${r.elevCenter.toFixed(0)}`, 150, 16, DIM, 11, 'center');
    if (r.mode === 'OFF') this.txt(c, 'STBY', 150, 150, DIM, 20, 'center');
    const inv = p.quat.clone().invert();
    for (const ct of r.contacts.values()) {
      const d = ct.pos.clone().sub(p.pos);
      const range = d.length();
      if (range > scale) continue;
      const b = d.clone().applyQuaternion(inv);
      const a = Math.atan2(b.x, -b.z) * RAD;
      if (Math.abs(a) > az) continue;
      const x = scanX(a);
      const y = y1 - (range / scale) * (y1 - y0);
      const locked = r.stt === ct.target;
      c.strokeStyle = GREEN; c.fillStyle = GREEN; c.lineWidth = 1.5;
      if (ct.irst) { c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.stroke(); }
      else if (locked) c.fillRect(x - 5, y - 5, 10, 10);
      else if (r.isTracked(ct.target)) c.fillRect(x - 4, y - 4, 8, 8);
      else c.fillRect(x - 4, y - 2, 8, 4);
      const vb = ct.vel.clone().applyQuaternion(inv);
      const vl = Math.hypot(vb.x, vb.z) || 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + vb.x / vl * 12, y + vb.z / vl * 12); c.stroke();
      this.txt(c, `${Math.round(ct.pos.y / FT / 1000)}`, x + 7, y + 8, GREEN, 10);
      if (r.cursor === ct.target || locked) c.strokeRect(x - 9, y - 9, 18, 18);
    }
    // datalink tracks the own radar doesn't hold: hollow boxes
    if (p.def.datalink !== false && this.world) {
      for (const t of this.world.datalink.picture(p.side, p)) {
        const d = t.pos.clone().sub(p.pos);
        const range = d.length();
        if (range > scale) continue;
        const b = d.clone().applyQuaternion(inv);
        const a = Math.atan2(b.x, -b.z) * RAD;
        if (Math.abs(a) > az) continue;
        const x = scanX(a), y = y1 - (range / scale) * (y1 - y0);
        c.strokeStyle = DIM; c.lineWidth = 1.2; c.strokeRect(x - 4, y - 4, 8, 8);
      }
    }
    if (r.stt) {
      const t = r.stt;
      const range = t.pos.distanceTo(p.pos);
      const los = t.pos.clone().sub(p.pos).normalize();
      const vc = -t.vel.clone().sub(p.vel).dot(los) / 0.5144;
      const aspect = Math.acos(clamp(t.fm.forward().dot(los.clone().negate()), -1, 1)) * RAD;
      this.txt(c, `${(range / NM).toFixed(1)}NM VC${vc.toFixed(0)} ASP${aspect.toFixed(0)}`, 150, 278, GREEN, 11, 'center');
      // NCTR: engine-blade signature readable when the target is roughly nose-on and inside ~25 NM
      if (aspect < 30 && range < 25 * NM && !r.def.name.includes('APG-66') && r.def.name !== 'AN/AWG-9') this.txt(c, `NCTR ${t.def.name}`, 150, 44, GREEN, 12, 'center');
    }
  }

  private hsd(c: CanvasRenderingContext2D, world: World, p: Aircraft) {
    const cx = 150, cy = 200;
    const rangeM = 80 * NM;
    const px = 170 / rangeM;
    const hdg = p.fm.attitude().hdg;
    c.strokeStyle = DIM; c.lineWidth = 1;
    for (const k of [0.25, 0.5, 1]) { c.beginPath(); c.arc(cx, cy, 170 * k, Math.PI, 2 * Math.PI); c.stroke(); }
    this.txt(c, 'HSD 80NM', 10, 14, GREEN, 12);
    const toScreen = (x: number, z: number) => {
      const dx = x - p.pos.x, dz = z - p.pos.z;
      const rx = dx * Math.cos(hdg) + dz * Math.sin(hdg);
      const rz = -dx * Math.sin(hdg) + dz * Math.cos(hdg);
      return { x: cx + rx * px, y: cy + rz * px };
    };
    for (const s of world.sites) {
      if (!s.alive) continue;
      const q = toScreen(s.radar.pos.x, s.radar.pos.z);
      const rng = s.params.isGun ? 3000 : WEAPONS[s.params.weapon].rangeKm * 800;
      const col = s.side === p.side ? '#4aa0ff' : '#ff5050';
      c.strokeStyle = col;
      c.beginPath(); c.arc(q.x, q.y, rng * px, 0, Math.PI * 2); c.stroke();
      this.txt(c, s.params.symbol, q.x, q.y, col, 10, 'center');
    }
    for (const a of world.aircraft) {
      if (!a.active || a === p) continue;
      if (a.side !== p.side && !p.radar?.contacts.has(a.id)) continue;
      const q = toScreen(a.pos.x, a.pos.z);
      c.fillStyle = a.side === p.side ? '#4aa0ff' : '#ff5050';
      c.beginPath(); c.arc(q.x, q.y, 4, 0, Math.PI * 2); c.fill();
    }
    // off-board (datalink) tracks: hollow symbols with a heading stub; AWACS tracks marked with a dot
    if (p.def.datalink !== false) {
      for (const t of world.datalink.picture(p.side, p)) {
        const q = toScreen(t.pos.x, t.pos.z);
        const vq = toScreen(t.pos.x + t.vel.x * 30, t.pos.z + t.vel.z * 30);
        c.strokeStyle = '#ff7a50'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(q.x, q.y - 6); c.lineTo(q.x + 5, q.y + 4); c.lineTo(q.x - 5, q.y + 4); c.closePath(); c.stroke();
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(vq.x, vq.y); c.stroke();
        if (t.awacs) { c.fillStyle = '#ff7a50'; c.fillRect(q.x - 1, q.y - 1, 2, 2); }
      }
      this.txt(c, 'L16', 290, 14, DIM, 11, 'right');
    }
    c.fillStyle = GREEN;
    c.beginPath(); c.moveTo(cx, cy - 8); c.lineTo(cx + 6, cy + 6); c.lineTo(cx - 6, cy + 6); c.closePath(); c.fill();
    this.txt(c, wrap360(hdg * RAD).toFixed(0).padStart(3, '0'), cx, 40, GREEN, 13, 'center');
  }

  private rwr(c: CanvasRenderingContext2D, p: Aircraft) {
    const cx = 150, cy = 145, R = 110;
    c.strokeStyle = DIM; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, R * 0.5, 0, Math.PI * 2); c.stroke();
    for (let a = 0; a < 360; a += 30) {
      const r0 = a % 90 === 0 ? R - 12 : R - 6;
      const s = Math.sin(a / RAD), co = Math.cos(a / RAD);
      c.beginPath(); c.moveTo(cx + s * r0, cy - co * r0); c.lineTo(cx + s * R, cy - co * R); c.stroke();
    }
    c.strokeStyle = GREEN;
    c.beginPath(); c.moveTo(cx - 6, cy); c.lineTo(cx + 6, cy); c.moveTo(cx, cy - 6); c.lineTo(cx, cy + 6); c.stroke();
    this.txt(c, 'RWR', 10, 14, GREEN, 12);
    const seen = new Set<number>();
    for (const e of p.rwr) {
      if (seen.has(e.sourceId)) continue;
      seen.add(e.sourceId);
      const lethal = e.kind === 'missile' || e.kind === 'launch' ? 0.35 : e.kind === 'lock' ? 0.6 : 0.85;
      const rr = R * lethal;
      const x = cx + Math.sin(e.bearing / RAD) * rr, y = cy - Math.cos(e.bearing / RAD) * rr;
      const urgent = e.kind === 'launch' || e.kind === 'missile';
      const col = urgent ? '#ff4040' : e.kind === 'lock' ? '#ffd040' : GREEN;
      if (!(urgent && this.flash % 0.5 < 0.25)) this.txt(c, e.symbol, x, y, col, 14, 'center');
      c.strokeStyle = col;
      if (e.kind === 'lock' || e.kind === 'launch') { c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.stroke(); }
      if (e.kind === 'missile') { c.beginPath(); c.moveTo(x, y - 12); c.lineTo(x + 12, y); c.lineTo(x, y + 12); c.lineTo(x - 12, y); c.closePath(); c.stroke(); }
    }
    if (p.rwr.some((e) => e.kind === 'launch' || e.kind === 'missile')) { if (this.flash % 0.5 < 0.3) this.txt(c, 'LAUNCH', 150, 268, '#ff4040', 16, 'center'); }
    else if (p.rwr.some((e) => e.kind === 'lock')) this.txt(c, 'LOCK', 150, 268, '#ffd040', 14, 'center');
  }

  private sms(c: CanvasRenderingContext2D, p: Aircraft) {
    this.txt(c, 'SMS', 10, 14, GREEN, 12);
    const counts = new Map<string, number>();
    for (const s of p.stores) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    let y = 44;
    for (const [id, n] of counts) {
      const sel = p.selWeapon === id;
      this.txt(c, `${sel ? '>' : ' '} ${n}  ${WEAPONS[id]?.name ?? id}`, 16, y, sel ? '#ffffff' : GREEN, 14);
      y += 22;
    }
    if (p.def.gun) { const sel = p.selWeapon === 'gun'; this.txt(c, `${sel ? '>' : ' '} GUN ${p.gunRounds}  ${p.def.gun.name}`, 16, y, sel ? '#fff' : GREEN, 14); y += 22; }
    y += 10;
    this.txt(c, `CHAFF ${p.chaff}   FLARE ${p.flares}`, 16, y, GREEN, 13);
    this.txt(c, `GROSS WT ${Math.round(p.fm.mass / 0.4536)} LB`, 16, y + 22, DIM, 12);
  }

  private eng(c: CanvasRenderingContext2D, p: Aircraft) {
    const fm = p.fm;
    this.txt(c, 'ENGINE / FUEL', 10, 14, GREEN, 12);
    const rows: Array<[string, string]> = [
      ['ENGINE', fm.def.engine.name],
      ['RPM', `${fm.rpm.toFixed(0)} %`],
      ['NOZ/AB', fm.abFrac > 0.02 ? `AB ${(fm.abFrac * 100).toFixed(0)}%` : 'MIL'],
      ['THRUST', `${(fm.thrust / 1000).toFixed(0)} kN`],
      ['FF', `${Math.round(fm.fuelFlow * 3600 / 0.4536)} PPH`],
      ['INT FUEL', `${Math.round(fm.fuel / 0.4536)} LB`],
      ['EXT FUEL', `${Math.round(fm.extFuel / 0.4536)} LB`],
      ['ENDURANCE', fm.fuelFlow > 0 ? `${Math.floor(fm.totalFuel / fm.fuelFlow / 60)} MIN` : '--'],
      ['HEALTH', `${Math.max(0, Math.round(p.health))} %`],
      ['ENG DMG', fm.damage.engine < 1 ? `${Math.round((1 - fm.damage.engine) * 100)} %` : 'OK'],
      ['HYD', fm.damage.hydraulics < 1 ? 'DEGRADED' : 'OK'],
    ];
    rows.forEach(([k, v], i) => { this.txt(c, k, 16, 42 + i * 21, DIM, 13); this.txt(c, v, 284, 42 + i * 21, GREEN, 13, 'right'); });
  }
}
