// Real-world Europe theater: heights from the baked DEM (assets/theaters/europe, AWS Terrain Tiles), Lambert Conformal
// Conic frame centred 52°N 10°E. Hypothetical scenario: NATO (BLUE) vs an eastern OPFOR (RED) based in Kaliningrad and
// western Belarus. Airfields are real military fields (positions/runways approximate).
import { DemGrid, type AbRow, type ObjRow } from '../demTheater.js';
import type { Theater } from '../theater.js';

export const EUROPE_PROJ = { lat0: 52, lon0: 10, lat1: 47, lat2: 57 };
const DEM = new DemGrid({ proj: EUROPE_PROJ, half: 1150000, res: 1000, asset: 'europe', cover: 1000 });
export const europeLcc = DEM.lcc;

const AB: AbRow[] = [
  // NATO (blue)
  ['volkel', 'Volkel AB (NL)', 'blue', 51.656, 5.709, 60, 3020],
  ['leeuwarden', 'Leeuwarden AB (NL)', 'blue', 53.228, 5.760, 59, 2700],
  ['kleinebrogel', 'Kleine-Brogel AB (BE)', 'blue', 51.168, 5.470, 49, 3000],
  ['florennes', 'Florennes AB (BE)', 'blue', 50.243, 4.646, 77, 3370],
  ['spangdahlem', 'Spangdahlem AB (US)', 'blue', 49.973, 6.692, 50, 3050],
  ['ramstein', 'Ramstein AB (US)', 'blue', 49.437, 7.600, 82, 3200],
  ['norvenich', 'Nörvenich AB (DE)', 'blue', 50.831, 6.658, 70, 2450],
  ['wittmund', 'Wittmundhafen AB (DE)', 'blue', 53.548, 7.667, 80, 2440],
  ['laage', 'Rostock-Laage AB (DE)', 'blue', 53.918, 12.279, 100, 2500],
  ['neuburg', 'Neuburg AB (DE)', 'blue', 48.711, 11.212, 90, 2440],
  ['lakenheath', 'RAF Lakenheath (US)', 'blue', 52.409, 0.561, 60, 2740],
  ['coningsby', 'RAF Coningsby (UK)', 'blue', 53.093, -0.166, 70, 2740],
  ['marham', 'RAF Marham (UK)', 'blue', 52.648, 0.551, 60, 2780],
  ['lossiemouth', 'RAF Lossiemouth (UK)', 'blue', 57.705, -3.339, 50, 2770],
  ['stdizier', 'Saint-Dizier AB (FR)', 'blue', 48.636, 4.899, 110, 2400],
  ['nancy', 'Nancy-Ochey AB (FR)', 'blue', 48.583, 5.955, 40, 2400],
  ['skrydstrup', 'Skrydstrup AB (DK)', 'blue', 55.226, 9.264, 110, 3000],
  ['rygge', 'Rygge AB (NO)', 'blue', 59.379, 10.786, 120, 2440],
  ['satenas', 'Såtenäs AB (SE)', 'blue', 58.426, 12.714, 10, 2500],
  ['ronneby', 'Ronneby AB (SE)', 'blue', 56.267, 15.265, 10, 2330],
  ['krzesiny', 'Poznań-Krzesiny AB (PL)', 'blue', 52.332, 16.966, 110, 2500],
  ['lask', 'Łask AB (PL)', 'blue', 51.552, 19.179, 70, 2500],
  ['malbork', 'Malbork AB (PL)', 'blue', 54.027, 19.134, 70, 2400],
  // OPFOR (red) — hypothetical
  ['chkalovsk', 'Chkalovsk AB (RU)', 'red', 54.766, 20.396, 60, 2500],
  ['donskoye', 'Donskoye NAS (RU)', 'red', 54.940, 19.970, 90, 2200],
  ['lida', 'Lida AB (BY)', 'red', 53.877, 25.270, 110, 2500],
];

const OBJ: ObjRow[] = [
  ['r_klgport', 'Kaliningrad port & depots', 'depot', 'red', 54.70, 20.45, 7],
  ['r_baltiysk', 'Baltiysk naval base', 'command', 'red', 54.64, 19.90, 8],
  ['r_s400', 'Long-range SAM Kaliningrad (as SA-10)', 'sam', 'red', 54.80, 20.60, 8, 'SA-10'],
  ['r_sa15', 'SA-15 Chkalovsk', 'sam', 'red', 54.75, 20.30, 4, 'SA-15'],
  ['r_grodno', 'Grodno rail hub', 'depot', 'red', 53.68, 23.83, 6],
  ['r_lidasam', 'SA-6 Lida', 'sam', 'red', 53.90, 25.10, 5, 'SA-6'],
  ['b_gdansk', 'Gdańsk port', 'depot', 'blue', 54.40, 18.66, 6],
  ['b_warsaw', 'Warsaw logistics hub', 'command', 'blue', 52.23, 21.01, 8],
  ['b_patriot', 'Patriot Rzeszów', 'sam', 'blue', 50.11, 22.02, 6, 'Patriot'],
  ['b_berlin', 'Berlin-Brandenburg airlift hub', 'depot', 'blue', 52.37, 13.50, 5],
];

export const EUROPE: Theater = {
  id: 'europe',
  name: 'Northern Europe',
  description: 'Real terrain from Brittany to Belarus and the Alps to southern Norway (1 km DEM). Hypothetical NATO vs eastern OPFOR scenario.',
  half: DEM.cfg.half,
  factions: { blue: 'NATO', red: 'OPFOR' },
  nations: { blue: ['nl', 'de', 'be', 'fr', 'uk', 'dk', 'no', 'se', 'pl', 'us'], red: ['ru', 'by'] },
  rawHeight: DEM.rawHeight,
  airbases: DEM.airbases(AB),
  objectives: DEM.objectives(OBJ),
  // central North Sea, steaming north-east
  carriers: [{ id: 'cvn75', name: 'USS Harry S. Truman (CVN-75)', side: 'blue', ...europeLcc.forward(54.6, 3.6), hdg: 30, speedKt: 15 }],
  sectors: 8,
  initialFront: [0, 0, 0, 0, 0, 0, 0, 0],
  campaign: false,
  // summer snowline ~3000 m in the Alps falling to ~1650 m in southern Norway; bare rock from ~800 m below it.
  // No sand band: low land here is polder and coastal plain (the 1 km grid can't resolve beaches).
  palette: {
    beach: 0,
    snowLine: (_x, z) => 3000 - (52 - z / 111000 - 46) * 95,
    rockBelowSnow: 800,
  },
  // Instant Action engagement area: over north-east Poland, enemy to the east-north-east
  iaAnchor: { ...europeLcc.forward(53.9, 21.4), enemyHdg: 75, blueBase: 'malbork', redBase: 'chkalovsk' },
  load: () => DEM.load(EUROPE),
};

/** Install the height grid (browser: fetched + gunzipped by EUROPE.load; tests: read from disk). */
export function setEuropeGrid(g: Int16Array) { DEM.setGrid(g, EUROPE); }
export function europeLoaded() { return !!DEM.grid; }
/** Install the landcover grid (tests: read from disk). */
export function setEuropeCover(c: Uint8Array) { DEM.setCover(c, EUROPE); }
