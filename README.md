# Ductura / preloader

Ulaz u Ducturu (ductura.org). Statična stranica koja u pregledniku prepoznaje uređaj i preglednik, otvara odgovarajuće web-sučelje i nudi desktop paket. Jedini poziv servera je jedan `POST /api/v1/client-context` sa zatvorenim vrijednostima (P-0.8, `src/client-context/`); stranica ne čeka odgovor i radi i kad slanje ne uspije.

| Uređaj / preglednik | Sučelje | Desktop paket |
|---|---|---|
| Chrome na Windowsu ili macOS-u | `chrome` | Windows ili macOS |
| Mobitel ili tablet (bilo koji preglednik) | `mobile` | – |
| Firefox, Safari, Edge, Opera i ostali na računalu | `other` | Windows ili macOS |

Bez JavaScripta stranica nudi sve izbore. Putanje su u `src/config.ts`. Vizualni smjer je „papir i grafit” (Ductus `docs/design/DESIGN-SYSTEM.md`).

## Naredbe

```bash
pnpm install
pnpm typecheck   # strogi TypeScript
pnpm test        # vitest
pnpm build       # dist/index.html i dist/greska.html (stil i skripta ugrađeni)
pnpm budget      # gzip proračun iz budget.json; prekoračenje vraća izlazni kod 1
pnpm e2e         # matrica preglednika (P-0.11): izgradnja + Playwright u Chromiumu, Firefoxu i WebKitu
```

CI poziva `ci-node.yml` iz `ductura/.github` sa skriptama `typecheck test build budget`. Posao `e2e-matrix` radi u službenoj Playwright slici prikovanoj digestom i pokreće `pnpm e2e`. Preglednici i njihovi sistemski paketi dolaze sa slikom, pa posao nema apt ni `playwright install` (DAN-1101). Oznaka slike je inačica `@playwright/test` iz `package.json` (`test/e2e-image.test.ts`), pa nova inačica traži i novu oznaku i digest slike. Uz matricu idu axe (bez kršenja razine serious ili critical) i ručni izbor samo tipkovnicom (`e2e/matrix/a11y.spec.ts`). Opera je ručna provjera.

Vizualni test (`e2e/matrix/visual.spec.ts`, projekt `visual`, samo Chromium): prvi ekran i greške 404 i 503 na 1440, 768 i 400 px uspoređuju se s osnovnim snimkama u `e2e/matrix/visual.spec.ts-snapshots/` bez tolerancije, pa i boja pomaknuta za jedan korak ruši test. Snimke vrijede za Linux iz CI-ja: fontovi su iz slike, a DejaVu Sans, s kojim su snimke nastale, montira se samo za čitanje s runnera `ubuntu-24.04` i prije testova se provjerava (sha256 i `fc-match`). Drugi sustav daje druge piksele. Zato je projekt `visual` uključen samo u CI-ju (`CI`) ili uz `E2E_VISUAL=1`, a lokalni `pnpm e2e` vrti samo matricu. Nova verzija `@playwright/test` ili izmjena izgleda traži nove snimke iz CI izvještaja. Negativni testovi istog speca namjerno ruše usporedbu, pa izvještaj ima njihove priloge i kad je sve zeleno; bez osnovne snimke ili uz `--update-snapshots` padaju prije usporedbe.

## Proračun veličine

`budget.json` zadaje gzip granicu za svaku datoteku u `dist` i za zbroj. Pada ako je datoteka iznad granice, zbroj iznad ukupne granice, datoteka iz proračuna nedostaje ili datoteka u `dist` nema granicu.

Tekstovi stanja greške nisu na glavnoj stranici: `dist/greska.html?status=<status ili kod>` ima vlastitu granicu (izmjereno plus oko 10 %), pa prvi ekran ne raste (`src/errors/README.md`).

## Otvoreno

- iPadOS 13+ u zadanom načinu predstavlja se kao Mac. Za njega treba dodati provjeru na klijentu (`navigator.maxTouchPoints`).
- Za Windows na ARM-u i Apple Silicon/Intel treba odlučiti nude li se zasebni paketi.
- Usklađivanje s jednim web repozitorijem (putanja `/app/`) ide zasebnim korakom.
