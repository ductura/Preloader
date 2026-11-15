# Ductura / preloader

Ulaz u Ducturu (ductura.org). Statična stranica koja u pregledniku prepoznaje uređaj i preglednik, otvara odgovarajuće web-sučelje i nudi desktop paket. Ne zove nijedan poslužitelj.

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
pnpm build       # dist/index.html (stil i skripta ugrađeni)
pnpm budget      # gzip proračun iz budget.json; prekoračenje vraća izlazni kod 1
pnpm e2e         # matrica preglednika (P-0.11): izgradnja + Playwright u Chromiumu, Firefoxu i WebKitu
```

CI poziva `ci-node.yml` iz `ductura/.github` sa skriptama `typecheck test build budget`. Posao `e2e-matrix` instalira tri preglednika i pokreće `pnpm e2e`; Opera je ručna provjera.

## Proračun veličine

`budget.json` zadaje gzip granicu za svaku datoteku u `dist` i za zbroj. Pada ako je datoteka iznad granice, zbroj iznad ukupne granice, datoteka iz proračuna nedostaje ili datoteka u `dist` nema granicu.

## Otvoreno

- iPadOS 13+ u zadanom načinu predstavlja se kao Mac. Za njega treba dodati provjeru na klijentu (`navigator.maxTouchPoints`).
- Za Windows na ARM-u i Apple Silicon/Intel treba odlučiti nude li se zasebni paketi.
- Usklađivanje s jednim web repozitorijem (putanja `/app/`) ide zasebnim korakom.
