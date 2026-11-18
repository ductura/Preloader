// DAN-1096 L-1: the RFC 8785 text a receipt v2 is signed over, and the key the lab derives from the stack's seed.
// The contract vector is the server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032 test 1.
import { onTestFinished, test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalJson } from '@ductura/contracts';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { RECEIPT_FIELDS, type ReceiptExpectation, type ReceiptTrust, checkReceipt, jcs, jcsText, publicKeyFromSeed } from '../scripts/lab/receipt.ts';
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
  for (const other of [Buffer.from(golden.accepted.canonical), digest]) assert.equal(verify(null, other, key, sig), false);
});
// A Uint8Array of another realm, a Buffer view at an offset, and a view whose prototype claims another length.
const foreign = runInNewContext('new Uint8Array(32)') as Uint8Array;
foreign.set(SEED);
const claims = Object.create(Uint8Array.prototype, { length: { get: () => 31 }, byteLength: { get: () => 31 } }) as object;
test.each([foreign, Buffer.concat([Buffer.from([7]), SEED]).subarray(1), Object.setPrototypeOf(Uint8Array.from(SEED), claims) as Uint8Array])(
  'publicKeyFromSeed takes the 32 bytes the view itself shows (%#)', (seed) => assert.equal(publicKeyFromSeed(seed), publicKeyFromSeed(SEED)));
const shadow = (n: number, key: string, claim: number) => Object.defineProperty(new Uint8Array(n), key, { value: claim });
const shared = new Uint8Array(new SharedArrayBuffer(32));
shared.set(SEED);
const detach = (u: Uint8Array) => { structuredClone(u.buffer, { transfer: [u.buffer] }); return u; };
// Resizable buffers are ES2024; the repo's TypeScript lib is ES2023.
const resizable = new (ArrayBuffer as unknown as new (n: number, o: { maxByteLength: number }) => ArrayBuffer & { resize: (n: number) => void })(64, { maxByteLength: 64 });
const outside = new Uint8Array(resizable, 16, 32);
resizable.resize(20);
// Review on 2413b3f: 32 own keys are not enough, they must be exactly "0".."31".
const named = (u: Uint8Array, n: number) => { for (let i = 0; i < n; i += 1) Object.defineProperty(u, `k${i}`, { value: i, enumerable: true }); return u; };
test.each([new Uint8Array(0), SEED.subarray(1), Buffer.concat([SEED, Buffer.from([0])]), new Uint16Array(16), runInNewContext('new Uint16Array(16)'),
  shadow(32, 'byteLength', 31), shadow(31, 'byteLength', 32), shadow(32, 'length', 31), shadow(31, 'length', 32), { length: 32, byteLength: 32 },
  new DataView(new ArrayBuffer(32)), shared, detach(Uint8Array.from(SEED)), outside, named(detach(Uint8Array.from(SEED)), 32),
  named(new Uint8Array(31), 1), shadow(32, 'x', 1), Object.assign(detach(Uint8Array.from(SEED)), Object.fromEntries([...Array(32).keys()].map((i) => [Symbol(i), i]))),
  // QA self-check: a seed too large for Reflect.ownKeys is refused by its length first.
  new Uint8Array(2 ** 25)])('publicKeyFromSeed refuses a seed that is not 32 bytes of Uint8Array (%#)', (seed) => {
  assert.throws(() => publicKeyFromSeed(seed as Uint8Array), /^Error: sjeme ključa nema 32 bajta$/);
});
const nest = (depth: number): unknown => (depth <= 1 ? { a: 0 } : [nest(depth - 1)]);
// RFC 8785: keys in UTF-16 code unit order, -0 as 0, numbers and escapes as JSON.stringify writes them.
test.each([
  ['keys by UTF-16 units, not code points', { '�': 1, '\u{1F600}': 2 }, '{"\u{1F600}":2,"�":1}'],
  ['two astral keys by their low surrogate', { '\u{1F601}': 1, '\u{1F600}': 2 }, '{"\u{1F600}":2,"\u{1F601}":1}'],
  ['-0 alone, in an object and an array', [-0, { a: -0 }], '[0,{"a":0}]'],
  ['own __proto__ keys, also nested', JSON.parse('{"a":2,"__proto__":{"__proto__":1}}'), '{"__proto__":{"__proto__":1},"a":2}'],
  ['finite numbers', [1.5, 2 ** 53, 1e21, 5e-324, -1e-7], '[1.5,9007199254740992,1e+21,5e-324,-1e-7]'],
  ['a string, never read as JSON text (QA on 2413b3f)', 'null', '"null"'],
  ['a surrogate pair in a key and a value', { '\u{1F600}k': '\u{1F600}' }, '{"\u{1F600}k":"\u{1F600}"}'],
  ['an own toJSON key, never called', { toJSON: 'x', a: 1 }, '{"a":1,"toJSON":"x"}'],
  ['a shared, not cyclic, value', (() => { const x = { y: 1 }; return { p: x, q: [x] }; })(), '{"p":{"y":1},"q":[{"y":1}]}'],
  ['64 levels of nesting', nest(64), `${'['.repeat(63)}{"a":0}${']'.repeat(63)}`],
  ['control and blank characters', { 'k\r\n\t\u001f\u007f  ': 'v\r\n\t\u001f\u007f  ' },
    '{"k\\r\\n\\t\\u001f\u007f  ":"v\\r\\n\\t\\u001f\u007f  "}'],
] as [string, unknown, string][])('jcs writes RFC 8785: %s', (_name, value, expected) => assert.equal(jcs(value), expected));
test('JSON text goes through jcsText only: "null" is null there and a string in jcs (QA on 2413b3f)', () => {
  assert.equal(jcsText('null'), 'null');
  assert.equal(jcsText(' {"b":1,"a":["null"]} '), '{"a":["null"],"b":1}');
  assert.equal(jcs('null'), canonicalJson('null'));
  for (const bad of ['abc', '{"a":', '"\\ud800"', `${'['.repeat(65)}${']'.repeat(65)}`]) assert.throws(() => jcsText(bad), /^Error: jcs: /, bad);
  // Pre-check on f1d67668: RFC 8785 §3.1 wants unique member names, also when one is written with an escape.
  for (const twice of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":[{"a":1,"b":{},"a":3}]}', '{"a\\"":1,"a\\"":2}']) assert.throws(() => jcsText(twice), /^Error: jcs: /, twice);
  assert.equal(jcsText('[{"a":1},{"a":2,"b":{"a":"a:"}}]'), '[{"a":1},{"a":2,"b":{"a":"a:"}}]');
  assert.throws(() => jcsText(null as unknown as string), /^Error: jcs: /);
});
const gotten = Object.defineProperty([1, 2], 0, { get: () => 5, enumerable: true });
class Sub extends Array<number> {}
const cycle: Record<string, unknown> = {};
cycle['self'] = cycle;
const revoked = Proxy.revocable({}, {});
revoked.revoke();
// jcs takes a JSON value (c.6986519308). A built-in or a class with private fields given Object.prototype cannot be
// told from {} in JavaScript; it is outside that domain, and the real caller passes JSON.parse output.
test.each([
  ['a sparse array', [1, , 2]], ['trailing holes', Object.assign([1], { length: 3 })], ['new Array(3)', new Array(3)],
  ['an array with an extra key', Object.assign([1, 2], { x: 3 })], ['a hole made up for by an extra key', Object.assign([1, , 2], { x: 3 })],
  ['a hole made up for by a symbol key', Object.assign([1, , 2], { [Symbol('x')]: 3 })], ['a proxy of an array', new Proxy([1, 2], {})],
  ['a getter on an array element', gotten], ['an Array subclass', Sub.from([1])], ['an array without a prototype', Object.setPrototypeOf([1], null)],
  ['a hidden array element', Object.defineProperty([1, 2], 1, { value: 2, enumerable: false })], ['a cycle', cycle],
  ['a proxy of an object', new Proxy({ a: 1 }, {})], ['a revoked proxy', revoked.proxy], ['a getter', Object.defineProperty({}, 'a', { get: () => 1, enumerable: true })],
  ['another prototype', { __proto__: { a: 1 }, b: 2 }], ['no prototype', Object.assign(Object.create(null) as object, { a: 1 })],
  ['a symbol key', { a: 1, [Symbol('x')]: 2 }], ['a hidden key', Object.defineProperty({ a: 1 }, 'b', { value: 2 })],
  ['new String', new String('x')], ['new Number', new Number(1)], ['a Date', new Date(0)], ['a Map', new Map()],
  ['NaN', NaN], ['Infinity', Infinity], ['a bigint', 1n], ['undefined', undefined], ['undefined in an object', { a: undefined }],
  ['a function', () => 1], ['a symbol', Symbol('x')], ['65 levels of nesting', nest(65)],
  ['a lone high surrogate in a value', { a: 'x\ud800' }], ['a lone low surrogate in a key', { '\udc00': 1 }], ['a lone surrogate alone', '\ud800'],
] as [string, unknown][])('jcs refuses %s', (_name, value) => assert.throws(() => jcs(value), /^Error: jcs: /));
// Any JSON value, written as the server's reference canonicalJson writes it. Strings take any UTF-16 code units,
// so lone surrogates come anywhere; objects are built as JSON.parse builds them, so __proto__ is an own key.
const units = fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 6 }).map((a) => String.fromCharCode(...a));
const text = fc.oneof(fc.string({ unit: 'binary' }), units, fc.constantFrom('__proto__', 'toString', 'null', '\u{1F600}', ' '));
const leaf = fc.oneof(fc.constant(null), fc.boolean(), fc.constant(-0), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE, 1e21), text);
const json = fc.letrec((tie) => ({
  value: fc.oneof({ depthSize: 'small' }, leaf, tie('array'), tie('object')),
  array: fc.array(tie('value'), { maxLength: 4 }),
  object: fc.array(fc.tuple(text, tie('value')), { maxLength: 4 }).map((entries) => {
    const o = JSON.parse('{}') as Record<string, unknown>;
    for (const [k, v] of entries) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    return o;
  }),
})).value;
test('jcs writes every JSON value as canonicalJson does, and jcsText its JSON text the same', () => {
  fc.assert(fc.property(json, (v) => {
    let reference: string | null = null;
    try { reference = canonicalJson(v); } catch { /* a lone surrogate: canonicalJson throws, and so must jcs and jcsText */ }
    for (const write of [() => jcs(v), () => jcs(JSON.parse(JSON.stringify(v))), () => jcsText(JSON.stringify(v))]) {
      if (reference === null) assert.throws(write, /^Error: jcs: /);
      else assert.equal(write(), reference);
    }
  }), { numRuns: 500 });
});
test('jcs gives jcs: even where reading the value throws, as a module namespace in its TDZ does (review on c1403730)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jcs-ns-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.mjs'), "import './b.mjs';\nexport const x = 1;\n");
  writeFileSync(join(dir, 'b.mjs'), `import * as a from './a.mjs';\nimport { jcs } from ${JSON.stringify(new URL('../scripts/lab/receipt.ts', import.meta.url).href)};\ntry { jcs(a); console.log('written'); } catch (e) { console.log(String(e)); }\n`);
  const run = spawnSync(process.execPath, [join(dir, 'a.mjs')], { encoding: 'utf8', timeout: 20_000 });
  assert.match(run.stdout, /^Error: jcs: /, run.stdout + run.stderr);
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
const NOT_SIGNED = 'potvrda nije potpisana';
const SHAPE = 'potpisana potvrda nema oblik v2';
// For every payload field, a value of the right type the server refuses (Review c.6988462264): one per rule.
const REFUSED: Record<string, unknown> = {
  receiptSchema: 'ductus-evidence-receipt-v1', receiptId: ' ', evidencePackageId: '', documentId: '\u00a0', sessionId: 's'.repeat(257), segmentId: '\t',
  segmentHash: 'A'.repeat(64), predecessorSegmentHash: 'c'.repeat(63), previousReceiptId: '', evidenceSchema: 'ductus-evidence-segment-v1',
  evidenceProfileId: 'x'.repeat(121), sequenceFrom: 0, sequenceTo: -1, eventCount: 0, payloadBytes: 1.5, acceptedAt: '2026-10-03T06:05:01.000Z',
  revision: 2 ** 53, clientTransactionId: 'tx\n', evidenceDomainId: String(p['evidenceDomainId']).toUpperCase(), principalId: String(p['principalId']).replace('-4', '-5'),
};
const lab = (field: string) => `laboratorij nema ispravan ključ stoga ili commit (${field})`;
const { documentId: _d, ...noDocument } = expected;
const rows: [string, unknown, ReceiptTrust, unknown, string | null][] = [
  ["the server's receipt", vector(), trust, expected, null],
  // Review on 49e086f: a v3 segment and a later receipt of the same chain pass too.
  ['a v3 segment', signed({ evidenceSchema: 'ductus-evidence-segment-v3' }), trust, expected, null],
  ['a later receipt of the chain', signed({ predecessorSegmentHash: 'c'.repeat(64), previousReceiptId: 'receipt-0', sequenceFrom: 2, sequenceTo: 5, eventCount: 4 }), trust, expected, null],
  // a1-1 round 3: a JSON value has Object.prototype, so a payload without a prototype is not one.
  ['a payload without a prototype', at((r) => { r.signedReceipt.payload = Object.assign(Object.create(null) as object, r.signedReceipt.payload); }), trust, expected, SHAPE],
  ['no receipt', undefined, trust, expected, NOT_SIGNED],
  ['a receipt as text', JSON.stringify(vector()), trust, expected, NOT_SIGNED],
  ['a pending receipt', at((r) => { r.status = 'pending_signature'; }), trust, expected, NOT_SIGNED],
  ['an extra envelope field', { ...vector(), note: 1 }, trust, expected, NOT_SIGNED],
  ['a proxy envelope', new Proxy(vector(), {}), trust, expected, NOT_SIGNED],
  ['a revoked proxy', revoked.proxy, trust, expected, NOT_SIGNED],
  ['an extra signedReceipt field', at((r) => { Object.assign(r.signedReceipt, { x: 1 }); }), trust, expected, SHAPE],
  ['no signature', at((r) => { delete (r.signedReceipt as Partial<Rec['signedReceipt']>).signature; }), trust, expected, SHAPE],
  ['an inherited signedReceipt field', at((r) => { const { signature, ...rest } = r.signedReceipt; r.signedReceipt = Object.assign(Object.create({ signature }) as Rec['signedReceipt'], rest); }), trust, expected, SHAPE],
  ['a getter on signedReceipt', at((r) => { Object.defineProperty(r.signedReceipt, 'payloadDigestSha256', { get: () => { throw new Error('x'); }, enumerable: true }); }), trust, expected, `${SHAPE} (payloadDigestSha256)`],
  ['a proxy signedReceipt', at((r) => { r.signedReceipt = new Proxy(r.signedReceipt, {}); }), trust, expected, SHAPE],
  ['a proxy signature', at((r) => { r.signedReceipt.signature = new Proxy(r.signedReceipt.signature, {}); }), trust, expected, SHAPE],
  // QA on 49e086f: the signature's own fields, inherited or behind a throwing getter.
  ['an inherited signature field', at((r) => { const { keyId, ...rest } = r.signedReceipt.signature; r.signedReceipt.signature = Object.assign(Object.create({ keyId }) as Record<string, unknown>, rest); }), trust, expected, `${SHAPE} (signature.keyId)`],
  ['a throwing getter on a signature field', at((r) => { Object.defineProperty(r.signedReceipt.signature, 'keyId', { get: () => { throw new Error('x'); }, enumerable: true }); }), trust, expected, `${SHAPE} (signature.keyId)`],
  // QA self-check on 1224784: the signature's own shape, field by field.
  ['an extra signature field', at((r) => { r.signedReceipt.signature['extra'] = 1; }), trust, expected, SHAPE],
  ['a hidden signature field', at((r) => { Object.defineProperty(r.signedReceipt.signature, 'keyId', { enumerable: false }); }), trust, expected, `${SHAPE} (signature.keyId)`],
  ['a Date envelope with the receipt fields', Object.assign(new Date(0), vector()), trust, expected, NOT_SIGNED],
  ...Object.keys(p).map((k): [string, unknown, ReceiptTrust, unknown, string] => [`payload ${k} of the right type, refused`, signed({ [k]: REFUSED[k] }), trust, expected, `${SHAPE} (payload.${k})`]),
  // The server's rules across fields and its calendar (evidence-receipt.ts:131-139, evidence-segment-v2.ts:328-331).
  ['sequenceTo below sequenceFrom', signed({ sequenceFrom: 3, sequenceTo: 2, eventCount: 1 }), trust, expected, `${SHAPE} (payload.sequenceTo)`],
  ['an eventCount the range does not hold', signed({ eventCount: 2 }), trust, expected, `${SHAPE} (payload.eventCount)`],
  ['a sequenceTo past the count', signed({ sequenceTo: 7 }), trust, expected, `${SHAPE} (payload.eventCount)`],
  ['a day that does not exist', signed({ acceptedAt: '2026-02-30T06:05:00.000Z' }), trust, expected, `${SHAPE} (payload.acceptedAt)`],
  ['an extra payload field', signed({ extra: 1 }), trust, expected, SHAPE],
  ['an own __proto__ in the payload', at((r) => { r.signedReceipt.payload = JSON.parse(JSON.stringify(p).replace('{', '{"__proto__":1,')) as Record<string, unknown>; }), trust, expected, SHAPE],
  ['an own toString in the payload', signed({ toString: 'x' }), trust, expected, SHAPE],
  ['a hidden payload field', at((r) => { Object.defineProperty(r.signedReceipt.payload, 'receiptId', { enumerable: false }); }), trust, expected, `${SHAPE} (payload.receiptId)`],
  ['a proxy payload', at((r) => { r.signedReceipt.payload = new Proxy(r.signedReceipt.payload, {}); }), trust, expected, SHAPE],
  ['another algorithm', at((r) => { r.signedReceipt.signature['algorithm'] = 'ECDSA_P256_SHA256'; }), trust, expected, `${SHAPE} (signature.algorithm)`],
  ['another encoding', at((r) => { r.signedReceipt.signature['signatureEncoding'] = 'der'; }), trust, expected, `${SHAPE} (signature.signatureEncoding)`],
  ['a short signature', sigAs(sig.subarray(1)), trust, expected, `${SHAPE} (signature.signatureBase64Url)`],
  ['a padded signature', sigAs(`${sig.toString('base64url')}==`), trust, expected, `${SHAPE} (signature.signatureBase64Url)`],
  ['a standard base64 signature', sigAs(sig.toString('base64')), trust, expected, `${SHAPE} (signature.signatureBase64Url)`],
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
  ['C1 (U+0085) in the transaction (review c.6988656296)', signed({ clientTransactionId: 'tx\u0085' }), trust, expected, `${SHAPE} (payload.clientTransactionId)`],
  ['a trusted key that is not Ed25519', vector(), { ...trust, keyBase64Url: Buffer.from(`ff${golden.verificationKey.spkiDerHex.slice(2)}`, 'hex').toString('base64url') }, expected, lab('trust.keyBase64Url')],
  ['a second base64url spelling of the trusted key', vector(), { ...trust, keyBase64Url: `${trust.keyBase64Url.slice(0, -1)}${twin(trust.keyBase64Url.at(-1)!)}` }, expected, lab('trust.keyBase64Url')],
  ['a trusted X25519 key of 44 bytes (QA c.6988462360)', vector(), { ...trust, keyBase64Url: generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') }, expected, lab('trust.keyBase64Url')],
  ['a key id of 2048 in trust and signature', label('keyId', 'k'.repeat(2048)), { ...trust, keyId: 'k'.repeat(2048) }, expected, null],
  ['a key version of 256 in trust and signature', label('keyVersion', 'v'.repeat(256)), { ...trust, keyVersion: 'v'.repeat(256) }, expected, null],
  ['a null trust', vector(), null as unknown as ReceiptTrust, expected, lab('trust')],
  ['a proxy trust', vector(), new Proxy(trust, {}), expected, lab('trust')],
  ['an empty expectation', vector(), trust, {}, lab('expected.documentId')],
  ['an expectation without the document', vector(), trust, noDocument, lab('expected.documentId')],
  ['a hidden wrong document in the expectation', vector(), trust, Object.defineProperty({ ...expected }, 'documentId', { value: 'doc-2', enumerable: false }), lab('expected.documentId')],
  // Every other expectation field with a value its payload rule refuses (pre-check on f7163833).
  ...(Object.entries({ documentId: ' ', clientTransactionId: 'tx\t', principalId: expected.principalId.toUpperCase(), segmentHash: 'A'.repeat(64) }))
    .map(([k, v]): [string, unknown, ReceiptTrust, unknown, string] => [`an expected ${k} the payload rule refuses`, vector(), trust, { ...expected, [k]: v }, lab(`expected.${k}`)]),
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
  assert.equal(checkReceipt(r, trust, expected), `${SHAPE} (payload.revision)`);
  assert.equal(calls, 0);
});
type Obj = Record<string, unknown>;
// a1-2″ (c.6990467639): every field checkReceipt checks × every class of invalid value, with the exact reason. The paths
// are written out here, never taken from the module (K2b); the kind, the limit and null decide which class is valid.
type Kind = 'text' | 'tx' | 'label' | 'int' | 'fixed';
const FIELDS: Record<string, [Kind, (number | undefined)?, 'null'?]> = {
  'payload.receiptSchema': ['fixed'], 'payload.receiptId': ['text', 256], 'payload.evidenceDomainId': ['fixed'], 'payload.evidencePackageId': ['text', 256],
  'payload.documentId': ['text', 256], 'payload.revision': ['int'], 'payload.clientTransactionId': ['tx', 128], 'payload.principalId': ['fixed'],
  'payload.sessionId': ['text', 256], 'payload.segmentId': ['text', 256], 'payload.segmentHash': ['fixed'], 'payload.predecessorSegmentHash': ['fixed', undefined, 'null'],
  'payload.previousReceiptId': ['text', 256, 'null'], 'payload.evidenceSchema': ['fixed'], 'payload.evidenceProfileId': ['text', 120], 'payload.sequenceFrom': ['int'],
  'payload.sequenceTo': ['int'], 'payload.eventCount': ['int'], 'payload.payloadBytes': ['int'], 'payload.acceptedAt': ['fixed'], payloadDigestSha256: ['fixed'],
  'signature.algorithm': ['fixed'], 'signature.keyId': ['label', 2048], 'signature.keyVersion': ['label', 256], 'signature.signatureEncoding': ['fixed'],
  'signature.signatureBase64Url': ['fixed'], 'trust.keyBase64Url': ['fixed'], 'trust.keyId': ['label', 2048], 'trust.keyVersion': ['label', 256],
  'trust.evidenceDomainId': ['fixed'], 'expected.documentId': ['text', 256], 'expected.clientTransactionId': ['tx', 128], 'expected.revision': ['int'],
  'expected.principalId': ['fixed'], 'expected.segmentHash': ['fixed'],
};
const MISSING = Symbol('missing');
const SKIP = Symbol('no limit');
const CHARS: [string, string][] = [['tab', '\t'], ['CR', '\r'], ['LF', '\n'], ['DEL', '\u007f'], ['U+0000', '\u0000'], ['NBSP', '\u00a0']];
const CLASSES: [string, (v: string, max?: number) => unknown][] = [
  ['false', () => false], ['1.5', () => 1.5], ['null', () => null], ['missing', () => MISSING], ['undefined', () => undefined], ['{}', () => ({})],
  ['[v]', (v) => [v]], ['0', () => 0], ['-1', () => -1], ['2**53', () => 2 ** 53], ['NaN', () => NaN], ['Infinity', () => Infinity], ["''", () => ''], ["' '", () => ' '],
  ...CHARS.flatMap(([n, c]): [string, (v: string) => unknown][] => [[n, () => c], [`v+${n}`, (v) => `${v}${c}`]]),
  ['v+high surrogate', (v) => `${v}\ud800`], ['v+low surrogate', (v) => `${v}\udc00`],
  ['too long', (_v, max) => (max === undefined ? SKIP : 'x'.repeat(max + 1))], ['at the limit', (_v, max) => (max === undefined ? SKIP : 'x'.repeat(max))],
  ['v+a', (v) => `${v}a`], ['v without its last character', (v) => v.slice(0, -1)],
];
// A value of the right length is valid for text and labels; the server's Text needs only one character that is no
// white space (routes/evidence.ts:23), the transaction no control character (evidence-receipt.ts:218, 235).
const LENGTH = ['at the limit', 'v+a', 'v without its last character'];
const valid = ([kind, , nullable]: [Kind, (number | undefined)?, 'null'?], cls: string, v: string) => (cls === 'null' ? nullable === 'null'
  : cls === 'v without its last character' && v.length < 2 ? false
  : kind === 'text' ? cls === 'DEL' || cls === 'U+0000' || (cls.startsWith('v+') && !cls.includes('surrogate')) || LENGTH.includes(cls)
  : kind === 'tx' ? cls === 'v+NBSP' || LENGTH.includes(cls) : kind === 'label' && LENGTH.includes(cls));
const field = (path: string) => (/^(trust|expected)\./.test(path) ? lab(path) : `${SHAPE} (${path})`);
/** The reason of a valid value: the label or the commit it names, if either is compared; else none. */
const other = (path: string) => (/^(signature|trust)\.key(Id|Version)$/.test(path) ? 'potpis nije ključem stoga'
  : /\.(documentId|clientTransactionId)$/.test(path) ? `potvrda ne imenuje ovaj commit (${path.split('.')[1]!})` : null);
const SAMPLE: Record<string, unknown> = { 'payload.predecessorSegmentHash': 'ab'.repeat(32), 'payload.previousReceiptId': 'r-0' };
const valueAt = (path: string): unknown => SAMPLE[path] ?? (path === 'payloadDigestSha256' ? golden.accepted.payloadDigestSha256
  : ((o) => o[path.split('.')[1]!])({ payload: p, signature: golden.accepted.signature, trust, expected }[path.split('.')[0]!] as Obj));
/** The receipt, trust and expectation with `path` set to `x`; a payload is signed again when jcs can write it. */
function put(path: string, x: unknown): [unknown, ReceiptTrust, unknown] {
  const [head, key] = path.includes('.') ? (path.split('.') as [string, string]) : ['signedReceipt', path];
  const set = (o: Obj) => { if (x === MISSING) delete o[key]; else o[key] = x; };
  if (head === 'trust' || head === 'expected') {
    const o: Obj = { ...(head === 'trust' ? trust : expected) };
    set(o);
    return head === 'trust' ? [vector(), o as ReceiptTrust, expected] : [vector(), trust, o];
  }
  if (head === 'payload' && x !== MISSING) try { return [signed({ [key]: x }), trust, expected]; } catch { /* jcs cannot write x */ }
  return [at((r) => { set({ payload: r.signedReceipt.payload, signature: r.signedReceipt.signature, signedReceipt: r.signedReceipt as unknown as Obj }[head]!); }), trust, expected];
}
const MATRIX = Object.entries(FIELDS).flatMap(([path, f]) => CLASSES.map(([cls, make]) => [path, cls, make(String(valueAt(path)), f[1]), valid(f, cls, String(valueAt(path)))] as const))
  .filter(([, , x]) => x !== SKIP);
test.each(MATRIX)('checkReceipt: %s × %s', (path, _cls, x, ok) => {
  const [r, t, e] = put(path, x);
  let got: string | null = 'not run';
  assert.doesNotThrow(() => { got = checkReceipt(r, t, e as ReceiptExpectation); });
  assert.equal(got, ok ? other(path) : field(path));
});
test('the matrix names exactly the fields checkReceipt checks: a written list, the module and the receipt (K2b)', () => {
  const r = vector();
  const leaves = [...Object.keys(r.signedReceipt.payload).map((k) => `payload.${k}`), 'payloadDigestSha256', ...Object.keys(r.signedReceipt.signature).map((k) => `signature.${k}`),
    ...Object.keys(trust).map((k) => `trust.${k}`), ...Object.keys(expected).map((k) => `expected.${k}`)];
  assert.deepEqual([...RECEIPT_FIELDS].sort(), Object.keys(FIELDS).sort());
  assert.deepEqual(leaves.sort(), Object.keys(FIELDS).sort());
  assert.equal(RECEIPT_FIELDS.length, 35);
});
