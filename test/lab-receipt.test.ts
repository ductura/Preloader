// DAN-1096 L-1: the canonical text (RFC 8785) a receipt v2 is signed over, and
// the key the lab derives from the stack's seed. The contract vector is the
// server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032
// test 1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalJson } from '@ductura/contracts';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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

test('publicKeyFromSeed takes a 32-byte Uint8Array from another realm (review on f9c1458)', () => {
  const foreign = runInNewContext('new Uint8Array(32)') as Uint8Array;
  foreign.set(SEED);
  assert.equal(publicKeyFromSeed(foreign), publicKeyFromSeed(SEED));
});

test('publicKeyFromSeed takes a Buffer view at an offset as the 32 bytes it shows', () => {
  assert.equal(publicKeyFromSeed(Buffer.concat([Buffer.from([7]), SEED]).subarray(1)), publicKeyFromSeed(SEED));
});

// Round 3 (c.6986519308): the length is the view's own, never an own property that shadows it.
const shadow = (n: number, key: 'byteLength' | 'length', claim: number) => Object.defineProperty(new Uint8Array(n), key, { value: claim });
const shared = new Uint8Array(new SharedArrayBuffer(32));
shared.set(SEED);
test.each([new Uint8Array(0), SEED.subarray(1), Buffer.concat([SEED, Buffer.from([0])]), new Uint16Array(16), runInNewContext('new Uint16Array(16)'),
  shadow(32, 'byteLength', 31), shadow(31, 'byteLength', 32), shadow(32, 'length', 31), shadow(31, 'length', 32), { length: 32, byteLength: 32 },
  new DataView(new ArrayBuffer(32)), shared])(
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
  ['finite numbers as JSON.stringify writes them', [1.5, 2 ** 53, 1e21, 5e-324, -1e-7], '[1.5,9007199254740992,1e+21,5e-324,-1e-7]'],
  ['JSON text, parsed first', ' {"b":1,"a":[2]} ', '{"a":[2],"b":1}'],
  ['JSON text of a string', '"x"', '"x"'],
  ['a surrogate pair in a key and a value', { '\u{1F600}k': '\u{1F600}' }, '{"\u{1F600}k":"\u{1F600}"}'],
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
// Round 3 (c.6986519308): jcs takes a JSON value. A built-in or a class with private fields given Object.prototype
// cannot be told from {} in JavaScript; it is outside that domain, and the real caller passes JSON.parse output.
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
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['a bigint', 1n],
  ['undefined', undefined],
  ['a function', () => 1],
  ['a symbol', Symbol('x')],
  ['undefined in an object', { a: undefined }],
  // QA self-check on ce6a78b.
  ['65 levels of nesting', nest(65)],
  ['an object without a prototype', Object.assign(Object.create(null) as object, { a: 1 })],
  ['a lone high surrogate in a value', { a: 'x\ud800' }],
  ['a lone low surrogate in a key', { '\udc00': 1 }],
  ['text that is not JSON', 'abc'],
  ['cut JSON text', '{"a":'],
  ['JSON text with a lone surrogate', '"\\ud800"'],
  ['a symbol key', { a: 1, [Symbol('x')]: 2 }],
  ['a hidden key', Object.defineProperty({ a: 1 }, 'b', { value: 2 })],
  ['a hidden array element', Object.defineProperty([1, 2], 1, { value: 2, enumerable: false })],
];
test.each(refused)('jcs refuses %s', (_name, value) => {
  assert.throws(() => jcs(value), /^Error: jcs: /);
});

// Round 3 (c.6986519308): any JSON value, written as the server's reference canonicalJson writes it.
const lone = fc.constantFrom('\ud800', 'a\udc00', '\udbff\ud800');
const text = fc.oneof(fc.string({ unit: 'binary' }), fc.constantFrom('__proto__', 'toString', '\u{1F600}', '\u2028'), lone);
const leaf = fc.oneof(fc.constant(null), fc.boolean(), fc.constant(-0), fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(2 ** 53, Number.MAX_VALUE, Number.MIN_VALUE, 1e21), text);
// Objects are built from JSON text, as JSON.parse builds them, so __proto__ is an own key.
const json = fc.letrec((tie) => ({
  value: fc.oneof({ depthSize: 'small' }, leaf, tie('array'), tie('object')),
  array: fc.array(tie('value'), { maxLength: 4 }),
  object: fc.array(fc.tuple(text, tie('value')), { maxLength: 4 }).map((entries) => {
    const o = JSON.parse('{}') as Record<string, unknown>;
    for (const [k, v] of entries) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
    return o;
  }),
})).value;

test('jcs writes every JSON value as canonicalJson does, and the same for its JSON text', () => {
  fc.assert(fc.property(json, (v) => {
    let reference: string | null = null;
    try {
      reference = canonicalJson(v);
    } catch {
      // A lone surrogate: canonicalJson throws, and so must jcs.
    }
    // A string input is JSON text, so a top-level string value goes in as its JSON text only.
    const direct = typeof v === 'string' ? [] : [v, JSON.parse(JSON.stringify(v)) as unknown];
    for (const input of [...direct, JSON.stringify(v)]) {
      if (reference === null) assert.throws(() => jcs(input), /^Error: jcs: /);
      else assert.equal(jcs(input), reference);
    }
  }), { numRuns: 500 });
});
