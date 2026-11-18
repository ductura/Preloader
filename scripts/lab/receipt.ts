// DAN-1096 L-1: the signature of a receipt v2 (D-92) covers a prefix and the
// SHA-256 of the RFC 8785 text of its payload. jcs writes that text for plain JSON values and throws for
// anything else; publicKeyFromSeed derives an Ed25519 public key from a
// 32-byte signing seed; checkReceipt passes a receipt only when its signature
// verifies under the trusted key and it names exactly the expected commit.
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { types } from 'node:util';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
// A receipt payload is two levels deep; anything near a stack overflow is not one.
const MAX_DEPTH = 64;
// RFC 8785 §3.2.2.2 refuses a lone surrogate, as canonicalJson of @ductura/contracts does.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The buffer of a view, read through the intrinsic getter: an own `buffer` property cannot shadow it.
const viewBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;

type Obj = Record<string, unknown>;

/** The receipt key the lab trusts: derived from the seed, labelled by the registry. */
export type ReceiptTrust = { keyBase64Url: string; keyId: string; keyVersion: string; evidenceDomainId: string };

/** What the receipt has to name: the lab's own commit, segment and student. */
export type ReceiptExpectation = { documentId: string; clientTransactionId: string; revision: number; principalId: string; segmentHash: string };

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const PREFIX = Buffer.from('ductus-evidence-receipt-v2\n', 'utf8');
// Order of the Ed25519 group: an S at or above it is a second spelling of a signature.
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const RECEIPT = ['status', 'signedReceipt'];
const SIGNED = ['payload', 'payloadDigestSha256', 'signature'];
const SIGNATURE = ['algorithm', 'keyId', 'keyVersion', 'signatureEncoding', 'signatureBase64Url'];
type Rule = (v: unknown) => boolean;
const str = (v: unknown): v is string => typeof v === 'string';
// Text(n) of the server contract: length in UTF-16 units (TypeBox, value.length), not code points.
const text = (max: number): Rule => (v) => str(v) && v.length >= 1 && v.length <= max && /\S/u.test(v);
const match = (re: RegExp): Rule => (v) => str(v) && re.test(v);
const oneOf = (...values: string[]): Rule => (v) => str(v) && values.includes(v);
const orNull = (rule: Rule): Rule => (v) => v === null || rule(v);
const positive: Rule = (v) => Number.isSafeInteger(v) && (v as number) >= 1;
const sha256 = match(/^[0-9a-f]{64}$/);
const uuid = match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
/** Value and type of every payload field: SignedReceipt of ductura/server server/contracts/routes/evidence.ts. */
const PAYLOAD_TYPES: Record<string, Rule> = {
  receiptSchema: oneOf('ductus-evidence-receipt-v2'),
  receiptId: text(256), evidencePackageId: text(256), documentId: text(256), sessionId: text(256), segmentId: text(256),
  segmentHash: sha256, predecessorSegmentHash: orNull(sha256), previousReceiptId: orNull(text(256)),
  evidenceSchema: oneOf('ductus-evidence-segment-v2', 'ductus-evidence-segment-v3'),
  evidenceProfileId: text(120), sequenceFrom: positive, sequenceTo: positive, eventCount: positive, payloadBytes: positive,
  acceptedAt: match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/), revision: positive,
  clientTransactionId: (v) => str(v) && v.length <= 128 && /^(?=.*\S)[^\u0000-\u001f\u007f-\u009f]+$/u.test(v),
  evidenceDomainId: uuid, principalId: uuid,
};
const PAYLOAD = Object.keys(PAYLOAD_TYPES);
// Key labels as registryRow reads them and the server generates them, within the contract's lengths (keyId 2048,
// keyVersion 256); narrower than the database CHECK, so it fails closed.
const keyLabel = (max: number): Rule => (v) => str(v) && v.length <= max && /^[\x21-\x7e]+$/.test(v);
const TRUST: Record<keyof ReceiptTrust, Rule> = {
  keyBase64Url: (v) => base64Url(v, 44)?.subarray(0, 12).equals(SPKI_ED25519) === true, keyId: keyLabel(2048), keyVersion: keyLabel(256), evidenceDomainId: uuid,
};
// The same rules as the payload fields they are compared with.
const EXPECTED = Object.fromEntries(['documentId', 'clientTransactionId', 'revision', 'principalId', 'segmentHash'].map((k) => [k, PAYLOAD_TYPES[k]!]));

/** An object that is neither null, a Proxy nor an array: only then are its descriptors read (exact then wants Object.prototype). */
const plain = (v: unknown): v is object => typeof v === 'object' && v !== null && !types.isProxy(v) && !Array.isArray(v);

/** Own enumerable data properties only: no getter, whose reads could differ. */
const data = (value: object, key: PropertyKey): boolean => {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && field.enumerable === true && Object.hasOwn(field, 'value');
};

/** An object with prototype Object.prototype holding exactly `keys` as its own data properties. */
function exact(value: object, keys: readonly string[]): value is Obj {
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((k) => data(value, k));
}

/** A plain dense array: Array.prototype, own data elements 0..length-1 and nothing else. */
function dense(value: unknown[]): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;
  // Exactly the keys 0..length-1 and length: no hole, and no extra key to make up for one.
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) if (!data(value, String(i))) return false;
  return true;
}

/**
 * RFC 8785 text of a JSON value: either JSON text, parsed with JSON.parse, or a value made only of plain
 * objects (prototype Object.prototype), plain dense arrays, strings, finite numbers, booleans and null,
 * held in own enumerable data properties. Anything else throws `jcs: …`. A built-in or a class instance
 * whose prototype was set to Object.prototype cannot be told from {} in JavaScript; it is not a JSON value.
 */
export function jcs(input: unknown): string {
  if (typeof input !== 'string') return write(input, new Set());
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error('jcs: not JSON text');
  }
  return write(value, new Set());
}

const quote = (text: string): string => {
  if (LONE_SURROGATE.test(text)) throw new Error('jcs: a lone surrogate');
  return JSON.stringify(text);
};

function write(value: unknown, path: Set<object>): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('jcs: only finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('jcs: not a JSON value');
  if (types.isProxy(value)) throw new Error('jcs: a proxy');
  if (path.has(value)) throw new Error('jcs: a cycle');
  if (path.size >= MAX_DEPTH) throw new Error('jcs: too deep');
  path.add(value);
  let text: string;
  if (Array.isArray(value)) {
    if (!dense(value)) throw new Error('jcs: not a plain dense array');
    text = `[${value.map((v) => write(v, path)).join(',')}]`;
  } else if (exact(value, Object.keys(value))) {
    // Plain sort compares UTF-16 code units, which is the order of RFC 8785.
    const keys = Object.keys(value).sort();
    text = `{${keys.map((k) => `${quote(k)}:${write(value[k], path)}`).join(',')}}`;
  } else {
    throw new Error('jcs: not a JSON value');
  }
  path.delete(value);
  return text;
}

/**
 * The Ed25519 public key (SPKI DER, base64url) of a 32-byte seed, as the stack's signer derives it. The seed
 * is a Uint8Array of any realm over an ArrayBuffer; its own keys are only its indices, so no own
 * `length` or `byteLength` shadows the view, and the key is made from a copy that reads the view itself.
 */
export function publicKeyFromSeed(seed: Uint8Array): string {
  if (!types.isUint8Array(seed) || types.isSharedArrayBuffer(viewBuffer.call(seed))) throw new Error('sjeme ključa nema 32 bajta');
  // Own keys first: a detached or out-of-bounds view has none, so it never reaches the copy, which would throw.
  if (Reflect.ownKeys(seed).length !== 32) throw new Error('sjeme ključa nema 32 bajta');
  const bytes = new Uint8Array(seed);
  if (bytes.length !== 32) throw new Error('sjeme ključa nema 32 bajta');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, bytes]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64url');
}

/** Strict unpadded base64url of exactly `length` bytes, or null. */
function base64Url(text: unknown, length: number): Buffer | null {
  if (typeof text !== 'string' || text.length !== Math.ceil((length * 4) / 3) || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.byteLength === length && bytes.toString('base64url') === text ? bytes : null;
}

/** `name` or `name.field` when `value` is not exactly `rules`' fields, each obeying its rule; otherwise null. */
function bad(value: unknown, rules: Record<string, Rule>, name: string): string | null {
  if (!plain(value) || !exact(value, Object.keys(rules))) return name;
  const field = Object.keys(rules).find((k) => !rules[k]!(value[k]));
  return field === undefined ? null : `${name}.${field}`;
}

/**
 * Null when `receipt` is a signed receipt v2 of exactly `expected` under `trust`;
 * otherwise why not. Never throws: the catch is defensive, since only data
 * properties are read after the plain-object guard.
 */
export function checkReceipt(receipt: unknown, trust: ReceiptTrust, expected: ReceiptExpectation): string | null {
  try {
    const lab = bad(trust, TRUST, 'trust') ?? bad(expected, EXPECTED, 'expected');
    return lab === null ? check(receipt, trust, expected) : `laboratorij nema ispravan ključ stoga ili commit (${lab})`;
  } catch {
    return 'potvrda se ne može pročitati';
  }
}

const shaped = (v: unknown, keys: readonly string[]): v is Obj => plain(v) && exact(v, keys);

function check(receipt: unknown, trust: ReceiptTrust, expected: ReceiptExpectation): string | null {
  if (!shaped(receipt, RECEIPT) || receipt['status'] !== 'signed') return 'potvrda nije potpisana';
  const signed = receipt['signedReceipt'];
  if (!shaped(signed, SIGNED)) return 'potpisana potvrda nema oblik v2';
  const { payload, signature } = signed;
  if (!shaped(signature, SIGNATURE) || !shaped(payload, PAYLOAD)) return 'potpisana potvrda nema oblik v2';
  if (![...SIGNATURE.map((k) => signature[k]), signed['payloadDigestSha256']].every(str)) return 'potpisana potvrda nema oblik v2';
  const badType = PAYLOAD.find((k) => !PAYLOAD_TYPES[k]!(payload[k]));
  if (badType !== undefined) return `potpisana potvrda nema oblik v2 (${badType})`;
  if (signature['algorithm'] !== 'Ed25519' || signature['signatureEncoding'] !== 'raw') return 'potpis nije Ed25519';
  if (signature['keyId'] !== trust.keyId || signature['keyVersion'] !== trust.keyVersion) return 'potpis nije ključem stoga';
  const sig = base64Url(signature['signatureBase64Url'], 64);
  if (sig === null || BigInt(`0x${Buffer.from(sig.subarray(32)).reverse().toString('hex')}`) >= L) return 'potpis nije ispravno zapisan';
  let canonical: string;
  try {
    canonical = jcs(payload);
  } catch {
    return 'potpisana potvrda nema oblik v2';
  }
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  if (signed['payloadDigestSha256'] !== digest.toString('hex')) return 'sažetak potvrde ne odgovara';
  const key = createPublicKey({ key: base64Url(trust.keyBase64Url, 44)!, format: 'der', type: 'spki' });
  if (!verify(null, Buffer.concat([PREFIX, digest]), key, sig)) return 'potpis ne vrijedi';
  const names: [string, unknown][] = [
    ['receiptSchema', 'ductus-evidence-receipt-v2'],
    ['evidenceDomainId', trust.evidenceDomainId],
    ...Object.keys(EXPECTED).map((k): [string, unknown] => [k, (expected as Obj)[k]]),
  ];
  const wrong = names.find(([k, v]) => payload[k] !== v);
  return wrong === undefined ? null : `potvrda ne imenuje ovaj commit (${wrong[0]})`;
}
