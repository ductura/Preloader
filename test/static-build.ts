// Stranice kao niz iz istih komponenti i istih ugrađenih skripti i stila koje poslužuje Next.js
// (`pages/`, `scripts/page-assets.ts`), zapisane kao `index.html` i `greska.html`. Služi testovima
// (jedan poziv servera, tekstovi grešaka, CSP, proračun); stvarne stranice mjeri `pnpm budget` nad `.next`.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageAssets } from '../scripts/page-assets.ts';
import { renderErrorPage, renderPage } from '../src/page.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function build(outDir: string): Promise<void> {
  const { script, errorScript, css } = await pageAssets(root);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderPage({ script, css }));
  writeFileSync(join(outDir, 'greska.html'), renderErrorPage({ script: errorScript, css }));
}
