// DAN-955: the product domain is ductura.org (owner decision 17. 11. 2026., Ductus#2012 c.6934113245).
// The repo documentation (README.md) may name no other ductura.<tld> and
// no rejected TLD. Text is normalized first, so escapes, lookalike dots and
// zero-width characters do not hide a finding. Port of ductura/.github
// scripts/plan-domain.test.mjs without the whole-repo byte scan.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const PLAN_FILES = ['README.md'];
const REJECTED = ['c' + 'fd', 'to' + 'p']; // spelled apart so this file never names them

const normalize = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[。．｡]/g, '.')
    .replace(/\\\./g, '.')
    .replace(/\[\.\]/g, '.')
    .replace(/[ \t]+\./g, '.');

/** Every ductura domain whose whole label chain is not exactly ".org". */
export const foreignDomains = (text: string): string[] =>
  [...normalize(text).matchAll(/(?<![\p{L}\p{N}_-])ductura((?:\.[\p{L}\p{N}\p{M}-]+)+)/giu)]
    .filter((m) => (m[1] ?? '').toLowerCase() !== '.org')
    .map((m) => m[0]);

/** A rejected TLD as a whole word, or `.cfd`/`.top` as a code span of any backtick run. */
export const rejectedTldMentions = (text: string): string[] => {
  const t = normalize(text);
  const word = new RegExp(`\\b${REJECTED[0]}\\b`, 'gi');
  const span = new RegExp(`(\`+)\\s*\\.(?:${REJECTED.join('|')})\\s*\\1`, 'gi');
  return [...t.matchAll(word), ...t.matchAll(span)].map((m) => m[0]);
};

// <c> and <t> stand for the two rejected TLDs (<C>, <T> upper case).
const spell = (s: string): string =>
  s.replace(/<([ctCT])>/g, (_, k: string) => {
    const tld = REJECTED[k.toLowerCase() === 'c' ? 0 : 1] ?? '';
    return k === k.toUpperCase() ? tld.toUpperCase() : tld;
  });

test.each([
  'ductura.<c>', 'c.ductura.<c>', 'Ductura.<C>', 'ductura\\.<c>', 'ductura[.]<c>', 'ductura .<c>',
  'ductura​.<c>', 'ductura．<c>', 'ductura。<c>', 'ductura｡<c>', 'ductura.<t>',
  'ductura.org.<c>', 'c.ductura.ORG.example', 'ductura.рф', 'ductura.xn--p1ai',
].map(spell))('a disguised foreign domain is a finding: %s', (s) => {
  expect(foreignDomains(`Primjer na \`${s}\`.`)).toHaveLength(1);
});

test.each(['`.<t>`', '`.<T>`', '<c>', '<C> ili', '`.<c>`', '` .<t> `', '`` .<t> ``', '` .<t> `'].map(spell))(
  'a rejected TLD in plan text is a finding: %s',
  (s) => { expect(rejectedTldMentions(s).length).toBeGreaterThan(0); },
);

test.each([
  'ductura.org', 'c.ductura.org', 'Domena je ductura.org.', '(ductura.org).', 'https://ductura.org/api/auth/callback',
  '@ductura/contracts', 'ductura/.github', 'ductura/Institution_front_web_chrome', 'https://github.com/ductura/Institution_server',
  'https://github.com/ductura/.github/blob/main/docs/plan/PLAN-MIGRACIJE.md',
  'Repozitorij organizacije Ductura. Zajednički', 'topologija, window.top, .top { }',
])('ductura.org, repo paths and prose are not findings: %s', (s) => {
  expect(foreignDomains(s)).toEqual([]);
  expect(rejectedTldMentions(s)).toEqual([]);
});

test.each(PLAN_FILES)('%s names only ductura.org and no rejected TLD', (file) => {
  const text = readFileSync(file, 'utf8');
  expect(foreignDomains(text)).toEqual([]);
  expect(rejectedTldMentions(text)).toEqual([]);
});

test('README links the canonical plan and names ductura.org', () => {
  const readme = readFileSync('README.md', 'utf8');
  expect(readme).toContain('https://github.com/ductura/.github/blob/main/docs/plan/PLAN-MIGRACIJE.md');
  expect(readme).toMatch(/`(?:[a-z0-9-]+\.)*ductura\.org`/);
});
