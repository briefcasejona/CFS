// CI smoke test: serve the built site/, open it in headless Chromium (software WebGL), start a Quick Fight,
// fly a few seconds and fail on any page error. Needs `playwright` (installed in CI only).
//   npm i --no-save playwright && npx playwright install chromium && node scripts/smoke-test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = 5180;
const server = spawn(process.execPath, [resolve(root, 'scripts', 'serve.mjs'), '--site'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

const errors = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.getByRole('button', { name: /Quick Fight/ }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: 'smoke-menu.png' });
  await page.getByRole('button', { name: /Quick Fight/ }).click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'smoke-flight.png' });
  const state = await page.evaluate(() => ({
    simVisible: getComputedStyle(document.getElementById('ui')).display === 'none',
    sw: 'serviceWorker' in navigator ? !!navigator.serviceWorker.controller || 'registering' : 'unsupported',
    installable: !!window.installable,
  }));
  console.log('state', state);
  if (!state.simVisible) errors.push('flight did not start (menu still visible)');
  if (!state.installable) errors.push('installable client missing');
  ok = errors.length === 0;
} finally {
  await browser.close();
  server.kill();
}
if (!ok) { console.error('SMOKE TEST FAILED\n' + errors.join('\n')); process.exit(1); }
console.log('smoke test passed');
