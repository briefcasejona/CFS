// Packages the compiled game into dist/ as a self-contained page for sharing
// (relative paths, three.js from jsDelivr instead of node_modules).
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const rel = relative(join(root, 'build', 'src'), p).split(sep).join('/');
      const out = join(dist, 'js', rel);
      mkdirSync(join(out, '..'), { recursive: true });
      // drop source-map comments: the .ts sources are not published
      writeFileSync(out, readFileSync(p, 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m, '\n'));
      files.push(`js/${rel}`);
    }
  }
};
walk(join(root, 'build', 'src'));
cpSync(join(root, 'styles.css'), join(dist, 'styles.css'));
files.push('styles.css');

const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace('src="/build/src/main.js"', 'src="js/main.js"');
const page = `<title>CFS Combat Flight Simulator</title>
<link rel="stylesheet" href="styles.css">
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js" } }</script>
${body.trim()}
`;
writeFileSync(join(dist, 'index.html'), page);
writeFileSync(join(dist, 'files.json'), JSON.stringify(files, null, 2));
console.log(`dist/ ready: index.html + ${files.length} files`);
