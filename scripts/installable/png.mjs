// Pure-JS PNG encoder + simple icon renderer (no native deps — works where sharp/canvas are blocked).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels (Uint8Array, w*h*4) as a PNG file buffer. */
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (s) => { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

// 5x7 pixel font for icon text (A–Z, 0–9)
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111', 0: '01110100011001110101110011000101110',
  1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110', 6: '00110010001000011110100011000101110',
  7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
};

/**
 * Render a square app icon.
 * opts: { size, background, foreground, text?, polygon? (array of [x,y] in 0..1), maskable? }
 * Supersampled 4x for anti-aliased edges.
 */
export function renderIcon(opts) {
  const { size, maskable = false } = opts;
  const bg = hex(opts.background ?? '#101820');
  const fg = hex(opts.foreground ?? '#7fd4ff');
  const SS = 4, S = size * SS;
  const cov = new Float32Array(size * size);   // foreground coverage
  const inBg = new Float32Array(size * size);  // background coverage (rounded square)
  const pad = maskable ? 0 : 0.06, rad = maskable ? 0 : 0.2;
  const safe = maskable ? 0.2 : 0.14;          // keep content inside the maskable safe zone
  const poly = opts.polygon;
  const text = (opts.text ?? '').toUpperCase().split('').filter((c) => FONT[c]);
  const cols = text.length ? text.length * 6 - 1 : 0;
  const cell = text.length ? (1 - 2 * safe) / Math.max(cols, 7 * 1.2) : 0;
  const tx0 = 0.5 - (cols * cell) / 2, ty0 = 0.5 - (7 * cell) / 2;
  const inside = (u, v) => {
    if (poly) {
      const px = (u - safe) / (1 - 2 * safe), py = (v - safe) / (1 - 2 * safe);
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
      }
      if (c) return true;
    }
    if (text.length) {
      const gx = Math.floor((u - tx0) / cell), gy = Math.floor((v - ty0) / cell);
      if (gy < 0 || gy >= 7 || gx < 0 || gx >= cols) return false;
      const ci = Math.floor(gx / 6), cx = gx % 6;
      if (cx === 5) return false;
      return FONT[text[ci]][gy * 5 + cx] === '1';
    }
    return false;
  };
  const inRounded = (u, v) => {
    const a = pad, b = 1 - pad;
    if (u < a || u > b || v < a || v > b) return false;
    const cx = Math.min(Math.max(u, a + rad), b - rad), cy = Math.min(Math.max(v, a + rad), b - rad);
    return (u - cx) ** 2 + (v - cy) ** 2 <= rad * rad;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const i = Math.floor(y / SS) * size + Math.floor(x / SS);
    if (inRounded(u, v)) { inBg[i] += 1; if (inside(u, v)) cov[i] += 1; }
  }
  const out = new Uint8Array(size * size * 4);
  const n = SS * SS;
  for (let i = 0; i < size * size; i++) {
    const a = inBg[i] / n, f = inBg[i] ? cov[i] / inBg[i] : 0;
    const shade = 1 + 0.25 * (1 - Math.floor(i / size) / size); // subtle vertical gradient
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(Math.min(255, bg[k] * shade) * (1 - f) + fg[k] * f);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return encodePng(size, size, out);
}
