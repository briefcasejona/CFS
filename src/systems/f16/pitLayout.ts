// The F-16C cockpit as plates around the pilot's eye: side consoles, the auxiliary consoles either side of the
// centre pedestal, the glareshield eyebrows and the integrated control panel under the HUD. Panel positions follow
// TO 1F-16CM/AM-1 figure 1-5 (cockpit arrangement) as far as the sim's own panels allow.
import type { PitLayout } from '../pitLayout.js';

/** the main instrument panel leans back 13° */
const PANEL_N: [number, number, number] = [0, 0.23, 0.97], PANEL_UP: [number, number, number] = [0, 0.97, -0.23];
const UP: [number, number, number] = [0, 1, 0], FWD: [number, number, number] = [0, 0, -1];

export const F16_PIT: PitLayout = {
  plates: [
    {
      id: 'leftConsole', c: [-0.4, -0.755, -0.33], n: UP, up: FWD, w: 0.28, h: 0.5, fit: 0.3,
      rows: [
        ['t:ENG & JET START'],
        ['c:jfs', 'c:engCont', 'c:throttleCutoff', 'l:jfsRun'],
        ['t:EPU'],
        ['c:epu', 'l:epuRun', 'l:hydrazn', 'l:epuAir', 'g:epuFuel'],
        ['t:ELEC'],
        ['c:mainPwr*2', 'c:elecReset', 'l:flcsRly', 'l:battFail'],
        ['l:flcsPmg', 'l:mainGen', 'l:stbyGen', 'l:epuGen', 'l:epuPmg', 'l:battToFlcs'],
        ['t:FUEL'],
        ['c:fuelMaster', 'c:engFeed', 'c:extFuelTrans', 'c:airRefuel'],
        ['t:FLT CONTROL'],
        ['c:altFlaps', 'c:flcsReset', 'c:flcsBit', 'c:dbu', 'c:leFlaps', 'c:mpo'],
        ['l:bitRun', 'l:bitFail', '', ''],
        ['t:TEST'],
        ['c:flcsPwrTest', 'c:epuGenTest', 'c:malIndTest', 'c:probeHeat', 'l:flcsPwr'],
      ],
    },
    {
      id: 'rightConsole', c: [0.4, -0.755, -0.24], n: UP, up: FWD, w: 0.28, h: 0.32, fit: 0.3,
      rows: [
        ['t:SNSR PWR'],
        ['c:fcr', 'c:rwr', 'c:rdrAlt', ''],
        ['t:AVIONICS POWER'],
        ['c:mmc', 'c:stSta', 'c:mfd', 'c:ufc'],
        ['c:gps', 'c:dl', 'c:egi*2'],
        ['t:ECS  ·  SEAT'],
        ['c:airSource*2', 'g:cabinAlt', 'c:seatArm'],
      ],
    },
    {
      id: 'leftAux', c: [-0.36, -0.614, -0.726], n: PANEL_N, up: PANEL_UP, w: 0.16, h: 0.27, fit: 0.3,
      rows: [
        ['t:LANDING GEAR'],
        ['l:wheelNose', 'l:wheelLeft', 'l:wheelRight', 'l:lgWarn'],
        ['c:lgHandle*1.4', 'c:altGear', 'c:hornSilencer'],
        ['c:storesConfig', 'c:brakesChan', 'c:antiSkid'],
        ['t:MISC'],
        ['c:masterArm', 'c:apPitch', 'c:apRoll'],
      ],
    },
    {
      id: 'rightAux', c: [0.36, -0.614, -0.726], n: PANEL_N, up: PANEL_UP, w: 0.16, h: 0.27, fit: 0.3,
      rows: [
        ['t:CAUTION'],
        ['l:flcsFault', 'l:engineFault', 'l:avionicsFault'],
        ['l:elecSys', 'l:sec', 'l:equipHot'],
        ['l:fwdFuelLow', 'l:aftFuelLow', 'l:cabinPress'],
        ['l:antiSkid', 'l:seatNotArmed', ''],
        ['d:pfld'],
        ['t:FUEL QTY'],
        ['c:fuelQtySel', 'g:fuelTotal', 'g:fuelAL', 'g:fuelFR'],
        ['t:HYD PRESS'],
        ['g:hydA', 'g:hydB', ''],
      ],
    },
    {
      id: 'pedestal', c: [0, -0.62, -0.8], n: PANEL_N, up: PANEL_UP, w: 0.15, h: 0.125, fit: 0.3,
      rows: [
        ['t:ENGINE'],
        ['g:rpm', 'g:ftit', 'g:nozzle'],
        ['g:oil', 'g:fuelFlow', ''],
      ],
    },
    {
      id: 'eyebrowLeft', c: [-0.172, -0.28, -0.766], n: [0, 0.3, 0.954], up: [0, 0.954, -0.3], w: 0.112, h: 0.034, fit: 0.07,
      rows: [['c:masterCaution', 'l:masterCaution', 'c:fAck', 'l:nws']],
    },
    {
      id: 'eyebrowRight', c: [0.172, -0.237, -0.775], n: [0, 0.3, 0.954], up: [0, 0.954, -0.3], w: 0.112, h: 0.034, fit: 0.07,
      rows: [['l:engine', 'l:hydOil', 'l:flcsWarn'], ['l:dbuOn', 'l:toLdgConfig', '']],
    },
    {
      id: 'ded', c: [0.172, -0.282, -0.785], n: [0, 0.3, 0.954], up: [0, 0.954, -0.3], w: 0.112, h: 0.052, fit: 0.07,
      rows: [['d:ded']],
    },
    {
      id: 'icp', c: [0, -0.259, -0.677], n: [0, 0.35, 0.937], up: [0, 0.937, -0.35], w: 0.15, h: 0.088, fit: 0.12,
      rows: [
        ['c:icpCOM1', 'c:icpCOM2', 'c:icpIFF', 'c:icpLIST', 'c:icpAA', 'c:icpAG', 'c:icpWARN'],
        ['c:icpINC', 'c:icp1', 'c:icp2', 'c:icp3', 'c:icpRCL', 'c:icpUP'],
        ['c:icpDEC', 'c:icp4', 'c:icp5', 'c:icp6', 'c:icpENTR', 'c:icpDOWN'],
        ['c:icp7', 'c:icp8', 'c:icp9', 'c:icp0', 'c:icpRTN', 'c:icpSEQ'],
      ],
    },
  ],
  mfds: [
    { c: [-0.2, -0.52, -0.758], n: [0, 0.247, 0.969], w: 0.165, h: 0.165 },
    { c: [0.2, -0.52, -0.758], n: [0, 0.247, 0.969], w: 0.165, h: 0.165 },
  ],
};
