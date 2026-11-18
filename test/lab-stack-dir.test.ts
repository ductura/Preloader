// DAN-1096-b-i-1: each lab run gets its own stack directory under the server's
// .stack/, and every path is checked before it is written to, with the roots of
// the server's VS1_STACK_DIR check (ductura/server scripts/stack/config.ts stackDir).
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStackPath, makeRunDir } from '../scripts/lab/stack-dir.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'lab-dir-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;

/** A server checkout (0755, whatever the umask), a temp root and a directory outside both, all fresh. */
function fixture(name = 'server') {
  const at = join(base, String((n += 1)));
  const [root, tmp, outside] = [join(at, name), join(at, 't'), join(at, 'outside')];
  for (const d of [root, tmp, outside]) (mkdirSync(d, { recursive: true }), chmodSync(d, 0o755));
  const make = (dir = root, uid?: number) => makeRunDir(dir, { tmp, ...(uid === undefined ? {} : { uid }) });
  return { root, tmp, outside, make };
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
  for (const t of ['', '/', `${tmp}/`, 'tmp', `${tmp} x`]) {
    resolved = 0;
    assert.throws(() => checkStackPath('/etc/vs1', root, t, real), /korijen za privremene/, t);
    assert.equal(resolved, 0, t);
  }
  assert.equal(checkStackPath(`${root}/.stack/lab-abc`, root, `${tmp}/missing`), `${root}/.stack/lab-abc`);
  assert.equal(checkStackPath(`${root}/.stack/lab-abc`, root, tmp), `${root}/.stack/lab-abc`);
  assert.equal(checkStackPath(`${tmp}/stack`, root, tmp), `${tmp}/stack`);
});

test('a .stack link leading out is refused, also when the rest does not exist, and nothing is written outside', () => {
  const f = fixture();
  symlinkSync(f.outside, join(f.root, '.stack'));
  assert.throws(() => checkStackPath(`${f.root}/.stack/lab-x/deep`, f.root, f.tmp), /vodi izvan/);
  assert.throws(() => f.make(), /vodi izvan/);
  assert.deepEqual(readdirSync(f.outside), []);
});

test('an unsafe, too long, missing or non-directory server checkout is refused before .stack is made', () => {
  for (const name of ['my server', 'ser\u00a0ver', 'ser\tver', 'ser\r\nver', 'ser\u007fver', 'x'.repeat(80)]) {
    const f = fixture(name);
    assert.throws(() => f.make(), /putanja stoga mora biti apsolutna|predug/, JSON.stringify(name));
    assert.equal(existsSync(join(f.root, '.stack')), false, JSON.stringify(name));
  }
  // The socket limit at its edge: `<root>/.stack/lab-XXXXXX` of 92 characters is taken, 93 is not.
  for (const [length, ok] of [[92, true], [93, false]] as const) {
    const f = fixture('y'.repeat(length - '/.stack/lab-XXXXXX'.length - join(base, String(n + 1)).length - 1));
    assert.equal(`${f.root}/.stack/lab-XXXXXX`.length, length);
    if (ok) assert.match(f.make().path, /\/\.stack\/lab-\w{6}$/);
    else assert.throws(() => f.make(), /predug za utičnicu/);
  }
  // The checkout at /: `//.stack` (an empty segment) is refused without touching /.
  assert.throws(() => checkStackPath('//.stack/lab-XXXXXX', '/', fixture().tmp), /putanja stoga mora biti apsolutna/);
  const f = fixture();
  assert.throws(() => f.make(join(f.root, 'missing')), /ENOENT/);
  writeFileSync(join(f.root, 'file'), '');
  assert.throws(() => f.make(join(f.root, 'file')), /server .* mora biti direktorij ovog korisnika/);
});

test('a server checkout of another user or writable by others is refused before .stack is made', () => {
  for (const mode of [0o775, 0o757]) {
    const f = fixture();
    chmodSync(f.root, mode);
    assert.throws(() => f.make(), /server .* mora biti direktorij ovog korisnika u koji drugi ne pišu.*chmod go-w/);
    assert.equal(existsSync(join(f.root, '.stack')), false);
  }
  const f = fixture(); // uid is injected: the tests may run as root
  assert.throws(() => f.make(f.root, (process.getuid?.() ?? 0) + 12345), /server .* mora biti direktorij ovog korisnika/);
  assert.equal(existsSync(join(f.root, '.stack')), false);
});

test('.stack that is a file, a link or writable by others is refused before mkdtemp', () => {
  const cases: [string, (stack: string, root: string) => void, RegExp][] = [
    ['file', (s) => writeFileSync(s, ''), /^Error: ENOTDIR/], // realpath's ENOTDIR stands, as on the server
    ['link inside', (s, r) => (mkdirSync(join(r, 'real')), symlinkSync(join(r, 'real'), s)), /vodi izvan/],
    ['link into tmp', (s, r) => (mkdirSync(join(r, '..', 't', 'x')), symlinkSync(join(r, '..', 't', 'x'), s)), /\.stack mora biti direktorij/],
    ['mode 777', (s) => (mkdirSync(s), chmodSync(s, 0o777)), /\.stack mora biti direktorij ovog korisnika u koji drugi ne pišu/],
    ['mode 720', (s) => (mkdirSync(s), chmodSync(s, 0o720)), /\.stack mora biti direktorij ovog korisnika u koji drugi ne pišu/],
  ];
  for (const [what, make, expected] of cases) {
    const f = fixture();
    const stack = join(f.root, '.stack');
    make(stack, f.root);
    assert.throws(() => f.make(), expected, what);
    if (lstatSync(stack).isDirectory()) assert.deepEqual(readdirSync(stack), [], what);
    if (what === 'link into tmp') assert.deepEqual(readdirSync(join(f.tmp, 'x')), []);
  }
});

test('each run gets its own 0700 directory under <server>/.stack/lab-, never in os.tmpdir()', () => {
  const f = fixture();
  mkdirSync(join(f.root, '.stack'), { mode: 0o755 }); // the server's own .stack is taken as it is
  const old = process.env['TMPDIR'];
  process.env['TMPDIR'] = f.tmp;
  try {
    const [one, two] = [f.make(), f.make()];
    assert.notEqual(one.path, two.path);
    for (const dir of [one, two]) {
      assert.match(dir.path, new RegExp(`^${f.root}/\\.stack/lab-[A-Za-z0-9]{6}$`));
      assert.equal(lstatSync(dir.path).mode & 0o777, 0o700);
    }
    assert.deepEqual(readdirSync(f.tmp), []);
    // The default temp root is the server's fixed /tmp, not TMPDIR (now elsewhere).
    assert.equal(checkStackPath('/tmp/lab-none/stack', f.root), '/tmp/lab-none/stack');
  } finally {
    if (old === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = old;
  }
});

test('a checkout given through a link is resolved first, and a linked temp root is taken by both spellings', () => {
  const f = fixture();
  const link = join(f.outside, 'server-link');
  symlinkSync(f.root, link);
  assert.match(f.make(link).path, new RegExp(`^${f.root}/\\.stack/lab-\\w{6}$`));
  assert.equal(lstatSync(join(f.root, '.stack')).mode & 0o777, 0o700); // a .stack it makes is 0700
  const tmpLink = join(f.outside, 'tmp-link');
  symlinkSync(f.tmp, tmpLink);
  assert.equal(checkStackPath(`${f.tmp}/stack`, f.root, tmpLink), `${f.tmp}/stack`);
  assert.equal(checkStackPath(`${tmpLink}/stack`, f.root, tmpLink), `${tmpLink}/stack`);
  assert.throws(() => checkStackPath(`${f.outside}/stack`, f.root, tmpLink), /putanja stoga mora biti apsolutna/);
});
