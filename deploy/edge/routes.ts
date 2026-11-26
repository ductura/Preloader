// Jedna tablica ruta jedinog podrijetla (P-0.10, ugovor Ductus #2028 §1). Iz nje čitaju oba ulaza:
// rewriteovi Nexta na Vercelu (`src/rewrites.ts`) i lokalni edge (`dev-proxy.mjs`). Nova usluga ili
// putanja dodaje se samo ovdje. Ulazne putanje `/` (naslovnica fronta institucije) i `/prijava` (prvi ekran
// preloadera) su u `ENTRY_REWRITES` (DAN-1574). Putanja koja nije ni u jednoj tablici ide preloaderu: njegove
// stranice, a sve ostalo je 404. Kod je čisti TypeScript bez `node:` uvoza (Node ga izvršava bez prevođenja).

/** Usluga iza jedinog podrijetla. Preloader nije usluga: on je sve što nije u tablici. */
export type Service = 'admin' | 'api' | 'front' | 'mobile' | 'other';

export interface ServiceSpec {
  /** Repozitorij usluge, za poruke i dokumentaciju. */
  readonly repo: string;
  /** Varijabla okoline za rewrite Nexta: podrijetlo usluge bez putanje. Bez nje nema rewritea. */
  readonly rewriteEnv: string;
  /** Varijabla okoline lokalnog edgea: `http://host:port` bez putanje. */
  readonly edgeEnv: string;
  /** Zadani cilj lokalnog edgea. Usluga bez njega lokalno postoji samo uz `edgeEnv` (VS-2). */
  readonly edgeDefault?: string;
  /**
   * Rewrite gole putanje (`/app/web`) dodaje završnu kosu crtu (Vite base `/app/web/` fronta institucije,
   * kao dosadašnji `vercel.json`). Lokalni edge putanju uvijek prosljeđuje nepromijenjenu.
   */
  readonly bareSlash: boolean;
}

export const SERVICES = {
  admin: {
    repo: 'Aplication_front',
    rewriteEnv: 'APLICATION_FRONT_URL',
    edgeEnv: 'DUCTURA_EDGE_ADMIN',
    edgeDefault: 'http://localhost:3120',
    bareSlash: false,
  },
  api: {
    repo: 'Institution_server',
    rewriteEnv: 'INSTITUTION_SERVER_URL',
    edgeEnv: 'DUCTURA_EDGE_API',
    edgeDefault: 'http://localhost:4000',
    bareSlash: false,
  },
  front: {
    repo: 'Institution_front_web_chrome',
    rewriteEnv: 'INSTITUTION_FRONT_URL',
    edgeEnv: 'DUCTURA_EDGE_FRONT',
    edgeDefault: 'http://localhost:5173',
    bareSlash: true,
  },
  mobile: {
    repo: 'Institution_web_mobile',
    rewriteEnv: 'INSTITUTION_WEB_MOBILE_URL',
    edgeEnv: 'DUCTURA_EDGE_MOBILE',
    bareSlash: false,
  },
  other: {
    repo: 'Web_other',
    rewriteEnv: 'WEB_OTHER_URL',
    edgeEnv: 'DUCTURA_EDGE_OTHER',
    bareSlash: false,
  },
} as const satisfies Record<Service, ServiceSpec>;

export interface Route {
  /** `/x` vodi `/x` i `/x/...` usluzi; `/xy`, `/X` i `/%78` nisu ta putanja. */
  readonly prefix: string;
  readonly service: Service;
}

/** Putanje usluga, redom kojim se uspoređuju. Prefiksi se ne preklapaju. */
export const ROUTES: readonly Route[] = Object.freeze([
  { prefix: '/admin', service: 'admin' },
  { prefix: '/api/v1', service: 'api' },
  { prefix: '/app/web', service: 'front' },
  { prefix: '/app/chrome', service: 'front' },
  { prefix: '/app/mobile', service: 'mobile' },
  { prefix: '/o', service: 'other' },
]);

/**
 * Usluga za putanju točno kako ju je poslao preglednik (bez upita), ili null kad putanja pripada preloaderu.
 * Usporedba je doslovna, bez dekodiranja i bez promjene velikih slova (P-0.10, src/sign-in/README.md).
 */
export function serviceFor(rawPath: string): Service | null {
  for (const { prefix, service } of ROUTES) {
    if (rawPath === prefix || rawPath.startsWith(`${prefix}/`)) return service;
  }
  return null;
}

/**
 * Ulazne putanje koje rub poslužuje s druge putanje, a adresa u pregledniku ostaje ista (DAN-1574, Daniel
 * 26. 11. 2026.): `/` je naslovnica fronta institucije, a preloader se seli na `/prijava`. Vrijedi lokalno
 * (`dev-proxy.mjs`) i na ductura.org (rewriteovi Nexta, `src/rewrites.ts`). Putanja se uspoređuje doslovno i
 * cijela, bez prefiksa: `/prijava/x` nije preloader. Upit ide uz odredište nepromijenjen.
 */
export interface EntryRewrite {
  /** Putanje točno kako ih šalje preglednik; Next završnu kosu crtu ne razlikuje, pa je navedena i ona. */
  readonly paths: readonly string[];
  /** Usluga iz tablice, ili null za sam preloader. */
  readonly service: Service | null;
  /**
   * Putanja kod usluge, ili stranica preloadera. Prepisivanje na preloader radi njegov Next (`beforeFiles`);
   * lokalni edge mu putanju šalje nepromijenjenu, da je preloader izgrađen s varijablom fronta ne pošalje dalje.
   */
  readonly destination: string;
}

/**
 * Redom kojim ih Next primjenjuje (beforeFiles): `/` prije `/prijava`, da preloaderov `/` nakon rewritea
 * `/prijava` ne ode ponovno na naslovnicu.
 */
export const ENTRY_REWRITES: readonly EntryRewrite[] = Object.freeze([
  Object.freeze<EntryRewrite>({ paths: Object.freeze(['/']), service: 'front', destination: '/app/web/naslovnica' }),
  Object.freeze<EntryRewrite>({ paths: Object.freeze(['/prijava', '/prijava/']), service: null, destination: '/' }),
]);

/** Javna adresa prvog ekrana preloadera (izbor sučelja i dva ulaza za prijavu). */
export const FIRST_SCREEN_PATH = '/prijava';

/** Ulazna putanja za putanju točno kako ju je poslao preglednik (bez upita), ili null. */
export function entryFor(rawPath: string): EntryRewrite | null {
  return ENTRY_REWRITES.find((entry) => entry.paths.includes(rawPath)) ?? null;
}

/** Putanje jedne usluge iz tablice. */
export function pathsOf(service: Service): string[] {
  return ROUTES.filter((route) => route.service === service).map((route) => route.prefix);
}

/**
 * Jedino pravilo koje ima samo lokalni edge (VS-2, deploy/edge/README.md): odabir „ostala sučelja” s
 * prvog ekrana preloadera (`FIRST_SCREEN_PATH`) otvara `/app/web/`, a lokalni edge ga s `307` šalje na
 * Web_other pod `/o/`. Vrijedi samo za GET i HEAD s `Referer` prvog ekrana istog podrijetla i samo kad je
 * Web_other lokalno pokrenut. Naslovnica na `/` nije prvi ekran: njezine poveznice na `/app/web/` ostaju na
 * frontu institucije.
 * Rewriteovi Nexta to pravilo nemaju: `/app/web` na Vercelu uvijek ide na front institucije.
 */
export const EDGE_ONLY_REDIRECT: {
  /** Putanje koje se preusmjeravaju (upit ide uz `location`). */
  readonly paths: readonly string[];
  readonly status: 307;
  readonly location: string;
  /** Usluga koja mora biti lokalno pokrenuta; bez nje `/app/web` ide na front institucije. */
  readonly requires: Service;
} = Object.freeze({
  paths: Object.freeze(['/app/web', '/app/web/']),
  status: 307,
  location: '/o/',
  requires: 'other',
});
