// Rewriteovi Next.js iz varijabli okoline (ugovor Ductus #2028 §1), umjesto adresa u `vercel.json`.
// Isti cilj kao lokalni edge za svaku putanju provjerava test/route-table.test.ts.
import { describe, expect, test } from 'vitest';
import { ROUTES, SERVICES as SERVICE_SPECS } from '../deploy/edge/routes.ts';
import { entryRewrites, SERVICES, serviceOrigin, serviceRewrites } from '../src/rewrites.ts';

const ENV = {
  APLICATION_FRONT_URL: 'https://admin.example.test',
  INSTITUTION_SERVER_URL: 'https://api.example.test/',
  INSTITUTION_FRONT_URL: 'https://front.example.test',
  INSTITUTION_WEB_MOBILE_URL: 'https://mobile.example.test',
  WEB_OTHER_URL: 'https://other.example.test/',
};

describe('serviceRewrites', () => {
  test('svih pet usluga, putanja ide nepromijenjena (kao dosadašnji vercel.json)', () => {
    expect(serviceRewrites(ENV)).toEqual([
      { source: '/greska.html', destination: '/greska' },
      { source: '/admin', destination: 'https://admin.example.test/admin' },
      { source: '/admin/:path*', destination: 'https://admin.example.test/admin/:path*' },
      { source: '/api/v1', destination: 'https://api.example.test/api/v1' },
      { source: '/api/v1/:path*', destination: 'https://api.example.test/api/v1/:path*' },
      { source: '/app/web', destination: 'https://front.example.test/app/web/' },
      { source: '/app/web/:path*', destination: 'https://front.example.test/app/web/:path*' },
      { source: '/app/chrome', destination: 'https://front.example.test/app/chrome/' },
      { source: '/app/chrome/:path*', destination: 'https://front.example.test/app/chrome/:path*' },
      // Next frontovi s basePathom: gola putanja bez dodane kose crte, kao lokalni edge.
      { source: '/app/mobile', destination: 'https://mobile.example.test/app/mobile' },
      { source: '/app/mobile/:path*', destination: 'https://mobile.example.test/app/mobile/:path*' },
      { source: '/o', destination: 'https://other.example.test/o' },
      { source: '/o/:path*', destination: 'https://other.example.test/o/:path*' },
    ]);
  });

  test('SERVICES je izveden iz tablice ruta: svaka putanja tablice ima točno jednu varijablu', () => {
    expect(SERVICES).toEqual({
      APLICATION_FRONT_URL: ['/admin'],
      INSTITUTION_SERVER_URL: ['/api/v1'],
      INSTITUTION_FRONT_URL: ['/app/web', '/app/chrome'],
      INSTITUTION_WEB_MOBILE_URL: ['/app/mobile'],
      WEB_OTHER_URL: ['/o'],
    });
    expect(Object.values(SERVICES).flat().sort()).toEqual(ROUTES.map((r) => r.prefix).sort());
    expect(Object.keys(SERVICES)).toEqual(Object.values(SERVICE_SPECS).map((spec) => spec.rewriteEnv));
  });

  test.each([
    ['INSTITUTION_WEB_MOBILE_URL', ['/app/mobile', '/app/mobile/:path*']],
    ['WEB_OTHER_URL', ['/o', '/o/:path*']],
  ] as const)('%s sam daje samo svoje putanje', (name, sources) => {
    expect(serviceRewrites({ [name]: ENV[name] }).map((r) => r.source)).toEqual(['/greska.html', ...sources]);
  });

  test('bez varijabli samo stranica greške: putanje usluga daju 404, početna radi', () => {
    expect(serviceRewrites({})).toEqual([{ source: '/greska.html', destination: '/greska' }]);
    expect(serviceRewrites({ INSTITUTION_SERVER_URL: '' })).toHaveLength(1);
  });

  test('usluga bez varijable nema rewrite, ostale ga imaju', () => {
    const sources = serviceRewrites({ INSTITUTION_SERVER_URL: ENV.INSTITUTION_SERVER_URL }).map((r) => r.source);
    expect(sources).toEqual(['/greska.html', '/api/v1', '/api/v1/:path*']);
  });

  test('neispravna varijabla ruši izgradnju i kad bi njezina usluga bila zadnja u tablici', () => {
    expect(() => serviceRewrites({ ...ENV, WEB_OTHER_URL: 'https://other.example.test/o' })).toThrow(/WEB_OTHER_URL/);
  });
});

describe('entryRewrites (DAN-1574)', () => {
  test('/ na naslovnicu fronta institucije, zatim /prijava na prvi ekran preloadera', () => {
    expect(entryRewrites(ENV)).toEqual([
      { source: '/', destination: 'https://front.example.test/app/web/naslovnica' },
      { source: '/prijava', destination: '/' },
    ]);
  });

  test('bez fronta institucije preloader ostaje i na /, a /prijava ga i dalje otvara', () => {
    expect(entryRewrites({})).toEqual([{ source: '/prijava', destination: '/' }]);
    expect(entryRewrites({ ...ENV, INSTITUTION_FRONT_URL: '' })).toEqual([{ source: '/prijava', destination: '/' }]);
  });

  test('neispravno podrijetlo fronta ruši izgradnju', () => {
    expect(() => entryRewrites({ INSTITUTION_FRONT_URL: 'https://front.example.test/app' })).toThrow(/INSTITUTION_FRONT_URL/);
    expect(() => entryRewrites({ INSTITUTION_FRONT_URL: 'http://front.example.test' })).toThrow(/INSTITUTION_FRONT_URL/);
  });
});

describe('serviceOrigin odbija adresu koja bi promijenila putanju ili otišla nešifrirano', () => {
  test.each([
    'http://api.example.test',
    'https://api.example.test/api',
    'https://api.example.test/?x=1',
    'https://api.example.test/#x',
    'https://api.example.test?',
    'https://u:p@api.example.test',
    'ftp://api.example.test',
    'api.example.test',
    'nije url',
    // Putanja koju `new URL()` normalizira u `/`, pa bi bez provjere napisane vrijednosti prošla.
    'https://api.example.test/gateway/..',
    'https://api.example.test/..',
    'https://api.example.test/.',
    'https://api.example.test/%2e%2e',
    'https://api.example.test/./',
    'https://api.example.test//',
    'https://api.example.test/x',
    'https://api.example.test\\',
    'https://api.example.test\\..',
    // Upit i fragment, i prazni.
    'https://api.example.test?q',
    'https://api.example.test/?q',
    'https://api.example.test#f',
    'https://api.example.test/#',
    'https://api.example.test#',
    // Korisnik u URL-u, i prazan (`new URL()` ga briše).
    'https://u@api.example.test',
    'https://u:@api.example.test',
    'https://:p@api.example.test',
    'https://@api.example.test',
    'https://u@api.example.test/..',
    // Oblik bez `//host` i znakovi koje URL parser tiho briše.
    'https:api.example.test',
    'https:/api.example.test',
    'https:///api.example.test',
    ' https://api.example.test',
    'https://api.example.test ',
    'https://api.exa\tmple.test',
    'https://api.example.test/\n',
    'http://localhost:4000/..',
  ])('%s', (value) => {
    expect(() => serviceOrigin('INSTITUTION_SERVER_URL', value)).toThrow(/INSTITUTION_SERVER_URL/);
    // Ista pravila za svaku varijablu iz tablice, i za nove (Institution_web_mobile, Web_other).
    for (const { rewriteEnv } of Object.values(SERVICE_SPECS)) {
      expect(() => serviceRewrites({ [rewriteEnv]: value })).toThrow(new RegExp(rewriteEnv));
    }
  });

  test.each([
    ['https://api.example.test', 'https://api.example.test'],
    ['https://api.example.test:8443/', 'https://api.example.test:8443'],
    ['http://localhost:4000', 'http://localhost:4000'],
    ['http://127.0.0.1:4000/', 'http://127.0.0.1:4000'],
    ['http://[::1]:4000', 'http://[::1]:4000'],
    ['HTTPS://API.Example.Test', 'https://api.example.test'],
  ])('prihvaća %s', (value, origin) => {
    expect(serviceOrigin('X', value)).toBe(origin);
  });
});
