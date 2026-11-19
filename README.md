# Ductura / preloader

Ulaz u Ducturu (ductura.org). Next.js aplikacija (next 16.4.6, react 19.3.1) čija stranica u pregledniku prepoznaje uređaj i preglednik, otvara odgovarajuće web-sučelje i nudi desktop paket. Jedini poziv servera je jedan `POST /api/v1/client-context` sa zatvorenim vrijednostima (P-0.8, `src/client-context/`); stranica ne čeka odgovor i radi i kad slanje ne uspije.

| Uređaj / preglednik | Sučelje | Desktop paket |
|---|---|---|
| Chrome na Windowsu ili macOS-u | `chrome` | Windows ili macOS |
| Mobitel ili tablet (bilo koji preglednik) | `mobile` | – |
| Firefox, Safari, Edge, Opera i ostali na računalu | `other` | Windows ili macOS |

Prvi ekran nudi i dva ulaza za prijavu (ugovor Ductus #2028 §3.1): **Prijava preko AAI@EduHr** (`/api/v1/auth/login?returnTo=/app/web/`) i **Administracija platforme** (`/admin/prijava`). Fokus ili dodir na njima otkazuje automatsko preusmjeravanje.

Bez JavaScripta stranica nudi sve izbore. Putanje su u `src/config.ts`. Stranice su `pages/index.tsx` (`/`), `pages/greska.tsx` (`/greska`, i kao `/greska.html`), `pages/404.tsx` i `pages/500.tsx`, sa sadržajem iz `src/ui/`. Prvi ekran mora ostati malen (P-0.1), pa su to stranice Pages Routera s `unstable_runtimeJS: false`: Next ih pri izgradnji iscrta u statičan HTML bez ijedne svoje skripte i bez Reacta u pregledniku. Stil (`src/style.css`) i vlastita skripta (`src/main.ts`, odnosno `src/errors/main.ts`) ugrađuju se u stranicu kao i prije, a gradi ih `scripts/page-assets.ts` (esbuild) u `getStaticProps`. Tako stranica izgleda i radi isto kao statična, piksel za piksel.

Ostale usluge su na istom podrijetlu preko Next.js rewriteova (`src/rewrites.ts`, `next.config.ts`), po ugovoru Ductus #2028 §1. Adrese su u varijablama okoline i čitaju se pri `next build`:

| Varijabla | Putanje | Primjer |
|---|---|---|
| `APLICATION_FRONT_URL` | `/admin`, `/admin/*` | `https://<host Aplication_fronta>` |
| `INSTITUTION_SERVER_URL` | `/api/v1`, `/api/v1/*` | `https://<host Institution_servera>` |
| `INSTITUTION_FRONT_URL` | `/app/web`, `/app/web/*`, `/app/chrome`, `/app/chrome/*` | `https://<host fronta institucije>` |

Vrijednost je samo podrijetlo (`https:`, lokalno i `http://localhost`), bez putanje; inače izgradnja pada. Usluga bez varijable nema rewrite, pa njezine putanje daju 404, a početna stranica radi. Objava je u `docs/DEPLOY.md`. Vizualni smjer je „papir i grafit” (Ductus `docs/design/DESIGN-SYSTEM.md`).

## Naredbe

```bash
pnpm install
pnpm typecheck   # strogi TypeScript
pnpm test        # vitest
pnpm dev         # next dev na http://localhost:3100
pnpm build       # next build (.next/)
pnpm start       # next start na :3100 (nakon build)
pnpm budget      # gzip proračun iz budget.json nad .next; prekoračenje vraća izlazni kod 1
pnpm e2e         # matrica preglednika (P-0.11): next build, next start na :3101 + Playwright u Chromiumu, Firefoxu i WebKitu
pnpm edge        # lokalni edge na http://localhost:8000 (preloader na :3100, npr. pnpm dev)
pnpm sve         # cijela Ductura lokalno iz susjednih checkouta, iza edgea na :8000
```

Cijeli lokalni tok (usluge, portovi, rute edgea, prijava) je u `docs/LOKALNO.md`.

CI poziva `ci-node.yml` iz `ductura/.github` sa skriptama `typecheck test build budget`. Posao `e2e-matrix` radi u službenoj Playwright slici prikovanoj digestom i pokreće `pnpm e2e`. Preglednici i njihovi sistemski paketi dolaze sa slikom, pa posao nema apt ni `playwright install` (DAN-1101). Oznaka slike mora navesti inačicu `@playwright/test` iz `package.json` (`test/e2e-image.test.ts` provjerava samo tekst oznake i oblik digesta). Docker povlači sliku po digestu, pa nova inačica Playwrighta traži novu oznaku i digest te slike. Kriva slika ruši `pnpm e2e`, jer u njoj nema preglednika potrebne revizije. Uz matricu idu axe (bez kršenja razine serious ili critical) i ručni izbor samo tipkovnicom (`e2e/matrix/a11y.spec.ts`). Opera je ručna provjera.

Vizualni test (`e2e/matrix/visual.spec.ts`, projekt `visual`, samo Chromium): prvi ekran i greške 404 i 503 na 1440, 768 i 400 px uspoređuju se s osnovnim snimkama u `e2e/matrix/visual.spec.ts-snapshots/` bez tolerancije, pa i boja pomaknuta za jedan korak ruši test. Snimke vrijede za Linux iz CI-ja: fontovi su iz slike, a DejaVu Sans, s kojim su snimke nastale, montira se samo za čitanje s runnera `ubuntu-24.04` i prije testova se provjerava (sha256 i `fc-match`). Drugi sustav daje druge piksele. Zato je projekt `visual` uključen samo u CI-ju (`CI`) ili uz `E2E_VISUAL=1`, a lokalni `pnpm e2e` vrti samo matricu. Nova verzija `@playwright/test` ili izmjena izgleda traži nove snimke iz CI izvještaja. Negativni testovi istog speca namjerno ruše usporedbu, pa izvještaj ima njihove priloge i kad je sve zeleno; bez osnovne snimke ili uz `--update-snapshots` padaju prije usporedbe.

## Proračun veličine

`budget.json` zadaje gzip granicu za svaku stranicu (`index.html`, `greska.html`) i za zbroj. `pnpm budget` mjeri izgradnju Nexta: stranica je gzip HTML-a iz `.next/server/pages/` (ili `server/app/`) plus gzip svake skripte i stila koje učita (bez `noModule`), a zbroj broji svaku datoteku jednom. Pada ako je stranica iznad granice, zbroj iznad ukupne granice ili stranica iz proračuna nedostaje. Mapa bez toga mjeri se kao prije, datoteku po datoteku.

Granice su ostale iz statične stranice (4030 B, 2122 B, 6152 B) i Next ih poštuje: izmjereno je 3710 B, 2037 B i ukupno 5747 B gzip. Stranica s App Routerom imala bi oko 140 KB gzip, jer bi nosila runtime Reacta i Nexta. Isti HTML iz istih komponenti i iste ugrađene skripte (`test/static-build.ts`) provjeravaju i `test/build.test.ts` i `test/detect-decisions.test.ts`.

Tekstovi stanja greške nisu na glavnoj stranici: `/greska.html?status=<status ili kod>` ima vlastitu granicu, pa prvi ekran ne raste (`src/errors/README.md`). Tekst skripte prvog ekrana je u `src/client-text.ts`, a `src/text.ts` ga ponovno izvozi.

## Otvoreno

- `src/components/landing` je doslovna kopija Ductusove početne stranice (grana `migracija/kopija-ductus-landing`). Bez Ductusovih ovisnosti (`@/editor`, `@/lib/i18n`, Tiptap) ne prevodi se, pa je isključena iz `tsconfig.json`, a vitest ne pokreće njezine testove. Spaja je sljedeći PR (`/ductus`).

- iPadOS 13+ u zadanom načinu predstavlja se kao Mac. Za njega treba dodati provjeru na klijentu (`navigator.maxTouchPoints`).
- Za Windows na ARM-u i Apple Silicon/Intel treba odlučiti nude li se zasebni paketi.
- Usklađivanje s jednim web repozitorijem (putanja `/app/`) ide zasebnim korakom.
