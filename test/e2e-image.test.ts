// DAN-1097-2: e2e-matrix runs in the official Playwright image pinned by digest,
// with no apt and no `playwright install`. The image lacks DejaVu Sans, so the
// fonts the DAN-1076 baselines were made with come from e2e/fonts. The job is
// an allowlist: every step must equal the expected one, in order.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

type Obj = Record<string, unknown>;
const isMap = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isMap(o) && Object.hasOwn(o, k) ? o[k] : undefined);

// Same reader as test/ci-ok.test.ts: any YAML error or duplicate key fails.
function parse(text: string): Obj {
  const doc = parseDocument(text, { uniqueKeys: true, merge: true });
  if (doc.errors.length > 0) throw new Error(doc.errors.map((e) => e.message).join('; '));
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!isMap(value)) throw new Error('document is not a mapping');
  return value;
}

const DIGEST = 'eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
// Index digest of each allowed tag: a new Playwright needs a new row here.
const DIGESTS: Obj = { '1.63.0': DIGEST };
const NODE_JOB = {
  uses: 'ductura/.github/.github/workflows/ci-node.yml@98f62800577910b24451809d40c247ee1f04c7c1',
  with: { scripts: 'typecheck test build budget' },
};
const FONTS: [string, string][] = [
  ['DejaVuSans.ttf', 'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280'],
  ['DejaVuSans-Bold.ttf', '5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895'],
];
const SUMS = FONTS.map(([file, hash]) => `${hash}  ${file}\n`).join('');
const FONT_SCRIPT = `set -euo pipefail
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
cd e2e/fonts
sha256sum --strict --check SHA256SUMS
install -D -m 0644 -t /usr/share/fonts/truetype/dejavu DejaVuSans.ttf DejaVuSans-Bold.ttf
fc-cache -f
for q in sans-serif system-ui sans-serif:lang=hr; do
  test "$(fc-match -f '%{family[0]}' "$q")" = 'DejaVu Sans'
done
test "$(fc-match -f '%{family[0]}|%{style[0]}' sans-serif:bold)" = 'DejaVu Sans|Bold'
`;
const STEPS: Obj[] = [
  { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', with: { 'persist-credentials': false } },
  { uses: 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413' },
  { run: 'pnpm install --frozen-lockfile' },
  { name: 'Install DejaVu fonts from the repo', shell: 'bash', run: FONT_SCRIPT },
  { run: 'pnpm e2e', env: { HOME: '/root' } },
  {
    if: 'failure()',
    uses: 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
    with: { name: 'e2e-matrix-report', path: 'playwright-report/', 'retention-days': 7 },
  },
];
const FORBIDDEN = /(?<![\w-])(?:apt|apt-get|aptitude|dpkg)(?![\w-])|playwright\S*\s+install/;
// Shell text without quotes, backslashes and line continuations, so that
// `ap''t-get`, `playwright "install"` and `playwright \<newline>install` are caught.
const installs = (s: unknown): boolean =>
  typeof s !== 'string' || FORBIDDEN.test(s.replace(/\\\r?\n/g, ' ').replace(/['"\\]/g, ''));

// The one version of @playwright/test, playwright and playwright-core in the lockfile.
function lockVersion(lock: Obj): string {
  const v = own(own(own(own(lock['importers'], '.'), 'devDependencies'), '@playwright/test'), 'version');
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) throw new Error('lockfile has no @playwright/test version');
  const packages = isMap(lock['packages']) ? Object.keys(lock['packages']) : [];
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    const found = packages.filter((k) => k.startsWith(`${name}@`)).map((k) => k.slice(name.length + 1));
    if (!isDeepStrictEqual(found, [v])) throw new Error(`lockfile ${name} versions ${found.join(',')} are not [${v}]`);
  }
  return v;
}

// Problems of ci.yml against the lockfile and package.json; empty when all is right.
function problems(ciText: string, lockText: string, pkgText: string): string[] {
  const out: string[] = [];
  let wf: Obj, version: string, scripts: unknown;
  try {
    wf = parse(ciText);
    version = lockVersion(parse(lockText));
    scripts = (JSON.parse(pkgText) as Obj)['scripts'];
  } catch (e) {
    return [`unreadable: ${(e as Error).message}`];
  }
  for (const key of ['env', 'defaults']) if (Object.hasOwn(wf, key)) out.push(`workflow has ${key}`);
  const jobs = isMap(wf['jobs']) ? wf['jobs'] : {};
  if (!isDeepStrictEqual(Object.keys(jobs), ['node', 'e2e-matrix', 'ci-ok'])) out.push(`jobs: ${Object.keys(jobs).join(',')}`);
  if (!isDeepStrictEqual(own(jobs, 'node'), NODE_JOB)) out.push('job node is not the ci-node.yml call');
  for (const [name, job] of Object.entries(jobs)) {
    if (own(job, 'defaults') !== undefined) out.push(`job ${name} has defaults`);
    const steps: unknown[] = Array.isArray(own(job, 'steps')) ? (own(job, 'steps') as unknown[]) : [];
    for (const step of steps) {
      if (name !== 'e2e-matrix' && own(step, 'uses') !== undefined) out.push(`job ${name} uses an action`);
      if (![undefined, 'bash'].includes(own(step, 'shell') as string)) out.push(`job ${name} has another shell`);
      if (own(step, 'run') !== undefined && installs(own(step, 'run'))) out.push(`job ${name} installs packages or browsers`);
    }
  }
  for (const [name, s] of Object.entries(isMap(scripts) ? scripts : {})) {
    if (installs(s)) out.push(`package.json script ${name} installs packages or browsers`);
  }
  const job = own(jobs, 'e2e-matrix');
  if (!isMap(job)) return [...out, 'no e2e-matrix job'];
  if (!isDeepStrictEqual(Object.keys(job).sort(), ['container', 'runs-on', 'steps', 'timeout-minutes'])) {
    out.push(`e2e-matrix keys: ${Object.keys(job).join(',')}`);
  }
  if (job['runs-on'] !== 'ubuntu-24.04' || job['timeout-minutes'] !== 20) out.push('runner or timeout changed');
  const container = job['container'];
  if (!isMap(container) || !isDeepStrictEqual(Object.keys(container), ['image'])) out.push('container is not { image }');
  const image = own(container, 'image');
  const m = typeof image === 'string' ? /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:([0-9a-f]{64})$/.exec(image) : null;
  if (!m) out.push(`image is not a pinned noble Playwright image: ${JSON.stringify(image)}`);
  else if (m[1] !== version) out.push(`image ${m[1]} is not lockfile ${version}`);
  else if (own(DIGESTS, m[1]) !== m[2]) out.push(`image digest is not the pinned one for ${m[1]}`);
  const steps = Array.isArray(job['steps']) ? job['steps'] : [];
  if (!isDeepStrictEqual(steps, STEPS)) out.push('e2e-matrix steps are not the allowed steps');
  return out;
}

const CI = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const LOCK = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const PKG = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const IMAGE = `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${DIGEST}`;
const swap = (text: string, from: string, to: string): string => {
  assert.ok(text.includes(from), `fixture has ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
const img = (to: string): string => swap(CI, `image: ${IMAGE}`, `image: ${to}`);
const E2E = '      - run: pnpm e2e\n';
const before = (step: string): string => swap(CI, E2E, `${step}${E2E}`);
const okStep = (step: string): string => swap(CI, '    steps:\n      - name: Every needed job succeeded\n', `    steps:\n      - ${step}\n      - name: Every needed job succeeded\n`);
const FONT_TEST = "test \"$(fc-match -f '%{family[0]}|%{style[0]}' sans-serif:bold)\" = 'DejaVu Sans|Bold'";

const ciCases: [string, string, RegExp][] = [
  ['playwright install is back', before('      - run: pnpm exec playwright install --with-deps chromium firefox webkit\n'), /installs/],
  ['playwright install-deps', before('      - run: npx playwright install-deps\n'), /installs/],
  ['pinned playwright install', before('      - run: npx playwright@1.63.0 install\n'), /installs/],
  ['apt-get install', before('      - run: apt-get install -y fonts-dejavu-core\n'), /installs/],
  ['sudo apt update', before('      - run: sudo apt update\n'), /installs/],
  ['dpkg -i', before('      - run: dpkg -i x.deb\n'), /installs/],
  ['setup-node is back', before('      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n'), /allowed steps/],
  ['pnpm dlx playwright install', before('      - run: pnpm dlx playwright install\n'), /installs/],
  ['harmless extra step', before('      - run: echo Adapt\n'), /allowed steps/],
  ['|| true on the font check', swap(CI, FONT_TEST, `${FONT_TEST} || true`), /allowed steps/],
  ['continue-on-error on e2e', swap(CI, E2E, `${E2E}        continue-on-error: true\n`), /allowed steps/],
  ['continue-on-error on the font step', swap(CI, '        shell: bash\n', '        shell: bash\n        continue-on-error: true\n'), /allowed steps/],
  ['if on e2e', swap(CI, E2E, `${E2E}        if: false\n`), /allowed steps/],
  ['if on the font step', swap(CI, '        shell: bash\n', '        shell: bash\n        if: false\n'), /allowed steps/],
  ['shell changed', swap(CI, '        shell: bash\n', '        shell: sh\n'), /allowed steps/],
  ['HOME removed', swap(CI, '          HOME: /root\n', '          LANG: C\n'), /allowed steps/],
  ['job env', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    env: { PLAYWRIGHT_BROWSERS_PATH: /tmp }\n'), /e2e-matrix keys/],
  ['job defaults', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    defaults: { run: { shell: "apt-get install -y x; bash {0}" } }\n'), /e2e-matrix keys/],
  ['job strategy', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    strategy: { matrix: { x: [1] } }\n'), /e2e-matrix keys/],
  ['job if', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    if: false\n'), /e2e-matrix keys/],
  ['job continue-on-error', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    continue-on-error: true\n'), /e2e-matrix keys/],
  ['services', swap(CI, '    timeout-minutes: 20\n', '    timeout-minutes: 20\n    services: { x: { image: y } }\n'), /e2e-matrix keys/],
  ['workflow env', swap(CI, 'permissions:\n', 'env: { HOME: /tmp }\npermissions:\n'), /workflow has env/],
  ['workflow defaults', swap(CI, 'permissions:\n', 'defaults: { run: { shell: sh } }\npermissions:\n'), /workflow has defaults/],
  ['other runner', swap(CI, '    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n', '    runs-on: ubuntu-22.04\n    timeout-minutes: 20\n'), /runner/],
  ['third job', swap(CI, '  ci-ok:\n', '  extra:\n    runs-on: u\n    steps: [{ run: "pnpm exec playwright install" }]\n  ci-ok:\n'), /jobs: node,e2e-matrix,extra,ci-ok/],
  ['node job changed', swap(CI, 'scripts: typecheck test build budget', 'scripts: typecheck test build budget e2e'), /job node is not/],
  ['ci-ok: line continuation', okStep('run: |\n          pnpm exec playwright \\\n          install --with-deps'), /job ci-ok installs/],
  ['ci-ok: quoted install', okStep(`run: playwright "install"`), /job ci-ok installs/],
  ['ci-ok: quotes inside apt-get', okStep(`run: sudo ap''t-get install -y x`), /job ci-ok installs/],
  ['ci-ok: shell runs the install', okStep(`{ shell: "npx playwright install; bash -e {0}", run: "true" }`), /job ci-ok has another shell/],
  ['ci-ok: local action', okStep('uses: ./.github/actions/install-browsers'), /job ci-ok uses an action/],
  ['ci-ok: defaults', swap(CI, '    permissions: {}\n', '    permissions: {}\n    defaults: { run: { shell: "apt-get install x; bash {0}" } }\n'), /job ci-ok has defaults/],
  ['image without digest', img('mcr.microsoft.com/playwright:v1.63.0-noble'), /not a pinned/],
  ['other digest', img(IMAGE.replace('eff16c', 'aff16c')), /digest is not the pinned/],
  ['digest in upper case', img(IMAGE.replace('eff16c', 'EFF16C')), /not a pinned/],
  ['digest of 63 characters', img(IMAGE.slice(0, -1)), /not a pinned/],
  ['two digests', img(`${IMAGE}@sha256:${DIGEST}`), /not a pinned/],
  ['other registry', img(IMAGE.replace('mcr.microsoft.com', 'docker.io')), /not a pinned/],
  ['jammy', img(IMAGE.replace('noble', 'jammy')), /not a pinned/],
  ['older image', img(IMAGE.replace('1.63.0', '1.62.0')), /not lockfile 1\.63\.0/],
  ['expression', img('"${{ vars.IMAGE }}"'), /not a pinned/],
  ['CRLF', img(`"${IMAGE}\\r\\n"`), /not a pinned/],
  ['tab', img(`"${IMAGE}\\t"`), /not a pinned/],
  ['NBSP', img(`"${IMAGE}\u00a0"`), /not a pinned/],
  ['DEL', img(`"${IMAGE}\u007f"`), /not a pinned/],
  ['leading space', img(`" ${IMAGE}"`), /not a pinned/],
  ['container is a string', swap(CI, `    container:\n      image: ${IMAGE}\n`, `    container: ${IMAGE}\n`), /container is not/],
  ['no container', swap(CI, `    container:\n      image: ${IMAGE}\n`, ''), /e2e-matrix keys/],
  ['container options', img(`${IMAGE}\n      options: --user 1001`), /container is not/],
  ['container credentials', img(`${IMAGE}\n      credentials: { username: x }`), /container is not/],
  ['container volumes', img(`${IMAGE}\n      volumes: [/a:/b]`), /container is not/],
  ['container env', img(`${IMAGE}\n      env: { HOME: /tmp }`), /container is not/],
  ['merge key adds options', swap(img(`${IMAGE}\n      <<: *opts`), 'permissions:\n', 'x-opts: &opts { options: --privileged }\npermissions:\n'), /container is not/],
  ['duplicate container key', img(`${IMAGE}\n    container: { image: x }`), /unreadable/],
  ['__proto__ key', img(`${IMAGE}\n      __proto__: { options: x }`), /container is not/],
  ['toString key', img(`${IMAGE}\n      toString: x`), /container is not/],
];
for (const [name, ci, reason] of ciCases) {
  test(`e2e image check refuses: ${name}`, () => {
    assert.match(problems(ci, LOCK, PKG).join('\n'), reason);
  });
}

const pw = "  '@playwright/test@1.63.0':\n    resolution";
const otherCases: [string, string, string, RegExp][] = [
  ['lockfile on 1.64.0, image on 1.63.0', LOCK.replaceAll('1.63.0', '1.64.0'), PKG, /not lockfile 1\.64\.0/],
  ['lockfile without @playwright/test', swap(LOCK, "      '@playwright/test':\n", "      '@playwright/tset':\n"), PKG, /no @playwright\/test version/],
  ['two playwright-core versions', swap(LOCK, '  playwright-core@1.63.0:\n', '  playwright-core@1.62.0:\n    resolution: {}\n\n  playwright-core@1.63.0:\n'), PKG, /playwright-core versions/],
  ['second @playwright/test', swap(LOCK, pw, `  '@playwright/test@1.62.0':\n    resolution: {}\n\n${pw}`), PKG, /@playwright\/test versions/],
  ['pree2e installs browsers', LOCK, swap(PKG, '"scripts": {', '"scripts": {\n    "pree2e": "playwright install",'), /script pree2e installs/],
  ['pree2e with a line continuation', LOCK, swap(PKG, '"scripts": {', '"scripts": {\n    "pree2e": "playwright \\\\\\ninstall",'), /script pree2e installs/],
  ['postinstall runs apt', LOCK, swap(PKG, '"scripts": {', '"scripts": {\n    "postinstall": "apt-get update",'), /script postinstall installs/],
];
for (const [name, lock, pkg, reason] of otherCases) {
  test(`e2e image check refuses: ${name}`, () => {
    assert.match(problems(CI, lock, pkg).join('\n'), reason);
  });
}

test('e2e image check refuses: tag and lockfile on 1.64.0 with the 1.63.0 digest', () => {
  const lock = LOCK.replaceAll('1.63.0', '1.64.0');
  assert.match(problems(img(IMAGE.replace('1.63.0', '1.64.0')), lock, PKG).join('\n'), /not the pinned one for 1\.64\.0/);
});

test('ci.yml, the lockfile and package.json pass the e2e image check', () => {
  assert.deepEqual(problems(CI, LOCK, PKG), []);
});

const fontDir = new URL('../e2e/fonts/', import.meta.url);
const sumsOk = (text: string): boolean => text === SUMS;
test.each([
  ['CRLF', SUMS.replaceAll('\n', '\r\n')],
  ['Windows path', SUMS.replace('  DejaVuSans.ttf', '  e2e\\fonts\\DejaVuSans.ttf')],
  ['extra line', `${SUMS}${'0'.repeat(64)}  DejaVuSerif.ttf\n`],
  ['other hash', SUMS.replace('ae7b', 'be7b')],
])('SHA256SUMS check refuses: %s', (_name, text) => {
  assert.equal(sumsOk(text), false);
});

test('e2e/fonts holds DejaVu Sans 2.37 with the pinned sha256 and SHA256SUMS', () => {
  for (const [file, hash] of FONTS) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, fontDir))).digest('hex'), hash, file);
  }
  assert.ok(sumsOk(readFileSync(new URL('SHA256SUMS', fontDir), 'utf8')));
  assert.match(readFileSync(new URL('LICENSE', fontDir), 'utf8'), /Bitstream Vera Fonts Copyright/);
});

test('fonts are binary and SHA256SUMS keeps LF in every checkout', () => {
  const files = ['e2e/fonts/DejaVuSans.ttf', 'e2e/fonts/DejaVuSans-Bold.ttf', 'e2e/fonts/SHA256SUMS'];
  const attrs = execFileSync('git', ['check-attr', 'binary', 'diff', 'merge', 'text', 'eol', '--', ...files], { encoding: 'utf8' });
  const font = (f: string): string[] => ['binary: set', 'diff: unset', 'merge: unset', 'text: unset', 'eol: unspecified'].map((a) => `${f}: ${a}`);
  const sums = ['binary: unspecified', 'diff: unspecified', 'merge: unspecified', 'text: set', 'eol: lf'].map((a) => `e2e/fonts/SHA256SUMS: ${a}`);
  assert.equal(attrs, [...font(files[0] ?? ''), ...font(files[1] ?? ''), ...sums, ''].join('\n'));
});
