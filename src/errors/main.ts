// Skripta stranice greške; glavna stranica (`src/main.ts`) ostaje bez tekstova grešaka (proračun).
// Ugrađena skripta stranice `/greska` poziva `startErrorPage` (scripts/page-assets.ts); uvoz sam ništa ne pokreće.
import { showError } from './show.ts';

export function startErrorPage(): void {
  showError(document, location.search);
}
