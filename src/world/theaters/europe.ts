// Real-world Western Europe theater: heights from the baked DEM (assets/theaters/europe, AWS Terrain Tiles), Lambert
// Conformal Conic frame centred 49.6°N 7°E, from Sicily to southern Norway and from Ireland's edge to Austria.
// The map's content (airbases, airports, roads, rail, buildings) covers France, Belgium, Luxembourg, Switzerland,
// Italy, the Netherlands, Austria, the UK, southern Norway and Denmark; the land in between (western Germany, …) is
// terrain only. Training setting: NATO (BLUE) against an aggressor squadron (RED, hypothetical) operating out of
// Sardinia and Corsica over the Decimomannu air-combat range. Airfields are real (positions/runways approximate).
import { DemGrid, type AbRow, type ObjRow } from '../demTheater.js';
import type { Theater } from '../theater.js';
import { CIVIL_FIELDS } from './civil.js';
import { leeuwardenLayout } from '../bases/leeuwarden.js';

export const EUROPE_PROJ = { lat0: 49.6, lon0: 7, lat1: 41, lat2: 57 };
const DEM = new DemGrid({ proj: EUROPE_PROJ, half: 1420000, res: 1000, asset: 'europe', cover: 1000, stream: true });
export const europeLcc = DEM.lcc;

const AB: AbRow[] = [
  // NATO (blue)
  ['volkel', 'Volkel AB (NL)', 'blue', 51.656, 5.709, 60, 3020],
  ['leeuwarden', 'Leeuwarden AB (NL)', 'blue', 53.228, 5.760, 59, 2700],
  ['kleinebrogel', 'Kleine-Brogel AB (BE)', 'blue', 51.168, 5.470, 49, 3000],
  ['florennes', 'Florennes AB (BE)', 'blue', 50.243, 4.646, 77, 3370],
  ['lakenheath', 'RAF Lakenheath (US)', 'blue', 52.409, 0.561, 60, 2740],
  ['coningsby', 'RAF Coningsby (UK)', 'blue', 53.093, -0.166, 70, 2740],
  ['marham', 'RAF Marham (UK)', 'blue', 52.648, 0.551, 60, 2780],
  ['lossiemouth', 'RAF Lossiemouth (UK)', 'blue', 57.705, -3.339, 50, 2770],
  ['stdizier', 'Saint-Dizier AB (FR)', 'blue', 48.636, 4.899, 110, 2400],
  ['nancy', 'Nancy-Ochey AB (FR)', 'blue', 48.583, 5.955, 40, 2400],
  ['montdemarsan', 'Mont-de-Marsan AB (FR)', 'blue', 43.912, -0.507, 90, 3600],
  ['istres', 'Istres-Le Tubé AB (FR)', 'blue', 43.524, 4.924, 150, 5000],
  ['skrydstrup', 'Skrydstrup AB (DK)', 'blue', 55.226, 9.264, 110, 3000],
  ['rygge', 'Rygge AB (NO)', 'blue', 59.379, 10.786, 120, 2440],
  ['aviano', 'Aviano AB (US)', 'blue', 46.032, 12.596, 50, 2650],
  ['ghedi', 'Ghedi AB (IT)', 'blue', 45.432, 10.268, 140, 2990],
  ['istrana', 'Istrana AB (IT)', 'blue', 45.685, 12.083, 70, 3000],
  ['cervia', 'Cervia AB (IT)', 'blue', 44.224, 12.307, 120, 2440],
  ['amendola', 'Amendola AB (IT)', 'blue', 41.541, 15.718, 110, 2830],
  ['gioia', 'Gioia del Colle AB (IT)', 'blue', 40.767, 16.933, 140, 3000],
  ['trapani', 'Trapani-Birgi AB (IT)', 'blue', 37.912, 12.488, 140, 2700],
  ['zeltweg', 'Zeltweg AB (AT)', 'blue', 47.203, 14.744, 80, 2500],
  ['payerne', 'Payerne AB (CH)', 'blue', 46.843, 6.915, 50, 2850],
  ['meiringen', 'Meiringen AB (CH)', 'blue', 46.743, 8.110, 100, 2000],
  // Aggressors (red) — a hypothetical training adversary on the Sardinian ranges
  ['decimomannu', 'Decimomannu AB (aggressors)', 'red', 39.354, 8.972, 170, 2990],
  ['solenzara', 'Solenzara AB (aggressors)', 'red', 41.924, 9.406, 180, 2500],
];

const OBJ: ObjRow[] = [
  ['r_capofrasca', 'Capo Frasca range targets', 'depot', 'red', 39.75, 8.46, 6],
  ['r_quirra', 'Salto di Quirra range HQ', 'command', 'red', 39.60, 9.63, 7],
  ['r_teulada', 'Capo Teulada range', 'depot', 'red', 38.97, 8.70, 5],
  ['r_ewr', 'Early-warning radar Sardinia', 'radar', 'red', 40.10, 9.20, 5],
  ['r_sa6', 'SA-6 Sardinia (threat emitter)', 'sam', 'red', 39.80, 9.05, 5, 'SA-6'],
  ['r_sa10', 'Long-range SAM Sardinia (as SA-10)', 'sam', 'red', 40.45, 9.35, 8, 'SA-10'],
  ['r_sa15', 'SA-15 Decimomannu', 'sam', 'red', 39.40, 8.90, 4, 'SA-15'],
  ['b_naples', 'Naples NATO command', 'command', 'blue', 40.83, 14.18, 8],
  ['b_laspezia', 'La Spezia naval base', 'depot', 'blue', 44.10, 9.83, 6],
  ['b_patriot', 'Patriot Rome', 'sam', 'blue', 41.80, 12.25, 6, 'Patriot'],
];

export const EUROPE: Theater = {
  id: 'europe',
  name: 'Western Europe',
  description: 'Real terrain and satellite imagery from Sicily to southern Norway: France, the Benelux, Switzerland, Italy, Austria, the UK and Denmark. Training setting: NATO vs an aggressor squadron on the Sardinian ranges.',
  half: DEM.cfg.half,
  factions: { blue: 'NATO', red: 'Aggressors' },
  nations: { blue: ['nl', 'be', 'fr', 'it', 'uk', 'dk', 'no', 'at', 'ch', 'us'], red: ['aggressor'] },
  rawHeight: DEM.rawHeight,
  stream: DEM.stream,
  airbases: DEM.airbases(AB).map((ab) => (ab.id === 'leeuwarden' ? { ...ab, layout: leeuwardenLayout((la, lo) => europeLcc.forward(la, lo)) } : ab)),
  fields: DEM.fields(CIVIL_FIELDS.europe),
  objectives: DEM.objectives(OBJ),
  // Tyrrhenian Sea between Sardinia and Naples, steaming north
  carriers: [{ id: 'cvn75', name: 'USS Harry S. Truman (CVN-75)', side: 'blue', ...europeLcc.forward(40.0, 11.6), hdg: 350, speedKt: 15 }],
  sectors: 8,
  initialFront: [0, 0, 0, 0, 0, 0, 0, 0],
  campaign: false,
  // summer snowline ~3200 m in the southern Alps falling to ~1500 m in southern Norway; bare rock from ~800 m below it.
  // No sand band: the 1 km grid can't resolve beaches (the imagery draws them).
  palette: {
    beach: 0,
    snowLine: (_x, z) => 3000 - (49.6 - z / 111000 - 46) * 95,
    rockBelowSnow: 800,
  },
  // Instant Action engagement area: over the Tyrrhenian Sea east of Sardinia, the aggressors to the south-west
  iaAnchor: { ...europeLcc.forward(40.6, 10.6), enemyHdg: 225, blueBase: 'aviano', redBase: 'decimomannu' },
  geo: (x, z) => europeLcc.inverse(x, z),
  load: () => DEM.load(EUROPE),
};

/** Install the height grid (browser: fetched + gunzipped by EUROPE.load; tests: read from disk). */
export function setEuropeGrid(g: Int16Array) { DEM.setGrid(g, EUROPE); }
export function europeLoaded() { return !!DEM.grid; }
/** Install the landcover grid (tests: read from disk). */
export function setEuropeCover(c: Uint8Array) { DEM.setCover(c, EUROPE); }
/** Install the airfield elevation patches (tests: read from disk). */
export function setEuropePatches(index: Array<{ x0: number; z0: number; n: number; res: number }>, h: Int16Array) { DEM.setPatches(index, h, EUROPE); }
