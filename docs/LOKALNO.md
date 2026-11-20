# Ductura lokalno: cijeli tok na jednom računalu

Ugovor toka prijave i instance je Ductus #2028, komentar 6993786629 (§1 portovi i rute, §2 provisioning, §3 tok u pregledniku). Ovaj dokument opisuje kako ga pokrenuti lokalno. Preglednik koristi samo jedno podrijetlo, **http://localhost:8000**. Pravi rubni proxy u produkciji je zaseban korak (P-0.10).

## 1. Što treba

- Node.js 24 ili noviji i pnpm u verziji iz `packageManager` ciljnog repozitorija.
- Lokalni PostgreSQL. `Institution_server` prima lokalni administratorski `DATABASE_URL` iz okoline ili svoje `.local/database-url`; njegov `pnpm lokalno` provjerava loopback adresu, priprema bazu i vlastite aplikacijske prijave. Vidi njegove lokalne upute.
- `Aplication_server` ima zasebnu bazu i vlastite migracije te administratorsku tajnu. Pripremite ih prema njegovu README-u; njegov `DATABASE_URL` postavite u njegov `.env.local`. Pokretač mu ne prosljeđuje administratorski `DATABASE_URL` institucionalnog servera.
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

U svakom repozitoriju jednom pokrenite `pnpm install --frozen-lockfile`, s verzijom pnpm-a iz njegova `packageManager`. OIDC pokreće `Institution_server` vlastitom skriptom.

## 2. Pokretanje

U ovom repozitoriju:

```bash
pnpm install
pnpm sve
```

Isto radi u PowerShellu, cmd-u i terminalu na macOS-u i Linuxu: skripta ne treba bash, a pnpm pokreće kroz Node. Na Windowsu ju pokrenite kroz `pnpm sve`, ne kao `node scripts/sve-lokalno.mjs`.

`pnpm sve`:

1. provjeri da postoje svi obvezni checkouti i skripte te da su portovi iz tablice slobodni;
2. pokrene `Institution_server` njegovom stvarnom skriptom `lokalno`, koja priprema bazu, postavke `APP_*`, trajni provisioning token i jedini lažni OIDC;
3. nakon HTTP provjere servera i OIDC-a pročita spremljeni token, pa pokrene preloader, platformu, institucionalni front i edge:

| Usluga | Port | Mapa | Naredba |
|---|---|---|---|
| preloader (Next.js) | 3100 | ovaj repo | `pnpm run dev` |
| Aplication_server | 3110 | `Aplication_server` | `pnpm run dev` |
| Aplication_front (`basePath: "/admin"`) | 3120 | `Aplication_front` | `pnpm run dev` |
| Institution_server | 4000 | `Institution_server` | `pnpm run lokalno` |
| lažni OIDC (simulator AAI@EduHr) | 8090 | `Institution_server/packages/test-fakes/oidc` | podproces `pnpm run lokalno` |
| front institucije | 5173 | `Institution_front_web_chrome` | `pnpm run dev` |
| edge | 8000 | ovaj repo | `node deploy/edge/dev-proxy.mjs` |

4. provjeri HTTP odgovore preloadera, oba fronta, oba servera, OIDC-a i edgea. Tek tada ispiše **http://localhost:8000/**.

Nedostajući checkout ili skripta prekida pokretanje prije prvog podprocesa. Zauzet port daje grešku i postojeći proces ostaje netaknut. Neuspjela HTTP provjera, greška pokretanja ili završetak bilo koje obvezne usluge zaustavlja cijeli stog i vraća izlazni kod 1. Ctrl+C gasi podprocese koje je pokretač sam pokrenuo. Skripta odbija `NODE_ENV=production`.

Okolina koju skripta postavlja:

- `Institution_server` sam određuje `APP_ORIGIN=http://localhost:8000`, `APP_DATABASE_URL`, `AUTH_DATABASE_URL`, OIDC issuer i povratnu adresu. Njegov `pnpm lokalno` jedini je vlasnik OIDC-a; zaseban OIDC proces se ne pokreće.
- Provisioning token čita se iz `Institution_server/.local/provisioning-token` tek nakon podizanja servera. Tu trajnu tajnu stvara i čuva serverska lokalna skripta. Isti token dobiva `Aplication_server`; frontovi i edge ga ne nasljeđuju. Token se ne ispisuje. Ako je `DUCTURA_PROVISIONING_TOKEN` već u okolini, mora odgovarati spremljenom tokenu ili se pokretanje prekida.
- Aplication_server: `INSTITUTION_SERVER_URL=http://localhost:4000`.
- Aplication_front: `APLICATION_SERVER_URL=http://localhost:3110`, `PUBLIC_ORIGIN=http://localhost:8000`.
- `DATABASE_URL` iz okoline prosljeđuje se samo institucionalnoj lokalnoj skripti. `APP_DATABASE_URL` i `AUTH_DATABASE_URL` iz roditeljske okoline ne prelaze u druge procese.
- Portovi i ciljevi edgea za `pnpm sve` fiksirani su prema tablici; ne nasljeđuju slučajna odredišta iz roditeljske okoline. Za samostalan edge postoje varijable iz sljedećeg odjeljka.

HTTP spremnost potvrđuje pokrenute usluge. Cijeli tok prijave, potvrđenog spremanja i ponovnog otvaranja iste revizije dokazuje zaseban VS-1 run u DAN-887. Institucionalni front mora sadržavati stvarni editor u svojem zadanom `dev` ulazu.

Sam edge bez ostalih usluga: `pnpm dev` u jednom terminalu i `pnpm edge` u drugom.

## 3. Edge (`deploy/edge/dev-proxy.mjs`)

| Putanja | Ide na |
|---|---|
| `/`, `/greska.html`, `/_next/*` i sve ostalo | preloader (Next.js) :3100; drugo od GET i HEAD daje `405` |
| `/admin`, `/admin/*` | Aplication_front :3120 |
| `/api/v1`, `/api/v1/*` | Institution_server :4000 |
| `/app/web`, `/app/web/*`, `/app/chrome`, `/app/chrome/*` | front institucije :5173 |

- Putanja se uspoređuje doslovno: bez dekodiranja i bez promjene velikih slova. `/Admin`, `/%61dmin`, `/administracija` i `/api/v2/...` nisu prosljeđeni nego ih poslužuje statika (404).
- Putanja i upit prosljeđuju se nepromijenjeni: front institucije dobiva `/app/web/...`, ne `/...`.
- `Host` (`localhost:8000`), kolačići, `Location` i svi `Set-Cookie` prolaze nepromijenjeni. Edge dodaje `X-Forwarded-Host`, `X-Forwarded-Proto: http` i `X-Forwarded-For` (vrijednosti iz preglednika se zamjenjuju) i uklanja samo zaglavlja jednog skoka.
- WebSocket (HMR za `next dev`) prolazi kao sirova veza.
- Ugašena usluga daje `502` sa stranicom greške preloadera (`/greska.html`); kad ne radi ni preloader, kratak tekst. Edge radi dalje.
- Ciljevi se mijenjaju varijablama `DUCTURA_EDGE_PRELOADER`, `DUCTURA_EDGE_ADMIN`, `DUCTURA_EDGE_API` i `DUCTURA_EDGE_FRONT` (`http://host:port`, bez putanje). Port edgea je `DUCTURA_EDGE_PORT` (zadano 8000), adresa `DUCTURA_EDGE_HOST` (zadano `localhost`).
- Edge ne dodaje `Content-Security-Policy`, jer stranice poslužuje Next (zaseban korak, vidi `docs/DEPLOY.md`).
- Razlika od Vercela: rewriteovi Nexta (`src/rewrites.ts`) uspoređuju putanju bez obzira na velika i mala slova (`/Admin` ide na `/admin` Aplication_fronta), a edge doslovno. `%2f` i `%61` ni jedan ni drugi ne dekodira.

## 4. Tok u pregledniku (ugovor §3)

1. Otvorite **http://localhost:8000/**. Preloader nudi dva ulaza:
   - **Prijava preko AAI@EduHr** vodi na `/api/v1/auth/login?returnTo=/app/web/`;
   - **Administracija platforme** vodi na `/admin/prijava`.

   Preloader nakon 4 sekunde sam otvara web za Vaš preglednik. Fokus ili dodir na jednom od ova dva ulaza to otkazuje, pa izbor ostaje Vaš.
2. **Administracija:** na `/admin/prijava` se prijavite korisničkim imenom i lozinkom administratora platforme. Lozinka je samo lokalno, u `.local/` Aplication_servera (nije u repozitoriju; postupak je u njegovu README-u). Na `/admin` dodajte instituciju (slug, naziv, `aaiHomeOrg`, OIDC issuer `http://localhost:8090`, broj računa po ulozi). Aplication_server je šalje Institution_serveru (§2), poslužitelj sa poslužiteljem; preglednik taj poziv nikad ne radi.
3. **Prijava računa institucije:** vratite se na http://localhost:8000/ i odaberite **Prijava preko AAI@EduHr**. Lokalno to otvara lažni OIDC na :8090; odaberite izmišljeni račun čiji je `hrEduPersonHomeOrg` jednak `aaiHomeOrg` dodane institucije.
4. Lažni OIDC vraća preglednik na `/api/v1/auth/callback`. Institution_server postavlja kolačić `__Host-ductus_session` i preusmjerava (303) na `/app/web/`.
5. Front institucije poziva `GET /api/v1/me`. Na `401` šalje preglednik na `/api/v1/auth/login?returnTo=<trenutna adresa>`, na `200` prikazuje početni ekran po ulozi.

Studenti i svi računi institucije prijavljuju se samo preko AAI@EduHr, lokalno preko njegova simulatora (D-09, D-16). Drugog načina prijave za njih nema.

## 5. Provjera da sve radi

- `curl -i http://localhost:8000/` vraća preloader (stranicu Nexta).
- `curl -i "http://localhost:8000/api/v1/auth/login?returnTo=%2Fapp%2Fweb%2F"` vraća preusmjeravanje na `http://localhost:8090/...`.
- `curl -i http://localhost:8000/admin/prijava` vraća stranicu prijave administratora.
- `curl -i http://localhost:8000/app/web/` vraća front institucije.

## 6. Česti problemi

| Simptom | Uzrok i rješenje |
|---|---|
| Preflight greška ili neuspjela HTTP provjera | Provjerite navedeni checkout, skriptu, port ili izlaz usluge. `pnpm sve` ne ostavlja djelomično pokrenut stog. |
| Zauzet port | Port iz tablice već koristi drugi proces. Pokretač ga ne gasi; zaustavite vlastitu prethodnu instancu prije novog pokretanja. |
| Nakon prijave nema kolačića | `__Host-` kolačić traži `Secure`. Chrome i Firefox ga na `http://localhost` prihvaćaju; drugi preglednici možda ne. Za lokalni rad koristite Chrome ili Firefox. |
| Na Windowsu „Na Windowsu pokrenite kroz pnpm” | Pokrenite `pnpm sve`, ne `node scripts/sve-lokalno.mjs`. |
| `/app/mobile/` daje 404 | Ugovor §1 zasad nema rutu za mobilno sučelje; preloader ga nudi na mobitelu. Otvoreno pitanje za orkestratora. |

## 7. Testovi

- `test/dev-proxy.test.ts`: rute, zaglavlja, kolačići, `Location`, WebSocket i ugašen uzvodni, s lažnim uzvodnim poslužiteljima.
- `test/sve-lokalno.test.ts`: preflight, stvarna serverska skripta i jedan OIDC, trajni zajednički token bez prosljeđivanja frontovima, HTTP spremnost te prekid i gašenje pri kvaru usluge. Cijeli launcher koristi pravi Next i edge sa sintetičkim susjednim servisima, bez baze. Test zauzima stvarne portove iz tablice, pa ne smije raditi uz pokrenut `pnpm sve`.
- `test/functional.test.ts` i `e2e/matrix/*.spec.ts`: dva ulaza za prijavu na preloaderu.
