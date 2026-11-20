// DAN-1096: test/fixtures/receipt-v2-golden.json is a copy of two values of the server's golden vectors.
// vendoredProblem checks the copy against its source at SERVER_SHA, so the copy never drifts. The copy
// and the two source values pass one parser driven by the schema below, and only the parsed values are
// compared: no getter is ever called, and null, {}, [] or an incomplete object never pass as equal.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
/** The one source the copy may come from. */
export const SOURCE_PATH = 'server/domain/forensics/golden-vectors/evidence-v2.json';
const SHA = /^[0-9a-f]{40}$/;
const TAKE = ['chain.verificationKey', 'receiptV2.accepted[0]'];
/** Non-empty text, a safe integer, text or null, an array of a fixed length, or an object of exactly these keys. */
type Shape = 'text' | 'int' | 'text?' | readonly ['array', Shape, number] | { readonly [key: string]: Shape };
const all = (keys: string, shape: Shape): Record<string, Shape> => Object.fromEntries(keys.split(' ').map((k) => [k, shape]));
const VERIFICATION_KEY: Shape = all('algorithm keyId keyVersion encoding spkiDerHex signingSeedSha256', 'text');
const ACCEPTED: Shape = {
  ...all('name note', 'text'),
  payload: {
    ...all('receiptSchema receiptId evidenceDomainId evidencePackageId documentId', 'text'), revision: 'int',
    ...all('clientTransactionId principalId sessionId segmentId segmentHash', 'text'), ...all('predecessorSegmentHash previousReceiptId', 'text?'),
    ...all('evidenceSchema evidenceProfileId', 'text'), ...all('sequenceFrom sequenceTo eventCount payloadBytes', 'int'), acceptedAt: 'text',
  },
  ...all('canonical canonicalUtf8Hex', 'text'),
  byteLength: 'int',
  ...all('payloadDigestSha256 signingInputHex signatureHex', 'text'),
  signature: all('algorithm keyId keyVersion signatureEncoding signatureBase64Url', 'text'),
};
const FIXTURE: Shape = { source: { ...all('repository commit path blob', 'text'), take: ['array', 'text', 2] }, verificationKey: VERIFICATION_KEY, accepted: ACCEPTED };
/** The schema path of the first value that does not have its shape; built from schema names only. */
class Shapeless extends Error {}
/** Own enumerable data property `key` of `value`, read through its descriptor; else the parent has no shape. */
function member(value: object, key: string, path: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (field === undefined || field.enumerable !== true || !Object.hasOwn(field, 'value')) throw new Shapeless(path);
  return field.value;
}
/** `value` parsed by `shape` into new plain values; a Proxy is refused before anything else is asked of it. */
function parse(value: unknown, shape: Shape, path: string): unknown {
  if (shape === 'text?' && value === null) return null;
  if (shape === 'text' || shape === 'text?' || shape === 'int') {
    if (shape === 'int' ? Number.isSafeInteger(value) : typeof value === 'string' && value !== '') return value;
    throw new Shapeless(path);
  }
  if (typeof value !== 'object' || value === null || types.isProxy(value)) throw new Shapeless(path);
  // Prototype and length first: own keys are listed only of a value that may have the shape (QA on d302d06).
  if (Array.isArray(shape)) {
    const [, item, length] = shape as readonly ['array', Shape, number];
    // A dense plain array has exactly its indices and length as own keys.
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length || Reflect.ownKeys(value).length !== length + 1) throw new Shapeless(path);
    return Array.from({ length }, (_, i) => parse(member(value, String(i), path), item, `${path}[${i}]`));
  }
  const keys = Object.keys(shape);
  // An array has Array.prototype, so it is refused here too.
  if (Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length) throw new Shapeless(path);
  return Object.fromEntries(keys.map((k) => [k, parse(member(value, k, path), (shape as Record<string, Shape>)[k]!, `${path}.${k}`)]));
}
/** A member of a plain object of the source whose other members are not read. */
function inSource(value: unknown, key: string, path: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Shapeless(path);
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : (() => { throw new Shapeless(`${path}.${key}`); })();
}
/**
 * Null when `fixture` holds exactly the source's values and names the source's blob and commit; otherwise
 * why not. A SHA is exactly 40 lowercase hex characters. Never throws.
 */
export function vendoredProblem(source: Buffer, fixture: unknown, serverSha: unknown): string | null {
  try { return problem(source, fixture, serverSha); } catch (error) {
    return error instanceof Shapeless ? `nema oblik (${error.message})` : 'kopija ili izvor se ne mogu pročitati';
  }
}
function problem(source: Buffer, fixture: unknown, serverSha: unknown): string | null {
  if (typeof serverSha !== 'string' || !SHA.test(serverSha)) return 'SERVER_SHA nije puni SHA commita';
  const copy = parse(fixture, FIXTURE, 'kopija') as { source: Record<string, unknown>; verificationKey: unknown; accepted: unknown };
  const from = copy.source;
  if (from['repository'] !== 'ductura/server') return 'kopija nije iz ductura/server';
  if (from['path'] !== SOURCE_PATH) return `kopija nije iz ${SOURCE_PATH}`;
  if (!isDeepStrictEqual(from['take'], TAKE)) return 'kopija ne navodi što je preuzeto';
  const blob = createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex');
  if (from['blob'] !== blob) return `izvor nije blob ${JSON.stringify(from['blob'])}`;
  if (!SHA.test(from['commit'] as string)) return 'kopija ne navodi puni SHA commita';
  if (from['commit'] !== serverSha) return `kopija je iz ${from['commit'] as string}, a CI veže ${serverSha}`;
  let doc: unknown;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)); } catch { return 'izvor nije JSON'; }
  const key = parse(inSource(inSource(doc, 'chain', 'izvor'), 'verificationKey', 'izvor.chain'), VERIFICATION_KEY, 'izvor.chain.verificationKey');
  const accepted = inSource(inSource(doc, 'receiptV2', 'izvor'), 'accepted', 'izvor.receiptV2');
  if (!Array.isArray(accepted) || accepted.length === 0) throw new Shapeless('izvor.receiptV2.accepted');
  const first = parse(accepted[0], ACCEPTED, 'izvor.receiptV2.accepted[0]');
  if (!isDeepStrictEqual(copy.verificationKey, key)) return 'verificationKey se razlikuje od izvora';
  if (!isDeepStrictEqual(copy.accepted, first)) return 'accepted[0] se razlikuje od izvora';
  return null;
}
