// Link-16-style datalink: each coalition shares one air picture built from every friendly radar (fighters, AWACS).
// Tracks age out when nobody refreshes them. Consumers: MFD HSD/FCR pages (off-board tracks), AI commit decisions.
import * as THREE from 'three';
import type { Aircraft } from '../sim/entities.js';
import type { Side } from '../aircraft/types.js';

export interface DlTrack {
  target: Aircraft;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  lastSeen: number;
  /** callsign of the platform that last reported it */
  source: string;
  /** reported by an AWACS (surveillance track) */
  awacs: boolean;
}

export const DL_UPDATE = 1.0;   // s between network updates
export const DL_STALE = 8.0;    // s until an unrefreshed track is dropped

export class Datalink {
  private tracks: Record<Side, Map<number, DlTrack>> = { blue: new Map(), red: new Map() };
  private timer = 0;

  /** Merge every friendly radar's fresh, radar-derived (non-IRST) contacts into the side's picture. */
  update(dt: number, now: number, aircraft: Aircraft[]) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = DL_UPDATE;
    for (const ac of aircraft) {
      if (!ac.active || !ac.radar || !ac.radar.emitting || ac.def.datalink === false) continue;
      const pic = this.tracks[ac.side];
      const awacs = ac.def.role === 'AEW&C';
      for (const c of ac.radar.contacts.values()) {
        if (c.irst || now - c.lastSeen > 2.5 || !c.target.active || c.target.side === ac.side) continue;
        const prev = pic.get(c.target.id);
        if (prev && prev.lastSeen >= c.lastSeen && !awacs) continue;
        pic.set(c.target.id, { target: c.target, pos: c.pos.clone(), vel: c.vel.clone(), lastSeen: c.lastSeen, source: ac.callsign, awacs });
      }
    }
    for (const side of ['blue', 'red'] as Side[]) {
      for (const [id, t] of this.tracks[side]) if (now - t.lastSeen > DL_STALE || !t.target.active) this.tracks[side].delete(id);
    }
  }

  /** The side's shared picture (optionally only tracks the given aircraft's own radar doesn't already hold). */
  picture(side: Side, exclude?: Aircraft): DlTrack[] {
    const list = [...this.tracks[side].values()];
    if (!exclude?.radar) return list;
    return list.filter((t) => !exclude.radar!.contacts.has(t.target.id));
  }

  has(side: Side, target: Aircraft) { return this.tracks[side].has(target.id); }
}
