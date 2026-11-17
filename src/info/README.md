# Info stranica (P-0.9, info dio)

Javna stranica „Kako Ductura radi” na `/info/`. Tekst je u `src/text.ts` (`infoText`), prenesen iz Ductusa (`messagesHr.howItWorks`) bez odjeljka „Pravila fakulteta”: info stranica ne spominje fakultete ni ustanove (PLAN §1 (3e), D-302).

`terms.ts` provjerava svaki niz teksta prije izgradnje. Ime ustanove, zabranjeni izraz iz Ductus `docs/PRODUCT.md` §5, „spremljeno” bez mjesta ili slovo izvan latinice ruše `pnpm build`. Prije usporedbe tekst se normalizira (bez nevidljivih znakova, NFKD bez dijakritika, mala slova, jedan razmak) i provjerava i nad kopijom samo od slova, pa crtica ili razmak unutar riječi ne skrivaju izraz. Blok teksta smije sadržavati samo nizove, polja i obične objekte.

Stranica iz izgradnje i poveznica s prvog ekrana dolaze u sljedećim koracima DAN-969.
