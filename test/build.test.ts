import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from '../scripts/build.ts';
import { checkBudget, parseBudget } from '../scripts/budget.ts';

let out: string;
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'dist-'));
  await build(out);
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

test('izgradnja daje samo statični index.html sa skriptom i stilom', () => {
  expect(readdirSync(out)).toEqual(['index.html']);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toMatch(/<style>[^<]*--ground[^<]*<\/style>/);
  expect(html).toMatch(/<script>[^<]+<\/script>/);
});

test('izgrađena stranica ne zove nijedan server', () => {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(']) {
    expect(html).not.toContain(call);
  }
  expect(html).not.toMatch(/https?:\/\//);
});

test('izgrađena stranica stane u proračun iz repoa', () => {
  expect(checkBudget(out, parseBudget(readFileSync('budget.json', 'utf8')))).toEqual([]);
});
