# Provjera servera (P-0.4, samo poziv)

`checkHealth(get)` šalje jedan `GET /api/v1/health` i vraća stanje (`ok` ili `degraded`) i `minClientVersion`, ili `null` kad server nije dostupan ili odgovor nema oblik iz ugovora. Ne baca. Tip tijela je `Operations['platform.health.get']` iz `@ductura/contracts` (samo tip).

Stranica ga još ne uključuje, pa `index.html` ne raste. Uključivanje i ishodi (upozorenje, osvježavanje) su P-0.4.

Test `test/contract-vectors.test.ts` (DAN-934) vrti vektore `platform.health.get` i `client.context.post` iz `@ductura/test-fakes` kroz `checkHealth` i `sendClientContext` nad lažnim serverom. Novi, uklonjeni ili promijenjeni vektor ruši test.
