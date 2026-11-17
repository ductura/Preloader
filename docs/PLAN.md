Kanonski plan migracije: [PLAN-MIGRACIJE.md](https://github.com/ductura/.github/blob/main/docs/plan/PLAN-MIGRACIJE.md). Ovaj dokument je dio tog plana.

# Ductura/preloader: plan repozitorija

Stanje: 14. 11. 2026. · **Samo plan.** Izvori kao u [plan servera](https://github.com/ductura/server/blob/main/docs/PLAN.md) i Ductus `origin/main` 220b5db7. Uključuje vlasnikove odluke 14. 11. (A: jedan web repo, prijenos s testovima, ugovor prvi; B: ugovor kao izvor koda, `ductura/.github`, zajednički paket lažnih zamjena). Ispravak 17. 11.: domena je `ductura.org` (vlasnikova odluka, Ductus#2012 c.6934113245).

## 1. Svrha i granica

**Svrha.** Jedini ulaz na domeni. Provjerava server, prepoznaje okruženje, otvara web (jedan repo `ductura/web`, odluka A1) u pravom prikazu i nudi pravi desktop paket. Drži sve stranice grešaka, traku kolačića i pristanak, ulaz u prijavu, javnu info stranicu (3e), javne pravne tekstove, stranicu za preuzimanje i konfiguraciju proxyja na domeni.

**Posljedica odluke A1:** prva odluka više ne bira jedno od tri web-sučelja nego samo **prikaz** u istom webu (računalo ili mobilno, PRIJEDLOG: kao početnu postavku koju web može promijeniti). Druga odluka (koji paket) ostaje ista. Matrica prvog vala §3 ostaje kao tablica testova, s novim očekivanim ishodom.

**Granica (nikad ne ulazi):**
- pristup bazi i odluke o ovlastima (samo server);
- otisak preglednika; slanje išta osim vrste sustava, preglednika, uređaja, verzije i širine zaslona;
- editor, dnevnik i radni ekrani;
- spominjanje fakulteta i ustanova na info stranici (3e);
- automatsko preuzimanje paketa (samo na klik);
- drugi način prijave studenata osim AAI@EduHr (D-09).

## 2. Zatečeno stanje (kostur, 14. 11.)

- Repozitorij `ductura/preloader` na početku: jedan commit. CI zelen (`ubuntu-latest`, `node --test`: pomoćne funkcije i funkcionalni).
- Mali Node HTTP poslužitelj (`src/app.js`, `src/index.js`) koji čita UA i vraća HTML s poveznicom na sučelje i paket.
- `src/detect.js`: `detectOs`, `detectBrowser` (Edge i Opera prije Chromea), `isMobile`, `chooseFrontend` (chrome, mobile, other), `desktopPackageFor`. Samo UA, bez client hints i provjere mogućnosti; iPad koji se predstavlja kao Mac nije prepoznat.
- Funkcionalni testovi: Chrome na Macu → Chrome sučelje + `.dmg`; Chrome na Androidu → mobilno, bez paketa; Edge na Windowsu → ostala sučelja + Windows paket.
- `src/config.js`: domena `ductura.org`, putanje `/app/chrome/`, `/app/mobile/`, `/app/web/`, `/download/…`. Domena odgovara odluci od 17. 11. Putanje se **ne slažu** s migracijom §1c (`/c/`, `/m/`, `/o/`, `/preuzimanje/`). Nakon A1 ostaje jedna putanja weba; P-0.1 usklađuje nakon odluke 1.
- JavaScript i rad na serveru; plan traži TypeScript i statičnu izgradnju s proračunom veličine (migracija §5). `test/user-agents.js` i funkcionalni testovi su polazni fixturei za P-0.2.

## 3. Sadržaj (PRIJEDLOG gdje plan ne navodi)

```
app/                         statična izgradnja (Next.js `output: 'export'`)
  page.tsx, info/, pravno/, preuzimanje/, error.tsx, not-found.tsx, global-error.tsx
src/detect/                  dvije odluke kao čiste funkcije (P-0.2): client hints i mogućnosti, UA zadnji
src/choice/  src/server-check/  src/errors/  src/consent/  src/sign-in/  src/client-context/
deploy/edge/                 konfiguracija obrnutog proxyja i testovi (P-0.10)
e2e/matrix/, e2e/system/     matrica (P-0.11), sistemski e2e (migracija §6)
docs/, .github/ (poziva ductura/.github), CLAUDE.md, AGENTS.md, README.md (hr)
```
Ovisi o `@ductura/contracts` (generirani klijent, katalog grešaka, vektori), `@ductura/test-fakes` (lažni server iz ugovora, lažni OIDC i FIDO2) i `@ductura/ui` (oznake D-188).

## 4. Što dolazi iz Ductusa (prijenos s testovima, A2)

| Izvor (Ductus) | Testovi koji idu s njim | Cilj |
|---|---|---|
| `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`, `src/components/shell/ErrorScreen.tsx` | `src/components/shell/error-screen.test.ts` | `app/`, `src/errors/`; tekst iz kataloga (P-0.5) |
| `src/components/auth/` (`SignInScreen`, `AccessCard`, `access-kind.ts`, `sign-in-link.ts`) | `access-card`, `access-kind`, `sign-in-link`, `sign-in-tokens` `.test.ts` | `src/sign-in/`; poveznica na `/api/v1/auth/login` (S-1E-a) |
| `src/components/landing/`, `src/components/how-it-works/`, `app/kako-radi` | `accessTabs`, `rewind`, `try-out-imports`, `access`, `copy` `.test.ts` | `app/info/` **bez spominjanja ustanova** (3e); test „nema imena ustanove” nov |
| `src/lib/status/public-status.ts` | `public-status.test.ts`; `tests/unit/health-route.test.ts` kao vektor | `src/server-check/` uz generirani klijent |
| oznake (`app/globals.css`, `app/fonts`, `src/components/shell/theme`) | `tokens.test.ts`, `theme.test.ts` | preko `@ductura/ui` (paket, ne kopija) |
| e2e `landing`, `prijava`, `login/how-it-works`, `security-headers`, `content-security-policy` `.spec.ts`; `login/prijava.spec.ts` | sami su testovi | `e2e/`; mijenja se samo putanja |
| `src/server/http/content-security-policy.ts` | `src/server/http/content-security-policy.test.ts` | `deploy/edge/` (PRIJEDLOG: CSP statičnih stranica postavlja proxy; vidi [KARTA](https://github.com/ductura/.github/blob/main/docs/plan/KARTA.md)) |
| kostur `src/detect.js`, `test/user-agents.js` | `test/helpers.test.js`, `test/functional.test.js` | fixturei za P-0.2 |

**Novo:** client hints i provjera mogućnosti, ručni izbor, pristanak i kolačići, slanje konteksta, proxy.

## 5. Zadaci (migracija §10b; plan 2.0 i 2.1)

**Ugovor prvi (A3):** zadaci preloadera ovise o shemi i vektorima rute u ugovoru (server U4–U10), ne o gotovom serveru. Rade nad lažnim serverom iz `@ductura/test-fakes`. Gotov serverski zadatak treba samo za sistemski e2e.

| ID | Što | Prije A3 ovisio o | Sada ovisi o | Risk |
|---|---|---|---|---|
| P-0.1 | Kostur (statična izgradnja, proračun veličine) | V-1b, T-0.4 | V-1b, `ductura/.github` (U2) | standard |
| P-0.2 | Dvije odluke kao čiste funkcije | P-0.1 | P-0.1 | standard |
| P-0.3 | Ručni izbor prikaza i paketa, pamćenje | P-0.2 | P-0.2 | standard |
| P-0.11 | Matrica u Playwrightu, tri motora | P-0.3 | P-0.3 | standard |
| P-0.4 | Provjera servera i verzije API-ja | S-1M-a | shema `health` (U4, U7) | standard |
| P-0.5 | Stranice grešaka iz kataloga | S-1M-c | katalog grešaka u ugovoru (U4) | standard |
| P-0.8 | Slanje konteksta klijenta | S-1M-b | shema `client-context` | standard |
| P-0.7 | Ulaz u prijavu AAI@EduHr; FIDO2 za mrežnog inženjera | S-1E-a, S-1E-g | sheme `auth/*` + lažni OIDC i FIDO2 (U9); spajanje tek uz S-1E-a i S-1E-g | critical |
| P-0.6 | Traka kolačića i ekran pristanka | S-1N-d | shema pristanka i `legal`; spajanje uz S-1N-d | critical |
| P-0.9 | Info stranica, pravni tekstovi, preuzimanje | S-1N-c, S-1H.5 | sheme `legal`, `downloads` | standard |
| P-0.10 | Proxy na domeni i lokalni sistemski stog | S-1H.7 | S-1H.7 (treba pravi server) | critical |
| VS-1 | Vertikalni presjek (ulaz i preusmjeravanje) | S-1E-a, S-1D-d, S-1M-a, S-M-5, E-0.2, P-0.1 | isto | critical |

Za `critical` zadatke (P-0.6, P-0.7) PRIJEDLOG: gradi se nad lažnim serverom, a spaja tek kad pravi serverski zadatak prođe iste vektore. P-0.7 ne gradi prijavu admina aplikacije (pitanje 8).

## 6. Testovi (prepoznavanje, usmjeravanje, greške, pristanak)

**Dvojnici (bez Dockera):** lažni server iz ugovora (`@ductura/test-fakes`) s vektorima `health` (`ok`, `degraded`, nedostupan, kriva verzija), katalogom grešaka i manifestom (pun, prazan, bez jednog sustava); lažni AAI@EduHr i lažni FIDO2 iz istog paketa; UA i client hints kao fixturei. Sistemski e2e nad pravim serverom pokrenutim nativno.

| Sloj | Konkretni slučajevi |
|---|---|
| **Pomoćne funkcije (tablično)** | Za svaki redak prvog vala §3, novi ishod nakon A1: Windows+Chrome → web, prikaz računalo, gumb Windows; Mac+Chrome → web, računalo, macOS; Windows+Edge/Firefox/Opera → web, računalo, Windows; Mac+Safari/Firefox → web, računalo, macOS; mobitel ili tablet → web, prikaz mobilno, bez istaknutog paketa; Linux ili nepoznat → web, računalo, ručni izbor paketa. Rubni: Edge i Opera s oznakom Chrome; iPad u desktop načinu (UA kao Mac, dodir); uski prozor; client hints prisutni i odsutni; UA i hints se ne slažu (hints pobjeđuju). Ulaz nikad nema više od dopuštenih polja. |
| **Property** | nasumičan UA i hints daju jedan prikaz i najviše jedan istaknut paket; ručni izbor uvijek pobjeđuje; ništa ne pokreće preuzimanje. |
| **Integracija** | `ok` nastavlja, `degraded` upozorava, nedostupan → greška ili offline, `minClientVersion` veći od izgradnje → osvježavanje (P-0.4); svaki status (400, 401, 403, 404, 408, 429, 500, 502, 503, 504, offline, `session_expired`) ima stranicu i tekst iz lokala (P-0.5); `client-context` šalje samo zatvorene vrijednosti, jednom (P-0.8). |
| **Ugovor** | generirani klijent prolazi vektore `health`, `client-context`, `legal`, `downloads`, `auth/login`; nova verzija ugovora koja lomi preloader ruši CI. |
| **Dokaz jednakosti** | preneseni testovi (§4) prolaze s istim tvrdnjama. |
| **e2e (P-0.11)** | Chromium, Firefox, WebKit uz emulaciju: Desktop Chrome (Windows i Mac UA), Edge, Firefox, Safari, Pixel 7, iPhone, iPad, iPad u desktop načinu, prozor 600 px; za svaki: pravi prikaz, pravi gumb, ručna promjena se pamti; nedostupan paket nudi nastavak u webu. Opera ručno. |
| **Pristanak i kolačići** | bez pristanka samo nužni kolačić sesije; izbor se pamti i mijenja; nova verzija uvjeta traži ponovni pristanak (`consentRequired: true`); popis kolačića = stvarni `Set-Cookie` (P-0.6). |
| **Prijava** | gumb vodi samo na AAI@EduHr; za studenta nema drugog puta; mrežni inženjer dobiva FIDO2 korak (P-0.7). |
| **Proxy** | `/` → preloader, putanja weba → izgradnja `ductura/web`, `/api/v1/` → server, `/preuzimanje/` → server; nepoznata putanja → 404; kolačić `__Host-` na jednom porijeklu; CSP i zaglavlja na svakoj putanji (P-0.10). |
| **Sistemski e2e** | `e2e/system/`: domena → preloader → web → server kroz pravi proxy (VS-1), noćno i za kandidata izdanja; SHA svakog repoa. |
| **Vizualni** | prvi ekran, info, greške, traka kolačića na 1440, 768 i 400 px, „papir i grafit” (D-188), usporedba s odobrenom slikom (SESSIONS §6). |
| **Pristupačnost** | axe na svakoj stranici; tipkovnica kroz traku kolačića i ručni izbor; kontrast D-188. |
| **Performanse** | proračun veličine JS-a prvog ekrana (granica **otvoreno**, PRIJEDLOG odrediti u P-0.1); vrijeme do prvog prikaza. |
| **Sigurnost** | zatvoren popis poslanih polja; prepoznavanje nikad za pristup; zabranjeni izrazi; gitleaks i dependency review; `test-fakes` nije u izgradnji. |

**Prag „gotovo”:** svi retci matrice i rubni slučajevi zeleni u unit testu i u tri motora; svaka greška ima tekst; proxy pokriva svaku putanju; sistemski e2e zelen sa SHA; vizualna usporedba odobrena.

## 7. CI i gate

- Poslovi (reusable iz `ductura/.github`): `lint`, `typecheck`, `test-helpers`, `test-functional` (nad lažnim serverom), `contracts`, `e2e-matrix`, `size-budget`, `a11y`, `secret-scan`, `dependency-review`, `ci-ok`. Noćno `e2e-system`.
- Risk `critical`: `deploy/edge/**`, `src/consent/**`, `src/sign-in/**`, `.github/**` (PRIJEDLOG tablice, T-0.2).
- Vlasničke radnje: V-1b, V-2, V-3, odluka 1 (putanja weba i prikaz), V-0 (e-pošta; domena je odlučena 17. 11.: `ductura.org`).

## 8. Kriterij izlaza (prvi val)

1. P-0.1 … P-0.11 spojeni; putanje usklađene s odlukom 1 i A1; domena je `ductura.org`.
2. Matrica zelena u tri motora; ručni izbor radi svugdje; Opera ručno.
3. Prijava samo AAI@EduHr; pristanak i kolačići po 3d.
4. Sistemski e2e (VS-1) zelen kroz pravi proxy, sa SHA svih repoa.
5. Gumbi za preuzimanje vode na manifest servera; bez paketa korisnik nastavlja u webu.
