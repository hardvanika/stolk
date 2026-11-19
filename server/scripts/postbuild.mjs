// Bundle the server into dist/ so the folder runs on its own (no node_modules needed),
// and give it a package.json marking the files as ES modules.
import { build } from 'esbuild';
import { rmSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: ['src/main.ts', 'src/seed-cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // Some dependencies are CommonJS and call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  tsconfig: 'tsconfig.json',
  logLevel: 'warning',
});
writeFileSync(new URL('package.json', dist), JSON.stringify({ type: 'module' }) + '\n');
