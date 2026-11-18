// DAN-969-2a: infoText je doslovan prijenos Ductus `messagesHr.howItWorks` i ne ulazi u klijentske stranice.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { build } from '../scripts/build.ts';
import { clientText, errorText, infoText, PACKAGE_LABELS, text } from '../src/text.ts';

// SHA-256 od JSON.stringify(Ductus messagesHr.howItWorks bez `rules`, APP_NAME = „Ductura”),
// src/lib/i18n/messages.hr.ts na b36c82b93e60b1d2d74e38611209e4fcc1ae7dfc (blok isti na Ductus main f914e4a).
const DUCTUS_SHA256 = 'b1dcb8b906940df7bcf4b807720edc88595caef831d9ce82b538c9cc132a323a';

const leaves = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return (['windows', 'macos'] as const).map((p) => String(v(p)));
  return Object.values(v as Record<string, unknown>).flatMap(leaves);
};

/** Jednak oblik za usporedbu: NFC i svaki razmak (i NBSP, novi redak) kao jedan razmak. */
const norm = (s: string): string => s.normalize('NFC').replace(/\s+/gu, ' ');
const asWord = (leaf: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])${norm(leaf).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(Number.parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : (NAMED[e.toLowerCase()] ?? m));
const decodeJsEscapes = (s: string): string =>
  s.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a?: string, b?: string, c?: string) =>
    String.fromCodePoint(Number.parseInt((a ?? b ?? c)!, 16)));

/** Sadržaj svih JS nizova i predložaka (parser razrješava bijegove), ne identifikatori. */
function jsStrings(code: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile('x.js', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
  return out;
}

const TAG = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** Područja datoteke u kojima tekst sučelja može završiti, svako kao zaseban niz za traženje riječi. */
function regions(name: string, content: string): string[] {
  if (name.endsWith('.js') || name.endsWith('.mjs')) return jsStrings(content);
  if (!name.endsWith('.html')) throw new Error(`nepoznata vrsta datoteke u dist: ${name}`);
  const scripts: string[] = [];
  const markup = content.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_, open: string, body: string, close: string) => {
    scripts.push(...jsStrings(body));
    return `${open} ${close}`;
  });
  const decode = (s: string): string => decodeJsEscapes(decodeEntities(s));
  // Oznake se uklanjaju prije dekodiranja i uz navodnike (`>` u vrijednosti atributa ne završava oznaku);
  // atributi i komentari ostaju u cijelom dekodiranom markupu, a prikazani tekst spaja se s razmakom i bez njega.
  const shown = (sep: string): string => decode(markup.replace(TAG, sep));
  return [...scripts, decode(markup), shown(' '), shown('')];
}

const leaksIn = (name: string, content: string, candidates: readonly string[]): string[] => {
  const areas = regions(name, content).map(norm);
  return candidates.filter((leaf) => areas.some((a) => asWord(leaf).test(a)));
};

const infoLeaves = leaves(infoText);
const ownLeaves = [text, clientText, errorText, PACKAGE_LABELS].flatMap(leaves).map(norm);
// Jedini list koji je i riječ u vlastitim katalozima klijenta; svaki novi izuzetak mora biti vidljiv u ovom popisu.
const SHARED = ['Prikaz'];
const checked = infoLeaves.filter((leaf) => !ownLeaves.some((o) => asWord(leaf).test(o)));

test('detektor curenja: pogađa list u tekstu, atributu, entitetima, JS nizu, predlošku i NFD obliku', () => {
  const cases: [string, string, string][] = [
    ['a.html', '<td>Da</td>', 'Da'],
    ['a.html', '<p>Tekst <b>uživo</b></p>', 'Tekst uživo'],
    ['a.html', '<p>Tekst\n  uživo</p>', 'Tekst uživo'],
    ['a.html', '<p>Tekst&nbsp;u&#x17E;ivo</p>', 'Tekst uživo'],
    ['a.html', '<p aria-label="Drugi"></p>', 'Drugi'],
    ['a.html', '<p data-t="&quot;Drugi&#39;"></p>', 'Drugi'],
    ['a.html', '<p data-t="Tekst u\\u017Eivo"></p>', 'Tekst uživo'],
    ['a.html', '<!-- Vi -->', 'Vi'],
    ['a.html', '<p>Tekst <b title="1 &gt; 0">uživo</b></p>', 'Tekst uživo'],
    ['a.html', '<p>Tekst <b title="1 > 0">uživo</b></p>', 'Tekst uživo'],
    ['a.html', "<p>Tekst <b data-x='a>b'>uživo</b></p>", 'Tekst uživo'],
    ['a.html', '<p>Tekst <!-- a > b -->uživo</p>', 'Tekst uživo'],
    ['a.html', '<p>Tekst u<b title="&gt;">živo</b></p>', 'Tekst uživo'],
    ['a.html', '<script>var Ne=1;f("Tekst u\\u017Eivo")</script>', 'Tekst uživo'],
    ['a.html', '<script>f(`x ${Ne} Ne`)</script>', 'Ne'],
    ['a.html', '<script>f(/["\']/.test(a)?"Da":0)</script>', 'Da'],
    ['a.js', 'f(\'Kako Ductura radi\')', infoText.title],
    ['a.html', `<h1>${infoText.title.normalize('NFD')}</h1>`, infoText.title],
    ['a.html', '<p>Tekst uz\u030Civo</p>', 'Tekst uživo'],
  ];
  for (const [name, content, leaf] of cases) expect(leaksIn(name, content, [leaf]), content).toEqual([leaf]);
});

test('detektor curenja: ne pogađa identifikatore ni dijelove riječi', () => {
  const cases: [string, string, string][] = [
    ['a.html', '<script>var Ne=1,Da=Ne+Vi;Drugi()</script>', 'Ne'],
    ['a.html', '<script>var Ne=1,Da=Ne+Vi;Drugi()</script>', 'Da'],
    ['a.html', '<script>var Ne=1,Da=Ne+Vi;Drugi()</script>', 'Drugi'],
    ['a.html', '<p>Nema veze</p>', 'Ne'],
    ['a.html', '<p>Data</p>', 'Da'],
    ['a.html', '<p>Vašem</p>', 'Vi'],
  ];
  for (const [name, content, leaf] of cases) expect(leaksIn(name, content, [leaf]), `${leaf} u ${content}`).toEqual([]);
});

test('infoText ne ulazi ni u jednu datoteku u dist: svaki list, bez praga duljine', async () => {
  expect(infoLeaves.filter((l) => !checked.includes(l))).toEqual(SHARED);
  expect(checked).toEqual(expect.arrayContaining([infoText.title, 'Tekst uživo', 'Da', 'Ne', 'Vi', 'Drugi']));
  const out = mkdtempSync(join(tmpdir(), 'dist-info-'));
  try {
    await build(out);
    const files = readdirSync(out, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(['index.html', 'greska.html']));
    for (const f of files) {
      const content = readFileSync(join(f.parentPath, f.name), 'utf8');
      // Svaki imenovani entitet mora biti poznat dekoderu, inače bi tekst iza njega promaknuo.
      for (const [, e] of content.matchAll(/&([a-z][a-z0-9]*);/gi)) expect(NAMED, `${f.name}: &${e};`).toHaveProperty(e!.toLowerCase());
      expect(leaksIn(f.name, content, checked), f.name).toEqual([]);
    }
    // Pozitivna kontrola parsera na stvarnim skriptama: vlastiti tekst klijenta mora biti pronađen.
    const strings = (file: string) => regions(file, readFileSync(join(out, file), 'utf8')).map(norm);
    expect(strings('index.html').some((a) => asWord(clientText.choiceSaved).test(a))).toBe(true);
    expect(strings('greska.html').some((a) => asWord(errorText.offline.title).test(a))).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('odjeljak „Pravila fakulteta” (`rules`) ne ulazi', () => {
  expect(Object.hasOwn(infoText, 'rules')).toBe(false);
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
});

test('tvrdnje o spremanju ruše izmijenjen tekst neovisno o sažetku', () => {
  const s = infoText.saving;
  expect(savingProblems({ ...s, device: 'Spremljeno na uređaju: poslužitelj ga još nije primio.' })).toHaveLength(2);
  expect(savingProblems({ ...s, device: s.device.replace('Spremljeno', 'Sačuvano') })).toHaveLength(1);
  expect(savingProblems({ ...s, server: s.server.replace('poslužitelju', 'serveru') })).toHaveLength(1);
});

test('regresija: tekst nema imena ustanove', () => {
  const all = infoLeaves.join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  for (const root of ['fpzg', 'sveucilist', 'fakultet', 'ustanov']) expect(all).not.toContain(root);
});

test('doslovnost: ključevi i redoslijed kao u izvoru, 31 neprazan list, sažetak jednak izvoru', () => {
  const keys = (v: object): unknown =>
    Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? null : keys(x as object)]));
  expect(JSON.stringify(keys(infoText))).toBe(JSON.stringify({
    title: null, lead: null,
    recorded: { heading: null, changes: null, changesConditional: null, sources: null, versions: null, access: null },
    notRecorded: { heading: null, keys: null, outside: null, rhythm: null, authorship: null },
    seen: { heading: null, columns: { view: null, you: null, mentor: null, others: null },
      rows: { live: null, replay: null, compare: null }, yes: null, no: null, othersNote: null },
    saving: { heading: null, device: null, server: null, offline: null, submitted: null },
    check: { heading: null, body: null },
  }));
  expect(infoLeaves).toHaveLength(31);
  for (const t of infoLeaves) expect(t.length > 0 && t.trim() === t, t).toBe(true);
  expect(createHash('sha256').update(JSON.stringify(infoText)).digest('hex')).toBe(DUCTUS_SHA256);
});
