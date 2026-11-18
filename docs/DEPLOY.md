# Objava: Vercel (ductura.org), Render kao rezerva

Preloader je jedino javno podrijetlo `https://ductura.org`. Vercel projekt `preloader` već je povezan s repoom: svaki push na `main` ide u produkciju, a svaka druga grana dobiva preview. `vercel.json` zadržava postojeće postavke (gradnja `pnpm build`, izlaz `dist`). Dodaje rewriteove po ugovoru toka (#2028 §1), isto kao lokalni edge `deploy/edge/dev-proxy.mjs`:

| Putanja | Ide na |
| --- | --- |
| `/`, statika | `dist/` (Preloader) |
| `/admin`, `/admin/*` | Aplication_front (Vercel), s istom putanjom `/admin/...` |
| `/api/v1/*` | Institution_server (Render) |
| `/app/web`, `/app/web/*`, `/app/chrome`, `/app/chrome/*` | front institucije (Vercel) |

Zbog jednog podrijetla kolačići (`__Host-ductus_session`, `ductura_admin`) i povratak s AAI@EduHr (`https://ductura.org/api/v1/auth/callback`) rade bez CORS-a.

## Rezervirani hostovi

U `vercel.json` adresa ne može biti varijabla okoline. Zato su ciljevi namjerno neispravni hostovi na domeni `.invalid`, koja nikad ne postoji:

| Rezervirano | Zamijeni s |
| --- | --- |
| `ZAMIJENI-aplication-front.invalid` | domena Vercel projekta Aplication_fronta |
| `ZAMIJENI-institution-server.invalid` | domena Render usluge `ductura-institution-server` |
| `ZAMIJENI-institution-front.invalid` | domena Vercel projekta fronta institucije |

Dok se ne zamijene, te putanje vraćaju grešku, a početna stranica radi kao i dosad. Upiši prave adrese **prije spajanja u `main`**, jer spajanje odmah ide na ductura.org. `test/render-image.test.ts` provjerava da su odredišta https i da se putanja prosljeđuje nepromijenjena.

## Render (neobavezno)

`deploy/render/Dockerfile` gradi `dist/` i nginx mapu CSP-a (`deploy/render/csp-map.ts`, ista politika kao lokalni edge). Zatim ga poslužuje neprivilegirani nginx (uid 101) na `$PORT`, s istim rutama kao `vercel.json`. Dockerfile nije u korijenu namjerno: u korijenu bi mogao prebaciti Vercel projekt na predložak Container.

| Varijabla (samo za Render sliku) | Vrijednost |
| --- | --- |
| `APLICATION_FRONT_URL` | `https://<host Aplication_fronta>` bez putanje |
| `INSTITUTION_SERVER_URL` | `https://<host Institution_servera>` bez putanje |
| `INSTITUTION_FRONT_URL` | `https://<host fronta institucije>` bez putanje |

Bez njih nginx se ne pokreće. Render: **New → Web Service**, Docker, Dockerfile Path `deploy/render/Dockerfile`. Lokalno: `docker build -f deploy/render/Dockerfile -t preloader .`

## Što Daniel radi ručno

1. Na Vercelu postavlja Aplication_front i front institucije, na Renderu servere (njihovi `docs/DEPLOY.md`).
2. Upisuje tri prave adrese u `vercel.json` (zaseban mali PR) i tek onda spaja u `main`.
3. Na Institution_serveru postavlja `APP_ORIGIN=https://ductura.org` i `OIDC_REDIRECT_URI=https://ductura.org/api/v1/auth/callback`.

## Poznato

- Na Vercelu statika i danas nema zaglavlje `Content-Security-Policy`, jer je hash ovisan o gradnji, a `vercel.json` je statičan. Lokalni edge i Render slika ga šalju. Ispravak je zaseban zadatak.
- Vercel danas može pokretati i Docker slike (Container Runtime, beta). Ovaj PR ga ne koristi.
