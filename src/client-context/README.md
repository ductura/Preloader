# Kontekst klijenta (P-0.8)

Preloader jednom šalje `POST /api/v1/client-context`: aplikaciju, verziju izgradnje, sustav, preglednik, uređaj i razred širine prozora, svaki iz zatvorene liste. Ne čeka odgovor; ako slanje ne uspije, korisnik svejedno nastavlja.

Tip tijela je `Operations['client.context.post']['body']` iz `@ductura/contracts` (samo tip; stranica ne uključuje kod paketa). Test `test/client-context.test.ts` provjerava tijelo validatorom paketa (`validateInput`), a put, granicu tijela i uzorak verzije uspoređuje s `openapi/v1.json` paketa. Nova verzija ugovora koja lomi preloader ruši `pnpm typecheck` ili test.
