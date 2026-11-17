// DAN-922: .github/dependabot.yml must match the pinned SchemaStore schema and
// the repository rule (weekly npm and github-actions updates, each grouped).
// Same pattern as ductura/.github scripts/dependabot-check.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { checkDependabot, loadSchema } from '../scripts/dependabot-check.ts';

const schemaBytes = readFileSync('scripts/dependabot/dependabot-2.0.json');
const schema = loadSchema(schemaBytes);

const GROUP = 'groups: { all: { patterns: ["*"] } }';
const entry = (eco: string, extra = ''): string =>
  `  - package-ecosystem: ${eco}\n    directory: /\n    schedule: { interval: weekly }\n    ${GROUP}\n${extra}`;
const VALID = `version: 2\nupdates:\n${entry('npm')}${entry('github-actions')}`;

test.each([
  ['unknown top-level key', `${VALID}schedual: {}\n`, /additional properties/],
  ['unknown key in an entry', `version: 2\nupdates:\n${entry('npm', '    schedual: { interval: weekly }\n')}${entry('github-actions')}`, /additional properties/],
  ['version is missing', VALID.replace('version: 2\n', ''), /'version'/],
  ['version is 1', VALID.replace('version: 2', 'version: 1'), /\/version/],
  ['version is a string', VALID.replace('version: 2', 'version: "2"'), /\/version/],
  ['package-ecosystem is missing', VALID.replace('  - package-ecosystem: npm\n    directory', '  - directory'), /'package-ecosystem'/],
  ['unknown ecosystem', VALID.replace('ecosystem: npm', 'ecosystem: npmx'), /package-ecosystem/],
  ['hourly interval (schema)', VALID.replace('interval: weekly', 'interval: hourly'), /interval/],
  ['daily interval (repository rule)', VALID.replace('interval: weekly', 'interval: daily'), /not weekly/],
  ['groups is a list', VALID.replace(GROUP, 'groups: [all]'), /groups must be object/],
  ['groups is empty (schema)', VALID.replace(GROUP, 'groups: {}'), /groups must NOT have fewer than 1 properties/],
  ['an entry has no group', VALID.replace(`    ${GROUP}\n`, ''), /no group/],
  ['npm is missing', `version: 2\nupdates:\n${entry('github-actions')}`, /no npm entry/],
  ['github-actions is missing', `version: 2\nupdates:\n${entry('npm')}`, /no github-actions entry/],
  ['duplicate key', `version: 2\n${VALID}`, /unique/],
  ['two YAML documents', `${VALID}---\n${VALID}`, /one YAML document/],
  ['empty file', '', /one YAML document/],
  ['invalid YAML', 'version: [2\n', /YAML/],
  ['document is a list', '- version: 2\n', /not a mapping/],
])('refuses: %s', (_name, text, reason) => {
  expect(checkDependabot(text, schema).join('\n')).toMatch(reason);
});

test('refuses a schema whose sha256 differs, even by one byte', () => {
  const changed = Buffer.from(schemaBytes);
  changed[changed.length - 2]! ^= 1;
  expect(() => loadSchema(changed)).toThrow(/sha256/);
});

test('accepts a minimal valid configuration', () => {
  expect(checkDependabot(VALID, schema)).toEqual([]);
});

test("the repository's .github/dependabot.yml passes", () => {
  expect(checkDependabot(readFileSync('.github/dependabot.yml', 'utf8'), schema)).toEqual([]);
});

// A CRLF checkout (core.autocrlf=true on Windows) would change the pinned bytes:
// the vendored schema must be checked out with LF everywhere.
test('the vendored schema is checked out with LF on every platform', () => {
  const attrs = execFileSync('git', ['check-attr', 'text', 'eol', '--', 'scripts/dependabot/dependabot-2.0.json'], { encoding: 'utf8' });
  expect(attrs).toContain('text: set');
  expect(attrs).toContain('eol: lf');
  expect(schemaBytes.includes(0x0d)).toBe(false);
});
