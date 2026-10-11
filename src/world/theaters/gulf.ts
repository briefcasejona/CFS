// Real-world Persian Gulf theater (Kuwait, southern Iraq, north-eastern Saudi Arabia, Bahrain): heights from the baked
// DEM (assets/theaters/gulf, AWS Terrain Tiles), Lambert Conformal Conic frame centred 29.5°N 47.5°E.
// Historical setting: Operation Desert Storm, January–February 1991 — the Coalition (BLUE) operates from Saudi Arabia,
// Bahrain and a carrier in the northern Gulf against Iraq (RED), which occupies Kuwait. Positions are approximate.
import { DemGrid, type AbRow, type ObjRow } from '../demTheater.js';
import type { Theater } from '../theater.js';

const DEM = new DemGrid({ proj: { lat0: 29.5, lon0: 47.5, lat1: 26, lat2: 33 }, half: 600000, res: 1000, asset: 'gulf' });
export const gulfLcc = DEM.lcc;

const AB: AbRow[] = [
  // Coalition (blue)
  ['kkmc', 'King Khalid Military City (SA)', 'blue', 27.901, 45.528, 154, 3700],
  ['qaysumah', 'Al Qaysumah / Hafar Al Batin (SA)', 'blue', 28.335, 46.125, 164, 3000],
  ['mishab', 'Ras Al Mishab (SA)', 'blue', 28.079, 48.611, 170, 2100],
  ['dhahran', 'Dhahran AB (SA)', 'blue', 26.265, 50.152, 161, 3660],
  ['isa', 'Shaikh Isa AB (BH)', 'blue', 25.918, 50.591, 148, 3800],
  // Iraq (red), including occupied Kuwait
  ['ali_al_salem', 'Ali Al Salem AB (KW, occupied)', 'red', 29.347, 47.521, 117, 2900],
  ['ahmed_al_jaber', 'Ahmed Al Jaber AB (KW, occupied)', 'red', 28.935, 47.792, 153, 3000],
  ['shaibah', 'Shaibah AB (IQ)', 'red', 30.421, 47.662, 117, 3000],
  ['jalibah', 'Jalibah SE AB (IQ)', 'red', 30.590, 46.586, 130, 3000],
  ['tallil', 'Tallil AB (IQ)', 'red', 30.936, 46.090, 117, 3700],
];

const OBJ: ObjRow[] = [
  ['r_kuwait_hq', 'Iraqi HQ, Kuwait City', 'command', 'red', 29.37, 47.98, 8],
  ['r_umm_qasr', 'Umm Qasr naval base', 'command', 'red', 30.03, 47.95, 6],
  ['r_basra_depot', 'Basra fuel depot', 'depot', 'red', 30.48, 47.82, 7],
  ['r_rg_depot', 'Republican Guard logistics', 'depot', 'red', 30.10, 47.05, 7],
  ['r_nasiriyah', 'An Nasiriyah bridge (Euphrates)', 'bridge', 'red', 31.04, 46.26, 6],
  ['r_ewr', 'Early-warning radar Safwan', 'radar', 'red', 30.12, 47.72, 5],
  ['r_sa2_basra', 'SA-2 Basra', 'sam', 'red', 30.55, 47.75, 5, 'SA-2'],
  ['r_sa6_tallil', 'SA-6 Tallil', 'sam', 'red', 30.95, 46.15, 5, 'SA-6'],
  ['r_sa6_kuwait', 'SA-6 Kuwait', 'sam', 'red', 29.30, 47.65, 5, 'SA-6'],
  ['b_kkmc_depot', 'KKMC supply depot', 'depot', 'blue', 27.95, 45.60, 7],
  ['b_dhahran_port', 'Dhahran port', 'depot', 'blue', 26.45, 50.10, 7],
  ['b_ras_tanura', 'Ras Tanura oil terminal', 'factory', 'blue', 26.64, 50.16, 6],
  ['b_patriot', 'Patriot Dhahran', 'sam', 'blue', 26.30, 50.08, 6, 'Patriot'],
  ['b_hawk', 'Hawk Khafji', 'sam', 'blue', 28.40, 48.45, 4, 'Hawk'],
];

export const GULF: Theater = {
  id: 'gulf',
  name: 'Persian Gulf 1991',
  description: 'Real terrain of Kuwait, southern Iraq and north-eastern Saudi Arabia (1 km DEM). Desert Storm setting: Coalition vs Iraq.',
  half: DEM.cfg.half,
  factions: { blue: 'Coalition', red: 'Iraq' },
  nations: { blue: ['us', 'sa', 'uk', 'fr', 'kw'], red: ['iq'] },
  rawHeight: DEM.rawHeight,
  airbases: DEM.airbases(AB),
  objectives: DEM.objectives(OBJ),
  // northern Gulf, steaming up the Gulf
  carriers: [{ id: 'cvn71', name: 'USS Theodore Roosevelt (CVN-71)', side: 'blue', ...gulfLcc.forward(27.9, 49.9), hdg: 310, speedKt: 15 }],
  sectors: 8,
  initialFront: [0, 0, 0, 0, 0, 0, 0, 0],
  campaign: false,
  // winter snow only on the high Zagros; sabkha flats along the coast
  palette: { beach: 4, snowLine: () => 3000, rockBelowSnow: 1200, style: 'desert', trees: false },
  // Instant Action engagement area: over the Saudi–Kuwaiti border, Iraq to the north
  iaAnchor: { ...gulfLcc.forward(28.7, 47.2), enemyHdg: 10, blueBase: 'qaysumah', redBase: 'ali_al_salem' },
  load: () => DEM.load(GULF),
};

/** Install the height grid (tests read it from disk). */
export function setGulfGrid(g: Int16Array) { DEM.setGrid(g, GULF); }
