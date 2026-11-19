// Vlastiti kod stranica bez Nexta: index.html i greska.html s ugrađenim stilom i skriptom, kao nekadašnji `dist`.
// Služi testovima (jedan poziv servera, tekstovi grešaka, CSP, proračun vlastitog koda). Stranice koje se
// poslužuju gradi `next build`; njihovu veličinu s Nextom mjeri `pnpm budget`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { renderErrorPage, renderPage } from '../src/page.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Skripta stranice: modul `entry` i poziv njegove funkcije `start`, kao u `src/ui/*Script.tsx`. */
async function bundle(entry: string, start: string): Promise<string> {
  const result = await esbuild({
    stdin: { contents: `import { ${start} } from './${entry}';\n${start}();\n`, resolveDir: root, loader: 'ts' },
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
  const script = await bundle('src/main.ts', 'startPreloader');
  // Tekstovi grešaka su u zasebnoj stranici s vlastitom granicom (odluka c.6957277064); glavna ne raste.
  const errorScript = await bundle('src/errors/main.ts', 'startErrorPage');
  const css = readFileSync(join(root, 'src/style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderPage({ script, css }));
  writeFileSync(join(outDir, 'greska.html'), renderErrorPage({ script: errorScript, css }));
}
