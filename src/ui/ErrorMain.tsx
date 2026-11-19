// Stranica greške (DAN-935-2): bez skripte opći tekst; `ErrorScript` prema `?status=` upisuje tekst stanja.
import { errorText, text } from '../text.ts';

export function ErrorMain() {
  const { title, body } = errorText.general;
  return (
    <main className="sheet">
      <p className="brand">Ductur<span>a</span></p>
      <h1 id="error-title">{title}</h1>
      <p id="error-body" className="lead">{body}</p>
      <p><a className="button" href="/">{text.home}</a></p>
    </main>
  );
}
