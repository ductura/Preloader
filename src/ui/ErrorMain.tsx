// Stranica greške (DAN-935-2): bez skripte opći tekst; skripta (`src/errors/main.ts`) prema `?status=`
// upisuje tekst stanja. 404 (`pages/404.tsx`) odmah prikazuje `notFound`, bez skripte.
import { errorText, text } from '../text.ts';

export function ErrorMain({ textKey = 'general' }: { textKey?: keyof typeof errorText }) {
  const { title, body } = errorText[textKey];
  return (
    <main className="sheet">
      <p className="brand">Ductur<span>a</span></p>
      <h1 id="error-title">{title}</h1>
      <p id="error-body" className="lead">{body}</p>
      <p><a className="button" href="/">{text.home}</a></p>
    </main>
  );
}
