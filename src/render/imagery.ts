// Satellite imagery on the real-world terrain: Sentinel-2 cloudless (EOX) Web-Mercator tiles streamed around the
// camera into four nested levels (≈12 m, 47 m, 190 m and 750 m per pixel at 53°N), and over them two levels of aerial
// photographs (≈3 m and 1.6 m per pixel; the sources are 0.2–1 m) where a country publishes open orthophotos as Web
// Mercator tiles (AERIAL below; which service covers which ground is baked into assets/theaters/<id>/imagery.json by
// scripts/terrain/bake-imagery-regions.mjs). Each level is a toroidal 8×8 tile cache in one texture, so moving only
// replaces the tiles that scrolled out; the ground shader picks the finest level that has the tile, fading between
// levels at their edges. Relief comes from the DEM (the terrain mesh), the colour from the imagery; the procedural
// ground stays underneath wherever a tile isn't there (yet).
import * as THREE from 'three';

export const IMAGERY_ATTRIBUTION = 'Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)';
const URL = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/${z}/${y}/${x}.jpg`;
const N = 8, TS = 256;
const ZOOMS = [7, 9, 11, 13, 15, 16];
/** the levels from here on are aerial photographs, fetched only where a service covers the tile */
const FIRST_AERIAL = 4;
/** colour gain per level: the Sentinel-2 mosaic is darker than the aerial photographs */
const GAIN = [1.3, 1.3, 1.3, 1.3, 1.08, 1.08];

/** Open orthophoto services (Web Mercator tiles), by the ids in imagery.json. */
export const AERIAL: Record<string, { url: (z: number, x: number, y: number) => string; credit: string }> = {
  usgs: { url: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`, credit: 'USGS The National Map: orthoimagery (NAIP), public domain' },
  ign: { url: (z, x, y) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`, credit: '© IGN – BD ORTHO, Licence Ouverte / Etalab 2.0' },
  pdok: { url: (z, x, y) => `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/${z}/${x}/${y}.jpeg`, credit: 'Beeldmateriaal Nederland / PDOK, CC BY 4.0' },
  swisstopo: { url: (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`, credit: '© swisstopo – SWISSIMAGE (open government data)' },
  basemapat: { url: (z, x, y) => `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`, credit: 'basemap.at orthophoto, CC BY 4.0' },
};

/** the baked map of which aerial service covers which ground (imagery.json) */
interface Regions { lat0: number; lon0: number; step: number; nx: number; ny: number; providers: string[]; cells: Uint8Array }
function unpackRegions(j: { lat0: number; lon0: number; step: number; nx: number; ny: number; providers: string[]; rows: number[][] }): Regions {
  const cells = new Uint8Array(j.nx * j.ny);
  j.rows.forEach((row, y) => { let x = 0; for (let k = 0; k < row.length; k += 2) { cells.fill(row[k], y * j.nx + x, y * j.nx + x + row[k + 1]); x += row[k + 1]; } });
  return { lat0: j.lat0, lon0: j.lon0, step: j.step, nx: j.nx, ny: j.ny, providers: j.providers, cells };
}
/** the aerial service for a whole tile: every sample in it that service's land or sea, and some of it land */
export function tileProvider(r: Regions, z: number, x: number, y: number): string | null {
  let found = 0;
  const s = 2 ** z;
  for (let b = 0; b <= 4; b++) for (let a = 0; a <= 4; a++) {
    const lon = (x + a / 4) / s * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + b / 4) / s))) * 180 / Math.PI;
    const cx = Math.floor((lon - r.lon0) / r.step), cy = Math.floor((r.lat0 - lat) / r.step);
    if (cx < 0 || cy < 0 || cx >= r.nx || cy >= r.ny) return null;
    const v = r.cells[cy * r.nx + cx];
    if (v === 0) continue;
    if (v === 255 || (found && v !== found)) return null;
    found = v;
  }
  return found ? r.providers[found - 1] : null;
}
const MAX_INFLIGHT = 8;

let enabled = true;
/** Settings → Satellite imagery (off: nothing is downloaded, the procedural ground is drawn) */
export function setImageryEnabled(on: boolean) { enabled = on; }

/** lat/lon (deg) → Web-Mercator unit square (x east 0..1 from 180°W, y south 0..1 from 85°N) */
export function mercator(lat: number, lon: number, out: { x: number; y: number }) {
  const f = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  out.x = (lon + 180) / 360;
  out.y = (1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2;
  return out;
}

class Level {
  readonly tex: THREE.DataTexture;
  readonly org: THREE.Vector3;       // window origin (tiles) and 2^z
  private slots: string[] = new Array(N * N).fill('');
  /** tiles that arrived and wait to be copied into the texture (a few a frame) */
  readonly arrived: Array<{ s: number; key: string; img: HTMLImageElement }> = [];
  /** @param mask the loaded-slot mask of all levels, N wide and N rows per level (one texture for all of them: some
   *  GPUs allow only 16 textures in a shader) */
  constructor(readonly z: number, readonly aerial: boolean, private readonly index: number, private readonly mask: THREE.DataTexture) {
    this.org = new THREE.Vector3(-1e9, -1e9, 2 ** z);
    // the window's texture lives on the GPU only: each tile is copied into its slot as it arrives (texSubImage2D),
    // never the whole 2048² texture at once (a full re-upload of an accelerated canvas stalls the GPU process)
    const t = new THREE.DataTexture(null, N * TS, N * TS, THREE.RGBAFormat);
    t.source.dataReady = false;
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    this.tex = t;
  }

  /** move the window to centre on (tx, ty); returns the tiles that now need loading, nearest first */
  recentre(tx: number, ty: number): Array<[number, number, number]> {
    const ox = Math.floor(tx - N / 2 + 0.5), oy = Math.floor(ty - N / 2 + 0.5);
    this.org.x = ox; this.org.y = oy;
    const need: Array<[number, number, number]> = [];
    const max = 2 ** this.z;
    for (let y = oy; y < oy + N; y++) for (let x = ox; x < ox + N; x++) {
      if (y < 0 || y >= max) continue;
      const xx = ((x % max) + max) % max;
      const key = `${this.z}/${xx}/${y}`;
      const s = this.slot(x, y);
      if (this.slots[s] === key || this.slots[s] === 'failed:' + key) continue;
      if (this.slots[s] !== 'pending:' + key) need.push([Math.hypot(x + 0.5 - tx, y + 0.5 - ty), x, y]);
    }
    return need.sort((a, b) => a[0] - b[0]);
  }

  slot(x: number, y: number) { return (((y % N) + N) % N) * N + (((x % N) + N) % N); }

  claim(x: number, y: number) {
    const max = 2 ** this.z, s = this.slot(x, y);
    const key = `${this.z}/${((x % max) + max) % max}/${y}`;
    this.slots[s] = 'pending:' + key;
    this.setMask(s, 0);
    return key;
  }

  /** a tile arrived: queue it for its slot if the slot still wants it */
  put(x: number, y: number, key: string, img: HTMLImageElement) {
    const s = this.slot(x, y);
    if (this.slots[s] !== 'pending:' + key) return;
    this.arrived.push({ s, key, img });
  }

  /** copy queued tiles into the texture (at most `max`); the mipmaps are regenerated once, after the last */
  upload(renderer: THREE.WebGLRenderer, max: number) {
    let n = 0;
    while (this.arrived.length && n < max) {
      const a = this.arrived.shift()!;
      if (this.slots[a.s] !== 'pending:' + a.key) continue;
      n++;
      this.slots[a.s] = a.key;
      const last = !this.arrived.length || n === max;
      this.tex.generateMipmaps = last;
      let img: HTMLImageElement | HTMLCanvasElement = a.img;
      if (img.naturalWidth !== TS || img.naturalHeight !== TS) {
        // (a service that answers with 512 px tiles: scaled to the slot)
        const c = document.createElement('canvas'); c.width = c.height = TS;
        c.getContext('2d')!.drawImage(img, 0, 0, TS, TS);
        img = c;
      }
      const src = new THREE.Texture(img);
      renderer.copyTextureToTexture(src, this.tex, null, new THREE.Vector2((a.s % N) * TS, Math.floor(a.s / N) * TS));
      this.tex.generateMipmaps = true;
      this.setMask(a.s, 255);
    }
    return n;
  }

  fail(x: number, y: number, key: string) {
    const s = this.slot(x, y);
    if (this.slots[s] === 'pending:' + key) this.slots[s] = 'failed:' + key;
  }

  private setMask(s: number, v: number) {
    (this.mask.image.data as Uint8Array)[(this.index * N * N + s) * 4] = v;
    this.mask.needsUpdate = true;
  }
}

/** Streams the tiles and owns the shader uniforms. */
export class Imagery {
  private readonly mask = (() => {
    const t = new THREE.DataTexture(new Uint8Array(N * N * ZOOMS.length * 4), N, N * ZOOMS.length, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  })();
  readonly levels = ZOOMS.map((z, i) => new Level(z, i >= FIRST_AERIAL, i, this.mask));
  private regions: Regions | null = null;
  private regionsFor = '';
  private aerialErrors = new Map<string, number>();
  private aerialOk = new Map<string, number>();
  readonly uniforms: Record<string, THREE.IUniform> = { uImgOn: { value: 0 }, uImgMask: { value: this.mask } };
  private inflight = 0;
  private ok = 0;
  private errors = 0;
  private queue: Array<{ lv: Level; x: number; y: number }> = [];
  /** set by the scene: the tiles are copied into the GPU textures with it */
  renderer: THREE.WebGLRenderer | null = null;
  private ready = new Set<Level>();
  private m = { x: 0, y: 0 };

  constructor() {
    this.levels.forEach((lv, i) => {
      this.uniforms[`uImg${i}`] = { value: lv.tex };
      this.uniforms[`uImgOrg${i}`] = { value: lv.org };
    });
  }

  /** `geo` turns game x/z into lat/lon; null (fictional theater) or disabled hides the imagery */
  update(cam: THREE.Vector3, geo: ((x: number, z: number) => { lat: number; lon: number }) | null, theaterId = '') {
    const on = enabled && !!geo && typeof document !== 'undefined' && !(this.errors > 12 && this.ok === 0);
    this.uniforms.uImgOn.value = on ? 1 : 0;
    if (!on || !geo) return;
    if (theaterId !== this.regionsFor) {
      // which aerial service covers which ground — optional: without it only the Sentinel-2 levels are drawn
      this.regionsFor = theaterId; this.regions = null;
      fetch(`assets/theaters/${theaterId}/imagery.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && this.regionsFor === theaterId) this.regions = unpackRegions(j); }).catch(() => { /* none */ });
    }
    const ll = geo(cam.x, cam.z);
    mercator(ll.lat, ll.lon, this.m);
    this.queue.length = 0;
    // coarse levels first: the whole view gets imagery quickly, the detail fills in under the aircraft
    for (const lv of this.levels) {
      if (lv.aerial && !this.regions) continue;   // (until the coverage map is in, nothing is known to exist)
      const s = 2 ** lv.z;
      for (const [, x, y] of lv.recentre(this.m.x * s, this.m.y * s)) this.queue.push({ lv, x, y });
    }
    while (this.inflight < MAX_INFLIGHT && this.queue.length) this.load(this.queue.shift()!);
    // the arrived tiles into their textures: a few a frame, coarse levels first
    if (this.renderer) {
      let budget = 4;
      for (const lv of this.levels) {
        if (budget <= 0) break;
        if (!lv.arrived.length) continue;
        if (!this.ready.has(lv)) { this.renderer.initTexture(lv.tex); this.ready.add(lv); }
        budget -= lv.upload(this.renderer, budget);
      }
    }
  }

  /** tiles loaded and failed so far, per service (for the benchmark page and debugging) */
  stats() {
    const out: Record<string, { ok: number; failed: number }> = { sentinel2: { ok: this.ok, failed: this.errors } };
    for (const p of Object.keys(AERIAL)) out[p] = { ok: this.aerialOk.get(p) ?? 0, failed: this.aerialErrors.get(p) ?? 0 };
    return out;
  }

  private load({ lv, x, y }: { lv: Level; x: number; y: number }) {
    const key = lv.claim(x, y);
    const [, tx, ty] = key.split('/').map(Number);
    let src: string;
    if (lv.aerial) {
      // aerial levels: only where an open orthophoto service covers the whole tile (and has kept working)
      const p = this.regions ? tileProvider(this.regions, lv.z, tx, ty) : null;
      if (!p || !AERIAL[p] || (this.aerialErrors.get(p) ?? 0) > 20) { lv.fail(x, y, key); return; }
      src = AERIAL[p].url(lv.z, tx, ty);
      this.inflight++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onload = () => { this.inflight--; this.aerialOk.set(p, (this.aerialOk.get(p) ?? 0) + 1); lv.put(x, y, key, img); };
      img.onerror = () => {
        this.inflight--;
        lv.fail(x, y, key);
        const n = (this.aerialErrors.get(p) ?? 0) + 1;
        this.aerialErrors.set(p, n);
        if (n === 21) console.warn(`Aerial imagery from ${p} unavailable; showing Sentinel-2 there.`);
      };
      img.src = src;
      return;
    }
    this.inflight++;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => { this.inflight--; this.ok++; lv.put(x, y, key, img); };
    img.onerror = () => {
      this.inflight--; this.errors++;
      lv.fail(x, y, key);
      if (this.errors === 13 && this.ok === 0) console.warn('Satellite imagery unavailable (tiles.maps.eox.at); drawing the procedural ground.');
    };
    img.src = URL(lv.z, tx, ty);
  }
}

/** GLSL for the ground shader: `vec3 imagery(vec3 base)` blends the finest available level over `base` */
export const IMAGERY_GLSL = `
uniform float uImgOn;
uniform sampler2D uImgMask;
${ZOOMS.map((_, i) => `uniform sampler2D uImg${i};\nuniform vec3 uImgOrg${i};`).join('\n')}
varying vec2 vMerc;
// one level: weight 0 outside its window or where its tile isn't loaded, and then nothing is fetched. Derivatives are
// taken once, outside the branches (vMerc's, scaled per level), so the branches may skip the fetches.
vec3 imgLevel(sampler2D tex, float level, vec3 org, vec2 dmx, vec2 dmy, out float w) {
  vec2 t = vMerc * org.z;
  vec2 l = t - org.xy;
  vec2 e = min(l, ${N}.0 - l);
  w = clamp(min(e.x, e.y) * 1.2, 0.0, 1.0);
  if (w <= 0.0) return vec3(0.0);
  vec2 uv = t / ${N}.0;
  vec2 f = fract(uv);
  float m = textureLod(uImgMask, vec2(f.x, (min(f.y, 0.9999) + level) / ${ZOOMS.length}.0), 0.0).r;
  if (m < 0.5) { w = 0.0; return vec3(0.0); }
  float k = org.z / ${N}.0;
  return textureGrad(tex, f, dmx * k, dmy * k).rgb;
}
vec3 imagery(vec3 base, out float cov) {
  cov = 0.0;
  if (uImgOn < 0.5) return base;
  vec2 dmx = dFdx(vMerc), dmy = dFdy(vMerc);
  // finest level first; each coarser one only fills what the finer ones left (stops once the ground is covered)
  vec3 acc = vec3(0.0);
  float rem = 1.0, w;
${ZOOMS.map((_, i) => i).reverse().map((i) => `  if (rem > 0.004) { vec3 s = imgLevel(uImg${i}, ${i}.0, uImgOrg${i}, dmx, dmy, w); acc += s * ${GAIN[i].toFixed(2)} * w * rem; rem *= 1.0 - w; cov = max(cov, w); }`).join('\n')}
  return acc + base * rem;
}
`;
