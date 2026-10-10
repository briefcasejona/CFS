// Seeded 2D gradient noise + fractal sums used by procedural terrain and terrain shading.
import { rng } from '../core/math.js';

const PERM = new Uint8Array(512);
{
  const r = rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1, -1];
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }

export function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const h00 = PERM[X + PERM[Y]] & 7, h10 = PERM[X + 1 + PERM[Y]] & 7;
  const h01 = PERM[X + PERM[Y + 1]] & 7, h11 = PERM[X + 1 + PERM[Y + 1]] & 7;
  const n00 = GX[h00] * xf + GY[h00] * yf;
  const n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
  const n01 = GX[h01] * xf + GY[h01] * (yf - 1);
  const n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
  const u = fade(xf), v = fade(yf);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

export function fbm(x: number, y: number, oct: number) {
  let a = 0, f = 1, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) { a += noise2(x * f, y * f) * amp; norm += amp; f *= 2.03; amp *= 0.5; }
  return a / norm;
}

export function ridged(x: number, y: number, oct: number) {
  let a = 0, f = 1, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) { a += (1 - Math.abs(noise2(x * f + 31.7, y * f - 12.1))) * amp; norm += amp; f *= 2.1; amp *= 0.5; }
  return a / norm;
}
