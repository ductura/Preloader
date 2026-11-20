// Hrvatski 404 za zahtjeve koje App Router obrađuje izvan lokalnog statičnog dokumenta.
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
