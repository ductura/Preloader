# Stanja greške (P-0.5)

`errorViewFor(status)` za HTTP status, kod `session_expired` ili stanje klijenta `offline` vraća ključ teksta iz `errorText` u `src/text.ts`. Nepoznat ulaz vraća `general`.

Tablica u `view.ts` prati `errors` iz `@ductura/contracts/errors/catalog.json` (`ERROR_CATALOG` servera): ključ je zadnji dio `messageKey`. Paket je samo razvojna ovisnost; stranica ga ne čita. Test `test/errors.test.ts` čita katalog iz instaliranog paketa i pada ako tablica i katalog nisu isti, pa podizanje verzije s novim unosom traži i novi tekst.

Tekst je lokalan. Usklađivanje s `locales/` servera i prikaz na stranici su zasebni zadaci.
