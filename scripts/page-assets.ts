// Ugrađeni stil i skripte stranica preloadera (bez Nextovog JavaScripta, `unstable_runtimeJS: false`).
// Zove ih `getStaticProps` u `pages/` pri `next build`, a testovi preko `test/static-build.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build as esbuild } from 'esbuild';

/** Skripta stranice: modul `entry` i poziv njegove funkcije `start`, jedna IIFE bez uvoza. */
async function bundle(root: string, entry: string, start: string): Promise<string> {
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

export interface PageAssets {
  /** Prvi ekran (`src/main.ts`). */
  script: string;
  /** Stranica greške (`src/errors/main.ts`); tekstovi grešaka nisu u skripti prvog ekrana (DAN-935-2). */
  errorScript: string;
  css: string;
}

export async function pageAssets(root: string = process.cwd()): Promise<PageAssets> {
  const css = readFileSync(join(root, 'src/style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  if (/<\/style/i.test(css)) throw new Error('inline style contains </style');
  return {
    script: await bundle(root, 'src/main.ts', 'startPreloader'),
    errorScript: await bundle(root, 'src/errors/main.ts', 'startErrorPage'),
    css,
  };
}
