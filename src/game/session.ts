import { SceneRenderer, type ViewMode } from '../render/scene.js';
import { Hud } from '../ui/hud.js';
import { Mfds } from '../ui/mfd.js';
import { drawTheater, type MapMarker, type MapView } from '../ui/map.js';
import type { InputManager } from '../input/input.js';
import type { AudioSystem } from '../core/audio.js';
import type { Settings } from '../core/settings.js';
import { Autopilot } from '../sim/autopilot.js';
import { buildMission, evaluate, type BuiltMission, type MissionResult, type MissionSpec } from './mission.js';
import { WEAPONS } from '../weapons/stores.js';
import { approach, clamp, DEG } from '../core/math.js';
import { NM } from '../sim/atmosphere.js';

const DT = 1 / 120;

export interface SessionUI {
  root: HTMLElement;
  canvas3d: HTMLCanvasElement;
  hud: HTMLCanvasElement;
  mfdL: HTMLCanvasElement;
  mfdR: HTMLCanvasElement;
  map: HTMLCanvasElement;
  overlay: HTMLElement;
}

/** null result = player quit to menu without debrief. */
export type EndCallback = (r: MissionResult | null, b: BuiltMission) => void;

/** One flight: owns the world, renderer, HUD and the player's controls. */
export class FlightSession {
  ui: SessionUI;
  scene: SceneRenderer;
  hud: Hud;
  mfds: Mfds;
  input: InputManager;
  audio: AudioSystem;
  settings: Settings;
  built!: BuiltMission;
  private onEnd: EndCallback | null = null;
  private running = false;
  private paused = false;
  private timeAccel = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private kb = { pitch: 0, roll: 0, yaw: 0 };
  private autopilot = false;
  private ap = new Autopilot();
  private apAlt = 0; private apHdg = 0; private apSpd = 0;
  private labels = false;
  private mapOpen = false;
  private mapView: MapView = { cx: 0, cz: 0, mpp: 300, w: 1, h: 1 };
  private steerIndex = 0;
  private ejectArm = -99;
  private cmsQueue: Array<{ t: number; kind: 'flare' | 'chaff' }> = [];
  private padlock = false;
  private endPrompted = false;
  private goalsAnnounced = false;
  private mouse = { down: false, button: 0, x: 0, y: 0 };
  private lastKillCount = 0;
  private lastStallCount = 0;

  constructor(ui: SessionUI, input: InputManager, audio: AudioSystem, settings: Settings) {
    this.ui = ui;
    this.input = input;
    this.audio = audio;
    this.settings = settings;
    this.scene = new SceneRenderer(ui.canvas3d);
    this.hud = new Hud(ui.hud);
    this.mfds = new Mfds(ui.mfdL, ui.mfdR);
    window.addEventListener('resize', () => this.resize());
    ui.hud.addEventListener('contextmenu', (e) => e.preventDefault());
    ui.hud.addEventListener('mousedown', (e) => { this.mouse = { down: true, button: e.button, x: e.clientX, y: e.clientY }; });
    ui.map.addEventListener('mousedown', (e) => { this.mouse = { down: true, button: 9, x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    ui.map.addEventListener('wheel', (e) => { this.mapView.mpp = clamp(this.mapView.mpp * (e.deltaY > 0 ? 1.2 : 1 / 1.2), 20, 1200); e.preventDefault(); }, { passive: false });
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.mouse.down || !this.running) return;
    const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    if (this.mouse.button === 9) { this.mapView.cx -= dx * this.mapView.mpp; this.mapView.cz -= dy * this.mapView.mpp; return; }
    if (this.mouse.button !== 2 && this.mouse.button !== 0) return;
    if (this.scene.view === 'cockpit') {
      this.padlock = false;
      this.scene.headYaw = clamp(this.scene.headYaw - dx * 0.004, -2.6, 2.6);
      this.scene.headPitch = clamp(this.scene.headPitch - dy * 0.004, -0.9, 1.4);
    } else {
      this.scene.chaseYaw -= dx * 0.006;
      this.scene.chasePitch = clamp(this.scene.chasePitch + dy * 0.004, -1.4, 1.4);
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.scene.resize(w, h);
    this.hud.resize(w, h);
    this.ui.map.width = w; this.ui.map.height = h;
    this.mapView.w = w; this.mapView.h = h;
  }

  start(spec: MissionSpec, onEnd: EndCallback) {
    this.onEnd = onEnd;
    const s = this.settings;
    this.built = buildMission(spec, {
      unlimitedFuel: s.unlimitedFuel, unlimitedWeapons: s.unlimitedWeapons, invulnerable: s.invulnerable,
      gEffects: s.gEffects, abDetent: s.abDetent,
    });
    this.scene.reset();
    this.scene.setWeather({ ...spec.weather, visibilityKm: Math.min(spec.weather.visibilityKm, s.visibilityKm) });
    this.scene.fovBase = s.fov;
    this.scene.view = 'cockpit';
    this.scene.headYaw = 0; this.scene.headPitch = 0; this.scene.zoom = 1;
    this.labels = s.labels;
    this.autopilot = false;
    this.paused = false;
    this.timeAccel = 1;
    this.steerIndex = 0;
    this.endPrompted = false;
    this.goalsAnnounced = false;
    this.mapOpen = false;
    this.cmsQueue = [];
    this.ui.map.style.display = 'none';
    this.ui.overlay.innerHTML = '';
    this.ui.overlay.style.display = 'none';
    const p = this.built.player;
    if (p.radar && s.easyRadar) p.radar.def = { ...p.radar.def, range: p.radar.def.range * 1.6 };
    this.kb = { pitch: 0, roll: 0, yaw: 0 };
    if (this.input.axis('throttle') === null) p.ctrl.throttle = p.fm.wow ? 0 : 0.75;
    this.mapView.cx = p.pos.x; this.mapView.cz = p.pos.z;
    this.resize();
    this.scene.prewarm(p.pos);
    this.ui.root.style.display = 'block';
    this.running = true;
    this.input.flightKeys = true;
    this.last = performance.now();
    this.acc = 0;
    this.lastKillCount = 0;
    this.lastStallCount = 0;
    this.built.world.radio(`${spec.title}: ${p.callsign}, ${p.fm.wow ? 'cleared for takeoff' : 'you are cleared in'}.`, '#fff');
    if (this.built.steerpoints.length) this.built.world.radio(`Steerpoint 1: ${this.built.steerpoints[0].name}`, '#ccc');
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    this.running = false;
    this.input.flightKeys = false;
    cancelAnimationFrame(this.raf);
    this.audio.silence();
    this.ui.root.style.display = 'none';
    this.ui.overlay.style.display = 'none';
  }

  private frame(t: number) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;
    this.input.poll();
    this.handleGlobalInput();
    if (!this.running) return;
    const world = this.built.world;
    if (!this.paused) {
      this.handlePlayerInput(dt);
      this.acc += dt * this.timeAccel;
      let steps = 0;
      while (this.acc >= DT && steps < 480) {
        world.step(DT);
        this.acc -= DT;
        steps++;
        this.processCms(world.time);
      }
      this.checkMissionState();
    }
    this.scene.render(world, this.paused ? 0 : dt);
    this.hud.draw(world, this.scene, {
      autopilot: this.autopilot, timeAccel: this.timeAccel, paused: this.paused, labels: this.labels,
      color: this.settings.hudColor,
      steerpoint: this.built.steerpoints[this.steerIndex]?.pos ?? null,
      steerName: `${this.steerIndex + 1} ${this.built.steerpoints[this.steerIndex]?.name ?? ''}`,
    }, dt);
    this.mfds.draw(world, dt);
    if (this.mapOpen) this.drawMap();
    this.updateAudio(dt);
  }

  private updateAudio(dt: number) {
    const p = this.built.player;
    if (this.paused) { this.audio.silence(); return; }
    const def = p.selectedDef();
    const tone: 'off' | 'search' | 'lock' = def?.kind === 'ir' && p.alive ? (p.irLock ? 'lock' : 'search') : 'off';
    const rwr = p.rwr.some((r) => r.kind === 'launch' || r.kind === 'missile') ? 'launch' : p.rwr.some((r) => r.kind === 'lock') ? 'lock' : p.rwr.length ? 'search' : 'none';
    const warn = p.alive && this.hud.warnings(p).some((w) => w === 'PULL UP' || w === 'STALL' || w === 'BINGO');
    this.audio.update(dt, {
      rpm: p.fm.rpm, ab: p.fm.abFrac, qbar: p.fm.qbar, gun: p.gunFiring && p.gunRounds > 0, tone,
      rwr, warn, cockpit: this.scene.view === 'cockpit', alive: p.alive,
    });
    const kills = this.built.world.kills;
    if (kills.length > this.lastKillCount) {
      for (const e of kills.slice(this.lastKillCount)) {
        const pos = this.built.world.aircraft.find((a) => a.id === e.victimId)?.pos ?? this.built.world.ground.find((g) => g.id === e.victimId)?.pos;
        if (pos) this.audio.boom(pos.distanceTo(p.pos));
      }
      this.lastKillCount = kills.length;
    }
  }

  private processCms(time: number) {
    const p = this.built.player;
    while (this.cmsQueue.length && this.cmsQueue[0].t <= time) {
      const c = this.cmsQueue.shift()!;
      if (p.alive) this.built.world.dropCountermeasure(p, c.kind);
    }
  }

  // ------------------------------------------------------------------ input
  private handleGlobalInput() {
    const i = this.input;
    if (i.pressed('pause')) {
      if (this.mapOpen) this.toggleMap();
      else if (this.paused) this.resume();
      else this.showPauseMenu();
    }
    if (!this.running) return;
    if (i.pressed('viewMap')) this.toggleMap();
    if (i.pressed('timeAccel')) this.timeAccel = this.timeAccel >= 8 ? 1 : this.timeAccel * 2;
    if (i.pressed('labels')) this.labels = !this.labels;
    const views: Array<[string, ViewMode]> = [['viewCockpit', 'cockpit'], ['viewChase', 'chase'], ['viewFlyby', 'flyby'], ['viewTarget', 'target'], ['viewEnemy', 'enemy'], ['viewWeapon', 'weapon']];
    for (const [a, v] of views) if (i.pressed(a)) {
      if (v === 'chase' && this.scene.view === 'chase') { this.scene.chaseYaw = 0; this.scene.chasePitch = 0.15; }
      this.scene.view = v;
    }
    if (i.pressed('mfdLeft')) this.mfds.cycle('left');
    if (i.pressed('mfdRight')) this.mfds.cycle('right');
    if (i.mouseWheel !== 0) {
      if (!this.mapOpen) {
        if (this.scene.view === 'cockpit') this.scene.zoom = clamp(this.scene.zoom * (i.mouseWheel > 0 ? 1 / 1.15 : 1.15), 1, 5);
        else this.scene.chaseDist = clamp(this.scene.chaseDist * (i.mouseWheel > 0 ? 1.15 : 1 / 1.15), 8, 800);
      }
      i.mouseWheel = 0;
    }
  }

  private handlePlayerInput(dt: number) {
    const i = this.input;
    const world = this.built.world;
    const p = this.built.player;
    const c = p.ctrl;
    const sens = this.settings.keyboardSensitivity;
    // ---- head look
    const look = 1.6 * dt;
    if (i.down('lookLeft')) { this.scene.headYaw += look; this.padlock = false; }
    if (i.down('lookRight')) { this.scene.headYaw -= look; this.padlock = false; }
    if (i.down('lookUp')) { this.scene.headPitch += look; this.padlock = false; }
    if (i.down('lookDown')) { this.scene.headPitch -= look; this.padlock = false; }
    const lx = i.axis('lookX'), ly = i.axis('lookY');
    if (lx !== null) this.scene.headYaw = -lx * 2.6;
    if (ly !== null) this.scene.headPitch = -ly * 1.2;
    this.scene.headYaw = clamp(this.scene.headYaw, -2.6, 2.6);
    this.scene.headPitch = clamp(this.scene.headPitch, -0.9, 1.4);
    if (i.pressed('lookCenter')) { this.scene.headYaw = 0; this.scene.headPitch = 0; this.scene.zoom = 1; this.padlock = false; }
    if (i.pressed('padlock')) this.padlock = !this.padlock;
    if (this.padlock) this.updatePadlock();
    if (i.down('zoomIn')) this.scene.zoom = clamp(this.scene.zoom * (1 + dt * 1.5), 1, 5);
    if (i.down('zoomOut')) this.scene.zoom = clamp(this.scene.zoom / (1 + dt * 1.5), 1, 5);
    if (!p.alive) { p.gunFiring = false; return; }

    // ---- primary flight controls: HOTAS axis if bound, keyboard emulation otherwise
    const kbAxis = (cur: number, plus: boolean, minus: boolean, rate: number) => {
      if (plus && !minus) return approach(cur, 1, rate * sens * dt, 1);
      if (minus && !plus) return approach(cur, -1, rate * sens * dt, 1);
      return approach(cur, 0, rate * 2 * dt, 1);
    };
    this.kb.pitch = kbAxis(this.kb.pitch, i.down('pitchUp'), i.down('pitchDown'), 1.6);
    this.kb.roll = kbAxis(this.kb.roll, i.down('rollRight'), i.down('rollLeft'), 2.5);
    this.kb.yaw = kbAxis(this.kb.yaw, i.down('yawRight'), i.down('yawLeft'), 2.0);
    const ax = (a: string, kb: number) => { const v = i.axis(a); return v === null ? kb : clamp(v + kb, -1, 1); };
    let pitch = ax('pitch', this.kb.pitch), roll = ax('roll', this.kb.roll);
    const yaw = ax('yaw', this.kb.yaw);
    if (i.pressed('autopilot')) {
      this.autopilot = !this.autopilot;
      if (this.autopilot) {
        this.apAlt = p.pos.y; this.apHdg = p.fm.attitude().hdg; this.apSpd = p.fm.tas;
        this.ap.reset();
        world.radio('Autopilot: altitude / heading hold engaged.', '#ccc');
      }
    }
    if (this.autopilot && (Math.abs(pitch) > 0.35 || Math.abs(roll) > 0.35 || p.fm.wow)) { this.autopilot = false; world.radio('Autopilot disengaged.', '#ccc'); }
    if (this.autopilot) {
      const thr = c.throttle;
      this.ap.holdAltHdgSpd(p.fm, this.apAlt, this.apHdg, this.apSpd, c, dt, 30 * DEG);
      c.throttle = thr;
      pitch = c.pitch; roll = c.roll;
    }
    c.pitch = pitch; c.roll = roll; c.yaw = yaw;
    const thrAxis = i.axis('throttle');
    if (thrAxis !== null) c.throttle = thrAxis;
    else {
      if (i.down('throttleUp')) c.throttle = clamp(c.throttle + 0.45 * dt, 0, 1);
      if (i.down('throttleDown')) c.throttle = clamp(c.throttle - 0.45 * dt, 0, 1);
    }
    const tr = 0.35 * dt;
    if (i.down('trimUp')) c.trimPitch = clamp(c.trimPitch + tr, -1, 1);
    if (i.down('trimDown')) c.trimPitch = clamp(c.trimPitch - tr, -1, 1);
    if (i.down('trimRight')) c.trimRoll = clamp(c.trimRoll + tr, -1, 1);
    if (i.down('trimLeft')) c.trimRoll = clamp(c.trimRoll - tr, -1, 1);
    if (i.down('trimYawRight')) c.trimYaw = clamp(c.trimYaw + tr, -1, 1);
    if (i.down('trimYawLeft')) c.trimYaw = clamp(c.trimYaw - tr, -1, 1);
    if (i.pressed('trimReset')) { c.trimPitch = 0; c.trimRoll = 0; c.trimYaw = 0; }
    // ---- systems
    if (i.pressed('gear')) {
      if (c.gearDown && p.fm.wow) world.radio('Gear handle locked — weight on wheels.', '#fc8');
      else { c.gearDown = !c.gearDown; world.radio(`Gear ${c.gearDown ? 'down' : 'up'}.`, '#ccc'); }
    }
    if (i.pressed('flaps')) c.flaps = c.flaps < 0.25 ? 0.5 : c.flaps < 0.75 ? 1 : 0;
    if (i.pressed('speedbrake')) c.speedbrake = c.speedbrake > 0.5 ? 0 : 1;
    if (i.down('speedbrakeHold')) c.speedbrake = 1;
    else if (i.released('speedbrakeHold')) c.speedbrake = 0;
    const bAx = i.axis('brakeAxis');
    c.brakes = Math.max(i.down('wheelBrake') ? 1 : 0, bAx !== null ? clamp(bAx, 0, 1) : 0);
    const nAx = i.axis('nozzleAxis');
    if (nAx !== null) c.nozzle = clamp((nAx + 1) / 2, 0, 1);
    if (i.down('nozzleDown')) c.nozzle = clamp(c.nozzle + 0.5 * dt, 0, 1);
    if (i.down('nozzleUp')) c.nozzle = clamp(c.nozzle - 0.5 * dt, 0, 1);
    if (i.pressed('jettison')) { p.jettison(); world.radio('Stores jettisoned.', '#fc8'); }
    if (i.pressed('eject')) {
      if (world.time - this.ejectArm < 1.5) this.eject();
      else { this.ejectArm = world.time; world.radio('EJECT armed — press again to eject.', '#f88'); }
    }
    // ---- weapons
    const sel = p.selWeapon;
    p.gunFiring = (i.down('trigger') && !!p.def.gun) || (sel === 'gun' && i.down('fire'));
    if (i.pressed('pickle') || (i.pressed('fire') && sel !== 'gun')) {
      const r = world.fireSelected(p);
      if (r && !['FOX 1', 'FOX 2', 'FOX 3', 'PICKLE', 'MAGNUM', 'RIFLE'].includes(r)) world.radio(r, '#fc8');
    }
    if (i.pressed('weaponNext')) p.cycleWeapon(1);
    if (i.pressed('weaponPrev')) p.cycleWeapon(-1);
    if (i.pressed('modeAA') && p.selectByKind(['arh', 'sarh'])) p.radar?.setMode(p.radar.def.tws ? 'TWS' : 'RWS');
    if (i.pressed('modeDogfight') && p.selectByKind(['ir'])) p.radar?.setMode('ACM');
    if (i.pressed('modeGun') && p.selectByKind(['gun'])) p.radar?.setMode('ACM');
    if (i.pressed('modeAG')) p.selectByKind(['bomb', 'lgb', 'agm', 'arm']);
    // ---- sensors
    const sd = p.selectedDef();
    const ag = !!sd && ['bomb', 'lgb', 'agm', 'arm'].includes(sd.kind);
    if (i.pressed('radarLock')) {
      if (ag) {
        const g = world.designateGround(p, sd!.kind === 'agm' ? 5 : 10);
        world.radio(g ? `Designated: ${g.name}` : p.agPoint ? 'Designated ground point.' : 'No designation.', '#ccc');
      } else if (p.radar && !p.radar.lockDesignated()) world.radio('Radar: unable to lock.', '#fc8');
    }
    if (i.pressed('radarUnlock')) { p.radar?.unlock(); p.agTarget = null; p.agPoint = null; p.irLock = null; }
    if (i.pressed('targetNext')) p.radar?.cycleCursor();
    if (i.pressed('radarMode')) p.radar?.cycleMode();
    if (i.pressed('radarRangeUp')) p.radar?.rangeUp();
    if (i.pressed('radarRangeDown')) p.radar?.rangeDown();
    if (p.radar) {
      if (i.down('radarElevUp')) p.radar.elevCenter = clamp(p.radar.elevCenter + 15 * dt, -30, 30);
      if (i.down('radarElevDown')) p.radar.elevCenter = clamp(p.radar.elevCenter - 15 * dt, -30, 30);
    }
    if (i.pressed('flare')) world.dropCountermeasure(p, 'flare');
    if (i.pressed('chaff')) world.dropCountermeasure(p, 'chaff');
    if (i.pressed('cmsProgram')) {
      for (let k = 0; k < 4; k++) this.cmsQueue.push({ t: world.time + k * 0.25, kind: k % 2 === 0 ? 'chaff' : 'flare' });
    }
    // ---- steerpoint sequencing
    const sp = this.built.steerpoints[this.steerIndex];
    if (sp && Math.hypot(sp.pos.x - p.pos.x, sp.pos.z - p.pos.z) < 2 * NM && this.steerIndex < this.built.steerpoints.length - 1) {
      this.steerIndex++;
      world.radio(`Steerpoint ${this.steerIndex + 1}: ${this.built.steerpoints[this.steerIndex].name}`, '#ccc');
    }
  }

  private updatePadlock() {
    const p = this.built.player;
    const tgt = this.scene.pickTarget(this.built.world, p);
    if (!tgt) return;
    const d = tgt.pos.clone().sub(p.pos).applyQuaternion(p.quat.clone().invert());
    this.scene.headYaw = clamp(Math.atan2(-d.x, -d.z), -2.6, 2.6);
    this.scene.headPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.9, 1.4);
  }

  private eject() {
    const p = this.built.player;
    const w = this.built.world;
    p.ejected = true;
    w.radio(`${p.callsign}: EJECTING!`, '#f88');
    const inv = w.opts.invulnerable;
    w.opts.invulnerable = false;
    w.damageAircraft(p, 9999, p.lastHitBy, p.lastHitWeapon || 'ejection');
    w.opts.invulnerable = inv;
    this.scene.view = 'chase';
  }

  private checkMissionState() {
    const b = this.built;
    const p = b.player;
    const w = b.world;
    if (p.fm.stallCount > this.lastStallCount) {
      this.lastStallCount = p.fm.stallCount;
      w.radio(`Compressor stall — ${p.fm.stallSide < 0 ? 'left' : 'right'} engine! Unload, ease the throttle, rudder against the yaw.`, '#ffb84f');
    }
    if (!this.goalsAnnounced && b.spec.goals.some((g) => g.kind === 'killAir' || g.kind === 'destroyGroup')) {
      const r = evaluate(b);
      const main = r.lines.filter((l) => !l.includes('Survive') && !l.includes('Land at'));
      if (main.length && main.every((l) => l.startsWith('✔'))) {
        this.goalsAnnounced = true;
        w.radio('AWACS: Mission objectives complete. RTB at your discretion (Esc → End mission).', '#fff');
      }
    }
    if (this.endPrompted) return;
    if (!p.alive) {
      this.endPrompted = true;
      const reason = p.ejected ? 'You ejected.' : `You were killed: ${p.fm.crashReason || 'shot down'}.`;
      setTimeout(() => { if (this.running && !this.paused) this.showPauseMenu(reason); }, 5000);
    } else if (p.landed && p.fm.tas < 1) {
      this.endPrompted = true;
      w.radio('Tower: welcome back. Taxi to parking (Esc → End mission).', '#fff');
    }
  }

  private toggleMap() {
    this.mapOpen = !this.mapOpen;
    this.ui.map.style.display = this.mapOpen ? 'block' : 'none';
    if (this.mapOpen) { const p = this.built.player; this.mapView.cx = p.pos.x; this.mapView.cz = p.pos.z; }
  }

  private drawMap() {
    const ctx = this.ui.map.getContext('2d')!;
    const w = this.built.world;
    const p = this.built.player;
    const markers: MapMarker[] = [];
    for (const a of w.aircraft) {
      if (!a.active) continue;
      const known = a.side === p.side || p.radar?.contacts.has(a.id) || a.pos.distanceTo(p.pos) < 15000;
      if (!known) continue;
      const f = a.fm.forward();
      markers.push({ x: a.pos.x, z: a.pos.z, side: a.side, kind: a === p ? 'player' : 'aircraft', hdg: Math.atan2(f.x, -f.z), label: a === p ? p.callsign : a.def.name });
    }
    for (const s of w.sites) markers.push({
      x: s.radar.pos.x, z: s.radar.pos.z, side: s.side, kind: 'sam', label: s.name, dead: !s.alive,
      ring: s.alive ? (s.params.isGun ? 3000 : WEAPONS[s.params.weapon].rangeKm * 800) : 0,
    });
    for (const g of this.built.spec.groups) {
      if (g.kind === 'sam') continue;
      const u = this.built.groupUnits.get(g.id) ?? [];
      const alive = u.filter((x) => x.alive).length;
      markers.push({ x: g.x, z: g.z, side: g.side, kind: 'target', label: `${g.name ?? g.kind} (${alive}/${u.length})`, dead: u.length > 0 && alive === 0 });
    }
    this.built.steerpoints.forEach((s, k) => markers.push({ x: s.pos.x, z: s.pos.z, side: 'neutral', kind: 'waypoint', label: `${k + 1} ${s.name}`, highlight: k === this.steerIndex }));
    const route = { pts: [{ x: p.pos.x, z: p.pos.z }, ...this.built.steerpoints.slice(this.steerIndex).map((s) => ({ x: s.pos.x, z: s.pos.z }))], color: '#fff', dashed: true };
    drawTheater(ctx, this.mapView, { markers, routes: [route], showObjectives: false });
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(this.mapView.w / 2 - 240, 8, 480, 26);
    ctx.fillStyle = '#fff'; ctx.font = '14px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('F10 MAP — wheel: zoom · drag: pan · F10/Esc: close', this.mapView.w / 2, 21);
  }

  // ------------------------------------------------------------------ pause / end
  private showPauseMenu(reason = '') {
    this.paused = true;
    const o = this.ui.overlay;
    o.style.display = 'flex';
    const r = evaluate(this.built);
    o.innerHTML = `
      <div class="panel pause">
        <h2>${reason || 'PAUSED'}</h2>
        <div class="muted">${this.built.spec.title}</div>
        <ul class="goals">${r.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
        <div class="btnrow col">
          ${this.built.player.alive ? '<button data-a="resume" class="primary">Resume</button>' : ''}
          <button data-a="end">End mission (debrief)</button>
          <button data-a="restart">Restart mission</button>
          <button data-a="quit">Quit to main menu</button>
        </div>
        <div class="muted small">Esc: resume · F10: map · Ctrl+Z: time acceleration</div>
      </div>`;
    o.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const a = (b as HTMLElement).dataset.a;
      if (a === 'resume') this.resume();
      else if (a === 'end') this.finish();
      else if (a === 'restart') { const spec = this.built.spec; const cb = this.onEnd!; this.start(spec, cb); }
      else if (a === 'quit') { const b2 = this.built; this.stop(); this.onEnd?.(null, b2); }
    }));
  }

  private resume() {
    if (!this.built.player.alive) return;
    this.paused = false;
    this.ui.overlay.style.display = 'none';
    this.ui.overlay.innerHTML = '';
    this.last = performance.now();
  }

  finish() {
    const r = evaluate(this.built);
    const b = this.built;
    this.stop();
    this.onEnd?.(r, b);
  }
}
