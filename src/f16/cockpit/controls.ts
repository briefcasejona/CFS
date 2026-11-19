// The F-16 cockpit's controls, read from the node names of the cockpit model (assets/models/cockpits/f16/cockpit.glb).
//
// Naming in the model (Jonathan's convention):
//   <NAME>_S<n>   a switch with n positions          MAIN_POWER_S3
//   <NAME>_K<n>   a knob with n detents               AIR_SOURCE_K4
//   <NAME>_B      a push button (ICP_B<d>: ICP key d)  Master_Caution_B, ICP_B3
//   <NAME>_AX     an axis: a wheel or rheostat that can be bound to a joystick axis or turned with the mouse wheel
// Spring-loaded controls snap back when released (Jonathan's list): the ICP INC/DEC rocker, the ICP DOBBER (4-way,
// back to centre), the MANUAL PITCH override switch, and the down positions of WARN RESET and PROBE HEAT.
//
// This file is pure data and state (no three.js), so the simulation, the input bindings and the tests can use it.

export type ControlKind = 'switch' | 'knob' | 'button' | 'axis';

export interface ControlDef {
  /** the node name as written in the model file */
  node: string;
  /** stable id: the node name without its type suffix, upper case, '/' and spaces as '_' (MAIN_POWER, ICP_INC_DC) */
  id: string;
  kind: ControlKind;
  /** positions (switch), detents (knob), 2 for a button (out / in), 0 for an axis */
  n: number;
  /** spring-loaded: the positions that are only held while the pilot holds them, and where the control returns to */
  spring?: { momentary: number[]; rest: number };
  /** 4-way + centre (the ICP dobber): position 0 centre, 1 up, 2 down, 3 left, 4 right */
  fourWay?: boolean;
  /** an endless rotary (no stops), e.g. the HSI heading knob */
  endless?: boolean;
  /** what the tooltip calls it */
  label: string;
}

/** Every node of the cockpit model that is a control, as named in the file. tests/cockpit.test.ts checks this list
 *  against the model itself. */
export const COCKPIT_NODES = [
  'UFC_S2', 'AG_MASTER_B', 'AA_MASTER_B', 'ICP_LIST_B', 'ICP_IFF_B', 'ICP_COM2_B', 'ICP_COM1_B', 'ICP_SYM_AX',
  'LASER_ARM_S2', 'MASTER_ARM_S3', 'ICP_RCL_B', 'ICP_B0', 'ICP_B1', 'ICP_B2', 'ICP_B3', 'ICP_B4', 'ICP_B5', 'ICP_B6',
  'ICP_B7', 'ICP_B8', 'ICP_B9', 'ICP_ENTR_B', 'ICP_INC/DC_S2', 'ICP_DOBBER_S5', 'WARN_RESET_S3', 'COMM2_VOL_AX',
  'COMM1_VOL_AX', 'FORM_LIGHTS_AX', 'LE_FLAPS_S2', 'DIGITAL_BACKUP_S2', 'MANUAL_TF_FLYUP_S2', 'ALT_FLAPS_S2',
  'FLCS_BIT_2', 'FLCS_RESET_S2', 'REFUEL_DOOR_S2', 'ANTI_COLLISION_S2', 'MAIN_POWER_S3', 'JFS_S3', 'PBRAKE_S3',
  'F-ack_B', 'MAX_PWR_S2', 'LIGHTS_MASTER_S2', 'UHF_DIGIT1_K10', 'UHF_DIGIT2_K10', 'UHF_DIGIT3_K10', 'UHF_DIGIT4_K10',
  'UHF_PWR_K4', 'UHF_MODE_K3', 'CHAN_SEL_K20', 'UHF_DIGIT5AND6_K4', 'ENG_FEED_K4', 'IFF_MASTER_K5', 'CANOPY_S2',
  'FUEL_SELECT_K5', 'NAV_MODE_K3', 'HEADING_SELECT_AX', 'Gear_Lever_S2', 'RDR_ALTIMETER_S3', 'DED_DISPLAY_BRT_AX',
  'INSTRUMENT_FLOOD_LIGHTS_AX', 'CONSOLE_FLOOD_LIGHT_AX', 'AIR_SOURCE_K4', 'MCC_S2', 'ST_STA_S2', 'MFD_S2',
  'DATA_LINK_S2', 'GPS_S2', 'INS_FUNCTION_K6', 'OXIGEN_SUPLY_S2', 'LAND_LIGHT_S3', 'Master_Caution_B',
  ...Array.from({ length: 20 }, (_, i) => `LOSB${i + 1}_B`),
  ...Array.from({ length: 20 }, (_, i) => (i + 1 === 4 || i + 1 === 6 || i + 1 === 13 ? `ROSB${i + 1}_B.001` : `ROSB${i + 1}_B`)),
] as const;

/** Nodes that are not controls but move with the jet: gauge needles, the attitude ball, the throttle, the displays. */
export const INDICATOR_NODES = [
  'ATT_INDICATOR_BALL', 'OIL_PRESURE_NEEDLE', 'NOZZLE_POS_NEEDLE', 'RPM_NEEDLE', 'FTIT_NEEDLE', 'FUEL_NEEDLE',
  'CAUTION_PANEL', 'MFD_LEFT_SCREEN', 'MFD_RIGHT SCREEN', 'throttle (B)',
] as const;

/** three.js's glTF loader strips '[ ] . : /' from names and turns spaces into '_'; this undoes nothing but lets a
 *  name from either source be compared. */
export function sanitize(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

const LABELS: Record<string, string> = {
  ICP_INC_DC: 'ICP INC/DEC rocker', ICP_DOBBER: 'ICP DCS (dobber)', F_ACK: 'F-ACK', ICP_SYM: 'HUD SYM wheel',
  OXIGEN_SUPLY: 'OXYGEN SUPPLY', PBRAKE: 'PARKING BRAKE', JFS: 'JFS', MCC: 'MMC', CHAN_SEL: 'UHF CHANNEL',
};

/** Parse one node name. Returns null for a node that is not a control. */
export function parseControl(node: string): ControlDef | null {
  const raw = node.replace(/\.\d+$/, '');   // Blender duplicates: ROSB13_B.001 is OSB 13
  let m: RegExpExecArray | null;
  let kind: ControlKind, n: number, base: string;
  if ((m = /^(.*)_S(\d+)$/i.exec(raw))) { kind = 'switch'; n = +m[2]; base = m[1]; }
  else if ((m = /^(FLCS_BIT)_(\d+)$/i.exec(raw))) { kind = 'switch'; n = +m[2]; base = m[1]; }   // FLCS_BIT_2: the S is missing
  else if ((m = /^(.*)_K(\d+)$/i.exec(raw))) { kind = 'knob'; n = +m[2]; base = m[1]; }
  else if ((m = /^(.*)_AX$/i.exec(raw))) { kind = 'axis'; n = 0; base = m[1]; }
  else if ((m = /^(ICP)_B(\d)$/i.exec(raw))) { kind = 'button'; n = 2; base = `${m[1]}_${m[2]}`; }
  else if ((m = /^(.*)_B$/i.exec(raw))) { kind = 'button'; n = 2; base = m[1]; }
  else return null;
  const id = base.toUpperCase().replace(/[\s/-]+/g, '_');
  const def: ControlDef = { node, id, kind, n, label: LABELS[id] ?? id.replace(/_/g, ' ') };
  // spring-loaded, as Jonathan listed them
  if (id === 'ICP_INC_DC') { def.n = 3; def.spring = { momentary: [0, 2], rest: 1 }; }   // DEC / centre / INC
  else if (id === 'ICP_DOBBER') { def.fourWay = true; def.spring = { momentary: [1, 2, 3, 4], rest: 0 }; }
  else if (/MANUAL_PITCH/.test(id)) { def.spring = { momentary: [0, n - 1].filter((p) => p !== Math.floor((n - 1) / 2)), rest: Math.floor((n - 1) / 2) }; }
  else if (id === 'WARN_RESET' || /PROBE_HEAT/.test(id)) { def.spring = { momentary: [0], rest: 1 }; }   // the down position (index 0) springs back
  if (id === 'HEADING_SELECT' || /COURSE|CRS/.test(id)) def.endless = true;
  return def;
}

/** All controls in the model. */
export const CONTROLS: ControlDef[] = COCKPIT_NODES.map((n) => parseControl(n)!);
export const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));
/** the axis controls, for the input bindings ("Cockpit axes") */
export const AXIS_CONTROLS = CONTROLS.filter((c) => c.kind === 'axis');
export const axisAction = (c: ControlDef) => `pit_${c.id}`;

export interface ControlChange { id: string; from: number; to: number }

/** The position of every control. Switch and knob positions are indices (0 … n-1, 0 = the first position: down,
 *  aft or fully anticlockwise); buttons are 0 out / 1 in; axes are 0 … 1 (endless ones wrap). The state lives with
 *  the flight, not with the 3D model, so nothing changes when the cockpit is unloaded in an outside view. */
export class CockpitPanel {
  readonly pos = new Map<string, number>();
  /** controls held by the pilot's hand (mouse button down): released by release() */
  private held = new Set<string>();
  /** changes since the last drain (for the systems, sounds and tests) */
  private changes: ControlChange[] = [];

  constructor(init: Record<string, number> = {}) {
    for (const c of CONTROLS) this.pos.set(c.id, init[c.id] ?? (c.spring ? c.spring.rest : c.kind === 'axis' ? 0 : 0));
  }

  get(id: string): number { return this.pos.get(id) ?? 0; }

  /** Set a control directly (keyboard binding, axis, mission start). Clamped / wrapped to its range. */
  set(id: string, v: number) {
    const c = CONTROL_BY_ID.get(id);
    if (!c) return;
    let to: number;
    if (c.kind === 'axis') to = c.endless ? ((v % 1) + 1) % 1 : Math.min(1, Math.max(0, v));
    else to = Math.min(c.n - 1, Math.max(0, Math.round(v)));
    const from = this.get(id);
    if (from === to) return;
    this.pos.set(id, to);
    this.changes.push({ id, from, to });
  }

  /** The pilot works a control with the mouse. `dir` +1 = left button / wheel up (switch up/forward, knob clockwise,
   *  axis up), -1 = right button / wheel down. `hold` = a mouse press that stays down until release(); a wheel step
   *  is not a hold. `dir4` picks the dobber's direction. */
  operate(id: string, dir: 1 | -1, hold: boolean, dir4?: 1 | 2 | 3 | 4) {
    const c = CONTROL_BY_ID.get(id);
    if (!c) return;
    const p = this.get(id);
    switch (c.kind) {
      case 'button':
        if (hold) { this.set(id, 1); this.held.add(id); }
        break;
      case 'axis':
        this.set(id, this.get(id) + dir * (hold ? 0.1 : 0.05));
        break;
      case 'knob':
        this.set(id, c.n > 0 ? (dir > 0 ? (p + 1 >= c.n ? (c.n >= 10 ? 0 : p) : p + 1) : (p - 1 < 0 ? (c.n >= 10 ? c.n - 1 : 0) : p - 1)) : p);
        break;
      case 'switch': {
        if (c.fourWay) { if (hold && dir4) { this.set(id, dir4); this.held.add(id); } break; }
        const to = Math.min(c.n - 1, Math.max(0, p + dir));
        if (to === p) break;
        this.set(id, to);
        if (c.spring?.momentary.includes(to)) { if (hold) this.held.add(id); else this.set(id, c.spring.rest); }
        break;
      }
    }
  }

  /** The pilot lets go: buttons come out and spring-loaded controls return. */
  release() {
    for (const id of this.held) {
      const c = CONTROL_BY_ID.get(id)!;
      if (c.kind === 'button') this.set(id, 0);
      else if (c.spring) this.set(id, c.spring.rest);
    }
    this.held.clear();
  }

  drainChanges(): ControlChange[] { const ch = this.changes; this.changes = []; return ch; }

  /** "MAIN POWER: 2 of 3" */
  describe(id: string): string {
    const c = CONTROL_BY_ID.get(id);
    if (!c) return id;
    const p = this.get(id);
    switch (c.kind) {
      case 'button': return `${c.label} (button)${p ? ': pressed' : ''}`;
      case 'axis': return `${c.label}: ${Math.round(p * 100)} % (mouse wheel, or bind an axis in Controls)`;
      case 'knob': return `${c.label}: detent ${p + 1} of ${c.n} (left click / wheel up: clockwise)`;
      default:
        if (c.fourWay) return `${c.label}: click its top, bottom, left or right side (springs back to centre)`;
        return `${c.label}: position ${p + 1} of ${c.n}${c.spring ? ' (spring-loaded)' : ''} (left click: up, right click: down)`;
    }
  }
}
