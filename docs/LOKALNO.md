# Ductura lokalno: cijeli tok na jednom računalu

Ugovor toka prijave i instance je Ductus #2028, komentar 6993786629 (§1 portovi i rute, §2 provisioning, §3 tok u pregledniku). Ovaj dokument opisuje kako ga pokrenuti lokalno. Preglednik koristi samo jedno podrijetlo, **http://localhost:8000**. Pravi rubni proxy u produkciji je zaseban korak (P-0.10).

## 1. Što treba

- Node.js 24 ili noviji i pnpm (`corepack enable` ili `npm install --global pnpm`).
- PostgreSQL 16 ili noviji (produkcija je 17) na ovom računalu, na jedan od dva načina:
  - `DATABASE_URL` sa superkorisnikom, na `localhost`, `127.0.0.1` ili `[::1]` (npr. `postgres://postgres:<lozinka>@localhost:5432/postgres`); baza u adresi se zanemaruje;
  - ili Docker i `pnpm sve --docker`: skripta pokrene (ili ponovno upotrijebi) kontejner `ductura-lokalno-postgres` sa slikom `postgres:17` na `127.0.0.1:54320`. Lozinka kontejnera je javna i samo lokalna (`ductura-lokalno-samo`).
- Checkouti svih repozitorija jedan do drugoga, u istoj mapi:

```text
ductura/
  Preloader/                     <- ovaj repo
  Aplication_server/
  Aplication_front/
  Institution_server/            <- sadrži i packages/test-fakes/oidc
  Institution_front_web_chrome/
```

Ako su checkouti negdje drugdje, postavite `DUCTURA_REPOS` na mapu u kojoj su. Velika i mala slova u imenu mape nisu bitna (`aplication_server` vrijedi kao `Aplication_server`).

Grane provjerene 20. 11. 2026. (LOK-2): Institution_server `migracija/kopija-ductus-backend`, Institution_front_web_chrome `migracija/kopija-ductus-front`, Aplication_server i Aplication_front `migracija/faza2`.

U svakom repozitoriju jednom pokrenite `pnpm install`.

## 2. Pokretanje

U ovom repozitoriju:

```bash
pnpm install
DATABASE_URL='postgres://postgres:<lozinka>@localhost:5432/postgres' pnpm sve
# ili, s Dockerom:
pnpm sve --docker
```

Isto radi u PowerShellu, cmd-u i terminalu na macOS-u i Linuxu: skripta ne treba bash, a pnpm pokreće kroz Node. Na Windowsu ju pokrenite kroz `pnpm sve`, ne kao `node scripts/sve-lokalno.mjs`.

`pnpm sve`:

1. uz `--docker` pokrene PostgreSQL 17 u Dockeru i čeka da prihvaća veze;
2. izgradi preloader (`pnpm run build`);
3. pripremi Aplication_server: stvori bazu `ductura` ako je nema, `pnpm run db:migrate` i lokalnog administratora platforme `admin` (`pnpm run admin:stvori admin --zamijeni`, lozinka na stdin). Lozinka se stvara jednom u `Aplication_server/.local/admin-lozinka` (0600) i nikad se ne ispisuje;
4. pokrene preloader (`next start` na :3100) i usluge iz ugovora §1:

| Usluga | Port | Mapa | Naredba |
|---|---|---|---|
| preloader (Next.js) | 3100 | ovaj repo | `pnpm run start` |
| Aplication_server | 3110 | `Aplication_server` | `pnpm run dev` |
| Aplication_front (`basePath: "/admin"`) | 3120 | `Aplication_front` | `pnpm run dev` |
| Institution_server | 4000 | `Institution_server` | `pnpm run lokalno` (baza `ductus`, migracije, izmišljeni seed, `dist/server.js`) |
| lažni OIDC (simulator AAI@EduHr) | 8090 | `Institution_server` | isti `pnpm run lokalno` |
| front institucije | 5173 | `Institution_front_web_chrome` | `pnpm run dev` |
| edge | 8000 | ovaj repo | `node deploy/edge/dev-proxy.mjs` |

5. Aplication_server pokrene tek kad Institution_server zapiše token provisioninga (`Institution_server/.local/provisioning-token`), pa oba poslužitelja imaju isti token (§2);
6. ispiše koje usluge rade (Institution_server prvi put treba oko minutu za migracije i izgradnju), gdje je lozinka administratora i adresu **http://localhost:8000/**.

Usluga čiji checkout, `package.json` ili skripta nedostaje preskače se, a razlog se ispiše (na primjer `Aplication_front nema skriptu "dev"`). Ostale rade dalje. Bez baze (ni `DATABASE_URL` ni `--docker`) skripta to ispiše i pokrene ostalo; Institution_server tada ne radi. Ispis svake usluge ima oznaku (`[institution-server] ...`). Ctrl+C gasi sve usluge s njihovim podprocesima.

Okolina koju skripta postavlja:

- Aplication_server: `DATABASE_URL` na bazu `ductura`, `INSTITUTION_SERVER_URL=http://127.0.0.1:4000`, `AAI_OIDC_ISSUER=http://localhost:8090` (issuer nove institucije; obrazac ga ne traži), `DUCTURA_ADMIN_TOKEN_SECRET` (nova pri svakom pokretanju, pa se administrator nakon ponovnog pokretanja prijavljuje iznova) i `DUCTURA_PROVISIONING_TOKEN` iz `.local/` Institution_servera.
- Aplication_front: `APLICATION_SERVER_URL=http://127.0.0.1:3110`, `PUBLIC_ORIGIN=http://localhost:8000`.
- Institution_server: samo `DATABASE_URL` na bazu `ductus`. Sve ostalo (server na `127.0.0.1:4000`, `APP_ORIGIN=http://localhost:8000`, issuer `http://localhost:8090`, povratak `http://localhost:8000/api/v1/auth/callback`, lozinke prijava i token provisioninga u `.local/`) postavlja njegov `pnpm lokalno` (vidi njegov `docs/LOKALNO.md`).
- front institucije: `INSTITUTION_SERVER_URL=http://127.0.0.1:4000`, `OIDC_ISSUER=http://localhost:8090` (CSP `form-action` stranice pušta preusmjeravanje odjave na simulator AAI@EduHr; bez njega odjava stane na stranici).
- Ostalo iz Vaše okoline prolazi nepromijenjeno; `PORT`, `DATABASE_URL`, `DUCTURA_PROVISIONING_TOKEN` i `DUCTURA_ADMIN_TOKEN_SECRET` iz okoline se ne prenose. Nijedna tajna se ne ispisuje.

Sam edge bez ostalih usluga: `pnpm build && pnpm start` u jednom terminalu i `pnpm edge` u drugom. Preloader iza edgea nije `next dev`: ondje Next dodaje vlastite skripte, pa stranica dobiva strogu zamjensku politiku i vidi se bez stila (§3).

## 3. Edge (`deploy/edge/dev-proxy.mjs`)

| Putanja | Ide na |
|---|---|
| `/` (uz isti upit) | naslovnica fronta institucije :5173, putanja `/app/web/naslovnica`; adresa ostaje `/` |
| `/ulaz`, `/ulaz/` | preloader (Next.js) :3100; Next ih sam prepisuje na svoju stranicu `/`; `X-Robots-Tag: noindex` |
| `/preuzimanja`, `/pomoc`, `/kontakt`, `/uvjeti-koristenja`, `/privatnost`, `/pristupacnost`, `/stanje` (i `…/*`) | front institucije :5173, ista putanja pod `/app/web` (npr. `/app/web/stanje`); adresa ostaje kratka |
| `/aplikacija`, `/aplikacija/*` | front institucije :5173, `/app/web`, `/app/web/*`; `X-Robots-Tag: noindex` |
| `/administracija`, `/administracija/*` | Aplication_front :3120, `/admin`, `/admin/*`; `X-Robots-Tag: noindex` |
| `/greska.html`, `/_next/*` i sve ostalo | preloader (Next.js) :3100; drugo od GET i HEAD daje `405` |
| `/admin`, `/admin/*` | Aplication_front :3120 |
| `/api/v1`, `/api/v1/*` | Institution_server :4000 |
| `/app/web`, `/app/web/*`, `/app/chrome`, `/app/chrome/*` | front institucije :5173 |
| `/app/mobile`, `/app/mobile/*` | Institution_web_mobile (`DUCTURA_EDGE_MOBILE`; bez nje preloader, 404) |
| `/o`, `/o/*` | Web_other (`DUCTURA_EDGE_OTHER`; bez nje preloader, 404) |

Javne putanje su iz karte adresa (D-318, odluka vlasnika 26. 11. 2026., DAN-1574). Adresa u pregledniku ostaje ista, a usluga dobiva svoju putanju uz isti upit (`ENTRY_REWRITES` u `deploy/edge/routes.ts`). Iste javne putanje daju i rewriteovi Nexta na ductura.org (`entryRewrites` u `src/rewrites.ts`, `beforeFiles`); na Vercelu bez `INSTITUTION_FRONT_URL` preloader ostaje i na `/`.

**Stare adrese** lokalni edge preusmjerava (`LEGACY_REDIRECTS`), uz isti upit i `Cache-Control: no-store`:

| Stara adresa | Odgovor |
|---|---|
| `/prijava`, `/prijava/` | `307` na `/app/web/prijava` (ekran prijave web inačice; nakon prelaska fronta `/aplikacija/prijava`) |
| `/aplikacija/naslovnica` | `307` na `/` |
| `/download`, `/download/*` | `307` na `/preuzimanja`, `/preuzimanja/*` |
| `/api/auth`, `/api/auth/*` | `308` na `/api/v1/auth`, `/api/v1/auth/*` (zadržava POST odjave i prijave) |
| `/app/web/*`, `/app/chrome/*` | zasad bez preusmjeravanja; `307` na `/aplikacija/*` kad front prijeđe na tu osnovu (zadatak 3 karte) |
| `/admin/*` | zasad bez preusmjeravanja; `307` na `/administracija/*` kad Aplication_front prijeđe (zadatak 9 karte) |

- Lokalno je `307`, da preglednik ništa ne zapamti trajno dok se karta uvodi. Trajni `301` i `X-Robots-Tag` na ductura.org daje produkcijski rub (zadatak 10, DAN-939); rewriteovi Nexta stare adrese ne poznaju.
- Front institucije ima Next `basePath` `/app` i resurse pod `/app/web/_next/`, a Aplication_front osnovu `/admin`. Na `/aplikacija/…` i `/administracija/…` njihov klijent bi bio izvan osnove, a povratak nakon prijave AAI@EduHr je `/app/web/`. Zato do prelaska rub nove adrese prepisuje na staru osnovu, a stare adrese rade i dalje. Prelazak je jedna izmjena u `BASES` (`deploy/edge/routes.ts`): nove adrese tada idu doslovno, a stare počinju preusmjeravati.
- `/ulaz/x`, `/Ulaz`, `/%75laz`, `/aplikacijax`, `/prijava/x` i `/downloadx` nisu ni javne ni stare adrese (404 preloadera).

Putanje usluga zapisane su samo u `deploy/edge/routes.ts`; iz nje čitaju rewriteovi Nexta i edge, a `test/config-routes.test.ts` provjerava da ih slijede i odredišta u `src/config.ts` (mobilni `/app/mobile/`, ostali `/o/`, uz lokalni `307` s `/app/web/` s preloadera `/ulaz`; s naslovnice `/` tog preusmjeravanja nema). Promjena basePatha u drugom repozitoriju traži izmjenu te tablice u istom koraku.

- Putanja se uspoređuje doslovno: bez dekodiranja i bez promjene velikih slova. `/Admin`, `/%61dmin`, `/Administracija` i `/api/v2/...` nisu prosljeđeni nego idu preloaderu (404 Nexta).
- Putanja i upit prosljeđuju se nepromijenjeni, osim javnih putanja iz tablice iznad: front institucije dobiva `/app/web/...`, ne `/...`.
- `Host` (`localhost:8000`), kolačići, `Location` i svi `Set-Cookie` prolaze nepromijenjeni. Edge dodaje `X-Forwarded-Host`, `X-Forwarded-Proto: http` i `X-Forwarded-For` (vrijednosti iz preglednika se zamjenjuju) i uklanja samo zaglavlja jednog skoka.
- WebSocket (HMR razvojnih poslužitelja) prolazi kao sirova veza.
- Ugašena usluga daje `502` sa stranicom greške preloadera (`/greska.html`, s CSP-om kao ispod); kad ne radi ni preloader, kratak tekst. Edge radi dalje.
- Ciljevi se mijenjaju varijablama `DUCTURA_EDGE_PRELOADER`, `DUCTURA_EDGE_ADMIN`, `DUCTURA_EDGE_API` i `DUCTURA_EDGE_FRONT` (`http://host:port`, bez putanje). Port edgea je `DUCTURA_EDGE_PORT` (zadano 8000), adresa `DUCTURA_EDGE_HOST` (zadano `localhost`).
- HTML preloadera dobiva `Content-Security-Policy` iz hasheva jedine ugrađene skripte i stila (`deploy/edge/content-security-policy.ts`, DAN-995); stranica bez skripte (404) dobiva `script-src 'none'`. Zaglavlje preloadera se zamjenjuje, a preloader odgovara cijelim i nekomprimiranim tijelom (edge mu ne šalje `Accept-Encoding` ni `Range`); `304` prolazi nepromijenjen. HEAD ide preloaderu kao GET, da zaglavlja budu ista. HTML koji ne prolazi provjeru (npr. iz `next dev`) dobiva strogu politiku `default-src 'none'` i redak u ispisu edgea; HTML veći od 1 MiB daje `502`.
- Razvojne putanje `next dev` (`/__nextjs_font/*`, `/__nextjs_original-stack-frames`) Next traži bez basePatha, pa edge ih šalje usluzi čija je stranica u `Referer` (`/admin/...` na Aplication_front, `/app/web/...` na front institucije); bez Referera idu preloaderu. Bez toga administracija u `next dev` nema font (404).
- Razlika od Vercela: rewriteovi Nexta (`src/rewrites.ts`) uspoređuju putanju bez obzira na velika i mala slova (`/Admin` ide na `/admin` Aplication_fronta), a edge doslovno. `%2f` i `%61` ni jedan ni drugi ne dekodira.

## 4. Tok u pregledniku (ugovor §3)

1. Otvorite **http://localhost:8000/**: to je naslovnica fronta institucije. Preloader je na **http://localhost:8000/ulaz** i zasad nudi dva ulaza (gumbe miče zadatak 2 karte adresa):
   - **Prijava preko AAI@EduHr** vodi na `/api/v1/auth/login?returnTo=/app/web/`;
   - **Administracija platforme** vodi na `/admin/prijava`.

   Preloader nakon 4 sekunde sam otvara web za Vaš preglednik. Fokus ili dodir na jednom od ova dva ulaza to otkazuje, pa izbor ostaje Vaš.
2. **Administracija:** na `/admin/prijava` se prijavite kao `admin` s lozinkom iz `Aplication_server/.local/admin-lozinka` (`pnpm sve` je stvara; nije u repozitoriju). Na `/admin` odaberite **+ Dodaj instituciju**: fakultet s popisa, izmišljenu AAI domenu (npr. `lok2.example.invalid`) i broj računa po ulozi. Issuer je `http://localhost:8090` iz `AAI_OIDC_ISSUER`. Aplication_server šalje instituciju Institution_serveru (§2), poslužitelj sa poslužiteljem; preglednik taj poziv nikad ne radi. Stranica institucije zatim pokazuje „Instanca je aktivna”.
3. **Prijava računa institucije:** otvorite http://localhost:8000/ulaz i odaberite **Prijava preko AAI@EduHr**. Lokalno to otvara lažni OIDC na :8090 („Demo prijava, samo lokalno i CI”). Odaberite izmišljeni račun iz seeda (npr. „Demo studentica” ili „Demo nastavnik” ustanove `demo.ductus.test`) ili pod „Račun bilo koje ustanove” upišite AAI domenu dodane institucije.
4. Lažni OIDC vraća preglednik na `/api/v1/auth/callback`. Institution_server postavlja kolačić `__Host-ductus_session` i preusmjerava (303) na `/app/web/`.
5. Front institucije poziva `GET /api/v1/me`. Na `401` šalje preglednik na `/api/v1/auth/login?returnTo=<trenutna adresa>`, na `200` prikazuje početni ekran po ulozi.

Studenti i svi računi institucije prijavljuju se samo preko AAI@EduHr, lokalno preko njegova simulatora (D-09, D-16). Drugog načina prijave za njih nema.

## 5. Provjera da sve radi

- `pnpm sve` ispiše `radi` za svih šest usluga iza edgea (preloader, aplication-server, aplication-front, institution-server, lazni-oidc, front-institucije).
- `curl -i http://localhost:8000/` vraća naslovnicu fronta institucije (resursi pod `/app/web/_next/`).
- `curl -i http://localhost:8000/ulaz` vraća preloader s `Content-Security-Policy` (`script-src 'sha256-…'`) i `X-Robots-Tag: noindex`.
- `curl -i http://localhost:8000/aplikacija/` vraća front institucije (kao `/app/web/`) s `X-Robots-Tag: noindex`; `curl -i http://localhost:8000/administracija/prijava` stranicu prijave administratora.
- `curl -i http://localhost:8000/prijava` vraća `307` s `Location: /app/web/prijava`; `curl -i http://localhost:8000/api/auth/logout` vraća `308` s `Location: /api/v1/auth/logout`.
- `curl -i http://localhost:8000/api/v1/health` vraća `200`.
- `curl -i "http://localhost:8000/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F"` vraća preusmjeravanje na `http://localhost:8090/...`.
- `curl -i http://localhost:8000/admin/prijava` vraća stranicu prijave administratora.
- `curl -i http://localhost:8000/app/web/` vraća front institucije.

## 6. Česti problemi

| Simptom | Uzrok i rješenje |
|---|---|
| `502` na `/admin`, `/api/v1` ili `/app/...` | Ta usluga ne radi. Pogledajte ispis `pnpm sve` (redak `NE ODGOVARA` ili `PRESKOČENO`). |
| `502` na `/`, javnoj stranici ili `/aplikacija` | Njih daje front institucije (:5173), koji ne radi. Preloader je i dalje na `/ulaz`. |
| `/pomoc`, `/kontakt` ili `/preuzimanja` daje 404 fronta | Rub ih već šalje frontu (`/app/web/pomoc` …), ali stranice još ne postoje (zadatak 6 karte adresa). |
| `EADDRINUSE` | Port iz tablice već koristi drugi proces. Ugasite ga ili promijenite cilj edgea varijablom. |
| `Institution_server nema skriptu "lokalno"` | Checkout je na staroj grani. Prebacite ga na `migracija/kopija-ductus-backend` (§1). |
| `institution-server :4000 NE ODGOVARA` | Pogledajte redove `[institution-server]`: najčešće baza (`DATABASE_URL` mora biti superkorisnik na ovom računalu) ili zauzet port 4000/8090. |
| „Nema tokena provisioninga” | Institution_server nije zapisao `.local/provisioning-token` u 60 s. Dodavanje institucije tada ne stiže do njega; ponovno pokrenite `pnpm sve`. |
| Dodavanje institucije javlja grešku issuera | Aplication_server je pokrenut bez `AAI_OIDC_ISSUER`, dakle ne kroz `pnpm sve`. |
| Nakon prijave nema kolačića | `__Host-` kolačić traži `Secure`. Chrome i Firefox ga na `http://localhost` prihvaćaju; drugi preglednici možda ne. Za lokalni rad koristite Chrome ili Firefox. |
| Na Windowsu „Na Windowsu pokrenite kroz pnpm” | Pokrenite `pnpm sve`, ne `node scripts/sve-lokalno.mjs`. |
| `/app/mobile/` ili `/o/` daje 404 | Usluga nije pokrenuta lokalno: `pnpm sve` ih preskače bez checkouta (`Institution_web_mobile`, `Web_other`), a edge ih tada ne prosljeđuje. Pokrenite ih i postavite `DUCTURA_EDGE_MOBILE` odnosno `DUCTURA_EDGE_OTHER`. |

## 7. Testovi

- `test/dev-proxy.test.ts`: rute (i razvojne putanje po Refereru), zaglavlja, kolačići, `Location`, WebSocket i ugašen uzvodni, s lažnim uzvodnim poslužiteljima.
- `test/sve-lokalno.test.ts`: plan usluga, adrese baza, lozinka administratora, pokretanje bez ljuske i cijeli `pnpm sve` nad lažnim checkoutima: lažni `pnpm lokalno` zapiše token, a Aplication_server ga dobiva (koristi stvarne portove iz tablice, pa ne smije raditi uz pokrenut `pnpm sve`).
- `test/functional.test.ts` i `e2e/matrix/*.spec.ts`: dva ulaza za prijavu na preloaderu.
- `test/route-table.test.ts`, `test/next-start.test.ts` i `e2e/vs2/routing.spec.ts`: karta adresa (D-318, DAN-1574): naslovnica na `/`, preloader na `/ulaz`, javne stranice, `/aplikacija` i `/administracija` s istim ciljem u rewriteovima Nexta i u edgeu; stare adrese (`307`/`308`) i `X-Robots-Tag` samo u edgeu. `test/dev-proxy.test.ts` provjerava i stanje nakon prelaska usluga (`BASES`).

## 8. Rezultat prolaza (LOK-2, 20. 11. 2026.)

Prolaz u oblaku: Linux, Node 24.22, Docker 29, `pnpm sve --docker` (PostgreSQL 17.12), grane iz §1, preglednik Chromium (Playwright) na 1250 px. Windows nije provjeren.

| Korak | Ishod |
|---|---|
| `pnpm sve --docker`: baza, izgradnja preloadera, priprema Aplication_servera | prolazi |
| svih 7 usluga sluša (preloader, Aplication_server, Aplication_front, Institution_server, lažni OIDC, front institucije, edge) | prolazi |
| `/`: preloader s CSP-om iz hasheva | prolazi |
| klik **Prijava preko AAI@EduHr** → lažni OIDC → „Demo studentica” → `/app/web/zadaci`, `GET /api/v1/me` 200 (`student`, Demo fakultet) | prolazi |
| isto s „Demo nastavnik” → `/app/web/nastavnik`, `roles: ["teacher"]` | prolazi |
| klik **Administracija platforme** → `/admin/prijava` → prijava kao `admin` → `/admin` | prolazi |
| **+ Dodaj instituciju** (izmišljena domena `lok2.example.invalid`) → „Instanca je aktivna” | prolazi (nakon popravka u ovom PR-u) |
| prijava računom nove institucije („Račun bilo koje ustanove”) → `/app/web/zadaci`, `/api/v1/me` 200 | prolazi |
| `/app/web/zadaci` pokazuje zadatke studenta | ne prolazi: LOK-2-1 |
| račun bez potvrđene uloge dobiva stanje „bez uloge” | ne prolazi: LOK-2-2 |
| nakon `pnpm sve` susjedni checkouti ostaju čisti (`git status`) | ne prolazi: LOK-2-3 |

### Padovi popravljeni u ovom PR-u (Preloader)

- **LOK-2-4:** Institution_server nema skriptu `dev`, pa ga je `pnpm sve` preskakao. Sada se pokreće njegov `pnpm lokalno`.
- **LOK-2-5:** `Institution_server/packages/test-fakes/oidc` nema `package.json`, pa je lažni OIDC bio preskočen. Sada ga podiže isti `pnpm lokalno`.
- **LOK-2-6:** Aplication_server nije imao bazu, migracije, administratora, tajnu kolačića, issuer ni token koji Institution_server prihvaća: bez tajne prijava u administraciju vraća `503` (README Aplication_servera), a dodavanje institucije je u ovom prolazu vratilo `502` (greška issuera). Sada sve priprema `pnpm sve`.
- **LOK-2-7:** u `next dev` administracija traži `/__nextjs_font/*` bez basePatha, a edge ga je slao preloaderu (`404`, stranica bez fonta). Sada edge usmjerava po Refereru.

### Novi zadaci u redu

- **LOK-2-1 · Institution_server:** `GET /api/v1/student/assignments` vraća `404` (ruta nije montirana). Koraci: `pnpm sve`, prijava „Demo studentica”. Dobiveno: na `/app/web/zadaci` „Prikaz trenutačno nije dostupan”. Očekivano: zadatak „Seminarski rad: kućno kompostiranje” iz seeda (SRV-09 `h-student-zadaci`).
- **LOK-2-2 · Institution_server:** račun s nepotvrđenom nastavničkom ulogom dobiva ulogu studenta. Koraci: prijava „Iva Neimenić (demo.ductus.test, nastavnik)” (`demo-bez-uloge`), ili „Račun bilo koje ustanove” s ulogom „nastavnik” za novu instituciju. Dobiveno: `/api/v1/me` 200 s `roles: ["student"]` i studentsko sučelje. Očekivano (SRV-01, A-5): `/api/v1/me` 403 i stanje „bez uloge” s uputom na administratora fakulteta.
- **LOK-2-3 · Aplication_server:** `next dev` zapisuje `AGENTS.md` u checkout jer `next.config.mjs` nema `agentRules: false` (Aplication_front i preloader ga imaju). Koraci: `pnpm sve`, zatim `git status` u Aplication_serveru. Očekivano: čist checkout.
