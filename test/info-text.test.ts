import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { infoText } from '../src/text.ts';

// Redoslijed ključeva je namjeran (kao u izvoru). SHA-256 od JSON.stringify(Ductus messagesHr.howItWorks bez `rules`, APP_NAME = „Ductura”), commit b36c82b9.
const DUCTUS_SHA256 = 'b1dcb8b906940df7bcf4b807720edc88595caef831d9ce82b538c9cc132a323a';

const SHAPE = {
  title: null,
  lead: null,
  recorded: ['heading', 'changes', 'changesConditional', 'sources', 'versions', 'access'],
  notRecorded: ['heading', 'keys', 'outside', 'rhythm', 'authorship'],
  seen: ['heading', 'columns', 'rows', 'yes', 'no', 'othersNote'],
  saving: ['heading', 'device', 'server', 'offline', 'submitted'],
  check: ['heading', 'body'],
} as const;

const leaves = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as Record<string, unknown>).flatMap(leaves);

test('odjeljak „Pravila fakulteta” (`rules`) ne ulazi', () => {
  expect(Object.keys(infoText)).not.toContain('rules');
});

test('oblik: točni ključevi na svakoj razini, svaka vrijednost je neprazan tekst', () => {
  expect(Object.keys(infoText)).toEqual(Object.keys(SHAPE));
  for (const [k, keys] of Object.entries(SHAPE)) {
    if (keys === null) continue;
    expect(Object.keys((infoText as unknown as Record<string, object>)[k]!)).toEqual([...keys]);
  }
  expect(Object.keys(infoText.seen.columns)).toEqual(['view', 'you', 'mentor', 'others']);
  expect(Object.keys(infoText.seen.rows)).toEqual(['live', 'replay', 'compare']);
  const all = leaves(infoText);
  expect(all).toHaveLength(31);
  for (const t of all) expect(t.trim()).toBe(t), expect(t.length).toBeGreaterThan(0);
});

test('doslovnost: sažetak teksta jednak Ductus izvoru (b36c82b9) bez odjeljka rules', () => {
  expect(createHash('sha256').update(JSON.stringify(infoText)).digest('hex')).toBe(DUCTUS_SHA256);
});

test('regresija: tekst nema imena ustanove (puna zaštita je 969-4)', () => {
  const all = leaves(infoText).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  for (const root of ['fpzg', 'sveucilist', 'fakultet', 'ustanov']) expect(all).not.toContain(root);
});

test('infoText ne ulazi u klijentske stranice: nijedan njegov niz nije u dist/index.html ni dist/greska.html', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { build } = await import('../scripts/build.ts');
  const out = mkdtempSync(join(tmpdir(), 'dist-text-'));
  try {
    await build(out);
    for (const file of ['index.html', 'greska.html']) {
      const html = readFileSync(join(out, file), 'utf8');
      for (const t of ['Što se bilježi', 'Tko što vidi', 'Provjera predanog rada', 'Kako se rad sprema']) {
        expect(html).not.toContain(t);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
