// DAN-1096-a1-4a: vendoredProblem, the check that the copy of the server's golden vector never drifts.
// The rows of 20d0f0d (#33) stay verbatim; the tables after them name the exact reason of every row.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { vendoredProblem } from '../scripts/lab/vendored.ts';

type Obj = Record<string, unknown>;
const golden = JSON.parse(readFileSync(new URL('fixtures/receipt-v2-golden.json', import.meta.url), 'utf8')) as { verificationKey: Obj; accepted: Obj & { payload: Obj } };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const counted = (value: unknown) => {
  const calls = { n: 0 };
  return { calls, get: () => { calls.n += 1; return value; } };
};
const throwing = () => { throw new Error('getter'); };
const revoked = Proxy.revocable({}, {});
revoked.revoke();
// vendored.ts: the copy of the server's vector (moved here from lab-ci.test.ts
// on edb4664f, whose other tests check ci.yml and belong to part c).
const vendoredDoc = { chain: { verificationKey: golden.verificationKey }, receiptV2: { accepted: [golden.accepted, { name: 'edges' }] } };
const vSource = Buffer.from(JSON.stringify(vendoredDoc));
const vBlob = createHash('sha1').update(`blob ${vSource.byteLength}\0`).update(vSource).digest('hex');
const vFixture = JSON.parse(readFileSync(new URL('fixtures/receipt-v2-golden.json', import.meta.url), 'utf8')) as { source: Record<string, unknown> } & Record<string, unknown>;
const SHA = vFixture.source['commit'] as string;
const vOwn: Record<string, unknown> & { source: Record<string, unknown> } = { ...vFixture, source: { ...vFixture.source, blob: vBlob } };
test('the vendored check refuses any drift from its source', () => {
  assert.equal(vendoredProblem(vSource, vOwn, SHA), null);
  const changed = clone(vOwn);
  (changed['accepted'] as { payload: { revision: number } }).payload.revision = 8;
  assert.notEqual(vendoredProblem(vSource, changed, SHA), null);
  assert.notEqual(vendoredProblem(vSource, { ...vOwn, accepted: { ...(vOwn['accepted'] as object), extra: 1 } }, SHA), null);
  assert.notEqual(vendoredProblem(vSource, { ...vOwn, verificationKey: { ...(vOwn['verificationKey'] as object), keyId: 'x' } }, SHA), null);
  assert.notEqual(vendoredProblem(Buffer.concat([vSource, Buffer.from('\n')]), vOwn, SHA), null);
  assert.notEqual(vendoredProblem(vSource, vOwn, 'f'.repeat(40)), null);
  assert.notEqual(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, path: 'server/domain/forensics/golden-vectors/evidence-v3.json' } }, SHA), null);
});
const BAD_SHA: unknown[] = ['', ' ', '\t', ' ', `${SHA}\r\n`, `\n${SHA}`, `${SHA}\u007f`, ` ${SHA}`, SHA.slice(1), `${SHA}0`, SHA.toUpperCase(), undefined, null, 40];
test('an empty or malformed SHA is refused, even when both sides are equal', () => {
  for (const sha of BAD_SHA) {
    const both = { ...vOwn, source: { ...vOwn.source, commit: sha } };
    assert.notEqual(vendoredProblem(vSource, vOwn, sha), null, JSON.stringify(sha));
    assert.notEqual(vendoredProblem(vSource, both, sha), null, JSON.stringify(sha));
    assert.equal(vendoredProblem(vSource, both, sha), 'SERVER_SHA nije puni SHA commita', JSON.stringify(sha));
  }
});
const { accepted: _a, ...noAccepted } = vOwn;
// The fixtures of 20d0f0d, each with the exact reason it now gives.
const MALFORMED: [unknown, string][] = [
  [null, 'kopija'], [[], 'kopija'], [{}, 'kopija'], ['x', 'kopija'], [{ verificationKey: vOwn['verificationKey'], accepted: vOwn['accepted'] }, 'kopija'],
  [{ ...vOwn, source: null }, 'kopija.source'], [{ ...vOwn, source: Object.create(vOwn.source) as unknown }, 'kopija.source'],
  [JSON.parse(`{"__proto__":${JSON.stringify(vOwn)}}`), 'kopija'], [JSON.parse('{"toString":null}'), 'kopija'], [{ ...vOwn, extra: 1 }, 'kopija'],
  [noAccepted, 'kopija'], [{ ...vOwn, source: { ...vOwn.source, repository: 'x/y' } }, ''],
  [Object.defineProperty({ verificationKey: vOwn['verificationKey'], accepted: vOwn['accepted'] }, 'source', { get: throwing, enumerable: true }), 'kopija'],
  [revoked.proxy, 'kopija'], [new Proxy(vOwn, {}), 'kopija'], [{ ...vOwn, source: new Proxy(vOwn.source, {}) }, 'kopija.source'],
  [Object.defineProperty({ ...vOwn }, 'accepted', { enumerable: false }), 'kopija'],
];
test('a malformed fixture or source gives a reason, never an exception', () => {
  const fixtures = MALFORMED.map(([f]) => f);
  for (const [i, f] of fixtures.entries()) {
    assert.doesNotThrow(() => vendoredProblem(vSource, f, SHA), `fixture ${i}`);
    assert.notEqual(vendoredProblem(vSource, f, SHA), null, `fixture ${i}`);
    const at = MALFORMED[i]![1];
    assert.equal(vendoredProblem(vSource, f, SHA), at === '' ? 'kopija nije iz ductura/server' : `nema oblik (${at})`, `fixture ${i}`);
  }
  for (const [doc, reason] of [['nije json', 'izvor nije JSON'], ['{}', 'nema oblik (izvor.chain)'], [JSON.stringify({ chain: vendoredDoc.chain, receiptV2: { accepted: [] } }), 'nema oblik (izvor.receiptV2.accepted)']]) {
    const src = Buffer.from(doc!);
    const blob = createHash('sha1').update(`blob ${src.byteLength}\0`).update(src).digest('hex');
    const own = { ...vOwn, source: { ...vOwn.source, blob } };
    assert.doesNotThrow(() => vendoredProblem(src, own, SHA));
    assert.notEqual(vendoredProblem(src, own, SHA), null, doc);
    assert.equal(vendoredProblem(src, own, SHA), reason, doc);
    const empty = { ...own, verificationKey: undefined, accepted: undefined };
    assert.notEqual(vendoredProblem(src, empty, SHA), null, `${doc}: undefined = undefined`);
    assert.equal(vendoredProblem(src, empty, SHA), 'nema oblik (kopija.verificationKey)', `${doc}: undefined = undefined`);
  }
  assert.notEqual(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, take: 'anything' } }, SHA), null, 'take');
  assert.equal(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, take: 'anything' } }, SHA), 'nema oblik (kopija.source.take)', 'take');
});
test('the drift rows of 20d0f0d give their exact reasons', () => {
  const changed = clone(vOwn);
  (changed['accepted'] as { payload: { revision: number } }).payload.revision = 8;
  assert.equal(vendoredProblem(vSource, changed, SHA), 'accepted[0] se razlikuje od izvora');
  assert.equal(vendoredProblem(vSource, { ...vOwn, accepted: { ...(vOwn['accepted'] as object), extra: 1 } }, SHA), 'nema oblik (kopija.accepted)');
  assert.equal(vendoredProblem(vSource, { ...vOwn, verificationKey: { ...(vOwn['verificationKey'] as object), keyId: 'x' } }, SHA), 'verificationKey se razlikuje od izvora');
  assert.equal(vendoredProblem(Buffer.concat([vSource, Buffer.from('\n')]), vOwn, SHA), `izvor nije blob "${vBlob}"`);
  assert.equal(vendoredProblem(vSource, vOwn, 'f'.repeat(40)), `kopija je iz ${SHA}, a CI veže ${'f'.repeat(40)}`);
  assert.equal(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, path: 'x' } }, SHA), 'kopija nije iz server/domain/forensics/golden-vectors/evidence-v2.json');
  assert.equal(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, take: [...(vOwn.source['take'] as string[])].reverse() } }, SHA), 'kopija ne navodi što je preuzeto');
  assert.equal(vendoredProblem(vSource, { ...vOwn, source: { ...vOwn.source, commit: SHA.toUpperCase() } }, SHA), 'kopija ne navodi puni SHA commita');
});
// Review FAIL on 34058fd. 1: a getter or proxy anywhere inside the fixture,
// not only at its top, is refused before any value is read.
test('a fixture that is not a plain JSON tree at any depth is refused without reading it', () => {
  const g = counted('chain.verificationKey');
  const take = ['x', 'receiptV2.accepted[0]'];
  Object.defineProperty(take, 0, { get: g.get, enumerable: true });
  const cyclic = clone(vOwn);
  (cyclic['accepted'] as Record<string, unknown>)['self'] = cyclic['accepted'];
  const withExtra = Object.assign([...(vOwn.source['take'] as string[])], { extra: 1 });
  const sparse = ['chain.verificationKey', , 'receiptV2.accepted[0]'];
  const nested = (path: string[], value: unknown) => {
    const f = clone(vOwn);
    let at = f as Record<string, unknown>;
    for (const k of path.slice(0, -1)) at = at[k] as Record<string, unknown>;
    at[path.at(-1)!] = value;
    return f;
  };
  const vkey = vOwn['verificationKey'] as Record<string, unknown>;
  const fixtures: [string, unknown, string][] = [
    ['a getter in source.take[0]', { ...vOwn, source: { ...vOwn.source, take } }, 'kopija.source.take'],
    ['a proxy in source.take', { ...vOwn, source: { ...vOwn.source, take: new Proxy([...(vOwn.source['take'] as string[])], {}) } }, 'kopija.source.take'],
    ['a getter in verificationKey', { ...vOwn, verificationKey: Object.defineProperty({ ...vkey }, 'keyId', { get: () => vkey['keyId'], enumerable: true }) }, 'kopija.verificationKey'],
    ['a proxy in accepted.payload', nested(['accepted', 'payload'], new Proxy(clone(golden.accepted.payload), {})), 'kopija.accepted.payload'],
    ['a revoked proxy in accepted.signature', nested(['accepted', 'signature'], revoked.proxy), 'kopija.accepted.signature'],
    ['a cycle in accepted', cyclic, 'kopija.accepted'],
    ['an array with an extra property', { ...vOwn, source: { ...vOwn.source, take: withExtra } }, 'kopija.source.take'],
    ['a sparse array', { ...vOwn, source: { ...vOwn.source, take: sparse } }, 'kopija.source.take'],
    ['an array with a hole at its end', { ...vOwn, source: { ...vOwn.source, take: Object.assign([...(vOwn.source['take'] as string[])], { length: 3 }) } }, 'kopija.source.take'],
    ['NaN in accepted', nested(['accepted', 'payload', 'revision'], NaN), 'kopija.accepted.payload.revision'],
    ['a bigint in accepted', nested(['accepted', 'payload', 'revision'], 7n), 'kopija.accepted.payload.revision'],
    ['a function in accepted', nested(['accepted', 'note'], () => 1), 'kopija.accepted.note'],
    ['a Date in accepted', nested(['accepted', 'note'], new Date(0)), 'kopija.accepted.note'],
    ['a symbol key in verificationKey', { ...vOwn, verificationKey: { ...vkey, [Symbol('x')]: 1 } }, 'kopija.verificationKey'],
    ['an inherited object in accepted', nested(['accepted', 'payload'], Object.create(golden.accepted.payload) as unknown), 'kopija.accepted.payload'],
    ['a fixture without a prototype', Object.assign(Object.create(null) as object, clone(vOwn)), 'kopija'],
    ['a subclass of Array in source.take', { ...vOwn, source: { ...vOwn.source, take: class extends Array {}.from(vOwn.source['take'] as string[]) } }, 'kopija.source.take'],
  ];
  for (const [name, f, path] of fixtures) {
    let reason: string | null = null;
    assert.doesNotThrow(() => { reason = vendoredProblem(vSource, f, SHA); }, name);
    assert.equal(typeof reason, 'string', name);
    assert.equal(reason, `nema oblik (${path})`, name);
  }
  assert.equal(g.calls.n, 0, 'the getter was read');
  assert.equal(vendoredProblem(vSource, clone(vOwn), SHA), null, 'a plain clone still passes');
});
// Class 1 (#33 FAILs on 34058fd and 20d0f0d): the copy and the source pass one parser, so a degenerate
// value in either, or the same one in both, is refused at its path; the copy is parsed first.
type View = { verificationKey: unknown; accepted: unknown };
const view = (): View => clone({ verificationKey: golden.verificationKey, accepted: golden.accepted });
/** The source as the server holds it: more members in chain and a second accepted receipt. */
const sourceOf = (v: View) => Buffer.from(JSON.stringify({ chain: { verificationKey: v.verificationKey, other: 1 }, receiptV2: { other: 2, accepted: [v.accepted, { name: 'edges' }] } }));
function check(copy: View, server: View | Buffer): string | null {
  const src = Buffer.isBuffer(server) ? server : sourceOf(server);
  const blob = createHash('sha1').update(`blob ${src.byteLength}\0`).update(src).digest('hex');
  return vendoredProblem(src, { source: { ...vFixture.source, blob }, ...copy }, SHA);
}
const payload = (v: View) => (v.accepted as { payload: Obj }).payload;
const DEGENERATE: [string, (v: View) => void, string][] = [
  ...([null, {}, [], [null]] as unknown[]).map((x): [string, (v: View) => void, string] => [`verificationKey ${JSON.stringify(x)}`, (v) => { v.verificationKey = x; }, 'verificationKey']),
  ['verificationKey without keyId', (v) => { delete (v.verificationKey as Obj)['keyId']; }, 'verificationKey'],
  ['verificationKey with an extra key', (v) => { (v.verificationKey as Obj)['extra'] = 'x'; }, 'verificationKey'],
  ['an empty keyId', (v) => { (v.verificationKey as Obj)['keyId'] = ''; }, 'verificationKey.keyId'],
  ['a keyId that is a number', (v) => { (v.verificationKey as Obj)['keyId'] = 7; }, 'verificationKey.keyId'],
  ['accepted null', (v) => { v.accepted = null; }, 'accepted'],
  ['accepted {}', (v) => { v.accepted = {}; }, 'accepted'],
  ['a payload of 19 fields', (v) => { delete payload(v)['previousReceiptId']; }, 'accepted.payload'],
  ['a payload of 21 fields', (v) => { payload(v)['extra'] = 1; }, 'accepted.payload'],
  ['a signature without a field', (v) => { delete (v.accepted as { signature: Obj }).signature['keyId']; }, 'accepted.signature'],
  ...(['7', 1.5, 2 ** 53, NaN, Infinity, true] as unknown[]).map((x): [string, (v: View) => void, string] => [`revision ${String(x)}`, (v) => { payload(v)['revision'] = x; }, 'accepted.payload.revision']),
  ['a null segmentHash', (v) => { payload(v)['segmentHash'] = null; }, 'accepted.payload.segmentHash'],
  ['an empty previousReceiptId', (v) => { payload(v)['previousReceiptId'] = ''; }, 'accepted.payload.previousReceiptId'],
];
const inSource = (path: string) => path.replace(/^verificationKey/u, 'chain.verificationKey').replace(/^accepted/u, 'receiptV2.accepted[0]');
test.each(DEGENERATE)('%s is refused in the copy, in the source and in both', (_name, change, path) => {
  const changed = () => { const v = view(); change(v); return v; };
  assert.equal(check(view(), view()), null);
  assert.equal(check(changed(), view()), `nema oblik (kopija.${path})`);
  assert.equal(check(view(), changed()), `nema oblik (izvor.${inSource(path)})`);
  assert.equal(check(changed(), changed()), `nema oblik (kopija.${path})`);
});
test('a source without its chain, accepted receipts or valid UTF-8 is refused', () => {
  const v = view();
  const doc = (d: unknown) => Buffer.from(JSON.stringify(d));
  assert.equal(check(v, doc({ chain: null, receiptV2: { accepted: [v.accepted] } })), 'nema oblik (izvor.chain)');
  assert.equal(check(v, doc({ chain: [v.verificationKey], receiptV2: { accepted: [v.accepted] } })), 'nema oblik (izvor.chain)');
  assert.equal(check(v, doc({ chain: { verificationKey: v.verificationKey }, receiptV2: { accepted: [] } })), 'nema oblik (izvor.receiptV2.accepted)');
  assert.equal(check(v, doc({ chain: { verificationKey: v.verificationKey } })), 'nema oblik (izvor.receiptV2)');
  assert.equal(check(v, Buffer.concat([sourceOf(v), Buffer.from([0xff])])), 'izvor nije JSON');
  // A byte that is no UTF-8 inside a text, where a lenient decoder would read U+FFFD and match the copy.
  const replaced = view();
  (replaced.accepted as Obj)['note'] = '\ufffd';
  const bytes = sourceOf(replaced);
  const at = bytes.indexOf(Buffer.from('\ufffd'));
  assert.equal(check(replaced, Buffer.concat([bytes.subarray(0, at), Buffer.from([0xff]), bytes.subarray(at + 3)])), 'izvor nije JSON');
});
test('the real fixture passes against a source built from it, with the other members the server holds', () => {
  assert.equal(check(view(), view()), null);
  assert.equal(vendoredProblem(vSource, clone(vOwn), SHA), null);
});
