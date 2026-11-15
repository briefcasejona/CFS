// Where an aircraft's switches, lights, gauges and displays sit in its 3D cockpit. A layout is a set of flat panel
// plates around the pilot's eye; each plate lists what it carries row by row, and `flowPlate` turns that into
// rectangles. Pure data and arithmetic, so it can be checked without a renderer.
import type { AircraftSystems, ControlDef, GaugeDef, LightDef, TextDisplayDef } from './types.js';

export type V3 = [number, number, number];

export interface PlateDef {
  id: string;
  /** centre in metres from the pilot's eye (x right, y up, −z forward), facing direction, and which way its top points */
  c: V3; n: V3; up: V3;
  w: number; h: number;
  /** rows from the top down; a cell is "t:Title", "c:control", "l:light", "g:gauge", "d:display" or "" (a gap),
   *  optionally "*2" for double width */
  rows: string[][];
  /** how far the plate may be moved along its facing direction to sit on the cockpit model (m); 0 = fixed */
  fit?: number;
}

export interface PitLayout {
  plates: PlateDef[];
  /** the multifunction displays' faces, for their option-select buttons (the HD model may override these) */
  mfds: Array<{ c: V3; n: V3; w: number; h: number }>;
}

export type PitItem =
  | { kind: 'title'; text: string; x: number; y: number; w: number; h: number }
  | { kind: 'control'; def: ControlDef; style: 'toggle' | 'knob' | 'key' | 'handle'; x: number; y: number; w: number; h: number }
  | { kind: 'light'; def: LightDef; x: number; y: number; w: number; h: number }
  | { kind: 'gauge'; def: GaugeDef; x: number; y: number; w: number; h: number }
  | { kind: 'display'; def: TextDisplayDef; x: number; y: number; w: number; h: number };

/** row heights in metres by what the row holds */
const ROW = { title: 0.011, light: 0.015, key: 0.021, control: 0.052, gauge: 0.05, displayLine: 0.0085 };

export function controlStyle(c: ControlDef): 'toggle' | 'knob' | 'key' | 'handle' {
  if (c.momentary && c.positions.length === 2 && c.positions[0] === '') return 'key';
  if (c.id === 'lgHandle') return 'handle';
  return c.positions.length >= 4 ? 'knob' : 'toggle';
}

/** Lay a plate's rows out: x right and y down from its top-left corner, in metres. `scale` < 1 means it was squeezed. */
export function flowPlate(p: PlateDef, sys: Pick<AircraftSystems, 'controls' | 'lights' | 'gauges' | 'avionics'>): { items: PitItem[]; scale: number; missing: string[] } {
  const missing: string[] = [];
  const rows = p.rows.map((cells) => {
    const parsed = cells.map((cell) => {
      const m = /^(?:([tclgd]):)?(.*?)(?:\*(\d+(?:\.\d+)?))?$/.exec(cell)!;
      return { type: m[1] ?? '', name: m[2], weight: Number(m[3] ?? 1) };
    });
    let h = 0;
    for (const c of parsed) {
      if (c.type === 't') h = Math.max(h, ROW.title);
      else if (c.type === 'l') h = Math.max(h, ROW.light);
      else if (c.type === 'g') h = Math.max(h, ROW.gauge);
      else if (c.type === 'd') h = Math.max(h, (sys.avionics?.displays.find((d) => d.id === c.name)?.rows ?? 4) * ROW.displayLine + 0.008);
      else if (c.type === 'c') { const d = sys.controls.find((x) => x.id === c.name); h = Math.max(h, d && controlStyle(d) === 'key' ? ROW.key : ROW.control); }
    }
    return { parsed, h: h || ROW.light };
  });
  const total = rows.reduce((s, r) => s + r.h, 0);
  const scale = Math.min(1, p.h / total);
  const items: PitItem[] = [];
  // rows keep their height and are spread over the plate
  const gap = (p.h - total * scale) / (rows.length + 1);
  let y = gap;
  for (const r of rows) {
    const h = r.h * scale;
    const wsum = r.parsed.reduce((s, c) => s + c.weight, 0);
    let x = 0;
    for (const c of r.parsed) {
      const w = p.w * c.weight / wsum;
      const box = { x, y, w, h };
      x += w;
      if (c.type === 't') items.push({ kind: 'title', text: c.name, ...box });
      else if (c.type === 'c') { const def = sys.controls.find((d) => d.id === c.name); if (def) items.push({ kind: 'control', def, style: controlStyle(def), ...box }); else missing.push(`c:${c.name}`); }
      else if (c.type === 'l') { const def = sys.lights.find((d) => d.id === c.name); if (def) items.push({ kind: 'light', def, ...box }); else missing.push(`l:${c.name}`); }
      else if (c.type === 'g') { const def = sys.gauges.find((d) => d.id === c.name); if (def) items.push({ kind: 'gauge', def, ...box }); else missing.push(`g:${c.name}`); }
      else if (c.type === 'd') { const def = sys.avionics?.displays.find((d) => d.id === c.name); if (def) items.push({ kind: 'display', def, ...box }); else missing.push(`d:${c.name}`); }
    }
    y += h + gap;
  }
  return { items, scale, missing };
}
