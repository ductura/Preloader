// Jedno podrijetlo (ductura.org): Next.js prosljeđuje putanje ostalih usluga po ugovoru Ductus #2028 §1,
// isto kao lokalni edge (`deploy/edge/dev-proxy.mjs`). Adrese su u varijablama okoline, ne u repou.

export interface Rewrite {
  source: string;
  destination: string;
}

/** Varijabla okoline i putanje koje idu na tu uslugu. */
export const SERVICES = {
  APLICATION_FRONT_URL: ['/admin'],
  INSTITUTION_SERVER_URL: ['/api/v1'],
  INSTITUTION_FRONT_URL: ['/app/web', '/app/chrome'],
} as const satisfies Record<string, readonly string[]>;

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
 * Rewriteovi za `next.config.ts`. Usluga bez varijable nema rewrite, pa njezine putanje daju 404,
 * a početna stranica radi. `/x` i `/x/...` idu na istu putanju kod usluge; `/x` dobiva završnu
 * kosu crtu samo za front institucije (Vite base `/app/web/`), kao u dosadašnjem `vercel.json`.
 */
export function serviceRewrites(env: ServiceEnv): Rewrite[] {
  const rewrites: Rewrite[] = [{ source: '/greska.html', destination: '/greska' }];
  for (const [name, paths] of Object.entries(SERVICES) as [keyof typeof SERVICES, readonly string[]][]) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    const origin = serviceOrigin(name, value);
    const slash = name === 'INSTITUTION_FRONT_URL' ? '/' : '';
    for (const path of paths) {
      rewrites.push({ source: path, destination: `${origin}${path}${slash}` });
      rewrites.push({ source: `${path}/:path*`, destination: `${origin}${path}/:path*` });
    }
  }
  return rewrites;
}
