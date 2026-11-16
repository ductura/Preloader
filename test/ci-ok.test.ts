// ci-ok is the one required status (DAN-885): a plain job named ci-ok that
// needs every other job of the only pull request workflow and passes only when
// each of them succeeded. The workflows are read with a real YAML parser, so
// quoting, escapes, flow style and anchors cannot hide a job or a trigger.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from 'yaml';

const dir = new URL('../.github/workflows/', import.meta.url);
type Obj = Record<string, unknown>;
const isMap = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// Parses one workflow; fails on any YAML error, duplicate key or a document
// that is not a mapping.
function workflowOf(text: string): Obj {
  const doc = parseDocument(text, { uniqueKeys: true, merge: true });
  assert.equal(doc.errors.length, 0, doc.errors.map((e) => e.message).join('; '));
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  assert.ok(isMap(value), 'workflow is a mapping');
  return value;
}

// Event names of a workflow. `on` may also arrive as the key "true" (YAML 1.1
// reads on as a boolean); exactly one of the two must be present.
function eventsOf(wf: Obj): string[] {
  const keys = ['on', 'true'].filter((k) => Object.hasOwn(wf, k));
  assert.equal(keys.length, 1, 'workflow has exactly one on key');
  const on = wf[keys[0] ?? 'on'];
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) {
    assert.ok(on.length > 0 && on.every((e) => typeof e === 'string'), 'on list holds event names');
    return on as string[];
  }
  assert.ok(isMap(on) && Object.keys(on).length > 0, 'on is a name, a list or a mapping');
  return Object.keys(on);
}

// Jobs of a workflow as a name -> job mapping.
function jobsOf(wf: Obj): Record<string, Obj> {
  const jobs = wf['jobs'];
  assert.ok(isMap(jobs) && Object.keys(jobs).length > 0, 'workflow has jobs');
  for (const [name, job] of Object.entries(jobs)) assert.ok(isMap(job), `job ${name} is a mapping`);
  return jobs as Record<string, Obj>;
}

const needsOf = (job: Obj | undefined): string[] => {
  const n = job?.['needs'];
  return typeof n === 'string' ? [n] : Array.isArray(n) ? n.map(String) : [];
};

// Events another workflow may have: the engineering gate callers and events
// that never run on a pull request. Anything else (pull_request, push,
// merge_group, pull_request_review, ...) would run jobs ci-ok cannot see.
const ALLOWED = new Set(['workflow_call', 'workflow_dispatch', 'schedule', 'pull_request_target', 'issue_comment']);
const strayEvents = (text: string): string[] => eventsOf(workflowOf(text)).filter((e) => !ALLOWED.has(e));

const workflow = workflowOf(readFileSync(new URL('ci.yml', dir), 'utf8'));
const ciOk = jobsOf(workflow)['ci-ok'];
const steps: Obj[] = Array.isArray(ciOk?.['steps']) ? (ciOk['steps'] as Obj[]) : [];
const step = steps.find((s) => typeof s['run'] === 'string' && s['run'].includes('# ci-ok:begin'));
const script = typeof step?.['run'] === 'string' ? step['run'] : '';

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
    assert.ok(script, 'ci-ok has a step with the ci-ok:begin block');
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

// Workflows another PR could add: each must be refused by the trigger check.
const strays: [string, string, string[]][] = [
  ['double-quoted on', '"on": pull_request\njobs: { x: { runs-on: u } }\n', ['pull_request']],
  ['single-quoted on with a list', "'on': [push]\njobs: { x: { runs-on: u } }\n", ['push']],
  ['escaped event name in a list', 'on: ["\\u0070ull_request"]\njobs: { x: { runs-on: u } }\n', ['pull_request']],
  ['escaped event name as a string', 'on: "pull\\u005frequest"\njobs: { x: { runs-on: u } }\n', ['pull_request']],
  ['true key (YAML 1.1 on)', 'true: push\njobs: { x: { runs-on: u } }\n', ['push']],
  ['mapping after jobs', 'jobs: { x: { runs-on: u } }\non:\n  merge_group: {}\n', ['merge_group']],
  ['review event', 'on: [pull_request_review]\njobs: { x: { runs-on: u } }\n', ['pull_request_review']],
  ['anchor and alias', 'x-ev: &ev pull_request\non: [*ev]\njobs: { x: { runs-on: u } }\n', ['pull_request']],
  ['gate callers stay allowed', 'on: [pull_request_target, issue_comment]\njobs: { x: { runs-on: u } }\n', []],
  ['reusable and scheduled stay allowed', 'on:\n  workflow_call: { inputs: {} }\n  schedule: [{ cron: "0 5 * * 1" }]\n  workflow_dispatch:\njobs: { x: { runs-on: u } }\n', []],
];
for (const [name, text, found] of strays) {
  test(`trigger check ${found.length ? 'refuses' : 'allows'}: ${name}`, () => {
    assert.deepEqual(strayEvents(text), found);
  });
}

const unreadable: [string, string][] = [
  ['no on key', 'jobs: { x: { runs-on: u } }\n'],
  ['both on and true', 'on: push\ntrue: push\njobs: { x: { runs-on: u } }\n'],
  ['duplicate on key', 'on: workflow_call\non: push\njobs: { x: { runs-on: u } }\n'],
  ['on is a number', 'on: 1\njobs: { x: { runs-on: u } }\n'],
  ['on list with a mapping', 'on: [{ push: {} }]\njobs: { x: { runs-on: u } }\n'],
  ['empty on mapping', 'on: {}\njobs: { x: { runs-on: u } }\n'],
  ['invalid YAML', 'on: [push\njobs: {}\n'],
  ['document is a list', '- on: push\n'],
];
for (const [name, text] of unreadable) {
  test(`trigger check fails closed: ${name}`, () => {
    assert.throws(() => strayEvents(text));
  });
}

// Jobs that a line-based reader missed are plain jobs to the parser.
test('jobs are read in any YAML spelling', () => {
  const wf = workflowOf("on: push\njobs:\n  a: { runs-on: u }\n  'qa-extra':\n    runs-on: u\n  \"b\": { runs-on: u, needs: a }\n  c: &c { runs-on: u }\n  d: *c\n");
  assert.deepEqual(Object.keys(jobsOf(wf)), ['a', 'qa-extra', 'b', 'c', 'd']);
  assert.deepEqual(needsOf(jobsOf(wf)['b']), ['a']);
  const crlf = workflowOf('on: push\r\njobs: # all\r\n  a: # first\r\n    runs-on: u\r\n  b:\r\n    needs:\r\n      - a\r\n');
  assert.deepEqual(Object.keys(jobsOf(crlf)), ['a', 'b']);
  assert.deepEqual(needsOf(jobsOf(crlf)['b']), ['a']);
  assert.throws(() => jobsOf(workflowOf('on: push\njobs:\n  a: { runs-on: u }\n  a: { runs-on: v }\n')));
  assert.throws(() => jobsOf(workflowOf('on: push\njobs:\n\ta: { runs-on: u }\n')));
  assert.throws(() => jobsOf(workflowOf('on: push\njobs:\n  a: run\n')));
});

test('ci-ok is a plain job named ci-ok that runs always over every other job', () => {
  const jobs = jobsOf(workflow);
  assert.ok(isMap(ciOk), 'ci.yml has a ci-ok job');
  assert.equal(ciOk['name'], 'ci-ok');
  assert.ok(ciOk['runs-on'], 'ci-ok runs on a runner');
  assert.equal(ciOk['uses'], undefined, 'ci-ok is not a reusable workflow call');
  assert.ok(['always()', '${{ always() }}'].includes(String(ciOk['if'])), `ci-ok if: ${String(ciOk['if'])}`);
  const env = step?.['env'];
  assert.equal(isMap(env) ? env['NEEDS'] : undefined, '${{ toJSON(needs) }}');
  const others = Object.keys(jobs).filter((j) => j !== 'ci-ok');
  assert.ok(others.length > 0);
  assert.deepEqual([...needsOf(ciOk)].sort(), others.sort());
});

test('ci.yml itself runs on pull requests', () => {
  assert.ok(eventsOf(workflow).includes('pull_request'));
});

// needs cannot see another workflow, so ci.yml is the only one that runs on a
// pull request, push or merge queue.
test('no other workflow runs jobs that ci-ok cannot see', () => {
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f) && f !== 'ci.yml')) {
    assert.deepEqual(strayEvents(readFileSync(new URL(file, dir), 'utf8')), [], file);
  }
});
