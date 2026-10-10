// Main-menu block for the installable build: "Install app" (PWA), "Download for Windows" (.exe from
// GitHub Releases) and the running version. Uses window.installable, injected by scripts/installable;
// in dev mode (served from the project root) it is absent and the block stays empty.

interface InstallableInfo { name: string; version: string; build: string; date: string; repo: string | null; desktopAsset: string | null }
interface Installable {
  isDesktop: boolean;
  readonly isStandalone: boolean;
  readonly info: InstallableInfo | null;
  readonly updateReady: boolean;
  canInstall(): boolean;
  install(): Promise<boolean>;
  desktopDownloadUrl(): string | null;
  releasesUrl(): string | null;
  applyUpdate(): void;
  on(ev: 'change' | 'update-ready', cb: () => void): void;
}

export function installable(): Installable | null {
  return (window as unknown as { installable?: Installable }).installable ?? null;
}

export function renderInstallLinks(host: HTMLElement) {
  const api = installable();
  if (!api) return;
  const render = () => {
    if (!host.isConnected && host.childElementCount) return;
    const info = api.info;
    const parts: string[] = [];
    if (api.updateReady) parts.push('<button data-a="update" class="primary">Update ready — restart</button>');
    if (!api.isDesktop && api.canInstall()) parts.push('<button data-a="install">Install CFS as an app</button>');
    const dl = !api.isDesktop ? api.desktopDownloadUrl() : null;
    if (dl) parts.push(`<a class="btnlink" href="${dl}" title="Windows may show 'Windows protected your PC' — click More info → Run anyway (the installer is not code-signed)">Download for Windows (.exe)</a>`);
    const ver = info ? `v${info.version} · build ${info.build}${api.isDesktop ? ' · desktop' : api.isStandalone ? ' · installed' : ''}` : '';
    host.innerHTML = `<div class="install-row">${parts.join('')}</div>${ver ? `<div class="muted small">${ver}</div>` : ''}`;
    host.querySelector('[data-a="install"]')?.addEventListener('click', () => { void api.install(); });
    host.querySelector('[data-a="update"]')?.addEventListener('click', () => api.applyUpdate());
  };
  render();
  api.on('change', render);
  api.on('update-ready', render);
}
