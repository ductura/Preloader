// DAN-1096 L-1: the signature of a receipt v2 (D-92) covers a prefix and the SHA-256 of the RFC 8785 text of
// its payload, which jcs writes; publicKeyFromSeed derives an Ed25519 public key from a 32-byte signing seed.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { types } from 'node:util';
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
// A receipt payload is two levels deep; anything near a stack overflow is not one.
const MAX_DEPTH = 64;
// RFC 8785 §3.2.2.2 refuses a lone surrogate, as canonicalJson of @ductura/contracts does.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The buffer and length of a view, read through the intrinsic getters: own properties cannot shadow them.
const intrinsic = (key: string) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, key)!.get!;
const viewBuffer = intrinsic('buffer');
const viewLength = intrinsic('length');
type Obj = Record<string, unknown>;
/** Own enumerable data properties only: no getter, whose reads could differ. */
const data = (value: object, key: PropertyKey): boolean => ((f) => f?.enumerable === true && Object.hasOwn(f, 'value'))(Object.getOwnPropertyDescriptor(value, key));
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
/** RFC 8785 text of a JSON value (plain objects and dense arrays of strings, finite numbers, booleans, null); else `jcs: …`. */
export const jcs = (value: unknown): string => only(() => write(value, new Set()));
/** Any other exception (a getter-free read that still throws, an engine limit) becomes `jcs: …` too. */
const only = (run: () => string): string => {
  try { return run(); } catch (e) { throw e instanceof Error && e.message.startsWith('jcs: ') ? e : new Error('jcs: not a JSON value'); }
};
/** RFC 8785 text of JSON text: parsed with JSON.parse, then written as jcs writes the value. */
export const jcsText = (text: string): string => only(() => {
  const value: unknown = typeof text === 'string' ? JSON.parse(text) : fail('jcs: not JSON text');
  uniqueNames(text);
  return write(value, new Set());
});
/** Throws when valid JSON text names a member twice in one object (RFC 8785 §3.1), even spelled another way. */
function uniqueNames(text: string): void {
  const objects: (Set<string> | null)[] = [];
  const colon = /[ \t\n\r]*:/y;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '{' || c === '[') objects.push(c === '{' ? new Set() : null);
    else if (c === '}' || c === ']') objects.pop();
    else if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const names = objects.at(-1);
      colon.lastIndex = j + 1;
      if (names && colon.test(text)) {
        const name = JSON.parse(text.slice(i, j + 1)) as string;
        if (names.has(name)) throw new Error('jcs: a name twice in one object');
        names.add(name);
      }
      i = j;
    }
  }
}
const quote = (text: string): string => (LONE_SURROGATE.test(text) ? fail('jcs: a lone surrogate') : JSON.stringify(text));
const fail = (message: string): never => { throw new Error(message); };
function write(value: unknown, path: Set<object>): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : fail('jcs: only finite numbers');
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
 * The Ed25519 public key (SPKI DER, base64url) of a 32-byte seed: a Uint8Array of any realm over an ArrayBuffer whose
 * own keys are exactly 0..31, so nothing shadows the view; the key is made from a copy that reads the view itself.
 */
export function publicKeyFromSeed(seed: Uint8Array): string {
  const refused = new Error('sjeme ključa nema 32 bajta');
  // The view's own length first (0 when detached or out of bounds), so a huge view never reaches Reflect.ownKeys.
  if (!types.isUint8Array(seed) || types.isSharedArrayBuffer(viewBuffer.call(seed)) || viewLength.call(seed) !== 32) throw refused;
  const own = ((): (string | symbol)[] => { try { return Reflect.ownKeys(seed); } catch { throw refused; } })();
  if (own.length !== 32 || own.some((k, i) => k !== String(i))) throw refused;
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, new Uint8Array(seed)]), format: 'der', type: 'pkcs8' });
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64url');
}
