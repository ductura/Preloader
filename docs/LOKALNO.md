# Ductura lokalno: cijeli tok na jednom računalu

Ugovor toka prijave i instance je Ductus #2028, komentar 6993786629 (§1 portovi i rute, §2 provisioning, §3 tok u pregledniku). Ovaj dokument opisuje kako ga pokrenuti lokalno. Preglednik koristi samo jedno podrijetlo, **http://localhost:8000**. Pravi rubni proxy u produkciji je zaseban korak (P-0.10).

## 1. Što treba

- Node.js 24 ili noviji i pnpm (`corepack enable` ili `npm install --global pnpm`).
- PostgreSQL na `localhost:5432` ili `DATABASE_URL` u okolini. Shemu i migracije podižu poslužitelji (vidi README Aplication_servera i Institution_servera).
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

U svakom repozitoriju jednom pokrenite `pnpm install` (u `Institution_server` i u `packages/test-fakes/oidc` ako ima vlastiti `package.json`).

## 2. Pokretanje

U ovom repozitoriju:

```bash
pnpm install
pnpm sve
```

Isto radi u PowerShellu, cmd-u i terminalu na macOS-u i Linuxu: skripta ne treba bash, a pnpm pokreće kroz Node. Na Windowsu ju pokrenite kroz `pnpm sve`, ne kao `node scripts/sve-lokalno.mjs`.

`pnpm sve`:

1. pokrene preloader (`next dev` na :3100) i usluge iz ugovora §1 (svaka sa svojim portom u `PORT`):

| Usluga | Port | Mapa | Naredba |
|---|---|---|---|
| preloader (Next.js) | 3100 | ovaj repo | `pnpm run dev` |
| Aplication_server | 3110 | `Aplication_server` | `pnpm run dev` |
| Aplication_front (`basePath: "/admin"`) | 3120 | `Aplication_front` | `pnpm run dev` |
| Institution_server | 4000 | `Institution_server` | `pnpm run dev` |
| lažni OIDC (simulator AAI@EduHr) | 8090 | `Institution_server/packages/test-fakes/oidc` | `pnpm run start` |
| front institucije | 5173 | `Institution_front_web_chrome` | `pnpm run dev` |
| edge | 8000 | ovaj repo | `node deploy/edge/dev-proxy.mjs` |

2. ispiše koje usluge rade i adresu **http://localhost:8000/**.

Usluga čiji checkout, `package.json` ili skripta nedostaje preskače se, a razlog se ispiše (na primjer `Aplication_front nema skriptu "dev"`). Ostale rade dalje. Ispis svake usluge ima oznaku (`[institution-server] ...`). Ctrl+C gasi sve usluge s njihovim podprocesima.

Okolina koju skripta postavlja:

- `DUCTURA_PROVISIONING_TOKEN`: zajednička tajna za §2. Ako nije postavljena, generira se nova (32 slučajna bajta) pri svakom pokretanju i dobivaju je samo Aplication_server i Institution_server. Nikad se ne ispisuje ni ne zapisuje.
- Aplication_server: `INSTITUTION_SERVER_URL=http://localhost:4000`.
- Aplication_front: `APLICATION_SERVER_URL=http://localhost:3110`, `PUBLIC_ORIGIN=http://localhost:8000`.
- Institution_server: `OIDC_ISSUER=http://localhost:8090`, `OIDC_REDIRECT_URI=http://localhost:8000/api/v1/auth/callback`, `PUBLIC_ORIGIN=http://localhost:8000`.
- lažni OIDC: `ISSUER=http://localhost:8090`, `REDIRECT_URI=http://localhost:8000/api/v1/auth/callback`, `POST_LOGOUT_REDIRECT_URI=http://localhost:8000/`, `BACKCHANNEL_LOGOUT_URI=http://localhost:8000/api/v1/auth/backchannel-logout`.
- Ostalo (npr. `DATABASE_URL`) prolazi iz Vaše okoline nepromijenjeno; `PORT` iz okoline se ne prenosi.

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
- Edge ne dodaje `Content-Security-Policy`: stranice Nexta imaju više ugrađenih skripti, pa politika iz hasheva više ne vrijedi (CSP za Next.js je zaseban korak).
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
| `502` na `/admin`, `/api/v1` ili `/app/...` | Ta usluga ne radi. Pogledajte ispis `pnpm sve` (redak `NE ODGOVARA` ili `PRESKOČENO`). |
| `EADDRINUSE` | Port iz tablice već koristi drugi proces. Ugasite ga ili promijenite cilj edgea varijablom. |
| Nakon prijave nema kolačića | `__Host-` kolačić traži `Secure`. Chrome i Firefox ga na `http://localhost` prihvaćaju; drugi preglednici možda ne. Za lokalni rad koristite Chrome ili Firefox. |
| Na Windowsu „Na Windowsu pokrenite kroz pnpm” | Pokrenite `pnpm sve`, ne `node scripts/sve-lokalno.mjs`. |
| `/app/mobile/` daje 404 | Ugovor §1 zasad nema rutu za mobilno sučelje; preloader ga nudi na mobitelu. Otvoreno pitanje za orkestratora. |

## 7. Testovi

- `test/dev-proxy.test.ts`: rute, zaglavlja, kolačići, `Location`, WebSocket i ugašen uzvodni, s lažnim uzvodnim poslužiteljima.
- `test/sve-lokalno.test.ts`: plan usluga, pokretanje bez ljuske i cijeli `pnpm sve` nad lažnim checkoutima (koristi stvarne portove iz tablice, pa ne smije raditi uz pokrenut `pnpm sve`).
- `test/functional.test.ts` i `e2e/matrix/*.spec.ts`: dva ulaza za prijavu na preloaderu.
