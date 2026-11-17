// DAN-969 (969-1): tekst „kako radi” za /info/ ne spominje ustanovu ni zabranjeni izraz (PLAN §1 (3e), D-302).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { build } from '../scripts/build.ts';
import { assertPublicText, FORBIDDEN_TERMS, INSTITUTION_TERMS, publicTextProblems, textsOf } from '../src/info/index.ts';
import { infoText } from '../src/text.ts';

const strings = textsOf;

test.each([...INSTITUTION_TERMS, ...FORBIDDEN_TERMS])('„%s” u tekstu ruši provjeru', (term) => {
  expect(() => assertPublicText([`Ovdje piše ${term.replace('\\p{L}*', 'a')}ski primjer.`])).toThrow(/\/info\//);
});

test.each([
  'FAKULTET', 'Fpzg', 'na Sveučilištu', 'visoka\u00a0škola', 'visoka\tškola', 'visoka\r\nškola',
  'fakul\u00adtet', 'fakul\u007ftet', 'fakul\u200btet', 'autentic\u030cno', '\uff46\uff41\uff4b\uff55\uff4c\uff54\uff45\uff54',
])('varijanta „%s” ne zaobilazi provjeru', (text) => {
  expect(publicTextProblems([text])).not.toEqual([]);
});

test('slovo izvan latinice (homoglif) ruši provjeru', () => {
  expect(publicTextProblems(['f\u0430kultet'])).not.toEqual([]); // ćirilično a
  expect(publicTextProblems(['Ductur\u03b1'])).not.toEqual([]); // grčka alfa
});

test.each(['Spremljeno.', 'Tekst je spremljeno je.', 'spremljen u oblaku'])('„%s” bez mjesta ruši provjeru', (text) => {
  expect(publicTextProblems([text])).not.toEqual([]);
});

test('izgradnja pada kad tekst za /info/ spominje ustanovu', async () => {
  const out = mkdtempSync(join(tmpdir(), 'dist-'));
  try {
    await expect(build(out, { ...infoText, lead: 'Ductura za svaki fakultet.' })).rejects.toThrow(/fakultet/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('stvarni tekst prolazi, kao i dopušteni nizovi iz tablice', () => {
  expect(publicTextProblems(strings(infoText))).toEqual([]);
  const allowed = ['ni ljudski ni strojno', 'Ne dokazuje tko je tekst napisao.', 'Izvor svake promjene', 'prijedlog AI pomoćnika'];
  expect(publicTextProblems(allowed)).toEqual([]);
  expect(publicTextProblems(['Spremljeno na uređaju: da.', 'Spremljeno na poslužitelju: da.'])).toEqual([]);
});

test('tekst je izvor iz Ductusa bez odjeljka „Pravila fakulteta”', () => {
  expect(Object.keys(infoText)).toEqual(['title', 'lead', 'recorded', 'notRecorded', 'seen', 'saving', 'check']);
  expect(strings(infoText)).toHaveLength(31);
  expect(infoText.title).toBe('Kako Ductura radi');
  expect(infoText.saving.device.startsWith('Spremljeno na uređaju')).toBe(true);
});
