// F-16C/D cockpit controls, lights and gauges that the systems model drives.
// Layout and switch positions follow TO 1F-16CM/AM-1 (BMS), section 1 (panels) and the system chapters.
import type { ControlDef, GaugeDef, LightDef } from '../types.js';

const sw = (id: string, panel: string, label: string, positions: string[], hot: number, cold: number, extra: Partial<ControlDef> = {}): ControlDef =>
  ({ id, panel, label, positions, hot, cold, ...extra });
const btn = (id: string, panel: string, label: string, help?: string): ControlDef =>
  ({ id, panel, label, positions: ['', 'PRESS'], hot: 0, cold: 0, momentary: true, rest: 0, help });

export const F16_CONTROLS: ControlDef[] = [
  // ---- left console
  sw('mainPwr', 'ELEC', 'MAIN PWR', ['OFF', 'BATT', 'MAIN PWR'], 2, 0, { help: 'BATT: battery buses only. MAIN PWR: generators come on line when the engine turns them.' }),
  btn('elecReset', 'ELEC', 'CAUTION RESET', 'Resets the ELEC SYS caution light.'),
  sw('fuelMaster', 'FUEL', 'MASTER', ['OFF', 'MASTER'], 1, 1, { guard: true, help: 'Main fuel shutoff valve (takes 2–4 s to travel). The JFS gets fuel either way.' }),
  sw('engFeed', 'FUEL', 'ENG FEED', ['OFF', 'NORM', 'AFT', 'FWD'], 1, 1, { help: 'NORM: equal flow from both reservoirs. AFT / FWD: feed from one side to correct an imbalance.' }),
  sw('extFuelTrans', 'FUEL', 'EXT FUEL TRANS', ['NORM', 'WING FIRST'], 0, 0, { help: 'NORM empties the centerline tank first.' }),
  sw('airRefuel', 'FUEL', 'AIR REFUEL', ['CLOSE', 'OPEN'], 0, 0, { help: 'OPEN depressurises the external tanks: they stop transferring.' }),
  sw('jfs', 'ENG & JET START', 'JFS', ['OFF', 'START 1', 'START 2'], 0, 0, { help: 'START 2 uses both brake/JFS accumulators. Returns to OFF by itself at 50 % rpm on the ground.' }),
  sw('engCont', 'ENG & JET START', 'ENG CONT', ['PRI', 'SEC'], 0, 0, { guard: true, help: 'SEC: hydromechanical backup control. No afterburner, nozzle closed.' }),
  sw('throttleCutoff', 'ENG & JET START', 'THROTTLE', ['OFF', 'IDLE'], 1, 0, { help: 'OFF cuts ignition and fuel. Bring it to IDLE at 20 % rpm during the start.' }),
  sw('epu', 'EPU', 'EPU', ['OFF', 'NORM', 'ON'], 1, 0, { guard: true, help: 'NORM arms the automatic start. Leave it OFF until the engine is running.' }),
  sw('altFlaps', 'FLT CONTROL', 'ALT FLAPS', ['NORM', 'EXTEND'], 0, 0, { help: 'EXTEND lowers the trailing-edge flaps with the gear up.' }),
  btn('flcsPwrTest', 'TEST', 'FLCS PWR TEST', 'Closes the FLCS relays to check battery power to the flight-control computer.'),
  btn('epuGenTest', 'TEST', 'EPU/GEN TEST', 'On the ground: runs the EPU on bleed air only, without hydrazine.'),
  btn('malIndTest', 'TEST', 'MAL & IND LTS', 'Lights every warning, caution and indicator light.'),
  sw('probeHeat', 'TEST', 'PROBE HEAT', ['OFF', 'PROBE HEAT'], 1, 0),
  // ---- left auxiliary console
  sw('lgHandle', 'LANDING GEAR', 'LG HANDLE', ['UP', 'DN'], 1, 1, { help: 'Locked down with weight on wheels.' }),
  btn('altGear', 'LANDING GEAR', 'ALT GEAR', 'Blows the gear down with the pneumatic bottle. One shot.'),
  btn('hornSilencer', 'LANDING GEAR', 'HORN SILENCER'),
  sw('brakesChan', 'LANDING GEAR', 'BRAKES', ['CHAN 1', 'CHAN 2'], 0, 0, { help: 'CHAN 1 only works with the LG handle down.' }),
  sw('antiSkid', 'LANDING GEAR', 'ANTI-SKID', ['OFF', 'ANTI-SKID', 'PARKING BRAKE'], 1, 2, { help: 'PARKING BRAKE releases by itself when the throttle is advanced.' }),
  // ---- right console
  sw('airSource', 'ECS', 'AIR SOURCE', ['OFF', 'NORM', 'DUMP', 'RAM'], 1, 1, { help: 'OFF or RAM: no tank pressurisation (external fuel is trapped), no cockpit pressure, no avionics cooling.' }),
  sw('mmc', 'AVIONICS POWER', 'MMC', ['OFF', 'MMC'], 1, 0),
  sw('stSta', 'AVIONICS POWER', 'ST STA', ['OFF', 'ST STA'], 1, 0),
  sw('mfd', 'AVIONICS POWER', 'MFD', ['OFF', 'MFD'], 1, 0),
  sw('ufc', 'AVIONICS POWER', 'UFC', ['OFF', 'UFC'], 1, 0),
  sw('fcr', 'SNSR PWR', 'FCR', ['OFF', 'FCR'], 1, 0),
  sw('rwr', 'SNSR PWR', 'THREAT WARN', ['OFF', 'POWER'], 1, 0),
  // ---- seat and glareshield
  sw('seatArm', 'SEAT', 'EJECTION SAFETY LEVER', ['SAFE', 'ARMED'], 1, 0, { help: 'The seat will not fire while the lever is up (SAFE).' }),
  btn('masterCaution', 'GLARESHIELD', 'MASTER CAUTION', 'Press to reset.'),
  sw('fuelQtySel', 'FUEL QTY', 'FUEL QTY SEL', ['TEST', 'NORM', 'RSVR', 'INT WING', 'EXT WING', 'EXT CTR'], 1, 1, { help: 'Chooses what the AL and FR pointers show. Automatic forward transfer only works in NORM.' }),
];

const L = (id: string, panel: string, label: string, kind: LightDef['kind'], color?: LightDef['color']): LightDef => ({ id, panel, label, kind, color });

export const F16_LIGHTS: LightDef[] = [
  // glareshield warnings
  L('engine', 'GLARESHIELD', 'ENGINE', 'warning'),
  L('hydOil', 'GLARESHIELD', 'HYD/OIL PRESS', 'warning'),
  L('toLdgConfig', 'GLARESHIELD', 'TO/LDG CONFIG', 'warning'),
  L('masterCaution', 'GLARESHIELD', 'MASTER CAUTION', 'caution'),
  // caution light panel
  L('elecSys', 'CAUTION', 'ELEC SYS', 'caution'),
  L('sec', 'CAUTION', 'SEC', 'caution'),
  L('fwdFuelLow', 'CAUTION', 'FWD FUEL LOW', 'caution'),
  L('aftFuelLow', 'CAUTION', 'AFT FUEL LOW', 'caution'),
  L('equipHot', 'CAUTION', 'EQUIP HOT', 'caution'),
  L('cabinPress', 'CAUTION', 'CABIN PRESS', 'caution'),
  L('antiSkid', 'CAUTION', 'ANTI SKID', 'caution'),
  L('seatNotArmed', 'CAUTION', 'SEAT NOT ARMED', 'caution'),
  // ELEC panel
  L('flcsPmg', 'ELEC', 'FLCS PMG', 'indicator', 'amber'),
  L('mainGen', 'ELEC', 'MAIN GEN', 'indicator', 'amber'),
  L('stbyGen', 'ELEC', 'STBY GEN', 'indicator', 'amber'),
  L('epuGen', 'ELEC', 'EPU GEN', 'indicator', 'amber'),
  L('epuPmg', 'ELEC', 'EPU PMG', 'indicator', 'amber'),
  L('battToFlcs', 'ELEC', 'ACFT BATT TO FLCS', 'indicator', 'amber'),
  L('flcsRly', 'ELEC', 'FLCS RLY', 'indicator', 'amber'),
  L('battFail', 'ELEC', 'ACFT BATT FAIL', 'indicator', 'amber'),
  // start panel, EPU panel, test panel
  L('jfsRun', 'ENG & JET START', 'JFS RUN', 'indicator', 'green'),
  L('epuRun', 'EPU', 'EPU RUN', 'indicator', 'green'),
  L('hydrazn', 'EPU', 'HYDRAZN', 'indicator', 'amber'),
  L('epuAir', 'EPU', 'AIR', 'indicator', 'amber'),
  L('flcsPwr', 'TEST', 'FLCS PWR', 'indicator', 'green'),
  // landing gear panel
  L('wheelNose', 'LANDING GEAR', 'NOSE', 'indicator', 'green'),
  L('wheelLeft', 'LANDING GEAR', 'LEFT', 'indicator', 'green'),
  L('wheelRight', 'LANDING GEAR', 'RIGHT', 'indicator', 'green'),
  L('lgWarn', 'LANDING GEAR', 'LG HANDLE', 'warning'),
  L('nws', 'GLARESHIELD', 'AR/NWS', 'indicator', 'green'),
];

const G = (id: string, panel: string, label: string, unit: string, min: number, max: number, extra: Partial<GaugeDef> = {}): GaugeDef =>
  ({ id, panel, label, unit, min, max, ...extra });

export const F16_GAUGES: GaugeDef[] = [
  G('rpm', 'ENGINE', 'RPM', '%', 0, 110),
  G('ftit', 'ENGINE', 'FTIT', '°C', 200, 1200, { redAbove: 1000 }),
  G('nozzle', 'ENGINE', 'NOZ POS', '%', 0, 100),
  G('oil', 'ENGINE', 'OIL', 'psi', 0, 100, { redBelow: 10 }),
  G('fuelFlow', 'ENGINE', 'FUEL FLOW', 'pph', 0, 80000),
  G('hydA', 'HYD', 'HYD A', 'psi', 0, 4000, { redBelow: 1000 }),
  G('hydB', 'HYD', 'HYD B', 'psi', 0, 4000, { redBelow: 1000 }),
  G('epuFuel', 'EPU', 'EPU FUEL', '%', 0, 100),
  G('fuelTotal', 'FUEL QTY', 'TOTAL', 'lb', 0, 14000),
  G('fuelAL', 'FUEL QTY', 'AL', 'lb', 0, 4200),
  G('fuelFR', 'FUEL QTY', 'FR', 'lb', 0, 4200),
  G('cabinAlt', 'ECS', 'CABIN ALT', 'ft', 0, 50000),
];
