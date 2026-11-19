import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { checkBudget, checkDir, nextPageSizes, parseBudget } from '../scripts/budget.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'budget-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Writes deterministic, poorly compressible content and returns its gzip size. */
function file(name: string, bytes: number): number {
  let x = 7;
  const body = Buffer.alloc(bytes, 0).map(() => (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff);
  writeFileSync(join(dir, name), body);
  return gzipSync(body, { level: 9 }).length;
}

describe('checkBudget', () => {
  test('ispod granice prolazi', () => {
    const size = file('index.html', 500);
    expect(checkBudget(dir, { total: size + 10, files: { 'index.html': size + 1 } })).toEqual([]);
  });

  test('točno na granici prolazi', () => {
    const size = file('index.html', 500);
    expect(checkBudget(dir, { total: size, files: { 'index.html': size } })).toEqual([]);
  });

  test('jedan bajt iznad granice datoteke pada', () => {
    const size = file('index.html', 500);
    expect(checkBudget(dir, { total: 10_000, files: { 'index.html': size - 1 } })).toEqual([
      expect.stringContaining('index.html'),
    ]);
  });

  test('zbroj iznad ukupne granice pada iako je svaka datoteka ispod svoje', () => {
    const a = file('a.js', 400);
    const b = file('b.js', 400);
    const problems = checkBudget(dir, { total: a + b - 1, files: { 'a.js': a, 'b.js': b } });
    expect(problems).toEqual([expect.stringContaining('ukupno')]);
  });

  test('datoteka iz proračuna koja ne postoji pada', () => {
    file('index.html', 100);
    expect(checkBudget(dir, { total: 10_000, files: { 'index.html': 10_000, 'app.js': 10_000 } })).toEqual([
      expect.stringContaining('app.js'),
    ]);
  });

  test('datoteka bez pravila u proračunu pada', () => {
    file('index.html', 100);
    file('extra.js', 100);
    expect(checkBudget(dir, { total: 10_000, files: { 'index.html': 10_000 } })).toEqual([
      expect.stringContaining('extra.js'),
    ]);
  });
});

describe('datoteka imena svojstva iz Object.prototype nema pravilo', () => {
  test.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'])('%s pada', (name) => {
    file('index.html', 100);
    file(name, 10);
    expect(checkBudget(dir, { total: 10_000, files: { 'index.html': 10_000 } })).toEqual([
      expect.stringContaining(`${name}: nema granice`),
    ]);
  });

  test('pravilo za __proto__ iz JSON-a vrijedi kao obična datoteka', () => {
    const size = file('__proto__', 100);
    file('index.html', 100);
    const budget = parseBudget(`{"total":10000,"files":{"index.html":10000,"__proto__":${size - 1}}}`);
    expect(checkBudget(dir, budget)).toEqual([expect.stringContaining('__proto__: ')]);
  });
});

describe('parseBudget odbija neispravan proračun', () => {
  test.each([
    ['prazno', ''],
    ['nije JSON', '{'],
    ['bez datoteka', '{"total":10,"files":{}}'],
    ['negativna granica', '{"total":10,"files":{"a":-1}}'],
    ['nije cijeli broj', '{"total":1.5,"files":{"a":1}}'],
    ['bez ukupne granice', '{"files":{"a":1}}'],
    ['nepoznato polje', '{"total":10,"files":{"a":1},"x":1}'],
    ['putanja izvan mape', '{"total":10,"files":{"../a":1}}'],
  ])('%s', (_name, text) => expect(() => parseBudget(text)).toThrow());

  test('ispravan proračun', () => {
    expect(parseBudget('{"total":10,"files":{"index.html":8}}')).toEqual({ total: 10, files: { 'index.html': 8 } });
  });
});

describe('CLI ruši izgradnju kad se proračun prijeđe', () => {
  const cli = (budget: object) => {
    const path = join(dir, 'budget.json');
    writeFileSync(path, JSON.stringify(budget));
    return () => execFileSync(process.execPath, ['scripts/budget.ts', join(dir, 'dist'), path], { stdio: 'pipe' });
  };
  const dist = (bytes: number) => {
    const inner = join(dir, 'dist');
    execFileSync('mkdir', ['-p', inner]);
    let x = 3;
    const body = Buffer.alloc(bytes, 0).map(() => (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff);
    writeFileSync(join(inner, 'index.html'), body);
  };

  test('pozitivno: izlazni kod 0', () => {
    dist(200);
    expect(cli({ total: 10_000, files: { 'index.html': 10_000 } })).not.toThrow();
  });

  test('negativno: izlazni kod različit od 0', () => {
    dist(2000);
    let status: number | null = 0;
    try {
      cli({ total: 100, files: { 'index.html': 100 } })();
    } catch (error) {
      status = (error as { status: number | null }).status;
    }
    expect(status).toBe(1);
  });
});

describe('izgradnja Nexta (.next)', () => {
  /** `.next` sa stranicom, njezinim skriptama i datotekom koju stranica ne učitava. */
  function next(html: string, assets: Record<string, number>): string {
    const root = join(dir, '.next');
    execFileSync('mkdir', ['-p', join(root, 'server', 'pages'), join(root, 'static', 'chunks')]);
    writeFileSync(join(root, 'server', 'pages', 'index.html'), html);
    for (const [name, bytes] of Object.entries(assets)) {
      let x = bytes;
      writeFileSync(join(root, 'static', 'chunks', name), Buffer.alloc(bytes, 0).map(() => (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff));
    }
    return root;
  }
  const gz = (path: string) => gzipSync(readFileSync(path), { level: 9 }).length;

  test('stranica je HTML plus svaka skripta i stil koje učita, bez noModule', () => {
    const html = '<script src="/_next/static/chunks/a.js"></script><link rel="stylesheet" href="/_next/static/chunks/c.css">' +
      '<script src="/_next/static/chunks/p.js" noModule=""></script><link rel="icon" href="/_next/static/chunks/i.js">';
    const root = next(html, { 'a.js': 300, 'c.css': 200, 'p.js': 400, 'i.js': 100, 'ostalo.js': 500 });
    const { sizes, total } = nextPageSizes(root, ['index.html', 'greska.html']);
    const chunk = (name: string) => gz(join(root, 'static', 'chunks', name));
    const expected = gz(join(root, 'server', 'pages', 'index.html')) + chunk('a.js') + chunk('c.css');
    expect([...sizes]).toEqual([['index.html', expected]]);
    expect(total).toBe(expected);
    expect(checkDir(root, { total: expected, files: { 'index.html': expected } })).toEqual([]);
    expect(checkDir(root, { total: expected, files: { 'index.html': expected - 1 } })).toEqual([expect.stringContaining('index.html')]);
  });

  test('stranica iz proračuna koja ne postoji pada, i skripta koje nema', () => {
    const root = next('<p>x</p>', {});
    expect(checkDir(root, { total: 10_000, files: { 'index.html': 10_000, 'greska.html': 10_000 } })).toEqual([
      expect.stringContaining('greska.html: datoteka iz proračuna ne postoji'),
    ]);
    writeFileSync(join(root, 'server', 'pages', 'index.html'), '<script src="/_next/static/chunks/nema.js"></script>');
    expect(() => nextPageSizes(root, ['index.html'])).toThrow(/nema\.js/);
  });
});
