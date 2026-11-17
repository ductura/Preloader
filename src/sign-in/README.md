# src/sign-in

Ulaz u prijavu (P-0.7). Studenti se prijavljuju isključivo preko AAI@EduHr (D-09): poveznica vodi samo na `/api/v1/auth/login`, a poslužitelj odgovara preusmjeravanjem na AAI@EduHr (S-1E-a). Drugog načina prijave nema.

- `safeReturnTo(value)` i `DEFAULT_RETURN_TO`: povratna adresa nakon prijave. Prihvaća se samo putanja ove aplikacije. Vanjski host, `//`, `\`, `javascript:`, kontrolni i nevidljivi znakovi te `/api` u bilo kojem zapisu daju `/`. Preneseno doslovno iz Ductusa (`src/server/auth/return-to.ts`).
- `signInTarget(raw)` i `signInHref(target)`: poveznica `/api/v1/auth/login?returnTo=<kodirano>`. Preneseno iz Ductusa (`src/components/auth/sign-in-link.ts`), jedina promjena je putanja `/api/v1/`.

Moduli se zasad samo testiraju (`test/sign-in.test.ts`). Prikaz, ugradnja u stranicu i FIDO2 korak dolaze u kasnijim dijelovima DAN-937. `signedInRedirect` iz Ductusa nije prenesen jer traži poslužitelj koji čita sesijski kolačić.
