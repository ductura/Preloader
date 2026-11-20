// Rewriteovi Next.js iz varijabli okoline (ugovor Ductus #2028 §1), umjesto adresa u `vercel.json`.
import { describe, expect, test } from 'vitest';
import { routeFor } from '../deploy/edge/dev-proxy.mjs';
import { SERVICES, serviceOrigin, serviceRewrites } from '../src/rewrites.ts';

const ENV = {
  APLICATION_FRONT_URL: 'https://admin.example.test',
  INSTITUTION_SERVER_URL: 'https://api.example.test/',
  INSTITUTION_FRONT_URL: 'https://front.example.test',
};

describe('serviceRewrites', () => {
  test('sve tri usluge, putanja ide nepromijenjena (kao dosadašnji vercel.json)', () => {
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
    ]);
  });

  test('bez varijabli samo stranica greške: putanje usluga daju 404, početna radi', () => {
    expect(serviceRewrites({})).toEqual([{ source: '/greska.html', destination: '/greska' }]);
    expect(serviceRewrites({ INSTITUTION_SERVER_URL: '' })).toHaveLength(1);
  });

  test('usluga bez varijable nema rewrite, ostale ga imaju', () => {
    const sources = serviceRewrites({ INSTITUTION_SERVER_URL: ENV.INSTITUTION_SERVER_URL }).map((r) => r.source);
    expect(sources).toEqual(['/greska.html', '/api/v1', '/api/v1/:path*']);
  });

  test('iste putanje kao lokalni edge: svaki izvor rewritea edge šalje istoj usluzi', () => {
    const upstream = { APLICATION_FRONT_URL: 'admin', INSTITUTION_SERVER_URL: 'api', INSTITUTION_FRONT_URL: 'front' } as const;
    for (const [name, paths] of Object.entries(SERVICES) as [keyof typeof SERVICES, readonly string[]][]) {
      for (const path of paths) {
        expect(routeFor(path)).toBe(upstream[name]);
        expect(routeFor(`${path}/x`)).toBe(upstream[name]);
      }
    }
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
    expect(() => serviceRewrites({ INSTITUTION_SERVER_URL: value })).toThrow(/INSTITUTION_SERVER_URL/);
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
