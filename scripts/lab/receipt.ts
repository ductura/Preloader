// DAN-1096 L-1: a signed receipt v2 (D-92) counts only when its Ed25519
// signature verifies here, with node:crypto, under the stack's own receipt
// key, and it names exactly the commit the lab sent. The key comes from the
// stack's signing seed and the key registry, never from a server response.
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';

/** The receipt key the lab trusts: derived from the seed, labelled by the registry. */
export type ReceiptTrust = { keyBase64Url: string; keyId: string; keyVersion: string; evidenceDomainId: string };

/** What the receipt has to name: the lab's own commit, segment and student. */
export type ReceiptExpectation = {
  documentId: string;
  clientTransactionId: string;
  revision: number;
  principalId: string;
  segmentHash: string;
};

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const PREFIX = Buffer.from('ductus-evidence-receipt-v2\n', 'utf8');
// Order of the Ed25519 group: an S at or above it is a second spelling of a signature.
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const RECEIPT = ['status', 'signedReceipt'];
const SIGNED = ['payload', 'payloadDigestSha256', 'signature'];
const SIGNATURE = ['algorithm', 'keyId', 'keyVersion', 'signatureEncoding', 'signatureBase64Url'];
const PAYLOAD = [
  'receiptSchema', 'receiptId', 'evidencePackageId', 'documentId', 'sessionId', 'segmentId', 'segmentHash',
  'predecessorSegmentHash', 'previousReceiptId', 'evidenceSchema', 'evidenceProfileId', 'sequenceFrom',
  'sequenceTo', 'eventCount', 'payloadBytes', 'acceptedAt', 'revision', 'clientTransactionId',
  'evidenceDomainId', 'principalId',
];

type Obj = Record<string, unknown>;

/** A plain object holding exactly `keys` as its own properties: nothing inherited, nothing extra. */
function exact(value: unknown, keys: readonly string[]): value is Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/** RFC 8785 for the values a receipt payload holds; anything else throws. */
export function jcs(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('jcs: only safe integers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (typeof value === 'object' && exact(value, Object.keys(value))) {
    // Plain sort compares UTF-16 code units, which is the order of RFC 8785.
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs((value as Obj)[k])}`).join(',')}}`;
  }
  throw new Error('jcs: not a JSON value');
}

/** Strict unpadded base64url of exactly `length` bytes, or null. */
function base64Url(text: unknown, length: number): Buffer | null {
  if (typeof text !== 'string' || text.length !== Math.ceil((length * 4) / 3) || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.byteLength === length && bytes.toString('base64url') === text ? bytes : null;
}

/** The Ed25519 public key (SPKI DER, base64url) of a 32-byte seed, as the stack's signer derives it. */
export function publicKeyFromSeed(seed: Uint8Array): string {
  if (seed.byteLength !== 32) throw new Error('sjeme ključa nema 32 bajta');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64url');
}

/** One registry row `key_id|key_version|evidence_domain_id` (psql -t -A), or null. */
export function registryRow(output: string): Omit<ReceiptTrust, 'keyBase64Url'> | null {
  const lines = output.split('\n').filter((line) => line !== '');
  if (lines.length !== 1) return null;
  const fields = lines[0]!.split('|');
  if (fields.length !== 3 || fields.some((f) => !/^[\x21-\x7e]+$/.test(f))) return null;
  const [keyId, keyVersion, evidenceDomainId] = fields as [string, string, string];
  return UUID_V4.test(evidenceDomainId) ? { keyId, keyVersion, evidenceDomainId } : null;
}

/** Null when `receipt` is a signed receipt v2 of exactly `expected` under `trust`; otherwise why not. */
export function checkReceipt(receipt: unknown, trust: ReceiptTrust, expected: ReceiptExpectation): string | null {
  if (!exact(receipt, RECEIPT) || receipt['status'] !== 'signed') return 'potvrda nije potpisana';
  const signed = receipt['signedReceipt'];
  if (!exact(signed, SIGNED)) return 'potpisana potvrda nema oblik v2';
  const { payload, signature } = signed;
  if (!exact(signature, SIGNATURE) || !exact(payload, PAYLOAD)) return 'potpisana potvrda nema oblik v2';
  if (signature['algorithm'] !== 'Ed25519' || signature['signatureEncoding'] !== 'raw') return 'potpis nije Ed25519';
  if (signature['keyId'] !== trust.keyId || signature['keyVersion'] !== trust.keyVersion) return 'potpis nije ključem stoga';
  const sig = base64Url(signature['signatureBase64Url'], 64);
  if (sig === null || BigInt(`0x${Buffer.from(sig.subarray(32)).reverse().toString('hex')}`) >= L) return 'potpis nije ispravno zapisan';
  const spki = base64Url(trust.keyBase64Url, 44);
  if (spki === null || !spki.subarray(0, 12).equals(SPKI_ED25519)) return 'ključ stoga nije Ed25519';
  let canonical: string;
  try {
    canonical = jcs(payload);
  } catch {
    return 'potpisana potvrda nema oblik v2';
  }
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  if (signed['payloadDigestSha256'] !== digest.toString('hex')) return 'sažetak potvrde ne odgovara';
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  if (!verify(null, Buffer.concat([PREFIX, digest]), key, sig)) return 'potpis ne vrijedi';
  const names: [string, unknown][] = [
    ['receiptSchema', 'ductus-evidence-receipt-v2'],
    ['evidenceDomainId', trust.evidenceDomainId],
    ...Object.entries(expected),
  ];
  const wrong = names.find(([k, v]) => payload[k] !== v);
  return wrong === undefined ? null : `potvrda ne imenuje ovaj commit (${wrong[0]})`;
}
