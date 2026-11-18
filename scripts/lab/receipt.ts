// DAN-1096 L-1: the signature of a receipt v2 (D-92) covers a prefix and the
// SHA-256 of the RFC 8785 text of its payload. jcs writes that text for plain JSON values and throws for
// anything else; publicKeyFromSeed derives an Ed25519 public key from a
// 32-byte signing seed.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { types } from 'node:util';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
// A receipt payload is two levels deep; anything near a stack overflow is not one.
const MAX_DEPTH = 64;
// RFC 8785 §3.2.2.2 refuses a lone surrogate, as canonicalJson of @ductura/contracts does.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The buffer of a view, read through the intrinsic getter: an own `buffer` property cannot shadow it.
const viewBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;

type Obj = Record<string, unknown>;

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
