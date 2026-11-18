// DAN-1096: test/fixtures/receipt-v2-golden.json is a copy of two values of
// the server's golden vectors. The lab-oporavak CI job runs this against the
// server checkout at SERVER_SHA, so the copy never drifts from its source.
//   node scripts/lab/vendored.ts <server checkout> <fixture>
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  if (!exact(fixture, FIXTURE) || !exact(fixture['source'], SOURCE)) return 'kopija nema oblik';
  const from = fixture['source'] as Obj;
  if (from['repository'] !== 'ductura/server') return 'kopija nije iz ductura/server';
  if (from['path'] !== SOURCE_PATH) return `kopija nije iz ${SOURCE_PATH}`;
  if (!isDeepStrictEqual(from['take'], TAKE)) return 'kopija ne navodi što je preuzeto';
  const blob = createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex');
  if (from['blob'] !== blob) return `izvor nije blob ${String(from['blob'])}`;
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

// import.meta.main also holds when the script is run through a link (argv[1] is the link, the URL the real path).
if (import.meta.main) {
  let problem: string | null;
  try {
    problem = main(process.argv.slice(2), process.env['SERVER_SHA']);
  } catch (error) {
    problem = error instanceof Error ? error.message : 'nepoznata greška';
  }
  if (problem !== null) {
    console.error(`Vendorirani vektor: ${problem}`);
    process.exitCode = 1;
  }
}
