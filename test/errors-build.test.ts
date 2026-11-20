// DAN-935-2: tekstovi grešaka su samo u dist/greska.html; glavna stranica ih ne nosi i ne raste.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from './static-build.ts';
import { contentSecurityPolicyFor } from '../deploy/edge/index.ts';
import { errorText, text } from '../src/text.ts';

let out: string;
let index: string;
let page: string;
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'dist-'));
  await build(out);
  index = readFileSync(join(out, 'index.html'), 'utf8');
  page = readFileSync(join(out, 'greska.html'), 'utf8');
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

test('glavna stranica ne nosi nijedan tekst greške', () => {
  for (const { title, body } of Object.values(errorText)) {
    expect(index).not.toContain(title);
    expect(index).not.toContain(body);
  }
});

test('greska.html nosi sve tekstove, a bez skripte opći tekst i poveznicu na početnu', () => {
  for (const { title, body } of Object.values(errorText)) {
    expect(page).toContain(title);
    expect(page).toContain(body);
  }
  const noScript = page.replace(/<script>[\s\S]*<\/script>/, '');
  expect(noScript).toContain(`<h1 id="error-title">${errorText.general.title}</h1>`);
  expect(noScript).toContain(`<p id="error-body" class="lead">${errorText.general.body}</p>`);
  expect(noScript).toContain(`<a class="button" href="/">${text.home}</a>`);
});

test('greska.html ne zove server i ne treba ništa što bi CSP blokirao', async () => {
  for (const call of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'import(', 'innerHTML']) {
    expect(page).not.toContain(call);
  }
  expect(page).not.toMatch(/https?:\/\//);
  expect(page).not.toMatch(/\son[a-z]+=|\sstyle=/i);
  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? '';
  const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  const policy = await contentSecurityPolicyFor(page);
  expect(policy).toContain(`script-src ${hash};`);
  expect(policy).not.toMatch(/unsafe-|\*/);
});
