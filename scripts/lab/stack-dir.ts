// DAN-1096-b: the stack of a lab run is its own. Each run gets a fresh
// directory `<server>/.stack/lab-XXXXXX` (mkdtemp, never os.tmpdir()), passed
// to the server as VS1_STACK_DIR, and every path is checked before it is
// written to, with the roots of the server's own check (ductura/server
// scripts/stack/config.ts stackDir, vs1.ts DIR).
import { lstatSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';

type Real = (path: string) => string;
/** `tmp`, `real` and `uid` are injected in tests only. */
export type RunDirOptions = { tmp?: string; real?: Real; uid?: number };
/** The directory of one run. */
export type RunDir = { readonly path: string };

/** ductura/server scripts/stack/config.ts SAFE_PATH. */
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/u;
/** ductura/server vs1.ts preflight: `${DIR}/.s.PGSQL.${port}` at most 107, for any port. */
const SOCKET_MAX = 107 - '/.s.PGSQL.65535'.length;

const fail = (message: string): never => { throw new Error(message); };
const code = (e: unknown): unknown => (typeof e === 'object' && e !== null ? Reflect.get(e, 'code') : undefined);

/**
 * The server's check of VS1_STACK_DIR, ported: an absolute path of letters,
 * digits, . _ - and / inside `<root>/.stack` or the temp root (fixed `/tmp` on
 * the server), whose nearest existing ancestor, links resolved, stays inside.
 */
export function checkStackPath(path: string, root: string, tmp = '/tmp', real: Real = realpathSync): string {
  if (!SAFE_PATH.test(tmp) || tmp.endsWith('/')) fail(`korijen za privremene datoteke mora biti apsolutna putanja bez završnog /: ${JSON.stringify(tmp)}`);
  const roots = [`${root}/.stack`, tmp];
  try { roots.push(real(tmp)); } catch { /* a temp dir that does not exist adds no resolved root */ }
  const ok = (p: string): boolean => roots.some((r) => p.startsWith(`${r}/`));
  const parts = path.split('/');
  if (!SAFE_PATH.test(path) || parts.includes('..') || parts.includes('.') || parts.slice(1).includes('') || !ok(path)) {
    fail(`putanja stoga mora biti apsolutna, od slova, brojki, . _ - i /, unutar .stack/ servera ili ${tmp}: ${JSON.stringify(path)}`);
  }
  for (let at = parts.length; at > 1; at -= 1) {
    let found: string;
    try {
      found = real(parts.slice(0, at).join('/'));
    } catch (e) {
      if (code(e) === 'ENOENT') continue;
      throw e;
    }
    if (!ok([found, ...parts.slice(at)].join('/'))) fail(`putanja stoga ${path} vodi izvan .stack/ servera ili ${tmp}`);
    break;
  }
  return path;
}

/**
 * Makes the directory of one lab run, `<server>/.stack/lab-XXXXXX` (0700),
 * with the checkout resolved first, as the server's ROOT is. Nothing is written
 * before the path, the checkout and `.stack` are checked: both must be
 * directories of this user that others may not write into, or they could swap
 * `.stack` between the check and mkdtemp.
 */
export function makeRunDir(serverDir: string, options: RunDirOptions = {}): RunDir {
  const { tmp = '/tmp', real = realpathSync, uid = process.getuid?.() } = options;
  const root = real(serverDir);
  const stack = `${root}/.stack`;
  const mine = (path: string): void => {
    const st = lstatSync(path);
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o022) !== 0) {
      fail(`${path === root ? `server ${path}` : path} mora biti direktorij ovog korisnika u koji drugi ne pišu, ne poveznica (za mod: chmod go-w ${path})`);
    }
  };
  mine(root);
  checkStackPath(`${stack}/lab-XXXXXX`, root, tmp, real);
  if (`${stack}/lab-XXXXXX`.length > SOCKET_MAX) fail(`putanja servera ${root} je predug za utičnicu PostgreSQL-a`);
  try { mkdirSync(stack, { mode: 0o700 }); } catch (e) { if (code(e) !== 'EEXIST') throw e; }
  mine(stack);
  return { path: mkdtempSync(`${stack}/lab-`) };
}
