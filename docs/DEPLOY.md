# Objava: Vercel (ductura.org)

Preloader je jedino javno podrijetlo `https://ductura.org`. Na Vercelu je Next.js aplikacija (`vercel.json`: `"framework": "nextjs"`, instalacija `pnpm install --frozen-lockfile`, gradnja `pnpm build`). Spajanje u `main` ide u produkciju, svaka druga grana dobiva preview.

Ostale usluge su na istom podrijetlu preko rewriteova Nexta (`src/rewrites.ts`), po ugovoru Ductus #2028 §1, isto kao lokalni edge (`deploy/edge/dev-proxy.mjs`):

| Putanja | Ide na | Varijabla okoline |
| --- | --- | --- |
| `/`, `/greska.html`, `/_next/*` | preloader (ova aplikacija) | – |
| `/admin`, `/admin/*` | Aplication_front, s istom putanjom `/admin/...` | `APLICATION_FRONT_URL` |
| `/api/v1`, `/api/v1/*` | Institution_server | `INSTITUTION_SERVER_URL` |
| `/app/web`, `/app/web/*`, `/app/chrome`, `/app/chrome/*` | front institucije | `INSTITUTION_FRONT_URL` |

Zbog jednog podrijetla kolačići (`__Host-ductus_session`, `ductura_admin`) i povratak s AAI@EduHr (`https://ductura.org/api/v1/auth/callback`) rade bez CORS-a.

## Varijable okoline

Adrese nisu u repou. Upisuju se u projekt na Vercelu (Settings → Environment Variables, za Production i Preview) kao podrijetlo bez putanje, npr. `https://<host>`. Čitaju se pri `next build`, pa promjena traži novu izgradnju (Redeploy). Neispravna vrijednost (bez `https:`, s putanjom, upitom ili korisničkim podacima) ruši izgradnju. Usluga bez varijable nema rewrite: njezine putanje daju 404, a početna stranica radi.

## Što Daniel radi ručno

1. Na Vercelu postavlja Aplication_front i front institucije, na Renderu servere (njihovi `docs/DEPLOY.md`).
2. U projektu `preloader` na Vercelu: Framework Preset **Next.js**, bez ručno postavljenog Output Directoryja (stara postavka `dist` više ne vrijedi), i tri varijable iz tablice. Tek onda spaja u `main`.
3. Na Institution_serveru postavlja `APP_ORIGIN=https://ductura.org` i `OIDC_REDIRECT_URI=https://ductura.org/api/v1/auth/callback`.

## Poznato

- Stranice nemaju zaglavlje `Content-Security-Policy` (ni dosad ga na Vercelu nisu imale). Politika iz hasheva ne vrijedi za ugrađene skripte Nexta; nonce kroz `proxy.ts` je zaseban zadatak.
- Rewriteovi Nexta uspoređuju putanju bez obzira na velika i mala slova (`/Admin` ide na `/admin` Aplication_fronta), a lokalni edge doslovno.
- Proračun veličine (`budget.json`) s Nextom nije zadovoljen; vidi README, odjeljak „Proračun veličine”.
