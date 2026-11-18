import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { clientText, errorText, infoText, PACKAGE_LABELS, text } from '../src/text.ts';

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

// Tvrdnje preuzete iz Ductus `src/components/how-it-works/copy.test.ts` (b36c82b9), neovisne o sažetku.
test('oznake spremanja se zovu kao u uređivaču', () => {
  expect(infoText.saving.device.startsWith('Spremljeno na uređaju')).toBe(true);
  expect(infoText.saving.server.startsWith('Spremljeno na poslužitelju')).toBe(true);
});

test('oznaka na uređaju ne tvrdi da poslužitelj nema tekst, nego da ne govori je li ga primio', () => {
  expect(infoText.saving.device).not.toMatch(/nije primio|nema tekst|nije stigao/);
  expect(infoText.saving.device).toMatch(/je li ga poslužitelj već primio/);
});

test('infoText ne ulazi u klijentske stranice: nijedan njegov niz (i naslov) nije u dist/index.html ni dist/greska.html', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { build } = await import('../scripts/build.ts');
  // Ne računaju se nizovi iz vlastitih kataloga klijentskih stranica (npr. „Prikaz”) ni kratki nizovi (Da, Ne, Vi…)
  // koji su podniz bilo kojeg HTML-a; svi naslovi i rečenice (od 12 znakova) računaju se.
  const own = new Set([...leaves(text), ...leaves(clientText), ...leaves(errorText), ...leaves(PACKAGE_LABELS)]);
  const mine = leaves(infoText).filter((t) => t.length >= 12 && !own.has(t));
  expect(mine).toContain(infoText.title);
  expect(mine.length).toBeGreaterThan(20);
  const out = mkdtempSync(join(tmpdir(), 'dist-text-'));
  try {
    await build(out);
    for (const file of ['index.html', 'greska.html']) {
      const html = readFileSync(join(out, file), 'utf8').normalize('NFC');
      for (const t of mine) expect(html, `${file}: ${t}`).not.toContain(t.normalize('NFC'));
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
