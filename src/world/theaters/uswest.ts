// Real-world US West Coast theater: California, Oregon and Washington with Nevada, Idaho and the edges of Utah and
// Arizona inland. Heights from the baked DEM (assets/theaters/uswest, AWS Terrain Tiles; USGS 3DEP in the US),
// Lambert Conformal Conic frame centred 40.8°N 118.5°W. Training setting in the style of Red Flag: US forces (BLUE)
// against the aggressor squadrons (RED, hypothetical) based at Nellis, Fallon and Tonopah over the Nevada ranges.
// Airfields are real (positions/runways approximate).
import { DemGrid, type AbRow, type ObjRow } from '../demTheater.js';
import type { Theater } from '../theater.js';
import { CIVIL_FIELDS } from './civil.js';

export const USWEST_PROJ = { lat0: 40.8, lon0: -118.5, lat1: 34, lat2: 47 };
const DEM = new DemGrid({ proj: USWEST_PROJ, half: 960000, res: 1000, asset: 'uswest', cover: 1000, stream: true });
export const uswestLcc = DEM.lcc;

const AB: AbRow[] = [
  // US forces (blue)
  ['edwards', 'Edwards AFB', 'blue', 34.905, -117.884, 40, 4580],
  ['chinalake', 'NAWS China Lake', 'blue', 35.686, -117.692, 30, 3050],
  ['lemoore', 'NAS Lemoore', 'blue', 36.333, -119.952, 140, 4120],
  ['fresno', 'Fresno ANGB', 'blue', 36.776, -119.718, 110, 2830],
  ['miramar', 'MCAS Miramar', 'blue', 32.868, -117.142, 60, 3650],
  ['march', 'March ARB', 'blue', 33.881, -117.259, 140, 4110],
  ['pointmugu', 'NAS Point Mugu', 'blue', 34.120, -119.121, 30, 3350],
  ['vandenberg', 'Vandenberg SFB', 'blue', 34.737, -120.584, 150, 4570],
  ['travis', 'Travis AFB', 'blue', 38.263, -121.927, 210, 3350],
  ['beale', 'Beale AFB', 'blue', 39.136, -121.437, 150, 3660],
  ['kingsley', 'Kingsley Field ANGB', 'blue', 42.156, -121.733, 140, 3120],
  ['portland', 'Portland ANGB', 'blue', 45.589, -122.597, 100, 3350],
  ['mcchord', 'JBLM McChord Field', 'blue', 47.138, -122.476, 160, 3070],
  ['whidbey', 'NAS Whidbey Island', 'blue', 48.352, -122.656, 70, 2440],
  ['mountainhome', 'Mountain Home AFB', 'blue', 43.044, -115.872, 120, 4110],
  // Aggressors (red) — hypothetical adversary on the Nevada ranges
  ['nellis', 'Nellis AFB (aggressors)', 'red', 36.236, -115.034, 30, 3080],
  ['fallon', 'NAS Fallon (aggressors)', 'red', 39.417, -118.701, 130, 4210],
  ['tonopah', 'Tonopah Test Range (aggressors)', 'red', 37.795, -116.778, 140, 3660],
  ['creech', 'Creech AFB (aggressors)', 'red', 36.587, -115.673, 130, 2740],
];

const OBJ: ObjRow[] = [
  ['r_tolicha', 'Tolicha Peak EW site', 'radar', 'red', 37.29, -116.88, 6],
  ['r_tonopah_depot', 'Tonopah range depot', 'depot', 'red', 37.75, -116.70, 6],
  ['r_sa10', 'Long-range SAM NTTR (as SA-10)', 'sam', 'red', 37.55, -116.15, 8, 'SA-10'],
  ['r_sa6_north', 'SA-6 Cactus Flat', 'sam', 'red', 37.65, -116.55, 5, 'SA-6'],
  ['r_sa6_south', 'SA-6 Pahute Mesa', 'sam', 'red', 37.25, -116.40, 5, 'SA-6'],
  ['r_sa2', 'SA-2 Kawich', 'sam', 'red', 37.90, -116.25, 5, 'SA-2'],
  ['r_command', 'Range command post', 'command', 'red', 37.40, -116.10, 7],
  ['r_fallon_range', 'Bravo-17 range targets', 'depot', 'red', 39.20, -118.40, 5],
  ['b_edwards_depot', 'Edwards supply depot', 'depot', 'blue', 34.93, -117.90, 7],
  ['b_irwin', 'Fort Irwin logistics', 'command', 'blue', 35.26, -116.68, 7],
  ['b_patriot', 'Patriot Fort Irwin', 'sam', 'blue', 35.30, -116.60, 6, 'Patriot'],
  ['b_hawk', 'Hawk China Lake', 'sam', 'blue', 35.70, -117.60, 4, 'Hawk'],
];

export const USWEST: Theater = {
  id: 'uswest',
  name: 'US West Coast',
  description: 'Real terrain and satellite imagery from San Diego to the Canadian border, inland across Nevada and Idaho. Red Flag style setting: US forces vs the aggressor squadrons over the Nevada ranges.',
  half: DEM.cfg.half,
  factions: { blue: 'US Forces', red: 'Aggressors' },
  nations: { blue: ['us'], red: ['aggressor'] },
  rawHeight: DEM.rawHeight,
  stream: DEM.stream,
  airbases: DEM.airbases(AB),
  fields: DEM.fields(CIVIL_FIELDS.uswest ?? []),
  objectives: DEM.objectives(OBJ),
  // off southern California, steaming north-west along the coast
  carriers: [{ id: 'cvn71', name: 'USS Theodore Roosevelt (CVN-71)', side: 'blue', ...uswestLcc.forward(32.6, -118.3), hdg: 290, speedKt: 15 }],
  sectors: 8,
  initialFront: [0, 0, 0, 0, 0, 0, 0, 0],
  campaign: false,
  // summer snow only on the highest Sierra and Cascade peaks (~3600 m in the south falling to ~2400 m at the border)
  palette: {
    beach: 0,
    snowLine: (_x, z) => 3600 - Math.max(0, (40.8 - z / 111000) - 36) * 95,
    rockBelowSnow: 900,
    // the rain shadow: the Great Basin, the Mojave and the Columbia and Snake plains east of the Sierra and the Cascades
    arid: (x, z) => {
      const { lat, lon } = uswestLcc.inverse(x, z);
      // (the line where the mountains' wet side ends: Peninsular and Transverse Ranges, Tehachapi, Sierra, Cascades)
      const crest = lat < 33.8 ? -116.5 : lat < 34.3 ? -116.8 : lat < 35.3 ? -118.7 : lat < 36 ? -118.4
        : lat < 40 ? -118.4 - (lat - 36) / 4 * 2.2 : lat < 44 ? -120.6 - (lat - 40) / 4 * 0.8 : -121.4 + Math.min(1, (lat - 44) / 3) * 0.6;
      // the Rockies' foothills in Idaho and the Wasatch are greener again
      const east = lon > -114.5 && lat > 43.5 ? 0.4 : 1;
      return Math.max(0, Math.min(1, (lon - crest) / 0.6)) * east;
    },
  },
  // Instant Action engagement area: over the Nevada Test and Training Range, the aggressors to the east
  iaAnchor: { ...uswestLcc.forward(37.4, -117.2), enemyHdg: 80, blueBase: 'edwards', redBase: 'nellis' },
  geo: (x, z) => uswestLcc.inverse(x, z),
  load: () => DEM.load(USWEST),
};

/** Install the height grid (tests read it from disk). */
export function setUswestGrid(g: Int16Array) { DEM.setGrid(g, USWEST); }
/** Install the airfield elevation patches (tests: read from disk). */
export function setUswestPatches(index: Array<{ x0: number; z0: number; n: number; res: number }>, h: Int16Array) { DEM.setPatches(index, h, USWEST); }
