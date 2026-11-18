// DAN-1096 L-1: the canonical text (RFC 8785) a receipt v2 is signed over, and
// the key the lab derives from the stack's seed. The contract vector is the
// server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032
// test 1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { type ReceiptExpectation, type ReceiptTrust, checkReceipt, jcs, publicKeyFromSeed } from '../scripts/lab/receipt.ts';

type Golden = {
  verificationKey: { spkiDerHex: string; signingSeedSha256: string };
  accepted: { payload: Record<string, unknown>; canonical: string; payloadDigestSha256: string; signature: Record<string, unknown> & { signatureBase64Url: string } };
};
const golden = JSON.parse(readFileSync(new URL('fixtures/receipt-v2-golden.json', import.meta.url), 'utf8')) as Golden;
const SEED = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');

test('the vendored vector is the RFC 8032 key and the canonical text of the server', () => {
  const spki = Buffer.from(golden.verificationKey.spkiDerHex, 'hex');
  assert.equal(publicKeyFromSeed(SEED), spki.toString('base64url'));
  assert.equal(createHash('sha256').update(SEED).digest('hex'), golden.verificationKey.signingSeedSha256);
  assert.equal(jcs(golden.accepted.payload), golden.accepted.canonical);
  const digest = createHash('sha256').update(golden.accepted.canonical, 'utf8').digest();
  assert.equal(digest.toString('hex'), golden.accepted.payloadDigestSha256);
  // D-92: the signature covers the prefix and the digest, not the canonical text or the digest alone.
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const sig = Buffer.from(golden.accepted.signature.signatureBase64Url, 'base64url');
  assert.equal(verify(null, Buffer.concat([Buffer.from('ductus-evidence-receipt-v2\n'), digest]), key, sig), true);
  assert.equal(verify(null, Buffer.from(golden.accepted.canonical), key, sig), false);
  assert.equal(verify(null, digest, key, sig), false);
});

test('publicKeyFromSeed takes a 32-byte Uint8Array from another realm (review on f9c1458)', () => {
  const foreign = runInNewContext('new Uint8Array(32)') as Uint8Array;
  foreign.set(SEED);
  assert.equal(publicKeyFromSeed(foreign), publicKeyFromSeed(SEED));
});

test.each([new Uint8Array(0), SEED.subarray(1), Buffer.concat([SEED, Buffer.from([0])]), new Uint16Array(16), runInNewContext('new Uint16Array(16)')])(
  'publicKeyFromSeed refuses a seed that is not 32 bytes of Uint8Array (%#)',
  (seed) => {
    assert.throws(() => publicKeyFromSeed(seed as Uint8Array), /^Error: sjeme ključa nema 32 bajta$/);
  },
);

/** `depth` levels: arrays around one innermost object. */
const nest = (depth: number): unknown => {
  let v: unknown = { a: 0 };
  for (let i = 1; i < depth; i += 1) v = [v];
  return v;
};

// RFC 8785: keys in UTF-16 code unit order, -0 as 0, JSON.stringify escapes.
const writes: [string, unknown, string][] = [
  ['keys by UTF-16 units, not code points', { '�': 1, '\u{1F600}': 2 }, '{"\u{1F600}":2,"�":1}'],
  ['two astral keys by their low surrogate', { '\u{1F601}': 1, '\u{1F600}': 2 }, '{"\u{1F600}":2,"\u{1F601}":1}'],
  ['-0 alone', -0, '0'],
  ['-0 in an object and an array', { a: -0, b: [-0] }, '{"a":0,"b":[0]}'],
  ['an own __proto__ key', JSON.parse('{"a":2,"__proto__":1}'), '{"__proto__":1,"a":2}'],
  ['a nested own __proto__ key', JSON.parse('{"x":{"__proto__":{"y":1}}}'), '{"x":{"__proto__":{"y":1}}}'],
  ['an object without a prototype', Object.assign(Object.create(null) as object, { b: 1, a: [] }), '{"a":[],"b":1}'],
  ['an own toJSON key, never called', { toJSON: 'x', a: 1 }, '{"a":1,"toJSON":"x"}'],
  ['a shared, not cyclic, value', (() => { const x = { y: 1 }; return { p: x, q: [x] }; })(), '{"p":{"y":1},"q":[{"y":1}]}'],
  ['64 levels of nesting', nest(64), `${'['.repeat(63)}{"a":0}${']'.repeat(63)}`],
  ['control and blank characters', { 'k\r\n\t\u001f\u007f  ': 'v\r\n\t\u001f\u007f  ' },
    '{"k\\r\\n\\t\\u001f\u007f  ":"v\\r\\n\\t\\u001f\u007f  "}'],
];
test.each(writes)('jcs writes RFC 8785: %s', (_name, value, expected) => {
  assert.equal(jcs(value), expected);
});

const sparse = [1, , 2];
const trailing = [1];
trailing.length = 3;
const extra = Object.assign([1, 2], { x: 3 });
const gotten = [1, 2];
Object.defineProperty(gotten, 0, { get: () => 5, enumerable: true });
class Sub extends Array<number> {}
const nullArray = Object.setPrototypeOf([1], null) as unknown;
const cycle: Record<string, unknown> = {};
cycle['self'] = cycle;
const revoked = Proxy.revocable({}, {});
revoked.revoke();
const getterObject = Object.defineProperty({}, 'a', { get: () => 1, enumerable: true });
const refused: [string, unknown][] = [
  ['a sparse array', sparse],
  ['an array with trailing holes', trailing],
  ['new Array(3)', new Array(3)],
  ['an array with an extra property', extra],
  // Codex on ab90df4: an extra key must not make up for a hole.
  ['a hole made up for by an extra key', Object.assign([1, , 2], { x: 3 })],
  ['a hole made up for by a symbol key', Object.assign([1, , 2], { [Symbol('x')]: 3 })],
  ['a proxy of an array', new Proxy([1, 2], {})],
  ['a getter on an array element', gotten],
  ['an Array subclass', Sub.from([1])],
  ['an array without a prototype', nullArray],
  ['a cycle', cycle],
  ['a proxy of an object', new Proxy({ a: 1 }, {})],
  ['a revoked proxy', revoked.proxy],
  ['a getter on an object', getterObject],
  ['an object with another prototype', { __proto__: { a: 1 }, b: 2 }],
  ['new String', new String('x')],
  ['new Number', new Number(1)],
  ['a Date', new Date(0)],
  ['a Map', new Map()],
  ['1.5', 1.5],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['2 ** 53', 2 ** 53],
  ['a bigint', 1n],
  ['undefined', undefined],
  ['a function', () => 1],
  ['a symbol', Symbol('x')],
  ['undefined in an object', { a: undefined }],
  // QA self-check on ce6a78b.
  ['65 levels of nesting', nest(65)],
  ['an array iterator nested in an object', { a: [Object.setPrototypeOf([1][Symbol.iterator](), Object.prototype) as unknown] }],
  ['a symbol key', { a: 1, [Symbol('x')]: 2 }],
  ['a hidden key', Object.defineProperty({ a: 1 }, 'b', { value: 2 })],
  ['a hidden array element', Object.defineProperty([1, 2], 1, { value: 2, enumerable: false })],
  ...[new Map([['a', 1]]), new Set([1]), new WeakMap(), new Date(5), new Number(7), new Boolean(true), new String('x'),
    new ArrayBuffer(2), new DataView(new ArrayBuffer(2)), new Uint8Array([1, 2]), /x/, new Error('x'), Promise.resolve(),
    (function* g() {})(), new Map().entries(),
    // Review on f9c1458: the class is any built-in, so iterators no list names are refused too.
    [1][Symbol.iterator](), 'ab'[Symbol.iterator](), 'a'.matchAll(/a/g), new WeakRef({}), new FinalizationRegistry(() => {})].map((v): [string, unknown] => [
    `a ${Object.prototype.toString.call(v)} with a plain prototype`, Object.setPrototypeOf(v, Object.prototype) as unknown]),
];
test.each(refused)('jcs refuses %s', (_name, value) => {
  assert.throws(() => jcs(value), /^Error: jcs: /);
});

// DAN-1096-a1-2 L-1: checkReceipt. Each row changes one field of the server's
// receipt, trust or expectation and names the exact reason (QA c.6983718141 t. 2);
// key-label rows change trust and the unsigned label in the signature together.
type Rec = { status: string; signedReceipt: { payload: Record<string, unknown>; payloadDigestSha256: string; signature: Record<string, unknown> } };
const p = golden.accepted.payload;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const vector = (): Rec => clone({ status: 'signed', signedReceipt: { payload: p, payloadDigestSha256: golden.accepted.payloadDigestSha256, signature: golden.accepted.signature } });
const trust: ReceiptTrust = {
  keyBase64Url: Buffer.from(golden.verificationKey.spkiDerHex, 'hex').toString('base64url'),
  keyId: golden.accepted.signature['keyId'] as string, keyVersion: golden.accepted.signature['keyVersion'] as string,
  evidenceDomainId: p['evidenceDomainId'] as string,
};
const expected: ReceiptExpectation = {
  documentId: p['documentId'] as string, clientTransactionId: p['clientTransactionId'] as string, revision: p['revision'] as number,
  principalId: p['principalId'] as string, segmentHash: p['segmentHash'] as string,
};
const testKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), SEED]), format: 'der', type: 'pkcs8' });
/** The vector with `change` applied to the payload, signed again as the server signs (D-92). */
function signed(change: Record<string, unknown>, key = testKey): Rec {
  const r = vector();
  Object.assign(r.signedReceipt.payload, change);
  const digest = createHash('sha256').update(jcs(r.signedReceipt.payload), 'utf8').digest();
  r.signedReceipt.payloadDigestSha256 = digest.toString('hex');
  r.signedReceipt.signature['signatureBase64Url'] = sign(null, Buffer.concat([Buffer.from('ductus-evidence-receipt-v2\n'), digest]), key).toString('base64url');
  return r;
}
const at = (f: (r: Rec) => void): Rec => { const r = vector(); f(r); return r; };
const sigAs = (s: Buffer | string) => at((r) => { r.signedReceipt.signature['signatureBase64Url'] = typeof s === 'string' ? s : s.toString('base64url'); });
const label = (field: 'keyId' | 'keyVersion', value: string) => at((r) => { r.signedReceipt.signature[field] = value; });
const sig = Buffer.from(golden.accepted.signature.signatureBase64Url, 'base64url');
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const bigS = Buffer.from(sig);
bigS.set(Buffer.from((BigInt(`0x${Buffer.from(sig.subarray(32)).reverse().toString('hex')}`) + L).toString(16).padStart(64, '0'), 'hex').reverse(), 32);
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** The base64url digit that differs from `c` only in its lowest bit: the same bytes when that bit is unused. */
const twin = (c: string) => B64[B64.indexOf(c) ^ 1]!;
const CTRL: [string, string][] = [['CRLF', '\r\n'], ['a tab', '\t'], ['NBSP', '\u00a0'], ['DEL', '\u007f']];
const NOT_SIGNED = 'potvrda nije potpisana';
const SHAPE = 'potpisana potvrda nema oblik v2';
const lab = (field: string) => `laboratorij nema ispravan ključ stoga ili commit (${field})`;
const { documentId: _d, ...noDocument } = expected;
const rows: [string, unknown, ReceiptTrust, unknown, string | null][] = [
  ["the server's receipt", vector(), trust, expected, null],
  ['a payload without a prototype', at((r) => { r.signedReceipt.payload = Object.assign(Object.create(null) as object, r.signedReceipt.payload); }), trust, expected, null],
  ['no receipt', undefined, trust, expected, NOT_SIGNED],
  ['a receipt as text', JSON.stringify(vector()), trust, expected, NOT_SIGNED],
  ['a pending receipt', at((r) => { r.status = 'pending_signature'; }), trust, expected, NOT_SIGNED],
  ['an extra envelope field', { ...vector(), note: 1 }, trust, expected, NOT_SIGNED],
  ['a proxy envelope', new Proxy(vector(), {}), trust, expected, NOT_SIGNED],
  ['a revoked proxy', revoked.proxy, trust, expected, NOT_SIGNED],
  ['an extra signedReceipt field', at((r) => { Object.assign(r.signedReceipt, { x: 1 }); }), trust, expected, SHAPE],
  ['no signature', at((r) => { delete (r.signedReceipt as Partial<Rec['signedReceipt']>).signature; }), trust, expected, SHAPE],
  ['an inherited signedReceipt field', at((r) => { const { signature, ...rest } = r.signedReceipt; r.signedReceipt = Object.assign(Object.create({ signature }) as Rec['signedReceipt'], rest); }), trust, expected, SHAPE],
  ['a getter on signedReceipt', at((r) => { Object.defineProperty(r.signedReceipt, 'payloadDigestSha256', { get: () => { throw new Error('x'); }, enumerable: true }); }), trust, expected, SHAPE],
  ['a proxy signedReceipt', at((r) => { r.signedReceipt = new Proxy(r.signedReceipt, {}); }), trust, expected, SHAPE],
  ['a proxy signature', at((r) => { r.signedReceipt.signature = new Proxy(r.signedReceipt.signature, {}); }), trust, expected, SHAPE],
  // QA self-check on 1224784: the signature's own shape, field by field.
  ['an extra signature field', at((r) => { r.signedReceipt.signature['extra'] = 1; }), trust, expected, SHAPE],
  ['a signature field missing', at((r) => { delete r.signedReceipt.signature['signatureEncoding']; }), trust, expected, SHAPE],
  ['a hidden signature field', at((r) => { Object.defineProperty(r.signedReceipt.signature, 'keyId', { enumerable: false }); }), trust, expected, SHAPE],
  ['a key id that is a number', label('keyId', 5 as unknown as string), trust, expected, SHAPE],
  ['an algorithm in an array', at((r) => { r.signedReceipt.signature['algorithm'] = ['Ed25519']; }), trust, expected, SHAPE],
  ['a digest that is a number', at((r) => { (r.signedReceipt as Record<string, unknown>)['payloadDigestSha256'] = 1; }), trust, expected, SHAPE],
  ['a built-in envelope with the receipt fields', Object.assign(Object.setPrototypeOf(new Date(0), Object.prototype) as object, vector()), trust, expected, NOT_SIGNED],
  ...Object.keys(p).map((k): [string, unknown, ReceiptTrust, unknown, string] => [`payload ${k} of the wrong type`, at((r) => { r.signedReceipt.payload[k] = false; }), trust, expected, `${SHAPE} (${k})`]),
  ['an extra payload field', signed({ extra: 1 }), trust, expected, SHAPE],
  ['a payload field missing', at((r) => { delete r.signedReceipt.payload['previousReceiptId']; }), trust, expected, SHAPE],
  ['an own __proto__ in the payload', at((r) => { r.signedReceipt.payload = JSON.parse(JSON.stringify(p).replace('{', '{"__proto__":1,')) as Record<string, unknown>; }), trust, expected, SHAPE],
  ['an own toString in the payload', signed({ toString: 'x' }), trust, expected, SHAPE],
  ['a hidden payload field', at((r) => { Object.defineProperty(r.signedReceipt.payload, 'receiptId', { enumerable: false }); }), trust, expected, SHAPE],
  ['a proxy payload', at((r) => { r.signedReceipt.payload = new Proxy(r.signedReceipt.payload, {}); }), trust, expected, SHAPE],
  ['another algorithm', at((r) => { r.signedReceipt.signature['algorithm'] = 'ECDSA_P256_SHA256'; }), trust, expected, 'potpis nije Ed25519'],
  ['another encoding', at((r) => { r.signedReceipt.signature['signatureEncoding'] = 'der'; }), trust, expected, 'potpis nije Ed25519'],
  ['another key id', label('keyId', 'drugi'), trust, expected, 'potpis nije ključem stoga'],
  ['another key version', label('keyVersion', '2'), trust, expected, 'potpis nije ključem stoga'],
  ...CTRL.map(([n, c]): [string, unknown, ReceiptTrust, unknown, string] => [`${n} after the key id of the signature only`, label('keyId', `${trust.keyId}${c}`), trust, expected, 'potpis nije ključem stoga']),
  ['a short signature', sigAs(sig.subarray(1)), trust, expected, 'potpis nije ispravno zapisan'],
  ['a padded signature', sigAs(`${sig.toString('base64url')}==`), trust, expected, 'potpis nije ispravno zapisan'],
  ['a standard base64 signature', sigAs(sig.toString('base64')), trust, expected, 'potpis nije ispravno zapisan'],
  ['S at or above the group order', sigAs(bigS), trust, expected, 'potpis nije ispravno zapisan'],
  ['S equal to the group order', sigAs(Buffer.concat([sig.subarray(0, 32), Buffer.from(L.toString(16).padStart(64, '0'), 'hex').reverse()])), trust, expected, 'potpis nije ispravno zapisan'],
  ['a second base64url spelling of the signature', sigAs(`${sig.toString('base64url').slice(0, -1)}${twin(sig.toString('base64url').at(-1)!)}`), trust, expected, 'potpis nije ispravno zapisan'],
  ['another key under the same label', signed({}, generateKeyPairSync('ed25519').privateKey), trust, expected, 'potpis ne vrijedi'],
  ['the canonical text signed instead of D-92', sigAs(sign(null, Buffer.from(golden.accepted.canonical), testKey)), trust, expected, 'potpis ne vrijedi'],
  ['a wrong digest field', at((r) => { r.signedReceipt.payloadDigestSha256 = 'f'.repeat(64); }), trust, expected, 'sažetak potvrde ne odgovara'],
  ['a payload changed after signing', at((r) => { r.signedReceipt.payload['payloadBytes'] = 124; }), trust, expected, 'sažetak potvrde ne odgovara'],
  ...([['documentId', 'doc-2'], ['clientTransactionId', 'tx-2'], ['revision', 6], ['principalId', '6f1c2b7e-0d4a-4c3b-9a8e-1b2c3d4e5f60'], ['segmentHash', 'b'.repeat(64)],
    ['evidenceDomainId', '0b5e6c1a-7d2f-4e3a-8b9c-0d1e2f3a4b5c'], ['clientTransactionId', `${expected.clientTransactionId}\u00a0`]] as const)
    .map(([k, v]): [string, unknown, ReceiptTrust, unknown, string] => [`another ${k} (${JSON.stringify(v)})`, signed({ [k]: v }), trust, expected, `potvrda ne imenuje ovaj commit (${k})`]),
  ...CTRL.filter(([n]) => n !== 'NBSP').map(([n, c]): [string, unknown, ReceiptTrust, unknown, string] => [`${n} after the transaction`, signed({ clientTransactionId: `${expected.clientTransactionId}${c}` }), trust, expected, `${SHAPE} (clientTransactionId)`]),
  ['a blank key id in trust and signature', label('keyId', ''), { ...trust, keyId: '' }, expected, lab('trust.keyId')],
  ['a blank key version in trust and signature', label('keyVersion', ' '), { ...trust, keyVersion: ' ' }, expected, lab('trust.keyVersion')],
  ...(['keyId', 'keyVersion'] as const).flatMap((f) => CTRL.map(([n, c]): [string, unknown, ReceiptTrust, unknown, string] =>
    [`${n} in the ${f} of trust and signature`, label(f, `${trust[f]}${c}`), { ...trust, [f]: `${trust[f]}${c}` }, expected, lab(`trust.${f}`)])),
  ['a trusted key that is not Ed25519', vector(), { ...trust, keyBase64Url: Buffer.from(`ff${golden.verificationKey.spkiDerHex.slice(2)}`, 'hex').toString('base64url') }, expected, lab('trust.keyBase64Url')],
  ['a second base64url spelling of the trusted key', vector(), { ...trust, keyBase64Url: `${trust.keyBase64Url.slice(0, -1)}${twin(trust.keyBase64Url.at(-1)!)}` }, expected, lab('trust.keyBase64Url')],
  ['a key id longer than the server allows', label('keyId', 'k'.repeat(2049)), { ...trust, keyId: 'k'.repeat(2049) }, expected, lab('trust.keyId')],
  ['a key version longer than the server allows', label('keyVersion', 'v'.repeat(257)), { ...trust, keyVersion: 'v'.repeat(257) }, expected, lab('trust.keyVersion')],
  ['a trusted domain that is no UUID', vector(), { ...trust, evidenceDomainId: 'domena' }, expected, lab('trust.evidenceDomainId')],
  ['a null trust', vector(), null as unknown as ReceiptTrust, expected, lab('trust')],
  ['a proxy trust', vector(), new Proxy(trust, {}), expected, lab('trust')],
  ['an empty expectation', vector(), trust, {}, lab('expected')],
  ['an expectation without the document', vector(), trust, noDocument, lab('expected')],
  ['a hidden wrong document in the expectation', vector(), trust, Object.defineProperty({ ...expected }, 'documentId', { value: 'doc-2', enumerable: false }), lab('expected')],
  ['a revision as text', vector(), trust, { ...expected, revision: '7' }, lab('expected.revision')],
  ['an extra expectation field', vector(), trust, { ...expected, extra: 1 }, lab('expected')],
];
test.each(rows)('checkReceipt: %s', (_name, receipt, t, e, reason) => {
  let got: string | null = 'not run';
  assert.doesNotThrow(() => { got = checkReceipt(receipt, t, e as ReceiptExpectation); });
  assert.equal(got, reason);
});

test('checkReceipt does not call a getter that returns the right value', () => {
  let calls = 0;
  const r = at((x) => { Object.defineProperty(x.signedReceipt.payload, 'revision', { get: () => { calls += 1; return 7; }, enumerable: true }); });
  assert.equal(checkReceipt(r, trust, expected), SHAPE);
  assert.equal(calls, 0);
});
