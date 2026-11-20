// DAN-1096: every claim of the recovery lab passes on a good run and fails
// when the one thing it checks breaks (docs/lab-oporavak.md).
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { type Observed, type ReceiptCheck, claims, sha256Hex, text } from '../scripts/lab/claims.ts';

const sentence = 'Izmišljena rečenica laboratorija 0000.';
const bytes = Buffer.from(`{"text":"${sentence}"}`, 'utf8');
const hash = sha256Hex(bytes);
const open = (body: Record<string, unknown>) => ({ status: 200, body });

// L-1's receipt check is checkReceipt (receipt.ts, DAN-1096-a1, tested there)
// bound by the run; here a stand-in that holds only for the one good receipt.
const signed = { status: 'signed', signedReceipt: 'potpisano ključem stoga' };
const check: ReceiptCheck = (r) => (r === signed ? null : 'potpis ne odgovara ključu stoga');
const committed = (r: unknown) => ({ status: 200, body: { status: 'committed', revision: 1, receipt: r } });

function good(): Observed {
  return {
    sentence,
    sent: bytes,
    firstOpen: open({ documentId: 'd-1', currentRevision: 0 }),
    commit: committed(signed),
    receipt: check,
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
  ['receipt check says no', (o) => ({ ...o, commit: committed({ ...signed }) }), ['L-1']],
  ['commit is a duplicate', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, status: 'duplicate' } } }), ['L-1']],
  ['commit wrote another revision', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, revision: 2 } } }), ['L-1']],
  ['commit body is null', (o) => ({ ...o, commit: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-1']],
  ['commit is not 200', (o) => ({ ...o, commit: { ...o.commit!, status: 201 } }), ['L-1']],
  ['no receipt check (no stack key or expected commit)', (o) => ({ ...o, receipt: null }), ['L-1']],
  ['port still open between', (o) => ({ ...o, healthBetween: 'open' }), ['L-2']],
  ['port unknown between', (o) => ({ ...o, healthBetween: 'unknown' }), ['L-2']],
  ['port not probed', (o) => ({ ...o, healthBetween: null }), ['L-2']],
  ['same pid', (o) => ({ ...o, pidAfter: 100 }), ['L-2']],
  ['no pid', (o) => ({ ...o, pidBefore: null }), ['L-2']],
  // QA 2 on 55f02977: a new PID is a safe integer above 0, before and after.
  ...[0, -0, -1, NaN, 1.5, Infinity, 2 ** 53, '200', null, undefined, {}, [], JSON.parse('{"toString":null}')].flatMap((pid, i) => [
    [`pid after is bad value ${i} (${text(pid)})`, (o: Observed) => ({ ...o, pidAfter: pid }), ['L-2']],
    [`pid before is bad value ${i} (${text(pid)})`, (o: Observed) => ({ ...o, pidBefore: pid }), ['L-2']],
  ] as [string, (o: Observed) => Observed, string[]][]),
  ['first open has no documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }) }), ['L-3']],
  ['neither open has a documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }), secondOpen: open({ ...o.secondOpen!.body, documentId: undefined }) }), ['L-3']],
  ['other document', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentId: 'd-2' }) }), ['L-3']],
  ['first open is 201 with the same documentId', (o) => ({ ...o, firstOpen: { ...o.firstOpen!, status: 201 } }), ['L-3']],
  ['revision 0', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, currentRevision: 0 }) }), ['L-4']],
  ['server hash differs', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentHash: '0'.repeat(64) }) }), ['L-6']],
  // L-5 one condition at a time: same bytes without the sentence, then the sentence in other bytes.
  ['the sentence is not in the same bytes', (o) => ({ ...o, sentence: 'Rečenica koje nema.' }), ['L-5']],
  ['the sentence is in other bytes', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: padded.toString('base64'), documentHash: sha256Hex(padded) }) }), ['L-5', 'L-6']],
  ['other text back', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: other.toString('base64'), documentHash: sha256Hex(other) }) }), ['L-5', 'L-6']],
  // QA on 7eb1648: urlish has padding ('='), so the junk really comes after it.
  ['the document has junk after its padding', (o) => ({ ...o, sent: urlish, secondOpen: open({ ...o.secondOpen!.body, documentHash: sha256Hex(urlish), document: `${urlish.toString('base64')}@@ ne` }) }), ['L-5', 'L-6']],
  ['the document has line breaks', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: bytes.toString('base64').replace(/(.{8})/g, '$1\r\n') }) }), ['L-5', 'L-6']],
  // A document whose standard base64 has '+', '/' or padding, so the url spelling differs.
  ['the document is base64url', (o) => ({ ...o, sent: urlish, secondOpen: open({ ...o.secondOpen!.body, documentHash: sha256Hex(urlish), document: urlish.toString('base64url') }) }), ['L-5', 'L-6']],
  ['second open is 201', (o) => ({ ...o, secondOpen: { ...o.secondOpen!, status: 201 } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open body is null', (o) => ({ ...o, secondOpen: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open refused', (o) => ({ ...o, secondOpen: { status: 409, body: { status: 'not_started' } } }), ['L-3', 'L-4', 'L-5', 'L-6']],
];

test('a good run passes every claim', () => {
  assert.deepEqual(failing(good()), []);
  // SHA-256 of the good bytes, worked out apart from sha256Hex (review/QA on 7eb1648).
  assert.equal(hash, '0e7bf765ae0b6c8e7ceb535e87ffe5f0dadfad122b6f127ecf8510e8df39885a');
  assert.match(urlish.toString('base64'), /=$/);
  assert.deepEqual(claims(good()).map((c) => c.id), ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6']);
});

for (const [name, change, want] of cases) {
  test(`fails exactly ${want.join(', ')} when ${name}`, () => {
    assert.deepEqual(failing(change(good())), want);
  });
}

test('text calls nothing on the value', () => {
  assert.equal(text(JSON.parse('{"toString":null,"valueOf":null}')), '[objekt]');
  assert.equal(text(Object.create(null)), '[objekt]');
  let calls = 0;
  assert.deepEqual([text({ toJSON: () => (calls++, 'x') }), calls], ['[objekt]', 0]);
  assert.equal(text([1]), '[niz]');
  assert.deepEqual([text(null), text(undefined), text(NaN), text(-0), text('x')], ['-', '-', 'NaN', '0', 'x']);
});
