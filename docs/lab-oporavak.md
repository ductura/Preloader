# Laboratorij spremanja i oporavka v1 (`pnpm lab:oporavak`)

DAN-1096. Izvor: Daniel, „Može” (18. 11. 2026., odgovor na prijedlog laboratorija). Risk: critical.

## Ugovor

Jedna naredba odgovara na pitanje: vraća li Ductura studentu zadnju potvrđenu verziju rada nakon što se server ugasi i ponovno podigne? To je API dio tvrdnje VS-1.13 (`PLAN-MIGRACIJE.md` §4a-1); preglednik nije u v1.

Ulaz: `SERVER_DIR`, kopija `ductura/server` s instaliranim paketima i `pnpm build`, te PostgreSQL alati (`initdb`, `pg_ctl`, `psql`) u `PATH`. Radi samo na Linuxu, kao i stog VS-1 (DAN-759).

Tijek:

1. `pnpm stack:vs1 up` u `SERVER_DIR`, s `--env ci` u CI-ju (`CI=true`), inače `--env local`.
2. Izmišljeni student, kolegij i zadatak upisuju se `psql`-om kroz socket stoga (samo priprema, kao `scripts/stack/vs1-commit-check.ts`); sesija je upisani red.
3. Kao student kroz API: `evidence/open` sa `start: true`, zatim `evidence/commit` s jednim segmentom čiji dokument nosi jedinstvenu izmišljenu rečenicu.
4. `pnpm stack:vs1 down`, provjera da `/api/v1/health` više ne odgovara, pa `pnpm stack:vs1 up` nad istim direktorijem stoga.
5. Kao student kroz API: `evidence/open` bez `start` (otvara samo postojeći rad).
6. `pnpm stack:vs1 down` uvijek, i nakon pada.

## Tvrdnje

Svaka ima PASS ili FAIL u izvještaju. Ijedan FAIL ili prekid daje izlazni kod različit od 0.

| ID | Tvrdnja |
| --- | --- |
| L-1 | `evidence/commit` odgovara 200, `committed`, revizija 1 i potpisana potvrda u istom odgovoru (DAN-887; odgođena potvrda je VS-1b). |
| L-2 | Restart je stvaran: server ne odgovara između `down` i `up`, a PID servera nakon `up` razlikuje se od PID-a prije. |
| L-3 | Drugi `open` vraća isti `documentId`. |
| L-4 | Drugi `open` vraća `currentRevision` 1. |
| L-5 | Dokument iz drugog `open` bajt po bajt jednak je poslanom i sadrži jedinstvenu rečenicu. |
| L-6 | SHA-256 dokumenta iz drugog `open`, izračunat ovdje (`node:crypto`), jednak je `documentHash` servera i hashu poslanog dokumenta. |

Čitanje (L-3 do L-6) dokazuje se samo kroz API servera kao student. Administratorska veza na bazu služi samo za pripremu i ne računa se kao dokaz.

## Izvještaj

JSON na stdout i u `LAB_REPORT` (zadano `lab-oporavak.json`). Polja `preloaderSha`, `webSha`, `serverSha`, `browser`, `documentId`, `revision`, `hash` imaju imena iz VS-1.12, da ih budući `vs-run.json` (DAN-887) preuzme. `webSha` i `browser` su `null` jer preglednik nije u v1. `serverDirty` dolazi iz `state.json` stoga.

## Granice v1

- Prijava lažnim OIDC-om nije pokrivena (DAN-887).
- Nema preglednika ni dnevnika na uređaju (DAN-1022).
- Radnik se ne restartira jer ga stog VS-1 još nema.
- Laboratorij uvozi pomoćne funkcije stoga iz `SERVER_DIR` (`post`, `canonicalizeJcs`) i zlatni segment; `state.json` čita sam; CI veže točan SHA servera.
