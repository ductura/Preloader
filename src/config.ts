// Sve na jednoj domeni: ductura.org. Putanje su relativne, pa stranica ne zove drugi poslužitelj.
// Odredišta slijede tablicu ruta `deploy/edge/routes.ts` (jedini zapis putanja usluga, DAN-1550);
// `test/config-routes.test.ts` pada čim se razmimoiđu.
export interface Config {
  frontends: { chrome: string; mobile: string; other: string };
  downloads: { windows: string; macos: string };
  /** Prijava (ugovor #2028 §3.1): povratak nakon AAI@EduHr i ulaz administracije platforme. */
  signIn: { returnTo: string; admin: string };
}

export const defaultConfig: Config = {
  frontends: {
    chrome: '/app/chrome/',
    mobile: '/app/mobile/',
    other: '/app/web/',
  },
  downloads: {
    windows: '/preuzimanje?sustav=windows',
    macos: '/preuzimanje?sustav=macos',
  },
  signIn: {
    returnTo: '/app/web/',
    admin: '/admin/prijava',
  },
};

/** Verzija izgradnje (`package.json`); šalje se u kontekstu klijenta (P-0.8). */
export const APP_VERSION = '0.1.0';
