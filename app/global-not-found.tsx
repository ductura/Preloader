// 404 za svaku putanju koju ne poslužuje ni stranica ni rewrite (src/rewrites.ts). Aplikacija ima dva
// korijenska layouta, (ulaz) i (ductus), pa 404 ima vlastiti dokument, sa stilom prvog ekrana.
import type { Metadata } from 'next';
import '../src/style.css';
import { errorText } from '../src/text.ts';
import { ErrorMain } from '../src/ui/ErrorMain.tsx';

export const metadata: Metadata = { title: `${errorText.notFound.title} · Ductura` };

export default function GlobalNotFound() {
  return (
    <html lang="hr">
      <body>
        <ErrorMain textKey="notFound" />
      </body>
    </html>
  );
}
