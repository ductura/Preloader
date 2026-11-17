// DAN-993: errorViewFor daje ključ teksta za svaki unos kataloga grešaka iz @ductura/contracts.
import catalog from '@ductura/contracts/errors/catalog.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { ERROR_VIEW_INPUTS, errorViewFor } from '../src/errors/index.ts';
import { errorText } from '../src/text.ts';

const hasText = (key: string) => {
  expect(Object.hasOwn(errorText, key), key).toBe(true);
  const entry = errorText[key as keyof typeof errorText];
  expect(entry.title.trim()).not.toBe('');
  expect(entry.body.trim()).not.toBe('');
};

describe('errorViewFor: nepoznat ulaz daje opći prikaz', () => {
  const numbers = [0, -0, 200, 302, 402, 418, 501, 599, -401, 401.5, 4010, Number.NaN, Number.POSITIVE_INFINITY];
  const strings = [
    '', '401', '404', ' offline', 'offline ', 'offline\r\n', 'offline\t', 'offline ', 'offline\u007f', 'OFFLINE',
    'Session_expired', 'unauthenticated', 'not_found', 'general',
    'toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf',
  ];

  it.each(numbers)('%s', (status) => expect(errorViewFor(status)).toBe('general'));
  it.each(strings)('%j', (status) => expect(errorViewFor(status)).toBe('general'));

  it('opći ključ ima tekst', () => hasText('general'));
});

describe('errorViewFor: katalog iz @ductura/contracts', () => {
  it('katalog je očekivanog oblika', () => {
    expect(catalog.format).toBe('ductura-error-catalog-v1');
    expect(catalog.errors.length).toBeGreaterThan(0);
  });

  it.each(catalog.errors)('$status $code → zadnji dio $messageKey', ({ status, code, messageKey }) => {
    const input = code === 'session_expired' ? code : status;
    const key = errorViewFor(input);
    expect(key).toBe(messageKey.split('.').at(-1));
    hasText(key);
  });

  it('401 bez koda je neprijavljen korisnik, ne istek sesije', () => {
    expect(errorViewFor(401)).toBe('unauthenticated');
    expect(errorViewFor('session_expired')).toBe('sessionExpired');
  });

  it('offline je stanje klijenta s vlastitim tekstom', () => {
    expect(errorViewFor('offline')).toBe('offline');
    hasText('offline');
  });

  it('tablica pokriva točno katalog i offline', () => {
    const expected = new Set<number | string>(['offline']);
    for (const { status, code } of catalog.errors) expected.add(code === 'session_expired' ? code : status);
    expect(new Set(ERROR_VIEW_INPUTS)).toEqual(expected);
    for (const input of ERROR_VIEW_INPUTS) expect(errorViewFor(input)).not.toBe('general');
  });
});
