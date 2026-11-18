# Laboratorij spremanja i oporavka v1 (`pnpm lab:oporavak`)

DAN-1096. Izvor: Daniel, „Može” (18. 11. 2026., odgovor na prijedlog laboratorija). Risk: critical.

## Ugovor

Jedna naredba odgovara na pitanje: vraća li Ductura studentu zadnju potvrđenu verziju rada nakon što se server ugasi i ponovno podigne? To je API dio tvrdnje VS-1.13 (`PLAN-MIGRACIJE.md` §4a-1); preglednik nije u v1.

Ulaz: `SERVER_DIR`, kopija `ductura/server` s instaliranim paketima i `pnpm build`, te PostgreSQL alati (`initdb`, `pg_ctl`, `psql`) u `PATH`. Radi samo na Linuxu, kao i stog VS-1 (DAN-759).

Tijek:

1. `pnpm stack:vs1 up` u `SERVER_DIR`, s `--env ci` u CI-ju (`CI=true`), inače `--env local`. Ako stog već radi (postoji `state.json`), laboratorij ne počinje i taj stog ne gasi.
2. Izmišljeni student, kolegij i zadatak upisuju se `psql`-om kroz socket stoga (samo priprema, kao `scripts/stack/vs1-commit-check.ts`); sesija je upisani red.
3. Ključ potvrda kojem laboratorij vjeruje ne dolazi iz odgovora servera. Javni ključ izvodi se ovdje iz sjemena kojim pokrenuti server potpisuje (`DUCTUS_DEV_SIGNING_KEY_FILE` iz okruženja tog procesa, `stackServerEnv` stoga). Oznaka, verzija i domena tog ključa čitaju se iz registra `evidence.signing_key`. U domeni tog ključa mora biti točno jedan aktivan ključ potvrda (nije opozvan, `valid_to` nije prošao), i to upravo ključ sjemena.
4. Kao student kroz API: `evidence/open` sa `start: true`, zatim `evidence/commit` s jednim segmentom čiji dokument nosi jedinstvenu izmišljenu rečenicu.
5. `pnpm stack:vs1 down`, provjera da je veza na port servera odbijena, pa `pnpm stack:vs1 up` nad istim direktorijem stoga.
6. Kao student kroz API: `evidence/open` bez `start` (otvara samo postojeći rad).
7. `pnpm stack:vs1 down` uvijek, i nakon pada.

## Tvrdnje

Svaka ima PASS ili FAIL u izvještaju. Ijedan FAIL ili prekid daje izlazni kod različit od 0.

| ID | Tvrdnja |
| --- | --- |
| L-1 | `evidence/commit` odgovara 200 sa statusom `committed`, revizijom 1 i potvrdom v2 u istom odgovoru (DAN-887; odgođena potvrda je VS-1b). Ed25519 potpis potvrde (D-92) provjerava se ovdje (`node:crypto`) ključem iz koraka 3. Potvrda mora imenovati upravo ovaj commit: dokument, transakciju, reviziju 1, studenta, SHA-256 poslanog segmenta i domenu ključa. Status `signed` bez provjerenog potpisa je FAIL. |
| L-2 | Restart je stvaran: između `down` i `up` veza na port servera je odbijena, a PID servera nakon `up` razlikuje se od PID-a prije. Svaki drugi ishod je FAIL: odgovor bilo kojeg statusa, preusmjerenje, prekid nakon spajanja ili isteklo vrijeme. |
| L-3 | Drugi `open` vraća isti `documentId`. |
| L-4 | Drugi `open` vraća `currentRevision` 1. |
| L-5 | Dokument iz drugog `open`, u strogom standardnom base64 (bez znakova izvan abecede, prijeloma redaka i base64url zapisa), bajt po bajt jednak je poslanom i sadrži jedinstvenu rečenicu. |
| L-6 | SHA-256 dokumenta iz drugog `open`, izračunat ovdje (`node:crypto`), jednak je `documentHash` servera i hashu poslanog dokumenta. |

Čitanje (L-3 do L-6) dokazuje se samo kroz API servera kao student. Administratorska veza na bazu služi samo za pripremu i za oznaku ključa iz registra; ne računa se kao dokaz čitanja.

Provjera potvrde ima testove na serverovu ugovornom vektoru potvrde v2. `test/fixtures/receipt-v2-golden.json` je kopija `chain.verificationKey` i `receiptV2.accepted[0]` iz `server/domain/forensics/golden-vectors/evidence-v2.json` na `f2d5178f` (blob `a402820b`). CI korak `node scripts/lab/vendored.ts` uspoređuje kopiju s izvorom na `SERVER_SHA`.

## Izvještaj

JSON samo u `LAB_REPORT` (zadano `lab-oporavak.json`). Na stdout ide kratak sažetak po tvrdnji, a `pnpm` ondje piše i svoje retke, pa stdout nije JSON. `preloaderSha` je uvijek `git rev-parse HEAD`. `LAB_PRELOADER_SHA` se samo uspoređuje s njim, a razlika je greška i FAIL. CI zato izvodi checkout glave PR-a, a ne GitHubova probnog merge commita. Polja `preloaderSha`, `webSha`, `serverSha`, `browser`, `documentId`, `revision`, `hash` imaju imena iz VS-1.12, da ih budući `vs-run.json` (DAN-887) preuzme. `webSha` i `browser` su `null` jer preglednik nije u v1. `serverDirty` dolazi iz `state.json` stoga.

## Granice v1

- Prijava lažnim OIDC-om nije pokrivena (DAN-887).
- Nema preglednika ni dnevnika na uređaju (DAN-1022).
- Radnik se ne restartira jer ga stog VS-1 još nema.
- Laboratorij uvozi pomoćne funkcije stoga iz `SERVER_DIR` (`post`, `stackServerEnv`, `canonicalizeJcs`) i zlatni segment; `state.json` čita sam; CI veže točan SHA servera.
- CI postavlja PGDG ključ samo ako datoteka ključa sadrži točno zadani javni ključ i nijedan drugi (`scripts/ci/pgdg-key.ts`).
