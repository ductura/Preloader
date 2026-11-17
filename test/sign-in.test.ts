// Ulaz u prijavu (DAN-994): preneseno iz Ductusa (sign-in-link.test.ts,
// return-to.test.ts, return-to.property.test.ts). Negativni slučajevi su prvi.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RETURN_TO, safeReturnTo, signInHref, signInTarget } from '../src/sign-in/index.ts';

const BASE = 'https://ductura.example';

// Prihvat DAN-994: vanjski host, `//`, `\` i `javascript:` daju zadani povratak.
const ACCEPTANCE = ['https://zlo.test/', '//zlo.test', '/\\zlo.test', '\\\\zlo.test', 'javascript:alert(1)'];

// Plan of attack #154, item 17.
const ATTACKS = [
  'https://zlo.test/',
  '//zlo.test',
  '/\\zlo.test',
  '\\\\zlo.test',
  '%2F%2Fzlo.test',
  'javascript:alert(1)',
  'zlo.test',
  '/\tzlo.test',
  '/\n/zlo.test',
  '/\u200e/zlo.test',
  '/\u0000',
  '/\ud800',
  '/api/auth/login',
  // QA of #191: the bare prefix too.
  '/api',
  '/api?x=1',
  '/api#x',
  // QA 6 of #191 (6102353984): the same routes spelled another way.
  '/API',
  '/Api/x',
  '/%61pi/x',
  '/%41PI',
  '/api%2Fauth%2Flogin',
  '/%2561pi',
  '/%252561pi/x',
  // Not decodable: fails closed rather than guessing.
  '/%E0%A4%A',
  '',
  `/${'a'.repeat(512)}`,
  // Dot segments that the URL parser removes after the input check (review
  // of #191).
  '/.//zlo.test',
  '/a/..//zlo.test',
  '/%2e//zlo.test',
  '/%2E%2E//zlo.test',
  '/.//zlo.test/x?y=1',
  '/./\\zlo.test',
  '/a/../\\zlo.test',
  // DAN-994: ista klasa ulaza u preloaderu.
  '/\r\n/zlo.test',
  '/\u007f',
  '/\u2028',
  'C:\\x',
  '/..\\x',
  '/api/v1/auth/login',
  '/\u2029',
  // Pet razina kodiranja: iznad MAX_DECODE_ROUNDS, pa se odbija (fails closed).
  '/%2525252561pi',
];

describe('povratna adresa izvan aplikacije daje zadani povratak (prihvat DAN-994)', () => {
  it.each(ACCEPTANCE)('%j daje /', (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
    expect(signInTarget(value)).toBe('/');
    expect(signInHref(signInTarget(value))).toBe('/api/v1/auth/login?returnTo=%2F');
  });
});

describe('safeReturnTo', () => {
  it.each(ATTACKS)('sends %j to the default page', (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
    expect(signInTarget(value)).toBe(DEFAULT_RETURN_TO);
  });

  it.each(ATTACKS)('keeps %j on the same origin', (value) => {
    expect(new URL(safeReturnTo(value), BASE).origin).toBe(BASE);
  });

  it.each([
    undefined,
    null,
    42,
    ['/rad'],
    { path: '/rad' },
    { toString: () => '/rad' },
    Object.create(null) as unknown,
    JSON.parse('{"__proto__":"/rad"}') as unknown,
  ])('sends %j to the default page', (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
  });

  it.each([
    ['/rad?x=1', '/rad?x=1'],
    ['/', '/'],
    ['/kolegij/DEMO-101#upute', '/kolegij/DEMO-101#upute'],
    ['/%2F%2Fzlo.test', '/%2F%2Fzlo.test'],
    ['/a/../b', '/b'],
    // Only /api itself and what is below it is refused.
    ['/apis', '/apis'],
    ['/rad/api', '/rad/api'],
    ['/%61pis', '/%61pis'],
    // Percent-encoding is kept as given (QA 7 of the first round on #191).
    ['/rad/%C5%A1kola?q=a%20b#x%20y', '/rad/%C5%A1kola?q=a%20b#x%20y'],
    // DAN-994: kodirana kosa crta i NBSP ostaju putanja istog porijekla.
    ['/%5c%5czlo.test', '/%5c%5czlo.test'],
    ['/\u00a0x', '/%C2%A0x'],
    // Granica duljine: 512 znakova se zadržava (513 je u ATTACKS).
    [`/${'a'.repeat(511)}`, `/${'a'.repeat(511)}`],
  ])('keeps the path %j of this application', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});

describe('signInTarget', () => {
  // DAN-325 u Ductusu; u preloaderu je "/" sama ulazna stranica.
  it('defaults to the home page', () => {
    for (const raw of [undefined, null, '', '/', ['/rad', '/upis']]) {
      expect(signInTarget(raw)).toBe('/');
    }
  });

  it('keeps a path of this application', () => {
    expect(signInTarget('/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(signInTarget('/upis?kod=AB12')).toBe('/upis?kod=AB12');
    expect(signInTarget('/rad')).toBe('/rad');
    expect(signInTarget('/nastavnik')).toBe('/nastavnik');
  });

  it('refuses another origin and the auth routes', () => {
    for (const raw of [
      'https://example.test/rad',
      '//example.test',
      '/\\example.test',
      'javascript:alert(1)',
      '/api/auth/login',
      '/%2561pi/auth/logout',
      'rad',
    ]) {
      expect(signInTarget(raw), String(raw)).toBe('/');
    }
  });
});

describe('signInHref', () => {
  it('points at the login route with an encoded returnTo', () => {
    expect(signInHref('/')).toBe('/api/v1/auth/login?returnTo=%2F');
    expect(signInHref('/rad')).toBe('/api/v1/auth/login?returnTo=%2Frad');
    expect(signInHref('/upis?kod=AB12')).toBe('/api/v1/auth/login?returnTo=%2Fupis%3Fkod%3DAB12');
  });
});

// Plan of attack #154, item 17: whatever path pieces an attacker combines,
// the result stays a path of this application.
const piece = fc.constantFrom(
  '/', '//', '\\', '.', '..', '%2e', '%2E', '%2e%2e', '%2f', '%5c', '?', '#', '@', ':', 'zlo.test', 'a', 'api',
);
const candidate = fc.array(piece, { maxLength: 12 }).map((parts) => parts.join(''));
const anyInput = fc.oneof(candidate, candidate.map((value) => `/${value}`), fc.string());
const RUNS = { seed: 994, numRuns: 500 };

describe('svojstva (fast-check)', () => {
  it('never leaves the origin and never starts with // or /\\', () => {
    fc.assert(
      fc.property(anyInput, (value) => {
        const result = safeReturnTo(value);
        expect(result.startsWith('/')).toBe(true);
        expect(result.startsWith('//')).toBe(false);
        expect(result.startsWith('/\\')).toBe(false);
        expect(new URL(result, BASE).origin).toBe(BASE);
      }),
      RUNS,
    );
  });

  // D-09: modul ne stvara drugi cilj prijave osim /api/v1/auth/login.
  it('poveznica uvijek vodi samo na /api/v1/auth/login s jednim returnTo', () => {
    fc.assert(
      fc.property(fc.oneof(anyInput, fc.anything()), (value) => {
        const target = signInTarget(value);
        const url = new URL(signInHref(target), BASE);
        expect(url.origin).toBe(BASE);
        expect(url.pathname).toBe('/api/v1/auth/login');
        expect([...url.searchParams.keys()]).toEqual(['returnTo']);
        expect(url.searchParams.get('returnTo')).toBe(target);
        expect(url.hash).toBe('');
        expect(target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')).toBe(true);
      }),
      RUNS,
    );
  });
});
