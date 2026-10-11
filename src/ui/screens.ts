import { AIRCRAFT, AIRCRAFT_BY_ID } from '../aircraft/defs.js';
import { WEAPONS } from '../weapons/stores.js';
import { SAM_PARAMS } from '../sim/entities.js';
import { SCENARIOS, buildScenario, startXZ, defaultCustom, type CustomOptions, type MissionResult, type MissionSpec, type BuiltMission } from '../game/mission.js';
import { DEFAULT_SETTINGS, realismLabel, saveSettings, type Settings } from '../core/settings.js';
import { drawTheater, type MapMarker } from './map.js';
import { airbaseById, ensureTheater, listTheaters, setTheater, theaterById } from '../world/theater.js';
import { NM } from '../sim/atmosphere.js';
import { renderInstallLinks } from './installLinks.js';
import type { NetHook } from '../game/session.js';
import { multiplayerScreen } from './multiplayer.js';
import { editorScreen } from './editor.js';
import { hdCredits, setHdModelsEnabled } from '../render/hdModels.js';

export interface AppApi {
  root: HTMLElement;
  settings: Settings;
  show(screen: () => HTMLElement): void;
  mainMenu(): void;
  fly(spec: MissionSpec, onEnd: (r: MissionResult | null, b: BuiltMission) => void, net?: NetHook): void;
  controls(): void;
  campaign(): void;
  toast(msg: string): void;
}

export function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ------------------------------------------------------------------ main menu
export function mainMenu(app: AppApi): HTMLElement {
  const e = el(`
    <div class="screen menu">
      <div class="title">
        <h1>CFS</h1>
        <div class="subtitle">COMBAT FLIGHT SIMULATOR</div>
        <div class="muted">Varnia Peninsula theater · 16 aircraft · ${realismLabel(app.settings)}</div>
      </div>
      <div class="menu-buttons">
        <button data-a="quick" class="primary">⚡ Quick Fight <small class="muted">— F-16C vs MiG-29, guns + heaters</small></button>
        <button data-a="instant">Instant Action</button>
        <button data-a="setup">Mission Setup</button>
        <button data-a="mp">Multiplayer (co-op)</button>
        <button data-a="editor">Mission Editor</button>
        <button data-a="campaign">Dynamic Campaign</button>
        <button data-a="controls">Controls / HOTAS</button>
        <button data-a="settings">Settings</button>
        <button data-a="db">Aircraft Database</button>
        <button data-a="help">Flight Manual</button>
      </div>
      <details class="howto">
        <summary>How to fly (60 seconds)</summary>
        <table class="kv small">
          <tr><td>Arrow keys</td><td>Stick: pitch and roll</td></tr>
          <tr><td>Z / X</td><td>Rudder</td></tr>
          <tr><td>PgUp / PgDn</td><td>Throttle (full up = afterburner)</td></tr>
          <tr><td>Enter</td><td>Lock the target in front of you</td></tr>
          <tr><td>D</td><td>Next weapon (missiles ↔ gun)</td></tr>
          <tr><td>Space</td><td>Fire — wait for the tone / IN RNG cue</td></tr>
          <tr><td>Q / E</td><td>Flares / chaff when the RWR warns of a missile</td></tr>
          <tr><td>F1 / F2</td><td>Cockpit / outside view (mouse-drag to look around)</td></tr>
          <tr><td>Esc</td><td>Pause, debrief, quit</td></tr>
        </table>
        <div class="muted small">Tip: Settings → realism lets you switch on easier radar, unlimited weapons or invulnerability.</div>
      </details>
      <div class="install"></div>
      <div class="hint muted">HOTAS / joystick: press any button on the device once so the browser exposes it, then open <b>Controls / HOTAS</b>.</div>
    </div>`);
  renderInstallLinks(e.querySelector('.install') as HTMLElement);
  e.querySelectorAll('.menu-buttons button').forEach((b) => b.addEventListener('click', () => {
    switch ((b as HTMLElement).dataset.a) {
      case 'quick': {
        const spec = buildScenario({ ...defaultCustom(), scenario: 'bfm_ir', aircraftId: 'f16c', loadoutIndex: 0 });
        app.fly(spec, (r, bm) => app.show(() => debrief(app, spec, r, bm, () => app.mainMenu())));
        break;
      }
      case 'instant': app.show(() => missionSetup(app, false)); break;
      case 'setup': app.show(() => missionSetup(app, true)); break;
      case 'mp': app.show(() => multiplayerScreen(app)); break;
      case 'editor': app.show(() => editorScreen(app)); break;
      case 'campaign': app.campaign(); break;
      case 'controls': app.controls(); break;
      case 'settings': app.show(() => settingsScreen(app)); break;
      case 'db': app.show(() => aircraftDb(app)); break;
      case 'help': app.show(() => manual(app)); break;
    }
  }));
  return e;
}

// ------------------------------------------------------------------ mission setup / instant action
let lastCustom: CustomOptions = defaultCustom();

export function missionSetup(app: AppApi, advanced: boolean): HTMLElement {
  const o = { ...lastCustom };
  const e = el(`
    <div class="screen setup">
      <div class="header"><button data-a="back">◀ Back</button><h2>${advanced ? 'Mission Setup' : 'Instant Action'}</h2></div>
      <div class="cols">
        <div class="col">
          <h3>Aircraft</h3>
          <div class="acgrid"></div>
        </div>
        <div class="col">
          <h3>Theater</h3>
          <select class="theater">${listTheaters().map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          <div class="muted small theaterdesc"></div>
          <h3>Scenario</h3>
          <div class="scenarios"></div>
          <h3>Loadout</h3>
          <select class="loadout"></select>
          <div class="loadout-detail muted small"></div>
          <div class="adv ${advanced ? '' : 'hidden'}">
            <h3>Opposition</h3>
            <label>Enemy aircraft <select class="enemy"></select></label>
            <label>Enemy count <input class="enemyCount" type="number" min="1" max="8" value="${o.enemyCount}"></label>
            <label>Enemy skill <select class="skill"><option>rookie</option><option>regular</option><option>veteran</option><option>ace</option></select></label>
            <label>Wingmen <input class="wingmen" type="number" min="0" max="3" value="${o.wingmen}"></label>
            <h3>Conditions</h3>
            <label>Start <select class="start"><option value="air">In the air</option><option value="runway">On the runway</option></select></label>
            <label>Altitude (ft) <input class="alt" type="number" min="1000" max="45000" step="1000" value="${o.altFt}"></label>
            <label>Time of day <input class="tod" type="range" min="5" max="20" step="0.5" value="${o.timeOfDay}"><span class="todv"></span></label>
            <label>Visibility (km) <input class="vis" type="number" min="5" max="150" value="${o.visibilityKm}"></label>
            <label>Clouds <select class="clouds"><option value="clear">Clear</option><option value="scattered">Scattered</option><option value="overcast">Overcast</option></select></label>
          </div>
          <div class="btnrow"><button data-a="fly" class="primary big">BRIEFING ▶</button></div>
        </div>
      </div>
    </div>`);
  const grid = e.querySelector('.acgrid')!;
  const scen = e.querySelector('.scenarios')!;
  const loadSel = e.querySelector('.loadout') as HTMLSelectElement;
  const detail = e.querySelector('.loadout-detail')!;
  const q = <T extends HTMLElement>(s: string) => e.querySelector(s) as T;
  const enemySel = q<HTMLSelectElement>('.enemy');
  for (const a of AIRCRAFT) if (a.playable !== false) enemySel.append(new Option(`${a.name} (${a.country})`, a.id));
  enemySel.value = o.enemyId;
  q<HTMLSelectElement>('.skill').value = o.skill;
  q<HTMLSelectElement>('.start').value = o.start;
  q<HTMLSelectElement>('.clouds').value = o.clouds;
  const todv = q<HTMLSpanElement>('.todv');
  const updTod = () => { const v = Number(q<HTMLInputElement>('.tod').value); todv.textContent = ` ${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}`; };
  q<HTMLInputElement>('.tod').addEventListener('input', updTod);
  updTod();
  const renderLoad = () => {
    const d = AIRCRAFT_BY_ID[o.aircraftId];
    loadSel.innerHTML = '';
    d.loadouts.forEach((l, i) => loadSel.append(new Option(l.name, String(i))));
    o.loadoutIndex = Math.min(o.loadoutIndex, d.loadouts.length - 1);
    loadSel.value = String(o.loadoutIndex);
    const l = d.loadouts[o.loadoutIndex];
    detail.textContent = `${d.fullName}. ${d.description} Gun: ${d.gun ? `${d.gun.name}, ${d.gun.rounds} rds` : 'none'}. Stores: ${l.stores.length ? summarizeStores(l.stores) : 'none'}.`;
  };
  const renderAc = () => {
    grid.innerHTML = '';
    // one card per family; variants as chips inside the card
    for (const [fam, list] of families()) {
      const cur = list.find((a) => a.id === o.aircraftId);
      const shown = cur ?? list[0];
      const card = el(`<div class="accard ${cur ? 'sel' : ''}" role="button" tabindex="0">
        <b>${esc(list.length > 1 ? fam : shown.name)}</b><span>${esc(shown.role)}${shown.seats === 2 ? ' · 2-seat' : ''}</span><small>${esc(shown.country)}</small>
        ${list.length > 1 ? `<div class="variants">${list.map((a) => `<button class="vchip ${a.id === o.aircraftId ? 'on' : ''}" data-id="${a.id}" title="${esc(a.fullName)}">${esc(a.variant ?? a.name)}</button>`).join('')}</div>` : ''}
      </div>`);
      const pick = (id: string) => { o.aircraftId = id; o.loadoutIndex = 0; renderAc(); renderLoad(); };
      card.addEventListener('click', (ev) => {
        const chip = (ev.target as HTMLElement).closest('.vchip') as HTMLElement | null;
        pick(chip?.dataset.id ?? shown.id);
      });
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(shown.id); } });
      grid.append(card);
    }
  };
  const renderScen = () => {
    scen.innerHTML = '';
    for (const s of SCENARIOS) {
      const b = el(`<button class="scen ${s.id === o.scenario ? 'sel' : ''}"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></button>`);
      b.addEventListener('click', () => { o.scenario = s.id; renderScen(); });
      scen.append(b);
    }
  };
  loadSel.addEventListener('change', () => { o.loadoutIndex = Number(loadSel.value); renderLoad(); });
  const thSel = e.querySelector('.theater') as HTMLSelectElement;
  const renderTheater = () => { const t = theaterById(o.theaterId); thSel.value = t.id; e.querySelector('.theaterdesc')!.textContent = t.description; };
  thSel.addEventListener('change', () => { o.theaterId = thSel.value; renderTheater(); });
  renderTheater();
  renderAc(); renderLoad(); renderScen();
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => app.mainMenu());
  e.querySelector('[data-a="fly"]')!.addEventListener('click', () => {
    if (advanced) {
      o.enemyId = enemySel.value;
      o.enemyCount = Math.max(1, Math.min(8, Number(q<HTMLInputElement>('.enemyCount').value) || 1));
      o.skill = q<HTMLSelectElement>('.skill').value as CustomOptions['skill'];
      o.wingmen = Math.max(0, Math.min(3, Number(q<HTMLInputElement>('.wingmen').value) || 0));
      o.start = q<HTMLSelectElement>('.start').value as 'air' | 'runway';
      o.altFt = Math.max(1000, Math.min(45000, Number(q<HTMLInputElement>('.alt').value) || 15000));
      o.timeOfDay = Number(q<HTMLInputElement>('.tod').value);
      o.visibilityKm = Math.max(5, Math.min(150, Number(q<HTMLInputElement>('.vis').value) || 80));
      o.clouds = q<HTMLSelectElement>('.clouds').value as CustomOptions['clouds'];
    }
    lastCustom = { ...o };
    void (async () => {
      try { await ensureTheater(o.theaterId); } catch (err) { app.toast(`Could not load the map: ${(err as Error).message}`); return; }
      const spec = buildScenario(o);
      setTheater(spec.theaterId);
      app.show(() => briefing(app, spec, () => app.show(() => missionSetup(app, advanced))));
    })();
  });
  return e;
}

// ------------------------------------------------------------------ briefing
export function briefing(app: AppApi, spec: MissionSpec, back: () => void, extra?: HTMLElement, onFly?: () => void, front?: number[]): HTMLElement {
  const pf = spec.flights.find((f) => f.player)!;
  const def = AIRCRAFT_BY_ID[pf.aircraftId];
  const e = el(`
    <div class="screen briefing">
      <div class="header"><button data-a="back">◀ Back</button><h2>Briefing — ${esc(spec.title)}</h2></div>
      <div class="cols">
        <div class="col"><canvas class="bmap" width="640" height="560"></canvas></div>
        <div class="col">
          <p>${esc(spec.briefing)}</p>
          <table class="kv">
            <tr><td>Aircraft</td><td>${esc(def.fullName)} ×${pf.count}</td></tr>
            <tr><td>Callsign</td><td>${esc(pf.callsign)} 1-1</td></tr>
            <tr><td>Start</td><td>${pf.start.kind === 'runway' ? `Runway, ${esc(airbaseById(pf.start.airbaseId).name)}` : pf.start.kind === 'carrier' ? `Catapult 1, ${esc(spec.carriers?.find((c) => c.id === (pf.start as { carrierId: string }).carrierId)?.name ?? 'carrier')}` : 'Airborne'}</td></tr>
            <tr><td>Stores</td><td class="stores">${esc(summarizeStores(pf.stores))}</td></tr>
            <tr><td>Weather</td><td>${spec.weather.clouds}, visibility ${spec.weather.visibilityKm} km, ${String(Math.floor(spec.weather.timeOfDay)).padStart(2, '0')}:00L</td></tr>
            <tr><td>Known threats</td><td>${esc(threatSummary(spec))}</td></tr>
          </table>
          <h3>Objectives</h3>
          <ul>${spec.goals.map((g) => `<li>${goalText(spec, g)}</li>`).join('') || '<li>Free flight — no objectives</li>'}</ul>
          <div class="extra"></div>
          <div class="btnrow"><button data-a="fly" class="primary big">FLY ▶</button></div>
          <div class="muted small">Keys: arrows = stick · Z/X = rudder · PgUp/PgDn = throttle · Space = fire · Enter = lock · D = weapon · G = gear · F1/F2 = views · Esc = pause</div>
        </div>
      </div>
    </div>`);
  if (extra) e.querySelector('.extra')!.append(extra);
  const cv = e.querySelector('.bmap') as HTMLCanvasElement;
  requestAnimationFrame(() => drawBriefMap(cv, spec, front));
  e.querySelector('[data-a="back"]')!.addEventListener('click', back);
  e.querySelector('[data-a="fly"]')!.addEventListener('click', () => {
    if (onFly) onFly();
    else app.fly(spec, (r, b) => app.show(() => debrief(app, spec, r, b, () => app.show(() => missionSetup(app, true)))));
  });
  return e;
}

export function summarizeStores(stores: string[]) {
  const m = new Map<string, number>();
  for (const s of stores) if (s) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m].map(([k, n]) => `${n}× ${WEAPONS[k]?.name ?? k}`).join(', ') || 'Clean';
}
function threatSummary(spec: MissionSpec) {
  const p = spec.flights.find((f) => f.player)!;
  const air = spec.flights.filter((f) => f.side !== p.side).map((f) => `${f.count}× ${AIRCRAFT_BY_ID[f.aircraftId].name}`);
  const sam = spec.groups.filter((g) => g.side !== p.side && g.kind === 'sam').map((g) => g.samType ?? 'SAM');
  return [...air, ...sam].join(', ') || 'None known';
}
function goalText(spec: MissionSpec, g: MissionSpec['goals'][number]) {
  switch (g.kind) {
    case 'killAir': return 'Destroy all enemy aircraft';
    case 'destroyGroup': return `Destroy ${Math.round(g.fraction * 100)}% of ${esc(spec.groups.find((x) => x.id === g.group)?.name ?? g.group)}`;
    case 'survive': return 'Survive';
    case 'land': return 'Land at an airbase';
  }
}

export function drawBriefMap(cv: HTMLCanvasElement, spec: MissionSpec, front?: number[]) {
  const ctx = cv.getContext('2d')!;
  const pf = spec.flights.find((f) => f.player)!;
  const start = startXZ(spec, pf);
  const home = airbaseById(pf.homeBase);
  const route = [start, ...(pf.waypoints ?? []).map((w) => ({ x: w.x, z: w.z })), ...(home ? [{ x: home.x, z: home.z }] : [])];
  const bounds = [...route];
  const markers: MapMarker[] = [];
  for (const f of spec.flights) {
    if (f.player) continue;
    const s = startXZ(spec, f);
    markers.push({ x: s.x, z: s.z, side: f.side, kind: 'aircraft', label: `${f.count}× ${AIRCRAFT_BY_ID[f.aircraftId].name}` });
    bounds.push({ x: s.x, z: s.z });
  }
  for (const g of spec.groups) {
    let ring = 0;
    if (g.kind === 'sam' && g.samType) {
      const p = SAM_PARAMS[g.samType];
      ring = p.isGun ? 3000 : WEAPONS[p.weapon].rangeKm * 800;
    }
    markers.push({ x: g.x, z: g.z, side: g.side, kind: g.kind === 'sam' ? 'sam' : 'target', label: g.name ?? g.kind, ring });
    bounds.push({ x: g.x, z: g.z });
  }
  markers.push({ x: start.x, z: start.z, side: pf.side, kind: 'player', label: 'START', hdg: 0 });
  (pf.waypoints ?? []).forEach((w, i) => markers.push({ x: w.x, z: w.z, side: 'neutral', kind: 'waypoint', label: `${i + 1} ${w.name ?? ''}` }));
  const xs = bounds.map((p) => p.x), zs = bounds.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 40 * NM);
  const view = { cx, cz, mpp: (span * 1.3) / Math.min(cv.width, cv.height), w: cv.width, h: cv.height };
  drawTheater(ctx, view, { front, markers, routes: [{ pts: route, color: '#fff', dashed: true }], showObjectives: false });
}

// ------------------------------------------------------------------ debrief
export function debrief(app: AppApi, spec: MissionSpec, r: MissionResult | null, b: BuiltMission, back: () => void,
  extraButtons?: Array<{ label: string; fn: () => void; primary?: boolean }>): HTMLElement {
  if (!r) { setTimeout(() => app.mainMenu(), 0); return el('<div></div>'); }
  const w = b.world;
  const rows = w.kills.map((k) => `<tr class="${k.victimSide === b.player.side ? 'loss' : 'kill'}"><td>${fmtT(k.time)}</td><td>${esc(k.killer || '—')}</td><td>${esc(k.victimType)}${k.ground ? '' : ` (${esc(k.victim)})`}</td><td>${esc(k.weapon || '')}</td></tr>`).join('');
  const fate = { landed: 'Landed safely', alive: 'Airborne at mission end', ejected: 'Ejected', killed: 'Killed in action' }[r.playerFate];
  const e = el(`
    <div class="screen debrief">
      <div class="header"><h2 class="${r.success ? 'ok' : 'bad'}">${r.status}</h2></div>
      <div class="cols">
        <div class="col">
          <h3>${esc(spec.title)}</h3>
          <ul class="goals">${r.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
          <table class="kv">
            <tr><td>Pilot status</td><td>${fate}</td></tr>
            <tr><td>Your air-to-air kills</td><td>${r.playerKillsAir}</td></tr>
            <tr><td>Your ground kills</td><td>${r.playerKillsGround}</td></tr>
            <tr><td>Enemy losses (air / ground)</td><td>${r.enemyLossesAir} / ${r.enemyLossesGround}</td></tr>
            <tr><td>Friendly aircraft lost</td><td>${r.friendlyLosses}</td></tr>
            <tr><td>Mission time</td><td>${fmtT(w.time)}</td></tr>
          </table>
          <div class="btnrow col-btns"></div>
        </div>
        <div class="col">
          <h3>Event log</h3>
          <div class="scroll"><table class="log"><tr><th>Time</th><th>Shooter</th><th>Victim</th><th>Weapon</th></tr>${rows || '<tr><td colspan="4">No kills recorded</td></tr>'}</table></div>
        </div>
      </div>
    </div>`);
  const br = e.querySelector('.col-btns')!;
  const buttons = extraButtons ?? [
    { label: 'Fly again', fn: () => app.fly(spec, (r2, b2) => app.show(() => debrief(app, spec, r2, b2, back))), primary: true },
    { label: 'Mission setup', fn: back },
    { label: 'Main menu', fn: () => app.mainMenu() },
  ];
  for (const x of buttons) {
    const btn = el(`<button class="${x.primary ? 'primary' : ''}">${esc(x.label)}</button>`);
    btn.addEventListener('click', x.fn);
    br.append(btn);
  }
  return e;
}
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ settings
export function settingsScreen(app: AppApi): HTMLElement {
  const s = app.settings;
  const chk = (k: keyof Settings, label: string, desc: string) =>
    `<label class="chk"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}> <b>${label}</b> <span class="muted small">${desc}</span></label>`;
  const e = el(`
    <div class="screen settings">
      <div class="header"><button data-a="back">◀ Back</button><h2>Settings</h2></div>
      <div class="cols">
        <div class="col">
          <h3>Realism</h3>
          ${chk('gEffects', 'G-effects', 'grey-out, black-out and red-out from sustained G')}
          ${chk('unlimitedFuel', 'Unlimited fuel', '')}
          ${chk('unlimitedWeapons', 'Unlimited weapons', 'stores, gun rounds and countermeasures never run out')}
          ${chk('invulnerable', 'Invulnerable', 'your aircraft cannot be damaged (crashes still count)')}
          ${chk('labels', 'Labels', 'type and range labels on aircraft and ground units (F9 in flight)')}
          ${chk('easyRadar', 'Easy radar', '+60% radar detection range')}
          <p class="muted">Realism profile: <b>${realismLabel(s)}</b></p>
        </div>
        <div class="col">
          <h3>Controls</h3>
          <label>Afterburner detent (throttle position 0.5–1) <input data-n="abDetent" type="number" min="0.5" max="1" step="0.01" value="${s.abDetent}"></label>
          <label>Keyboard stick sensitivity <input data-n="keyboardSensitivity" type="number" min="0.3" max="3" step="0.1" value="${s.keyboardSensitivity}"></label>
          <h3>Graphics</h3>
          <label>Field of view (deg) <input data-n="fov" type="number" min="40" max="110" value="${s.fov}"></label>
          <label>Max visibility (km) <input data-n="visibilityKm" type="number" min="10" max="150" value="${s.visibilityKm}"></label>
          ${chk('hdModels', 'HD aircraft models', 'detailed 3D models where available (F-14, Gripen); loaded on demand, ~4–7 MB each')}
          <div class="muted small credits">3D models: ${hdCredits().map((c) => `"${esc(c.title)}" by ${esc(c.author)} (<a href="${c.source}" target="_blank" rel="noopener">Sketchfab</a>), ${c.license}, textures re-encoded`).join(' · ')}</div>
          <div class="muted small credits">Northern Europe and Persian Gulf maps: elevation from <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (Mapzen/Tilezen; SRTM, GMTED2010, ETOPO1, EU-DEM and others — <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">attribution</a>); coastlines, lakes, borders and cities from <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> (public domain). Airfield positions approximate; the Europe scenario is fictional and the Gulf setting a simplified 1991 order of battle.</div>
          <h3>Audio & HUD</h3>
          <label>Volume (0–1) <input data-n="volume" type="number" min="0" max="1" step="0.05" value="${s.volume}"></label>
          <label>HUD color <input data-c="hudColor" type="color" value="${s.hudColor}"></label>
          <div class="btnrow"><button data-a="save" class="primary">Save</button><button data-a="defaults">Restore defaults</button></div>
        </div>
      </div>
    </div>`);
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => app.mainMenu());
  e.querySelector('[data-a="defaults"]')!.addEventListener('click', () => { Object.assign(app.settings, DEFAULT_SETTINGS); saveSettings(app.settings); app.show(() => settingsScreen(app)); });
  e.querySelector('[data-a="save"]')!.addEventListener('click', () => {
    const rec = app.settings as unknown as Record<string, unknown>;
    e.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((i) => { rec[i.dataset.k!] = i.checked; });
    e.querySelectorAll<HTMLInputElement>('input[data-n]').forEach((i) => { const v = Number(i.value); if (Number.isFinite(v)) rec[i.dataset.n!] = v; });
    e.querySelectorAll<HTMLInputElement>('input[data-c]').forEach((i) => { rec[i.dataset.c!] = i.value; });
    saveSettings(app.settings);
    setHdModelsEnabled(app.settings.hdModels);
    app.toast('Settings saved');
    app.mainMenu();
  });
  return e;
}

// ------------------------------------------------------------------ aircraft database
/** Aircraft grouped by family, in definition order. */
export function families(): Map<string, typeof AIRCRAFT> {
  const m = new Map<string, typeof AIRCRAFT>();
  for (const a of AIRCRAFT) { if (a.playable === false) continue; const f = a.family ?? a.name; if (!m.has(f)) m.set(f, []); m.get(f)!.push(a); }
  // within a family: by block number, then variant letter (A, B, B(U), C, D, E)
  const key = (a: (typeof AIRCRAFT)[number]) => {
    const v = a.variant ?? '';
    return Number(/Block (\d+)/.exec(v)?.[1] ?? 0) * 100 + (v.charCodeAt(0) || 0) + (v.includes('(') ? 0.5 : 0);
  };
  for (const list of m.values()) list.sort((a, b) => key(a) - key(b));
  return m;
}

export function aircraftDb(app: AppApi): HTMLElement {
  const rows = [...families()].map(([fam, list]) => (list.length > 1 ? `<tr class="famrow"><td colspan="10">${esc(fam)} family</td></tr>` : '') + list.map((a) => {
    const tw = (a.engine.abThrust * a.engine.count) / ((a.massEmpty + a.fuelInternal * 0.5) * 9.81);
    return `<tr><td><b>${esc(a.name)}</b>${a.seats === 2 ? ' <span class="muted small">2-seat</span>' : ''}<br><span class="muted small">${esc(a.fullName)}</span><br><span class="muted small caps">${esc((a.capabilities ?? []).join(' · '))}</span></td><td>${esc(a.role)}</td><td>${esc(a.country)}</td>
      <td>${a.fcs.type.toUpperCase()}${a.fcs.tvc ? ' + TVC' : ''}${a.fcs.vtol ? ' V/STOL' : ''}${a.fcs.swingWing ? ' swing-wing' : ''}${a.fcs.canard ? ' canard' : ''}</td>
      <td>${esc(a.engine.name)}</td><td>${tw.toFixed(2)}</td><td>M${a.limits.maxMach.toFixed(2)}</td><td>+${a.limits.gMax} / ${a.limits.gMin}</td>
      <td>${a.radar ? `${esc(a.radar.name)} (${Math.round(a.radar.range / NM)} nm)` : '—'}</td><td>${a.rcs} m²</td></tr>`;
  }).join('')).join('');
  const e = el(`
    <div class="screen db">
      <div class="header"><button data-a="back">◀ Back</button><h2>Aircraft Database</h2></div>
      <div class="scroll"><table class="dbt"><tr><th>Aircraft</th><th>Role</th><th>Country</th><th>FCS</th><th>Engine</th><th>T/W (AB, half fuel)</th><th>Max speed</th><th>G limits</th><th>Radar (vs 5 m²)</th><th>RCS</th></tr>${rows}</table></div>
    </div>`);
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => app.mainMenu());
  return e;
}

// ------------------------------------------------------------------ flight manual
export function manual(app: AppApi): HTMLElement {
  const e = el(`
    <div class="screen manual">
      <div class="header"><button data-a="back">◀ Back</button><h2>Flight Manual</h2></div>
      <div class="scroll prose">
        <h3>Flight model</h3>
        <p>Every jet flies the same 6-DOF rigid-body model driven by its own aerodynamic, engine and inertia data. Fly-by-wire jets (F-16, F/A-18, Su-27/30/57, Mirage, Rafale, Gripen, Typhoon) command G and roll rate and protect AoA and G. Mechanical/CAS jets (F-15, F-14, F-4, T-38, Harrier, MiG-29) move the control surfaces directly — they can be over-G'd and departed. Watch AoA (α) on the HUD.</p>
        <h3>Takeoff & landing</h3>
        <p>Full throttle (PgUp, or past the afterburner detent on a HOTAS), rotate at the jet's rotation speed (F-16 ≈ 150 kt) to about 10° pitch, raise the gear (G) once climbing. To land: gear down, flaps (F), fly about 140 kt, wheel brakes (W) after touchdown. Harrier: N / M rotate the nozzles; full nozzle-down and full throttle hovers a light Harrier.</p>
        <h3>Air-to-air</h3>
        <p>Radar: R cycles RWS → TWS → ACM → OFF, [ and ] change range, Tab moves the target cursor, Enter locks (STT), Backspace breaks lock. 2 selects BVR missiles, 3 selects IR missiles (radar to ACM auto-acquisition), 4 selects the gun. The HUD shows the target box, the launch zone (Rmax / no-escape / Rmin) and a SHOOT cue. Semi-active missiles (AIM-7, R-27, Super 530) need the lock held until impact; active missiles (AIM-120, R-77, MICA EM, Meteor, AIM-54) go active near the target. IR missiles growl while searching and give a high tone on lock.</p>
        <h3>Defending</h3>
        <p>The RWR (right MFD) shows emitters: search, LOCK (circle) and LAUNCH (flashing). Put the missile on your 3 or 9 o'clock (beam / notch) and dive toward ground clutter while dropping chaff (E) against radar missiles; flares (Q) and a hard turn against IR missiles. V runs a chaff/flare program.</p>
        <h3>Air-to-ground</h3>
        <p>6 selects air-to-ground weapons. Bombs: put the CCIP pipper on the target and press Space. Laser-guided bombs and Mavericks: Enter designates the target nearest the boresight, then release. HARMs pick the emitting radar nearest your nose.</p>
        <h3>Views</h3>
        <p>F1 cockpit, F2 external (drag the mouse to orbit, wheel to zoom), F3 fly-by, F4 target, F5 nearest enemy, F6 weapon, F10 / O map. Drag with the mouse to look around in the cockpit; L toggles padlock. A = autopilot (altitude / heading hold), Ctrl+Z = time acceleration.</p>
        <h3>Dynamic Campaign</h3>
        <p>Every 6-hour turn both air forces generate an Air Tasking Order: CAP, sweeps, SEAD, strike packages with escorts, OCA and CAS. Pick any Coalition flight to fly it yourself; everything else is resolved by the campaign engine. Destroyed factories and depots reduce supply, which drives the ground war and the frontline. Airbases overrun by the front are captured. Win by breaking the Federation air force or pushing the front to Volsk.</p>
      </div>
    </div>`);
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => app.mainMenu());
  return e;
}
