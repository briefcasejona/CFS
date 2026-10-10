// Instant Action scenarios are authored in the Varnia frame. For other theaters the whole spec is rotated and
// translated onto the theater's engagement anchor (enemy direction = anchor.enemyHdg), airbase ids are mapped to the
// anchor's blue/red bases, and runway-relative patterns are re-based on the new runway.
import type { MissionSpec } from './mission.js';
import type { Theater } from '../world/theater.js';
import { VARNIA } from '../world/theaters/varnia.js';

const A0 = { x: 10000, z: 70000 }; // Varnia engagement area (enemy to the north, heading 0)
const D2R = Math.PI / 180;

export function adaptSpecToTheater(spec: MissionSpec, t: Theater): MissionSpec {
  const out: MissionSpec = JSON.parse(JSON.stringify(spec));
  out.theaterId = t.id;
  if (t.id === VARNIA.id || !t.iaAnchor) return out;
  const a = t.iaAnchor;
  const B = a.enemyHdg * D2R, c = Math.cos(B), s = Math.sin(B);
  const rot = (x: number, z: number) => { const dx = x - A0.x, dz = z - A0.z; return { x: a.x + dx * c - dz * s, z: a.z + dx * s + dz * c }; };
  const oldBase = (id: string) => VARNIA.airbases.find((b) => b.id === id);
  const mapBase = (id: string) => { const ab = oldBase(id); return ab ? (ab.side === 'blue' ? a.blueBase : a.redBase) : id; };
  const newBase = (id: string) => t.airbases.find((b) => b.id === id)!;
  const wrap = (h: number) => ((h % 360) + 360) % 360;

  for (const f of out.flights) {
    const runwayFrom = f.start.kind === 'runway' ? oldBase(f.start.airbaseId) : undefined;
    if (f.start.kind === 'air') {
      const p = rot(f.start.x, f.start.z);
      f.start = { ...f.start, x: p.x, z: p.z, hdg: wrap(f.start.hdg + a.enemyHdg) };
    } else {
      f.start = { kind: 'runway', airbaseId: mapBase(f.start.airbaseId) };
    }
    if (f.waypoints) {
      if (runwayFrom) {
        // pattern around the departure runway: keep it relative to that runway
        const to = newBase((f.start as { airbaseId: string }).airbaseId);
        const r = (to.hdg - runwayFrom.hdg) * D2R, rc = Math.cos(r), rs = Math.sin(r);
        f.waypoints = f.waypoints.map((w) => {
          const dx = w.x - runwayFrom.x, dz = w.z - runwayFrom.z;
          return { ...w, x: to.x + dx * rc - dz * rs, z: to.z + dx * rs + dz * rc, alt: w.alt + to.elev };
        });
      } else f.waypoints = f.waypoints.map((w) => ({ ...w, ...rot(w.x, w.z) }));
    }
    if (f.station) f.station = { ...f.station, ...rot(f.station.x, f.station.z) };
    if (f.stationHdg !== undefined) f.stationHdg = wrap(f.stationHdg + a.enemyHdg);
    f.homeBase = mapBase(f.homeBase);
  }
  for (const g of out.groups) {
    if (g.kind === 'airbase' && g.objectiveId) {
      const nb = newBase(mapBase(g.objectiveId));
      g.objectiveId = nb.id; g.x = nb.x; g.z = nb.z; g.name = nb.name;
    } else {
      const p = rot(g.x, g.z);
      g.x = p.x; g.z = p.z;
      if (g.heading !== undefined) g.heading += B;
    }
  }
  out.briefing = `${out.briefing} (${t.name})`;
  return out;
}
