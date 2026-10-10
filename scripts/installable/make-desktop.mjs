#!/usr/bin/env node
// make-desktop.mjs — assemble an Electron project (desktop-build/) around the built site/ so CI can run
// electron-builder. Electron itself is only ever installed in CI (keeps local machines free of native binaries).
//
// Usage (after build-site.mjs): node scripts/installable/make-desktop.mjs [installable.config.json]
// Env: GITHUB_REPOSITORY=owner/name (set automatically in GitHub Actions), RELEASE_VERSION=1.2.3 (optional)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const cfg = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? 'installable.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const d = cfg.desktop ?? {};
const site = resolve(root, cfg.outDir ?? 'site');
if (!existsSync(join(site, 'index.html'))) throw new Error('run build-site.mjs first');

const repo = process.env.GITHUB_REPOSITORY || process.env.INSTALLABLE_REPO || cfg.repo;
if (!repo) throw new Error('GITHUB_REPOSITORY (owner/name) is required for auto-update publishing');
const [owner, name] = repo.split('/');
const version = (process.env.RELEASE_VERSION || pkg.version).replace(/^v/, '');
const productName = d.productName ?? cfg.shortName ?? cfg.name;
const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const out = resolve(root, d.outDir ?? 'desktop-build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, 'desktop', 'main.js'), join(out, 'main.js'));
cpSync(join(here, 'desktop', 'preload.js'), join(out, 'preload.js'));
cpSync(site, join(out, 'site'), { recursive: true });

const desktopPkg = {
  name: `${slug}-desktop`, productName, version, description: cfg.description ?? productName,
  author: d.author ?? owner, homepage: `https://github.com/${repo}`, main: 'main.js', private: true,
  dependencies: { 'electron-updater': d.updaterVersion ?? '6.8.9' },
  devDependencies: { electron: d.electronVersion ?? '44.7.0', 'electron-builder': d.builderVersion ?? '26.15.3' },
  build: {
    appId: d.appId ?? `io.github.${owner.toLowerCase()}.${slug}`,
    productName,
    directories: { output: 'dist' },
    files: ['main.js', 'preload.js', 'site/**/*'],
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'site/icon-256.png' },
    nsis: {
      oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true,
      shortcutName: productName, artifactName: cfg.desktopAsset ?? `${productName}-Setup.exe`,
    },
    publish: [{ provider: 'github', owner, repo: name, releaseType: 'release' }],
  },
};
writeFileSync(join(out, 'package.json'), JSON.stringify(desktopPkg, null, 2));
console.log(`desktop-build/ ready — ${productName} ${version}, publishes to github.com/${repo}`);
