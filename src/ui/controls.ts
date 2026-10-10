import { ACTIONS, bindingLabel, shapeAxis, shortDev, type AxisBinding, type Binding, type InputManager } from '../input/input.js';
import { el, esc, type AppApi } from './screens.js';

/** DCS-style controls screen: one column per device, click to bind, axis tuning with live preview. */
export function controlsScreen(app: AppApi, input: InputManager): HTMLElement {
  let column = 'keyboard';
  let filter: 'all' | 'axis' | 'button' = 'all';
  let tune: { action: string; b: AxisBinding } | null = null;
  let raf = 0;
  let lastCols = '';
  const e = el(`
    <div class="screen controls">
      <div class="header"><button data-a="back">◀ Back</button><h2>Controls / HOTAS</h2></div>
      <div class="devbar"></div>
      <div class="cols">
        <div class="col wide">
          <div class="toolbar">
            <select class="filter"><option value="all">All actions</option><option value="axis">Axes only</option><option value="button">Buttons only</option></select>
            <button data-a="resetdev">Reset column to default</button>
            <button data-a="cleardev">Clear column</button>
            <button data-a="export">Export profile</button>
            <label class="filebtn">Import profile<input type="file" accept=".json,application/json" class="import"></label>
          </div>
          <div class="scroll"><table class="binds"></table></div>
        </div>
        <div class="col narrow">
          <h3>Device monitor</h3>
          <div class="monitor"></div>
          <h3>Axis tuning</h3>
          <div class="tune muted"></div>
        </div>
      </div>
      <div class="capture hidden"><div class="panel"><h3 class="cap-title"></h3><p class="cap-msg"></p><p class="muted small">Esc = cancel · times out after 10 s</p></div></div>
    </div>`);
  const devbar = e.querySelector('.devbar')!;
  const table = e.querySelector('.binds')!;
  const monitor = e.querySelector('.monitor')!;
  const tuneDiv = e.querySelector('.tune') as HTMLElement;
  const cap = e.querySelector('.capture') as HTMLElement;

  const columns = () => ['keyboard', ...input.devices().map((d) => d.id)];
  const renderDevbar = () => {
    devbar.innerHTML = '';
    const cols = columns();
    lastCols = cols.join('|');
    if (!cols.includes(column)) column = 'keyboard';
    for (const c of cols) {
      const b = el(`<button class="tab ${c === column ? 'sel' : ''}">${c === 'keyboard' ? 'Keyboard' : esc(shortDev(c))}</button>`);
      b.title = c;
      b.addEventListener('click', () => { column = c; tune = null; render(); });
      devbar.append(b);
    }
    if (cols.length === 1) devbar.append(el('<span class="muted">No joystick detected — plug in your HOTAS and press any button on it.</span>'));
  };

  const render = () => {
    renderDevbar();
    const groups = new Map<string, typeof ACTIONS>();
    for (const a of ACTIONS) {
      if (filter !== 'all' && a.type !== filter) continue;
      if (column === 'keyboard' && a.type === 'axis') continue;
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group)!.push(a);
    }
    let html = '';
    for (const [g, list] of groups) {
      html += `<tr class="grp"><td colspan="3">${esc(g)}</td></tr>`;
      for (const a of list) {
        const bs = input.bindingsFor(a.id, column);
        const cells = bs.map((b, i) => `<span class="bind">${esc(bindingLabel(b))}${b.kind === 'axis' ? ` <a data-tune="${a.id}" data-i="${i}" title="Tune axis">⚙</a>` : ''}</span>`).join(' ');
        html += `<tr><td>${esc(a.label)} <span class="muted small">${a.type}</span></td><td class="cell">${cells || '<span class="muted">—</span>'}</td>
          <td class="nowrap"><button class="small" data-bind="${a.id}">Bind</button> <button class="small" data-clear="${a.id}" title="Clear">✕</button></td></tr>`;
      }
    }
    table.innerHTML = html;
    table.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((b) => b.addEventListener('click', () => startBind(b.dataset.bind!)));
    table.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach((b) => b.addEventListener('click', () => { input.setBinding(b.dataset.clear!, column, null); render(); }));
    table.querySelectorAll<HTMLAnchorElement>('[data-tune]').forEach((a) => a.addEventListener('click', () => {
      const b = input.bindingsFor(a.dataset.tune!, column)[Number(a.dataset.i)];
      if (b && b.kind === 'axis') { tune = { action: a.dataset.tune!, b }; renderTune(); }
    }));
    renderTune();
  };

  const startBind = (action: string) => {
    const def = ACTIONS.find((a) => a.id === action)!;
    if (column === 'keyboard' && def.type === 'axis') { app.toast('Axes need a joystick column.'); return; }
    if (column !== 'keyboard' && !input.devices().some((d) => d.id === column)) { app.toast('Device not connected'); return; }
    cap.classList.remove('hidden');
    (cap.querySelector('.cap-title') as HTMLElement).textContent = `Bind: ${def.label}`;
    (cap.querySelector('.cap-msg') as HTMLElement).textContent = def.type === 'axis'
      ? 'Move the axis you want to use through its full range…'
      : column === 'keyboard' ? 'Press a key (Ctrl / Shift / Alt modifiers allowed)…' : 'Press a button or hat direction on the device…';
    input.startCapture(def.type, (b: Binding | null) => {
      cap.classList.add('hidden');
      if (!b) { render(); return; }
      if (b.kind === 'key') column = 'keyboard';
      else if (b.device !== column) { app.toast(`Input came from ${shortDev(b.device)} — bound there.`); column = b.device; }
      if (b.kind === 'axis' && action === 'throttle') { b.slider = true; b.deadzone = 0; b.curve = 0; }
      const conflicts = input.conflicts(b).filter((x) => x !== action);
      input.setBinding(action, column, b);
      if (conflicts.length) app.toast(`Removed from: ${conflicts.map((c) => ACTIONS.find((a) => a.id === c)?.label ?? c).join(', ')}`);
      if (b.kind === 'axis') tune = { action, b };
      render();
    });
  };

  const renderTune = () => {
    if (!tune) {
      tuneDiv.textContent = 'Click ⚙ next to an axis binding to tune deadzone, saturation, curvature and inversion.';
      tuneDiv.classList.add('muted');
      return;
    }
    const b = tune.b;
    tuneDiv.classList.remove('muted');
    tuneDiv.innerHTML = `
      <div><b>${esc(ACTIONS.find((a) => a.id === tune!.action)?.label ?? '')}</b> — ${esc(shortDev(b.device))} axis ${b.index}</div>
      <label class="chk"><input type="checkbox" data-t="invert" ${b.invert ? 'checked' : ''}> Invert</label>
      <label class="chk"><input type="checkbox" data-t="slider" ${b.slider ? 'checked' : ''}> Slider (0..1, e.g. throttle)</label>
      <label>Deadzone <input type="range" min="0" max="0.3" step="0.01" data-t="deadzone" value="${b.deadzone}"></label>
      <label>Saturation <input type="range" min="0.5" max="1" step="0.01" data-t="saturation" value="${b.saturation}"></label>
      <label>Curvature <input type="range" min="0" max="1" step="0.05" data-t="curve" value="${b.curve}"></label>
      <div class="bar"><div class="raw"></div></div>
      <div class="bar"><div class="out"></div></div>
      <canvas class="curve" width="240" height="140"></canvas>`;
    tuneDiv.querySelectorAll<HTMLInputElement>('input[data-t]').forEach((i) => i.addEventListener('input', () => {
      const k = i.dataset.t!;
      if (k === 'invert') b.invert = i.checked;
      else if (k === 'slider') b.slider = i.checked;
      else if (k === 'deadzone') b.deadzone = Number(i.value);
      else if (k === 'saturation') b.saturation = Number(i.value);
      else if (k === 'curve') b.curve = Number(i.value);
      input.save();
      drawCurve();
    }));
    drawCurve();
  };
  const drawCurve = () => {
    const cv = tuneDiv.querySelector('.curve') as HTMLCanvasElement | null;
    if (!cv || !tune) return;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#0b1218'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#2a3a48'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, cv.height / 2); c.lineTo(cv.width, cv.height / 2); c.moveTo(cv.width / 2, 0); c.lineTo(cv.width / 2, cv.height); c.stroke();
    c.strokeStyle = '#5ab4ff'; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= 100; i++) {
      const raw = -1 + i / 50;
      let v = shapeAxis(raw, tune.b);
      if (tune.b.slider) v = v * 2 - 1;
      const x = (i / 100) * cv.width, y = cv.height / 2 - v * (cv.height / 2 - 4);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  };

  const tick = () => {
    if (!document.body.contains(e)) { cancelAnimationFrame(raf); return; }
    raf = requestAnimationFrame(tick);
    input.poll();
    if (columns().join('|') !== lastCols && !input.capturing) render();
    const pads = input.devices();
    let html = '';
    for (const p of pads) {
      html += `<div class="dev"><div class="devname" title="${esc(p.id)}">${esc(shortDev(p.id))} <span class="muted small">(${p.axes.length} axes, ${p.buttons.length} buttons${p.mapping ? ', ' + p.mapping : ''})</span></div>`;
      p.axes.forEach((v, i) => {
        const hat = Math.abs(v) > 1.05;
        html += `<div class="axrow"><span>A${i}</span><div class="axbar"><div style="left:${50 + Math.max(-1, Math.min(1, v)) * 50}%" class="${hat ? 'hat' : ''}"></div></div><span class="small">${v.toFixed(2)}</span></div>`;
      });
      html += '<div class="btns">' + p.buttons.map((b, i) => `<span class="b ${b.pressed ? 'on' : ''}">${i + 1}</span>`).join('') + '</div></div>';
    }
    monitor.innerHTML = html || '<div class="muted">No devices. Connect a HOTAS/joystick and press a button on it.</div>';
    if (tune) {
      const pad = pads.find((p) => p.id === tune!.b.device);
      const raw = pad ? pad.axes[tune.b.index] ?? 0 : 0;
      const out = shapeAxis(raw, tune.b);
      const r = tuneDiv.querySelector('.raw') as HTMLElement | null, o = tuneDiv.querySelector('.out') as HTMLElement | null;
      if (r) r.style.width = `${((Math.max(-1, Math.min(1, raw)) + 1) / 2) * 100}%`;
      if (o) o.style.width = `${(tune.b.slider ? out : (out + 1) / 2) * 100}%`;
    }
  };

  e.querySelector('.filter')!.addEventListener('change', (ev) => { filter = (ev.target as HTMLSelectElement).value as typeof filter; render(); });
  e.querySelector('[data-a="back"]')!.addEventListener('click', () => { cancelAnimationFrame(raf); input.cancelCapture(); app.mainMenu(); });
  e.querySelector('[data-a="resetdev"]')!.addEventListener('click', () => {
    if (column === 'keyboard') input.resetKeyboard(); else input.resetDevice(column);
    app.toast('Column reset to the default profile');
    render();
  });
  e.querySelector('[data-a="cleardev"]')!.addEventListener('click', () => {
    if (column === 'keyboard') {
      for (const a of Object.keys(input.bindings)) input.bindings[a] = input.bindings[a].filter((b) => b.kind !== 'key');
      input.save();
    } else input.clearDevice(column);
    render();
  });
  e.querySelector('[data-a="export"]')!.addEventListener('click', () => {
    const blob = new Blob([input.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cfs-controls.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  e.querySelector('.import')!.addEventListener('change', async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { input.importJSON(await f.text()); app.toast('Profile imported'); render(); }
    catch { app.toast('Invalid profile file'); }
  });
  render();
  raf = requestAnimationFrame(tick);
  return e;
}
