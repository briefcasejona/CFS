// Minimal static file server for CFS (no native dependencies).
// Serves the project root: index.html, styles.css, build/ (compiled TS) and node_modules/three.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `node scripts/serve.mjs --site` serves the built, installable site/ instead (PWA testing, CI smoke test).
const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITE_MODE = process.argv.includes('--site');
const ROOT = SITE_MODE ? join(PROJECT, 'site') : PROJECT;
const PORT = Number(process.env.PORT || (SITE_MODE ? 5174 : 5173));
const ALLOWED = SITE_MODE ? [''] : ['index.html', 'styles.css', 'favicon.ico', `build${sep}`, `node_modules${sep}three${sep}`];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/' || p === '') p = '/index.html';
    const rel = normalize(p).replace(/^[\\/]+/, '');
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT + sep) || !ALLOWED.some((a) => rel === a || rel.startsWith(a))) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  CFS is running:  http://localhost:${PORT}\n  (open it in Chrome or Edge; Ctrl+C to stop)\n`);
});
