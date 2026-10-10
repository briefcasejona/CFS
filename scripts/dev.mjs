// Dev mode: TypeScript compiler in watch mode + static server. Reload the browser after edits.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');

// initial full build, then watch + serve
const first = spawn(process.execPath, [tsc, '-p', root], { stdio: 'inherit', cwd: root });
first.on('exit', () => {
  spawn(process.execPath, [tsc, '-p', root, '--watch', '--preserveWatchOutput'], { stdio: 'inherit', cwd: root });
  spawn(process.execPath, [resolve(root, 'scripts', 'serve.mjs')], { stdio: 'inherit', cwd: root });
});
