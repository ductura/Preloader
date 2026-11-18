# Fontovi za vizualni test

DejaVu Sans 2.37 (`DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`) za posao `e2e-matrix` (DAN-1097-2). Osnovne snimke iz DAN-1076 nastale su na runneru `ubuntu-24.04` s tim fontom. Službena slika `mcr.microsoft.com/playwright` ga nema: `sans-serif` i `system-ui` u njoj daju WenQuanYi Zen Hei, a taj font nema podebljani rez, pa vizualni test pada.

Posao prije `pnpm e2e` provjerava `SHA256SUMS`, kopira fontove u `/usr/share/fonts/truetype/dejavu` i pokreće `fc-cache`. Zatim provjerava da `fc-match` daje DejaVu Sans, a za podebljani rez `DejaVu Sans|Bold`. Ništa se ne preuzima: nema apt-a ni mreže.

- **Izvor:** Ubuntu 24.04 paket `fonts-dejavu-core_2.37-8_all.deb` (sha256 `40049660c194f3b8a2541fc7369efebb10e9f94bdac836a2f38fafedd10fa73a`), datoteke iz `/usr/share/fonts/truetype/dejavu/` bez izmjena. To su isti bajtovi kao na runneru.
- **Licenca:** `LICENSE` je neizmijenjeni tekst iz DejaVu 2.37 (Bitstream Vera i Arev; izmjene DejaVu su javno dobro). Licenca dopušta redistribuciju uz ovu obavijest.
- **Provjera:** `test/e2e-image.test.ts` uspoređuje sha256 obaju fontova i točan sadržaj `SHA256SUMS`. `.gitattributes` označava fontove kao binarne, a `SHA256SUMS` čuva LF.

Novi font ili nova inačica mijenjaju piksele, pa traže nove osnovne snimke i vizualnu potvrdu (Ductus `docs/SESSIONS.md` §6).
