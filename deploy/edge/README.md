# deploy/edge

Rubna konfiguracija preloadera (P-0.10). Sadrži graditelja zaglavlja `Content-Security-Policy` za stranicu s jednom ugrađenom skriptom i stilom (DAN-995), prenesenog iz Ductusa (`src/server/http/content-security-policy.ts`). Stranice poslužuje Next; lokalni edge (`dev-proxy.mjs`) iz njihova HTML-a računa zaglavlje. Testovi (`test/csp.test.ts`, `test/errors-build.test.ts`) provjeravaju isti HTML i iste skripte (`test/static-build.ts`), a `test/next-start.test.ts` stvarne stranice iz `next start` kroz edge. Zaglavlje na Vercelu je zaseban korak (`docs/DEPLOY.md`).

- `contentSecurityPolicyFor(html)` uzima tekst jedine `<script>` i jedine `<style>` iz stranice i vraća politiku koja dopušta samo njihove `sha256` hasheve. Nema `'unsafe-inline'`, `'unsafe-eval'`, noncea ni `*`.
- Jedini dopušteni atribut na tim tagovima je Nextova oznaka `data-next-head=""` (ne mijenja tekst ni izvršavanje). Uz `{ scriptOptional: true }` stranica bez ijedne skripte dobiva `script-src 'none'`.
- Stranica s drugom skriptom ili stilom, drugim atributom na tim tagovima, HTML komentarom, znakom NUL ili skriptom u stranom omotaču (`<svg>`, `<math>`, `<template>`, `<textarea>` i sl.) se odbija (baca grešku). CRLF i sami CR računaju se kao LF, kao u pregledniku.
- Kod radi i u rubnom runtimeu: samo Web Crypto, bez `node:` uvoza.

Objava na rubu, hosting i proxy nisu ovdje (DAN-939). Test je `test/csp.test.ts`.

## Lokalni edge (`dev-proxy.mjs`)

Samo za razvoj: jedno podrijetlo `http://localhost:8000` ispred preloadera (Next.js na :3100), Aplication_fronta, Institution_servera i fronta institucije, po rutama iz ugovora Ductus #2028 §1. Na Vercelu iste rute daju rewriteovi Nexta (`src/rewrites.ts`). Pokretanje `pnpm edge` (ili sve odjednom `pnpm sve`); rute, varijable i ponašanje su u `docs/LOKALNO.md` §3. Test je `test/dev-proxy.test.ts`. Pravi rub u produkciji nije ovdje (P-0.10).
