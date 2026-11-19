# Stanja greške (P-0.5)

`errorViewFor(status)` za HTTP status, kod `session_expired` ili stanje klijenta `offline` vraća ključ teksta iz `errorText` u `src/text.ts`. Nepoznat ulaz vraća `general`.

Tablica u `view.ts` prati `errors` iz `@ductura/contracts/errors/catalog.json` (`ERROR_CATALOG` servera): ključ je zadnji dio `messageKey`. Paket je samo razvojna ovisnost; stranica ga ne čita. Test `test/errors.test.ts` čita katalog iz instaliranog paketa i pada ako tablica i katalog nisu isti, pa podizanje verzije s novim unosom traži i novi tekst.

## Stranica greške (DAN-935-2)

Stranica je `/greska` (i `/greska.html`, rewrite u `next.config.ts`) s vlastitom skriptom (`main.ts`, poziva je `src/ui/ErrorScript.tsx`). `showError` čita samo `?status=`: točno tri ASCII znamenke su HTTP status, inače niz (`offline`, `session_expired`); sve ostalo prikazuje opći tekst. Bez skripte stranica prikazuje opći tekst i poveznicu na početnu. Tekstovi grešaka nisu u skriptama prvog ekrana, pa glavna stranica ne raste; `greska.html` ima vlastiti redak u `budget.json` (granica 2122 B; vlastiti kod bez Nexta 1929 B gzip izmjereno, s Nextom vidi README).

Tekst je lokalan. Usklađivanje s `locales/` servera, CSP zaglavlje na rubu i pravilo proxyja koje statusu daje ovu stranicu su zasebni zadaci.
