# src/sign-in

Ulaz u prijavu (P-0.7). Studenti se prijavljuju isključivo preko AAI@EduHr (D-09): poveznica vodi samo na `/api/v1/auth/login`, a poslužitelj odgovara preusmjeravanjem na AAI@EduHr (S-1E-a). Drugog načina prijave nema.

- `safeReturnTo(value)` i `DEFAULT_RETURN_TO`: povratna adresa nakon prijave. Prihvaća se samo putanja ove aplikacije. Vanjski host, `//`, `\`, `javascript:`, kontrolni, formatni i razdjelni znakovi te `/api` u bilo kojoj veličini slova i postotnom kodiranju (do tri razine; dublje se odbija) daju `/`. Zapisi poput `/api;x` ili `/x/%2e%2e%2fapi` ostaju putanja jer ih preglednik ne normalizira; proxy ih ne smije dekodirati (P-0.10). Preneseno doslovno iz Ductusa (`src/server/auth/return-to.ts`).
- `signInTarget(raw)` i `signInHref(target)`: poveznica `/api/v1/auth/login?returnTo=<kodirano>`. Preneseno iz Ductusa (`src/components/auth/sign-in-link.ts`), jedina promjena je putanja `/api/v1/`.

Stranica (`src/page.ts`) gradi poveznicu „Prijava preko AAI@EduHr” iz `signInHref(signInTarget(config.signIn.returnTo))`, s povratkom na `/app/web/` (ugovor Ductus #2028 §3.1). Uz nju je „Administracija platforme” na `/admin/prijava`; to je prijava administratora platforme u Aplication_frontu, ne prijava studenata ni računa institucije. Testovi su `test/sign-in.test.ts`, `test/functional.test.ts` i `e2e/matrix/`. FIDO2 korak dolazi u kasnijem dijelu DAN-937. `signedInRedirect` iz Ductusa nije prenesen jer traži poslužitelj koji čita sesijski kolačić.
