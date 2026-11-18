// DAN-1096 L-1: the signature of a receipt v2 (D-92) covers a prefix and the
// SHA-256 of the RFC 8785 text of its payload. jcs writes that text for plain JSON values and throws for
// anything else; publicKeyFromSeed derives an Ed25519 public key from a
// 32-byte signing seed.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { types } from 'node:util';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
// A receipt payload is two levels deep; anything near a stack overflow is not one.
const MAX_DEPTH = 64;
// Built-ins keep their internal slots under any prototype, so the prototype alone does not make an object plain.
// The list holds every built-in structuredClone can copy; jcs leaves the rest to structuredClone's refusal.
const BUILT_IN = [
  types.isBoxedPrimitive, types.isDate, types.isMap, types.isSet, types.isWeakMap, types.isWeakSet, types.isPromise,
  types.isAnyArrayBuffer, types.isArrayBufferView, types.isRegExp, types.isNativeError, types.isGeneratorObject,
  types.isMapIterator, types.isSetIterator, types.isModuleNamespaceObject,
];

type Obj = Record<string, unknown>;

/** Own enumerable data properties only: no getter, whose reads could differ. */
const data = (value: object, key: PropertyKey): boolean => {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field !== undefined && field.enumerable === true && Object.hasOwn(field, 'value');
};

/** A plain object (write rules out arrays, proxies and built-ins) holding exactly `keys` as its own data properties. */
function exact(value: object, keys: readonly string[]): value is Obj {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((k) => data(value, k));
}

/** A plain dense array (write rules out proxies): Array.prototype, own data elements 0..length-1 and nothing else. */
function dense(value: unknown[]): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;
  // Exactly the keys 0..length-1 and length: no hole, and no extra key to make up for one.
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) if (!data(value, String(i))) return false;
  return true;
}

/** RFC 8785 for the plain JSON values a receipt payload holds; anything else throws `jcs: …`. */
export function jcs(value: unknown): string {
  const text = write(value, new Set());
  // BUILT_IN holds every built-in structuredClone can copy; structuredClone refuses all the others (iterators,
  // generators, WeakRef…) whatever their prototype. Once write has seen only data properties it reads nothing
  // user-defined.
  try {
    structuredClone(value);
  } catch {
    throw new Error('jcs: not a JSON value');
  }
  return text;
}

function write(value: unknown, path: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('jcs: only safe integers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('jcs: not a JSON value');
  if (types.isProxy(value)) throw new Error('jcs: a proxy');
  if (BUILT_IN.some((is) => is(value))) throw new Error('jcs: not a JSON value');
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
    text = `{${keys.map((k) => `${JSON.stringify(k)}:${write(value[k], path)}`).join(',')}}`;
  } else {
    throw new Error('jcs: not a JSON value');
  }
  path.delete(value);
  return text;
}

/** The Ed25519 public key (SPKI DER, base64url) of a 32-byte seed, as the stack's signer derives it. */
export function publicKeyFromSeed(seed: Uint8Array): string {
  if (!types.isUint8Array(seed) || seed.byteLength !== 32) throw new Error('sjeme ključa nema 32 bajta');
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64url');
}
