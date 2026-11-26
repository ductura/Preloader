// Jedna tablica ruta jedinog podrijetla (P-0.10, ugovor Ductus #2028 §1). Iz nje čitaju oba ulaza:
// rewriteovi Nexta na Vercelu (`src/rewrites.ts`) i lokalni edge (`dev-proxy.mjs`). Nova usluga ili
// putanja dodaje se samo ovdje. Karta adresa (D-318, DAN-1574): javne putanje (`/` naslovnica, `/ulaz`
// preloader, javne stranice, `/aplikacija`, `/administracija`) su u `ENTRY_REWRITES`, a stare adrese koje lokalni
// edge preusmjerava u `LEGACY_REDIRECTS`. Putanja koja nije ni u jednoj tablici ide preloaderu: njegove
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
 * Osnova usluge kod same usluge, dok ne prijeđe na javnu adresu iz karte adresa (D-318, DAN-1574). Front
 * institucije ima Next `basePath` `/app` i `assetPrefix` `/app/web`, a Aplication_front `/admin`; preglednik na
 * `/aplikacija/…` ili `/administracija/…` bi njihovom klijentu bio izvan osnove. Zato rub do prelaska javnu
 * adresu prepisuje na osnovu usluge, a stara adresa radi i dalje (zadaci 3 i 9 karte). Kad usluga prijeđe,
 * ovdje se upisuje javna adresa: prepisivanje postaje doslovno, a stara adresa počinje preusmjeravati.
 */
export interface Bases {
  /** Osnova fronta institucije (`/app/web`, nakon zadatka 3 `/aplikacija`). */
  readonly front: string;
  /** Osnova Aplication_fronta (`/admin`, nakon zadatka 9 `/administracija`). */
  readonly admin: string;
}

export const BASES: Bases = Object.freeze({ front: '/app/web', admin: '/admin' });

/** Javne adrese iz karte adresa (D-318). */
export const APP_PATH = '/aplikacija';
export const ADMINISTRATION_PATH = '/administracija';
/** Javna adresa preloadera (prepozna uređaj i pošalje na ekran prijave inačice). */
export const FIRST_SCREEN_PATH = '/ulaz';

/** Javne stranice na vrhu adrese; rub ih prikazuje iz fronta institucije, adresa ostaje kratka. */
export const PUBLIC_PAGES: readonly string[] = Object.freeze([
  '/preuzimanja',
  '/pomoc',
  '/kontakt',
  '/uvjeti-koristenja',
  '/privatnost',
  '/pristupacnost',
  '/stanje',
]);

/**
 * Putanja koju rub poslužuje s druge putanje, a adresa u pregledniku ostaje ista (karta adresa D-318).
 * Uspoređuje se doslovno, bez dekodiranja i bez promjene velikih slova. Putanja bez prefiksa vrijedi i sa
 * završnom kosom crtom (Next je ne razlikuje), osim `/`; s prefiksom vrijedi i `putanja/…`. Upit ide uz
 * odredište nepromijenjen.
 */
export interface EntryRewrite {
  /** Javna putanja. */
  readonly path: string;
  /** Vrijedi i za `path/…` (ostatak se dodaje na odredište). */
  readonly prefix: boolean;
  /** Usluga iz tablice, ili null za sam preloader. */
  readonly service: Service | null;
  /**
   * Putanja kod usluge, ili stranica preloadera. Prepisivanje na preloader radi njegov Next (`beforeFiles`);
   * lokalni edge mu putanju šalje nepromijenjenu, da je preloader izgrađen s varijablom fronta ne pošalje dalje.
   */
  readonly destination: string;
  /** Odgovor nosi `X-Robots-Tag: noindex` (ulaz, aplikacija i administracija ne idu u tražilice). */
  readonly noindex: boolean;
}

/**
 * Ulazi redom kojim ih Next primjenjuje (beforeFiles): `/` prije `/ulaz`, da preloaderov `/` nakon rewritea
 * `/ulaz` ne ode ponovno na naslovnicu.
 */
export function entriesFor(bases: Bases): readonly EntryRewrite[] {
  const entry = (path: string, prefix: boolean, service: Service | null, destination: string, noindex = false) =>
    Object.freeze<EntryRewrite>({ path, prefix, service, destination, noindex });
  return Object.freeze([
    entry('/', false, 'front', `${bases.front}/naslovnica`),
    entry(FIRST_SCREEN_PATH, false, null, '/', true),
    ...PUBLIC_PAGES.map((page) => entry(page, true, 'front', `${bases.front}${page}`)),
    entry(APP_PATH, true, 'front', bases.front, true),
    entry(ADMINISTRATION_PATH, true, 'admin', bases.admin, true),
  ]);
}

export const ENTRY_REWRITES: readonly EntryRewrite[] = entriesFor(BASES);

/** Ostatak putanje iza javne putanje (`''`, `/` ili `/…`), ili null kad se putanja ne poklapa. */
function restOf(rawPath: string, path: string, prefix: boolean): string | null {
  if (rawPath === path) return '';
  if (path === '/') return null;
  if (rawPath === `${path}/`) return '/';
  if (prefix && rawPath.startsWith(`${path}/`)) return rawPath.slice(path.length);
  return null;
}

/** Ulaz za putanju točno kako ju je poslao preglednik (bez upita), s putanjom kod usluge, ili null. */
export function entryFor(
  rawPath: string,
  entries: readonly EntryRewrite[] = ENTRY_REWRITES,
): { readonly entry: EntryRewrite; readonly path: string } | null {
  for (const entry of entries) {
    const rest = restOf(rawPath, entry.path, entry.prefix);
    if (rest === null) continue;
    return { entry, path: entry.prefix ? `${entry.destination}${rest}` : entry.destination };
  }
  return null;
}

/**
 * Stara adresa koju lokalni edge preusmjerava na novu (karta adresa D-318). Lokalno `307`, da preglednik
 * ništa trajno ne zapamti dok se karta uvodi; trajni `301` je tek na produkcijskom rubu (zadatak 10, DAN-939).
 * `/api/auth/…` ide sa `308`, jer odjava i prijava šalju POST, a `308` zadržava metodu i tijelo.
 */
export interface LegacyRedirect {
  readonly path: string;
  readonly prefix: boolean;
  readonly status: 307 | 308;
  /** Nova adresa; uz prefiks se dodaje ostatak putanje, a uvijek upit. */
  readonly location: string;
}

/**
 * Stare adrese za zadane osnove. `/app/web/…`, `/app/chrome/…` i `/admin/…` preusmjeravaju tek kad je usluga
 * prešla na novu osnovu: dotad je stara adresa jedina na kojoj klijent usluge radi (i povratak nakon prijave
 * AAI@EduHr je `/app/web/`), pa stare i nove adrese rade istodobno. Ostale stare adrese preusmjeravaju odmah,
 * na adresu na kojoj stranica danas radi.
 */
export function redirectsFor(bases: Bases): readonly LegacyRedirect[] {
  const redirect = (path: string, prefix: boolean, location: string, status: 307 | 308 = 307) =>
    Object.freeze<LegacyRedirect>({ path, prefix, status, location });
  const list = [
    redirect(`${APP_PATH}/naslovnica`, false, '/'),
    redirect('/prijava', false, `${bases.front}/prijava`),
    redirect('/download', true, '/preuzimanja'),
    redirect('/api/auth', true, '/api/v1/auth', 308),
  ];
  if (bases.front !== '/app/web') list.push(redirect('/app/web', true, bases.front), redirect('/app/chrome', true, bases.front));
  if (bases.admin !== '/admin') list.push(redirect('/admin', true, bases.admin));
  return Object.freeze(list);
}

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = redirectsFor(BASES);

/** Preusmjeravanje stare adrese (putanja bez upita, kako ju je poslao preglednik), ili null. */
export function redirectFor(
  rawPath: string,
  redirects: readonly LegacyRedirect[] = LEGACY_REDIRECTS,
): { readonly status: 307 | 308; readonly location: string } | null {
  for (const redirect of redirects) {
    const rest = restOf(rawPath, redirect.path, redirect.prefix);
    if (rest === null) continue;
    return { status: redirect.status, location: redirect.prefix ? `${redirect.location}${rest}` : redirect.location };
  }
  return null;
}

/** Putanje jedne usluge iz tablice. */
export function pathsOf(service: Service): string[] {
  return ROUTES.filter((route) => route.service === service).map((route) => route.prefix);
}

/**
 * Pravilo koje uz `LEGACY_REDIRECTS` ima samo lokalni edge (VS-2, deploy/edge/README.md): odabir „ostala sučelja” s
 * preloadera (`FIRST_SCREEN_PATH`, `/ulaz`) otvara `/app/web/`, a lokalni edge ga s `307` šalje na
 * Web_other pod `/o/`. Vrijedi samo za GET i HEAD s `Referer` preloadera istog podrijetla i samo kad je
 * Web_other lokalno pokrenut. Naslovnica na `/` nije preloader: njezine poveznice na `/app/web/` ostaju na
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
