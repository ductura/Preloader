import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from '../scripts/build.ts';
import { checkBudget, gzipSize, parseBudget } from '../scripts/budget.ts';
import { renderInfoPage } from '../src/page.ts';
import { infoText } from '../src/text.ts';

const budget = parseBudget(readFileSync('budget.json', 'utf8'));
let out: string;
let html: string;
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'dist-info-'));
  await build(out);
  html = readFileSync(join(out, 'info', 'index.html'), 'utf8');
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

const leaves = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as Record<string, unknown>).flatMap(leaves);
const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('proračun: datoteka bez granice pada', () => {
  const { 'info/index.html': _omit, ...rest } = budget.files;
  expect(checkBudget(out, { total: budget.total, files: rest })).toContain('info/index.html: nema granice u proračunu');
});

test('proračun: granica 1 B ispod stvarne veličine pada, ukupni zbroj također', () => {
  const size = gzipSize(join(out, 'info', 'index.html'));
  const tight = { total: budget.total, files: { ...budget.files, 'info/index.html': size - 1 } };
  expect(checkBudget(out, tight)).toEqual([`info/index.html: ${size} B gzip > ${size - 1} B`]);
  const sum = Object.values(budget.files).reduce((a, b) => a + b, 0);
  expect(checkBudget(out, { ...budget, total: sum - budget.files['info/index.html']! - 1 }).join()).toContain('ukupno');
});

test('proračun: izgradnja stane, a glavna i stranica grešaka ne rastu', () => {
  expect(checkBudget(out, budget)).toEqual([]);
  expect(budget.files['index.html']).toBe(3456);
  expect(budget.files['greska.html']).toBe(2122);
  expect(budget.total).toBe(Object.values(budget.files).reduce((a, b) => a + b, 0));
});

test('/info/ je statična: bez skripte, bez vanjskih resursa, bez poziva mreže', () => {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/https?:\/\//);
  expect(html).not.toMatch(/\son\w+=/i);
  expect(html).toMatch(/^<!doctype html>\n<html lang="hr">/);
});

test('/info/ nosi sve tekstove iz infoText i naslov h1', () => {
  expect(html).toContain('<h1>Kako Ductura radi</h1>');
  const body = decode(html);
  for (const t of leaves(infoText)) expect(body).toContain(t);
});

test('tablica „Tko što vidi” ima zaglavlja stupaca i redaka s `scope`', () => {
  expect(html.match(/<th scope="col">/g)).toHaveLength(4);
  expect(html.match(/<th scope="row">/g)).toHaveLength(3);
  expect(html.match(/<td>/g)).toHaveLength(9);
});

test('tekst se escapea: <, &, " i \' ne ulaze sirovi', () => {
  const evil = { ...infoText, lead: `<img src=x onerror=1> & "q" 'a'` };
  const page = renderInfoPage({ css: '' }, evil);
  expect(page).toContain('&lt;img src=x onerror=1&gt; &amp; &quot;q&quot; &#39;a&#39;');
  expect(page).not.toContain('<img');
});

test('odjeljak „Pravila fakulteta” ne ulazi na /info/ (PLAN §1 (3e)); puna zaštita je 969-4', () => {
  expect(Object.keys(infoText)).not.toContain('rules');
  const all = leaves(infoText).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  for (const root of ['fpzg', 'sveucilist', 'fakultet', 'ustanov']) expect(all).not.toContain(root);
});
