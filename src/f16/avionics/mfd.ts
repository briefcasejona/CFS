// The F-16's two multifunction displays (MFDS), from TO 1F-16CMAM-34-1-1 BMS (the Dash-34), 2.1.6.
//
// OSBs are numbered as in the Dash-34: 1 – 5 along the top from the left, 6 – 10 down the right side, 11 – 15 along
// the bottom from the right, 16 – 20 up the left side. OSB 12, 13 and 14 hold the three formats of the display;
// pressing the one already showing opens the MENU page (2.1.6.7), and OSB 15 is SWAP (2.1.6.9). The MENU page has
// the format mnemonics where the Dash-34 figure "MFDS – Menu page" puts them. A format whose system the game does not
// have (yet) shows the OFF page (2.1.6.8), as the Dash-34 does for a format that is not available.
export type Format = 'BLANK' | 'HAD' | 'RCCE' | 'RESET' | 'SMS' | 'HSD' | 'DTE' | 'TEST' | 'FLCS' | 'TCN' | 'TGP' | 'FCR'
  | 'WPN' | 'TFR' | 'FLIR' | 'MENU';

/** The MENU page: format per OSB (figure "MFDS – Menu page") */
export const MENU_OSB: Partial<Record<number, Format>> = {
  1: 'BLANK', 2: 'HAD', 4: 'RCCE', 5: 'RESET',
  6: 'SMS', 7: 'HSD', 8: 'DTE', 9: 'TEST', 10: 'FLCS',
  11: 'TCN',
  16: 'FLIR', 17: 'TFR', 18: 'WPN', 19: 'TGP', 20: 'FCR',
};
/** formats the game draws; the others show their OFF page */
const DRAWN = new Set<Format>(['BLANK', 'MENU', 'HSD', 'SMS', 'FLCS', 'TEST']);

export interface MfdState { slots: [Format, Format, Format]; sel: 0 | 1 | 2; menu: boolean }

export class Mfds {
  /** [left, right] */
  readonly mfd: [MfdState, MfdState] = [
    { slots: ['FCR', 'FLCS', 'TEST'], sel: 1, menu: false },
    { slots: ['SMS', 'HSD', 'TGP'], sel: 1, menu: false },
  ];

  shown(i: 0 | 1): Format { const m = this.mfd[i]; return m.menu ? 'MENU' : m.slots[m.sel]; }

  /** A press of OSB `osb` (1 … 20) on MFD `i`. */
  press(i: 0 | 1, osb: number) {
    const m = this.mfd[i];
    if (osb === 15) { const t = this.mfd[0]; this.mfd[0] = this.mfd[1]; this.mfd[1] = t; return; }   // SWAP (2.1.6.9)
    const slot = osb === 14 ? 0 : osb === 13 ? 1 : osb === 12 ? 2 : -1;
    if (slot >= 0) {
      // the format already showing opens the MENU page; another slot selects that format (2.1.6.7)
      if (m.sel === slot && !m.menu) m.menu = true;
      else { m.sel = slot as 0 | 1 | 2; m.menu = false; }
      return;
    }
    if (m.menu) {
      const f = MENU_OSB[osb];
      if (f) { m.slots[m.sel] = f; m.menu = false; }
    }
  }
}

export interface MfdData {
  powered: boolean;
  hdgDeg: number;
  /** steerpoints relative to the jet: east (x) and north (y) in NM, the current one marked */
  route: Array<{ e: number; n: number; cur: boolean }>;
  stores: Array<{ sta: number; name: string }>;
  gun: number;
  flcs: { run: boolean; fail: boolean; passed: boolean; secondsLeft: number };
  cautions: string[];
}

const AMBER = '#f5d300', GREEN = '#3cff6a', WHITE = '#e8ecef', CYAN = '#2bd6e6';

/** OSB label position on a `W`-px display: inside the screen next to button `osb` */
function osbPos(osb: number, W: number): [number, number, CanvasTextAlign] {
  const k = W / 5.6, e = W * 0.09;
  if (osb <= 5) return [k * (osb - 0.2), e, 'center'];
  if (osb <= 10) return [W - e * 0.4, k * (osb - 5.2), 'right'];
  if (osb <= 15) return [k * (15 - osb + 0.8), W - e, 'center'];
  return [e * 0.4, k * (21 - osb - 0.2), 'left'];
}

/** Draw MFD `i` (W px square). */
export function drawMfd(ctx: CanvasRenderingContext2D, W: number, mfds: Mfds, i: 0 | 1, d: MfdData) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
  if (!d.powered) return;
  const f = mfds.shown(i);
  const m = mfds.mfd[i];
  ctx.font = `bold ${Math.round(W / 22)}px "Courier New", monospace`;
  ctx.textBaseline = 'middle';
  const label = (osb: number, s: string, hi = false, color = AMBER) => {
    const [x, y, a] = osbPos(osb, W);
    ctx.textAlign = a;
    if (hi) {
      const w = ctx.measureText(s).width + 6, h = W / 20;
      const x0 = a === 'center' ? x - w / 2 : a === 'right' ? x - w : x;
      ctx.fillStyle = color; ctx.fillRect(x0 - 3, y - h / 2, w, h); ctx.fillStyle = '#000';
    } else ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  // bottom row: SWAP and the three format slots, the selected one highlighted
  label(15, 'SWAP');
  m.slots.forEach((s, k) => label(14 - k, s === 'BLANK' ? '' : s, k === m.sel));
  if (f === 'MENU') {
    for (const [osb, fm] of Object.entries(MENU_OSB)) label(+osb, fm === 'RESET' ? 'RESET' : fm!, fm === m.slots[m.sel]);
    return;
  }
  if (!DRAWN.has(f)) {
    ctx.fillStyle = AMBER; ctx.textAlign = 'center';
    ctx.fillText(`${f} OFF`, W / 2, W / 2);
    return;
  }
  if (f === 'HSD') drawHsd(ctx, W, d, label);
  else if (f === 'SMS') {
    label(1, 'NAV'); label(3, 'INV');
    ctx.fillStyle = AMBER; ctx.textAlign = 'left';
    ctx.fillText(`GUN ${d.gun}`, W * 0.2, W * 0.25);
    d.stores.forEach((s, k) => ctx.fillText(`${s.sta} ${s.name}`, W * 0.2, W * (0.33 + k * 0.06)));
  } else if (f === 'FLCS') {
    // FLCS page: BIT result (Dash-1 17.12: "BIT PASS" on the FLCS page of the MFD)
    label(5, 'BIT');
    ctx.fillStyle = d.flcs.fail ? AMBER : GREEN; ctx.textAlign = 'center';
    ctx.fillText(d.flcs.run ? `BIT RUN ${d.flcs.secondsLeft}` : d.flcs.fail ? 'BIT FAIL' : d.flcs.passed ? 'BIT PASS' : '', W / 2, W * 0.4);
  } else if (f === 'TEST') {
    ctx.fillStyle = AMBER; ctx.textAlign = 'left';
    ctx.fillText('MFL', W * 0.2, W * 0.25);
    d.cautions.slice(0, 8).forEach((c, k) => ctx.fillText(c, W * 0.2, W * (0.33 + k * 0.06)));
  }
}

/** HSD (2.1.6, Horizontal Situation Display): ownship at the centre, heading up, the route and steerpoints. */
function drawHsd(ctx: CanvasRenderingContext2D, W: number, d: MfdData, label: (osb: number, s: string) => void) {
  const rangeNm = 40;
  label(1, 'DEP'); label(3, 'CNTL'); label(20, String(rangeNm));
  const cx = W / 2, cy = W / 2, R = W * 0.4;
  ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5;
  for (const r of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * r, 0, Math.PI * 2); ctx.stroke(); }
  const h = d.hdgDeg * Math.PI / 180;
  const to = (e: number, n: number): [number, number] => {
    const x = e * Math.cos(h) - n * Math.sin(h), y = e * Math.sin(h) + n * Math.cos(h);
    return [cx + x / rangeNm * R, cy - y / rangeNm * R];
  };
  ctx.strokeStyle = WHITE; ctx.beginPath();
  d.route.forEach((p, k) => { const [x, y] = to(p.e, p.n); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  for (const p of d.route) {
    const [x, y] = to(p.e, p.n);
    ctx.fillStyle = p.cur ? WHITE : '#000'; ctx.strokeStyle = WHITE;
    ctx.beginPath(); ctx.arc(x, y, W / 60, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // ownship
  ctx.strokeStyle = CYAN; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy - W / 30); ctx.lineTo(cx, cy + W / 40); ctx.moveTo(cx - W / 40, cy); ctx.lineTo(cx + W / 40, cy); ctx.stroke();
}
