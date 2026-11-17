// @vitest-environment happy-dom
// DAN-935-2: stranica greške prikazuje tekst iz `errorText` za svaki unos kataloga; nepoznato daje opću stranicu.
import catalog from '@ductura/contracts/errors/catalog.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { errorInputFrom, showError } from '../src/errors/index.ts';
import { renderErrorPage } from '../src/page.ts';
import { errorText } from '../src/text.ts';

type Key = keyof typeof errorText;

/** Upit prolazi parser URL-a kao u pregledniku; skripta vidi samo `location.search`. */
const searchOf = (q: string) => new URL(`https://ductura.test/greska.html${q}`).search;
const query = (status: string) => `?status=${encodeURIComponent(status)}`;

function visit(q: string) {
  const doc = new DOMParser().parseFromString(renderErrorPage({ script: '', css: '' }), 'text/html');
  const key = showError(doc, searchOf(q));
  return { doc, key };
}

function expectShown(search: string, key: Key) {
  const { doc, key: shown } = visit(search);
  expect(shown, search).toBe(key);
  expect(doc.querySelector('h1')?.textContent, search).toBe(errorText[key].title);
  expect(doc.getElementById('error-body')?.textContent, search).toBe(errorText[key].body);
  expect(doc.title, search).toBe(`${errorText[key].title} · Ductura`);
}

describe('stranica greške: nepoznat ulaz daje opću stranicu', () => {
  const raw = [
    '', '?status', '?status=', '?other=404', '?Status=404', '?status=999&status=404', '?status=404;x',
    '?status=%', '?status=%E0%A4%A', '?status=%34%30%34%00', '?status=session_expired%00', '?status=%2B404',
  ];
  const values = [
    '0404', '4040', '40', '+404', '4e2', '0x194', '404.0', '٤٠٤', '４０４',
    '404 ', ' 404', '404\r\n', '404\n', '404\t', '404 ', '404\u007f', '404 ', '404 ',
    'OFFLINE', 'offline ', 'session_expired ', 'Session_expired', 'general', 'notFound',
    'toString', '__proto__', 'constructor', 'hasOwnProperty', '000', '040', '200', '418', '501',
  ];

  it.each(raw)('%j', (search) => expectShown(search, 'general'));
  it.each(values)('status=%j', (status) => expectShown(query(status), 'general'));

});

describe('stranica greške: svaki unos kataloga', () => {
  it.each(catalog.errors)('$status $code', ({ status, code, messageKey }) => {
    const input = code === 'session_expired' ? code : String(status);
    expectShown(query(input), messageKey.split('.').at(-1) as Key);
  });

  it('401 bez koda je prijava, kod session_expired je istek', () => {
    expectShown('?status=401', 'unauthenticated');
    expectShown('?status=session_expired', 'sessionExpired');
  });

  it('offline ima vlastiti tekst', () => expectShown('?status=offline', 'offline'));

  it('kodirane znamenke i prvi od dva parametra su namjerno ulaz', () => {
    expectShown('?status=%34%30%34', 'notFound');
    expectShown('?status=404&status=999', 'notFound');
  });

  it('nekodirani tab, CR, LF i rubni razmaci ne dolaze do stranice (parser URL-a ih uklanja)', () => {
    expect(searchOf('?status=4\t0\r\n4 ')).toBe('?status=404');
    expect(searchOf('?status=404%0A')).toBe('?status=404%0A');
    expectShown('?status=404%0A', 'general');
  });

  it('errorInputFrom: broj samo za točno tri ASCII znamenke', () => {
    expect(errorInputFrom('?status=503')).toBe(503);
    expect(errorInputFrom('?status=503%0A')).toBe('503\n');
    expect(errorInputFrom('')).toBe('');
  });
});
