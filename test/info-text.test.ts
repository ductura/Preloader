// DAN-969-2a1: infoText je doslovan prijenos Ductus `messagesHr.howItWorks` (oblik, ne curenje u dist; to je 2a2).
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { infoText } from '../src/text.ts';

// SHA-256 od JSON.stringify(Ductus messagesHr.howItWorks bez `rules`, APP_NAME = „Ductura”),
// src/lib/i18n/messages.hr.ts na b36c82b93e60b1d2d74e38611209e4fcc1ae7dfc.
const DUCTUS_SHA256 = 'b1dcb8b906940df7bcf4b807720edc88595caef831d9ce82b538c9cc132a323a';

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const leaves = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as Record<string, unknown>).flatMap(leaves);
const keys = (v: object): unknown =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? null : keys(x as object)]));

const EXPECTED_KEYS = {
  title: null, lead: null,
  recorded: { heading: null, changes: null, changesConditional: null, sources: null, versions: null, access: null },
  notRecorded: { heading: null, keys: null, outside: null, rhythm: null, authorship: null },
  seen: { heading: null, columns: { view: null, you: null, mentor: null, others: null },
    rows: { live: null, replay: null, compare: null }, yes: null, no: null, othersNote: null },
  saving: { heading: null, device: null, server: null, offline: null, submitted: null },
  check: { heading: null, body: null },
};

const infoLeaves = leaves(infoText);
const clone = (): typeof infoText => structuredClone(infoText);

test('mutacije kopije mijenjaju sažetak (jedno slovo, ključevi, izbačen i dodan list, `rules`)', () => {
  const letter = clone() as { title: string };
  letter.title = letter.title.replace('Kako', 'Kaka');
  const swapped = clone();
  const swappedObj = { ...swapped, lead: swapped.title, title: swapped.lead };
  const dropped = clone() as Record<string, unknown>;
  delete (dropped.check as Record<string, unknown>).body;
  const added = clone() as unknown as { check: Record<string, string> };
  added.check.extra = 'x';
  const rules = { ...clone(), rules: { heading: 'Pravila fakulteta' } };
  const reordered = { ...Object.fromEntries(Object.entries(clone()).reverse()) };
  for (const m of [letter, swappedObj, dropped, added, rules, reordered]) expect(sha(m)).not.toBe(DUCTUS_SHA256);
  expect(sha(dropped)).not.toBe(sha(infoText));
  expect(JSON.stringify(keys(added))).not.toBe(JSON.stringify(EXPECTED_KEYS));
  expect(leaves(dropped)).toHaveLength(30);
  expect(leaves(added)).toHaveLength(32);
});

test('odjeljak „Pravila fakulteta” (`rules`) ne ulazi', () => {
  expect(Object.hasOwn(infoText, 'rules')).toBe(false);
});

test('ključevi i redoslijed kao u izvoru; 31 neprazan list bez rubnih razmaka', () => {
  expect(JSON.stringify(keys(infoText))).toBe(JSON.stringify(EXPECTED_KEYS));
  expect(infoLeaves).toHaveLength(31);
  for (const t of infoLeaves) expect(t.length > 0 && t.trim() === t, t).toBe(true);
});

test('listovi su NFC, bez NBSP, CR, taba, DEL i nul-širine znakova', () => {
  for (const t of infoLeaves) {
    expect(t, t).toBe(t.normalize('NFC'));
    expect(/[ \r\t\u007F​-‏⁠﻿]/u.test(t), t).toBe(false);
  }
});

test('sažetak cijelog teksta jednak je izvoru u Ductusu', () => {
  expect(sha(infoText)).toBe(DUCTUS_SHA256);
});

// Tvrdnje iz Ductus `src/components/how-it-works/copy.test.ts` (b36c82b9), neovisne o sažetku.
type Saving = { device: string; server: string };
const savingProblems = (s: Saving): string[] => [
  ...(s.device.startsWith('Spremljeno na uređaju') ? [] : ['device: naziv stanja']),
  ...(s.server.startsWith('Spremljeno na poslužitelju') ? [] : ['server: naziv stanja']),
  ...(/nije primio|nema tekst|nije stigao/.test(s.device) ? ['device: tvrdi da poslužitelj nema tekst'] : []),
  ...(/je li ga poslužitelj već primio/.test(s.device) ? [] : ['device: ne kaže da ne govori je li primljen']),
];

test('oznake spremanja: nazivi kao u uređivaču, oznaka na uređaju ne tvrdi da poslužitelj nema tekst', () => {
  expect(savingProblems(infoText.saving)).toEqual([]);
  const s = infoText.saving;
  expect(savingProblems({ ...s, device: 'Spremljeno na uređaju: poslužitelj ga još nije primio.' })).toHaveLength(2);
  expect(savingProblems({ ...s, device: s.device.replace('Spremljeno', 'Sačuvano') })).toHaveLength(1);
  expect(savingProblems({ ...s, server: s.server.replace('poslužitelju', 'serveru') })).toHaveLength(1);
});

test('tekst nema imena ustanove (provjeravaju se samo listovi, ne izvorni kod)', () => {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const ROOTS = ['fpzg', 'sveucilist', 'fakult', 'ustanov'];
  expect(ROOTS.filter((r) => fold(infoLeaves.join(' ')).includes(r))).toEqual([]);
  expect(ROOTS.filter((r) => fold(`${infoText.title} Pravila fakulteta`).includes(r))).toEqual(['fakult']);
});

// D-318 (vlasnik 26. 11. 2026., Ductus#2059 c.7203462120): 404 preloadera ima isti tekst kao 404 aplikacije.
test('errorText.notFound preuzima tekst 404 aplikacije', async () => {
  const { errorText } = await import('../src/text.ts');
  expect(errorText.notFound).toEqual({
    title: 'Stranica ne postoji',
    body: 'Na ovoj adresi nema stranice. Provjerite adresu ili se vratite na početnu.',
  });
});
