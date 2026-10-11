// HOTAS / joystick / keyboard input with fully bindable actions (Gamepad API + keyboard).

export type ActionType = 'axis' | 'button';
export interface ActionDef { id: string; label: string; type: ActionType; group: string }

export const ACTIONS: ActionDef[] = [
  { id: 'pitch', label: 'Pitch (stick fwd/aft)', type: 'axis', group: 'Flight controls' },
  { id: 'roll', label: 'Roll (stick left/right)', type: 'axis', group: 'Flight controls' },
  { id: 'yaw', label: 'Rudder / yaw', type: 'axis', group: 'Flight controls' },
  { id: 'throttle', label: 'Throttle', type: 'axis', group: 'Flight controls' },
  { id: 'brakeAxis', label: 'Wheel brakes (axis)', type: 'axis', group: 'Flight controls' },
  { id: 'nozzleAxis', label: 'Nozzle angle (Harrier, axis)', type: 'axis', group: 'Flight controls' },
  { id: 'pitchUp', label: 'Pitch up (pull)', type: 'button', group: 'Flight controls' },
  { id: 'pitchDown', label: 'Pitch down (push)', type: 'button', group: 'Flight controls' },
  { id: 'rollLeft', label: 'Roll left', type: 'button', group: 'Flight controls' },
  { id: 'rollRight', label: 'Roll right', type: 'button', group: 'Flight controls' },
  { id: 'yawLeft', label: 'Rudder left', type: 'button', group: 'Flight controls' },
  { id: 'yawRight', label: 'Rudder right', type: 'button', group: 'Flight controls' },
  { id: 'throttleUp', label: 'Throttle increase', type: 'button', group: 'Flight controls' },
  { id: 'throttleDown', label: 'Throttle decrease', type: 'button', group: 'Flight controls' },
  { id: 'trimUp', label: 'Trim nose up', type: 'button', group: 'Flight controls' },
  { id: 'trimDown', label: 'Trim nose down', type: 'button', group: 'Flight controls' },
  { id: 'trimLeft', label: 'Trim roll left', type: 'button', group: 'Flight controls' },
  { id: 'trimRight', label: 'Trim roll right', type: 'button', group: 'Flight controls' },
  { id: 'trimYawLeft', label: 'Trim rudder left', type: 'button', group: 'Flight controls' },
  { id: 'trimYawRight', label: 'Trim rudder right', type: 'button', group: 'Flight controls' },
  { id: 'trimReset', label: 'Trim reset', type: 'button', group: 'Flight controls' },
  { id: 'gear', label: 'Landing gear toggle', type: 'button', group: 'Systems' },
  { id: 'hook', label: 'Tailhook up/down', type: 'button', group: 'Systems' },
  { id: 'catLaunch', label: 'Catapult: salute / launch', type: 'button', group: 'Systems' },
  { id: 'commsMenu', label: 'Radio / comms menu', type: 'button', group: 'Systems' },
  { id: 'voicePtt', label: 'Voice command (push to talk)', type: 'button', group: 'Systems' },
  { id: 'flaps', label: 'Flaps cycle', type: 'button', group: 'Systems' },
  { id: 'speedbrake', label: 'Speed brake (toggle)', type: 'button', group: 'Systems' },
  { id: 'speedbrakeHold', label: 'Speed brake (hold)', type: 'button', group: 'Systems' },
  { id: 'wheelBrake', label: 'Wheel brakes (hold)', type: 'button', group: 'Systems' },
  { id: 'nozzleUp', label: 'Nozzles aft (Harrier)', type: 'button', group: 'Systems' },
  { id: 'nozzleDown', label: 'Nozzles down (Harrier)', type: 'button', group: 'Systems' },
  { id: 'autopilot', label: 'Autopilot (alt/hdg hold)', type: 'button', group: 'Systems' },
  { id: 'jettison', label: 'Emergency jettison', type: 'button', group: 'Systems' },
  { id: 'eject', label: 'Eject', type: 'button', group: 'Systems' },
  { id: 'fire', label: 'Fire selected weapon (smart)', type: 'button', group: 'Weapons' },
  { id: 'trigger', label: 'Gun trigger', type: 'button', group: 'Weapons' },
  { id: 'pickle', label: 'Weapon release (pickle)', type: 'button', group: 'Weapons' },
  { id: 'weaponNext', label: 'Next weapon', type: 'button', group: 'Weapons' },
  { id: 'weaponPrev', label: 'Previous weapon', type: 'button', group: 'Weapons' },
  { id: 'modeAA', label: 'Master mode A-A (BVR missile)', type: 'button', group: 'Weapons' },
  { id: 'modeDogfight', label: 'Master mode dogfight (IR missile)', type: 'button', group: 'Weapons' },
  { id: 'modeGun', label: 'Select gun', type: 'button', group: 'Weapons' },
  { id: 'modeAG', label: 'Master mode A-G', type: 'button', group: 'Weapons' },
  { id: 'radarLock', label: 'Lock / designate (TMS up)', type: 'button', group: 'Sensors' },
  { id: 'radarUnlock', label: 'Break lock (TMS down)', type: 'button', group: 'Sensors' },
  { id: 'targetNext', label: 'Cycle target cursor', type: 'button', group: 'Sensors' },
  { id: 'radarMode', label: 'Radar mode cycle (RWS/TWS/ACM/OFF)', type: 'button', group: 'Sensors' },
  { id: 'radarRangeUp', label: 'Radar range increase', type: 'button', group: 'Sensors' },
  { id: 'radarRangeDown', label: 'Radar range decrease', type: 'button', group: 'Sensors' },
  { id: 'radarElevUp', label: 'Antenna elevation up', type: 'button', group: 'Sensors' },
  { id: 'radarElevDown', label: 'Antenna elevation down', type: 'button', group: 'Sensors' },
  { id: 'flare', label: 'Release flare', type: 'button', group: 'Countermeasures' },
  { id: 'chaff', label: 'Release chaff', type: 'button', group: 'Countermeasures' },
  { id: 'cmsProgram', label: 'CMS program (chaff + flare burst)', type: 'button', group: 'Countermeasures' },
  { id: 'viewCockpit', label: 'Cockpit view (F1)', type: 'button', group: 'Views' },
  { id: 'viewChase', label: 'External view (F2)', type: 'button', group: 'Views' },
  { id: 'viewFlyby', label: 'Fly-by view (F3)', type: 'button', group: 'Views' },
  { id: 'viewTarget', label: 'Target view (F4)', type: 'button', group: 'Views' },
  { id: 'viewEnemy', label: 'Enemy view (F5)', type: 'button', group: 'Views' },
  { id: 'viewWeapon', label: 'Weapon view (F6)', type: 'button', group: 'Views' },
  { id: 'viewMap', label: 'Map (F10)', type: 'button', group: 'Views' },
  { id: 'lookX', label: 'Head look horizontal (axis)', type: 'axis', group: 'Views' },
  { id: 'lookY', label: 'Head look vertical (axis)', type: 'axis', group: 'Views' },
  { id: 'lookUp', label: 'Look up (hat)', type: 'button', group: 'Views' },
  { id: 'lookDown', label: 'Look down (hat)', type: 'button', group: 'Views' },
  { id: 'lookLeft', label: 'Look left (hat)', type: 'button', group: 'Views' },
  { id: 'lookRight', label: 'Look right (hat)', type: 'button', group: 'Views' },
  { id: 'lookCenter', label: 'Center view', type: 'button', group: 'Views' },
  { id: 'padlock', label: 'Padlock target', type: 'button', group: 'Views' },
  { id: 'zoomIn', label: 'Zoom in', type: 'button', group: 'Views' },
  { id: 'zoomOut', label: 'Zoom out', type: 'button', group: 'Views' },
  { id: 'mfdLeft', label: 'Left MFD page cycle', type: 'button', group: 'Views' },
  { id: 'mfdRight', label: 'Right MFD page cycle', type: 'button', group: 'Views' },
  { id: 'pause', label: 'Pause / menu', type: 'button', group: 'Game' },
  { id: 'timeAccel', label: 'Time acceleration', type: 'button', group: 'Game' },
  { id: 'labels', label: 'Toggle labels', type: 'button', group: 'Game' },
];
export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

export type AxisBinding = { kind: 'axis'; device: string; index: number; invert: boolean; deadzone: number; saturation: number; curve: number; slider: boolean };
export type Binding =
  | { kind: 'key'; code: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
  | { kind: 'button'; device: string; index: number }
  | { kind: 'hat'; device: string; index: number; value: number }
  | AxisBinding;

export type BindingMap = Record<string, Binding[]>;

const K = (code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): Binding => ({ kind: 'key', code, ...mods });

export function defaultKeyboard(): BindingMap {
  return {
    pitchUp: [K('ArrowDown')], pitchDown: [K('ArrowUp')], rollLeft: [K('ArrowLeft')], rollRight: [K('ArrowRight')],
    yawLeft: [K('KeyZ')], yawRight: [K('KeyX')],
    throttleUp: [K('PageUp'), K('NumpadAdd'), K('Equal')], throttleDown: [K('PageDown'), K('NumpadSubtract'), K('Minus')],
    trimUp: [K('ArrowDown', { ctrl: true })], trimDown: [K('ArrowUp', { ctrl: true })],
    trimLeft: [K('ArrowLeft', { ctrl: true })], trimRight: [K('ArrowRight', { ctrl: true })],
    trimYawLeft: [K('Comma', { ctrl: true })], trimYawRight: [K('Period', { ctrl: true })], trimReset: [K('KeyT', { shift: true })],
    gear: [K('KeyG')], hook: [K('KeyH')], catLaunch: [K('KeyC')], commsMenu: [K('Backslash')], voicePtt: [K('Backquote')], flaps: [K('KeyF')], speedbrake: [K('KeyB')], wheelBrake: [K('KeyW')],
    // note: Ctrl+W / Ctrl+T cannot be intercepted by a web page (they close/open browser tabs)
    nozzleUp: [K('KeyM')], nozzleDown: [K('KeyN')], autopilot: [K('KeyA')], jettison: [K('KeyW', { shift: true })], eject: [K('KeyE', { shift: true })],
    fire: [K('Space')], weaponNext: [K('KeyD')], weaponPrev: [K('KeyD', { shift: true })],
    modeAA: [K('Digit2')], modeDogfight: [K('Digit3')], modeGun: [K('Digit4')], modeAG: [K('Digit6')],
    radarLock: [K('Enter'), K('NumpadEnter')], radarUnlock: [K('Backspace')], targetNext: [K('Tab')], radarMode: [K('KeyR')],
    radarRangeUp: [K('BracketRight')], radarRangeDown: [K('BracketLeft')],
    radarElevUp: [K('Semicolon')], radarElevDown: [K('Quote')],
    flare: [K('KeyQ'), K('Insert')], chaff: [K('KeyE'), K('Delete')], cmsProgram: [K('KeyV')],
    viewCockpit: [K('F1')], viewChase: [K('F2')], viewFlyby: [K('F3')], viewTarget: [K('F4')], viewEnemy: [K('F5')], viewWeapon: [K('F6')], viewMap: [K('F10'), K('KeyO')],
    lookUp: [K('Numpad8')], lookDown: [K('Numpad2')], lookLeft: [K('Numpad4')], lookRight: [K('Numpad6')], lookCenter: [K('Numpad5')],
    padlock: [K('KeyL')], zoomIn: [K('NumpadMultiply')], zoomOut: [K('NumpadDivide')],
    mfdLeft: [K('Comma')], mfdRight: [K('Period')],
    pause: [K('Escape'), K('KeyP')], timeAccel: [K('KeyZ', { ctrl: true })], labels: [K('F9')],
  };
}

/** Heuristic auto-profile for a newly connected device (user can rebind everything). */
export function autoProfile(gp: Gamepad): BindingMap {
  const id = gp.id;
  const ax = (index: number, opts: Partial<AxisBinding> = {}): Binding =>
    ({ kind: 'axis', device: id, index, invert: false, deadzone: 0.04, saturation: 1, curve: 0.2, slider: false, ...opts });
  const bt = (index: number): Binding => ({ kind: 'button', device: id, index });
  const m: BindingMap = {};
  const add = (a: string, b: Binding) => { (m[a] ??= []).push(b); };
  const lower = id.toLowerCase();
  if (gp.mapping === 'standard') {
    add('roll', ax(0)); add('pitch', ax(1)); add('yaw', ax(2, { curve: 0 }));
    add('throttleUp', bt(5)); add('throttleDown', bt(4));
    add('trigger', bt(7)); add('fire', bt(0)); add('flare', bt(1)); add('weaponNext', bt(2)); add('radarLock', bt(3));
    add('chaff', bt(6)); add('viewChase', bt(8)); add('pause', bt(9));
    add('lookUp', bt(12)); add('lookDown', bt(13)); add('lookLeft', bt(14)); add('lookRight', bt(15));
    return m;
  }
  if (lower.includes('throttle')) {
    add('throttle', ax(gp.axes.length > 2 ? 2 : 0, { invert: true, slider: true, deadzone: 0, curve: 0 }));
    add('pickle', bt(0)); add('radarLock', bt(1)); add('cmsProgram', bt(2)); add('speedbrake', bt(3));
    return m;
  }
  if (lower.includes('pedal') || lower.includes('rudder')) {
    add('yaw', ax(gp.axes.length > 2 ? 2 : 0, { curve: 0 }));
    return m;
  }
  add('roll', ax(0)); add('pitch', ax(1));
  if (gp.axes.length >= 6) {
    add('yaw', ax(5, { curve: 0.1 }));
    add('throttle', ax(gp.axes.length > 6 ? 6 : 2, { invert: true, slider: true, deadzone: 0, curve: 0 }));
  } else if (gp.axes.length >= 3) {
    add('throttle', ax(2, { invert: true, slider: true, deadzone: 0, curve: 0 }));
    if (gp.axes.length >= 4) add('yaw', ax(3, { curve: 0.1 }));
  }
  add('trigger', bt(0)); add('pickle', bt(1)); add('weaponNext', bt(2)); add('radarLock', bt(3));
  if (gp.buttons.length > 4) add('flare', bt(4));
  if (gp.buttons.length > 5) add('chaff', bt(5));
  if (gp.buttons.length > 6) add('radarUnlock', bt(6));
  if (gp.buttons.length > 7) add('targetNext', bt(7));
  if (gp.axes.length > 9) {
    add('lookUp', { kind: 'hat', device: id, index: 9, value: -1 });
    add('lookRight', { kind: 'hat', device: id, index: 9, value: -0.428571 });
    add('lookDown', { kind: 'hat', device: id, index: 9, value: 0.142857 });
    add('lookLeft', { kind: 'hat', device: id, index: 9, value: 0.714286 });
  }
  return m;
}

/** Apply deadzone / saturation / curvature / invert to a raw axis value (-1..1). */
export function shapeAxis(raw: number, b: AxisBinding): number {
  const v = b.invert ? -raw : raw;
  if (b.slider) {
    const t = (v + 1) / 2;
    return Math.max(0, Math.min(1, (t - b.deadzone) / Math.max(0.05, b.saturation - b.deadzone)));
  }
  const s = Math.sign(v);
  let a = Math.abs(v);
  a = a < b.deadzone ? 0 : (a - b.deadzone) / Math.max(0.05, b.saturation - b.deadzone);
  a = Math.min(1, a);
  a = (1 - b.curve) * a + b.curve * a * a * a;
  return s * a;
}

export function bindingLabel(b: Binding): string {
  switch (b.kind) {
    case 'key': return `${b.ctrl ? 'Ctrl+' : ''}${b.shift ? 'Shift+' : ''}${b.alt ? 'Alt+' : ''}${b.code.replace(/^Key|^Digit/, '')}`;
    case 'button': return `B${b.index + 1}`;
    case 'hat': return `HAT${b.index} ${hatDir(b.value)}`;
    case 'axis': return `AXIS ${b.index}${b.invert ? ' inv' : ''}${b.slider ? ' (slider)' : ''}`;
  }
}
function hatDir(v: number) {
  const dirs: Array<[number, string]> = [[-1, 'U'], [-0.714, 'UR'], [-0.428, 'R'], [-0.142, 'DR'], [0.142, 'D'], [0.428, 'DL'], [0.714, 'L'], [1, 'UL']];
  let best = dirs[0];
  for (const d of dirs) if (Math.abs(d[0] - v) < Math.abs(best[0] - v)) best = d;
  return Math.abs(best[0] - v) < 0.1 ? best[1] : v.toFixed(2);
}
export function shortDev(id: string) {
  const n = id.replace(/\(.*?\)/g, '').trim();
  return n.length > 24 ? n.slice(0, 22) + '…' : n || 'Device';
}

const STORAGE_KEY = 'cfs.bindings.v1';
const KNOWN_KEY = 'cfs.devicesSeen.v1';

interface CaptureRequest { type: ActionType; cb: (b: Binding | null) => void; start: number }

export class InputManager {
  bindings: BindingMap = {};
  private keys = new Set<string>();
  /** keys pressed since the last poll — a quick tap (down+up between frames) still registers once */
  private tapped = new Set<string>();
  private ctrl = false; private shift = false; private alt = false;
  private state = new Map<string, boolean>();
  private prev = new Map<string, boolean>();
  private axes = new Map<string, number>();
  private pads: Gamepad[] = [];
  private seenDevices = new Set<string>();
  private capture: CaptureRequest | null = null;
  private captureBaseline = new Map<string, number[]>();
  enabled = true;
  /** true while a flight is running: game keys then override browser shortcuts. */
  flightKeys = false;
  onDeviceConnected: ((id: string, auto: boolean) => void) | null = null;
  mouseWheel = 0;

  constructor() {
    this.load();
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); });
    window.addEventListener('gamepadconnected', (e) => this.onPad((e as GamepadEvent).gamepad));
    window.addEventListener('wheel', (e) => { this.mouseWheel += Math.sign(e.deltaY); }, { passive: true });
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    this.ctrl = e.ctrlKey; this.shift = e.shiftKey; this.alt = e.altKey;
    if (this.capture && down) {
      if (e.code === 'Escape') this.finishCapture(null);
      else if (this.capture.type === 'button' && !['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(e.code)) {
        this.finishCapture({ kind: 'key', code: e.code, ctrl: e.ctrlKey || undefined, shift: e.shiftKey || undefined, alt: e.altKey || undefined });
      }
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (down) { this.keys.add(e.code); this.tapped.add(e.code); } else this.keys.delete(e.code);
    // only swallow browser default actions (scrolling, focus moves, F5 reload…) while flying
    if (this.flightKeys && (/^F\d+$/.test(e.code) || e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Backspace' || e.code === 'PageUp' || e.code === 'PageDown' || e.code === 'Quote' || e.code === 'Slash')) e.preventDefault();
  }

  private onPad(gp: Gamepad) {
    if (this.seenDevices.has(gp.id)) return;
    this.seenDevices.add(gp.id);
    const hasAny = Object.values(this.bindings).some((list) => list.some((b) => b.kind !== 'key' && b.device === gp.id));
    const known = this.knownDevices();
    let auto = false;
    if (!hasAny && !known.includes(gp.id)) {
      for (const [a, list] of Object.entries(autoProfile(gp))) (this.bindings[a] ??= []).push(...list);
      auto = true;
      this.save();
    }
    if (!known.includes(gp.id)) {
      known.push(gp.id);
      try { localStorage.setItem(KNOWN_KEY, JSON.stringify(known)); } catch { /* storage unavailable */ }
    }
    this.onDeviceConnected?.(gp.id, auto);
  }
  private knownDevices(): string[] {
    try { return JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]'); } catch { return []; }
  }

  devices(): Gamepad[] { return this.pads; }

  /** Poll gamepads and compute action states; call once per frame. */
  poll() {
    const raw = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    for (const g of raw) if (g) { this.pads.push(g); if (!this.seenDevices.has(g.id)) this.onPad(g); }
    if (this.capture) this.pollCapture();
    this.prev = new Map(this.state);
    this.state.clear();
    this.axes.clear();
    for (const a of ACTIONS) {
      const list = this.bindings[a.id];
      if (!list) continue;
      if (a.type === 'axis') {
        for (const b of list) {
          if (b.kind !== 'axis') continue;
          const pad = this.pads.find((p) => p.id === b.device);
          if (!pad || b.index >= pad.axes.length) continue;
          this.axes.set(a.id, shapeAxis(pad.axes[b.index], b));
        }
      } else {
        for (const b of list) if (this.bindingDown(b)) { this.state.set(a.id, true); break; }
      }
    }
    if (!this.enabled || this.capture) this.state.clear();
    this.tapped.clear();
  }

  private bindingDown(b: Binding): boolean {
    switch (b.kind) {
      case 'key':
        return (this.keys.has(b.code) || this.tapped.has(b.code)) && !!b.ctrl === this.ctrl && !!b.shift === this.shift && !!b.alt === this.alt;
      case 'button': {
        const pad = this.pads.find((p) => p.id === b.device);
        return !!pad && b.index < pad.buttons.length && pad.buttons[b.index].pressed;
      }
      case 'hat': {
        const pad = this.pads.find((p) => p.id === b.device);
        return !!pad && b.index < pad.axes.length && Math.abs(pad.axes[b.index] - b.value) < 0.1;
      }
      default: return false;
    }
  }

  down(a: string) { return !!this.state.get(a); }
  pressed(a: string) { return !!this.state.get(a) && !this.prev.get(a); }
  released(a: string) { return !this.state.get(a) && !!this.prev.get(a); }
  /** Axis value or null if no physical axis is bound and connected. */
  axis(a: string): number | null { return this.axes.has(a) ? this.axes.get(a)! : null; }

  // ---------------------------------------------------------------- capture for the binding UI
  startCapture(type: ActionType, cb: (b: Binding | null) => void) {
    this.capture = { type, cb, start: performance.now() };
    this.captureBaseline.clear();
    const raw = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of raw) if (g) this.captureBaseline.set(g.id, [...g.axes]);
  }
  cancelCapture() { this.finishCapture(null); }
  get capturing() { return !!this.capture; }
  private finishCapture(b: Binding | null) {
    const c = this.capture;
    this.capture = null;
    c?.cb(b);
  }
  private pollCapture() {
    const c = this.capture!;
    if (performance.now() - c.start > 10000) { this.finishCapture(null); return; }
    for (const p of this.pads) {
      let base = this.captureBaseline.get(p.id);
      if (!base) { base = [...p.axes]; this.captureBaseline.set(p.id, base); }
      if (c.type === 'button') {
        const bi = p.buttons.findIndex((b) => b.pressed);
        if (bi >= 0) { this.finishCapture({ kind: 'button', device: p.id, index: bi }); return; }
        for (let i = 0; i < p.axes.length; i++) {
          // POV hats rest outside [-1,1] in Chrome and jump to discrete values
          if (Math.abs(base[i]) > 1.05 && Math.abs(p.axes[i]) <= 1.0001) {
            this.finishCapture({ kind: 'hat', device: p.id, index: i, value: p.axes[i] }); return;
          }
        }
      } else {
        let best = -1, bd = 0.35;
        for (let i = 0; i < p.axes.length; i++) {
          if (Math.abs(base[i]) > 1.05) continue;
          const d = Math.abs(p.axes[i] - base[i]);
          if (d > bd) { bd = d; best = i; }
        }
        if (best >= 0) {
          this.finishCapture({ kind: 'axis', device: p.id, index: best, invert: false, deadzone: 0.04, saturation: 1, curve: 0.2, slider: false });
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- persistence
  load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      this.bindings = s ? JSON.parse(s) : defaultKeyboard();
    } catch { this.bindings = defaultKeyboard(); }
    const def = defaultKeyboard();
    for (const a of Object.keys(def)) if (!this.bindings[a]) this.bindings[a] = def[a];
  }
  save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings)); } catch { /* storage unavailable */ } }
  resetKeyboard() {
    const def = defaultKeyboard();
    for (const a of Object.keys(this.bindings)) this.bindings[a] = this.bindings[a].filter((b) => b.kind !== 'key');
    for (const [a, list] of Object.entries(def)) (this.bindings[a] ??= []).push(...list);
    this.save();
  }
  resetDevice(id: string) {
    this.clearDevice(id);
    const pad = this.pads.find((p) => p.id === id);
    if (pad) for (const [a, list] of Object.entries(autoProfile(pad))) (this.bindings[a] ??= []).push(...list);
    this.save();
  }
  clearDevice(id: string) {
    for (const a of Object.keys(this.bindings)) this.bindings[a] = this.bindings[a].filter((b) => b.kind === 'key' || b.device !== id);
    this.save();
  }
  exportJSON() { return JSON.stringify(this.bindings, null, 2); }
  importJSON(s: string) { this.bindings = JSON.parse(s); this.save(); }

  /** Replace the binding of an action for one column ('keyboard' or a device id). */
  setBinding(action: string, column: string, b: Binding | null) {
    const list = (this.bindings[action] ?? []).filter((x) => (column === 'keyboard' ? x.kind !== 'key' : x.kind === 'key' || x.device !== column));
    if (b) {
      for (const [a, l] of Object.entries(this.bindings)) {
        if (a !== action) this.bindings[a] = l.filter((x) => !sameControl(x, b));
      }
      list.push(b);
    }
    this.bindings[action] = list;
    this.save();
  }
  bindingsFor(action: string, column: string): Binding[] {
    return (this.bindings[action] ?? []).filter((x) => (column === 'keyboard' ? x.kind === 'key' : x.kind !== 'key' && x.device === column));
  }
  conflicts(b: Binding): string[] {
    return Object.entries(this.bindings).filter(([, l]) => l.some((x) => sameControl(x, b))).map(([a]) => a);
  }
}

export function sameControl(a: Binding, b: Binding) {
  if (a.kind === 'key' && b.kind === 'key') return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
  if (a.kind === 'button' && b.kind === 'button') return a.device === b.device && a.index === b.index;
  if (a.kind === 'hat' && b.kind === 'hat') return a.device === b.device && a.index === b.index && Math.abs(a.value - b.value) < 0.05;
  if (a.kind === 'axis' && b.kind === 'axis') return a.device === b.device && a.index === b.index;
  return false;
}
