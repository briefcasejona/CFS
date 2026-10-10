// installable-client.js — injected by build-site.mjs. Plain script, no dependencies.
// Registers the service worker, shows an "update ready" bar, exposes install / download helpers on
// window.installable, and bridges to the Electron desktop shell (window.installableDesktop) when present.
(function () {
  'use strict';
  var listeners = {};
  var deferredPrompt = null;
  var updateReady = false;
  var userAskedUpdate = false;
  var reg = null;
  var info = null;
  var desktop = window.installableDesktop || null;

  function emit(ev, data) { (listeners[ev] || []).slice().forEach(function (cb) { try { cb(data); } catch (e) { console.error(e); } }); }

  var api = {
    isDesktop: !!desktop,
    get isStandalone() {
      return !!desktop || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    },
    get info() { return info; },
    get updateReady() { return updateReady; },
    canInstall: function () { return !!deferredPrompt; },
    install: function () {
      if (!deferredPrompt) return Promise.resolve(false);
      var p = deferredPrompt; deferredPrompt = null;
      p.prompt();
      return p.userChoice.then(function (c) { emit('change'); return c.outcome === 'accepted'; });
    },
    /** URL of the latest desktop installer on GitHub Releases, or null when unknown. */
    desktopDownloadUrl: function () {
      if (!info || !info.repo || !info.desktopAsset) return null;
      return 'https://github.com/' + info.repo + '/releases/latest/download/' + info.desktopAsset;
    },
    releasesUrl: function () { return info && info.repo ? 'https://github.com/' + info.repo + '/releases/latest' : null; },
    applyUpdate: function () {
      if (desktop) { desktop.restartToUpdate(); return; }
      if (reg && reg.waiting) { userAskedUpdate = true; reg.waiting.postMessage('SKIP_WAITING'); }
      else location.reload();
    },
    checkForUpdate: function () { if (desktop) desktop.checkForUpdate && desktop.checkForUpdate(); else if (reg) reg.update().catch(function () {}); },
    on: function (ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
  };
  window.installable = api;

  // ---- version info
  fetch('./version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (desktop && desktop.version && j) j.version = desktop.version; info = j; emit('change'); })
    .catch(function () { /* offline: fine */ });

  // ---- update bar (built-in UI; set window.INSTALLABLE_UI = false before this script to render your own)
  function showBar() {
    if (window.INSTALLABLE_UI === false || document.getElementById('installable-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'installable-bar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;font:14px system-ui,sans-serif;' +
      'background:#1b2a3a;color:#e8f0f8;border:1px solid #3d6a8f;box-shadow:0 6px 24px rgba(0,0,0,.45);max-width:calc(100vw - 32px)';
    var name = (info && info.name) || document.title || 'The app';
    bar.innerHTML = '<span>A new version of <b></b> is ready.</span>' +
      '<button type="button" data-a="go" style="padding:6px 12px;border-radius:6px;border:0;background:#3d8bd0;color:#fff;cursor:pointer">Restart now</button>' +
      '<button type="button" data-a="later" style="padding:6px 10px;border-radius:6px;border:1px solid #3d6a8f;background:transparent;color:#cfe;cursor:pointer">Later</button>';
    bar.querySelector('b').textContent = name;
    bar.querySelector('[data-a=go]').onclick = function () { api.applyUpdate(); };
    bar.querySelector('[data-a=later]').onclick = function () { bar.remove(); };
    (document.body || document.documentElement).appendChild(bar);
  }
  function markReady() {
    if (updateReady) return;
    updateReady = true;
    emit('update-ready');
    showBar();
  }

  // ---- desktop shell (Electron): updates come from electron-updater, not the service worker
  if (desktop) {
    if (desktop.onUpdateReady) desktop.onUpdateReady(markReady);
    return;
  }

  // ---- install prompt
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; emit('change'); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; emit('change'); });

  // ---- service worker
  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !secure) return;
  var hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (userAskedUpdate) location.reload();
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (r) {
      reg = r;
      if (r.waiting && hadController) markReady();
      r.addEventListener('updatefound', function () {
        var w = r.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) markReady();
        });
      });
      // look for new versions periodically and when the tab becomes visible again
      setInterval(function () { r.update().catch(function () {}); }, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') r.update().catch(function () {}); });
      if (api.isStandalone && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    }).catch(function (e) { console.warn('service worker registration failed', e); });
  });
})();
