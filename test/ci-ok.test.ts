// ci-ok is the one required status (DAN-885): a plain job named ci-ok that
// needs every other job of the only pull request workflow and passes only when
// each of them succeeded. The tests read the workflow and run its shell block.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);
const workflow = readFileSync(new URL('ci.yml', dir), 'utf8');

const lines = (text: string): string[] => text.split(/\r\n|\r|\n/).map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s+#.*$/, '').trimEnd()));

// Job blocks under a top-level `jobs:`. Fails closed: every job-level line
// (indented less than four spaces) must be a plain `name:` key, so a quoted
// key, a tab, another indentation or a merge key can never hide a job.
function jobBlocks(text: string): Map<string, string> {
  const all = lines(text);
  const start = all.indexOf('jobs:');
  assert.ok(start >= 0, 'workflow has a top-level jobs:');
  const blocks = new Map<string, string[]>();
  let name: string | undefined;
  for (const line of all.slice(start + 1)) {
    if (line === '') continue;
    if (/^[^\s]/.test(line)) break;
    if (/^ {4}/.test(line) && name) {
      blocks.get(name)?.push(line);
      continue;
    }
    const key = /^ {2}([A-Za-z0-9_-]+):$/.exec(line)?.[1];
    assert.ok(key, `unreadable job line: ${JSON.stringify(line)}`);
    assert.ok(!blocks.has(key), `duplicate job ${key}`);
    blocks.set((name = key), []);
  }
  return new Map([...blocks].map(([k, v]) => [k, v.join('\n')]));
}

// Everything outside the top-level jobs block, without comments: triggers in
// any spelling (`on:`, `"on":`, after jobs) end up here.
function outsideJobs(text: string): string {
  let inJobs = false;
  return lines(text)
    .filter((line) => {
      if (/^[^\s]/.test(line)) inJobs = line === 'jobs:';
      return !inJobs;
    })
    .join('\n');
}
const FORBIDDEN = /(?<![\w-])(pull_request(?!_target)\w*|push|merge_group)(?![\w-])/;

// `needs: [a, b]` on one line or `needs:` followed by `- a` lines.
function needsOf(block: string): string[] {
  const inline = /^ {4}needs:\s*\[([^\]]*)\]/m.exec(block);
  if (inline?.[1] !== undefined) return inline[1].split(',').map((s) => s.trim()).filter(Boolean);
  const list = /^ {4}needs:\s*\n((?: {6}- .*\n?)+)/m.exec(block);
  return list?.[1] !== undefined ? list[1].split('\n').map((l) => l.replace(/^\s*- /, '').trim()).filter(Boolean) : [];
}

// The shell lines between `# ci-ok:begin` and `# ci-ok:end`, dedented.
function ciOkScript(text: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const begin = lines.findIndex((l) => l.trim() === '# ci-ok:begin');
  const end = lines.findIndex((l) => l.trim() === '# ci-ok:end');
  assert.ok(begin >= 0 && end > begin + 1, 'one ci-ok:begin..end block');
  const body = lines.slice(begin + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => (/^ */.exec(l)?.[0] ?? '').length));
  return body.map((l) => l.slice(indent)).join('\n') + '\n';
}

const script = ciOkScript(workflow);
const run = (value: string): { code: number | null; out: string } => {
  const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, NEEDS: value }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const needs = (o: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { result: v, outputs: {} }])));

const cases: [string, string, number][] = [
  ['one failure', needs({ a: 'success', b: 'failure' }), 1],
  ['cancelled', needs({ a: 'success', b: 'cancelled' }), 1],
  ['skipped', needs({ a: 'success', b: 'skipped' }), 1],
  ['unknown result', needs({ a: 'neutral' }), 1],
  ['job without result', JSON.stringify({ a: { outputs: {} } }), 1],
  ['result null', JSON.stringify({ a: { result: null } }), 1],
  ['job value is a string', JSON.stringify({ a: 'success' }), 1],
  ['result is a number', JSON.stringify({ a: { result: 1 } }), 1],
  ['result with a trailing space', needs({ a: 'success ' }), 1],
  ['empty needs', '{}', 1],
  ['empty string', '', 1],
  ['invalid JSON', '{a:', 1],
  ['array instead of object', '[]', 1],
  ['null', 'null', 1],
  ['failure with a space and quote in the name', needs({ 'x "y"': 'failure' }), 1],
  ['all success', needs({ a: 'success', b: 'success' }), 0],
  ['job name with a space and quote', needs({ 'x "y"': 'success' }), 0],
];

for (const [name, value, code] of cases) {
  test(`ci-ok ${code === 0 ? 'passes' : 'fails'}: ${name}`, () => {
    const r = run(value);
    assert.equal(r.code, code, r.out);
  });
}

test('ci-ok names the failing job, not the good one', () => {
  const r = run(needs({ good: 'success', bad: 'failure' }));
  assert.match(r.out, /::error::job bad result: failure/);
  assert.doesNotMatch(r.out, /::error::.*good/);
});

test('ci-ok explains input that is not a non-empty object', () => {
  assert.match(run('null').out, /::error::needs must be a non-empty JSON object/);
});

test('job parser reads CRLF, comments and multi-line needs', () => {
  const jobs = jobBlocks('on: push\r\njobs: # all\r\n  a: # first\r\n    runs-on: x\r\n\r\n  b:\r\n    needs:\r\n      - a\r\n      - c\r\n  # c is last\r\n  c:\r\n    needs: [ a , b ]\r\n');
  assert.deepEqual([...jobs.keys()], ['a', 'b', 'c']);
  assert.deepEqual(needsOf(jobs.get('b') ?? ''), ['a', 'c']);
  assert.deepEqual(needsOf(jobs.get('c') ?? ''), ['a', 'b']);
  assert.deepEqual(needsOf(jobs.get('a') ?? ''), []);
});

const unreadable: [string, string][] = [
  ['single-quoted key', "  'qa-extra':\n    runs-on: x\n"],
  ['double-quoted key', '  "qa-extra":\n    runs-on: x\n'],
  ['tab indentation', '\tqa-extra:\n    runs-on: x\n'],
  ['NBSP indentation', '\u00a0 qa-extra:\n    runs-on: x\n'],
  ['three-space job', '   qa-extra:\n    runs-on: x\n'],
  ['key with a value on the line', '  qa-extra: { runs-on: x }\n'],
  ['merge key', '  <<: *base\n'],
  ['duplicate job', '  a:\n    runs-on: x\n  a:\n    runs-on: y\n'],
];
for (const [name, body] of unreadable) {
  test(`job parser fails closed: ${name}`, () => {
    assert.throws(() => jobBlocks(`on: push\njobs:\n  a0:\n    runs-on: x\n${body}`));
  });
}
test('job parser fails without a plain top-level jobs:', () => {
  assert.throws(() => jobBlocks('"jobs":\n  a:\n    runs-on: x\n'));
});
test('job parser fails when jobs are indented by four spaces', () => {
  assert.throws(() => jobBlocks('jobs:\n    a:\n      runs-on: x\n'));
});

const triggers: [string, string, boolean][] = [
  ['quoted on', '"on": pull_request\njobs:\n  a:\n    runs-on: x\n', true],
  ['single-quoted on with a list', "'on': [push]\njobs:\n  a:\n    runs-on: x\n", true],
  ['on after jobs', 'jobs:\n  a:\n    runs-on: x\non:\n  merge_group:\n', true],
  ['review event', 'on: pull_request_review\njobs:\n  a:\n    runs-on: x\n', true],
  ['quoted jobs hides nothing', 'on: schedule\n"jobs":\n  a:\n    run: git push\n', true],
  ['gate caller', 'on:\n  pull_request_target:\n  issue_comment:\njobs:\n  a:\n    run: git push\n', false],
  ['trigger only in a comment', '# runs on push elsewhere\non: workflow_call\njobs:\n  a:\n    runs-on: x\n', false],
];
for (const [name, text, found] of triggers) {
  test(`trigger check ${found ? 'finds' : 'allows'}: ${name}`, () => {
    assert.equal(FORBIDDEN.test(outsideJobs(text)), found);
  });
}

test('ci-ok is a plain job named ci-ok that runs always over every other job', () => {
  const jobs = jobBlocks(workflow);
  const ok = jobs.get('ci-ok');
  assert.ok(ok, 'ci.yml has a ci-ok job');
  assert.match(ok, /^ {4}name: ci-ok$/m);
  assert.match(ok, /^ {4}runs-on: /m);
  assert.doesNotMatch(ok, /^ {4}uses: /m);
  assert.match(ok, /^ {4}if: (always\(\)|\$\{\{ always\(\) \}\})$/m);
  assert.match(ok, /NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  const others = [...jobs.keys()].filter((j) => j !== 'ci-ok');
  assert.ok(others.length > 0);
  assert.deepEqual(needsOf(ok).sort(), others.sort());
});

// needs cannot see another workflow, so ci.yml is the only one that runs on
// pull_request, push or merge_group. Gate callers (pull_request_target,
// issue_comment), workflow_call, schedule and workflow_dispatch are allowed.
test('no other workflow runs on pull_request, push or merge_group', () => {
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f) && f !== 'ci.yml')) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(outsideJobs(text), FORBIDDEN, file);
  }
});
