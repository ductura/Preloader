// DAN-1096 L-1: a receipt counts only with a signature verified under the
// stack's key over exactly the lab's commit (review and QA finding 1 on
// 3e05a73b: status 'signed' alone passed). The contract vector is the
// server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032
// test 1, whose public seed lets each case below be signed for real.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { type ReceiptExpectation, type ReceiptTrust, checkReceipt, jcs, publicKeyFromSeed, registryRow } from '../scripts/lab/receipt.ts';

type Golden = {
  verificationKey: { keyId: string; keyVersion: string; spkiDerHex: string; signingSeedSha256: string };
  accepted: { payload: Record<string, unknown>; canonical: string; payloadDigestSha256: string; signature: Record<string, unknown> };
};
const golden = JSON.parse(readFileSync(new URL('fixtures/receipt-v2-golden.json', import.meta.url), 'utf8')) as Golden;
const SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const testKey = createPrivateKey({ key: Buffer.concat([PKCS8, SEED]), format: 'der', type: 'pkcs8' });
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const p = golden.accepted.payload;
const trust: ReceiptTrust = {
  keyBase64Url: Buffer.from(golden.verificationKey.spkiDerHex, 'hex').toString('base64url'),
  keyId: golden.verificationKey.keyId,
  keyVersion: golden.verificationKey.keyVersion,
  evidenceDomainId: p['evidenceDomainId'] as string,
};
const expected: ReceiptExpectation = {
  documentId: p['documentId'] as string,
  clientTransactionId: p['clientTransactionId'] as string,
  revision: p['revision'] as number,
  principalId: p['principalId'] as string,
  segmentHash: p['segmentHash'] as string,
};

/** A receipt as the server signs it (D-92), over `payload`, with `key`. */
function signed(payload: Record<string, unknown>, key = testKey) {
  const digest = createHash('sha256').update(jcs(payload), 'utf8').digest();
  const sig = sign(null, Buffer.concat([Buffer.from('ductus-evidence-receipt-v2\n'), digest]), key);
  return {
    status: 'signed',
    signedReceipt: {
      payload,
      payloadDigestSha256: digest.toString('hex'),
      signature: { ...golden.accepted.signature, signatureBase64Url: sig.toString('base64url') },
    },
  };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const vector = () => ({ status: 'signed', signedReceipt: clone({ payload: p, payloadDigestSha256: golden.accepted.payloadDigestSha256, signature: golden.accepted.signature }) });
const withSig = (r: ReturnType<typeof vector>, s: string) => ({ ...r, signedReceipt: { ...r.signedReceipt, signature: { ...r.signedReceipt.signature, signatureBase64Url: s } } });

test('the vendored vector is the RFC 8032 key and the canonical text of the server', () => {
  assert.equal(publicKeyFromSeed(SEED), trust.keyBase64Url);
  assert.equal(createHash('sha256').update(SEED).digest('hex'), golden.verificationKey.signingSeedSha256);
  assert.equal(jcs(p), golden.accepted.canonical);
  assert.throws(() => publicKeyFromSeed(SEED.subarray(1)));
});

test("the server's signed receipt verifies", () => {
  assert.equal(checkReceipt(vector(), trust, expected), null);
  assert.equal(checkReceipt(signed(clone(p)), trust, expected), null);
});

const sigBytes = Buffer.from(golden.accepted.signature['signatureBase64Url'] as string, 'base64url');
const bigS = Buffer.from(sigBytes);
// S + L: the same signature in a second spelling (S is little-endian).
bigS.set(Buffer.from((BigInt(`0x${Buffer.from(sigBytes.subarray(32)).reverse().toString('hex')}`) + L).toString(16).padStart(64, '0'), 'hex').reverse(), 32);
const other = generateKeyPairSync('ed25519').privateKey;
const inherited = Object.assign(Object.create({ revision: 7 }) as Record<string, unknown>, clone(p));
delete inherited['revision'];

const refused: [string, unknown, ReceiptTrust?][] = [
  ['status signed without a signature', { status: 'signed' }],
  ['pending signature', { status: 'pending_signature' }],
  ['no receipt', undefined],
  ['a receipt as text', JSON.stringify(vector())],
  ['an extra field next to the receipt', { ...vector(), note: 'x' }],
  ['an extra field in the envelope', { ...vector(), signedReceipt: { ...vector().signedReceipt, extra: 1 } }],
  ['an extra field in the signature', { ...vector(), signedReceipt: { ...vector().signedReceipt, signature: { ...golden.accepted.signature, x: 1 } } }],
  ['an own __proto__ in the payload', signed(JSON.parse(JSON.stringify(p).replace('{', '{"__proto__":{"a":1},')) as Record<string, unknown>)],
  ['an own toString in the payload', signed({ ...clone(p), toString: 'x' })],
  ['an inherited field', { ...vector(), signedReceipt: { ...vector().signedReceipt, payload: inherited } }],
  ['a field missing', signed(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'previousReceiptId')))],
  ['a wrong digest field next to a good signature', (() => { const r = vector(); r.signedReceipt.payloadDigestSha256 = 'f'.repeat(64); return r; })()],
  ['a payload changed after signing', (() => { const r = vector(); r.signedReceipt.payload['payloadBytes'] = 124; return r; })()],
  ['a digest made again for a changed payload', (() => { const r = signed({ ...clone(p), payloadBytes: 124 }); r.signedReceipt.signature = clone(golden.accepted.signature) as typeof r.signedReceipt.signature; return r; })()],
  ['another key under the same label', signed(clone(p), other)],
  ['the full canonical bytes signed instead of D-92', withSig(vector(), sign(null, Buffer.from(golden.accepted.canonical), testKey).toString('base64url'))],
  ['another key id', { ...vector(), signedReceipt: { ...vector().signedReceipt, signature: { ...golden.accepted.signature, keyId: 'drugi' } } }],
  ['another key version', { ...vector(), signedReceipt: { ...vector().signedReceipt, signature: { ...golden.accepted.signature, keyVersion: '2' } } }],
  ['another algorithm', { ...vector(), signedReceipt: { ...vector().signedReceipt, signature: { ...golden.accepted.signature, algorithm: 'ECDSA_P256_SHA256' } } }],
  ['another encoding', { ...vector(), signedReceipt: { ...vector().signedReceipt, signature: { ...golden.accepted.signature, signatureEncoding: 'der' } } }],
  ['padded base64', withSig(vector(), `${sigBytes.toString('base64url')}==`)],
  ['standard base64', withSig(vector(), sigBytes.toString('base64'))],
  ['a short signature', withSig(vector(), sigBytes.subarray(1).toString('base64url'))],
  ['S at or above the group order', withSig(vector(), bigS.toString('base64url'))],
  ['a fractional number', (() => { const r = vector(); r.signedReceipt.payload['payloadBytes'] = 123.5; return r; })()],
  ['another document', signed({ ...clone(p), documentId: 'doc-2' })],
  ['another transaction', signed({ ...clone(p), clientTransactionId: 'tx-š-2' })],
  ['another revision', signed({ ...clone(p), revision: 6 })],
  ['another student', signed({ ...clone(p), principalId: '6f1c2b7e-0d4a-4c3b-9a8e-1b2c3d4e5f60' })],
  ['another segment', signed({ ...clone(p), segmentHash: 'b'.repeat(64) })],
  ['receipt v1', signed({ ...clone(p), receiptSchema: 'ductus-evidence-receipt-v1' })],
  ['CRLF after the transaction', signed({ ...clone(p), clientTransactionId: `${expected.clientTransactionId}\r\n` })],
  ['a tab in the transaction', signed({ ...clone(p), clientTransactionId: `\t${expected.clientTransactionId}` })],
  ['NBSP after the transaction', signed({ ...clone(p), clientTransactionId: `${expected.clientTransactionId} ` })],
  ['DEL after the transaction', signed({ ...clone(p), clientTransactionId: `${expected.clientTransactionId}\u007f` })],
  ['another evidence domain', vector(), { ...trust, evidenceDomainId: '0b5e6c1a-7d2f-4e3a-8b9c-0d1e2f3a4b5c' }],
  ['a trusted key that is not Ed25519', vector(), { ...trust, keyBase64Url: Buffer.from(`ff${golden.verificationKey.spkiDerHex.slice(2)}`, 'hex').toString('base64url') }],
];

for (const [name, receipt, t] of refused) {
  test(`refuses ${name}`, () => {
    assert.notEqual(checkReceipt(receipt, t ?? trust, expected), null);
  });
}

test('the registry holds exactly one active receipt key in the domain, and it is the seed key', () => {
  const row = 'dev-ed25519-0011|spki-sha256-00ff|d21fe0a3-103c-42e5-a29e-c102f9030af5|t';
  const otherKey = 'dev-ed25519-0022|spki-sha256-00ee|d21fe0a3-103c-42e5-a29e-c102f9030af5|f';
  assert.deepEqual(registryRow(`${row}\n`), { keyId: 'dev-ed25519-0011', keyVersion: 'spki-sha256-00ff', evidenceDomainId: 'd21fe0a3-103c-42e5-a29e-c102f9030af5' });
  const bad = [
    '', '\n', `${row}\n${row}\n`, `${row}\n${otherKey}\n`, `${otherKey}\n`, row.replace('|t', '|true'), row.replace('|t', ''),
    `${row}\r\n`, row.replace('|', '\t|'), row.replace('0011', '00 11'), row.replace('0011', '00\u007f11'), `${row}|x`, row.replace('42e5', '12e5'),
  ];
  for (const b of bad) assert.equal(registryRow(b), null, JSON.stringify(b));
});
