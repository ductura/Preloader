// DAN-1096: every claim of the recovery lab passes on a good run and fails
// when the one thing it checks breaks (docs/lab-oporavak.md).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Observed, claims, preloaderSha, report, sha256Hex } from '../scripts/lab/claims.ts';
import { jcs, publicKeyFromSeed } from '../scripts/lab/receipt.ts';

const sentence = 'Izmišljena rečenica laboratorija 0000.';
const bytes = Buffer.from(`{"text":"${sentence}"}`, 'utf8');
const hash = sha256Hex(bytes);
const open = (body: Record<string, unknown>) => ({ status: 200, body });

// An invented stack key; the receipt of each run is signed with it for real.
const seed = Buffer.alloc(32, 7);
const stackKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const trust = { keyBase64Url: publicKeyFromSeed(seed), keyId: 'dev-ed25519-lab', keyVersion: 'spki-sha256-lab', evidenceDomainId: 'd21fe0a3-103c-42e5-a29e-c102f9030af5' };
const expected = { documentId: 'd-1', clientTransactionId: 'lab-0001', revision: 1, principalId: '72cd1705-85fc-4754-a382-c2500d038368', segmentHash: 'a'.repeat(64) };

function receipt(change: Record<string, unknown> = {}, key = stackKey) {
  const payload = {
    receiptSchema: 'ductus-evidence-receipt-v2', receiptId: 'r-1', evidencePackageId: 'e-1', sessionId: 's-1', segmentId: 'g-1',
    predecessorSegmentHash: null, previousReceiptId: null, evidenceSchema: 'ductus-evidence-segment-v2', evidenceProfileId: 'basic',
    sequenceFrom: 1, sequenceTo: 1, eventCount: 1, payloadBytes: 100, acceptedAt: '2026-11-18T10:00:00.000Z',
    evidenceDomainId: trust.evidenceDomainId, ...expected, ...change,
  };
  const digest = createHash('sha256').update(jcs(payload)).digest();
  const sig = sign(null, Buffer.concat([Buffer.from('ductus-evidence-receipt-v2\n'), digest]), key).toString('base64url');
  const signature = { algorithm: 'Ed25519', keyId: trust.keyId, keyVersion: trust.keyVersion, signatureEncoding: 'raw', signatureBase64Url: sig };
  return { status: 'signed', signedReceipt: { payload, payloadDigestSha256: digest.toString('hex'), signature } };
}
const committed = (r: unknown) => ({ status: 200, body: { status: 'committed', revision: 1, receipt: r } });

function good(): Observed {
  return {
    sentence,
    sent: bytes,
    firstOpen: open({ documentId: 'd-1', currentRevision: 0 }),
    commit: committed(receipt()),
    trust,
    expected,
    healthBetween: 'refused',
    pidBefore: 100,
    pidAfter: 200,
    secondOpen: open({ documentId: 'd-1', currentRevision: 1, documentHash: hash, document: bytes.toString('base64') }),
  };
}

const failing = (o: Observed) => claims(o).filter((c) => !c.pass).map((c) => c.id);
const other = Buffer.from(`{"text":"Drugi tekst."}`, 'utf8');
const padded = Buffer.from(`{"text":"${sentence}"} `, 'utf8');
const urlish = Buffer.from(`{"text":"${sentence}"}?>`, 'utf8');

const cases: [string, (o: Observed) => Observed, string[]][] = [
  ['commit refused', (o) => ({ ...o, commit: { status: 409, body: { status: 'stale_base' } } }), ['L-1']],
  ['receipt pending', (o) => ({ ...o, commit: committed({ status: 'pending_signature' }) }), ['L-1']],
  ['receipt says signed but carries no signature', (o) => ({ ...o, commit: committed({ status: 'signed' }) }), ['L-1']],
  ['receipt signed by another key', (o) => ({ ...o, commit: committed(receipt({}, generateKeyPairSync('ed25519').privateKey)) }), ['L-1']],
  ['receipt of another transaction', (o) => ({ ...o, commit: committed(receipt({ clientTransactionId: 'lab-0002' })) }), ['L-1']],
  ['receipt of another revision', (o) => ({ ...o, commit: committed(receipt({ revision: 2 })) }), ['L-1']],
  ['commit is a duplicate', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, status: 'duplicate' } } }), ['L-1']],
  ['commit wrote another revision', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, revision: 2 } } }), ['L-1']],
  ['commit body is null', (o) => ({ ...o, commit: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-1']],
  ['commit is not 200', (o) => ({ ...o, commit: { ...o.commit!, status: 201 } }), ['L-1']],
  ['no stack key', (o) => ({ ...o, trust: null }), ['L-1']],
  ['no expected commit', (o) => ({ ...o, expected: null }), ['L-1']],
  ['port still open between', (o) => ({ ...o, healthBetween: 'open' }), ['L-2']],
  ['port unknown between', (o) => ({ ...o, healthBetween: 'unknown' }), ['L-2']],
  ['port not probed', (o) => ({ ...o, healthBetween: null }), ['L-2']],
  ['same pid', (o) => ({ ...o, pidAfter: 100 }), ['L-2']],
  ['no pid', (o) => ({ ...o, pidBefore: null }), ['L-2']],
  ['first open has no documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }) }), ['L-3']],
  ['neither open has a documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }), secondOpen: open({ ...o.secondOpen!.body, documentId: undefined }) }), ['L-3']],
  ['other document', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentId: 'd-2' }) }), ['L-3']],
  ['revision 0', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, currentRevision: 0 }) }), ['L-4']],
  ['server hash differs', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentHash: '0'.repeat(64) }) }), ['L-6']],
  // L-5 one condition at a time: same bytes without the sentence, then the sentence in other bytes.
  ['the sentence is not in the same bytes', (o) => ({ ...o, sentence: 'Rečenica koje nema.' }), ['L-5']],
  ['the sentence is in other bytes', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: padded.toString('base64'), documentHash: sha256Hex(padded) }) }), ['L-5', 'L-6']],
  ['other text back', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: other.toString('base64'), documentHash: sha256Hex(other) }) }), ['L-5', 'L-6']],
  ['the document has junk after its padding', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: `${bytes.toString('base64')}@@ ne` }) }), ['L-5', 'L-6']],
  ['the document has line breaks', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: bytes.toString('base64').replace(/(.{8})/g, '$1\r\n') }) }), ['L-5', 'L-6']],
  // A document whose standard base64 has '+', '/' or padding, so the url spelling differs.
  ['the document is base64url', (o) => ({ ...o, sent: urlish, secondOpen: open({ ...o.secondOpen!.body, documentHash: sha256Hex(urlish), document: urlish.toString('base64url') }) }), ['L-5', 'L-6']],
  ['second open is 201', (o) => ({ ...o, secondOpen: { ...o.secondOpen!, status: 201 } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open body is null', (o) => ({ ...o, secondOpen: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open refused', (o) => ({ ...o, secondOpen: { status: 409, body: { status: 'not_started' } } }), ['L-3', 'L-4', 'L-5', 'L-6']],
];

test('a good run passes every claim', () => {
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(claims(good()).map((c) => c.id), ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6']);
});

for (const [name, change, want] of cases) {
  test(`fails exactly ${want.join(', ')} when ${name}`, () => {
    assert.deepEqual(failing(change(good())), want);
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
  assert.equal(report({ ...good(), secondOpen: { status: 200, body: null as unknown as Record<string, unknown> } }, meta).documentId, null);
  assert.equal(report({ ...good(), pidAfter: 100 }, meta).result, 'FAIL');
});

// Review finding 3, QA finding 5: the report names the code that ran, never a SHA it was told.
test('the preloader SHA is the checked-out HEAD, and a named SHA must be it', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(preloaderSha(`${head}\n`, undefined), { sha: head, error: null });
  assert.deepEqual(preloaderSha(`${head}\n`, ''), { sha: head, error: null });
  assert.deepEqual(preloaderSha(`${head}\n`, head), { sha: head, error: null });
  assert.match(preloaderSha(`${head}\n`, 'd'.repeat(40)).error ?? '', /nije izvršeni HEAD/);
  for (const bad of [null, '', head, `${head}\r\n`, `${head.toUpperCase()}\n`, `${head}\n\n`, ` ${head}\n`, `${head} \n`]) {
    assert.deepEqual(preloaderSha(bad, undefined), { sha: null, error: 'HEAD preloadera nije čitljiv' }, JSON.stringify(bad));
  }
});

// Review finding 4: the report is the file; stdout carries no JSON to parse.
test('pnpm lab:oporavak writes the report file and exits 1 on a failed run', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'lab-')), 'report.json');
  const env: Record<string, string | undefined> = { ...process.env, LAB_REPORT: out };
  delete env['SERVER_DIR'];
  delete env['LAB_PRELOADER_SHA'];
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const run = spawnSync('pnpm', ['lab:oporavak'], { cwd, env, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(run.status, 1, run.stderr);
  const file = JSON.parse(readFileSync(out, 'utf8')) as { result: string; error: string; claims: unknown[] };
  assert.equal(file.result, 'FAIL');
  // SERVER_DIR, or HEAD where the checkout has no readable git: a failed run either way.
  assert.match(file.error, /^(SERVER_DIR nije zadan|HEAD preloadera nije čitljiv)$/);
  assert.equal(file.claims.length, 6);
  assert.match(run.stdout, /^lab:oporavak FAIL /m);
  assert.doesNotMatch(run.stdout, /[{}]/);
});
