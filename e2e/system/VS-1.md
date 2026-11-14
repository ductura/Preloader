# VS-1 i VS-2: sistemski scenarij od ulaza do potpisane revizije

Linear DAN-760. Ovo je specifikacija, ne izvršni test. Rastavlja tekst prihvata DAN-760 na tvrdnje. Svaka tvrdnja navodi korak, opažanje koje test može provjeriti strojno (HTTP odgovor, tekst u sučelju, zapis u lokalnom dnevniku ili vrijednost na poslužitelju) i današnje stanje dokaza. Izvršni test piše se kad postoje server (DAN-758) i web (DAN-759). Svaka tvrdnja ovdje postaje jedan ili više njegovih koraka, a ID tvrdnje (npr. `VS-1.6`) ide u naziv koraka (`test.step`).

Uzor za oblik testa je Ductus `e2e/login/evidence.spec.ts` na `d52a92c3`. Uz tvrdnje se navodi koji se njegov obrazac (helper ili test) može prenijeti. Imena helpera odnose se na tu datoteku.

## Pretpostavke

- **Stog.** Isti scenarij izvodi se u lokalnom stogu i u CI-ju: preloader (ovaj repo), web pod `/app/` na istom originu i server s bazom. Preloader i web dijele origin (`src/config.ts`: putanje su relativne). Rute u `src/config.ts` mijenjaju se zasebnim zadatkom. Tvrdnje zato traže samo da je putanja pod `/app/`, ne točnu putanju.
- **Prijava (D-09).** Prijava ide samo kroz lokalni lažni OIDC pružatelj, koji postoji samo u lokalnom stogu i u CI-ju. Test ne smije uvesti nijedan drugi način prijave, ni pomoćnu rutu koja zaobilazi OIDC.
- **Podaci.** Svi podaci su izmišljeni: dva sintetička studenta (A i B, npr. `student-a@demo.ductura.test` i `student-b@demo.ductura.test`), izmišljeni kolegij i zadatak, i rad studenta A koji postoji prije testa (seed). Jedinstvena rečenica gradi se po izvođenju, npr. `Izmišljena rečenica ${randomUUID()}.`, pa se ne može zamijeniti s tekstom iz ranijeg izvođenja.
- **Uređivač.** Web koristi objavljeni paket `editor-core` 0.x iz registra, ne lokalnu poveznicu.
- **Oznake stanja.** Tekst „Spremljeno na uređaju” i „Spremljeno na poslužitelju” je tekst sučelja. Test ga čita iz kataloga poruka weba, a ne iz vlastite kopije. Ako web uz tekst izlaže i strojno stanje (kao `data-state` u Ductusu), test provjerava oboje.

## Oznake stanja dokaza

- **NEPROVJERENO (DAN-758):** tvrdnja traži server ili njegov odgovor, a server još ne postoji.
- **NEPROVJERENO (DAN-759):** tvrdnja traži web pod `/app/`, a web još ne postoji.
- **NEPROVJERENO (uređaj):** tvrdnja traži izvođenje na fizičkom uređaju. Emulacija tu tvrdnju ne dokazuje.
- **DJELOMIČNO:** dio tvrdnje danas dokazuje test koji je naveden. Ostatak čeka označene zadatke.

Danas (preloader `main` na `63434ae`) nijedna tvrdnja nije provjerena od kraja do kraja.

## VS-1: student piše i rad stiže na poslužitelj s potpisom

| ID | Korak | Opažanje koje test provjerava | Stanje dokaza | Obrazac iz `evidence.spec.ts` |
|---|---|---|---|---|
| VS-1.1 | Student A otvara `/` u čistom kontekstu preglednika. | `GET /` vraća `200` i HTML preloadera (`<html lang="hr">`). Poveznica `#open-app` ima `href` na istom originu i putanja počinje s `/app/`. Preloader ne šalje nijedan zahtjev prema drugom originu. | DJELOMIČNO: `test/functional.test.ts` provjerava `href` i izbor sučelja za Chrome na Macu i Androidu u happy-domu. Posluživanje u stogu: NEPROVJERENO (DAN-759). | — |
| VS-1.2 | Student A slijedi preloader i prijavljuje se kao A kod lažnog OIDC pružatelja. | Lanac preusmjeravanja prolazi kroz host lažnog pružatelja i vraća se na isti origin kao u VS-1.1. Konačni `page.url()` ima putanju pod `/app/`. Postoji sesijski kolačić weba. Na stranici prijave nema nijednog drugog načina prijave. | NEPROVJERENO (DAN-758, DAN-759) | `signIn` iz `./support` |
| VS-1.3 | Student A otvara svoj postojeći rad. | Uređivač je upisiv (`contenteditable="true"`). `documentId` koji web koristi (iz zahtjeva prema serveru ili iz lokalnog dnevnika) jednak je `documentId` seeda za rad studenta A. Lockfile weba razrješava `editor-core` na verziju `0.x.y` iz registra (polje `integrity`, a ne `link:`, `file:` ni `workspace:`). | NEPROVJERENO (DAN-758, DAN-759) | `openSheet`, `workDocument` |
| VS-1.4 | Student A upisuje jedinstvenu rečenicu na kraj dokumenta. | Uređivač sadrži točno tu rečenicu (`toContainText`). | NEPROVJERENO (DAN-759) | `type` |
| VS-1.5 | Lokalni upis. | U lokalnom dnevniku postoji red za `documentId` s tom rečenicom. Status prikazuje „Spremljeno na uređaju”, i to tek nakon što je red zapisan (test čita dnevnik prije teksta statusa, ili oba unutar istog `expect.poll`). | NEPROVJERENO (DAN-759) | `localOf` |
| VS-1.6 | Server odgovara `202 pending_signature`. | Odgovor na zahtjev za upis ima HTTP `202` i tijelo sa statusom `pending_signature`. Od tog odgovora do potpisa status nikad ne prikazuje „Spremljeno na poslužitelju”. Test to provjerava uzorkovanjem kroz bar 2 s dok drži potpis (npr. zadržava odgovor koji nosi potpis). | NEPROVJERENO (DAN-758, DAN-759) | `neverSynced`; zadržavanje kao u testu „typing reaches … only with the server's signed receipt” |
| VS-1.7 | Potpis stiže i klijent ga provjerava. | „Spremljeno na poslužitelju” se pojavi tek kad klijent dobije potpisanu potvrdu i provjeri potpis. Potvrda nosi `clientTransactionId` poslanog upisa, `documentId` rada i reviziju jednaku reviziji na poslužitelju. Tri negativna slučaja nikad ne prikažu „Spremljeno na poslužitelju”: (a) potvrda s promijenjenim bajtom potpisa; (b) ispravno potpisana potvrda za drugu transakciju; (c) ispravno potpisana potvrda za drugi dokument ili drugu reviziju. U sva tri slučaja red ostaje u lokalnom dnevniku. Kanal kojim potpis stiže nakon `202` određuje DAN-758. Tvrdnja vrijedi za svaki kanal. | NEPROVJERENO (DAN-758, DAN-759) | „a forged receipt never shows server-saved”, `flipSignatureByte`, `sameOnServer` |
| VS-1.8 | Osvježavanje stranice. | Nakon `page.reload()` uređivač sadrži rečenicu. | NEPROVJERENO (DAN-759) | „a reload continues the chain” |
| VS-1.9 | Novi kontekst preglednika bez lokalnog dnevnika, isti student A. | Prije otvaranja rada kontekst nema nijednu bazu lokalnog dnevnika (`indexedDB.databases()`). Rad se puni sa servera (test vidi odgovor s dokumentom). Uređivač prikazuje isti `documentId`, istu reviziju, isti hash i isti tekst kao poslužitelj nakon VS-1.7. Hash se uspoređuje s vrijednošću sa servera i s hashom koji test sam izračuna nad primljenim dokumentom (oblik hasha određuje DAN-758). | NEPROVJERENO (DAN-758, DAN-759) | `serverOf`, `localOf` (za prazan dnevnik) |
| VS-1.10 | Odgovor se izgubi nakon SQL commita. | Test pušta zahtjev do servera (`route.fetch`), a pregledniku prekida vezu (`connectionreset`) na odgovor koji je server već upisao. Ponovni pokušaj nosi isti ključ transakcije i iste bajtove tijela. Odgovor na njega je isti kao izgubljeni, osim statusa (`duplicate`). Revizija na poslužitelju poraste točno jednom za taj ključ. Dok ponovni pokušaj ne prođe, status ne prikazuje „Spremljeno na poslužitelju”. | NEPROVJERENO (DAN-758, DAN-759) | „M3.10-P02: an answer lost after the commit …” |
| VS-1.11 | Student B se u zasebnom kontekstu prijavljuje lažnim OIDC-om i pokušava doći do rada studenta A. | Čitanje rada A po `documentId` (adresa weba i API servera) vraća `403` ili `404`, a tijelo ne sadrži rečenicu iz VS-1.4. Upis s `documentId` rada A vraća `403` ili `404`, a revizija i tekst rada A na poslužitelju ostaju nepromijenjeni. Rad A se ne pojavljuje u popisu radova studenta B. | NEPROVJERENO (DAN-758, DAN-759) | — (izolacija: Ductus `e2e/login/my-assignments.spec.ts`) |
| VS-1.12 | Zapis izvođenja. | Test prilaže `vs-run.json` (`test.info().attach`) s poljima: `preloaderSha`, `webSha`, `serverSha` (svaki 40 heksadecimalnih znakova, `^[0-9a-f]{40}$`), `packages` (barem `editor-core` s točnom verzijom iz lockfilea weba), `browser` (motor i verzija iz `browser.version()`), `documentId`, `revision` i `hash` iz VS-1.9. Prazno ili nepoznato polje ruši test. | NEPROVJERENO (DAN-758, DAN-759) | — |

## VS-2: isti rad u novom mobilnom kontekstu

| ID | Korak | Opažanje koje test provjerava | Stanje dokaza | Obrazac |
|---|---|---|---|---|
| VS-2.1 | Novi kontekst s emulacijom mobitela (npr. Playwright `devices["Pixel 7"]` u Chromiumu i `devices["iPhone 15"]` u WebKitu), bez ikakve pohrane iz VS-1. Student A otvara `/`. | Preloader bira mobilno sučelje (`data-frontend="mobile"`), a `#open-app` vodi pod `/app/` na istom originu. | DJELOMIČNO: `test/functional.test.ts` („Chrome na Androidu”) i `test/detect.test.ts` (`isMobile`). Posluživanje u stogu: NEPROVJERENO (DAN-759). | — |
| VS-2.2 | Student A se prijavljuje lažnim OIDC-om i otvara isti rad. | Prije otvaranja kontekst nema lokalnog dnevnika. Rad se puni sa servera. Uređivač prikazuje rečenicu iz VS-1.4. `documentId`, revizija i hash jednaki su vrijednostima iz VS-1.9. | NEPROVJERENO (DAN-758, DAN-759) | `signIn`, `serverOf` |
| VS-2.3 | Zapis izvođenja. | `vs-run.json` za VS-2 uz polja iz VS-1.12 ima `device` (ime iz `devices[...]` ili `physical`), `userAgent`, `viewport`, `isMobile`, `hasTouch` i `engine` (`chromium`, `webkit` ili `firefox`) s verzijom. | NEPROVJERENO (DAN-758, DAN-759) | — |
| VS-2.4 | Fizički Safari na iPhoneu ili iPadu. | Isti koraci VS-2.1 do VS-2.3 s `device: "physical"`, modelom uređaja i verzijom iOS-a ili iPadOS-a. WebKit u emulaciji nije Safari i ovu tvrdnju ne dokazuje. | NEPROVJERENO (uređaj) do izvođenja na uređaju | — |

## Što scenarij ne tvrdi

- Ne tvrdi ništa o autorstvu teksta. Potpis govori samo da zapis nije mijenjan od primitka (Ductus `docs/PRODUCT.md` §5, pravilo 9).
- Ne propisuje oblik API-ja, kanal kojim potpis stiže nakon `202` ni oblik hasha. To određuje DAN-758, a test ih preuzima odande.
- Ne mijenja preloader ni njegove rute. Rute u `src/config.ts` mijenjaju se zasebnim zadatkom.
- Zelen izvršni test u emulaciji ne mijenja oznaku VS-2.4.
