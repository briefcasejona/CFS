// Bridge exposed to the page as window.installableDesktop (read by installable-client.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installableDesktop', {
  version: ipcRenderer.sendSync('installable:version'),
  platform: process.platform,
  onUpdateReady(cb) {
    ipcRenderer.on('installable:update-ready', () => cb());
    if (ipcRenderer.sendSync('installable:is-ready')) setTimeout(cb, 0);
  },
  checkForUpdate() { ipcRenderer.send('installable:check'); },
  restartToUpdate() { ipcRenderer.send('installable:restart'); },
});
