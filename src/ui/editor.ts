// Mission editor: place flights, ground groups and waypoints on the theater map; edit their properties; set goals,
// weather and briefing; save / export / import / share as a link; fly it. Reads and writes the MissionSpec that
// Instant Action and the campaign also use.
import { AIRCRAFT, AIRCRAFT_BY_ID } from '../aircraft/defs.js';
import type { Side } from '../aircraft/types.js';
import type { MissionSpec, FlightSpec, GroupKind, MissionGoal } from '../game/mission.js';
import { validateMissionSpec, encodeMission, listMissions, saveMission, deleteMission } from '../game/missionFile.js';
import { AIRBASES, THEATER_HALF, airbaseById, type SamType } from '../world/theater.js';
import { drawTheater, s2w, type MapMarker, type MapView } from './map.js';
import { el, esc, briefing, debrief, type AppApi } from './screens.js';
import type { AITask, Skill } from '../ai/pilot.js';

const FT = 0.3048;
const TASKS: AITask[] = ['cap', 'sweep', 'escort', 'intercept', 'strike', 'sead', 'cas', 'patrol', 'ferry', 'awacs', 'tanker'];
const SKILLS: Skill[] = ['rookie', 'regular', 'veteran', 'ace'];
const KINDS: GroupKind[] = ['sam', 'armor', 'convoy', 'factory', 'depot', 'bridge', 'radar', 'command', 'city'];
const SAMS: SamType[] = ['SA-10', 'SA-6', 'SA-2', 'SA-15', 'Patriot', 'Hawk', 'AAA'];

type Sel = { t: 'flight'; id: string } | { t: 'group'; id: string } | null;
type Tool = 'select' | 'flight' | 'group' | 'waypoint';

export function newMission(): MissionSpec {
  const hb = AIRBASES.find((a) => a.id === 'halvorsen') ?? AIRBASES.find((a) => a.side === 'blue') ?? AIRBASES[0];
  return {
    title: 'New mission', briefing: 'Describe the mission here.',
    weather: { visibilityKm: 80, clouds: 'scattered', cloudBase: 3500, timeOfDay: 11 },
    flights: [{ id: 'f1', callsign: 'Viper', side: 'blue', aircraftId: 'f16c', stores: AIRCRAFT_BY_ID.f16c.loadouts[0].stores, count: 2, skill: 'veteran',
      task: 'sweep', start: { kind: 'air', x: hb.x, z: hb.z - 20000, alt: 6000, hdg: 0, speed: 220 }, homeBase: hb.id, player: true, waypoints: [] }],
    groups: [], goals: [{ kind: 'survive' }],
  };
}

let current: MissionSpec | null = null;

export function editorScreen(app: AppApi, load?: MissionSpec): HTMLElement {
  const m: MissionSpec = load ? JSON.parse(JSON.stringify(load)) : current ?? newMission();
  current = m;
  let sel: Sel = { t: 'flight', id: m.flights.find((f) => f.player)?.id ?? m.flights[0].id };
  let tool: Tool = 'select';
  const view: MapView = { cx: 0, cz: 0, mpp: 700, w: 800, h: 700 };
  const e = el(`
    <div class="screen editor">
      <div class="header"><button data-a="back">◀ Back</button><h2>Mission Editor</h2><span class="spacer"></span>
        <button data-a="new">New</button><button data-a="save">Save</button><button data-a="export">Export</button>
        <label class="btnlike">Import<input type="file" accept=".json,application/json" class="imp" hidden></label>
        <button data-a="share">Share link</button><button data-a="fly" class="primary">Briefing ▶</button></div>
      <div class="cols">
        <div class="col mapcol">
          <div class="tools"><button data-t="select">Select</button><button data-t="flight">+ Flight</button><button data-t="group">+ Ground group</button><button data-t="waypoint">+ Waypoint</button>
            <span class="muted small hint"></span></div>
          <canvas class="emap" width="800" height="700"></canvas>
        </div>
        <div class="col side">
          <label>Title <input class="mtitle"></label>
          <label>Briefing <textarea class="mbrief" rows="3"></textarea></label>
          <div class="row3">
            <label>Time <input class="mtod" type="number" min="0" max="23.5" step="0.5"></label>
            <label>Clouds <select class="mclouds"><option>clear</option><option>scattered</option><option>overcast</option></select></label>
            <label>Vis km <input class="mvis" type="number" min="5" max="150"></label>
          </div>
          <h3>Objects</h3><div class="objlist"></div>
          <h3>Selected</h3><div class="props"></div>
          <h3>Goals</h3><div class="goals"></div>
          <h3>Saved missions</h3><div class="lib small"></div>
        </div>
      </div>
    </div>`);
  const q = <T extends HTMLElement>(s: string) => e.querySelector(s) as T;
  const cv = q<HTMLCanvasElement>('.emap');
  const ctx = cv.getContext('2d')!;
  view.mpp = (2 * THEATER_HALF) / cv.height;

  // ---------------------------------------------------------------- drawing
  const startXZ = (f: FlightSpec) => {
    if (f.start.kind === 'air') return { x: f.start.x, z: f.start.z };
    const ab = airbaseById(f.start.airbaseId); return { x: ab?.x ?? 0, z: ab?.z ?? 0 };
  };
  const draw = () => {
    const markers: MapMarker[] = [];
    const routes: Array<{ pts: Array<{ x: number; z: number }>; color: string; dashed?: boolean }> = [];
    for (const f of m.flights) {
      const s = startXZ(f);
      const isSel = sel?.t === 'flight' && sel.id === f.id;
      markers.push({ ...s, side: f.side, kind: f.player ? 'player' : 'aircraft', label: `${f.callsign} ${f.count}× ${AIRCRAFT_BY_ID[f.aircraftId]?.name ?? f.aircraftId}`,
        hdg: f.start.kind === 'air' ? f.start.hdg * Math.PI / 180 : undefined, highlight: isSel });
      if (f.waypoints?.length) routes.push({ pts: [s, ...f.waypoints], color: f.side === 'blue' ? '#5ab4ff' : '#ff5a5a', dashed: !isSel });
      if (isSel) f.waypoints?.forEach((w, i) => markers.push({ x: w.x, z: w.z, side: f.side, kind: 'waypoint', label: w.name ?? `WP${i + 1}` }));
    }
    for (const g of m.groups) markers.push({ x: g.x, z: g.z, side: g.side, kind: g.kind === 'sam' ? 'sam' : 'ground', label: g.name ?? `${g.kind}${g.samType ? ' ' + g.samType : ''}`, highlight: sel?.t === 'group' && sel.id === g.id });
    drawTheater(ctx, view, { showObjectives: false, showSamRings: 'none', markers, routes });
  };

  // ---------------------------------------------------------------- side panel
  const uid = (p: string) => { let i = 1; while (m.flights.some((f) => f.id === `${p}${i}`) || m.groups.some((g) => g.id === `${p}${i}`)) i++; return `${p}${i}`; };
  const flight = () => (sel?.t === 'flight' ? m.flights.find((f) => f.id === sel!.id) ?? null : null);
  const group = () => (sel?.t === 'group' ? m.groups.find((g) => g.id === sel!.id) ?? null : null);

  const renderObjects = () => {
    const rows = [
      ...m.flights.map((f) => `<div class="obj ${sel?.t === 'flight' && sel.id === f.id ? 'sel' : ''}" data-f="${f.id}"><span class="dot ${f.side}"></span>${f.player ? '★ ' : ''}${esc(f.callsign)} — ${f.count}× ${esc(AIRCRAFT_BY_ID[f.aircraftId]?.name ?? '')} (${f.task})</div>`),
      ...m.groups.map((g) => `<div class="obj ${sel?.t === 'group' && sel.id === g.id ? 'sel' : ''}" data-g="${g.id}"><span class="dot ${g.side}"></span>${esc(g.name ?? g.kind)}${g.samType ? ` (${g.samType})` : ''}</div>`),
    ];
    q('.objlist').innerHTML = rows.join('') || '<p class="muted">Nothing placed yet.</p>';
    q('.objlist').querySelectorAll<HTMLElement>('.obj').forEach((o) => o.addEventListener('click', () => {
      sel = o.dataset.f ? { t: 'flight', id: o.dataset.f } : { t: 'group', id: o.dataset.g! };
      refresh();
    }));
  };

  const renderProps = () => {
    const p = q('.props');
    const f = flight(), g = group();
    if (f) {
      const def = AIRCRAFT_BY_ID[f.aircraftId];
      const air = f.start.kind === 'air' ? f.start : null;
      p.innerHTML = `
        <div class="row3"><label>Callsign <input data-k="callsign" value="${esc(f.callsign)}"></label>
          <label>Side <select data-k="side"><option>blue</option><option>red</option></select></label>
          <label>Count <input data-k="count" type="number" min="1" max="8" value="${f.count}"></label></div>
        <label>Aircraft <select data-k="aircraftId">${AIRCRAFT.map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(a.country)})</option>`).join('')}</select></label>
        <label>Loadout <select data-k="loadout">${def.loadouts.map((l, i) => `<option value="${i}">${esc(l.name)}</option>`).join('')}</select></label>
        <div class="row3"><label>Task <select data-k="task">${TASKS.map((t) => `<option>${t}</option>`).join('')}</select></label>
          <label>Skill <select data-k="skill">${SKILLS.map((s) => `<option>${s}</option>`).join('')}</select></label>
          <label class="chk"><input type="checkbox" data-k="player" ${f.player ? 'checked' : ''}> Player</label></div>
        <div class="row3"><label>Start <select data-k="startKind"><option value="air">In the air</option><option value="runway">Runway</option></select></label>
          ${air ? `<label>Alt ft <input data-k="alt" type="number" step="500" value="${Math.round(air.alt / FT)}"></label><label>Hdg <input data-k="hdg" type="number" min="0" max="359" value="${Math.round(air.hdg)}"></label>`
            : `<label>Airbase <select data-k="airbase">${AIRBASES.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>`}</div>
        <div class="muted small">${f.waypoints?.length ?? 0} waypoints — use “+ Waypoint” and click the map. <a data-a="clearwp">Clear waypoints</a> · <a data-a="del">Delete flight</a></div>`;
      const setV = (k: string, v: string) => { const i = p.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${k}"]`); if (i) i.value = v; };
      setV('side', f.side); setV('aircraftId', f.aircraftId); setV('task', f.task); setV('skill', f.skill); setV('startKind', f.start.kind);
      setV('loadout', String(Math.max(0, def.loadouts.findIndex((l) => JSON.stringify(l.stores) === JSON.stringify(f.stores)))));
      if (f.start.kind === 'runway') setV('airbase', f.start.airbaseId);
      p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.dataset.k!, v = inp.value;
        if (k === 'callsign') f.callsign = v.slice(0, 16) || 'Flight';
        else if (k === 'side') { f.side = v as Side; if (f.side === 'red') f.player = false; }
        else if (k === 'count') f.count = Math.max(1, Math.min(8, Number(v) || 1));
        else if (k === 'aircraftId') { f.aircraftId = v; f.stores = AIRCRAFT_BY_ID[v].loadouts[0]?.stores ?? []; }
        else if (k === 'loadout') f.stores = AIRCRAFT_BY_ID[f.aircraftId].loadouts[Number(v)]?.stores ?? [];
        else if (k === 'task') f.task = v as AITask;
        else if (k === 'skill') f.skill = v as Skill;
        else if (k === 'player') { for (const o of m.flights) o.player = false; f.player = (inp as HTMLInputElement).checked; if (f.player) f.side = 'blue'; }
        else if (k === 'startKind') {
          const s = startXZ(f);
          f.start = v === 'air' ? { kind: 'air', x: s.x, z: s.z, alt: 6000, hdg: 0, speed: 220 } : { kind: 'runway', airbaseId: AIRBASES.find((a) => a.side === f.side)?.id ?? AIRBASES[0].id };
        } else if (k === 'alt' && f.start.kind === 'air') f.start.alt = Math.max(150, Number(v) * FT);
        else if (k === 'hdg' && f.start.kind === 'air') f.start.hdg = ((Number(v) % 360) + 360) % 360;
        else if (k === 'airbase' && f.start.kind === 'runway') { f.start.airbaseId = v; f.homeBase = v; }
        refresh();
      }));
      p.querySelector('[data-a="clearwp"]')?.addEventListener('click', () => { f.waypoints = []; refresh(); });
      p.querySelector('[data-a="del"]')?.addEventListener('click', () => {
        if (m.flights.length <= 1) { app.toast('A mission needs at least one flight'); return; }
        m.flights = m.flights.filter((x) => x !== f);
        if (f.player) m.flights[0].player = true;
        sel = null; refresh();
      });
    } else if (g) {
      p.innerHTML = `
        <div class="row3"><label>Name <input data-k="name" value="${esc(g.name ?? '')}"></label>
          <label>Side <select data-k="side"><option>blue</option><option>red</option></select></label>
          <label>Kind <select data-k="kind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label></div>
        ${g.kind === 'sam' ? `<label>SAM type <select data-k="samType">${SAMS.map((s) => `<option>${s}</option>`).join('')}</select></label>` : ''}
        <div class="muted small"><a data-a="del">Delete group</a></div>`;
      const setV = (k: string, v: string) => { const i = p.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-k="${k}"]`); if (i) i.value = v; };
      setV('side', g.side); setV('kind', g.kind); if (g.samType) setV('samType', g.samType);
      p.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.dataset.k!, v = inp.value;
        if (k === 'name') g.name = v.slice(0, 40);
        else if (k === 'side') g.side = v as Side;
        else if (k === 'kind') { g.kind = v as GroupKind; g.samType = g.kind === 'sam' ? g.samType ?? 'SA-6' : undefined; }
        else if (k === 'samType') g.samType = v as SamType;
        refresh();
      }));
      p.querySelector('[data-a="del"]')?.addEventListener('click', () => {
        m.groups = m.groups.filter((x) => x !== g);
        m.goals = m.goals.filter((x) => !(x.kind === 'destroyGroup' && x.group === g.id));
        sel = null; refresh();
      });
    } else p.innerHTML = '<p class="muted">Select an object in the list or on the map.</p>';
  };

  const renderGoals = () => {
    const has = (k: MissionGoal['kind']) => m.goals.some((x) => x.kind === k);
    const destroy = new Set(m.goals.flatMap((x) => (x.kind === 'destroyGroup' ? [x.group] : [])));
    q('.goals').innerHTML = `
      <label class="chk"><input type="checkbox" data-g="killAir" ${has('killAir') ? 'checked' : ''}> Destroy all enemy aircraft</label>
      <label class="chk"><input type="checkbox" data-g="survive" ${has('survive') ? 'checked' : ''}> Survive</label>
      <label class="chk"><input type="checkbox" data-g="land" ${has('land') ? 'checked' : ''}> Land at an airbase</label>
      ${m.groups.filter((g) => g.side === 'red').map((g) => `<label class="chk"><input type="checkbox" data-dg="${g.id}" ${destroy.has(g.id) ? 'checked' : ''}> Destroy ${esc(g.name ?? g.kind)}</label>`).join('')}`;
    q('.goals').querySelectorAll<HTMLInputElement>('input').forEach((i) => i.addEventListener('change', () => {
      const goals: MissionGoal[] = [];
      q('.goals').querySelectorAll<HTMLInputElement>('input:checked').forEach((c) => {
        if (c.dataset.g === 'killAir') goals.push({ kind: 'killAir', side: 'red' });
        else if (c.dataset.g === 'survive') goals.push({ kind: 'survive' });
        else if (c.dataset.g === 'land') goals.push({ kind: 'land' });
        else if (c.dataset.dg) goals.push({ kind: 'destroyGroup', group: c.dataset.dg, fraction: 0.6 });
      });
      m.goals = goals;
    }));
  };

  const renderLib = () => {
    const list = listMissions();
    q('.lib').innerHTML = list.length ? list.map((s, i) => `<div class="libRow"><a data-i="${i}">${esc(s.name)}</a> <span class="muted">${new Date(s.savedAt).toLocaleDateString()}</span> <a class="muted" data-d="${i}">delete</a></div>`).join('') : '<span class="muted">None yet.</span>';
    q('.lib').querySelectorAll<HTMLElement>('[data-i]').forEach((a) => a.addEventListener('click', () => app.show(() => editorScreen(app, list[Number(a.dataset.i)].spec))));
    q('.lib').querySelectorAll<HTMLElement>('[data-d]').forEach((a) => a.addEventListener('click', () => { deleteMission(list[Number(a.dataset.d)].name); renderLib(); }));
  };

  const refresh = () => { renderObjects(); renderProps(); renderGoals(); draw(); };

  // ---------------------------------------------------------------- header fields
  q<HTMLInputElement>('.mtitle').value = m.title;
  q<HTMLTextAreaElement>('.mbrief').value = m.briefing;
  q<HTMLInputElement>('.mtod').value = String(m.weather.timeOfDay);
  q<HTMLSelectElement>('.mclouds').value = m.weather.clouds;
  q<HTMLInputElement>('.mvis').value = String(m.weather.visibilityKm);
  q('.mtitle').addEventListener('input', () => { m.title = q<HTMLInputElement>('.mtitle').value.slice(0, 60) || 'Untitled'; });
  q('.mbrief').addEventListener('input', () => { m.briefing = q<HTMLTextAreaElement>('.mbrief').value.slice(0, 2000); });
  q('.mtod').addEventListener('change', () => { m.weather.timeOfDay = Math.max(0, Math.min(23.5, Number(q<HTMLInputElement>('.mtod').value) || 11)); });
  q('.mclouds').addEventListener('change', () => { m.weather.clouds = q<HTMLSelectElement>('.mclouds').value as MissionSpec['weather']['clouds']; });
  q('.mvis').addEventListener('change', () => { m.weather.visibilityKm = Math.max(5, Math.min(150, Number(q<HTMLInputElement>('.mvis').value) || 80)); });

  // ---------------------------------------------------------------- tools & map input
  const hints: Record<Tool, string> = { select: 'Click an object to select it; drag to pan, wheel to zoom.', flight: 'Click the map to place a new flight.', group: 'Click the map to place a ground group.', waypoint: 'Click to append waypoints to the selected flight.' };
  const setTool = (t: Tool) => { tool = t; e.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.classList.toggle('sel', b.dataset.t === t)); q('.hint').textContent = hints[t]; };
  e.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.t as Tool)));
  setTool('select');
  const toWorld = (ev: MouseEvent) => {
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    return s2w(view, (ev.clientX - r.left) * k, (ev.clientY - r.top) * k);
  };
  let drag: { x: number; y: number; moved: boolean } | null = null;
  cv.addEventListener('mousedown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, moved: false }; });
  cv.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) {
      const k = cv.width / cv.getBoundingClientRect().width;
      view.cx -= dx * k * view.mpp; view.cz -= dy * k * view.mpp;
      drag.x = ev.clientX; drag.y = ev.clientY;
      draw();
    }
  });
  cv.addEventListener('mouseup', (ev) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const w = toWorld(ev);
    if (tool === 'flight') {
      const id = uid('f');
      const ac = AIRCRAFT_BY_ID.mig29a;
      m.flights.push({ id, callsign: 'Bandit', side: 'red', aircraftId: ac.id, stores: ac.loadouts[0].stores, count: 2, skill: 'regular', task: 'cap',
        start: { kind: 'air', x: w.x, z: w.z, alt: 6000, hdg: 180, speed: 220 }, homeBase: AIRBASES.find((a) => a.side === 'red')?.id ?? AIRBASES[0].id,
        station: { x: w.x, z: w.z, alt: 6000 }, waypoints: [] });
      sel = { t: 'flight', id }; setTool('select');
    } else if (tool === 'group') {
      const id = uid('g');
      m.groups.push({ id, side: 'red', kind: 'sam', samType: 'SA-6', x: w.x, z: w.z, name: `SA-6 site ${m.groups.length + 1}` });
      sel = { t: 'group', id }; setTool('select');
    } else if (tool === 'waypoint') {
      const f = flight();
      if (!f) { app.toast('Select a flight first'); return; }
      (f.waypoints ??= []).push({ x: w.x, z: w.z, alt: f.start.kind === 'air' ? f.start.alt : 3000, name: `WP${f.waypoints.length + 1}` });
    } else {
      // select the nearest object within 12 px
      let best: Sel = null, bd = 12 * view.mpp;
      for (const f of m.flights) { const s = startXZ(f); const d = Math.hypot(s.x - w.x, s.z - w.z); if (d < bd) { bd = d; best = { t: 'flight', id: f.id }; } }
      for (const g of m.groups) { const d = Math.hypot(g.x - w.x, g.z - w.z); if (d < bd) { bd = d; best = { t: 'group', id: g.id }; } }
      sel = best;
    }
    refresh();
  });
  cv.addEventListener('mouseleave', () => { drag = null; });
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const sx = (ev.clientX - r.left) * k, sy = (ev.clientY - r.top) * k;
    const before = s2w(view, sx, sy);
    view.mpp = Math.max(30, Math.min((2 * THEATER_HALF) / cv.height * 1.2, view.mpp * (ev.deltaY > 0 ? 1.2 : 1 / 1.2)));
    const after = s2w(view, sx, sy);
    view.cx += before.x - after.x; view.cz += before.z - after.z;
    draw();
  }, { passive: false });

  // ---------------------------------------------------------------- header actions
  const valid = (): MissionSpec | null => { try { return validateMissionSpec(m); } catch (err) { app.toast((err as Error).message); return null; } };
  q('[data-a="back"]').addEventListener('click', () => app.mainMenu());
  q('[data-a="new"]').addEventListener('click', () => { current = null; app.show(() => editorScreen(app, newMission())); });
  q('[data-a="save"]').addEventListener('click', () => { if (valid()) { app.toast(saveMission(m) ? 'Mission saved' : 'Could not save (storage full?)'); renderLib(); } });
  q('[data-a="export"]').addEventListener('click', () => {
    if (!valid()) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }));
    a.download = `${m.title.replace(/[^\w-]+/g, '_') || 'mission'}.cfs.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  q('.imp').addEventListener('change', async (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try { const spec = validateMissionSpec(JSON.parse(await file.text())); app.show(() => editorScreen(app, spec)); }
    catch (err) { app.toast((err as Error).message); }
  });
  q('[data-a="share"]').addEventListener('click', async () => {
    if (!valid()) return;
    const url = `${location.origin}${location.pathname}#mission=${await encodeMission(m)}`;
    try { await navigator.clipboard.writeText(url); app.toast('Link copied — anyone who opens it gets this mission'); }
    catch { window.prompt('Copy this link:', url); }
  });
  q('[data-a="fly"]').addEventListener('click', () => {
    const spec = valid();
    if (!spec) return;
    const copy: MissionSpec = JSON.parse(JSON.stringify(spec));
    app.show(() => briefing(app, copy, () => app.show(() => editorScreen(app)), undefined,
      () => app.fly(copy, (r, b) => app.show(() => debrief(app, copy, r, b, () => app.show(() => editorScreen(app)))))));
  });

  requestAnimationFrame(() => { renderLib(); refresh(); });
  return e;
}
