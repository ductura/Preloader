# deploy/edge

Rubna konfiguracija preloadera (P-0.10). Sadrži graditelja zaglavlja `Content-Security-Policy` za stranicu s jednom ugrađenom skriptom i stilom (DAN-995), prenesenog iz Ductusa (`src/server/http/content-security-policy.ts`). Stranice poslužuje Next; lokalni edge (`dev-proxy.mjs`) iz njihova HTML-a računa zaglavlje. Testovi (`test/csp.test.ts`, `test/errors-build.test.ts`) provjeravaju isti HTML i iste skripte (`test/static-build.ts`), a `test/next-start.test.ts` stvarne stranice iz `next start` kroz edge. Zaglavlje na Vercelu je zaseban korak (`docs/DEPLOY.md`).

- `contentSecurityPolicyFor(html)` uzima tekst jedine `<script>` i jedine `<style>` iz stranice i vraća politiku koja dopušta samo njihove `sha256` hasheve. Nema `'unsafe-inline'`, `'unsafe-eval'`, noncea ni `*`.
- Jedini dopušteni atribut na tim tagovima je Nextova oznaka `data-next-head=""` (ne mijenja tekst ni izvršavanje). Uz `{ scriptOptional: true }` stranica bez ijedne skripte dobiva `script-src 'none'`.
- Stranica s drugom skriptom ili stilom, drugim atributom na tim tagovima, HTML komentarom, znakom NUL ili skriptom u stranom omotaču (`<svg>`, `<math>`, `<template>`, `<textarea>` i sl.) se odbija (baca grešku). CRLF i sami CR računaju se kao LF, kao u pregledniku.
- Kod radi i u rubnom runtimeu: samo Web Crypto, bez `node:` uvoza.

Objava na rubu, hosting i proxy nisu ovdje (DAN-939). Test je `test/csp.test.ts`.

## Lokalni edge (`dev-proxy.mjs`)

Samo za razvoj: jedno podrijetlo `http://localhost:8000` ispred preloadera (Next.js na :3100), Aplication_fronta, Institution_servera i fronta institucije, po rutama iz ugovora Ductus #2028 §1. Na Vercelu iste rute daju rewriteovi Nexta (`src/rewrites.ts`).

### Karta adresa (D-318, DAN-1574)

Odluka vlasnika 26. 11. 2026., vrijedi lokalno i na ductura.org. Javne putanje su u `ENTRY_REWRITES` u `routes.ts`; adresa u pregledniku ostaje ista, a usluga dobiva svoju putanju uz isti upit:

| Adresa | Ide na |
| --- | --- |
| `/` | front institucije, `/app/web/naslovnica`; resursi stranice su pod `/app/web/_next/` |
| `/ulaz`, `/ulaz/` | preloader; njegov Next ih prepisuje na stranicu `/` (`entryRewrites`, `beforeFiles`) |
| `/preuzimanja`, `/pomoc`, `/kontakt`, `/uvjeti-koristenja`, `/privatnost`, `/pristupacnost`, `/stanje` (i `…/*`) | front institucije, ista putanja pod `/app/web` |
| `/aplikacija`, `/aplikacija/*` | front institucije, `/app/web`, `/app/web/*` |
| `/administracija`, `/administracija/*` | Aplication_front, ista putanja (osnova `/administracija`, Aplication_front#24) |

- `/ulaz`, `/aplikacija` i `/administracija` nose `X-Robots-Tag: noindex` (i uz `405` i `502`); zaglavlje uzvodnog se zamjenjuje.
- Stare adrese lokalni edge preusmjerava po tablici 301 (`LEGACY_REDIRECTS`, 12 redova u `docs/LOKALNO.md` §3): `/admin/*` `301` na `/administracija/*` (osim `/admin/api/*`, koji se nikad ne preusmjerava), `/app/web/naslovnica` i `/aplikacija/naslovnica` `301` na `/`, `/app/web/pristupacnost` i `/app/web/stanje` `301` na javnu adresu, `/prijava` `301` na ekran prijave, `/download/*` `301` na `/preuzimanja/*`, `/api/auth/*` `308` na `/api/v1/auth/*`, a `/app/mobile/*` `302` na `/aplikacija/` dok ne postoji `/mobilna/` (uz pokrenut mobilni front ide njemu). `301` i `302` samo za GET i HEAD; uz `Cache-Control: no-store`. Rewriteovi Nexta stare adrese i `X-Robots-Tag` ne daju; na ductura.org to radi produkcijski rub (zadatak 10, DAN-939).
- `BASES` drži osnovu usluge dok ne prijeđe na novu adresu: front `/app/web` (Next `basePath` `/app`), admin `/administracija` (prešao, Aplication_front#24). Dok front ne prijeđe, `/app/web/*` i `/app/chrome/*` rade bez preusmjeravanja, pa stare i nove adrese rade istodobno. Kad front prijeđe (zadatak 3 karte), u `BASES` se upisuje nova osnova: nove adrese idu doslovno, a stare preusmjeravaju `301`.
- Usporedba je doslovna: `/ulaz/x`, `/Ulaz`, `/%75laz` i `/aplikacijax` nisu javne putanje (404 preloadera).
- Lokalni edge `/ulaz` šalje preloaderu nepromijenjen. Poslan kao `/`, preloader izgrađen s `INSTITUTION_FRONT_URL` bi ga opet prepisao na naslovnicu.
- Na Vercelu bez `INSTITUTION_FRONT_URL` nema rewritea `/`, pa preloader ostaje i na `/`; `/ulaz` radi uvijek.
- Pravilo VS-2 (`307` na `/o/`) vrijedi samo za `Referer` preloadera (`/ulaz`). Poveznice naslovnice na `/app/web/` ostaju na frontu institucije.

Isti cilj za svaku putanju u rewriteovima i u edgeu provjerava `test/route-table.test.ts`; stvarni `next start` `test/next-start.test.ts`, edge `test/dev-proxy.test.ts`, a preglednik `e2e/vs2/routing.spec.ts`. Pokretanje `pnpm edge` (ili sve odjednom `pnpm sve`); rute, varijable i ponašanje su u `docs/LOKALNO.md` §3. Test je `test/dev-proxy.test.ts`. Pravi rub u produkciji nije ovdje (P-0.10).

### VS-2 · Lokalni frontovi iza porta 8000

`pnpm sve` traži `Institution_front_web_chrome`, `Institution_web_mobile` i `Web_other` među susjednim checkoutima ili u `DUCTURA_REPOS`. U svakom prethodno pokrenite `pnpm install`. Za mobilni i ostali front koristite granu `migracija/nextjs`, a za Chrome `migracija/kopija-ductus-front`.

| Ulaz s preloadera | Front i port |
| --- | --- |
| `/app/chrome/` | `Institution_front_web_chrome` na `:5173` |
| `/app/mobile/` | `Institution_web_mobile` na `:5174` uz `BASE_PATH=/app/mobile` |
| `/app/web/` s preloadera (`/ulaz`) na istom podrijetlu | `307` na `/o/`, `Web_other` na `:5175` |

Edge prepoznaje dolazak s preloadera po `Referer` zaglavlju (`/ulaz`; naslovnica `/` to nije). Izravan ulaz i povratak iz AAI@EduHr na `/app/web/`, kao i resursi pod `/app/web/_next/`, i dalje idu na Chromeov host. Ako se zaglavlje `Referer` uklanja, za Web_other može se izravno otvoriti `/o/`.

Za samostalni `pnpm edge` s već pokrenutim frontovima postavite `DUCTURA_EDGE_MOBILE=http://localhost:5174` i `DUCTURA_EDGE_OTHER=http://localhost:5175`. `pnpm sve` te ciljeve postavlja za pronađene checkoute. Eksplicitni cilj koristi već pokrenuti poslužitelj.

Uz pokrenut `pnpm sve`, `pnpm e2e:vs2` provjerava stvarne odgovore frontova kroz `:8000` u svih 12 profila uređaja. `pnpm e2e` dodatno izvršava istu matricu preko pravog edgea i triju HTTP fixturea, kao u CI-ju. Za taj prolaz dovoljni su ovaj repo i preglednici iz Playwrighta.
