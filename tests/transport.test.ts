import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect } from './expect.js';
import { parseBlock, cellPolylines, buildRibbons, halfWidth, parseStations, MOTORWAY, RESIDENTIAL, RAILWAY, F_BRIDGE, type Polyline } from '../src/world/transport.js';
import { EUROPE, europeLcc } from '../src/world/theaters/europe.js';
import { GULF } from '../src/world/theaters/gulf.js';
import { USWEST, uswestLcc } from '../src/world/theaters/uswest.js';
import { setTheater, fieldsNear, terrainHeight, ALL_FIELDS } from '../src/world/theater.js';

const block = (rel: string) => { const b = gunzipSync(readFileSync(rel)); return parseBlock(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); };

describe('transport', () => {
  it('ribbons: two vertices a point, widths by class, bridges stay level', () => {
    const road: Polyline = { cls: MOTORWAY, flags: 0, pts: Float64Array.from([0, 0, 100, 0, 200, 0]) };
    const r = buildRibbons([road], 0, 0, 30, () => 5);
    const n = r.position.length / 3;
    expect(n % 2).toBe(0);
    expect(n).toBeGreaterThan(6);                       // resampled along the ground
    expect(r.index.length).toBe((n / 2 - 1) * 6);
    for (let k = 0; k < n; k++) { expect(r.position[k * 3 + 1]).toBeGreaterThan(5); expect(r.road[k * 4 + 2]).toBeCloseTo(halfWidth(MOTORWAY, 0), 3); }
    expect(halfWidth(MOTORWAY, 0)).toBeGreaterThan(halfWidth(RESIDENTIAL, 0));
    // a bridge over a valley runs straight between its ends instead of dipping
    const bridge: Polyline = { cls: MOTORWAY, flags: F_BRIDGE, pts: Float64Array.from([0, 0, 300, 0]) };
    const br = buildRibbons([bridge], 0, 0, 30, (x) => (x > 50 && x < 250 ? -40 : 10));
    for (let k = 0; k < br.position.length / 3; k++) expect(br.position[k * 3 + 1]).toBeGreaterThan(9);
  });

  it('Europe: the baked road blocks hold the motorways and railways around Volkel', () => {
    const ix = JSON.parse(readFileSync('assets/theaters/europe/roads/index.json', 'utf8'));
    expect(ix.attribution).toContain('OpenStreetMap');
    expect(ix.blocks.length).toBeGreaterThan(450);
    expect(ix.local.length).toBe(26);
    const g = europeLcc.forward(51.656, 5.709);
    const bi = Math.floor((g.x + ix.half) / ix.block), bj = Math.floor((g.z + ix.half) / ix.block);
    const b = block(`assets/theaters/europe/roads/major/${bi}_${bj}.bin.gz`);
    expect(b.cell).toBe(ix.cell);
    let roads = 0, rail = 0, motorway = 0;
    for (let j = 0; j < b.T; j++) for (let i = 0; i < b.T; i++) for (const p of cellPolylines(b, i, j)) {
      if (p.cls === RAILWAY) rail++; else roads++;
      if (p.cls === MOTORWAY) motorway++;
      // every piece starts in (or right beside) its own cell and stays inside the map
      expect(Math.abs(p.pts[0] - (b.x0 + (i + 0.5) * b.cell))).toBeLessThan(b.cell * 1.5 + 1);
      expect(Math.abs(p.pts[1] - (b.z0 + (j + 0.5) * b.cell))).toBeLessThan(b.cell * 1.5 + 1);
    }
    expect(roads).toBeGreaterThan(500);
    expect(rail).toBeGreaterThan(10);
    expect(motorway).toBeGreaterThan(10);
    // the streets of the airfield's own patch
    const loc = block('assets/theaters/europe/roads/local/volkel.bin.gz');
    let streets = 0;
    for (let j = 0; j < loc.T; j++) for (let i = 0; i < loc.T; i++) streets += cellPolylines(loc, i, j).length;
    expect(streets).toBeGreaterThan(1000);
    // only the map's own countries: nothing around Frankfurt or Madrid (terrain only there)
    for (const [lat, lon] of [[50.1, 8.68], [40.4, -3.7]]) {
      const p = europeLcc.forward(lat, lon);
      const k = `${Math.floor((p.x + ix.half) / ix.block)}_${Math.floor((p.z + ix.half) / ix.block)}`;
      expect(ix.blocks.some(([i, j]: [number, number]) => `${i}_${j}` === k), `road block at ${lat}, ${lon}`).toBe(false);
    }
  });

  it('US West Coast: roads and railways around Edwards, streets at Miramar', () => {
    const ix = JSON.parse(readFileSync('assets/theaters/uswest/roads/index.json', 'utf8'));
    expect(ix.local.length).toBe(19);
    const g = uswestLcc.forward(34.905, -117.884);
    const b = block(`assets/theaters/uswest/roads/major/${Math.floor((g.x + ix.half) / ix.block)}_${Math.floor((g.z + ix.half) / ix.block)}.bin.gz`);
    let roads = 0, rail = 0;
    for (let j = 0; j < b.T; j++) for (let i = 0; i < b.T; i++) for (const p of cellPolylines(b, i, j)) { if (p.cls === RAILWAY) rail++; else roads++; }
    expect(roads).toBeGreaterThan(100);
    expect(rail).toBeGreaterThan(5);
    const loc = block('assets/theaters/uswest/roads/local/miramar.bin.gz');
    let streets = 0;
    for (let j = 0; j < loc.T; j++) for (let i = 0; i < loc.T; i++) streets += cellPolylines(loc, i, j).length;
    expect(streets).toBeGreaterThan(1000);
  });

  it('stations sit on the map with a track heading', () => {
    for (const [id, min] of [['europe', 10000], ['gulf', 5], ['uswest', 300]] as const) {
      const f = `assets/theaters/${id}/roads/stations.json`;
      expect(existsSync(f)).toBeTruthy();
      const st = parseStations(JSON.parse(readFileSync(f, 'utf8')));
      expect(st.length).toBeGreaterThan(min);
      for (const s of st) { expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBeTruthy(); expect(s.hdg >= 0 && s.hdg <= 360).toBeTruthy(); }
    }
  });

  it('civil airfields: found by the spatial index, on flattened ground, clear of the mission airbases', () => {
    for (const th of [EUROPE, GULF, USWEST]) {
      setTheater(th.id);
      const fields = th.fields ?? [];
      expect(fields.length).toBeGreaterThan(th.id === 'europe' ? 250 : th.id === 'uswest' ? 120 : 20);
      for (const f of fields) {
        expect(fieldsNear(f.x, f.z).includes(f)).toBeTruthy();
        expect(ALL_FIELDS.includes(f)).toBeTruthy();
        // level along the strip
        const hr = f.hdg * Math.PI / 180, d = f.length * 0.4;
        const a = terrainHeight(f.x + Math.sin(hr) * d, f.z - Math.cos(hr) * d), c = terrainHeight(f.x - Math.sin(hr) * d, f.z + Math.cos(hr) * d);
        expect(Math.abs(a - c)).toBeLessThan(0.5);
        for (const ab of th.airbases) expect(Math.hypot(ab.x - f.x, ab.z - f.z)).toBeGreaterThan(5000);
      }
    }
    setTheater('varnia');
  });
});
