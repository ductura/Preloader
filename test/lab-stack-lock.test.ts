// DAN-1096, review 1 and QA 4 on 55f02977: two runs at once, and stacks of
// others, over a fake stack with the server's rule: `up` refuses while a
// stack runs (scripts/stack/vs1.ts preflight), `down` stops whatever runs.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type StackCommand, withStack } from '../scripts/lab/stack-lock.ts';

function fakeStack() {
  const dir = mkdtempSync(join(tmpdir(), 'lab-stack-'));
  const state = join(dir, 'vs1', 'state.json');
  const calls: string[] = [];
  let n = 0;
  const runAs = (who: string): StackCommand => (cmd) => {
    calls.push(`${who} ${cmd}`);
    if (cmd === 'down') return rmSync(state, { force: true });
    if (existsSync(state)) throw new Error('the stack is up; run pnpm stack:vs1 down');
    mkdirSync(join(dir, 'vs1'), { recursive: true });
    writeFileSync(state, JSON.stringify({ owner: who, startedAt: `t${(n += 1)}` }));
  };
  const owner = () => (existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as { owner: string }).owner : null);
  const mark = () => (existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as { startedAt: string }).startedAt : null);
  return { lock: join(dir, 'vs1.lab-lock'), runAs, owner, mark, calls };
}

test('a second run at the same time stops at the lock and touches no stack', async () => {
  const f = fakeStack();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const first = withStack(f.lock, f.runAs('A'), f.mark, async (s) => {
    await s.up();
    await held;
  });
  const second = withStack(f.lock, f.runAs('B'), f.mark, async (s) => s.up());
  await assert.rejects(second, /lab-lock postoji: laboratorij već radi/);
  assert.equal(f.owner(), 'A');
  release();
  await first;
  assert.deepEqual(f.calls, ['A up', 'A down']);
  assert.equal(existsSync(f.lock), false);
});

test("someone else's stack already up: our up fails and nothing is downed", async () => {
  const f = fakeStack();
  await f.runAs('other')('up');
  await assert.rejects(withStack(f.lock, f.runAs('A'), f.mark, async (s) => s.up()), /the stack is up/);
  assert.equal(f.owner(), 'other');
  assert.deepEqual(f.calls, ['other up', 'A up']);
});

test('a stack brought up by someone else between our down and up is not downed', async () => {
  const f = fakeStack();
  const run = withStack(f.lock, f.runAs('A'), f.mark, async (s) => {
    await s.up();
    await s.down();
    await f.runAs('other')('up');
    await s.up();
  });
  await assert.rejects(run, /the stack is up/);
  assert.equal(f.owner(), 'other');
  assert.deepEqual(f.calls, ['A up', 'A down', 'other up', 'A up']);
});

test('our stack replaced by someone else while we run is not downed', async () => {
  const f = fakeStack();
  const run = withStack(f.lock, f.runAs('A'), f.mark, async (s) => {
    await s.up();
    await f.runAs('other')('down');
    await f.runAs('other')('up');
  });
  await assert.rejects(run, /^Error: down: stog nije podiglo ovo pokretanje/);
  assert.equal(f.owner(), 'other');
  assert.deepEqual(f.calls, ['A up', 'other down', 'other up']);
});

test('the error of the run wins, our stack is still downed and the lock released', async () => {
  const f = fakeStack();
  await assert.rejects(withStack(f.lock, f.runAs('A'), f.mark, async (s) => {
    await s.up();
    throw new Error('commit pao');
  }), /commit pao/);
  assert.deepEqual([f.owner(), f.calls, existsSync(f.lock)], [null, ['A up', 'A down'], false]);
});

test('a lock left by a crashed run is never taken over, under any spelling of its path', async () => {
  const f = fakeStack();
  mkdirSync(f.lock);
  const link = `${f.lock.slice(0, -'/vs1.lab-lock'.length)}-link`;
  symlinkSync(join(f.lock, '..'), link);
  for (const lock of [f.lock, join(link, 'vs1.lab-lock')]) {
    await assert.rejects(withStack(lock, f.runAs('A'), f.mark, async (s) => s.up()), /lab-lock postoji: .*ručno obriši/);
  }
  assert.deepEqual(f.calls, []);
  assert.equal(existsSync(f.lock), true);
});
