// The DED (data entry display), 5 lines of 24 characters, showing the CNI page: the default page of the upfront
// controls (TO 1F-16CMAM-34-1-1 BMS, 2.1.1 "DED/CNI"). The other DED pages come with the ICP.
export const DED_COLS = 24;

export interface DedData {
  uhf: string; vhf: string; stpt: number; time: string; iff: string; tacan: string;
}

export function dedLines(d: DedData): string[] {
  const pad = (s: string) => s.slice(0, DED_COLS).padEnd(DED_COLS, ' ');
  return [
    pad(`UHF  ${d.uhf}   STPT \u0018${String(d.stpt).padStart(2, ' ')}`),
    pad(`               ${d.time}`),
    pad(`VHF  ${d.vhf}`),
    pad(''),
    pad(`${d.iff}  ${d.tacan}`),
  ];
}

export function drawDed(ctx: CanvasRenderingContext2D, W: number, H: number, lines: string[] | null, brt: number) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!lines || brt <= 0.01) return;
  const ch = W / DED_COLS, lh = H / 5;
  ctx.font = `bold ${Math.round(lh * 0.8)}px "Courier New", monospace`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = `rgba(80,255,120,${Math.min(1, 0.3 + brt)})`;
  lines.forEach((l, r) => { for (let c = 0; c < l.length; c++) ctx.fillText(l[c] === '\u0018' ? '▲' : l[c], c * ch, (r + 0.5) * lh); });
}
