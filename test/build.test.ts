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

test('izgradnja daje samo statične index.html i greska.html (DAN-935-2)', () => {
  expect(readdirSync(out).sort()).toEqual(['greska.html', 'index.html']);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toMatch(/<style>[^<]*--ground[^<]*<\/style>/);
  expect(html).toMatch(/<script>[^<]+<\/script>/);
});

test('izgrađena stranica zove server samo jednom, za kontekst klijenta (P-0.8)', () => {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  expect(html.split('fetch(').length - 1).toBe(1);
  expect(html.split('"/api/v1/client-context"').length - 1).toBe(1);
  for (const call of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(']) {
    expect(html).not.toContain(call);
  }
  expect(html).not.toMatch(/https?:\/\//);
  // Ugovor ulazi samo kao tip (DAN-926-2): ni validator ni klijent iz @ductura/contracts nisu u stranici.
  for (const trace of ['invalid_input', 'lone surrogate', 'client.context.post']) expect(html).not.toContain(trace);
});

test('izgrađena stranica stane u proračun iz repoa', () => {
  expect(checkBudget(out, parseBudget(readFileSync('budget.json', 'utf8')))).toEqual([]);
});
