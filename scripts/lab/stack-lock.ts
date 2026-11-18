// DAN-1096, review 1 and QA 4 on 55f02977: one lab run at a time, and the lab
// downs only a stack it brought up itself (docs/lab-oporavak.md).
import { mkdirSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type StackCommand = (cmd: 'up' | 'down') => void | Promise<void>;
export type Stack = { up: () => Promise<void>; down: () => Promise<void> };

const reason = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'nepoznata greška');

/**
 * Runs `body` holding the lab lock: a directory made by one non-recursive
 * mkdir (atomic; a lock left by a crashed run is never taken over). The stack
 * is ours only after an `up` that succeeded, and only while the stack's mark
 * (`identify`, state.json startedAt) is the one our `up` left: a failed `up`
 * leaves no stack or someone else's, and neither is ever downed.
 */
export async function withStack<T>(
  lock: string,
  command: StackCommand,
  identify: () => string | null,
  body: (stack: Stack) => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  // One real path, so two spellings of SERVER_DIR give one lock.
  const path = join(realpathSync(dirname(lock)), basename(lock));
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
      if (!owned || identify() !== mark) throw new Error('stog nije podiglo ovo pokretanje; laboratorij ga ne gasi');
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
    rmdirSync(path);
  }
  if (failure !== null) throw failure.error;
  return result as T;
}
