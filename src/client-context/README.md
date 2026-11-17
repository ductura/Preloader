# Kontekst klijenta (P-0.8)

Preloader jednom šalje `POST /api/v1/client-context`: aplikaciju, verziju izgradnje, sustav, preglednik, uređaj i razred širine prozora, svaki iz zatvorene liste. Ne čeka odgovor; ako slanje ne uspije, korisnik svejedno nastavlja.

`contract.ts` je vendorirana kopija sheme iz `ductura/server` (putanja i SHA u komentaru datoteke); test `test/client-context.test.ts` uspoređuje je s vektorima izvora. Zamjena paketom `@ductura/contracts` je zaseban zadatak.
