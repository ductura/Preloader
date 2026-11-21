// Jedna tablica ruta jedinog podrijetla (P-0.10, ugovor Ductus #2028 §1). Iz nje čitaju oba ulaza:
// rewriteovi Nexta na Vercelu (`src/rewrites.ts`) i lokalni edge (`dev-proxy.mjs`). Nova usluga ili
// putanja dodaje se samo ovdje. Putanja koja nije u tablici ide preloaderu: `/` i njegove stranice,
// a sve ostalo je 404. Kod je čisti TypeScript bez `node:` uvoza (Node ga izvršava bez prevođenja).

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

/** Putanje jedne usluge iz tablice. */
export function pathsOf(service: Service): string[] {
  return ROUTES.filter((route) => route.service === service).map((route) => route.prefix);
}

/**
 * Jedino pravilo koje ima samo lokalni edge (VS-2, deploy/edge/README.md): odabir „ostala sučelja” s
 * početne stranice otvara `/app/web/`, a lokalni edge ga s `307` šalje na Web_other pod `/o/`. Vrijedi samo
 * za GET i HEAD s `Referer` početne stranice istog podrijetla i samo kad je Web_other lokalno pokrenut.
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
