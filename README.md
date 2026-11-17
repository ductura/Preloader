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

CI poziva `ci-node.yml` iz `ductura/.github` sa skriptama `typecheck test build budget`. Posao `e2e-matrix` instalira tri preglednika i pokreće `pnpm e2e`; uz matricu idu axe (bez kršenja razine serious ili critical) i ručni izbor samo tipkovnicom (`e2e/matrix/a11y.spec.ts`). Opera je ručna provjera.

## Proračun veličine

`budget.json` zadaje gzip granicu za svaku datoteku u `dist` i za zbroj. Pada ako je datoteka iznad granice, zbroj iznad ukupne granice, datoteka iz proračuna nedostaje ili datoteka u `dist` nema granicu.

Tekstovi stanja greške nisu na glavnoj stranici: `dist/greska.html?status=<status ili kod>` ima vlastitu granicu (izmjereno plus oko 10 %), pa prvi ekran ne raste (`src/errors/README.md`).

## Otvoreno

- iPadOS 13+ u zadanom načinu predstavlja se kao Mac. Za njega treba dodati provjeru na klijentu (`navigator.maxTouchPoints`).
- Za Windows na ARM-u i Apple Silicon/Intel treba odlučiti nude li se zasebni paketi.
- Usklađivanje s jednim web repozitorijem (putanja `/app/`) ide zasebnim korakom.
