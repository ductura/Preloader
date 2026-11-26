// Jedno podrijetlo (ductura.org): Next.js prosljeđuje putanje ostalih usluga po ugovoru Ductus #2028 §1.
// Putanje i varijable su u tablici ruta (`deploy/edge/routes.ts`), iz koje čita i lokalni edge
// (`deploy/edge/dev-proxy.mjs`). Adrese su u varijablama okoline, ne u repou.
import { ENTRY_REWRITES, pathsOf, ROUTES, SERVICES as SERVICE_SPECS, type Service } from '../deploy/edge/routes.ts';

export interface Rewrite {
  source: string;
  destination: string;
}

/** Varijabla okoline i putanje koje idu na tu uslugu, iz tablice ruta, redom tablice. */
export const SERVICES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(SERVICE_SPECS) as Service[]).map((service) => [
      SERVICE_SPECS[service].rewriteEnv,
      Object.freeze(pathsOf(service)),
    ]),
  ),
);

/** Samo čitanje; `process.env` odgovara ovom tipu. */
export type ServiceEnv = Readonly<Record<string, string | undefined>>;

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Autoritet i ostatak iza njega u vrijednosti kako je napisana, ili null ako vrijednost nije `shema://…`.
 * Autoritet završava na `/`, `\`, `?` ili `#` (WHATWG URL za `http:` i `https:`).
 */
function splitAuthority(value: string): { authority: string; rest: string } | null {
  const match = /^[a-z][a-z\d+.-]*:\/\/([^/\\?#]*)([^]*)$/i.exec(value);
  return match ? { authority: match[1] ?? '', rest: match[2] ?? '' } : null;
}

/**
 * Podrijetlo usluge bez završne kose crte. `https:`, a `http:` samo lokalno; bez putanje, upita,
 * fragmenta i korisničkih podataka, da se putanja prosljeđuje nepromijenjena. Inače baca.
 * Vrijednost se provjerava kako je napisana, prije nego što je `new URL()` normalizira
 * (`/gateway/..` bi postao `/`, a prazan korisnik u `https://@host` nestao); razmaci i kontrolni
 * znakovi, koje URL parser tiho briše, se odbijaju.
 */
export function serviceOrigin(name: string, value: string): string {
  if (/[\u0000-\u0020\u007f]/.test(value)) throw new Error(`${name} must not contain spaces or control characters`);
  const parts = splitAuthority(value);
  if (parts === null) throw new Error(`${name} must be an absolute URL with //host`);
  if (parts.authority.includes('@')) throw new Error(`${name} must not contain credentials`);
  if (parts.rest !== '' && parts.rest !== '/') throw new Error(`${name} must be an origin without a path, query or fragment`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
  if (!secure) throw new Error(`${name} must use https (http only for localhost)`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  if (url.pathname !== '/' || url.search || url.hash || /[?#]/.test(value)) {
    throw new Error(`${name} must be an origin without a path, query or fragment`);
  }
  return url.origin;
}

/**
 * Rewriteovi za `next.config.ts`, redom tablice ruta. Usluga bez varijable nema rewrite, pa njezine
 * putanje daju 404, a početna stranica radi. `/x` i `/x/...` idu na istu putanju kod usluge; `/x`
 * dobiva završnu kosu crtu samo gdje tablica to traži (`bareSlash`: Vite base `/app/web/` fronta
 * institucije, kao u dosadašnjem `vercel.json`). Svaka zadana varijabla provjerava se prije prvog
 * rewritea, pa neispravno podrijetlo ruši izgradnju.
 */
export function serviceRewrites(env: ServiceEnv): Rewrite[] {
  const origins = new Map<Service, string>();
  for (const service of Object.keys(SERVICE_SPECS) as Service[]) {
    const name = SERVICE_SPECS[service].rewriteEnv;
    const value = env[name];
    if (value === undefined || value === '') continue;
    origins.set(service, serviceOrigin(name, value));
  }
  const rewrites: Rewrite[] = [{ source: '/greska.html', destination: '/greska' }];
  for (const { prefix, service } of ROUTES) {
    const origin = origins.get(service);
    if (origin === undefined) continue;
    const slash = SERVICE_SPECS[service].bareSlash ? '/' : '';
    rewrites.push({ source: prefix, destination: `${origin}${prefix}${slash}` });
    rewrites.push({ source: `${prefix}/:path*`, destination: `${origin}${prefix}/:path*` });
  }
  return rewrites;
}

/**
 * Ulazni rewriteovi (DAN-1574) za `beforeFiles` u `next.config.ts`, redom `ENTRY_REWRITES`: `/` ide na
 * naslovnicu fronta institucije (`/app/web/naslovnica`), a `/prijava` na prvi ekran preloadera (`/`).
 * Moraju biti u `beforeFiles` jer preloader ima vlastitu stranicu `/`. Bez varijable fronta nema rewritea
 * `/`, pa preloader ostaje i na `/` (kao bez ostalih usluga). Next završnu kosu crtu ne razlikuje, pa se
 * izvor navodi bez nje. Neispravno podrijetlo ruši izgradnju kao u `serviceRewrites`.
 */
export function entryRewrites(env: ServiceEnv): Rewrite[] {
  const rewrites: Rewrite[] = [];
  for (const entry of ENTRY_REWRITES) {
    let destination = entry.destination;
    if (entry.service !== null) {
      const name = SERVICE_SPECS[entry.service].rewriteEnv;
      const value = env[name];
      if (value === undefined || value === '') continue;
      destination = `${serviceOrigin(name, value)}${entry.destination}`;
    }
    const sources = new Set(entry.paths.map((path) => (path.length > 1 ? path.replace(/\/+$/, '') : path)));
    for (const source of sources) rewrites.push({ source, destination });
  }
  return rewrites;
}
