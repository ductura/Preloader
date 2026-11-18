// DAN-1096, review 1 and QA 4 on 55f02977: one lab run at a time, and the lab
// downs only a stack it brought up itself (docs/lab-oporavak.md).
import { existsSync, mkdirSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type StackCommand = (cmd: 'up' | 'down') => void | Promise<void>;
export type Stack = { up: () => Promise<void>; down: () => Promise<void> };

const reason = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'nepoznata greška');

/**
 * Runs `body` holding the lab lock of `stackDir`: `<stack>.lab-lock`, made by
 * one non-recursive mkdir (atomic; a lock left by a crashed run is never
 * taken over), next to the stack's real path, so a link to the stack directory
 * shares its lock. The stack
 * is ours only after an `up` that succeeded, and only while the stack's mark
 * (`identify`, state.json startedAt) is the one our `up` left: a failed `up`
 * leaves no stack or someone else's, and neither is ever downed.
 */
export async function withStack<T>(
  stackDir: string,
  command: StackCommand,
  identify: () => string | null,
  body: (stack: Stack) => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(stackDir), { recursive: true, mode: 0o700 });
  const real = existsSync(stackDir) ? realpathSync(stackDir) : join(realpathSync(dirname(stackDir)), basename(stackDir));
  const path = `${real}.lab-lock`;
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (e) {
    if ((e as { code?: unknown }).code !== 'EEXIST') throw e;
    throw new Error(`${path} postoji: laboratorij već radi ili je prekinut; ako ne radi, ugasi stog i ručno obriši taj direktorij`);
  }
  let owned = false;
  let mark: string | null = null;
  const stack: Stack = {
    up: async () => {
      await command('up');
      [owned, mark] = [true, identify()];
    },
    down: async () => {
      // A stack without a mark is never known to be ours.
      if (!owned || mark === null || identify() !== mark) throw new Error('stog nije podiglo ovo pokretanje; laboratorij ga ne gasi');
      await command('down');
      owned = false;
    },
  };
  let failure: { error: unknown } | null = null;
  let result: T | undefined;
  try {
    result = await body(stack);
  } catch (e) {
    failure = { error: e };
  }
  try {
    if (owned) await stack.down();
  } catch (e) {
    failure ??= { error: new Error(`down: ${reason(e)}`) };
  } finally {
    // Removed by hand already, or not empty: the error or result of the run stands.
    try {
      rmdirSync(path);
    } catch {
      // nothing to release
    }
  }
  if (failure !== null) throw failure.error;
  return result as T;
}
