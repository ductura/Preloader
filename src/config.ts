// Sve na jednoj domeni: ductura.org. Putanje su relativne, pa stranica ne zove drugi poslužitelj.
// Odredišta slijede tablicu ruta `deploy/edge/routes.ts` (jedini zapis putanja usluga, DAN-1550);
// `test/config-routes.test.ts` pada čim se razmimoiđu.
export interface Config {
  /**
   * Inačice koje postoje (karta adresa D-318). Preloader sam vodi na ekran prijave aplikacije; prijavu i
   * administraciju ne nudi. `mobile` nema dok ne postoji `/mobilna/`: mobitel tada ide na web.
   */
  frontends: { web: string; mobile?: string };
  downloads: { windows: string; macos: string };
}

export const defaultConfig: Config = {
  frontends: {
    web: '/aplikacija/prijava',
  },
  downloads: {
    windows: '/preuzimanje?sustav=windows',
    macos: '/preuzimanje?sustav=macos',
  },
};

/** Verzija izgradnje (`package.json`); šalje se u kontekstu klijenta (P-0.8). */
export const APP_VERSION = '0.1.0';
