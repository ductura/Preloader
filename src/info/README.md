# Info stranica (P-0.9, info dio)

Javna stranica „Kako Ductura radi” na `/info/`. Tekst je u `src/text.ts` (`infoText`), prenesen iz Ductusa (`messagesHr.howItWorks`) bez odjeljka „Pravila fakulteta”: info stranica ne spominje fakultete ni ustanove (PLAN §1 (3e), D-302).

`terms.ts` provjerava svaki niz teksta prije izgradnje. Ime ustanove, zabranjeni izraz iz Ductus `docs/PRODUCT.md` §5, „spremljeno” bez mjesta ili slovo izvan latinice ruše `pnpm build`. Prije usporedbe tekst se normalizira (NFKC, bez nevidljivih i kontrolnih znakova, jedan razmak, mala slova).

Stranica iz izgradnje i poveznica s prvog ekrana dolaze u sljedećim koracima DAN-969.
