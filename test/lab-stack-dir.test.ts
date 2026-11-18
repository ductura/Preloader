// DAN-1096-b: each lab run owns its own stack directory under the server's
// .stack/, checked before every write with the roots of the server's
// VS1_STACK_DIR check (ductura/server scripts/stack/config.ts stackDir).
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type StackCommand, checkStackPath, withStack } from '../scripts/lab/stack-dir.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'lab-dir-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;

/** A server checkout, a temp root and a directory outside both, all fresh. */
function fixture(name = 'server') {
  const at = join(base, String((n += 1)));
  const [root, tmp, outside] = [join(at, name), join(at, 't'), join(at, 'outside')];
  for (const d of [root, tmp, outside]) mkdirSync(d, { recursive: true });
  const calls: string[] = [];
  const command: StackCommand = (cmd, dir) => void calls.push(`${cmd} ${dir}`);
  const run = <T>(body: Parameters<typeof withStack<T>>[2], cmd = command, dir = root) =>
    withStack(dir, cmd, body, { tmp, warn: (m) => calls.push(`warn ${m}`) });
  return { root, tmp, outside, calls, command, run };
}

test('checkStackPath refuses every unsafe path before it resolves anything', () => {
  const { root, tmp } = fixture();
  let resolved = 0;
  const real = (p: string) => ((resolved += 1), realpathSync(p));
  for (const bad of [
    'stack', `${root}/.stack/../x`, `${root}/.stack/./x`, '/etc/vs1', tmp, `${root}/.stack`, `${tmp}x/stack`, root,
    `${root}/.stack/lab/`, `${root}/.stack//lab`, `${root}/.stack/my lab`, `${root}/.stack/la'b`, `${root}/.stack/la\tb`,
    `${root}/.stack/la\rb`, `${root}/.stack/la\nb`, `${root}/.stack/la\r\nb`, `${root}/.stack/la\u00a0b`,
    `${root}/.stack/la\u007fb`, `${root}/.stack/la\0b`, `${root}/.stack/la\\b`, 'C:\\stack\\lab', 'C:/stack/lab',
    `${root}/.stack/la\u2028b`, '',
  ]) {
    resolved = 0;
    assert.throws(() => checkStackPath(bad, root, tmp, real), /putanja stoga mora biti apsolutna/, JSON.stringify(bad));
    assert.equal(resolved, 1, JSON.stringify(bad)); // only the temp root itself
  }
  assert.equal(checkStackPath(`${root}/.stack/lab-abc`, root, tmp), `${root}/.stack/lab-abc`);
  assert.equal(checkStackPath(`${tmp}/stack`, root, tmp), `${tmp}/stack`);
});

test('a .stack link leading out is refused, also through withStack, and nothing is written outside', async () => {
  const f = fixture();
  symlinkSync(f.outside, join(f.root, '.stack'));
  assert.throws(() => checkStackPath(`${f.root}/.stack/lab-x/deep`, f.root, f.tmp), /vodi izvan/);
  await assert.rejects(f.run(async (s) => s.up()), /vodi izvan/);
  assert.deepEqual([f.calls, readdirSync(f.outside)], [[], []]);
});

test('an unsafe or too long server checkout is refused before .stack is made', async () => {
  for (const name of ['my server', 'ser\u00a0ver', 'ser\tver', 'ser\r\nver', 'ser\u007fver', 'x'.repeat(80)]) {
    const f = fixture(name);
    await assert.rejects(f.run(async (s) => s.up()), /putanja stoga mora biti apsolutna|predug/, JSON.stringify(name));
    assert.deepEqual([f.calls, existsSync(join(f.root, '.stack'))], [[], false]);
  }
  // The checkout at /: `//.stack` (an empty segment) is refused without touching /.
  assert.throws(() => checkStackPath('//.stack/lab-XXXXXX', '/', fixture().tmp), /putanja stoga mora biti apsolutna/);
});

test('.stack that is a file, a link inside the checkout or writable by others is refused before mkdtemp', async () => {
  const cases: [string, (stack: string, root: string) => void][] = [
    ['file', (s) => writeFileSync(s, '')],
    ['link inside', (s, r) => (mkdirSync(join(r, 'real')), symlinkSync(join(r, 'real'), s))],
    ['mode 777', (s) => (mkdirSync(s), chmodSync(s, 0o777))],
    ['mode 720', (s) => (mkdirSync(s), chmodSync(s, 0o720))],
  ];
  for (const [what, make] of cases) {
    const f = fixture();
    const stack = join(f.root, '.stack');
    make(stack, f.root);
    await assert.rejects(f.run(async (s) => s.up()), /\.stack|vodi izvan/, what);
    assert.deepEqual(f.calls, [], what);
    if (lstatSync(stack).isDirectory()) assert.deepEqual(readdirSync(stack), [], what);
  }
});

test('a run directory found outside right after mkdtemp is removed and nothing runs', async () => {
  const f = fixture();
  const real = (p: string) => (/\/\.stack\/lab-(?!XXXXXX)/.test(p) ? join(f.outside, 'x') : realpathSync(p));
  await assert.rejects(withStack(f.root, f.command, async (s) => s.up(), { tmp: f.tmp, real }), /vodi izvan/);
  assert.deepEqual([f.calls, readdirSync(join(f.root, '.stack'))], [[], []]);
});

test('our directory replaced after up (other real directory, link, deleted): down is never called', async () => {
  const swaps: ((dir: string, outside: string) => void)[] = [
    (d, o) => (renameSync(d, join(o, 'moved')), mkdirSync(d, { mode: 0o700 })),
    (d, o) => (rmSync(d, { recursive: true }), symlinkSync(o, d)),
    (d) => rmSync(d, { recursive: true }),
  ];
  for (const swap of swaps) {
    const f = fixture();
    let dir = '';
    await assert.rejects(f.run(async (s) => { await s.up(); dir = s.dir; swap(s.dir, f.outside); }), /više nije direktorij ovog pokretanja/);
    assert.deepEqual(f.calls, [`up ${dir}`]);
  }
});

test('a failed up never leads to down, and its error stands', async () => {
  const f = fixture();
  const failing: StackCommand = (cmd, dir) => { f.calls.push(`${cmd} ${dir}`); throw new Error('port 54360 (postgres) is in use'); };
  await assert.rejects(f.run(async (s) => s.up(), failing), /port 54360/);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0] ?? '', /^up /);
});

test('the error of the run wins over a failed down, which is reported; down alone fails the run', async () => {
  const f = fixture();
  const downFails: StackCommand = (cmd, dir) => { f.calls.push(`${cmd} ${dir}`); if (cmd === 'down') throw new Error('port still answers'); };
  await assert.rejects(f.run(async (s) => { await s.up(); throw new Error('commit pao'); }, downFails), /^Error: commit pao$/);
  assert.equal(f.calls.at(-1), 'warn down: port still answers');
  await assert.rejects(f.run(async (s) => s.up(), downFails), /^Error: down: port still answers$/);
});

test('the run directory is under <server>/.stack/lab-, 0700, never in os.tmpdir()', async () => {
  const f = fixture();
  mkdirSync(join(f.root, '.stack'), { mode: 0o755 }); // the server's own .stack is taken as it is
  const old = process.env['TMPDIR'];
  process.env['TMPDIR'] = f.tmp;
  try {
    const dir = await f.run(async (s) => { await s.up(); await s.down(); await s.up(); return s.dir; });
    assert.match(dir, new RegExp(`^${f.root}/\\.stack/lab-[A-Za-z0-9]{6}$`));
    assert.equal(lstatSync(dir).mode & 0o777, 0o700);
    assert.deepEqual(f.calls, [`up ${dir}`, `down ${dir}`, `up ${dir}`, `down ${dir}`]);
    assert.deepEqual(readdirSync(f.tmp), []);
  } finally {
    if (old === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = old;
  }
});

test('two runs at once get their own directories and each downs only its own', async () => {
  const f = fixture();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const runs = [f.run(async (s) => { await s.up(); await held; return s.dir; }), f.run(async (s) => { await s.up(); return s.dir; })];
  const second = await runs[1];
  release();
  const first = await runs[0];
  assert.notEqual(first, second);
  assert.deepEqual(f.calls, [`up ${first}`, `up ${second}`, `down ${second}`, `down ${first}`]);
});
