import { AIRCRAFT_BY_ID } from '../aircraft/defs.js';
import {
  newCampaign, missionForFlight, applyMissionResult, resolveTurn, saveCampaign, listSaves, deleteSave, validateState,
  playerFlights, flightRoute, squadron, fmtTime,
  type CampaignState, type CFlight,
} from '../campaign/campaign.js';
import { AIRBASES, OBJECTIVES, SECTORS, sectorX, setTheater } from '../world/theater.js';
import { drawTheater, s2w, w2s, type MapMarker, type MapView } from './map.js';
import { briefing, debrief, el, esc, summarizeStores, type AppApi } from './screens.js';
import type { Skill } from '../ai/pilot.js';

let current: CampaignState | null = null;
let currentSlot = 1;

export function openCampaign(app: AppApi) {
  app.show(() => (current ? campaignHQ(app) : campaignLobby(app)));
}

export function campaignLobby(app: AppApi): HTMLElement {
  const saves = listSaves();
  const e = el(`
    <div class="screen campaign-lobby">
      <div class="header"><button data-a="back">◀ Back</button><h2>Dynamic Campaign — Varnia Peninsula</h2></div>
      <div class="cols">
        <div class="col">
          <h3>New campaign</h3>
          <p class="muted">The Federation has crossed the Lenva. You fly for the Coalition air forces: 12 squadrons, 12 aircraft types, four airbases, against six Federation regiments. The war runs in 6-hour turns; every turn both sides plan an Air Tasking Order and the ground war moves the front.</p>
          <label>Campaign name <input class="cname" value="Operation Northern Shield"></label>
          <label>Enemy skill <select class="cskill"><option value="rookie">Rookie</option><option value="regular" selected>Regular</option><option value="veteran">Veteran</option><option value="ace">Ace</option></select></label>
          <label>Save slot <select class="cslot"><option>1</option><option>2</option><option>3</option></select></label>
          <div class="btnrow"><button data-a="new" class="primary">Start campaign</button></div>
          <h3>Import</h3>
          <label class="filebtn">Load campaign file…<input type="file" accept=".json,application/json" class="cimport"></label>
        </div>
        <div class="col">
          <h3>Saved campaigns</h3>
          <div class="saves">${saves.length ? '' : '<p class="muted">No saved campaigns yet.</p>'}</div>
        </div>
      </div>
    </div>`);
  const list = e.querySelector('.saves')!;
  for (const s of saves) {
    const out = s.state.outcome ? ` · ${s.state.outcome === s.state.playerSide ? 'VICTORY' : 'DEFEAT'}` : '';
    const row = el(`<div class="saverow"><div><b>Slot ${s.slot}: ${esc(s.name)}</b><br><span class="muted small">Day ${s.day}, turn ${s.turn} · saved ${esc(new Date(s.savedAt).toLocaleString())}${out}</span></div>
      <div class="nowrap"><button data-a="load" class="primary small">Load</button> <button data-a="del" class="small">Delete</button></div></div>`);
    row.querySelector('[data-a="load"]')!.addEventListener('click', () => {
      try { current = validateState(s.state); } catch (err) { app.toast(`Could not load save: ${(err as Error).message}`); return; }
      currentSlot = s.slot; app.show(() => campaignHQ(app));
    });
    // two-step delete (window.confirm is unavailable in some embedded viewers)
    const del = row.querySelector('[data-a="del"]') as HTMLButtonElement;
    del.addEventListener('click', () => {
      if (del.dataset.armed) { deleteSave(s.slot); app.show(() => campaignLobby(app)); return; }
      del.dataset.armed = '1';
      del.textContent = 'Click again to delete';
      setTimeout(() => { delete del.dataset.armed; del.textContent = 'Delete'; }, 3000);
    });
    list.append(row);
  }
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => app.mainMenu());
  e.querySelector('[data-a="new"]')!.addEventListener('click', () => {
    const name = (e.querySelector('.cname') as HTMLInputElement).value.trim() || 'Campaign';
    const skill = (e.querySelector('.cskill') as HTMLSelectElement).value as Skill;
    currentSlot = Number((e.querySelector('.cslot') as HTMLSelectElement).value);
    current = newCampaign(name, skill);
    saveCampaign(current, currentSlot);
    app.show(() => campaignHQ(app));
  });
  e.querySelector('.cimport')!.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { current = validateState(JSON.parse(await f.text())); currentSlot = 3; app.show(() => campaignHQ(app)); }
    catch (err) { app.toast(`Could not load file: ${(err as Error).message}`); }
  });
  return e;
}

export function campaignHQ(app: AppApi): HTMLElement {
  const st = current!;
  setTheater(st.theaterId);
  let tab: 'ato' | 'sq' | 'obj' | 'log' = 'ato';
  let selected: CFlight | null = playerFlights(st).find((f) => !f.flown) ?? null;
  const view: MapView = { cx: 0, cz: 0, mpp: 700, w: 800, h: 700 };
  const e = el(`
    <div class="screen campaign">
      <div class="header">
        <button data-a="back">◀ Exit</button>
        <h2>${esc(st.name)}</h2>
        <div class="status"></div>
        <div class="spacer"></div>
        <button data-a="save">Save</button>
        <button data-a="export">Export</button>
      </div>
      <div class="cols">
        <div class="col mapcol"><canvas class="cmap"></canvas><div class="legend muted small">Wheel: zoom · drag: pan · bars on the front: red / blue ground strength</div></div>
        <div class="col side">
          <div class="tabs"><button data-t="ato">ATO</button><button data-t="sq">Squadrons</button><button data-t="obj">Objectives</button><button data-t="log">News</button></div>
          <div class="tabbody scroll"></div>
          <div class="flightbox"></div>
        </div>
      </div>
    </div>`);
  const cv = e.querySelector('.cmap') as HTMLCanvasElement;
  const body = e.querySelector('.tabbody') as HTMLElement;
  const fbox = e.querySelector('.flightbox') as HTMLElement;
  const status = e.querySelector('.status') as HTMLElement;

  const drawMap = () => {
    const rect = cv.parentElement!.getBoundingClientRect();
    cv.width = Math.max(300, Math.floor(rect.width) - 4);
    cv.height = Math.max(300, Math.floor(rect.height) - 30);
    view.w = cv.width; view.h = cv.height;
    const ctx = cv.getContext('2d')!;
    const markers: MapMarker[] = [];
    const routes: Array<{ pts: Array<{ x: number; z: number }>; color: string; dashed?: boolean }> = [];
    for (const p of st.ato) {
      if (p.side !== st.playerSide) continue;
      for (const f of p.flights) {
        const sel = selected?.id === f.id;
        if (!sel && f.packageId !== selected?.packageId) continue;
        const r = flightRoute(st, f);
        routes.push({ pts: [{ x: r.base.x, z: r.base.z }, r.ip, r.target, { x: r.base.x, z: r.base.z }], color: sel ? '#ffffff' : '#9cf', dashed: !sel });
        if (sel) markers.push({ x: f.x, z: f.z, side: 'blue', kind: 'target', label: `${f.task}: ${f.targetName}`, highlight: true });
      }
    }
    drawTheater(ctx, view, {
      front: st.front,
      airbaseOwners: Object.fromEntries(Object.entries(st.airbases).map(([k, v]) => [k, v.owner])),
      objectiveStatus: st.objectives,
      showSamRings: 'red',
      markers, routes,
    });
    for (let i = 0; i < SECTORS; i++) {
      const p = w2s(view, sectorX(i), st.front[i]);
      const b = st.strength.blue[i], r = st.strength.red[i];
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(p.x - 16, p.y - 12, 32, 22);
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(p.x - 14, p.y - 9, (r / 100) * 28, 6);
      ctx.fillStyle = '#5ab4ff'; ctx.fillRect(p.x - 14, p.y + 1, (b / 100) * 28, 6);
    }
  };
  let drag: { x: number; y: number } | null = null;
  cv.addEventListener('mousedown', (ev) => { drag = { x: ev.clientX, y: ev.clientY }; });
  window.addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    view.cx -= (ev.clientX - drag.x) * view.mpp;
    view.cz -= (ev.clientY - drag.y) * view.mpp;
    drag = { x: ev.clientX, y: ev.clientY };
    drawMap();
  });
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    const before = s2w(view, ev.clientX - r.left, ev.clientY - r.top);
    view.mpp = Math.max(60, Math.min(2000, view.mpp * (ev.deltaY > 0 ? 1.2 : 1 / 1.2)));
    const after = s2w(view, ev.clientX - r.left, ev.clientY - r.top);
    view.cx += before.x - after.x; view.cz += before.z - after.z;
    drawMap();
  }, { passive: false });

  const renderStatus = () => {
    const avg = st.front.reduce((a, b) => a + b, 0) / SECTORS;
    const front = avg < 0 ? `<span class="blue">${Math.round(-avg / 1000)} km north</span>` : `<span class="red">${Math.round(avg / 1000)} km south</span>`;
    status.innerHTML = `Day ${st.day} · ${fmtTime(st.hour)} · Turn ${st.turn} &nbsp;|&nbsp; Supply <span class="blue">${Math.round(st.supply.blue * 100)}%</span> / <span class="red">${Math.round(st.supply.red * 100)}%</span>
      &nbsp;|&nbsp; Front ${front} of the river &nbsp;|&nbsp; You: ${st.stats.sorties} sorties, ${st.stats.kills} A-A, ${st.stats.groundKills} A-G` +
      (st.outcome ? ` &nbsp;|&nbsp; <b class="${st.outcome}">${st.outcome === st.playerSide ? 'VICTORY' : 'DEFEAT'}</b>` : '');
  };

  const renderTab = () => {
    e.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.classList.toggle('sel', b.dataset.t === tab));
    if (tab === 'ato') {
      let html = '';
      for (const p of st.ato.filter((x) => x.side === st.playerSide)) {
        html += `<div class="pkg"><div class="pkgh">${esc(p.task)} — ${esc(p.targetName)}</div>`;
        for (const f of p.flights) {
          const sq = squadron(st, f.squadronId);
          html += `<div class="flight ${selected?.id === f.id ? 'sel' : ''} ${f.flown ? 'flown' : ''}" data-f="${esc(f.id)}">
            <b>${esc(f.callsign)}</b> ${esc(f.task)} · ${f.count}× ${esc(AIRCRAFT_BY_ID[f.aircraftId].name)} · TOT ${fmtTime(st.hour + f.tot / 60)}
            <br><span class="muted small">${esc(sq.name)} @ ${esc(AIRBASES.find((a) => a.id === sq.baseId)?.name ?? '')}${f.flown ? ' · FLOWN' : ''}</span></div>`;
        }
        html += '</div>';
      }
      const enemyFlights = st.ato.filter((x) => x.side !== st.playerSide).reduce((a, p) => a + p.flights.length, 0);
      html += `<p class="muted small">Intelligence estimates ${enemyFlights} Federation flights tasked this period.</p>`;
      body.innerHTML = html;
      body.querySelectorAll<HTMLElement>('[data-f]').forEach((d) => d.addEventListener('click', () => {
        selected = playerFlights(st).find((f) => f.id === d.dataset.f) ?? null;
        if (selected) { view.cx = selected.x; view.cz = selected.z + 40000; }
        renderTab(); renderFlight(); drawMap();
      }));
    } else if (tab === 'sq') {
      body.innerHTML = `<table class="sqt"><tr><th>Squadron</th><th>Type</th><th>Base</th><th>A/C</th><th>Pilots</th><th>K / L</th></tr>${st.squadrons.map((s) =>
        `<tr class="${s.side}"><td>${esc(s.name)}</td><td>${esc(AIRCRAFT_BY_ID[s.aircraftId].name)}</td><td>${esc(AIRBASES.find((a) => a.id === s.baseId)?.name ?? '')}</td><td>${s.aircraft}/${s.maxAircraft}</td><td>${s.pilots}</td><td>${s.kills} / ${s.losses}</td></tr>`).join('')}</table>`;
    } else if (tab === 'obj') {
      const rows = OBJECTIVES.map((o) => {
        const s = st.objectives[o.id];
        return `<tr class="${s.owner}"><td>${esc(o.name)}</td><td>${o.kind}${o.samType ? ` (${o.samType})` : ''}</td><td>${s.owner === 'blue' ? 'Coalition' : 'Federation'}</td><td>${s.hp <= 0 ? 'DESTROYED' : Math.round(s.hp) + '%'}</td></tr>`;
      }).join('');
      const bases = AIRBASES.map((a) => `<tr class="${st.airbases[a.id].owner}"><td>${esc(a.name)}</td><td>airbase</td><td>${st.airbases[a.id].owner === 'blue' ? 'Coalition' : 'Federation'}</td><td>ops ${Math.round(st.airbases[a.id].ops)}%</td></tr>`).join('');
      body.innerHTML = `<table class="sqt"><tr><th>Objective</th><th>Type</th><th>Owner</th><th>Status</th></tr>${rows}${bases}</table>`;
    } else {
      body.innerHTML = st.log.slice(0, 150).map((l) => `<div class="news ${l.side ?? ''}"><span class="muted small">D${l.day} ${fmtTime(l.hour)}</span> ${esc(l.text)}</div>`).join('');
    }
  };

  const renderFlight = () => {
    fbox.innerHTML = '';
    if (st.outcome) {
      fbox.append(el(`<div class="panel"><h3>${st.outcome === st.playerSide ? 'The war is won.' : 'The war is lost.'}</h3><p>${esc(st.log[0]?.text ?? '')}</p></div>`));
      return;
    }
    const f = selected;
    const box = el(`<div class="panel">
      ${f ? `<div><b>${esc(f.callsign)}</b> — ${esc(f.task)} vs ${esc(f.targetName)}</div>
      <div class="muted small">${f.count}× ${esc(AIRCRAFT_BY_ID[f.aircraftId].name)} · ${esc(summarizeStores(f.stores))}</div>` : '<div class="muted">Select a flight from the ATO.</div>'}
      <div class="btnrow">
        ${f && !f.flown ? '<button data-a="fly" class="primary">Fly this flight ▶</button>' : ''}
        <button data-a="skip">Skip turn (resolve) ⏭</button>
      </div></div>`);
    box.querySelector('[data-a="skip"]')!.addEventListener('click', () => {
      resolveTurn(st);
      saveCampaign(st, currentSlot);
      selected = playerFlights(st).find((x) => !x.flown) ?? null;
      renderAll();
      app.toast(`Turn resolved. Campaign saved (slot ${currentSlot}).`);
    });
    box.querySelector('[data-a="fly"]')?.addEventListener('click', () => { if (f) flyFlight(app, st, f); });
    fbox.append(box);
  };

  const renderAll = () => { renderStatus(); renderTab(); renderFlight(); drawMap(); };
  e.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t as typeof tab; renderTab(); }));
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => { saveCampaign(st, currentSlot); current = null; app.show(() => campaignLobby(app)); });
  e.querySelector('[data-a="save"]')!.addEventListener('click', () => { app.toast(saveCampaign(st, currentSlot) ? `Saved to slot ${currentSlot}` : 'Save failed (storage full?)'); });
  e.querySelector('[data-a="export"]')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(st)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cfs-campaign-${st.name.replace(/\W+/g, '_')}-day${st.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  if (selected) { view.cx = selected.x; view.cz = selected.z + 40000; }
  requestAnimationFrame(() => renderAll());
  const onResize = () => { if (document.body.contains(e)) drawMap(); else window.removeEventListener('resize', onResize); };
  window.addEventListener('resize', onResize);
  return e;
}

function flyFlight(app: AppApi, st: CampaignState, f: CFlight) {
  const sq = squadron(st, f.squadronId);
  const def = AIRCRAFT_BY_ID[f.aircraftId];
  let start: 'runway' | 'air' = 'air';
  let stores = f.stores;
  const opts = el(`<div class="panel">
    <h3>Flight options</h3>
    <label>Start <select class="st"><option value="air">Airborne (en route)</option><option value="runway">Runway (${esc(AIRBASES.find((a) => a.id === sq.baseId)?.name ?? '')})</option></select></label>
    <label>Loadout <select class="ld"></select></label>
  </div>`);
  const stSel = opts.querySelector('.st') as HTMLSelectElement;
  const ld = opts.querySelector('.ld') as HTMLSelectElement;
  ld.append(new Option(`Planned: ${summarizeStores(f.stores)}`, '-1'));
  def.loadouts.forEach((l, i) => ld.append(new Option(l.name, String(i))));
  const go = () => {
    const spec = missionForFlight(st, f, start, stores);
    app.fly(spec, (r, b) => {
      if (!r) { app.show(() => campaignHQ(app)); return; }
      applyMissionResult(st, f, b, r);
      saveCampaign(st, currentSlot);
      app.show(() => debrief(app, spec, r, b, () => app.show(() => campaignHQ(app)), [
        { label: 'Continue campaign (resolve turn)', primary: true, fn: () => { resolveTurn(st); saveCampaign(st, currentSlot); app.show(() => campaignHQ(app)); } },
        { label: 'Back to HQ (same turn)', fn: () => app.show(() => campaignHQ(app)) },
      ]));
    });
  };
  const rebuild = () => app.show(() => briefing(app, missionForFlight(st, f, start, stores), () => app.show(() => campaignHQ(app)), opts, go, st.front));
  stSel.addEventListener('change', () => { start = stSel.value as typeof start; rebuild(); });
  ld.addEventListener('change', () => { const i = Number(ld.value); stores = i < 0 ? f.stores : def.loadouts[i].stores; rebuild(); });
  rebuild();
}
