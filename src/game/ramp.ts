// Ramp parking: where a cold jet stands and the way from there to the runway. A field with a mapped layout parks
// its jets in the shelters or on the apron and taxis along its real taxiways; any other field uses the generic
// apron and parallel taxiway the airfield renderer draws.
import { apronSide, runwayEnds, type Airbase } from '../world/theater.js';

export interface Pt { x: number; z: number }
export interface RampPlan {
  /** parking position and heading (rad, grid) */
  spot: Pt & { hdg: number };
  /** centreline to follow, from the spot to the line-up point on the runway */
  route: Pt[];
  /** where to hold short of the runway */
  hold: Pt;
  /** total taxi distance (m) */
  length: number;
}

/** as drawn by render/airfield.ts */
export const GENERIC = { taxiOff: 180, apronNear: 190, apronFar: 440, apronLen: 0.45, connector: 0.44, spotOff: 265, spotGap: 36 };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);
const pathLen = (r: Pt[]) => r.reduce((s, p, k) => s + (k ? dist(p, r[k - 1]) : 0), 0);

/** runway-frame helper: along the heading from the centre, across to the apron side */
function frame(ab: Airbase) {
  const hr = ab.hdg * Math.PI / 180, S = apronSide(ab);
  const f = { x: Math.sin(hr), z: -Math.cos(hr) }, s = { x: Math.cos(hr) * S, z: Math.sin(hr) * S };
  return {
    hr, S,
    at: (along: number, across: number): Pt => ({ x: ab.x + f.x * along + s.x * across, z: ab.z + f.z * along + s.z * across }),
    along: (p: Pt) => (p.x - ab.x) * f.x + (p.z - ab.z) * f.z,
    across: (p: Pt) => (p.x - ab.x) * s.x + (p.z - ab.z) * s.z,
  };
}

/** The parking spot for the n-th jet of a flight (0 = lead) and its taxi route to the take-off end. */
export function rampPlan(ab: Airbase, n = 0): RampPlan {
  return (ab.layout ? mappedPlan(ab, n) : null) ?? genericPlan(ab, n);
}

function genericPlan(ab: Airbase, n: number): RampPlan {
  const F = frame(ab), G = GENERIC;
  const half = ab.length * G.apronLen / 2 - 40;
  // stands side by side along the apron, noses towards the taxiway; the lead nearest the take-off end
  const a0 = Math.max(-half, Math.min(half, -half + n * G.spotGap));
  const spot = F.at(a0, G.spotOff);
  const hdg = F.hr - F.S * Math.PI / 2;
  const conn = -ab.length * G.connector;
  const hold = F.at(conn, 75);
  const route = [spot, F.at(a0, G.taxiOff + 25), F.at(a0 - 25, G.taxiOff), F.at(conn + 25, G.taxiOff), F.at(conn, G.taxiOff - 25), hold, F.at(conn, 22), F.at(conn + 30, 0), F.at(conn + 90, 0)];
  return { spot: { ...spot, hdg }, route, hold, length: pathLen(route) };
}

/** A mapped field: park in a shelter (or on an apron) and search the taxiway network for the way to the runway. */
function mappedPlan(ab: Airbase, n: number): RampPlan | null {
  const L = ab.layout!;
  const F = frame(ab);
  // ---- the taxiway network: every polyline cut into short pieces, pieces of different taxiways joined where they meet
  const nodes: Array<Pt & { line: number }> = [];
  const edges: Array<Array<{ to: number; d: number }>> = [];
  const link = (a: number, b: number) => { const d = dist(nodes[a], nodes[b]); edges[a].push({ to: b, d }); edges[b].push({ to: a, d }); };
  L.taxiways.forEach((tw, line) => {
    let prev = -1;
    for (let i = 0; i < tw.pts.length; i++) {
      const p = tw.pts[i], q = tw.pts[i + 1];
      const steps = q ? Math.max(1, Math.ceil(dist(p, q) / 25)) : 1;
      for (let k = 0; k < (q ? steps : 1); k++) {
        const t = k / steps;
        nodes.push({ x: q ? p.x + (q.x - p.x) * t : p.x, z: q ? p.z + (q.z - p.z) * t : p.z, line });
        edges.push([]);
        if (prev >= 0) link(prev, nodes.length - 1);
        prev = nodes.length - 1;
      }
    }
  });
  if (nodes.length < 2) return null;
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    if (nodes[a].line !== nodes[b].line && dist(nodes[a], nodes[b]) < 32) link(a, b);
  }
  // ---- the goal: the taxiway node closest to the take-off end of the runway
  const ends = runwayEnds(ab);
  let goal = -1, gd = Infinity;
  nodes.forEach((p, k) => {
    const al = F.along(p) + ab.length / 2;   // metres from the threshold
    if (al < -150 || al > ab.length * 0.35) return;
    const d = Math.abs(F.across(p)) + Math.max(0, al) * 0.5;
    if (d < gd) { gd = d; goal = k; }
  });
  if (goal < 0 || gd > 400) return null;
  // ---- shortest paths from the goal to everywhere (Dijkstra; the network is small)
  const cost = new Array<number>(nodes.length).fill(Infinity), next = new Array<number>(nodes.length).fill(-1);
  const done = new Array<boolean>(nodes.length).fill(false);
  cost[goal] = 0;
  for (;;) {
    let u = -1;
    for (let k = 0; k < nodes.length; k++) if (!done[k] && (u < 0 || cost[k] < cost[u])) u = k;
    if (u < 0 || cost[u] === Infinity) break;
    done[u] = true;
    for (const e of edges[u]) if (cost[u] + e.d < cost[e.to]) { cost[e.to] = cost[u] + e.d; next[e.to] = u; }
  }
  // ---- parking: shelters first, then points on the aprons; each must reach the network
  const stands: Pt[] = [...L.shelters, ...L.aprons.map((poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, z: poly.reduce((s, p) => s + p.z, 0) / poly.length }))];
  const reach = stands.map((s) => {
    let best = -1, bd = Infinity;
    nodes.forEach((p, k) => { if (cost[k] < Infinity) { const d = dist(p, s); if (d < bd) { bd = d; best = k; } } });
    return { s, node: best, d: bd };
  }).filter((r) => r.node >= 0 && r.d < 160 && cost[r.node] > 300).sort((a, b) => cost[a.node] + a.d - (cost[b.node] + b.d));
  if (!reach.length) return null;
  const st = reach[n % reach.length];
  const route: Pt[] = [st.s];
  for (let k = st.node; k >= 0; k = next[k]) route.push(nodes[k]);
  // ---- from the last taxiway point on to the runway and lined up
  const g = nodes[goal];
  const al = Math.max(-ab.length / 2 + 30, Math.min(F.along(g), ab.length * 0.2));
  const ac = F.across(g);
  const hold = Math.abs(ac) > 80 ? F.at(al, Math.sign(ac) * 75) : g;
  if (Math.abs(ac) > 80) route.push(hold);
  route.push(F.at(al, Math.sign(ac) * 22), F.at(al + 30, 0), F.at(al + 90, 0));
  void ends;
  const first = route[1];
  return { spot: { ...st.s, hdg: Math.atan2(first.x - st.s.x, -(first.z - st.s.z)) }, route, hold, length: pathLen(route) };
}

/** Where along a route a point is: distance left to run, the next point to steer for, and how far off the line. */
export function routeProgress(route: Pt[], p: Pt) {
  let best = 0, bd = Infinity, bt = 0;
  for (let k = 0; k + 1 < route.length; k++) {
    const a = route[k], b = route[k + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
    if (d < bd) { bd = d; best = k; bt = t; }
  }
  const a = route[best], b = route[best + 1] ?? a;
  let left = dist(a, b) * (1 - bt);
  for (let k = best + 1; k + 1 < route.length; k++) left += dist(route[k], route[k + 1]);
  return { segment: best, off: bd, left, next: b };
}
