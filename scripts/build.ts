// Statična izgradnja: dist/index.html s ugrađenim stilom i skriptom (bez poslužitelja).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { renderPage } from '../src/page.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function build(outDir: string): Promise<void> {
  const bundle = await esbuild({
    entryPoints: [join(root, 'src/main.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  });
  const script = bundle.outputFiles[0]?.text.trim() ?? '';
  // "</script" inside the inline script would end the element early.
  if (/<\/script/i.test(script)) throw new Error('inline script contains </script');
  const css = readFileSync(join(root, 'src/style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderPage({ script, css }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build(join(root, 'dist'));
  console.log('dist/index.html');
}
