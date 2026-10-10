// Co-op lobby: host a room (share the 6-letter code) or join one. The host picks the scenario; every player picks
// their own jet. Peers connect directly (WebRTC via public trackers) — no server and no port forwarding.
import { AIRCRAFT, AIRCRAFT_BY_ID } from '../aircraft/defs.js';
import { SCENARIOS, buildScenario, defaultCustom, type ScenarioId, type MissionSpec } from '../game/mission.js';
import { makeRoomCode, NET_VERSION } from '../net/protocol.js';
import { CoopHost, CoopClient, addCoopFlights, clientSpec, type CoopPlayer } from '../net/coop.js';
import type { NetLink } from '../net/link.js';
import type { NetHook } from '../game/session.js';
import { el, esc, debrief, type AppApi } from './screens.js';

interface Peer { peerId: string; name: string; aircraftId: string }

const NAME_KEY = 'cfs.mp.name';
const load = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

let link: NetLink | null = null;

export function multiplayerScreen(app: AppApi): HTMLElement {
  const playable = AIRCRAFT.filter((a) => a.playable !== false);
  const e = el(`
    <div class="screen mp">
      <div class="header"><button data-a="back">◀ Back</button><h2>Multiplayer — co-op</h2></div>
      <div class="cols">
        <div class="col">
          <h3>You</h3>
          <label>Callsign <input class="mpname" maxlength="12" value="${esc(load(NAME_KEY, 'Player'))}"></label>
          <label>Aircraft <select class="mpac">${playable.map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(a.country)})</option>`).join('')}</select></label>
          <h3>Host a game</h3>
          <p class="muted small">Creates a room code to send to your friends. You choose the mission; the AI enemies run on your computer.</p>
          <button data-a="host" class="primary">Host game</button>
          <h3>Join a game</h3>
          <label>Room code <input class="mpcode" maxlength="6" style="text-transform:uppercase;width:8em"></label>
          <button data-a="join">Join</button>
          <p class="muted small">Works through home routers without port forwarding (direct WebRTC, signalled via public trackers). Some strict corporate/mobile networks may block it.</p>
        </div>
        <div class="col lobby hidden">
          <h3>Room <span class="code"></span></h3>
          <div class="muted small status">Connecting…</div>
          <table class="kv players"></table>
          <div class="hostonly hidden">
            <label>Mission <select class="mpscen">${SCENARIOS.filter((s) => s.id !== 'takeoff').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
            <div class="btnrow"><button data-a="start" class="primary big">START ▶</button></div>
          </div>
          <h3>Chat</h3>
          <div class="chatlog small"></div>
          <div class="btnrow"><input class="chatin" maxlength="120" placeholder="Say something…" style="flex:1"><button data-a="send">Send</button><button data-a="voice" title="Share your microphone with the other players">🎙 Voice</button></div>
        </div>
      </div>
    </div>`);
  const q = <T extends HTMLElement>(s: string) => e.querySelector(s) as T;
  const acSel = q<HTMLSelectElement>('.mpac');
  acSel.value = AIRCRAFT_BY_ID.f16c ? 'f16c' : playable[0].id;
  const peers = new Map<string, Peer>();
  let isHost = false;
  const me = () => ({ name: q<HTMLInputElement>('.mpname').value.trim() || 'Player', aircraftId: acSel.value });

  const chat = (who: string, text: string) => {
    const log = q<HTMLDivElement>('.chatlog');
    log.append(el(`<div><b>${esc(who)}:</b> ${esc(text)}</div>`));
    log.scrollTop = log.scrollHeight;
  };
  const renderPlayers = () => {
    const rows = [`<tr><td>${esc(me().name)} (you${isHost ? ', host' : ''})</td><td>${esc(AIRCRAFT_BY_ID[me().aircraftId]?.name ?? '')}</td></tr>`];
    for (const p of peers.values()) rows.push(`<tr><td>${esc(p.name)}</td><td>${esc(AIRCRAFT_BY_ID[p.aircraftId]?.name ?? '?')}</td></tr>`);
    q('.players').innerHTML = rows.join('');
    q('.status').textContent = peers.size ? `${peers.size + 1} players connected` : (isHost ? 'Waiting for players… share the code above.' : 'Looking for the host…');
  };

  const open = async (code: string, host: boolean) => {
    save(NAME_KEY, me().name);
    isHost = host;
    q('.lobby').classList.remove('hidden');
    q('.code').textContent = code;
    q('.hostonly').classList.toggle('hidden', !host);
    renderPlayers();
    try {
      link?.leave();
      const { joinNet } = await import('../net/link.js');
      link = await joinNet(code);
    } catch (err) {
      q('.status').textContent = `Network unavailable: ${(err as Error).message}`;
      return;
    }
    const L = link;
    const hello = () => L.send('hi', { ...me(), v: NET_VERSION });
    L.onPeerJoin(() => { hello(); });
    L.onPeerLeave((id) => { const p = peers.get(id); peers.delete(id); renderPlayers(); if (p) chat('—', `${p.name} left`); });
    L.on('hi', (d: Peer & { v: number }, from) => {
      if (d.v !== NET_VERSION) { chat('—', `${d.name} runs a different CFS version — both need the latest update`); return; }
      const known = peers.has(from);
      peers.set(from, { peerId: from, name: String(d.name).slice(0, 12), aircraftId: AIRCRAFT_BY_ID[d.aircraftId] ? d.aircraftId : 'f16c' });
      if (!known) { chat('—', `${d.name} joined`); hello(); }
      renderPlayers();
    });
    L.on('chat', (d: { name: string; text: string }) => chat(d.name, d.text));
    L.on('go', (d: { spec: MissionSpec; flightOf: Record<string, string> }) => {
      if (isHost) return;
      const fid = d.flightOf[L.selfId];
      if (!fid) { chat('—', 'The host started without you (joined too late?)'); return; }
      startClient(clientSpec(d.spec, fid), fid);
    });
    L.onPeerStream((stream) => { const a = new Audio(); a.srcObject = stream; void a.play().catch(() => {}); });
    hello();
  };

  const startHost = () => {
    if (!link) return;
    const L = link;
    const players: CoopPlayer[] = [...peers.values()];
    const base = buildScenario({ ...defaultCustom(), scenario: q<HTMLSelectElement>('.mpscen').value as ScenarioId, aircraftId: me().aircraftId, wingmen: 0, start: 'air' });
    base.title = `Co-op: ${base.title}`;
    const { spec, flightOf } = addCoopFlights(base, players);
    L.send('go', { spec, flightOf });
    let host: CoopHost | null = null;
    const hook: NetHook = {
      attach: (b) => { host = new CoopHost(b.world, L, flightOf); L.on('chat', (d: { name: string; text: string }) => b.world.radio(`${d.name}: ${d.text}`, '#ffe08a')); },
      frame: (dt) => host?.update(dt),
      end: () => host?.end('The host ended the mission.'),
    };
    app.fly(spec, (r, b) => app.show(() => debrief(app, spec, r, b, () => app.show(() => multiplayerScreen(app)))), hook);
  };

  const startClient = (spec: MissionSpec, fid: string) => {
    if (!link) return;
    const L = link;
    let client: CoopClient | null = null;
    const hook: NetHook = {
      attach: (b) => {
        client = new CoopClient(b.world, L, fid);
        client.onEnd = (reason) => b.world.radio(reason, '#ffb84f');
        L.on('chat', (d: { name: string; text: string }) => b.world.radio(`${d.name}: ${d.text}`, '#ffe08a'));
      },
      frame: (dt) => client?.update(dt),
      end: () => {},
    };
    app.fly(spec, (r, b) => app.show(() => debrief(app, spec, r, b, () => app.show(() => multiplayerScreen(app)))), hook);
  };

  q('[data-a="back"]').addEventListener('click', () => { link?.leave(); link = null; app.mainMenu(); });
  q('[data-a="host"]').addEventListener('click', () => { void open(makeRoomCode(), true); });
  q('[data-a="join"]').addEventListener('click', () => {
    const code = q<HTMLInputElement>('.mpcode').value.trim().toUpperCase();
    if (code.length !== 6) { app.toast('Enter the 6-character room code'); return; }
    void open(code, false);
  });
  q('[data-a="start"]').addEventListener('click', startHost);
  const sendChat = () => {
    const inp = q<HTMLInputElement>('.chatin');
    const text = inp.value.trim();
    if (!text || !link) return;
    link.send('chat', { name: me().name, text });
    chat(me().name, text);
    inp.value = '';
  };
  q('[data-a="send"]').addEventListener('click', sendChat);
  q<HTMLInputElement>('.chatin').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendChat(); });
  q('[data-a="voice"]').addEventListener('click', async () => {
    if (!link) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      link.addStream(s);
      app.toast('Voice on — your microphone is shared with the room');
    } catch { app.toast('Microphone not available'); }
  });
  acSel.addEventListener('change', () => { renderPlayers(); link?.send('hi', { ...me(), v: NET_VERSION }); });
  return e;
}
