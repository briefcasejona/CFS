#!/usr/bin/env node
// build-site.mjs — turn a static web app into an installable, auto-updating PWA (pure JS, no native deps).
//
// Usage: node scripts/installable/build-site.mjs [installable.config.json]
// Writes <outDir>/ with: the entry page (+ manifest/theme/icon tags and the installable client injected),
// copied assets, manifest.webmanifest, icons, version.json and a versioned sw.js precaching every file.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const cfgPath = resolve(root, process.argv[2] ?? 'installable.config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const pkg = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};

const out = resolve(root, cfg.outDir ?? 'site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = [];
const posix = (p) => p.split(sep).join('/');

// ---- copy assets
for (const c of cfg.copy ?? []) {
  const src = resolve(root, c.from);
  if (!existsSync(src)) throw new Error(`copy source missing: ${c.from}`);
  const re = c.include ? new RegExp(c.include) : null;
  const put = (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    if (c.stripSourceMaps && from.endsWith('.js')) writeFileSync(to, readFileSync(from, 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m, '\n'));
    else cpSync(from, to);
    files.push(posix(relative(out, to)));
  };
  if (statSync(src).isDirectory()) {
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (!re || re.test(posix(relative(src, p)))) put(p, join(out, c.to, relative(src, p)));
      }
    };
    walk(src);
  } else put(src, join(out, c.to));
}

// ---- icons
const iconCfg = cfg.icon ?? { text: (cfg.shortName ?? 'APP').slice(0, 3) };
const icons = [];
const iconOut = (name, buf) => { writeFileSync(join(out, name), buf); files.push(name); };
if (iconCfg.source) {
  cpSync(resolve(root, iconCfg.source), join(out, 'icon-512.png')); files.push('icon-512.png');
  icons.push({ src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' });
} else {
  for (const s of [192, 512]) {
    iconOut(`icon-${s}.png`, renderIcon({ ...iconCfg, size: s }));
    icons.push({ src: `./icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' });
  }
  iconOut('icon-maskable-512.png', renderIcon({ ...iconCfg, size: 512, maskable: true }));
  icons.push({ src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  iconOut('apple-touch-icon.png', renderIcon({ ...iconCfg, size: 180, maskable: true }));
}
// Windows .ico for the desktop build (PNG-in-ICO, supported since Vista)
if (!iconCfg.source) {
  const png = renderIcon({ ...iconCfg, size: 256 });
  const hdr = Buffer.alloc(22);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4);
  hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12); hdr.writeUInt32LE(png.length, 14); hdr.writeUInt32LE(22, 18);
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([hdr, png]));
  iconOut('icon-256.png', png);
  files.push('icon.ico');
}

// ---- manifest
const manifest = {
  name: cfg.name, short_name: cfg.shortName ?? cfg.name, description: cfg.description ?? '',
  start_url: './', scope: './', id: './', display: cfg.display ?? 'standalone',
  orientation: cfg.orientation ?? 'any', background_color: cfg.backgroundColor ?? '#000000',
  theme_color: cfg.themeColor ?? '#000000', icons,
};
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
files.push('manifest.webmanifest');

// ---- installable client (update bar, install button, desktop bridge)
cpSync(join(here, 'installable-client.js'), join(out, 'installable-client.js'));
files.push('installable-client.js');

// ---- entry page
let html = readFileSync(resolve(root, cfg.entry ?? 'index.html'), 'utf8');
for (const [a, b] of cfg.replace ?? []) {
  if (!html.includes(a)) throw new Error(`replace target not found in entry page: ${a}`);
  html = html.split(a).join(b);
}
const head = [
  '<link rel="manifest" href="./manifest.webmanifest">',
  `<meta name="theme-color" content="${manifest.theme_color}">`,
  `<link rel="icon" href="./icon-${iconCfg.source ? 512 : 192}.png">`,
  iconCfg.source ? '' : '<link rel="apple-touch-icon" href="./apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<script src="./installable-client.js"></script>',
].filter(Boolean).join('\n  ');
html = html.replace('</head>', `  ${head}\n</head>`);
writeFileSync(join(out, 'index.html'), html);
files.push('index.html');

// ---- version + content hash
const hash = createHash('sha256');
for (const f of [...files].sort()) { hash.update(f); hash.update(readFileSync(join(out, f))); }
const build = hash.digest('hex').slice(0, 12);
const repo = process.env.INSTALLABLE_REPO || process.env.GITHUB_REPOSITORY || cfg.repo || null;
const version = {
  name: cfg.name, version: pkg.version ?? '0.0.0', build, date: new Date().toISOString(), repo,
  desktopAsset: cfg.desktopAsset ?? null,
};
writeFileSync(join(out, 'version.json'), JSON.stringify(version, null, 2));

// ---- service worker
const prefix = (cfg.cachePrefix ?? (cfg.shortName ?? 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '-';
const assets = ['./', ...files.map((f) => './' + f)];
const sw = readFileSync(join(here, 'sw-template.js'), 'utf8')
  .replace('__PREFIX__', prefix)
  .replace('__CACHE__', prefix + build)
  .replace('__ASSETS__', JSON.stringify(assets))
  .replace('__RUNTIME_HOSTS__', JSON.stringify(cfg.runtimeCacheHosts ?? []));
writeFileSync(join(out, 'sw.js'), sw);
// GitHub Pages: don't run Jekyll over the output
writeFileSync(join(out, '.nojekyll'), '');

console.log(`${posix(relative(root, out))}/ ready — ${files.length} files, version ${version.version}, build ${build}${repo ? `, repo ${repo}` : ''}`);
