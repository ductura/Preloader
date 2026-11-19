// Skripta stranice greške; glavna stranica (`src/main.ts`) ostaje bez tekstova grešaka (proračun).
// Poziva ga `src/ui/ErrorScript.tsx` nakon hidracije; uvoz sam ništa ne pokreće.
import { showError } from './show.ts';

export function startErrorPage(): void {
  showError(document, location.search);
}
