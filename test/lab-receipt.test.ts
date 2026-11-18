// DAN-1096 L-1: the canonical text (RFC 8785) a receipt v2 is signed over, and
// the key the lab derives from the stack's seed. The contract vector is the
// server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032
// test 1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { jcs, publicKeyFromSeed } from '../scripts/lab/receipt.ts';

type Golden = {
  verificationKey: { spkiDerHex: string; signingSeedSha256: string };
  accepted: { payload: Record<string, unknown>; canonical: string; payloadDigestSha256: string; signature: { signatureBase64Url: string } };
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

test.each([new Uint8Array(0), SEED.subarray(1), Buffer.concat([SEED, Buffer.from([0])]), new Uint16Array(16)])(
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
  ['a symbol key', { a: 1, [Symbol('x')]: 2 }],
  ['a hidden key', Object.defineProperty({ a: 1 }, 'b', { value: 2 })],
  ['a hidden array element', Object.defineProperty([1, 2], 1, { value: 2, enumerable: false })],
  ...[new Map([['a', 1]]), new Set([1]), new WeakMap(), new Date(5), new Number(7), new Boolean(true), new String('x'),
    new ArrayBuffer(2), new DataView(new ArrayBuffer(2)), new Uint8Array([1, 2]), /x/, new Error('x'), Promise.resolve(),
    (function* g() {})(), new Map().entries()].map((v): [string, unknown] => [
    `a ${Object.prototype.toString.call(v)} with a plain prototype`, Object.setPrototypeOf(v, Object.prototype) as unknown]),
];
test.each(refused)('jcs refuses %s', (_name, value) => {
  assert.throws(() => jcs(value), /^Error: jcs: /);
});
