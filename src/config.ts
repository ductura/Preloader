// Sve na jednoj domeni: ductura.org. Putanje su relativne, pa stranica ne zove drugi poslužitelj.
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
    windows: '/download/Ductura-Setup-x64.exe',
    macos: '/download/Ductura-macOS.dmg',
  },
  signIn: {
    returnTo: '/app/web/',
    admin: '/admin/prijava',
  },
};

/** Verzija izgradnje (`package.json`); šalje se u kontekstu klijenta (P-0.8). */
export const APP_VERSION = '0.1.0';
