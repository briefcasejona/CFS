// Small "something went wrong" panel so players (and friends testing a build) can report errors:
// shows the latest uncaught error and copies a log with version + browser info to the clipboard.
import { installable } from './installLinks.js';

const log: string[] = [];
let box: HTMLElement | null = null;
let shown = 0;

function push(kind: string, msg: string) {
  log.push(`[${new Date().toISOString().slice(11, 19)}] ${kind}: ${msg}`);
  if (log.length > 60) log.shift();
}

function report() {
  const info = installable()?.info;
  return [
    `CFS ${info ? `v${info.version} build ${info.build}` : 'dev build'}`,
    `URL: ${location.href}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${innerWidth}x${innerHeight} @${devicePixelRatio}`,
    '',
    ...log,
  ].join('\n');
}

function show(title: string, detail: string) {
  shown++;
  if (!box) {
    box = document.createElement('div');
    box.id = 'errbox';
    box.setAttribute('role', 'alert');
    document.body.append(box);
  }
  box.innerHTML = `<b>CFS hit an error${shown > 1 ? ` (${shown})` : ''}</b><pre></pre>
    <div class="row"><button data-a="copy">Copy log</button><button data-a="close">Dismiss</button></div>`;
  box.querySelector('pre')!.textContent = `${title}\n${detail}`.trim();
  box.querySelector('[data-a="close"]')!.addEventListener('click', () => { box?.remove(); box = null; shown = 0; });
  box.querySelector('[data-a="copy"]')!.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    navigator.clipboard.writeText(report()).then(() => { btn.textContent = 'Copied ✓'; }, () => { btn.textContent = 'Copy failed'; });
  });
}

export function installErrorOverlay() {
  window.addEventListener('error', (e) => {
    const stack = (e.error as Error | undefined)?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`;
    push('error', `${e.message}\n${stack}`);
    show(e.message, stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string;
    const msg = typeof r === 'string' ? r : r?.message ?? String(r);
    push('rejection', `${msg}\n${typeof r === 'string' ? '' : r?.stack ?? ''}`);
    show(`Unhandled promise rejection: ${msg}`, typeof r === 'string' ? '' : r?.stack ?? '');
  });
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push('console', args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' '));
    origError(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => { push('warn', args.map(String).join(' ')); origWarn(...args); };
}

/** For tests / manual reporting. */
export function errorLog() { return report(); }
