// DAN-969 (969-1): tekst „kako radi” za /info/ ne spominje ustanovu ni zabranjeni izraz (PLAN §1 (3e), D-302).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { build } from '../scripts/build.ts';
import { assertPublicText, FORBIDDEN_TERMS, INSTITUTION_TERMS, publicTextProblems, textsOf } from '../src/info/index.ts';
import { infoText } from '../src/text.ts';

/** Primjer riječi za korijen: `\p{L}{0,4}` postaje „a”, a alternative uzimaju prvu granu. */
const sample = (term: string): string =>
  term.replaceAll('\\p{L}{0,4}', 'a').replaceAll('\\d', '4').replaceAll('\\s?', ' ').replace(/\(([^|)]*)[^)]*\)/g, '$1');

test.each([...INSTITUTION_TERMS, ...FORBIDDEN_TERMS])('„%s” u tekstu ruši provjeru', (term) => {
  expect(() => assertPublicText([`Ovdje piše ${sample(term)}ski primjer.`])).toThrow(/\/info\//);
});

test.each([
  'FAKULTET', 'Fpzg', 'na Sveučilištu', 'sveuciliste', 'visoka\u00a0škola', 'visoka\tškola', 'visoka\r\nškola',
  'visoka\rškola', 'visoka\nškola', 'visoka\u0085škola', 'visoka\u2028škola', 'visokoškolski', 'visoka–škola',
  'fakul\u00adtet', 'fakul\u007ftet', 'fakul\u200btet', 'fakul\u034ftet', 'fakul\ufe0ftet', 'fakul\u0300tet',
  'fakul\ttet', 'fakul\ftet', 'fakul-tet', 'F.P.Z.G.', 'sveuc\u200b\u030cilište', 'autentic\u030cno',
  '\uff46\uff41\uff4b\uff55\uff4c\uff54\uff45\uff54', '\u0130nstitut', '\u0131nstitut', 'UNIZG', 'University', 'Faculty',
  'tuđeg teksta', 'verificiranog autorstva', 'dokazi autorstva', 'AI napisao', 'upozorenja o studentima',
  'postotka ljudskosti', 'ljudskog udjela', 'napisala čovjek', 'tekst nije vlastiti', 'AI 40', '40 % AI',
])('varijanta „%s” ne zaobilazi provjeru', (text) => {
  expect(publicTextProblems([text])).not.toEqual([]);
});

// Neovisno o popisima: oblici i redovi riječi iz retka tablice PRODUCT §5 (svi oblici, oba reda, broj ili %).
test.each([
  'Sakriveno', 'Prikriveno', 'skrivati', 'Student je kopirao tekst.', 'kopirano', 'prepisivanje', 'prepisao',
  'sumnjivo', 'rizik', 'rizični', 'anomalija', 'upozorenje o studentu', 'vjerojatno', 'vjerojatnost', 'autentičnost',
  'autenticitet', 'AI je napisao', 'napisao AI', 'udio AI-ja', 'ljudski udio', 'postotak ljudskosti', 'AI postotak',
  '40 AI', 'AI 40', '40 % AI', 'AI: 40 %', '50 % ljudsko', 'ljudsko 50 %', '50 % podrijetlo', '30 % izvor',
  'izvor 30%', 'verificirano autorstvo', 'dokaz autorstva', 'autorstvo dokazano', 'tuđi tekst', 'tuđe riječi',
  'nije vlastiti', 'nije njegov', 'nije njezin', 'nestali podaci', 'podaci su nestali', 'nestao', 'nedostajući podaci',
  'izgubljeni podaci', 'plagijat', 'plagiranje', 'izvornost', 'originalnost', 'integritet', 'neobično',
  'neuobičajeno', 'nepravilnost', 'nepravilno', 'ljudski napisano', 'napisano ljudski', 'napisao čovjek',
  'čovjek je napisao',
])('oblik iz Rječnika „%s” ruši provjeru', (text) => {
  expect(publicTextProblems([text])).not.toEqual([]);
});

test.each(['f\u0430kultet', 'Ductur\u03b1', 'Ductura\ue000', 'Ductura\u0378', 'Ductura\ud800'])(
  'znak izvan latinice ili bez značenja („%s”) ruši provjeru',
  (text) => expect(publicTextProblems([text])).not.toEqual([]),
);

test.each(['Spremljeno.', 'Tekst je spremljeno je.', 'spremljen u oblaku'])('„%s” bez mjesta ruši provjeru', (text) => {
  expect(publicTextProblems([text])).not.toEqual([]);
});

const cycle: Record<string, unknown> = {};
cycle.self = cycle;
test.each([
  ['String objekt', new String('fakultet')], ['Map', new Map([['a', 'fakultet']])], ['Set', new Set(['fakultet'])],
  ['broj', { a: 1 }], ['null', { a: null }], ['simbolni ključ', { [Symbol('a')]: 'fakultet' }], ['ciklus', cycle],
  ['objekt s prototipom', Object.create({ a: 'fakultet' })],
  ['skriveni ključ', Object.defineProperty({}, 'a', { value: 'fakultet', enumerable: false })],
])('textsOf ne prihvaća %s', (_, value) => {
  expect(() => textsOf(value)).toThrow(/\/info\//);
});

test('naslijeđeni toString i __proto__ ne skrivaju ni ne dodaju tekst', () => {
  const block = JSON.parse('{"toString":"fakultet","__proto__":{"a":"sumnja"},"b":["Da"]}') as unknown;
  expect(textsOf(block).sort()).toEqual(['Da', 'fakultet', 'sumnja']);
  expect(textsOf({}), 'Object.prototype.toString se ne čita').toEqual([]);
});

test('izgradnja pada kad tekst spominje ustanovu i ništa ne briše', async () => {
  const out = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(out, 'cuvar.txt'), 'x');
  try {
    await expect(build(out, { ...infoText, lead: 'Ductura za svaki fakultet.' })).rejects.toThrow(/fakultet/);
    expect(existsSync(join(out, 'cuvar.txt'))).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('stvarni tekst prolazi, kao i dopušteni nizovi iz tablice', () => {
  expect(publicTextProblems(textsOf(infoText))).toEqual([]);
  const allowed = ['ni ljudski ni strojno', 'Ne dokazuje tko je tekst napisao.', 'Izvor svake promjene', 'prijedlog AI pomoćnika'];
  expect(publicTextProblems(allowed)).toEqual([]);
  expect(publicTextProblems(['Spremljeno na uređaju: da.', 'Spremljeno na poslužitelju: da.'])).toEqual([]);
});

test('tekst je izvor iz Ductusa bez odjeljka „Pravila fakulteta”', () => {
  expect(Object.keys(infoText)).toEqual(['title', 'lead', 'recorded', 'notRecorded', 'seen', 'saving', 'check']);
  expect(textsOf(infoText)).toHaveLength(31);
  expect(infoText.title).toBe('Kako Ductura radi');
  expect(infoText.saving.device.startsWith('Spremljeno na uređaju')).toBe(true);
});
