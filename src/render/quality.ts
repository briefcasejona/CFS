// Graphics quality levels and the governor that holds 60 fps: Settings → Graphics quality picks a fixed level, or Auto,
// where the renderer measures its own frame times and steps the costly parts (forest range, distant tree clumps,
// sun shadows, render resolution) down while it falls short of the frame rate and back up when there is room.
// A fast PC stays at the top level; a laptop's integrated GPU trades detail for a smooth picture.

export interface QualityParams {
  /** full (layered) trees within this distance (m); simple crowns beyond */
  forestFull: number;
  /** trees within this distance cast sun shadows (m) */
  forestShadow: number;
  /** distant tree clumps: how far they are drawn (m) and the share of them drawn beyond 6 km */
  clumpReach: number;
  clumpFar: number;
  /** sun shadow map size */
  shadowMap: number;
  /** render resolution: the cap on the device pixel ratio */
  pixelRatio: number;
}

export const LEVELS: QualityParams[] = [
  { forestFull: 350, forestShadow: 0, clumpReach: 7000, clumpFar: 0.25, shadowMap: 1024, pixelRatio: 0.75 },
  { forestFull: 600, forestShadow: 250, clumpReach: 10000, clumpFar: 0.35, shadowMap: 2048, pixelRatio: 1 },
  { forestFull: 1000, forestShadow: 450, clumpReach: 13000, clumpFar: 0.6, shadowMap: 2048, pixelRatio: 1.25 },
  { forestFull: 1500, forestShadow: 700, clumpReach: 16000, clumpFar: 1, shadowMap: 4096, pixelRatio: 1.5 },
];
export const TOP = LEVELS.length - 1;
export const LEVEL_NAMES = ['Low', 'Medium', 'High', 'Ultra'];

/** the level in force (read by the forest, the far scenery and the renderer every frame) */
export const quality = { level: TOP, auto: true, get p(): QualityParams { return LEVELS[this.level]; }, version: 0 };

/** Settings → Graphics quality: 'auto' or a level index */
export function setQuality(q: 'auto' | number) {
  quality.auto = q === 'auto';
  const lv = quality.auto ? TOP : Math.max(0, Math.min(TOP, Math.round(q as number)));
  if (lv !== quality.level) { quality.level = lv; quality.version++; }
  gov.reset();
}

/** The governor: frame intervals over about 1.5 s. Below ~55 fps it steps down (at most every 2 s); after 20 s at the
 *  full rate it tries one level up, and if that level can't hold the rate it goes back and waits longer to try again. */
const TARGET_MS = 1000 / 55;
const gov = {
  last: 0, n: 0, sum: 0, good: 0, cool: 0, failedUp: -1, backoff: 20000,
  reset() { this.last = 0; this.n = 0; this.sum = 0; this.good = 0; this.cool = 0; this.failedUp = -1; this.backoff = 20000; },
};

/** call once per rendered frame */
export function qualityFrame(now = performance.now()) {
  if (!quality.auto) return;
  const dt = gov.last ? now - gov.last : 0;
  gov.last = now;
  // (a long gap is a paused tab or a loading hitch, not the steady rate)
  if (dt <= 0 || dt > 250) return;
  gov.cool = Math.max(0, gov.cool - dt);
  gov.n++; gov.sum += dt;
  if (gov.n < 90) return;
  const avg = gov.sum / gov.n;
  gov.n = 0; gov.sum = 0;
  if (avg > TARGET_MS && quality.level > 0 && gov.cool <= 0) {
    // just stepped up and it doesn't hold: back, and wait twice as long before trying that level again
    if (gov.failedUp === quality.level) gov.backoff = Math.min(300000, gov.backoff * 2);
    quality.level--; quality.version++;
    gov.good = 0; gov.cool = 2000;
    return;
  }
  if (avg <= TARGET_MS) gov.good += avg * 90; else gov.good = 0;
  if (gov.good > gov.backoff && quality.level < TOP) {
    quality.level++; quality.version++;
    gov.failedUp = quality.level; gov.good = 0; gov.cool = 3000;
  }
}

/** the time this frame may still spend building scenery (each builder checks it between steps) */
const work = { until: 0 };
export function startWork(ms: number) { work.until = performance.now() + ms; }
export function workLeft() { return performance.now() < work.until; }
