// Live menu background: real photographs of the theme's jet (public-domain U.S. Navy / U.S. Air Force photos on
// Wikimedia Commons, credited on screen) in a slow Ken Burns drift, layered with parallax, a sun glint and a HUD that
// fly with the mouse: the picture banks and pitches away from the pointer, the HUD horizon tilts with it, the flight
// path marker follows the pointer and locks onto the menu button under it, and a click kicks in the "afterburner"
// (a zoom punch and a shake). Without the photos (offline, or switched off in Settings) the HUD flies over a gradient.

export interface MenuPhoto {
  /** Wikimedia Commons file name */
  file: string;
  /** thumbnail path below upload.wikimedia.org/wikipedia/commons/thumb/ ({w} = width) */
  thumb: string;
  credit: string;
  caption: string;
  /** focal point of the jet in the frame, % from the left/top: the drift and zoom stay centred on it */
  focus: [number, number];
}
export interface MenuTheme { id: string; name: string; accent: string; photos: MenuPhoto[] }

const th = (hash: string, file: string, w = 1920) => `${hash}/${encodeURIComponent(file)}/${w}px-${encodeURIComponent(file)}`;

export const MENU_THEMES: MenuTheme[] = [
  {
    id: 'f14', name: 'F-14 Tomcat', accent: '#ffb24f',
    photos: [
      { file: 'F-14_Tomcat_afterburner.jpg', thumb: th('9/9c', 'F-14_Tomcat_afterburner.jpg'), focus: [50, 55],
        credit: 'U.S. Navy photo by PH3 Jayme Pastoric', caption: 'F-14A of VF-211 launching in full afterburner from USS John C. Stennis at sunrise' },
      { file: 'US_Navy_031114-N-6213R-070_An_F-14D_Tomcat_gnites_its_afterburners_following_a_launch_from_USS_John_C._Stennis_(CVN_74).jpg',
        thumb: th('3/34', 'US_Navy_031114-N-6213R-070_An_F-14D_Tomcat_gnites_its_afterburners_following_a_launch_from_USS_John_C._Stennis_(CVN_74).jpg'), focus: [50, 50],
        credit: 'U.S. Navy photo by PH3 Mark J. Rebilas', caption: 'F-14D lighting its afterburners after a launch from USS John C. Stennis, 2003' },
      { file: 'US_Navy_040924-N-0295M-038_An_F-14D_Tomcat_takes_off_in_full_afterburner_after_demonstrating_a_touch-and-go_landing.jpg',
        thumb: th('3/3d', 'US_Navy_040924-N-0295M-038_An_F-14D_Tomcat_takes_off_in_full_afterburner_after_demonstrating_a_touch-and-go_landing.jpg'), focus: [50, 50],
        credit: 'U.S. Navy photo by PH2 Daniel J. McLain', caption: 'F-14D taking off in full afterburner at NAS Oceana, 2004' },
    ],
  },
  {
    id: 'f16', name: 'F-16 Fighting Falcon', accent: '#4fb3ff',
    photos: [
      { file: 'F-16_Fighting_Falcon.jpg', thumb: th('6/66', 'F-16_Fighting_Falcon.jpg'), focus: [50, 45],
        credit: 'U.S. Air Force photo by SSgt Cherie A. Thurlby', caption: 'F-16 of the 35th Fighter Wing over Iraq, 2003' },
      { file: 'U_S_Air_Force_F-16_Fighting_Falcon_Flies_(5725742).jpg', thumb: th('3/36', 'U_S_Air_Force_F-16_Fighting_Falcon_Flies_(5725742).jpg'), focus: [50, 50],
        credit: 'U.S. Air Force photo by A1C Ericka Woolever', caption: 'F-16 of the 510th Fighter Squadron taking off at Aviano, 2019' },
      { file: 'F-16_Fighter_Pilot.jpg', thumb: th('4/4f', 'F-16_Fighter_Pilot.jpg'), focus: [50, 50],
        credit: 'U.S. Air Force photo by SSgt Christopher Boitz', caption: 'F-16 Aggressors over the Joint Pacific Alaska Range, Red Flag-Alaska' },
    ],
  },
  {
    id: 'f15', name: 'F-15 Eagle', accent: '#f2c14e',
    photos: [
      { file: 'F-15_eagle_USAF.jpg', thumb: th('2/25', 'F-15_eagle_USAF.jpg'), focus: [50, 50],
        credit: 'U.S. Air Force photo by MSgt Thomas Meneguin', caption: 'F-15E Strike Eagle of the 4th Fighter Wing, 2000' },
      { file: 'USAF_F-15D_Top.jpg', thumb: th('6/60', 'USAF_F-15D_Top.jpg'), focus: [50, 50],
        credit: 'U.S. Air Force photo by SrA D. Myles Cullen', caption: 'Eagle of the 90th Fighter Squadron in a wingover, Northern Edge 2002' },
      { file: 'F-15_head_on.jpg', thumb: th('c/c3', 'F-15_head_on.jpg', 1280), focus: [50, 40],
        credit: 'U.S. Air Force / Louisiana ANG photo by John P. Curtis', caption: 'F-15C Eagles of the 159th Fighter Wing over the Louisiana wetlands, 2009' },
    ],
  },
];

export function menuTheme(id: string | undefined): MenuTheme { return MENU_THEMES.find((t) => t.id === id) ?? MENU_THEMES[1]; }

const SLIDE_S = 14;          // seconds per photo
const FADE_S = 2.2;

export class MenuBackground {
  readonly el: HTMLElement;
  private slides: HTMLElement[];
  private glint: HTMLElement;
  private hud: HTMLCanvasElement;
  private creditEl: HTMLElement;
  private theme: MenuTheme = MENU_THEMES[1];
  private photosOn = true;
  private active = false;
  private raf = 0;
  private last = 0;
  // pointer (−1..1, smoothed) and effects
  private tx = 0; private ty = 0; private mx = 0; private my = 0; private px = 0.5; private py = 0.5;
  private kick = 0; private hover = 0; private hoverRect: DOMRect | null = null;
  private slideT = 0; private slideIdx = 0; private front = 0;
  private loaded = new Map<string, boolean>();
  private reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private t = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'menubg';
    this.el.innerHTML = `<div class="mb-slide"></div><div class="mb-slide"></div><div class="mb-shade"></div><div class="mb-glint"></div>
      <canvas class="mb-hud"></canvas><div class="mb-credit"></div>`;
    parent.prepend(this.el);
    this.slides = [...this.el.querySelectorAll<HTMLElement>('.mb-slide')];
    this.glint = this.el.querySelector('.mb-glint')!;
    this.hud = this.el.querySelector('.mb-hud')!;
    this.creditEl = this.el.querySelector('.mb-credit')!;
    window.addEventListener('pointermove', (e) => {
      this.px = e.clientX / Math.max(1, innerWidth); this.py = e.clientY / Math.max(1, innerHeight);
      this.tx = this.px * 2 - 1; this.ty = this.py * 2 - 1;
      const b = (e.target as HTMLElement | null)?.closest?.('button, a, select, .chip');
      this.hoverRect = b ? b.getBoundingClientRect() : null;
    }, { passive: true });
    window.addEventListener('pointerdown', () => { if (this.active) this.kick = 1; }, { passive: true });
  }

  setTheme(id: string, photos: boolean) {
    const next = menuTheme(id);
    const changed = next !== this.theme || photos !== this.photosOn;
    this.theme = next;
    this.photosOn = photos;
    document.documentElement.style.setProperty('--accent', next.accent);
    document.documentElement.dataset.menuTheme = next.id;
    if (changed) { this.slideIdx = 0; this.slideT = 0; this.show(0, true); }
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) {
      if (!this.slides[this.front].style.backgroundImage) this.show(this.slideIdx, true);
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else cancelAnimationFrame(this.raf);
  }

  /** photo URL (1920 px thumbnail; Special:FilePath as the fallback) */
  static url(p: MenuPhoto, fallback = false) {
    return fallback ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.file)}?width=1920`
      : `https://upload.wikimedia.org/wikipedia/commons/thumb/${p.thumb}`;
  }

  /** bring photo i in on the back slide (crossfade), once it has loaded */
  private show(i: number, instant = false) {
    const photos = this.photosOn ? this.theme.photos : [];
    this.creditEl.innerHTML = '';
    if (!photos.length) { for (const s of this.slides) { s.style.backgroundImage = ''; s.style.opacity = '0'; } return; }
    const p = photos[i % photos.length];
    const load = (fallback: boolean) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        this.loaded.set(p.file, true);
        const back = instant ? this.front : 1 - this.front;
        const s = this.slides[back];
        s.style.backgroundImage = `url("${img.src}")`;
        s.style.backgroundPosition = `${p.focus[0]}% ${p.focus[1]}%`;
        s.dataset.fx = String(p.focus[0]); s.dataset.fy = String(p.focus[1]);
        s.style.opacity = '1';
        if (!instant) { this.slides[this.front].style.opacity = '0'; this.front = back; }
        this.creditEl.innerHTML = `${escapeHtml(p.caption)} · <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.file)}" target="_blank" rel="noopener">${escapeHtml(p.credit)}</a>, public domain, via Wikimedia Commons`;
      };
      img.onerror = () => {
        if (!fallback) load(true);
        else if (this.loaded.size === 0 && i + 1 < photos.length * 2) this.show(i + 1, instant); // try the next one
      };
      img.src = MenuBackground.url(p, fallback);
    };
    load(false);
  }

  private frame(now: number) {
    if (!this.active) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const motion = this.reduceMotion ? 0.15 : 1;
    // pointer smoothing: the "airframe" lags the stick a little
    const k = Math.min(1, dt * 3);
    this.mx += (this.tx - this.mx) * k;
    this.my += (this.ty - this.my) * k;
    this.kick = Math.max(0, this.kick - dt * 1.6);
    this.hover += ((this.hoverRect ? 1 : 0) - this.hover) * Math.min(1, dt * 6);
    // slideshow
    this.slideT += dt;
    if (this.slideT > SLIDE_S && this.photosOn && this.theme.photos.length > 1) {
      this.slideT = 0;
      this.slideIdx = (this.slideIdx + 1) % this.theme.photos.length;
      this.show(this.slideIdx);
    }
    // photo: Ken Burns zoom over the slide, parallax away from the pointer, a little bank, light turbulence, and the
    // afterburner punch on a click
    const kb = this.slideT / SLIDE_S;
    const shake = this.kick * this.kick * 10 * motion;
    const turb = (Math.sin(this.t * 1.3) + Math.sin(this.t * 2.9 + 1) * 0.5) * 2 * motion;
    for (let s = 0; s < 2; s++) {
      const el = this.slides[s];
      const z = 1.08 + 0.07 * (s === this.front ? kb : 1) * motion + this.kick * 0.05 * motion + this.hover * 0.015;
      const x = -this.mx * 26 * motion + (Math.random() - 0.5) * shake;
      const y = -this.my * 16 * motion + turb + (Math.random() - 0.5) * shake;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${(this.mx * 1.6 * motion).toFixed(2)}deg) scale(${z.toFixed(4)})`;
      el.style.transition = `opacity ${FADE_S}s ease`;
    }
    // sun glint where the pointer is, stronger on the afterburner punch
    this.glint.style.background = `radial-gradient(circle at ${(this.px * 100).toFixed(1)}% ${(this.py * 100).toFixed(1)}%, rgba(255,240,210,${(0.16 + this.kick * 0.35).toFixed(3)}) 0%, rgba(255,220,170,0.05) 18%, transparent 45%)`;
    this.drawHud();
  }

  private drawHud() {
    const c = this.hud, dpr = Math.min(2, devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const col = this.theme.accent;
    g.strokeStyle = col; g.fillStyle = col;
    g.lineWidth = 1.4;
    g.font = '12px Consolas, monospace';
    g.globalAlpha = 0.33 + 0.25 * this.hover;
    // horizon and pitch ladder: bank with the pointer's x, pitch with its y
    const cx = W / 2, cy = H / 2, bank = -this.mx * 0.5, pitchPx = this.my * H * 0.12, step = H * 0.12;
    g.save();
    g.translate(cx, cy);
    g.rotate(bank);
    for (let n = -4; n <= 4; n++) {
      const y = pitchPx + n * step;
      const w = n === 0 ? W * 0.32 : W * 0.08;
      if (n === 0) { g.beginPath(); g.moveTo(-w, y); g.lineTo(-W * 0.04, y); g.moveTo(W * 0.04, y); g.lineTo(w, y); g.stroke(); continue; }
      g.setLineDash(n > 0 ? [8, 6] : []);
      g.beginPath(); g.moveTo(-w - 40, y); g.lineTo(-40, y); g.lineTo(-40, y + (n > 0 ? -8 : 8)); g.moveTo(w + 40, y); g.lineTo(40, y); g.lineTo(40, y + (n > 0 ? -8 : 8)); g.stroke();
      g.setLineDash([]);
      g.fillText(String(Math.abs(n) * 5), w + 48, y + 4);
    }
    g.restore();
    // heading tape drifting with time and the pointer
    const hdg = (360 + ((this.t * 3 + this.mx * 25) % 360)) % 360;
    g.save();
    g.beginPath(); g.rect(cx - 160, 18, 320, 30); g.clip();
    for (let d = Math.floor(hdg / 5) * 5 - 30; d <= hdg + 30; d += 5) {
      const x = cx + (d - hdg) * 5.2;
      g.beginPath(); g.moveTo(x, 40); g.lineTo(x, d % 10 === 0 ? 30 : 35); g.stroke();
      if (d % 10 === 0) g.fillText(String(((d % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x - 7, 26);
    }
    g.restore();
    g.beginPath(); g.moveTo(cx, 44); g.lineTo(cx - 5, 50); g.lineTo(cx + 5, 50); g.closePath(); g.fill();
    // flight path marker at the pointer; a target box locks onto the hovered button
    const fx = this.px * W, fy = this.py * H;
    g.globalAlpha = 0.6;
    g.beginPath(); g.arc(fx, fy, 7, 0, Math.PI * 2); g.moveTo(fx - 18, fy); g.lineTo(fx - 7, fy); g.moveTo(fx + 7, fy); g.lineTo(fx + 18, fy); g.moveTo(fx, fy - 7); g.lineTo(fx, fy - 14); g.stroke();
    if (this.hoverRect && this.hover > 0.05) {
      const r = this.hoverRect, pad = 8 + 30 * (1 - this.hover);
      g.globalAlpha = 0.85 * this.hover;
      g.lineWidth = 2;
      const x0 = r.left - pad, y0 = r.top - pad, x1 = r.right + pad, y1 = r.bottom + pad, L = 12;
      g.beginPath();
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) { g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L); }
      g.stroke();
      if (this.hover > 0.9) g.fillText('LOCK', x1 + 6, y0 + 10);
    }
    // G / Mach readout reacting to the afterburner punch
    g.globalAlpha = 0.45;
    g.fillText(`G ${(1 + this.kick * 6 + Math.abs(this.my) * 1.5).toFixed(1)}`, 24, H - 60);
    g.fillText(`M ${(0.85 + this.kick * 0.6 + this.hover * 0.1).toFixed(2)}`, 24, H - 44);
    g.globalAlpha = 1;
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!)); }
