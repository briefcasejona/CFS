// Electron shell for an installable web app. Serves ./site through a privileged app:// scheme (so ES modules,
// fetch and relative URLs behave exactly as on the web) and auto-updates from GitHub Releases.
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, 'site');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let updateReady = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: '#0d1720', autoHideMenuBar: true, show: false,
    icon: path.join(SITE, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL('app://local/index.html');
  // external links open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
  // no menu (its accelerators would steal game keys); keep F11 fullscreen and Ctrl+Shift+I devtools
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', () => {
    updateReady = true;
    if (win) win.webContents.send('installable:update-ready');
  });
  autoUpdater.on('error', (err) => console.error('auto-update error:', err && err.message));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline */ });
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

ipcMain.on('installable:version', (e) => { e.returnValue = app.getVersion(); });
ipcMain.on('installable:is-ready', (e) => { e.returnValue = updateReady; });
ipcMain.on('installable:check', () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); });
// Non-silent install: the one-click NSIS installer shows a small progress window and then starts the new
// version itself. The silent variant (quitAndInstall(true, true)) installs fine but often fails to relaunch.
ipcMain.on('installable:restart', () => {
  if (!updateReady) return;
  setImmediate(() => {
    app.removeAllListeners('window-all-closed');
    for (const w of BrowserWindow.getAllWindows()) w.removeAllListeners('close');
    autoUpdater.quitAndInstall(false, true);
  });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(SITE, p));
    if (!file.startsWith(SITE + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const data = fs.readFileSync(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow();
  setupUpdater();
});
