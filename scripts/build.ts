// Statična izgradnja: dist/index.html, dist/greska.html i dist/info/index.html, svaka s ugrađenim stilom i skriptom (bez poslužitelja).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { renderErrorPage, renderInfoPage, renderPage } from '../src/page.ts';
import { isMain } from './is-main.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function bundle(entry: string): Promise<string> {
  const result = await esbuild({
    entryPoints: [join(root, entry)],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    // Stranica je UTF-8; bez \uXXXX bijega za hrvatska slova (proračun veličine).
    charset: 'utf8',
  });
  const script = result.outputFiles[0]?.text.trim() ?? '';
  // "</script" inside the inline script would end the element early.
  if (/<\/script/i.test(script)) throw new Error('inline script contains </script');
  return script;
}

export async function build(outDir: string): Promise<void> {
  const script = await bundle('src/main.ts');
  // Tekstovi grešaka su u zasebnoj stranici s vlastitom granicom (odluka c.6957277064); glavna ne raste.
  const errorScript = await bundle('src/errors/main.ts');
  const css = readFileSync(join(root, 'src/style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  const infoCss = (readFileSync(join(root, 'src/style.css'), 'utf8') + readFileSync(join(root, 'src/info.css'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderPage({ script, css }));
  writeFileSync(join(outDir, 'greska.html'), renderErrorPage({ script: errorScript, css }));
  mkdirSync(join(outDir, 'info'), { recursive: true });
  writeFileSync(join(outDir, 'info', 'index.html'), renderInfoPage({ css: infoCss }));
}

if (isMain(import.meta.url)) {
  await build(join(root, 'dist'));
  console.log('dist/index.html, dist/greska.html, dist/info/index.html');
}
