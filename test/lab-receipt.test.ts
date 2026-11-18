// DAN-1096 L-1: the RFC 8785 text a receipt v2 is signed over, and the key the lab derives from the stack's seed.
// The contract vector is the server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032 test 1.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalJson } from '@ductura/contracts';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { jcs, jcsText, publicKeyFromSeed } from '../scripts/lab/receipt.ts';
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
  const receipt = pathToFileURL(fileURLToPath(new URL('../scripts/lab/receipt.ts', import.meta.url))).href;
  writeFileSync(join(dir, 'a.mjs'), "import './b.mjs';\nexport const x = 1;\n");
  writeFileSync(join(dir, 'b.mjs'), `import * as a from './a.mjs';\nimport { jcs } from '${receipt}';\ntry { jcs(a); console.log('written'); } catch (e) { console.log(String(e)); }\n`);
  const run = spawnSync(process.execPath, [join(dir, 'a.mjs')], { encoding: 'utf8', timeout: 20_000 });
  assert.match(run.stdout, /^Error: jcs: /, run.stdout + run.stderr);
});
