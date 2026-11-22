import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRun, markdown, playwrightScenarios, repoShas, statusOf } from './izvjestaj.mjs';

const spec = (projectName, status, results, msg) => ({
  title: 'automatski otvara odgovarajući frontend kroz lokalni edge',
  tests: [{ projectName, status, results: results.map((s) => ({ status: s, error: s === 'failed' ? { message: msg } : undefined })) }],
});
const report = (...specs) => ({ suites: [{ title: 'routing.spec.ts', specs, suites: [] }] });

test('statusOf: only success is PROLAZ, failure and cancelled are PAD, the rest was not run', () => {
  assert.equal(statusOf('success'), 'PROLAZ');
  assert.equal(statusOf('failure'), 'PAD');
  assert.equal(statusOf('cancelled'), 'PAD');
  assert.equal(statusOf('skipped'), 'NIJE POKRENUTO');
  assert.equal(statusOf(''), 'NIJE POKRENUTO');
});

test('playwrightScenarios: one row per project, failures keep the first error line', () => {
  const rows = playwrightScenarios(report(
    spec('chrome-windows', 'expected', ['passed']),
    spec('iphone', 'unexpected', ['failed'], 'Expected 200\nReceived 502'),
    spec('ipad', 'flaky', ['failed', 'passed']),
    spec('x', 'skipped', ['skipped']),
  ));
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [
    ['A01:chrome-windows', 'PROLAZ'], ['A01:iphone', 'PAD'], ['A01:ipad', 'PAD'], ['A01:x', 'NIJE POKRENUTO'],
  ]);
  assert.equal(rows[1].detalj, 'Expected 200');
});

test('buildRun: sveProlazi only when the stack, every device and INT-06 pass', () => {
  const env = { STACK_OUTCOME: 'success', INT07_OUTCOME: 'success', INT06_OUTCOME: 'success' };
  const ok = buildRun({ env, repos: [], playwright: report(spec('a', 'expected', ['passed'])) });
  assert.equal(ok.sveProlazi, true);
  assert.equal(buildRun({ env: { ...env, INT06_OUTCOME: 'failure' }, repos: [], playwright: report(spec('a', 'expected', ['passed'])) }).sveProlazi, false);
  assert.equal(buildRun({ env, repos: [], playwright: report(spec('a', 'unexpected', ['failed'], 'x')) }).sveProlazi, false);
});

test('buildRun: a stack that did not start gives no passing scenario and no JSON report is not a pass', () => {
  const run = buildRun({ env: { STACK_OUTCOME: 'failure', INT07_OUTCOME: '', INT06_OUTCOME: '' }, repos: [], playwright: null });
  assert.deepEqual(run.scenariji.map((s) => s.status), ['PAD', 'NIJE POKRENUTO', 'NIJE POKRENUTO']);
  assert.equal(run.sveProlazi, false);
});

test('buildRun: an empty Playwright report with a green step is not trusted blindly', () => {
  const run = buildRun({ env: { STACK_OUTCOME: 'success', INT07_OUTCOME: 'success', INT06_OUTCOME: 'success' }, repos: [], playwright: { suites: [] } });
  assert.equal(run.scenariji.find((s) => s.id === 'A01').status, 'PAD');
  assert.equal(run.sveProlazi, false);
});

test('repoShas and markdown list every repo with its SHA', () => {
  const repos = repoShas('/x', { REF_WEB_OTHER: 'migracija/nextjs', GITHUB_REF_NAME: 'b' }, (cwd) => {
    if (cwd.endsWith('Web_other')) throw new Error('no checkout');
    return 'a'.repeat(40);
  });
  assert.equal(repos.length, 7);
  assert.equal(repos.find((r) => r.repo === 'Web_other').sha, 'nepoznato');
  const text = markdown({ runUrl: 'u', repoi: repos, scenariji: [{ id: 'A|1', naziv: 'n', status: 'PAD', detalj: 'a|b' }] });
  assert.match(text, /\| A\\\|1 \| n \| PAD \| a\\\|b \|/);
  assert.match(text, /\| Preloader \| b \| `a{40}` \|/);
});
