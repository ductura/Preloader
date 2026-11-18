// DAN-1096: the lab-oporavak CI job runs the PR head it reports (review
// finding 3, QA finding 5, Codex thread on ci.yml:68), pins the PGDG key file
// to one key (QA finding 4) and checks the vendored receipt vector against
// the server at SERVER_SHA.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { vendoredProblem } from '../scripts/lab/vendored.ts';

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, unknown> };
const ci = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as {
  jobs: Record<string, { env?: Record<string, string>; steps: Step[] }>;
};
const job = ci.jobs['lab-oporavak']!;
const fixture = JSON.parse(readFileSync(new URL('fixtures/receipt-v2-golden.json', import.meta.url), 'utf8')) as Parameters<typeof vendoredProblem>[1];
const HEAD = '${{ github.event.pull_request.head.sha || github.sha }}';

test('the lab checks out the PR head and reports that same SHA', () => {
  const own = job.steps.filter((s) => s.uses?.startsWith('actions/checkout@') && s.with?.['repository'] === undefined);
  assert.equal(own.length, 1);
  assert.equal(own[0]!.with?.['ref'], HEAD);
  const lab = job.steps.find((s) => s.run?.includes('pnpm lab:oporavak'));
  assert.equal(lab?.env?.['LAB_PRELOADER_SHA'], HEAD);
});

test('the PGDG key file is checked by pgdg-key.ts, not by a grep for one line', () => {
  const pgdg = job.steps.find((s) => s.name === 'Install PostgreSQL 17 (PGDG)')?.run ?? '';
  assert.match(pgdg, /gpg --show-keys --with-colons "\$RUNNER_TEMP\/pgdg\.asc" \| node scripts\/ci\/pgdg-key\.ts "\$PGDG_KEY_FINGERPRINT" &&/);
  assert.doesNotMatch(pgdg, /grep/);
});

test('the vendored vector is checked against the server before the lab runs', () => {
  const at = job.steps.findIndex((s) => s.run === 'node scripts/lab/vendored.ts server-src test/fixtures/receipt-v2-golden.json');
  assert.ok(at >= 0 && at < job.steps.findIndex((s) => s.run?.includes('pnpm lab:oporavak')));
  assert.equal(fixture.source.commit, job.env?.['SERVER_SHA']);
});

test('the vendored check refuses any drift from its source', () => {
  const doc = { chain: { verificationKey: fixture.verificationKey }, receiptV2: { accepted: [fixture.accepted, { name: 'edges' }] } };
  const source = Buffer.from(JSON.stringify(doc));
  const blob = createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex');
  const sha = fixture.source.commit;
  const own = { ...fixture, source: { ...fixture.source, blob } };
  assert.equal(vendoredProblem(source, own, sha), null);
  const changed = JSON.parse(JSON.stringify(own)) as typeof own;
  (changed.accepted as { payload: { revision: number } }).payload.revision = 8;
  assert.notEqual(vendoredProblem(source, changed, sha), null);
  assert.notEqual(vendoredProblem(source, { ...own, accepted: { ...(own.accepted as object), extra: 1 } }, sha), null);
  assert.notEqual(vendoredProblem(source, { ...own, verificationKey: { ...(own.verificationKey as object), keyId: 'x' } }, sha), null);
  assert.notEqual(vendoredProblem(Buffer.concat([source, Buffer.from('\n')]), own, sha), null);
  assert.notEqual(vendoredProblem(source, own, 'f'.repeat(40)), null);
  assert.notEqual(vendoredProblem(source, { ...own, source: { ...own.source, path: 'server/domain/forensics/golden-vectors/evidence-v3.json' } }, sha), null);
});
