// The clickable cockpit: every switch, knob, button, light, gauge and display an aircraft's systems declare, built
// as 3D parts on labelled panel plates around the pilot's eye (systems/pitLayout.ts says where). The plates are
// seated on whatever cockpit model is in use, so the same layout works in the HD cockpit and the procedural one.
import * as THREE from 'three';
import { INV_OFF, INV_ON, type AircraftSystems, type ControlDef } from '../systems/types.js';
import { flowPlate, type PitItem, type PitLayout, type PlateDef, type V3 } from '../systems/pitLayout.js';
import { osbPos } from '../ui/mfd.js';
import type { ModelSwitches } from './modelSwitches.js';

/** canvas pixels per metre of panel: a 3 mm legend is about 13 px tall */
const PPM = 4400;

export type PitHit =
  | { kind: 'control'; def: ControlDef }
  | { kind: 'osb'; mfd: number; n: number }
  | { kind: 'info'; text: string };

const M = {
  plate: 0x24282c,
  metal: new THREE.MeshPhongMaterial({ color: 0xc4c8cc, specular: 0xffffff, shininess: 90 }),
  nut: new THREE.MeshPhongMaterial({ color: 0x8a8f94, specular: 0xbbbbbb, shininess: 60 }),
  black: new THREE.MeshPhongMaterial({ color: 0x141618, specular: 0x555555, shininess: 30 }),
  white: new THREE.MeshBasicMaterial({ color: 0xf2f2ea }),
  red: new THREE.MeshPhongMaterial({ color: 0xc02a1e, specular: 0x664444, shininess: 40, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  wheel: new THREE.MeshPhongMaterial({ color: 0xd0d0c8, specular: 0x888888, shininess: 30 }),
  key: new THREE.MeshPhongMaterial({ color: 0x2a2e33, specular: 0x444444, shininess: 25 }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
};

function textTexture(lines: string[], w: number, h: number, fg: string, bg: string, glow = false) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(16, Math.round(w)); cv.height = Math.max(16, Math.round(h));
  const c = cv.getContext('2d')!;
  c.fillStyle = bg; c.fillRect(0, 0, cv.width, cv.height);
  let size = Math.min(cv.height / (lines.length * 1.15), 64);
  c.font = `700 ${size}px Arial, Helvetica, sans-serif`;
  const widest = Math.max(...lines.map((l) => c.measureText(l).width), 1);
  if (widest > cv.width * 0.9) size *= cv.width * 0.9 / widest;
  c.font = `700 ${size}px Arial, Helvetica, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = fg;
  if (glow) { c.shadowColor = fg; c.shadowBlur = size * 0.3; }
  lines.forEach((l, k) => c.fillText(l, cv.width / 2, cv.height / 2 + (k - (lines.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/** break a legend over two lines when that makes it squarer */
function wrap(s: string, maxLine = 9): string[] {
  const w = s.split(' ');
  if (w.length < 2 || s.length <= maxLine) return [s];
  let best = 1, bd = Infinity;
  for (let k = 1; k < w.length; k++) { const d = Math.abs(w.slice(0, k).join(' ').length - w.slice(k).join(' ').length); if (d < bd) { bd = d; best = k; } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}

const LIGHT = {
  warning: ['#ff3a2a', '#3a0d0a'], caution: ['#ffb520', '#3a2a08'],
  green: ['#42f06a', '#0c2a14'], amber: ['#ffb520', '#3a2a08'], red: ['#ff3a2a', '#3a0d0a'], blue: ['#5aa8ff', '#0c1c33'],
} as const;

interface Part { update(sys: AircraftSystems, dt: number): void }

export class Cockpit3D {
  readonly group = new THREE.Group();
  private parts: Part[] = [];
  private picks: THREE.Object3D[] = [];
  private plates: Array<{ def: PlateDef; g: THREE.Group }> = [];
  private mfdGroups: THREE.Group[] = [];
  private guards = new Map<string, number>();
  private pressed = new Map<string, number>();
  private held: ControlDef | null = null;
  private ray = new THREE.Raycaster();
  private dispTimer = 0;
  fitted = '';

  /** `model`: the switches the cockpit model has parts for. Those move in the model and are left off the plates. */
  constructor(readonly sys: AircraftSystems, readonly layout: PitLayout, readonly model: ModelSwitches | null = null) {
    this.group.name = 'cockpit3d';
    if (model) this.picks.push(...model.picks);
    for (const p of layout.plates) this.buildPlate(p);
    layout.mfds.forEach((m, i) => this.buildMfd(i, m));
  }

  // ------------------------------------------------------------------ construction
  private frame(c: V3, n: V3, up: V3) {
    const g = new THREE.Group();
    const z = new THREE.Vector3(...n).normalize();
    const y = new THREE.Vector3(...up).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    y.crossVectors(z, x);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    g.position.set(...c);
    return g;
  }

  private buildPlate(p: PlateDef) {
    const g = this.frame(p.c, p.n, p.up);
    this.group.add(g);
    this.plates.push({ def: p, g });
    const { items } = flowPlate(p, this.sys);
    // a plate whose every control is a part of the cockpit model is not needed
    if (this.model && items.some((it) => it.kind !== 'title') && items.every((it) => it.kind === 'title' || (it.kind === 'control' && this.model!.ids.has(it.def.id)))) g.visible = false;
    const cv = document.createElement('canvas');
    cv.width = Math.round(p.w * PPM); cv.height = Math.round(p.h * PPM);
    const c = cv.getContext('2d')!;
    const px = (m: number) => m * PPM;
    // the plate: dark grey paint, a machined edge and a screw in each corner
    c.fillStyle = '#25292d'; c.fillRect(0, 0, cv.width, cv.height);
    const grain = c.createLinearGradient(0, 0, cv.width, cv.height);
    grain.addColorStop(0, 'rgba(255,255,255,.035)'); grain.addColorStop(1, 'rgba(0,0,0,.08)');
    c.fillStyle = grain; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#0c0e10'; c.lineWidth = px(0.0012); c.strokeRect(px(0.0006), px(0.0006), cv.width - px(0.0012), cv.height - px(0.0012));
    c.strokeStyle = '#4a5056'; c.lineWidth = px(0.0004); c.strokeRect(px(0.0016), px(0.0016), cv.width - px(0.0032), cv.height - px(0.0032));
    for (const [sx, sy] of [[0.005, 0.005], [p.w - 0.005, 0.005], [0.005, p.h - 0.005], [p.w - 0.005, p.h - 0.005]]) {
      c.fillStyle = '#0d0f11'; c.beginPath(); c.arc(px(sx), px(sy), px(0.0019), 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#555b61'; c.lineWidth = px(0.0004); c.beginPath(); c.moveTo(px(sx - 0.0012), px(sy - 0.0008)); c.lineTo(px(sx + 0.0012), px(sy + 0.0008)); c.stroke();
    }
    const text = (s: string, x: number, y: number, mm: number, col = '#e8e8e0', align: CanvasTextAlign = 'center', maxW = 0) => {
      let size = px(mm / 1000);
      c.font = `700 ${size}px Arial, Helvetica, sans-serif`;
      if (maxW > 0) { const w = c.measureText(s).width; if (w > px(maxW)) { size *= px(maxW) / w; c.font = `700 ${size}px Arial, Helvetica, sans-serif`; } }
      c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = col;
      c.fillText(s, px(x), px(y));
    };
    const local = (x: number, y: number, z = 0) => new THREE.Vector3(x - p.w / 2, p.h / 2 - y, z);

    for (const it of items) {
      const cx = it.x + it.w / 2;
      if (it.kind === 'title') {
        text(it.text, cx, it.y + it.h / 2, 3.4, '#f4f4ec');
        const tw = c.measureText(it.text).width / PPM / 2 + 0.006;
        c.strokeStyle = '#9aa0a6'; c.lineWidth = px(0.0005);
        c.beginPath(); c.moveTo(px(it.x + 0.008), px(it.y + it.h / 2)); c.lineTo(px(cx - tw), px(it.y + it.h / 2));
        c.moveTo(px(cx + tw), px(it.y + it.h / 2)); c.lineTo(px(it.x + it.w - 0.008), px(it.y + it.h / 2)); c.stroke();
      } else if (it.kind === 'control') { if (!this.model?.ids.has(it.def.id)) this.buildControl(g, it, local, text, c, px); }
      else if (it.kind === 'light') this.buildLight(g, it, local);
      else if (it.kind === 'gauge') this.buildGauge(g, it, local, text, c, px);
      else if (it.kind === 'display') this.buildDisplay(g, it, local, c, px);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
    // the legends are lit from behind, as panel lighting does, so they read at night and in shadow
    const face = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), new THREE.MeshPhongMaterial({ map: tex, emissiveMap: tex, emissive: 0x505050, specular: 0x222222, shininess: 12 }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, 0.004), new THREE.MeshLambertMaterial({ color: 0x15181a }));
    back.position.z = -0.0021;
    g.add(back, face);
  }

  private hitBox(g: THREE.Group, at: THREE.Vector3, w: number, h: number, d: number, hit: PitHit) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.hit);
    m.position.copy(at); m.position.z += d / 2;
    m.userData.hit = hit;
    g.add(m);
    this.picks.push(m);
  }

  private buildControl(g: THREE.Group, it: Extract<PitItem, { kind: 'control' }>, local: (x: number, y: number, z?: number) => THREE.Vector3,
    text: (s: string, x: number, y: number, mm: number, col?: string, align?: CanvasTextAlign, maxW?: number) => void, c: CanvasRenderingContext2D, px: (m: number) => number) {
    const d = it.def, cx = it.x + it.w / 2, n = d.positions.length;
    const sys0 = this.sys;
    if (it.style === 'key') {
      // a push-button with its legend on the cap
      const s = Math.min(it.w, it.h) * 0.8, cy = it.y + it.h / 2;
      c.fillStyle = '#0b0c0d'; c.fillRect(px(cx - s / 2 - 0.0008), px(cy - s / 2 - 0.0008), px(s + 0.0016), px(s + 0.0016));
      const cap = new THREE.Mesh(new THREE.BoxGeometry(s, s, 0.004), [M.key, M.key, M.key, M.key,
        new THREE.MeshPhongMaterial({ map: textTexture(wrap(d.label, 5), 128, 128, '#f0f0e8', '#2a2e33'), emissive: 0x303030, emissiveMap: null, specular: 0x333333, shininess: 20 }), M.key]);
      (cap.material as THREE.MeshPhongMaterial[])[4].emissiveMap = (cap.material as THREE.MeshPhongMaterial[])[4].map;
      const base = local(cx, cy, 0.002);
      cap.position.copy(base);
      g.add(cap);
      this.hitBox(g, local(cx, cy), it.w * 0.96, it.h * 0.96, 0.008, { kind: 'control', def: d });
      this.parts.push({ update: (sys) => { cap.position.z = base.z - (sys.get(d.id) !== (d.rest ?? 0) || (this.pressed.get(d.id) ?? 0) > 0 ? 0.0022 : 0); } });
      return;
    }
    const scale = it.h / 0.052;
    text(d.label, cx, it.y + 0.0045 * scale, 2.9, '#f4f4ec', 'center', it.w * 0.94);
    if (it.style === 'knob') {
      const cy = it.y + it.h * 0.6, r = Math.min(0.0095, it.w * 0.2) * Math.max(0.8, scale);
      const step = Math.min(45, 240 / (n - 1)) * Math.PI / 180;
      const ang = (k: number) => (k - (n - 1) / 2) * step;
      d.positions.forEach((name, k) => {
        const a = ang(k), lr = r + 0.0085 * scale;
        const tx = cx + Math.sin(a) * lr, ty = cy - Math.cos(a) * lr;
        text(name, tx + Math.sin(a) * 0.002, ty, 2.1, '#d8d8d0', Math.sin(a) < -0.3 ? 'right' : Math.sin(a) > 0.3 ? 'left' : 'center', Math.abs(Math.sin(a)) > 0.3 ? it.w / 2 - r - 0.004 : it.w * 0.5);
        c.strokeStyle = '#d8d8d0'; c.lineWidth = px(0.0004);
        c.beginPath(); c.moveTo(px(cx + Math.sin(a) * (r + 0.001)), px(cy - Math.cos(a) * (r + 0.001))); c.lineTo(px(cx + Math.sin(a) * (r + 0.0035)), px(cy - Math.cos(a) * (r + 0.0035))); c.stroke();
      });
      const knob = new THREE.Group();
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, 0.004, 28), M.black);
      skirt.rotation.x = Math.PI / 2; skirt.position.z = 0.002;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.62, r * 2.05, 0.011), M.black);
      bar.position.z = 0.0085;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 0.16, r * 0.95, 0.0006), M.white);
      mark.position.set(0, r * 0.52, 0.0143);
      knob.add(skirt, bar, mark);
      knob.position.copy(local(cx, cy));
      g.add(knob);
      this.hitBox(g, local(cx, cy), Math.min(it.w, r * 3.2), r * 3.2, 0.016, { kind: 'control', def: d });
      let cur = ang(sys0.get(d.id));
      this.parts.push({ update: (sys, dt) => { const t = -ang(sys.get(d.id)); cur += (t - cur) * Math.min(1, dt * 18); knob.rotation.z = cur; } });
      return;
    }
    // toggle switch (or the landing-gear handle): the lever points at the legend of its position
    const handle = it.style === 'handle';
    const cy = it.y + it.h * 0.56;
    const top = d.positions[n - 1], bottom = d.positions[0];
    text(top, cx, cy - 0.0125 * scale, 2.3, '#d8d8d0', 'center', it.w * 0.92);
    text(bottom, cx, cy + 0.0135 * scale, 2.3, '#d8d8d0', 'center', it.w * 0.92);
    if (n === 3) text(d.positions[1], cx + 0.0062, cy, 2.0, '#d8d8d0', 'left', it.w / 2 - 0.0068);
    const sw = new THREE.Group();
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0046, 0.0022, 6), M.nut);
    nut.rotation.x = Math.PI / 2; nut.position.z = 0.0011;
    const pivot = new THREE.Group();
    pivot.position.z = 0.0015;
    const len = handle ? 0.03 : 0.015;
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(handle ? 0.0028 : 0.0021, 0.0015, len, 14), M.metal);
    lever.rotation.x = Math.PI / 2; lever.position.z = len / 2;
    pivot.add(lever);
    if (handle) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.007, 24), M.wheel);
      wheel.position.z = len + 0.004;
      pivot.add(wheel);
    } else {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0023, 14, 10), M.metal);
      tip.position.z = len;
      pivot.add(tip);
    }
    sw.add(nut, pivot);
    sw.position.copy(local(cx, cy));
    g.add(sw);
    // a guarded switch sits under a red cover that has to be lifted first
    let cover: THREE.Group | null = null;
    if (d.guard) {
      cover = new THREE.Group();
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.0125, 0.021, 0.019), M.red);
      lid.position.set(0, -0.0105, 0.0095);
      cover.add(lid);
      cover.position.set(0, 0.0105, 0.0005);
      sw.add(cover);
    }
    this.hitBox(g, local(cx, cy), Math.min(it.w * 0.9, 0.024), 0.026 * Math.max(0.8, scale), handle ? 0.04 : 0.022, { kind: 'control', def: d });
    const tilt = (pos: number) => (n === 1 ? 0 : (pos / (n - 1) - 0.5) * 2) * (handle ? 0.42 : 0.5);
    let cur = tilt(sys0.get(d.id)), lift = 0;
    this.parts.push({
      update: (sys, dt) => {
        cur += (tilt(sys.get(d.id)) - cur) * Math.min(1, dt * 22);
        pivot.rotation.x = -cur;
        if (cover) {
          const open = (this.guards.get(d.id) ?? 0) > 0;
          void sys;
          lift += ((open ? 1 : 0) - lift) * Math.min(1, dt * 12);
          cover.rotation.x = -lift * 1.9;
        }
      },
    });
  }

  private buildLight(g: THREE.Group, it: Extract<PitItem, { kind: 'light' }>, local: (x: number, y: number, z?: number) => THREE.Vector3) {
    const d = it.def;
    const [on, off] = LIGHT[d.kind === 'indicator' ? d.color ?? 'green' : d.kind];
    // a caption light keeps its real size when it shares a row with switches
    const h = Math.min(it.h * 0.82, 0.0125), w = Math.min(it.w * 0.9, 0.034);
    const lines = wrap(d.label, 8);
    const tw = Math.round(w * PPM * 1.5), th = Math.round(h * PPM * 1.5);
    const lit = textTexture(lines, tw, th, '#fff8e8', on, true), dark = textTexture(lines, tw, th, '#6a6258', '#17130f');
    void off;
    const mat = new THREE.MeshBasicMaterial({ map: dark, toneMapped: false });
    const side = new THREE.MeshLambertMaterial({ color: 0x0c0d0e });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.0022), [side, side, side, side, mat, side]);
    cap.position.copy(local(it.x + it.w / 2, it.y + it.h / 2, 0.0011));
    g.add(cap);
    this.hitBox(g, local(it.x + it.w / 2, it.y + it.h / 2), w, h, 0.004, { kind: 'info', text: d.label });
    this.parts.push({ update: (sys) => { const m = sys.light(d.id) ? lit : dark; if (mat.map !== m) { mat.map = m; mat.needsUpdate = true; } } });
  }

  private buildGauge(g: THREE.Group, it: Extract<PitItem, { kind: 'gauge' }>, local: (x: number, y: number, z?: number) => THREE.Vector3,
    text: (s: string, x: number, y: number, mm: number, col?: string, align?: CanvasTextAlign, maxW?: number) => void, c: CanvasRenderingContext2D, px: (m: number) => number) {
    const d = it.def, cx = it.x + it.w / 2, cy = it.y + it.h / 2, r = Math.min(it.w, it.h) * 0.45;
    const A0 = -135 * Math.PI / 180, SPAN = 270 * Math.PI / 180;
    const ang = (v: number) => A0 + Math.max(0, Math.min(1, (v - d.min) / (d.max - d.min))) * SPAN;   // 0 = up, clockwise
    const pt = (a: number, rr: number): [number, number] => [px(cx + Math.sin(a) * rr), px(cy - Math.cos(a) * rr)];
    c.fillStyle = '#060707'; c.beginPath(); c.arc(px(cx), px(cy), px(r), 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#5a6066'; c.lineWidth = px(0.0007); c.stroke();
    const arc = (v0: number, v1: number, col: string) => {
      c.strokeStyle = col; c.lineWidth = px(0.0014);
      c.beginPath(); c.arc(px(cx), px(cy), px(r * 0.9), ang(v0) - Math.PI / 2, ang(v1) - Math.PI / 2); c.stroke();
    };
    if (d.redAbove !== undefined) arc(d.redAbove, d.max, '#e03020');
    if (d.redBelow !== undefined) arc(d.min, d.redBelow, '#e03020');
    for (let k = 0; k <= 10; k++) {
      const a = A0 + SPAN * k / 10, major = k % 5 === 0;
      c.strokeStyle = '#f0f0e8'; c.lineWidth = px(major ? 0.0007 : 0.0004);
      c.beginPath(); c.moveTo(...pt(a, r * (major ? 0.72 : 0.8))); c.lineTo(...pt(a, r * 0.9)); c.stroke();
    }
    const fmt = (v: number) => Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}K` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace('.0', '')}K` : `${Math.round(v)}`;
    text(fmt(d.min), cx - r * 0.42, cy + r * 0.52, 1.7, '#d8d8d0');
    text(fmt(d.max), cx + r * 0.42, cy + r * 0.52, 1.7, '#d8d8d0');
    text(d.label, cx, cy - r * 0.34, 2.0, '#f4f4ec', 'center', r * 1.25);
    text(d.unit, cx, cy + r * 0.8, 1.6, '#b8b8b0', 'center', r * 0.8);
    const needle = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 0.07, r * 1.0, 0.0006), M.white);
    bar.position.y = r * 0.36;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.0014, 16), M.black);
    hub.rotation.x = Math.PI / 2;
    needle.add(bar, hub);
    needle.position.copy(local(cx, cy, 0.0016));
    g.add(needle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.06, 8, 36), M.black);
    ring.position.copy(local(cx, cy, 0.001));
    g.add(ring);
    const hit: PitHit = { kind: 'info', text: d.label };
    this.hitBox(g, local(cx, cy), r * 2, r * 2, 0.004, hit);
    let cur = ang(this.sys.gauge(d.id));
    this.parts.push({
      update: (sys, dt) => {
        const v = sys.gauge(d.id);
        cur += (ang(v) - cur) * Math.min(1, dt * 8);
        needle.rotation.z = -cur;
        (hit as { text: string }).text = `${d.label}: ${Math.abs(d.max) >= 1000 ? Math.round(v / 10) * 10 : v.toFixed(0)} ${d.unit}`;
      },
    });
  }

  private buildDisplay(g: THREE.Group, it: Extract<PitItem, { kind: 'display' }>, local: (x: number, y: number, z?: number) => THREE.Vector3, c: CanvasRenderingContext2D, px: (m: number) => number) {
    const d = it.def;
    const CW = 22, CH = 36;
    const cv = document.createElement('canvas');
    cv.width = d.cols * CW + 16; cv.height = d.rows * CH + 12;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const w = it.w * 0.94, h = Math.min(it.h * 0.9, w * cv.height / cv.width);
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    c.fillStyle = '#060707'; c.fillRect(px(cx - w / 2 - 0.0015), px(cy - h / 2 - 0.0015), px(w + 0.003), px(h + 0.003));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.copy(local(cx, cy, 0.0008));
    g.add(scr);
    this.hitBox(g, local(cx, cy), w, h, 0.003, { kind: 'info', text: d.label });
    const fg = d.id === 'pfld' ? '#ffcf40' : '#58ff78';
    let last = '\u0000';
    this.parts.push({
      update: (sys) => {
        if (this.dispTimer > 0) return;
        const rows = sys.avionics?.display(d.id) ?? [];
        const key = rows.join('\n');
        if (key === last) return;
        last = key;
        const x = cv.getContext('2d')!;
        x.fillStyle = '#020403'; x.fillRect(0, 0, cv.width, cv.height);
        x.font = `700 ${CH * 0.82}px Consolas, "Courier New", monospace`;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        rows.forEach((row, r) => {
          let col = 0, inv = false;
          for (const ch of row) {
            if (ch === INV_ON) { inv = true; continue; }
            if (ch === INV_OFF) { inv = false; continue; }
            const X = 8 + col * CW, Y = 6 + r * CH;
            if (inv) { x.fillStyle = fg; x.fillRect(X, Y + 2, CW, CH - 4); }
            if (ch !== ' ') { x.fillStyle = inv ? '#020403' : fg; x.fillText(ch, X + CW / 2, Y + CH / 2 + 1); }
            col++;
          }
        });
        tex.needsUpdate = true;
      },
    });
  }

  /** The 20 option-select buttons round one multifunction display. */
  private buildMfd(i: number, m: { c: V3; n: V3; w: number; h: number }) {
    const n = new THREE.Vector3(...m.n).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
    const g = this.frame(m.c, m.n, [up.x, up.y, up.z]);
    g.userData.size = [m.w, m.h];
    this.group.add(g);
    this.mfdGroups[i] = g;
    const s = Math.min(m.w, m.h) * 0.085;
    const cap = new THREE.MeshPhongMaterial({ color: 0x3a3f45, specular: 0x666666, shininess: 30 });
    for (let k = 1; k <= 20; k++) {
      const q = osbPos(k);
      const out = 0.5 + 0.075;
      const x = (q.edge === 'left' ? -out : q.edge === 'right' ? out : q.u - 0.5) * m.w;
      const y = (q.edge === 'top' ? out : q.edge === 'bottom' ? -out : 0.5 - q.v) * m.h;
      const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, 0.003), cap);
      b.position.set(x, y, 0.0015);
      g.add(b);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(s * 1.7, s * 1.7, 0.008), M.hit);
      hit.position.set(x, y, 0.004);
      hit.userData.hit = { kind: 'osb', mfd: i, n: k } satisfies PitHit;
      g.add(hit);
      this.picks.push(hit);
      this.parts.push({ update: () => { b.position.z = (this.pressed.get(`osb${i}:${k}`) ?? 0) > 0 ? 0.0004 : 0.0015; } });
    }
  }

  /** Put the option-select buttons round a display of the cockpit model (centre and normal in eye-relative metres). */
  placeMfd(i: number, c: THREE.Vector3, n: THREE.Vector3, w: number, h: number) {
    const g = this.mfdGroups[i];
    if (!g) return;
    const nn = n.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(nn, -nn.y).normalize();
    const x = new THREE.Vector3().crossVectors(up, nn).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, nn));
    g.position.copy(c);
    const [w0, h0] = g.userData.size as [number, number];
    g.scale.set(w / w0, h / h0, Math.min(w / w0, h / h0));
  }

  /**
   * Seat every plate on the cockpit model: rays from above each plate find the surface under it, and the plate is
   * moved along its facing direction to lie just proud of that. `meshes` are the cockpit's own parts.
   */
  fit(meshes: THREE.Object3D[], key: string) {
    this.fitted = key;
    this.group.updateWorldMatrix(true, true);
    const rc = new THREE.Raycaster();
    const q = this.group.getWorldQuaternion(new THREE.Quaternion());
    for (const { def, g } of this.plates) {
      g.position.set(...def.c);
      const reach = def.fit ?? 0;
      if (!reach || !meshes.length) continue;
      const n = new THREE.Vector3(...def.n).normalize();
      const y = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion), x = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      const dir = n.clone().negate().applyQuaternion(q);
      const hits: number[] = [];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const o = new THREE.Vector3(...def.c).addScaledVector(x, (a / 3 - 0.5) * def.w * 0.8).addScaledVector(y, (b / 3 - 0.5) * def.h * 0.8).addScaledVector(n, reach);
        rc.set(this.group.localToWorld(o), dir);
        rc.far = reach + 0.2;
        const h = rc.intersectObjects(meshes, true)[0];
        if (h) hits.push(h.distance);
      }
      if (hits.length < 5) continue;
      hits.sort((p, r) => p - r);
      // the nearest surface that a fair part of the plate rests on, ignoring the odd thing sticking up
      const d = hits[Math.floor(hits.length * 0.2)];
      g.position.addScaledVector(n, reach - d + 0.005);
    }
  }

  // ------------------------------------------------------------------ per frame
  update(sys: AircraftSystems, dt: number) {
    this.dispTimer -= dt;
    for (const p of this.parts) p.update(sys, dt);
    this.model?.update(sys, dt);
    if (this.dispTimer <= 0) this.dispTimer = 0.08;
    for (const [id, t] of this.guards) { if (t - dt <= 0) this.guards.delete(id); else this.guards.set(id, t - dt); }
    for (const [id, t] of this.pressed) { if (t - dt <= 0) this.pressed.delete(id); else this.pressed.set(id, t - dt); }
  }

  // ------------------------------------------------------------------ interaction
  pick(cam: THREE.Camera, ndcX: number, ndcY: number): PitHit | null {
    if (!this.group.visible || !this.group.parent) return null;
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    this.ray.far = 2.5;
    const h = this.ray.intersectObjects(this.picks, false)[0];
    return h ? h.object.userData.hit as PitHit : null;
  }

  /** A click on a control: `dir` +1 (left button, wheel up) or −1 (right button, wheel down). Returns why it did not move. */
  press(hit: PitHit, dir: 1 | -1, sys: AircraftSystems, hold = true): string | null {
    if (hit.kind === 'osb') { this.pressed.set(`osb${hit.mfd}:${hit.n}`, 0.15); sys.avionics?.mfdPress(hit.mfd, hit.n); return null; }
    if (hit.kind !== 'control') return null;
    const d = hit.def, n = d.positions.length, cur = sys.get(d.id);
    if (d.momentary) {
      const rest = d.rest ?? 0;
      const to = n === 2 ? 1 - rest : Math.max(0, Math.min(n - 1, rest + dir));
      this.pressed.set(d.id, 0.15);
      const why = sys.set(d.id, to);
      if (hold) this.held = d; else sys.set(d.id, rest);
      return why;
    }
    if (d.guard && !(this.guards.get(d.id) ?? 0)) { this.guards.set(d.id, 6); return null; }
    if (d.guard) this.guards.set(d.id, 2.5);
    let to = cur + dir;
    if (n >= 4) to = Math.max(0, Math.min(n - 1, to));
    else if (n === 2) to = 1 - cur;
    else if (to > n - 1) to = dir > 0 ? cur - 1 : cur; else if (to < 0) to = cur + 1;
    return to === cur ? null : sys.set(d.id, to);
  }

  /** mouse button up: spring-loaded controls go back */
  release(sys: AircraftSystems) {
    if (this.held) { sys.set(this.held.id, this.held.rest ?? 0); this.held = null; }
  }

  describe(hit: PitHit, sys: AircraftSystems): string {
    if (hit.kind === 'info') return hit.text;
    if (hit.kind === 'osb') { const o = sys.avionics?.mfd(hit.mfd).osb[hit.n - 1]; return `OSB ${hit.n}${o?.text ? `: ${o.text}` : ''}`; }
    const d = hit.def;
    const pos = d.positions[sys.get(d.id)];
    const guard = d.guard && !(this.guards.get(d.id) ?? 0) ? ' (guarded: click to lift the cover)' : '';
    return `${d.label}${pos ? `: ${pos}` : ''}${guard}${d.help ? ` — ${d.help}` : ''}`;
  }
}
