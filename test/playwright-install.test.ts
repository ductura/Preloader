// DAN-1097: scripts/playwright-install.sh keeps the e2e-matrix browser install
// off the apt mirror's critical path. The script runs with stub pnpm, sudo,
// timeout and date on PATH: the stub timeout moves a fake clock by the whole cap
// when an attempt answers 124, and the stub date reads that clock. Only the
// first test uses real GNU timeout and real seconds.
import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const script = fileURLToPath(new URL('../scripts/playwright-install.sh', import.meta.url));
let root = '';
const at = (...p: string[]): string => join(root, ...p);
const stub = (dir: string, name: string, lines: string[]): void => {
  writeFileSync(at(dir, name), `#!/usr/bin/env bash\n${lines.join('\n')}\n`);
  chmodSync(at(dir, name), 0o755);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pw-install-'));
  for (const d of ['bin', 'fake', 'archives', 'cache', 'etc/apt/sources.list.d']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('log'), '');
  writeFileSync(at('clock'), '1000');
  // One plan line per pnpm call: ok, fail, capped (124), hang, or ok+deb (apt downloaded new.deb).
  stub('bin', 'pnpm', [
    'echo "pnpm $* | archives: $(ls "$PLAYWRIGHT_APT_ARCHIVES" | tr "\\n" " ")" >> "$LOG"',
    'action=$(head -n1 "$PLAN"); sed -i 1d "$PLAN"',
    'case "$action" in ok) exit 0 ;; capped) exit 124 ;; hang) exec sleep 30 ;;',
    '  ok+deb) touch "$PLAYWRIGHT_APT_ARCHIVES/new.deb"; exit 0 ;; *) exit 1 ;; esac',
  ]);
  stub('bin', 'sudo', ['echo "sudo $*" >> "$LOG"', 'case "$1" in pkill | dpkg | apt-get) exit 0 ;; esac', 'exec "$@"']);
  stub('fake', 'date', ['cat "$CLOCK"']);
  stub('fake', 'timeout', [
    '[ "$1" = --version ] && { echo "timeout (GNU coreutils) 9.4"; exit 0; }',
    'shift; secs=$1; shift; echo "cap $secs $1" >> "$LOG"; "$@"; s=$?',
    '[ "$s" -eq 124 ] && echo $(($(cat "$CLOCK") + secs)) > "$CLOCK"; exit "$s"',
  ]);
});

// The ubuntu-24.04 format (runner-images configure-apt-sources.sh) with the host of run 44244472136.
const MIRRORS = 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const SOURCES = 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\n\nTypes: deb\nURIs: http://security.ubuntu.com/ubuntu/\nSuites: noble-security\n';
const LIST = 'deb http://us-east-2.ec2.archive.ubuntu.com/ubuntu noble main\ndeb [arch=amd64] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n';
const apt = (file: string): string => readFileSync(at('etc/apt', file), 'utf8');

type Run = { code: number | null; out: string; log: string; ms: number };
function run(plan: string[], env: Record<string, string> = {}, fakeClock = true, args = ['chromium', 'firefox', 'webkit']): Run {
  writeFileSync(at('plan'), plan.map((p) => `${p}\n`).join(''));
  const PATH = [...(fakeClock ? [at('fake')] : []), at('bin'), process.env['PATH'] ?? ''].join(':');
  const start = Date.now();
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { PATH, HOME: root, LOG: at('log'), PLAN: at('plan'), CLOCK: at('clock'), PLAYWRIGHT_APT_ROOT: root, PLAYWRIGHT_APT_ARCHIVES: at('archives'), ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr, log: readFileSync(at('log'), 'utf8'), ms: Date.now() - start };
}
const attemptCaps = (log: string): number[] => [...log.matchAll(/^cap (\d+) pnpm$/gm)].map((m) => Number(m[1]));

test('a hanging install is cut off by the budget, not by the job timeout (real time)', { timeout: 20_000 }, () => {
  const r = run(['hang', 'hang', 'hang'], { PLAYWRIGHT_INSTALL_BUDGET: '3', PLAYWRIGHT_INSTALL_TIMEOUT: '1' }, false);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::Playwright browsers \(chromium firefox webkit\) could not be installed within 3s/);
  assert.ok(r.ms < 15_000, `took ${r.ms} ms`);
});

test('no attempt gets more than what is left of the budget (fake clock)', () => {
  const full = run(['capped', 'capped', 'capped'], { PLAYWRIGHT_INSTALL_BUDGET: '600', PLAYWRIGHT_INSTALL_TIMEOUT: '240' });
  assert.deepEqual(attemptCaps(full.log), [240, 240, 120]);
  writeFileSync(at('log'), '');
  writeFileSync(at('clock'), '1000');
  const short = run(['capped', 'capped', 'capped'], { PLAYWRIGHT_INSTALL_BUDGET: '300', PLAYWRIGHT_INSTALL_TIMEOUT: '240' });
  assert.deepEqual(attemptCaps(short.log), [240, 60]);
  assert.equal(short.code, 1, short.out);
  assert.match(short.out, /::error::.*within 300s \(2 of 3 attempts, last exit 124\)/);
});

const BAD = ['', '0', '08', '010', '99999999999999999999', '100000', 'abc', '-1', ' 5', '5 ', '5\r', '5\r\n', '5\t', '5 ', '5\u007f', '5\n', '1e3', '0x10'];
for (const bad of BAD) {
  for (const name of ['PLAYWRIGHT_INSTALL_BUDGET', 'PLAYWRIGHT_INSTALL_TIMEOUT']) {
    test(`refuses ${name}=${JSON.stringify(bad)} before any install`, () => {
      const r = run(['ok'], { [name]: bad });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /::error::PLAYWRIGHT_INSTALL_BUDGET and PLAYWRIGHT_INSTALL_TIMEOUT must be whole seconds/);
      assert.doesNotMatch(r.log, /pnpm/);
    });
  }
}

test('without browsers the script refuses to run', () => {
  const r = run(['ok'], {}, true, []);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::usage/);
  assert.doesNotMatch(r.log, /pnpm/);
});

test('after each failed attempt apt is cleaned up and the archive moves to the next fallback mirror', () => {
  writeFileSync(at('etc/apt/apt-mirrors.txt'), MIRRORS);
  const r = run(['capped', 'fail', 'fail']);
  assert.equal(r.code, 1, r.out);
  const steps = r.log.split('\n').filter((l) => /^(pnpm|sudo) /.test(l)).map((l) => l.replace(/^(pnpm exec playwright install --with-deps chromium firefox webkit|sudo \S+ \S+).*$/, '$1'));
  const between = ['sudo pkill -x', 'sudo pkill -f', 'sudo dpkg --configure', 'sudo sed -E'];
  const install = 'pnpm exec playwright install --with-deps chromium firefox webkit';
  assert.deepEqual(steps, [install, ...between, install, ...between, install]);
  assert.match(r.out, /attempt 1\/3 timed out after 240s[^]*now use archive\.ubuntu\.com[^]*attempt 2\/3 failed \(exit 1\)[^]*now use mirrors\.edge\.kernel\.org/);
  assert.equal(apt('apt-mirrors.txt'), 'http://mirrors.edge.kernel.org/ubuntu/\tpriority:1\nhttps://mirrors.edge.kernel.org/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n');
  assert.match(r.out, /::error::Playwright browsers \(chromium firefox webkit\) could not be installed within 660s \(3 of 3 attempts, last exit 1\)/);
});

test('the fallback rewrites only Ubuntu archive URLs and keeps scheme and priority', () => {
  writeFileSync(at('etc/apt/apt-mirrors.txt'), MIRRORS);
  writeFileSync(at('etc/apt/sources.list.d/ubuntu.sources'), SOURCES);
  writeFileSync(at('etc/apt/sources.list'), LIST);
  const r = run(['capped', 'ok']);
  assert.equal(r.code, 0, r.out);
  assert.equal(apt('apt-mirrors.txt'), MIRRORS.replace('us-east-2.ec2.archive.ubuntu.com', 'archive.ubuntu.com'));
  assert.equal(apt('sources.list.d/ubuntu.sources'), SOURCES);
  assert.equal(apt('sources.list'), LIST.replace('us-east-2.ec2.archive.ubuntu.com', 'archive.ubuntu.com'));
});

test('a first attempt that succeeds leaves the apt sources alone', () => {
  writeFileSync(at('etc/apt/apt-mirrors.txt'), MIRRORS);
  const r = run(['ok']);
  assert.equal(r.code, 0, r.out);
  assert.equal(apt('apt-mirrors.txt'), MIRRORS);
  assert.doesNotMatch(r.out + r.log, /::warning::|sudo (sed|pkill|dpkg)/);
});

test('cached .deb files reach the apt archive before the install; after it the cache holds what apt kept', () => {
  writeFileSync(at('cache/old.deb'), 'x');
  writeFileSync(at('cache/gone.deb'), 'x');
  writeFileSync(at('archives/old.deb'), 'x');
  const r = run(['ok+deb'], { PLAYWRIGHT_APT_CACHE_DIR: '~/cache' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.log, /^pnpm exec playwright install .*\| archives: gone\.deb old\.deb $/m);
  assert.match(r.log, /^sudo apt-get autoclean$/m);
  // autoclean is stubbed, so the archive keeps gone.deb; the cache mirrors the archive exactly.
  assert.deepEqual(readdirSync(at('cache')).sort(), readdirSync(at('archives')).sort());
  assert.ok(readdirSync(at('cache')).includes('new.deb'));
});

test('a failed install leaves the apt cache unchanged', () => {
  writeFileSync(at('cache/old.deb'), 'x');
  const r = run(['fail', 'fail', 'fail'], { PLAYWRIGHT_APT_CACHE_DIR: at('cache') });
  assert.equal(r.code, 1, r.out);
  assert.deepEqual(readdirSync(at('cache')), ['old.deb']);
  assert.doesNotMatch(r.log, /autoclean/);
});

test('an empty cache and an archive without .deb files are no error', () => {
  const r = run(['ok'], { PLAYWRIGHT_APT_CACHE_DIR: at('missing') });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::notice::apt left no \.deb files/);
  assert.ok(!existsSync(at('missing')));
});

// The workflow side: e2e-matrix restores both caches, installs through the
// capped script only and saves the caches right after a good install.
type Obj = Record<string, unknown>;
const isMap = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (o: unknown, k: string): unknown => (isMap(o) ? o[k] : undefined);

test('e2e-matrix restores and saves both caches and installs browsers only through the script', () => {
  const doc = parseDocument(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'), { uniqueKeys: true });
  assert.equal(doc.errors.length, 0);
  const job = field(field(doc.toJS(), 'jobs'), 'e2e-matrix');
  const steps = field(job, 'steps');
  assert.ok(Array.isArray(steps));
  const runs = steps.map((s) => String(field(s, 'run') ?? ''));
  const installs = runs.flatMap((r, i) => (/playwright[ -]install/.test(r) ? [i] : []));
  assert.equal(installs.length, 1, 'exactly one step installs browsers');
  const i = installs[0] ?? -1;
  const install: unknown = steps[i];
  assert.equal(field(install, 'run'), 'bash scripts/playwright-install.sh chromium firefox webkit');
  const env = field(install, 'env');
  const budget = Number(field(env, 'PLAYWRIGHT_INSTALL_BUDGET'));
  const minutes = Number(field(install, 'timeout-minutes'));
  assert.ok(budget > 0 && minutes * 60 >= budget + 120 && minutes < Number(field(job, 'timeout-minutes')), `${budget}s in ${minutes} min`);
  const uses = (s: unknown, a: string): boolean => new RegExp(`^actions/cache/${a}@[0-9a-f]{40}$`).test(String(field(s, 'uses')));
  const restore: unknown = steps[i - 1];
  const save: unknown = steps[i + 1];
  assert.ok(uses(restore, 'restore') && uses(save, 'save'), 'restore right before, save right after the install');
  assert.equal(steps.filter((s) => /^actions\/cache/.test(String(field(s, 'uses')))).length, 2);
  assert.match(String(field(save, 'if')), new RegExp(`steps\\.${String(field(install, 'id'))}\\.outcome == 'success'`));
  const aptCache = String(field(env, 'PLAYWRIGHT_APT_CACHE_DIR'));
  const paths = (s: unknown): string[] => String(field(field(s, 'with'), 'path')).trim().split('\n').map((p) => p.trim());
  assert.deepEqual(paths(restore), ['~/.cache/ms-playwright', aptCache]);
  assert.ok(aptCache.startsWith('~/.cache/'));
  assert.deepEqual(paths(save), paths(restore));
  assert.equal(field(field(save, 'with'), 'key'), field(field(restore, 'with'), 'key'));
});
