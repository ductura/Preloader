# Sistemski prolaz na GitHub runneru (INT-09)

Tijek `.github/workflows/sistem.yml` podiže cijeli stog iza edgea `:8000` na runneru, prema LOK-2 (`docs/LOKALNO.md`), pa kroz taj pravi edge pokreće INT-07 i INT-06. Pokreće se ručno (`workflow_dispatch`, grane svakog repoa su ulazi) i pushem na `migracija/nextjs`. **Nije required check i ne ulazi u `ci-ok`** (`ci.yml` je jedini tijek koji `ci-ok` vidi); `test/ci-ok.test.ts` dopušta samo taj jedan push, samo na `migracija/nextjs`.

## Što radi

1. Checkout sedam javnih repoa `ductura/*` u `ductura/<Repo>` (bez tajne i PAT-a): Preloader, Aplication_server, Aplication_front, Institution_server, Institution_front_web_chrome, Institution_web_mobile, Web_other. Zadane grane su u `sistem.yml`.
2. `pnpm install --frozen-lockfile` u svakom, pa `pnpm sve` s PostgreSQL 17 kao service containerom runnera (`DATABASE_URL` na `127.0.0.1`). Docker i baza rade samo na runneru, nikad na računalu vlasnika.
3. **INT-07 (A01):** `e2e/vs2/playwright.config.ts` bez lažnih frontenda (`edge-fixture.mjs` se ne koristi), jedan redak po projektu matrice uređaja.
4. **INT-06 (A02/A03):** `scripts/lokalno/admin-otvaranje-ustanove-e2e.test.mjs` iz Aplication_servera (u repou nema `test/sistem`; test je na grani `migracija/cint06-admin-otvaranje-ustanove-e2e`), uz bazu `ductura_int06_test` i token provisioninga iz `Institution_server/.local`.
5. `e2e/system/izvjestaj.mjs` piše tablicu PROLAZ/PAD po scenariju u sažetak runa, SHA svih repoa i `vs-run.json` (artifact `vs-run`). Scenarij koji nije prošao je PAD, a koji nije ni pokrenut NIJE POKRENUTO; posao je crven ako ijedan nije PROLAZ. Nema `skip` ni ponavljanja.

Prijava je samo lažni OIDC (D-09), podaci su izmišljeni (seed). Izvještaj se provjerava s `node --test e2e/system/izvjestaj.test.mjs` (u tijeku je i prvi korak runa).
