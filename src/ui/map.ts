import { THEATER_HALF, terrainHeight, AIRBASES, OBJECTIVES, frontZAt, theaterVersion, type ObjectiveDef } from '../world/theater.js';
import { SAM_PARAMS } from '../sim/entities.js';
import { WEAPONS } from '../weapons/stores.js';

let BG: HTMLCanvasElement | null = null;
let BGver = -1;

/** Shaded-relief image of the active theater (built once per theater). */
export function theaterBackground(): HTMLCanvasElement {
  if (BG && BGver === theaterVersion) return BG;
  BGver = theaterVersion;
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const x = cv.getContext('2d')!;
  const img = x.createImageData(N, N);
  const step = (2 * THEATER_HALF) / N;
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = terrainHeight(-THEATER_HALF + i * step, -THEATER_HALF + j * step);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = H[j * N + i];
      const k = (j * N + i) * 4;
      img.data[k + 3] = 255;
      if (h <= 0) { img.data[k] = 28; img.data[k + 1] = 52; img.data[k + 2] = 74; continue; }
      const hx = H[j * N + Math.min(N - 1, i + 1)] - h;
      const hz = H[Math.min(N - 1, j + 1) * N + i] - h;
      const shade = Math.max(0.55, Math.min(1.3, 1 - (hx + hz) / 180));
      let r: number, g: number, b: number;
      if (h < 200) { r = 88; g = 104; b = 66; }
      else if (h < 600) { r = 112; g = 116; b = 76; }
      else if (h < 1200) { r = 128; g = 112; b = 86; }
      else if (h < 1800) { r = 140; g = 130; b = 118; }
      else { r = 210; g = 214; b = 220; }
      img.data[k] = r * shade; img.data[k + 1] = g * shade; img.data[k + 2] = b * shade;
    }
  }
  x.putImageData(img, 0, 0);
  BG = cv;
  return cv;
}

export interface MapView { cx: number; cz: number; mpp: number; w: number; h: number }

export interface MapMarker {
  x: number; z: number;
  side: 'blue' | 'red' | 'neutral';
  kind: 'aircraft' | 'player' | 'sam' | 'ground' | 'waypoint' | 'target';
  label?: string;
  hdg?: number;     // rad
  ring?: number;    // m
  dead?: boolean;
  highlight?: boolean;
}

export function w2s(v: MapView, x: number, z: number) {
  return { x: v.w / 2 + (x - v.cx) / v.mpp, y: v.h / 2 + (z - v.cz) / v.mpp };
}
export function s2w(v: MapView, sx: number, sy: number) {
  return { x: v.cx + (sx - v.w / 2) * v.mpp, z: v.cz + (sy - v.h / 2) * v.mpp };
}

export const SIDE_COL = { blue: '#5ab4ff', red: '#ff5a5a', neutral: '#e0e0a0' };

export interface TheaterOpts {
  front?: number[];
  airbaseOwners?: Record<string, 'blue' | 'red'>;
  objectiveStatus?: Record<string, { hp: number; owner: 'blue' | 'red' }>;
  showObjectives?: boolean;
  showSamRings?: 'blue' | 'red' | 'both' | 'none';
  markers?: MapMarker[];
  routes?: Array<{ pts: Array<{ x: number; z: number }>; color: string; dashed?: boolean }>;
}

export function drawTheater(ctx: CanvasRenderingContext2D, v: MapView, opts: TheaterOpts) {
  ctx.save();
  ctx.fillStyle = '#16212b';
  ctx.fillRect(0, 0, v.w, v.h);
  const bg = theaterBackground();
  const a = w2s(v, -THEATER_HALF, -THEATER_HALF), b = w2s(v, THEATER_HALF, THEATER_HALF);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bg, a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let g = -THEATER_HALF; g <= THEATER_HALF; g += 50000) {
    const p1 = w2s(v, g, -THEATER_HALF), p2 = w2s(v, g, THEATER_HALF);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    const q1 = w2s(v, -THEATER_HALF, g), q2 = w2s(v, THEATER_HALF, g);
    ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
  }
  if (opts.front) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,220,80,0.85)';
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    for (let x = -THEATER_HALF; x <= THEATER_HALF; x += 5000) {
      const p = w2s(v, x, frontZAt(opts.front, x));
      if (x === -THEATER_HALF) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.showSamRings && opts.showSamRings !== 'none') {
    for (const o of OBJECTIVES) {
      if (o.kind !== 'sam' || !o.samType) continue;
      const st = opts.objectiveStatus?.[o.id];
      if (st && st.hp <= 0) continue;
      const side = st?.owner ?? o.side;
      if (opts.showSamRings !== 'both' && side !== opts.showSamRings) continue;
      const p = SAM_PARAMS[o.samType];
      const rng = p.isGun ? 3000 : WEAPONS[p.weapon].rangeKm * 1000 * 0.8;
      const c = w2s(v, o.x, o.z);
      ctx.beginPath(); ctx.arc(c.x, c.y, rng / v.mpp, 0, Math.PI * 2);
      ctx.strokeStyle = side === 'red' ? 'rgba(255,80,80,0.6)' : 'rgba(80,170,255,0.6)';
      ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  if (opts.showObjectives !== false) for (const o of OBJECTIVES) drawObjective(ctx, v, o, opts.objectiveStatus?.[o.id]);
  for (const ab of AIRBASES) {
    const owner = opts.airbaseOwners?.[ab.id] ?? ab.side;
    const p = w2s(v, ab.x, ab.z);
    ctx.strokeStyle = SIDE_COL[owner];
    ctx.lineWidth = 3;
    const hr = ab.hdg * Math.PI / 180;
    const L = Math.max(6, ab.length / v.mpp);
    ctx.beginPath();
    ctx.moveTo(p.x - Math.sin(hr) * L / 2, p.y + Math.cos(hr) * L / 2);
    ctx.lineTo(p.x + Math.sin(hr) * L / 2, p.y - Math.cos(hr) * L / 2);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.lineWidth = 1.5; ctx.stroke();
    label(ctx, ab.name, p.x + 10, p.y + 12, SIDE_COL[owner]);
  }
  for (const r of opts.routes ?? []) {
    ctx.strokeStyle = r.color; ctx.lineWidth = 2;
    ctx.setLineDash(r.dashed ? [6, 4] : []);
    ctx.beginPath();
    r.pts.forEach((pt, i) => { const s = w2s(v, pt.x, pt.z); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const m of opts.markers ?? []) drawMarker(ctx, v, m);
  const km = v.mpp * 100 / 1000;
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, v.h - 16); ctx.lineTo(114, v.h - 16); ctx.stroke();
  label(ctx, `${km.toFixed(km < 10 ? 1 : 0)} km`, 14, v.h - 28, '#ddd');
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, col: string, size = 11) {
  ctx.font = `${size}px Consolas, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(s, x + 1, y + 1);
  ctx.fillStyle = col;
  ctx.fillText(s, x, y);
}

function drawObjective(ctx: CanvasRenderingContext2D, v: MapView, o: ObjectiveDef, st?: { hp: number; owner: 'blue' | 'red' }) {
  const p = w2s(v, o.x, o.z);
  const owner = st?.owner ?? o.side;
  const dead = st ? st.hp <= 0 : false;
  const col = dead ? '#777' : SIDE_COL[owner];
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  const s = 6;
  ctx.beginPath();
  switch (o.kind) {
    case 'sam': ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.lineTo(p.x - s, p.y + s); ctx.closePath(); break;
    case 'factory': ctx.rect(p.x - s, p.y - s, s * 2, s * 2); break;
    case 'depot': ctx.rect(p.x - s, p.y - s * 0.6, s * 2, s * 1.2); break;
    case 'bridge': ctx.moveTo(p.x - s, p.y - 3); ctx.lineTo(p.x + s, p.y - 3); ctx.moveTo(p.x - s, p.y + 3); ctx.lineTo(p.x + s, p.y + 3); break;
    case 'radar': ctx.arc(p.x, p.y, s, Math.PI, 0); break;
    case 'command': ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath(); break;
    case 'city': ctx.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2); break;
    default: ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  }
  ctx.stroke();
  if (dead) { ctx.beginPath(); ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s); ctx.stroke(); }
  if (v.mpp < 400) label(ctx, `${o.name}${st && st.hp > 0 && st.hp < 100 ? ` ${Math.round(st.hp)}%` : ''}`, p.x + 9, p.y, col, 10);
}

export function drawMarker(ctx: CanvasRenderingContext2D, v: MapView, m: MapMarker) {
  const p = w2s(v, m.x, m.z);
  const col = m.dead ? '#777' : m.kind === 'player' ? '#ffffff' : SIDE_COL[m.side];
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = m.highlight ? 2.5 : 1.5;
  if (m.ring) { ctx.beginPath(); ctx.arc(p.x, p.y, m.ring / v.mpp, 0, Math.PI * 2); ctx.stroke(); }
  switch (m.kind) {
    case 'player': case 'aircraft': {
      const s = m.kind === 'player' ? 9 : 7;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(m.hdg ?? 0);
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s); ctx.lineTo(0, s * 0.5); ctx.lineTo(-s * 0.7, s); ctx.closePath();
      if (m.kind === 'player') ctx.fill(); else ctx.stroke();
      ctx.restore();
      break;
    }
    case 'waypoint': ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke(); break;
    case 'target':
      ctx.beginPath(); ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
      break;
    case 'sam': ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y + 5); ctx.lineTo(p.x - 6, p.y + 5); ctx.closePath(); ctx.stroke(); break;
    default: ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
  }
  if (m.label) label(ctx, m.label, p.x + 9, p.y - 8, col, 11);
}
