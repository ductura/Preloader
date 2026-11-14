import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { checkBudget, parseBudget } from '../scripts/budget.ts';

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
