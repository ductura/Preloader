// Ulaz skripte stranice greške; glavna stranica (`src/main.ts`) ostaje bez tekstova grešaka (proračun).
import { showError } from './show.ts';

showError(document, location.search);
