import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir } from 'node:fs/promises';
await mkdir('dist/main', { recursive: true });
await bundle({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron', 'selection-hook'] });
await bundle({ entryPoints: ['src/main/preload.ts'], outfile: 'dist/main/preload.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron'] });
await viteBuild({ root: 'src/renderer', base: './', build: { outDir: '../../dist/renderer', emptyOutDir: true }, esbuild: { jsx: 'automatic' } });
