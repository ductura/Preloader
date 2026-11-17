# Stanja greške (P-0.5)

`errorViewFor(status)` za HTTP status, kod `session_expired` ili stanje klijenta `offline` vraća ključ teksta iz `errorText` u `src/text.ts`. Nepoznat ulaz vraća `general`.

Tablica u `view.ts` prati `errors` iz `@ductura/contracts/errors/catalog.json` (`ERROR_CATALOG` servera): ključ je zadnji dio `messageKey`. Paket je samo razvojna ovisnost; stranica ga ne čita. Test `test/errors.test.ts` čita katalog iz instaliranog paketa i pada ako tablica i katalog nisu isti, pa podizanje verzije s novim unosom traži i novi tekst.

## Stranica greške (DAN-935-2)

Izgradnja daje `dist/greska.html` s vlastitom skriptom (`main.ts`). `showError` čita samo `?status=`: točno tri ASCII znamenke su HTTP status, inače niz (`offline`, `session_expired`); sve ostalo prikazuje opći tekst. Bez skripte stranica prikazuje opći tekst i poveznicu na početnu. Tekstovi grešaka nisu u `index.html`, pa glavna stranica ne raste; `greska.html` ima vlastiti redak u `budget.json` (1929 B gzip izmjereno, granica 2122 B).

Tekst je lokalan. Usklađivanje s `locales/` servera, CSP zaglavlje na rubu i pravilo proxyja koje statusu daje ovu stranicu su zasebni zadaci.
