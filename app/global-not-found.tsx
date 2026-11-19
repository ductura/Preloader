// 404 za svaku putanju koju ne poslužuje ni stranica ni rewrite (src/rewrites.ts), isti tekst kao pages/404.tsx.
// Uz app/ (/ductus) Next inače daje vlastitu englesku 404; ovaj dokument ima stil prvog ekrana.
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
