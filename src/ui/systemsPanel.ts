// The cockpit panel: every switch, light and gauge an aircraft's systems declare, grouped by cockpit panel, with the
// current checklist beside it. It is built entirely from the declarations in AircraftSystems, so an aircraft that
// gets its own systems gets a working panel without any UI code of its own.
import type { AircraftSystems, ControlDef } from '../systems/types.js';

const CSS = `
.sysp{position:absolute;right:12px;top:54px;bottom:12px;width:min(560px,46vw);z-index:6;display:none;flex-direction:column;
  background:rgba(12,15,17,.93);border:1px solid #3a4348;border-radius:8px;color:#cfd8dc;font:12px/1.35 system-ui,sans-serif;
  box-shadow:0 8px 40px rgba(0,0,0,.6);pointer-events:auto;user-select:none}
.sysp header{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #2a3236}
.sysp header b{font-size:14px;letter-spacing:.06em}
.sysp header span{opacity:.6;flex:1}
.sysp button{font:inherit;color:inherit;background:#1d2428;border:1px solid #3a4348;border-radius:4px;padding:3px 8px;cursor:pointer}
.sysp button:hover{border-color:#7f8f97}
.sysp button.on{background:#d7dde0;color:#111;border-color:#fff;font-weight:600}
.sysp button.armed{border-color:#e0a030;color:#ffcf70}
.sysp .body{overflow-y:auto;padding:8px 12px 14px;flex:1}
.sysp h4{margin:12px 0 5px;font-size:11px;letter-spacing:.14em;color:#8fa1aa;border-bottom:1px solid #263035;padding-bottom:2px}
.sysp .row{display:flex;align-items:center;gap:6px;margin:3px 0;flex-wrap:wrap}
.sysp .row label{width:132px;flex:none;color:#aab7bd}
.sysp .lights{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.sysp .lt{padding:3px 6px;border-radius:3px;font-size:10.5px;font-weight:700;letter-spacing:.04em;background:#171c1f;color:#4a555b;border:1px solid #242c30}
.sysp .lt.on.warning{background:#d82a20;color:#fff;border-color:#ff7a70;box-shadow:0 0 8px #d82a20}
.sysp .lt.on.caution{background:#e0a020;color:#1a1200;border-color:#ffd870;box-shadow:0 0 8px #e0a02080}
.sysp .lt.on.green{background:#2fbf58;color:#031;border-color:#8fffb0}
.sysp .lt.on.amber{background:#e0a020;color:#1a1200;border-color:#ffd870}
.sysp .lt.on.blue{background:#3a8fe0;color:#fff}
.sysp .lt.on.red{background:#d82a20;color:#fff}
.sysp .gauges{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:5px;margin:4px 0}
.sysp .g{background:#161b1e;border:1px solid #242c30;border-radius:4px;padding:4px 6px}
.sysp .g small{display:block;color:#8fa1aa;font-size:10px;letter-spacing:.08em}
.sysp .g b{font:600 15px ui-monospace,monospace}
.sysp .g.red b{color:#ff6a5a}
.sysp .g i{display:block;height:3px;background:#263035;margin-top:3px;border-radius:2px;overflow:hidden}
.sysp .g i u{display:block;height:100%;background:#9fb4be}
.sysp .cl{border-top:1px solid #2a3236;padding:8px 12px;max-height:34%;overflow-y:auto}
.sysp .cl div{padding:1px 0 1px 18px;position:relative;color:#8fa1aa}
.sysp .cl div.done{color:#56636a}
.sysp .cl div.done::before{content:'✓';position:absolute;left:2px;color:#2fbf58}
.sysp .cl div.next{color:#fff;font-weight:600}
.sysp .cl div.next::before{content:'▶';position:absolute;left:2px;color:#ffcf70}
.sysp .cl small{display:block;font-weight:400;color:#aab7bd}
.sysp .why{color:#ffb060;min-height:16px;padding:0 12px 6px}
`;

export class SystemsPanel {
  readonly el: HTMLElement;
  private sys: AircraftSystems | null = null;
  private body: HTMLElement;
  private cl: HTMLElement;
  private why: HTMLElement;
  private autoBtn: HTMLButtonElement;
  private title: HTMLElement;
  private btns = new Map<string, HTMLButtonElement[]>();
  private lts = new Map<string, HTMLElement>();
  private ggs = new Map<string, { box: HTMLElement; val: HTMLElement; bar: HTMLElement }>();
  private armed = '';
  private timer = 0;
  private whyT = 0;
  open = false;
  /** called when the pilot moves a control and the real one would not move */
  onRefused: (reason: string) => void = () => {};

  constructor(root: HTMLElement) {
    if (!document.getElementById('sysp-css')) {
      const st = document.createElement('style'); st.id = 'sysp-css'; st.textContent = CSS; document.head.append(st);
    }
    this.el = document.createElement('div');
    this.el.className = 'sysp';
    this.el.innerHTML = `<header><b></b><span>cockpit systems</span><button data-a="auto"></button><button data-a="close">✕</button></header>
      <div class="body"></div><div class="why"></div><div class="cl"></div>`;
    this.title = this.el.querySelector('header b')!;
    this.body = this.el.querySelector('.body')!;
    this.cl = this.el.querySelector('.cl')!;
    this.why = this.el.querySelector('.why')!;
    this.autoBtn = this.el.querySelector('[data-a="auto"]')!;
    this.autoBtn.onclick = () => { if (this.sys) this.sys.autoStart = !this.sys.autoStart; };
    (this.el.querySelector('[data-a="close"]') as HTMLElement).onclick = () => this.show(false);
    // clicks in the panel must not turn the pilot's head
    for (const ev of ['mousedown', 'wheel', 'contextmenu']) this.el.addEventListener(ev, (e) => e.stopPropagation());
    window.addEventListener('mouseup', () => this.releaseAll());
    root.append(this.el);
  }

  attach(sys: AircraftSystems | null) {
    this.sys = sys;
    this.btns.clear(); this.lts.clear(); this.ggs.clear();
    this.body.innerHTML = '';
    if (!sys) { this.show(false); return; }
    this.title.textContent = sys.title;
    const panels: string[] = [];
    for (const x of [...sys.lights, ...sys.gauges, ...sys.controls]) if (!panels.includes(x.panel)) panels.push(x.panel);
    for (const name of panels) {
      const h = document.createElement('h4'); h.textContent = name; this.body.append(h);
      const lights = sys.lights.filter((l) => l.panel === name);
      if (lights.length) {
        const box = document.createElement('div'); box.className = 'lights';
        for (const l of lights) {
          const d = document.createElement('div');
          d.className = `lt ${l.kind === 'indicator' ? l.color ?? 'green' : l.kind}`;
          d.textContent = l.label;
          this.lts.set(l.id, d); box.append(d);
        }
        this.body.append(box);
      }
      const gauges = sys.gauges.filter((g) => g.panel === name);
      if (gauges.length) {
        const box = document.createElement('div'); box.className = 'gauges';
        for (const g of gauges) {
          const d = document.createElement('div'); d.className = 'g';
          d.innerHTML = `<small>${g.label} <span style="opacity:.6">${g.unit}</span></small><b>0</b><i><u></u></i>`;
          this.ggs.set(g.id, { box: d, val: d.querySelector('b')!, bar: d.querySelector('u')! });
          box.append(d);
        }
        this.body.append(box);
      }
      for (const c of sys.controls.filter((x) => x.panel === name)) this.body.append(this.controlRow(c));
    }
    this.refresh(true);
  }

  private controlRow(c: ControlDef) {
    const row = document.createElement('div'); row.className = 'row';
    if (c.help) row.title = c.help;
    const lab = document.createElement('label'); lab.textContent = c.label; row.append(lab);
    const list: HTMLButtonElement[] = [];
    c.positions.forEach((name, pos) => {
      if (c.momentary && pos === (c.rest ?? 0)) { list.push(document.createElement('button')); return; }
      const b = document.createElement('button');
      b.textContent = name;
      if (c.momentary) {
        // spring-loaded: held for as long as the mouse button is down
        b.onmousedown = () => { this.move(c, pos); };
      } else {
        b.onclick = () => {
          // a guarded switch takes two clicks: lift the guard, then move it
          const key = `${c.id}:${pos}`;
          if (c.guard && this.armed !== key && this.sys?.get(c.id) !== pos) { this.armed = key; this.refresh(true); return; }
          this.armed = '';
          this.move(c, pos);
        };
      }
      list.push(b); row.append(b);
    });
    this.btns.set(c.id, list);
    return row;
  }

  private move(c: ControlDef, pos: number) {
    const why = this.sys?.set(c.id, pos);
    if (why) { this.why.textContent = why; this.whyT = 5; this.onRefused(why); }
    this.refresh(true);
  }

  private releaseAll() {
    if (!this.sys) return;
    for (const c of this.sys.controls) if (c.momentary && this.sys.get(c.id) !== (c.rest ?? 0)) this.sys.set(c.id, c.rest ?? 0);
  }

  show(on: boolean) {
    this.open = on && !!this.sys;
    this.el.style.display = this.open ? 'flex' : 'none';
    if (this.open) this.refresh(true);
    else this.releaseAll();
  }
  toggle() { this.show(!this.open); }

  /** Call every frame; redraws about ten times a second while open. */
  update(dt: number) {
    if (!this.open) return;
    this.timer -= dt;
    if (this.whyT > 0 && (this.whyT -= dt) <= 0) this.why.textContent = '';
    if (this.timer <= 0) this.refresh(false);
  }

  private refresh(_now: boolean) {
    const sys = this.sys;
    if (!sys) return;
    this.timer = 0.1;
    for (const c of sys.controls) {
      const cur = sys.get(c.id);
      this.btns.get(c.id)?.forEach((b, pos) => {
        b.classList.toggle('on', pos === cur && !(c.momentary && pos === (c.rest ?? 0)));
        b.classList.toggle('armed', this.armed === `${c.id}:${pos}`);
      });
    }
    for (const l of sys.lights) this.lts.get(l.id)?.classList.toggle('on', sys.light(l.id));
    for (const g of sys.gauges) {
      const w = this.ggs.get(g.id); if (!w) continue;
      const v = sys.gauge(g.id);
      w.val.textContent = Math.abs(g.max) >= 1000 ? String(Math.round(v / 10) * 10) : v.toFixed(0);
      w.bar.style.width = `${Math.max(0, Math.min(1, (v - g.min) / (g.max - g.min))) * 100}%`;
      w.box.classList.toggle('red', (g.redAbove !== undefined && v > g.redAbove) || (g.redBelow !== undefined && v < g.redBelow));
    }
    this.autoBtn.textContent = sys.autoStart ? 'Auto-start: running' : 'Auto-start';
    this.autoBtn.classList.toggle('on', sys.autoStart);
    const steps = sys.checklist();
    const next = steps.findIndex((s) => !s.done);
    this.cl.innerHTML = steps.map((s, k) =>
      `<div class="${s.done ? 'done' : k === next ? 'next' : ''}">${s.text}${k === next && s.note ? `<small>${s.note}</small>` : ''}</div>`).join('')
      + (next < 0 ? '<div class="next">Checklist complete.</div>' : '');
  }
}
