// DAN-1096: every claim of the recovery lab passes on a good run and fails
// when the one thing it checks breaks (docs/lab-oporavak.md).
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { type Observed, claims, report, sha256Hex } from '../scripts/lab/claims.ts';

const sentence = 'Izmišljena rečenica laboratorija 0000.';
const bytes = Buffer.from(`{"text":"${sentence}"}`, 'utf8');
const hash = sha256Hex(bytes);
const open = (body: Record<string, unknown>) => ({ status: 200, body });

function good(): Observed {
  return {
    sentence,
    sent: bytes,
    firstOpen: open({ documentId: 'd-1', currentRevision: 0 }),
    commit: { status: 200, body: { status: 'committed', revision: 1, receipt: { status: 'signed' } } },
    healthBetween: false,
    pidBefore: 100,
    pidAfter: 200,
    secondOpen: open({ documentId: 'd-1', currentRevision: 1, documentHash: hash, document: bytes.toString('base64') }),
  };
}

const failing = (o: Observed) => claims(o).filter((c) => !c.pass).map((c) => c.id);
const other = Buffer.from(`{"text":"Drugi tekst."}`, 'utf8');

const cases: [string, (o: Observed) => Observed, string[]][] = [
  ['commit refused', (o) => ({ ...o, commit: { status: 409, body: { status: 'stale_base' } } }), ['L-1']],
  ['receipt pending', (o) => ({ ...o, commit: { status: 200, body: { status: 'committed', revision: 1, receipt: { status: 'pending_signature' } } } }), ['L-1']],
  ['health answered between', (o) => ({ ...o, healthBetween: true }), ['L-2']],
  ['same pid', (o) => ({ ...o, pidAfter: 100 }), ['L-2']],
  ['no pid', (o) => ({ ...o, pidBefore: null }), ['L-2']],
  ['other document', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentId: 'd-2' }) }), ['L-3']],
  ['revision 0', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, currentRevision: 0 }) }), ['L-4']],
  ['server hash differs', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentHash: '0'.repeat(64) }) }), ['L-6']],
  ['other text back', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: other.toString('base64'), documentHash: sha256Hex(other) }) }), ['L-5', 'L-6']],
  ['second open refused', (o) => ({ ...o, secondOpen: { status: 409, body: { status: 'not_started' } } }), ['L-3', 'L-4', 'L-5', 'L-6']],
];

test('a good run passes every claim', () => {
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(claims(good()).map((c) => c.id), ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6']);
});

for (const [name, change, expected] of cases) {
  test(`fails exactly ${expected.join(', ')} when ${name}`, () => {
    assert.deepEqual(failing(change(good())), expected);
  });
}

test('the report is PASS only without an error and with every claim', () => {
  const meta = { preloaderSha: 'a'.repeat(40), serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1', error: null };
  const ok = report(good(), meta);
  assert.equal(ok.result, 'PASS');
  assert.equal(ok.hash, hash);
  assert.equal(ok.revision, 1);
  assert.equal(ok.webSha, null);
  assert.equal(ok.browser, null);
  assert.equal(report(good(), { ...meta, error: 'down nije uspio' }).result, 'FAIL');
  assert.equal(report({ ...good(), pidAfter: 100 }, meta).result, 'FAIL');
});
