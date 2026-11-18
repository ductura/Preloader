// DAN-1096: test/fixtures/receipt-v2-golden.json is a copy of two values of
// the server's golden vectors. The lab-oporavak CI job runs this against the
// server checkout at SERVER_SHA, so the copy never drifts from its source.
//   node scripts/lab/vendored.ts <server checkout> <fixture>
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one source the copy may come from. */
export const SOURCE_PATH = 'server/domain/forensics/golden-vectors/evidence-v2.json';

type Obj = Record<string, unknown>;
const SHA = /^[0-9a-f]{40}$/;
const FIXTURE = ['source', 'verificationKey', 'accepted'];
const SOURCE = ['repository', 'commit', 'path', 'blob', 'take'];
const TAKE = ['chain.verificationKey', 'receiptV2.accepted[0]'];

/** An object holding exactly `keys` as its own enumerable data properties; no getter, no Proxy. Only own properties are read. */
function exact(value: unknown, keys: readonly string[]): value is Obj {
  if (typeof value !== 'object' || value === null || types.isProxy(value) || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((k) => {
    const field = Object.getOwnPropertyDescriptor(value, k);
    return field !== undefined && field.enumerable === true && Object.hasOwn(field, 'value');
  });
}

/**
 * A value JSON.parse could have made, at every depth: null, a boolean, a
 * string, a finite number, or a plain array or object of such values held in
 * own enumerable data properties. No getter, Proxy, cycle or other prototype,
 * so comparing it later reads only plain data.
 */
function jsonTree(value: unknown, path: Set<object> = new Set()): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || types.isProxy(value) || path.has(value)) return false;
  const array = Array.isArray(value);
  const proto: unknown = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value).filter((k) => !(array && k === 'length'));
  if (array && (keys.length !== value.length || keys.some((k, i) => k !== String(i)))) return false;
  path.add(value);
  const ok = keys.every((k) => {
    const field = Object.getOwnPropertyDescriptor(value, k);
    return typeof k === 'string' && field?.enumerable === true && Object.hasOwn(field, 'value') && jsonTree(field.value, path);
  });
  path.delete(value);
  return ok;
}

/** One line: control and line-separator characters of any input become '?'. */
const oneLine = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, '?');

/** True when the script at `url` is the one node was started with, also through a link; on every Node 24. */
export function isEntry(argv1: string | undefined, url: string): boolean {
  try {
    return argv1 !== undefined && realpathSync(argv1) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/** An own property of a JSON object, or undefined; nothing inherited. */
const own = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Obj)[key] : undefined;

/**
 * Null when `fixture` holds exactly the source's values and names the source's
 * blob and commit; otherwise why not. A SHA is exactly 40 lowercase hex
 * characters, so an empty or padded one never matches. Never throws.
 */
export function vendoredProblem(source: Buffer, fixture: unknown, serverSha: unknown): string | null {
  try {
    return problem(source, fixture, serverSha);
  } catch {
    return 'kopija ili izvor se ne mogu pročitati';
  }
}

function problem(source: Buffer, fixture: unknown, serverSha: unknown): string | null {
  if (typeof serverSha !== 'string' || !SHA.test(serverSha)) return 'SERVER_SHA nije puni SHA commita';
  if (!jsonTree(fixture)) return 'kopija nije čisti JSON';
  if (!exact(fixture, FIXTURE) || !exact(fixture['source'], SOURCE)) return 'kopija nema oblik';
  const from = fixture['source'] as Obj;
  if (from['repository'] !== 'ductura/server') return 'kopija nije iz ductura/server';
  if (from['path'] !== SOURCE_PATH) return `kopija nije iz ${SOURCE_PATH}`;
  if (!isDeepStrictEqual(from['take'], TAKE)) return 'kopija ne navodi što je preuzeto';
  const blob = createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex');
  if (from['blob'] !== blob) return `izvor nije blob ${JSON.stringify(from['blob'])}`;
  if (typeof from['commit'] !== 'string' || !SHA.test(from['commit'])) return 'kopija ne navodi puni SHA commita';
  if (from['commit'] !== serverSha) return `kopija je iz ${from['commit']}, a CI veže ${serverSha}`;
  let d: unknown;
  try {
    d = JSON.parse(source.toString('utf8'));
  } catch {
    return 'izvor nije JSON';
  }
  const key = own(own(d, 'chain'), 'verificationKey');
  const accepted = own(own(d, 'receiptV2'), 'accepted');
  const first = Array.isArray(accepted) ? (accepted[0] as unknown) : undefined;
  if (key === undefined || first === undefined) return 'izvor nema verificationKey ili accepted[0]';
  if (!isDeepStrictEqual(fixture['verificationKey'], key)) return 'verificationKey se razlikuje od izvora';
  if (!isDeepStrictEqual(fixture['accepted'], first)) return 'accepted[0] se razlikuje od izvora';
  return null;
}

/** The CLI: arguments and SERVER_SHA are checked before any file is read; every failure is one line. */
function main(args: string[], serverSha: unknown): string | null {
  const [server, file] = args;
  if (args.length !== 2 || !server || !file) return 'upotreba: node scripts/lab/vendored.ts <server> <fixture>';
  if (typeof serverSha !== 'string' || !SHA.test(serverSha)) return 'SERVER_SHA nije puni SHA commita';
  return vendoredProblem(readFileSync(join(server, SOURCE_PATH)), JSON.parse(readFileSync(file, 'utf8')), serverSha);
}

// By real path, not the main flag of import.meta: that flag only exists from Node 24.2, and the repo allows any Node 24.
if (isEntry(process.argv[1], import.meta.url)) {
  let problem: string | null;
  try {
    problem = main(process.argv.slice(2), process.env['SERVER_SHA']);
  } catch (error) {
    problem = error instanceof Error ? error.message : 'nepoznata greška';
  }
  if (problem !== null) {
    console.error(`Vendorirani vektor: ${oneLine(problem)}`);
    process.exitCode = 1;
  }
}
