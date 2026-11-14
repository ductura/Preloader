# Ductura / preloader

Sedmi razvojni dio. Na ulazu (ductura.org) prepoznaje uređaj i preglednik, otvara odgovarajuće web-sučelje i nudi desktop paket.

| Uređaj / preglednik | Sučelje | Desktop paket |
|---|---|---|
| Chrome na Windowsu ili macOS-u | `web-chrome` | Windows ili macOS |
| Mobitel ili tablet (bilo koji preglednik) | `web-mobile` | – |
| Firefox, Safari, Edge, Opera i ostali na računalu | `web-other` | Windows ili macOS |

## Funkcionalna provjera

Chrome na Macu otvara Chrome sučelje i nudi macOS paket. Chrome na Androidu otvara mobilno sučelje.
Pokriva je `test/functional.test.js`.

## Pokretanje

```bash
npm start          # http://localhost:3000
npm test
npm run test:helpers
npm run test:functional
```

Putanje sučelja i paketa podešavaju se varijablama `FRONTEND_CHROME`, `FRONTEND_MOBILE`, `FRONTEND_OTHER`, `DOWNLOAD_WINDOWS`, `DOWNLOAD_MACOS` (vidi `src/config.js`).

## Otvoreno

- iPadOS 13+ u zadanom načinu predstavlja se kao Mac. Za njega treba dodati provjeru na klijentu (`navigator.maxTouchPoints`).
- Za Windows na ARM-u i Apple Silicon/Intel treba odlučiti nude li se zasebni paketi.
