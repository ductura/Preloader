// DAN-1096 L-1: a receipt counts only with a signature verified under the
// stack's key over exactly the lab's commit (review and QA finding 1 on
// 3e05a73b: status 'signed' alone passed). The contract vector is the
// server's own (test/fixtures/receipt-v2-golden.json); its key is RFC 8032
// test 1, whose public seed lets each case below be signed for real.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import openapi from '@ductura/contracts/openapi/v1.json' with { type: 'json' };
import { Ajv } from 'ajv';

import { type ReceiptExpectation, type ReceiptTrust, checkReceipt, jcs, publicKeyFromSeed, registryRow } from '../scripts/lab/receipt.ts';
import { vendoredProblem } from '../scripts/lab/vendored.ts';

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

// Review 2 and QA 1 on 55f02977: L-1 checks the value and type of every payload
// field, not its presence. The oracle is the server's contract schema of the
// payload (@ductura/contracts openapi), so the rules here cannot drift from it.
type Schema = { properties?: Record<string, { const?: unknown }> } & Record<string, unknown>;
function payloadSchema(node: unknown): Schema | null {
  if (typeof node !== 'object' || node === null) return null;
  if ((node as Schema).properties?.['receiptSchema']?.const === 'ductus-evidence-receipt-v2') return node as Schema;
  for (const child of Object.values(node)) {
    const found = payloadSchema(child);
    if (found !== null) return found;
  }
  return null;
}
const contract = new Ajv({ strict: false }).compile(payloadSchema(openapi)!);
const BAD: unknown[] = [
  null, undefined, 0, -1, -0, 1.5, NaN, Infinity, 2 ** 53, true, '', ' ', ' ', '\t', '\r\n', ' ', '\u007f', 'x'.repeat(257),
  '1', {}, [], ['r-1'], JSON.parse('{"toString":null}'), JSON.parse('{"__proto__":{"a":1}}'), 'tx\r\n', 'tx\t', 'tx\u007f', 'tx\u0085',
];
const GOOD: unknown[] = ['r-0', 'a b', 'x'.repeat(120), 'a'.repeat(64), 1, 2, Number.MAX_SAFE_INTEGER, null,
  'ductus-evidence-segment-v3', '2026-10-03T06:05:00.000Z', '6f1c2b7e-0d4a-4c3b-9a8e-1b2c3d4e5f60'];
const COMPARED = new Set(['receiptSchema', 'evidenceDomainId', ...Object.keys(expected)]);

/** The vector with `key` set to `value`: signed when JCS can spell it, else as it stands. */
function swapped(key: string, value: unknown) {
  const payload = { ...clone(p), [key]: value };
  if (value === undefined) delete payload[key];
  try {
    return signed(payload);
  } catch {
    const r = vector();
    r.signedReceipt.payload = payload;
    return r;
  }
}

test('every payload field the contract refuses is refused, signed or not', () => {
  for (const key of Object.keys(p)) {
    for (const value of BAD) {
      const payload = { ...clone(p), [key]: value };
      if (value === undefined) delete payload[key];
      if (contract(payload)) continue;
      assert.notEqual(checkReceipt(swapped(key, value), trust, expected), null, `${key}: ${String(JSON.stringify(value))}`);
    }
  }
  assert.equal(contract({ ...clone(p), receiptId: null }), false);
  assert.match(checkReceipt(swapped('receiptId', null), trust, expected) ?? '', /oblik v2/);
});

test('a field the contract accepts is not refused when the lab does not compare it', () => {
  for (const key of Object.keys(p).filter((k) => !COMPARED.has(k))) {
    for (const value of [...GOOD, ...BAD]) {
      const payload = { ...clone(p), [key]: value };
      if (value === undefined || !contract(payload)) continue;
      assert.equal(checkReceipt(signed(payload), trust, expected), null, `${key}: ${JSON.stringify(value)}`);
    }
  }
});

test('text length is counted in UTF-16 units, as the server counts it', () => {
  assert.equal(checkReceipt(signed({ ...clone(p), receiptId: '\u{1F600}'.repeat(128) }), trust, expected), null);
  assert.notEqual(checkReceipt(signed({ ...clone(p), receiptId: '\u{1F600}'.repeat(129) }), trust, expected), null);
  assert.equal(contract({ ...clone(p), receiptId: '\u{1F600}'.repeat(129) }), true, 'ajv counts code points');
});

// DAN-1096-a1 class fix: the check never throws and never passes an empty or
// incomplete input (the class review and QA broke on #26 three times).
const counted = (value: unknown) => {
  const calls = { n: 0 };
  return { calls, get: () => { calls.n += 1; return value; } };
};
const throwing = () => { throw new Error('getter'); };
function withGetter(path: 'envelope' | 'signedReceipt' | 'signature' | 'payload', get: () => unknown) {
  const r = vector() as Record<string, unknown> & ReturnType<typeof vector>;
  const at = { envelope: r, signedReceipt: r.signedReceipt, signature: r.signedReceipt.signature, payload: r.signedReceipt.payload }[path];
  const key = { envelope: 'status', signedReceipt: 'payloadDigestSha256', signature: 'keyId', payload: 'revision' }[path];
  Object.defineProperty(at, key, { get, enumerable: true });
  return r;
}
const revoked = Proxy.revocable({}, {});
revoked.revoke();
const trap = (name: 'ownKeys' | 'getPrototypeOf') => new Proxy(vector(), { [name]: throwing });
const proxiedPayload = (() => { const r = vector(); r.signedReceipt.payload = new Proxy(r.signedReceipt.payload, {}); return r; })();
const { documentId: _d, ...noDocument } = expected;

const neverThrows: [string, unknown, ReceiptTrust, unknown][] = [
  ...(['envelope', 'signedReceipt', 'signature', 'payload'] as const).map((at): [string, unknown, ReceiptTrust, unknown] => [`a throwing getter on ${at}`, withGetter(at, throwing), trust, expected]),
  ['a proxy whose ownKeys throws', trap('ownKeys'), trust, expected],
  ['a proxy whose getPrototypeOf throws', trap('getPrototypeOf'), trust, expected],
  ['a revoked proxy', revoked.proxy, trust, expected],
  ['a harmless proxy around a good receipt', new Proxy(vector(), {}), trust, expected],
  ['a harmless proxy around the payload', proxiedPayload, trust, expected],
  ['an empty expectation', vector(), trust, {}],
  ['an expectation without the document', vector(), trust, noDocument],
  ['an expectation with an extra field', vector(), trust, { ...expected, extra: 'x' }],
  ['an empty trusted key id', vector(), { ...trust, keyId: '' }, expected],
  ['an empty trusted domain', vector(), { ...trust, evidenceDomainId: '' }, expected],
  ['a trust that is null', vector(), null as unknown as ReceiptTrust, expected],
  // Codex on f1401f9: a non-enumerable expectation was checked but never compared.
  ['a hidden wrong document in the expectation', vector(), trust, Object.defineProperty({ ...expected }, 'documentId', { value: 'wrong-document', enumerable: false })],
  ['a hidden field in the payload', (() => { const r = vector(); Object.defineProperty(r.signedReceipt.payload, 'receiptId', { enumerable: false }); return r; })(), trust, expected],
];

for (const [name, receipt, t, e] of neverThrows) {
  test(`gives a reason, never an exception, for ${name}`, () => {
    let reason: string | null = null;
    assert.doesNotThrow(() => { reason = checkReceipt(receipt, t, e as ReceiptExpectation); });
    assert.equal(typeof reason, 'string');
  });
}

test('a getter that returns the right value is refused without being called', () => {
  const g = counted(7);
  assert.notEqual(checkReceipt(withGetter('payload', g.get), trust, expected), null);
  assert.equal(g.calls.n, 0);
});

test('a payload without a prototype passes', () => {
  const r = vector();
  r.signedReceipt.payload = Object.assign(Object.create(null) as Record<string, unknown>, r.signedReceipt.payload);
  assert.equal(checkReceipt(r, trust, expected), null);
});

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

const BAD_SHA: unknown[] = ['', ' ', '\t', ' ', `${SHA}\r\n`, `\n${SHA}`, `${SHA}\u007f`, ` ${SHA}`, SHA.slice(1), `${SHA}0`, SHA.toUpperCase(), undefined, null, 40];

test('an empty or malformed SHA is refused, even when both sides are equal', () => {
  for (const sha of BAD_SHA) {
    const both = { ...vOwn, source: { ...vOwn.source, commit: sha } };
    assert.notEqual(vendoredProblem(vSource, vOwn, sha), null, JSON.stringify(sha));
    assert.notEqual(vendoredProblem(vSource, both, sha), null, JSON.stringify(sha));
  }
});

test('a malformed fixture or source gives a reason, never an exception', () => {
  const { accepted: _a, ...noAccepted } = vOwn;
  const fixtures: unknown[] = [
    null, [], {}, 'x', { verificationKey: vOwn['verificationKey'], accepted: vOwn['accepted'] }, { ...vOwn, source: null },
    { ...vOwn, source: Object.create(vOwn.source) as unknown }, JSON.parse(`{"__proto__":${JSON.stringify(vOwn)}}`),
    JSON.parse('{"toString":null}'), { ...vOwn, extra: 1 }, noAccepted, { ...vOwn, source: { ...vOwn.source, repository: 'x/y' } },
    // Codex on f1401f9: the exported check must not throw on getters or proxies either.
    Object.defineProperty({ verificationKey: vOwn['verificationKey'], accepted: vOwn['accepted'] }, 'source', { get: throwing, enumerable: true }),
    revoked.proxy, new Proxy(vOwn, {}), { ...vOwn, source: new Proxy(vOwn.source, {}) },
    Object.defineProperty({ ...vOwn }, 'accepted', { enumerable: false }),
  ];
  for (const [i, f] of fixtures.entries()) {
    assert.doesNotThrow(() => vendoredProblem(vSource, f, SHA), `fixture ${i}`);
    assert.notEqual(vendoredProblem(vSource, f, SHA), null, `fixture ${i}`);
  }
  for (const doc of ['nije json', '{}', JSON.stringify({ chain: vendoredDoc.chain, receiptV2: { accepted: [] } })]) {
    const src = Buffer.from(doc);
    const blob = createHash('sha1').update(`blob ${src.byteLength}\0`).update(src).digest('hex');
    const own = { ...vOwn, source: { ...vOwn.source, blob } };
    assert.doesNotThrow(() => vendoredProblem(src, own, SHA));
    assert.notEqual(vendoredProblem(src, own, SHA), null, doc);
  }
});

test('the vendored CLI fails with a message, not a stack trace', () => {
  const cli = fileURLToPath(new URL('../scripts/lab/vendored.ts', import.meta.url));
  const fixturePath = fileURLToPath(new URL('fixtures/receipt-v2-golden.json', import.meta.url));
  const { SERVER_SHA: _s, ...env } = process.env;
  const runs: [string[], Record<string, string>][] = [
    [[cli, '.', fixturePath], {}],
    [[cli, '.', fixturePath], { SERVER_SHA: ' ' }],
    [[cli], { SERVER_SHA: SHA }],
    [[cli, '.', 'nema-ove-datoteke.json'], { SERVER_SHA: SHA }],
  ];
  for (const [args, extra] of runs) {
    const run = spawnSync(process.execPath, args, { cwd: tmpdir(), env: { ...env, ...extra }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.status, 1, `${args.length} ${JSON.stringify(extra)}`);
    assert.match(run.stderr, /^Vendorirani vektor: /);
    assert.doesNotMatch(run.stderr, /^\s+at /m);
  }
});
