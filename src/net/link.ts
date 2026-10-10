// Real network transport: a Trystero room using the WebTorrent-tracker strategy — peers find each other through
// public trackers and connect directly over WebRTC (no server of our own, no port forwarding). Loaded on demand so
// single-player never touches the network.
import type { NetTransport } from './coop.js';

export interface NetLink extends NetTransport {
  peers(): string[];
  /** voice chat: share a local microphone stream / receive remote streams */
  addStream(stream: MediaStream): void;
  onPeerStream(cb: (stream: MediaStream, peerId: string) => void): void;
}

const APP_ID = 'cfs-combat-flight-sim-v1';

export async function joinNet(roomCode: string): Promise<NetLink> {
  const { joinRoom, selfId } = await import('@trystero-p2p/torrent');
  const room = joinRoom({ appId: APP_ID }, roomCode.toUpperCase());
  const actions = new Map<string, { send: (d: unknown, o?: { target?: string }) => Promise<void> }>();
  const handlers = new Map<string, (d: any, from: string) => void>();
  const action = (ch: string) => {
    let a = actions.get(ch);
    if (!a) {
      const made = room.makeAction(ch) as unknown as { send: (d: unknown, o?: { target?: string }) => Promise<void>; onMessage: unknown };
      made.onMessage = (d: unknown, ctx: { peerId: string }) => handlers.get(ch)?.(d, ctx.peerId);
      a = made;
      actions.set(ch, a);
    }
    return a;
  };
  const joinCbs: Array<(id: string) => void> = [];
  const leaveCbs: Array<(id: string) => void> = [];
  const peers = new Set<string>();
  room.onPeerJoin = (id) => { peers.add(id); for (const cb of joinCbs) cb(id); };
  room.onPeerLeave = (id) => { peers.delete(id); for (const cb of leaveCbs) cb(id); };
  let streamCb: ((s: MediaStream, id: string) => void) | null = null;
  room.onPeerStream = (s, id) => streamCb?.(s, id);
  return {
    selfId,
    send: (ch, data, to) => { void action(ch).send(data, to ? { target: to } : undefined).catch(() => { /* peer gone */ }); },
    on: (ch, cb) => { handlers.set(ch, cb); action(ch); },
    onPeerJoin: (cb) => { joinCbs.push(cb); },
    onPeerLeave: (cb) => { leaveCbs.push(cb); },
    leave: () => { void room.leave(); },
    peers: () => [...peers],
    addStream: (s) => { room.addStream(s); },
    onPeerStream: (cb) => { streamCb = cb; },
  };
}
