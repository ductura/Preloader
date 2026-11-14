import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { isMain } from '../scripts/is-main.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'put s razmakom-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test.each([
  ['obična putanja', '/tmp/repo/scripts/budget.ts'],
  ['razmak', '/tmp/put s razmakom/scripts/budget.ts'],
  ['znak koji se kodira', '/tmp/ćevap%20#1/scripts/budget.ts'],
])('isMain prepoznaje ulaznu točku: %s', (_name, path) => {
  expect(isMain(pathToFileURL(path).href, path)).toBe(true);
  expect(isMain(pathToFileURL(path).href, `${path}.other`)).toBe(false);
  expect(isMain(pathToFileURL(path).href, undefined)).toBe(false);
});

test('CLI proračuna iz mape s razmakom i dalje ruši prekoračenje', () => {
  const scripts = join(dir, 'scripts');
  mkdirSync(scripts);
  for (const f of ['budget.ts', 'is-main.ts']) copyFileSync(join('scripts', f), join(scripts, f));
  mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist', 'index.html'), 'x'.repeat(100));
  writeFileSync(join(dir, 'budget.json'), '{"total":0,"files":{"index.html":0}}');
  let status: number | null = 0;
  try {
    execFileSync(process.execPath, [join(scripts, 'budget.ts'), join(dir, 'dist'), join(dir, 'budget.json')], { stdio: 'pipe' });
  } catch (error) {
    status = (error as { status: number | null }).status;
  }
  expect(status).toBe(1);
});
