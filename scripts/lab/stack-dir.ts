// DAN-1096-b: the stack of a lab run is its own. Each run gets a fresh
// directory `<server>/.stack/lab-XXXXXX` (mkdtemp, never os.tmpdir()), passed
// to the server as VS1_STACK_DIR, and every path is checked before it is
// written to, with the roots of the server's own check (ductura/server
// scripts/stack/config.ts stackDir, vs1.ts DIR).
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync } from 'node:fs';

export type StackCommand = (cmd: 'up' | 'down', dir: string) => void | Promise<void>;
export type Stack = { dir: string; up: () => Promise<void>; down: () => Promise<void> };
type Real = (path: string) => string;
type Options = { tmp?: string; real?: Real; warn?: (message: string) => void };

/** ductura/server scripts/stack/config.ts SAFE_PATH. */
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/u;
/** ductura/server vs1.ts preflight: `${DIR}/.s.PGSQL.${port}` at most 107, for any port. */
const SOCKET_MAX = 107 - '/.s.PGSQL.65535'.length;

const fail = (message: string): never => { throw new Error(message); };
/** Never throws, whatever was thrown (a getter, a Symbol message, a Proxy). */
const reason = (e: unknown): string => {
  try {
    return e instanceof Error ? String(e.message) : typeof e === 'string' ? e : 'nepoznata greška';
  } catch {
    return 'nepoznata greška';
  }
};
type Tell = (message: () => string) => void;
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

type RunDir = { path: string; dev: number; ino: number };

/** The run directory is still the one mkdtemp made: same inode, ours, inside `<root>/.stack`. */
function checkRun(dir: RunDir, root: string, tmp: string, real: Real): void {
  const st = lstatSync(dir.path, { throwIfNoEntry: false });
  if (st === undefined || !st.isDirectory() || st.dev !== dir.dev || st.ino !== dir.ino || st.uid !== process.getuid?.()) {
    fail(`${dir.path} više nije direktorij ovog pokretanja; laboratorij u njemu ne radi`);
  }
  checkStackPath(dir.path, root, tmp, real);
  if (real(dir.path) !== dir.path) fail(`putanja stoga ${dir.path} vodi izvan .stack/ servera`);
}

function newRunDir(root: string, tmp: string, real: Real, tell: Tell): RunDir {
  const stack = `${root}/.stack`;
  checkStackPath(`${stack}/lab-XXXXXX`, root, tmp, real);
  if (`${stack}/lab-XXXXXX`.length > SOCKET_MAX) fail(`putanja servera ${root} je predug za utičnicu PostgreSQL-a`);
  // Others who may write into the checkout or .stack could swap .stack between the check and mkdtemp.
  const mine = (path: string): void => {
    const st = lstatSync(path);
    if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o022) !== 0) {
      fail(`${path === root ? `server ${path}` : path} mora biti direktorij ovog korisnika u koji drugi ne pišu, ne poveznica (za mod: chmod go-w ${path})`);
    }
  };
  mine(root);
  try { mkdirSync(stack, { mode: 0o700 }); } catch (e) { if (code(e) !== 'EEXIST') throw e; }
  mine(stack);
  const path = mkdtempSync(`${stack}/lab-`);
  const { dev, ino } = lstatSync(path), dir = { path, dev, ino };
  try {
    checkRun(dir, root, tmp, real);
  } catch (e) {
    // Only the very directory mkdtemp made, and the reason of the refusal stands.
    const now = lstatSync(path, { throwIfNoEntry: false });
    if (now?.dev === dev && now.ino === ino) {
      try { rmdirSync(path); } catch (r) { tell(() => `rmdir ${path}: ${reason(r)}`); }
    }
    throw e;
  }
  return dir;
}

/**
 * Runs `body` with a stack in a directory of its own. The stack is ours only
 * after an `up` that succeeded; a failed `up` is never followed by `down`
 * (the server stops what it started, vs1.ts up). Before every command the
 * directory must still be ours. Commands run one at a time; once the body
 * settles no new command starts, what it started is awaited, and our stack is
 * downed. The error of the run wins; a failed `down` after it goes to `warn`,
 * which never replaces it.
 */
export async function withStack<T>(serverDir: string, command: StackCommand, body: (stack: Stack) => Promise<T>, options: Options = {}): Promise<T> {
  const { tmp = '/tmp', real = realpathSync, warn = console.error } = options;
  // A warning never replaces the error it accompanies.
  const tell: Tell = (message) => {
    try {
      const done: unknown = warn(message());
      if (typeof (done as { then?: unknown } | null)?.then === 'function') (done as Promise<unknown>).then(undefined, () => undefined);
    } catch {
      // the error stands
    }
  };
  const root = real(serverDir);
  const dir = newRunDir(root, tmp, real, tell);
  let owned = false;
  let closing = false;
  // One command at a time, in call order; ownership is checked when a command's turn comes.
  let queue: Promise<unknown> = Promise.resolve();
  const exec = (cmd: 'up' | 'down'): Promise<void> => {
    const step = queue.then(async () => {
      if (cmd === 'down' && !owned) fail('stog nije podiglo ovo pokretanje; laboratorij ga ne gasi');
      checkRun(dir, root, tmp, real);
      await command(cmd, dir.path);
      owned = cmd === 'up';
    });
    queue = step.catch(() => undefined);
    return step;
  };
  const open = (cmd: 'up' | 'down') => async (): Promise<void> => {
    if (closing) fail('pokretanje se zatvara; stog se više ne dira');
    await exec(cmd);
  };
  const stack: Stack = { dir: dir.path, up: open('up'), down: open('down') };
  let failure: { error: unknown } | null = null;
  let result: T | undefined;
  try {
    result = await body(stack);
  } catch (e) {
    failure = { error: e };
  }
  closing = true; // what the body started is awaited, nothing new starts
  await queue;
  if (owned) {
    try {
      await exec('down');
    } catch (e) {
      if (failure === null) failure = { error: new Error(`down: ${reason(e)}`) };
      else tell(() => `down: ${reason(e)}`);
    }
  }
  if (failure !== null) throw failure.error;
  return result as T;
}
