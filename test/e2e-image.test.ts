// DAN-1097-2: e2e-matrix runs in the official Playwright image pinned by digest,
// with the DejaVu fonts the DAN-1076 baselines were made with from e2e/fonts.
// ci.yml and the package.json scripts are an allowlist: the parsed workflow
// must equal ALLOWED key for key and step for step, and the script names must
// be exactly SCRIPT_NAMES with the e2e script as its exact text. Anything else
// (a job, a key such as env or defaults, a step, a changed run) fails.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { isAlias, isScalar, parseDocument, visit } from 'yaml';

type Obj = Record<string, unknown>;
const isMap = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (o: unknown, k: string): unknown => (isMap(o) && Object.hasOwn(o, k) ? o[k] : undefined);

// Strict reader: any YAML error or warning, a %YAML directive, an explicit
// tag (`!env`, `!!int "5"`), a merge key `<<` (pnpm's reader would merge it),
// an alias as a key, a duplicate key or a second document fails. A number or boolean
// must be written as decimal digits without a leading zero, true or false:
// 0x14, 020, +20 or FALSE fail.
function parse(text: string): Obj {
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  const issues = [...doc.errors, ...doc.warnings].map((e) => e.message);
  if (doc.directives?.yaml.explicit) issues.push(`%YAML ${doc.directives.yaml.version} directive`);
  visit(doc, {
    // Maps and lists: the Scalar visitor below takes scalars from Node.
    Node(_, node) {
      if (node.tag !== undefined) issues.push(`explicit tag ${node.tag}`);
    },
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') issues.push('merge key <<');
      if (isAlias(pair.key)) issues.push('alias as a key');
    },
    Scalar(_, node) {
      if (node.tag !== undefined) issues.push(`explicit tag ${node.tag}`);
      const plain = typeof node.value === 'number' || typeof node.value === 'boolean';
      if (plain && !/^(?:0|[1-9]\d*|true|false)$/.test(node.source ?? '')) issues.push(`scalar ${node.source} is not plain`);
    },
  });
  if (issues.length > 0) throw new Error(issues.join('; '));
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!isMap(value)) throw new Error('document is not a mapping');
  return value;
}

const DIGEST = 'eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
// Index digest of each allowed tag: a new Playwright needs a new row here.
const DIGESTS: Obj = { '1.63.0': DIGEST };
// The Playwright packages of each allowed version exactly as the lockfile
// must hold them: the importer entry, the packages entries (registry
// integrity, so no tarball, file, git or directory source) and the snapshots.
// A new Playwright needs a new row here.
const LOCK_ROWS: Obj = {
  '1.63.0': {
    '@playwright/test': 'sha512-oxMK4vllB9RK5NQ2l1pq1IfOf2AvnEuj/vYGDj0H2nMtmtZpKtCwt/l00GEO6xjGfpBNAvjovvYdCm50dRQkpQ==',
    playwright: 'sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg==',
    'playwright-core': 'sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==',
  },
};
const lockEntries = (v: string, integrity: Obj): Record<string, Obj> => {
  const pkg = (name: string): Obj => ({ resolution: { integrity: integrity[name] }, engines: { node: '>=20' }, hasBin: true });
  return {
    packages: { [`@playwright/test@${v}`]: pkg('@playwright/test'), [`playwright@${v}`]: pkg('playwright'), [`playwright-core@${v}`]: pkg('playwright-core') },
    snapshots: {
      [`@playwright/test@${v}`]: { dependencies: { playwright: v } },
      [`playwright@${v}`]: { dependencies: { 'playwright-core': v } },
      [`playwright-core@${v}`]: {},
    },
  };
};
const FONTS: [string, string][] = [
  ['DejaVuSans.ttf', 'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280'],
  ['DejaVuSans-Bold.ttf', '5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895'],
];
const SUMS = FONTS.map(([file, hash]) => `${hash}  ${file}\n`).join('');
const FONT_SCRIPT = String.raw`set -euo pipefail
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
const CI_OK_SCRIPT = String.raw`# ci-ok:begin
set -euo pipefail
if ! jq -e 'type == "object" and length > 0' >/dev/null 2>&1 <<< "$NEEDS"; then
  echo "::error::needs must be a non-empty JSON object"
  exit 1
fi
problems="$(jq -r 'to_entries[] | ((.value | objects | .result) // "missing") as $r
  | select($r != "success") | "job \(.key) result: \($r)"' <<< "$NEEDS")"
if [ -n "$problems" ]; then
  while IFS= read -r line; do echo "::error::$line"; done <<< "$problems"
  exit 1
fi
echo "ci-ok: $(jq length <<< "$NEEDS") job(s) passed"
# ci-ok:end
`;
const imageOf = (version: string): string => `mcr.microsoft.com/playwright:v${version}-noble@sha256:${String(own(DIGESTS, version))}`;

// The whole of ci.yml as it may be, for the Playwright version of the lockfile.
const allowed = (version: string): Obj => ({
  name: 'CI',
  on: { push: { branches: ['main'] }, pull_request: null },
  permissions: { contents: 'read' },
  jobs: {
    node: {
      uses: 'ductura/.github/.github/workflows/ci-node.yml@98f62800577910b24451809d40c247ee1f04c7c1',
      with: { scripts: 'typecheck test build budget' },
    },
    'e2e-matrix': {
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 20,
      container: { image: imageOf(version) },
      steps: [
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
      ],
    },
    'ci-ok': {
      name: 'ci-ok',
      if: '${{ always() }}',
      needs: ['node', 'e2e-matrix'],
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
      permissions: {},
      steps: [
        { name: 'Every needed job succeeded', shell: 'bash', env: { NEEDS: '${{ toJSON(needs) }}' }, run: CI_OK_SCRIPT },
      ],
    },
  },
});
const SCRIPT_NAMES = ['budget', 'build', 'e2e', 'test', 'typecheck'];
const E2E_SCRIPT = 'node scripts/build.ts && playwright test -c e2e/matrix/playwright.config.ts';

// The Playwright version of the lockfile. Named fields must equal LOCK_ROWS:
// the importer entry is exactly { specifier: v, version: v } (so npm:,
// workspace:, catalog:, tarball and git specifiers fail), the packages and
// snapshots keys of the three names are exactly name@v with the pinned
// entries, and any other snapshot that depends on one of them names v.
const PW = ['@playwright/test', 'playwright', 'playwright-core'];
const DEP_FIELDS = ['dependencies', 'optionalDependencies'];
function lockVersion(lock: unknown): string {
  const importers = own(lock, 'importers');
  if (!isMap(importers) || !isDeepStrictEqual(keysOf(importers), ['.'])) throw new Error('lockfile importers are not [.]');
  const entry = own(own(own(importers, '.'), 'devDependencies'), '@playwright/test');
  const v = own(entry, 'version');
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) throw new Error('lockfile has no @playwright/test version');
  if (!isDeepStrictEqual(entry, { specifier: v, version: v })) throw new Error(`lockfile importer @playwright/test is not { specifier: ${v}, version: ${v} }`);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = own(own(importers, '.'), field);
    for (const name of PW) {
      if (isMap(deps) && Object.hasOwn(deps, name) && !(field === 'devDependencies' && name === '@playwright/test')) {
        throw new Error(`lockfile importer has ${name} in ${field}`);
      }
    }
  }
  const row = own(LOCK_ROWS, v);
  if (!isMap(row)) throw new Error(`no pinned lockfile entries for Playwright ${v}`);
  for (const [section, expected] of Object.entries(lockEntries(v, row))) {
    const actual = own(lock, section);
    if (!isMap(actual)) throw new Error(`lockfile ${section} is not a mapping`);
    const keys = Object.keys(actual).filter((k) => PW.some((name) => k.startsWith(`${name}@`)));
    if (!isDeepStrictEqual(keys.sort(), keysOf(expected))) throw new Error(`lockfile ${section} Playwright keys: ${keys.join(',')}`);
    for (const key of keys) {
      if (!isDeepStrictEqual(actual[key], expected[key])) throw new Error(`lockfile ${section} ${key} is not the pinned entry`);
    }
  }
  for (const [key, snapshot] of Object.entries(own(lock, 'snapshots') as Obj)) {
    for (const field of DEP_FIELDS) {
      for (const name of PW) {
        const dep = own(own(snapshot, field), name);
        if (dep !== undefined && dep !== v) throw new Error(`lockfile snapshot ${key} resolves ${name} to ${JSON.stringify(dep)}`);
      }
    }
  }
  return v;
}

const keysOf = (o: Obj): string[] => Object.keys(o).sort();
// Mappings are compared key set by key set, so a problem names its path; any
// other value (a list of steps, a run text) must be deeply equal.
function compare(path: string, actual: unknown, expected: unknown, out: string[]): void {
  if (!isMap(expected)) {
    if (!isDeepStrictEqual(actual, expected)) out.push(`${path} is not the allowed value`);
    return;
  }
  if (!isMap(actual)) return void out.push(`${path} is not a mapping`);
  if (!isDeepStrictEqual(keysOf(actual), keysOf(expected))) out.push(`${path} keys: ${keysOf(actual).join(',')}`);
  for (const key of Object.keys(expected)) if (Object.hasOwn(actual, key)) compare(`${path}.${key}`, actual[key], expected[key], out);
}

// Problems of the parsed ci.yml, lockfile and package.json; empty when all is right.
function problems(wf: unknown, lock: unknown, pkg: unknown): string[] {
  let version: string;
  try {
    version = lockVersion(lock);
  } catch (e) {
    return [(e as Error).message];
  }
  const out: string[] = [];
  if (typeof own(DIGESTS, version) !== 'string') out.push(`no pinned image digest for Playwright ${version}`);
  compare('workflow', wf, allowed(version), out);
  const scripts = own(pkg, 'scripts');
  if (!isMap(scripts)) return [...out, 'package.json scripts is not a mapping'];
  if (!isDeepStrictEqual(keysOf(scripts), SCRIPT_NAMES)) out.push(`package.json script names: ${keysOf(scripts).join(',')}`);
  if (own(scripts, 'e2e') !== E2E_SCRIPT) out.push('package.json e2e script is not the allowed text');
  return out;
}

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const CI_TEXT = read('../.github/workflows/ci.yml');
const LOCK_TEXT = read('../pnpm-lock.yaml');
const PKG_TEXT = read('../package.json');
const WF = parse(CI_TEXT);
const LOCK = parse(LOCK_TEXT);
const PKG = JSON.parse(PKG_TEXT) as Obj;

// Each negative case edits a deep copy of the parsed files, never their text.
type Files = { wf: Obj; lock: Obj; pkg: Obj };
const at = (o: unknown, ...path: (string | number)[]): Obj =>
  path.reduce<Obj>((cur, k) => (cur as Record<string | number, unknown>)[k] as Obj, o as Obj);
// An own enumerable key, as a parser makes it: `o.__proto__ = v` would set the prototype instead.
const put = (o: Obj, key: string, value: unknown): void => {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
  assert.ok(Object.hasOwn(o, key));
};
const job = (f: Files, name: string): Obj => at(f.wf, 'jobs', name);
const steps = (f: Files, name: string): Obj[] => job(f, name)['steps'] as Obj[];
const setImage = (f: Files, image: string): void => void (at(job(f, 'e2e-matrix'), 'container')['image'] = image);
const IMAGE = imageOf('1.63.0');
// Every 1.63.0 in the parsed lockfile (keys, entries, peer suffixes) moves to `to`.
const bumpLock = (f: Files, to: string): void => {
  f.lock = JSON.parse(JSON.stringify(f.lock).replaceAll('1.63.0', to)) as Obj;
};

const JOBS = ['node', 'e2e-matrix', 'ci-ok'];
const JOB_KEYS: [string, unknown][] = [
  ['env', { CI: 'true' }],
  ['defaults', { run: { shell: 'sh' } }],
  ['services', { x: { image: 'y' } }],
  ['container', { image: 'x' }],
  ['strategy', { matrix: { x: [1] } }],
  ['if', 'false'],
  ['continue-on-error', true],
  ['Env', { CI: 'true' }],
  ['__proto__', { env: { CI: 'true' } }],
  ['toString', 'x'],
];
const INSTALL = 'pnpm exec playwright </dev/null install';
const cases: [string, (f: Files) => void, RegExp][] = [
  ...JOBS.flatMap((name) =>
    JOB_KEYS.filter(([key]) => !Object.hasOwn(at(WF, 'jobs', name), key)).map(
      ([key, value]): [string, (f: Files) => void, RegExp] => [
        `job ${name} gets ${key}`,
        (f) => put(job(f, name), key, value),
        new RegExp(`^workflow\\.jobs\\.${name} keys: `, 'm'),
      ],
    ),
  ),
  ...['e2e-matrix', 'ci-ok'].flatMap((name): [string, (f: Files) => void, RegExp][] => {
    const why = new RegExp(`^workflow\\.jobs\\.${name}\\.steps is not the allowed value$`);
    return [
      [`${name}: added run step first`, (f) => void steps(f, name).unshift({ run: INSTALL }), why],
      [`${name}: added run step last`, (f) => void steps(f, name).push({ run: INSTALL }), why],
      [`${name}: added uses step`, (f) => void steps(f, name).push({ uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' }), why],
      [`${name}: step removed`, (f) => void steps(f, name).pop(), why],
      [`${name}: run text gets || true`, (f) => void (steps(f, name).find((s) => s['shell'])!['run'] += ' || true\n'), why],
      [`${name}: run text gets a line continuation`, (f) => void (steps(f, name).find((s) => s['shell'])!['run'] += 'play\\\nwright install\n'), why],
      [`${name}: run text with CRLF`, (f) => void (steps(f, name).find((s) => s['shell'])!['run'] = String(steps(f, name).find((s) => s['shell'])!['run']).replaceAll('\n', '\r\n')), why],
      [`${name}: shell changed`, (f) => void (steps(f, name).find((s) => s['shell'])!['shell'] = 'sh'), why],
      [`${name}: step env added`, (f) => void (steps(f, name)[0]!['env'] = { PLAYWRIGHT_BROWSERS_PATH: '/tmp' }), why],
      [`${name}: step if added`, (f) => void (steps(f, name).find((s) => s['shell'])!['if'] = 'false'), why],
      [`${name}: step continue-on-error`, (f) => void (steps(f, name).find((s) => s['shell'])!['continue-on-error'] = true), why],
      [`${name}: step working-directory`, (f) => void (steps(f, name)[0]!['working-directory'] = '/'), why],
    ];
  }),
  ['e2e-matrix: steps reordered', (f) => void steps(f, 'e2e-matrix').reverse(), /e2e-matrix\.steps is not/],
  ['e2e-matrix: HOME changed', (f) => void (steps(f, 'e2e-matrix')[4]!['env'] = { HOME: '/tmp' }), /e2e-matrix\.steps is not/],
  ['e2e-matrix: action pin changed', (f) => void (steps(f, 'e2e-matrix')[1]!['uses'] = 'pnpm/action-setup@v6'), /e2e-matrix\.steps is not/],
  ['e2e-matrix: runner changed', (f) => void (job(f, 'e2e-matrix')['runs-on'] = 'ubuntu-22.04'), /e2e-matrix\.runs-on is not/],
  ['e2e-matrix: timeout as text', (f) => void (job(f, 'e2e-matrix')['timeout-minutes'] = '20'), /e2e-matrix\.timeout-minutes is not/],
  ['ci-ok: needs without e2e-matrix', (f) => void (job(f, 'ci-ok')['needs'] = ['node']), /ci-ok\.needs is not/],
  ['ci-ok: if changed', (f) => void (job(f, 'ci-ok')['if'] = 'success()'), /ci-ok\.if is not/],
  ['ci-ok: permissions widened', (f) => void (job(f, 'ci-ok')['permissions'] = { contents: 'write' }), /ci-ok\.permissions keys/],
  ['node: pin changed', (f) => void (job(f, 'node')['uses'] = 'ductura/.github/.github/workflows/ci-node.yml@main'), /node\.uses is not/],
  ['node: scripts changed', (f) => void (at(job(f, 'node'), 'with')['scripts'] = 'typecheck test build budget e2e'), /node\.with\.scripts is not/],
  ['job added', (f) => void (at(f.wf, 'jobs')['extra'] = { 'runs-on': 'u', steps: [{ run: INSTALL }] }), /^workflow\.jobs keys: ci-ok,e2e-matrix,extra,node$/m],
  ['job removed', (f) => void delete at(f.wf, 'jobs')['node'], /^workflow\.jobs keys: ci-ok,e2e-matrix$/m],
  ['jobs is a list', (f) => void (f.wf['jobs'] = []), /workflow\.jobs is not a mapping/],
  ['workflow env', (f) => void (f.wf['env'] = { HOME: '/tmp' }), /^workflow keys: /m],
  ['workflow defaults', (f) => void (f.wf['defaults'] = { run: { shell: 'sh' } }), /^workflow keys: /m],
  ['workflow concurrency', (f) => void (f.wf['concurrency'] = 'x'), /^workflow keys: /m],
  ['on read as true', (f) => void ((f.wf['true'] = f.wf['on']), delete f.wf['on']), /^workflow keys: /m],
  ['workflow __proto__', (f) => put(f.wf, '__proto__', { env: {} }), /^workflow keys: /m],
  ['on gets workflow_dispatch', (f) => void (at(f.wf, 'on')['workflow_dispatch'] = null), /workflow\.on keys/],
  ['permissions write-all', (f) => void (f.wf['permissions'] = 'write-all'), /workflow\.permissions is not a mapping/],
  ['image without digest', (f) => setImage(f, 'mcr.microsoft.com/playwright:v1.63.0-noble'), /container\.image is not/],
  ['other digest', (f) => setImage(f, IMAGE.replace('eff16c', 'aff16c')), /container\.image is not/],
  ['digest in upper case', (f) => setImage(f, IMAGE.replace('eff16c', 'EFF16C')), /container\.image is not/],
  ['digest of 63 characters', (f) => setImage(f, IMAGE.slice(0, -1)), /container\.image is not/],
  ['two digests', (f) => setImage(f, `${IMAGE}@sha256:${DIGEST}`), /container\.image is not/],
  ['other registry', (f) => setImage(f, IMAGE.replace('mcr.microsoft.com', 'docker.io')), /container\.image is not/],
  ['jammy', (f) => setImage(f, IMAGE.replace('noble', 'jammy')), /container\.image is not/],
  ['older image', (f) => setImage(f, IMAGE.replace('1.63.0', '1.62.0')), /container\.image is not/],
  ['expression', (f) => setImage(f, '${{ vars.IMAGE }}'), /container\.image is not/],
  ...['\r\n', '\t', ' ', '\u007f'].map((c): [string, (f: Files) => void, RegExp] => [
    `image ending in U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    (f) => setImage(f, `${IMAGE}${c}`),
    /container\.image is not/,
  ]),
  ['leading space', (f) => setImage(f, ` ${IMAGE}`), /container\.image is not/],
  ['container is a string', (f) => void (job(f, 'e2e-matrix')['container'] = IMAGE), /container is not a mapping/],
  ...['options', 'credentials', 'volumes', 'env', '<<', '__proto__', 'toString'].map((key): [string, (f: Files) => void, RegExp] => [
    `container gets ${key}`,
    (f) => put(at(job(f, 'e2e-matrix'), 'container'), key, { x: '--privileged' }),
    /container keys: /,
  ]),
  ...['pree2e', 'poste2e', 'preinstall', 'postinstall', 'prepare', '__proto__', 'toString'].map((name): [string, (f: Files) => void, RegExp] => [
    `script ${name} added`,
    (f) => put(at(f.pkg, 'scripts'), name, 'playwright install'),
    /package\.json script names: /,
  ]),
  ['e2e script changed', (f) => void (at(f.pkg, 'scripts')['e2e'] = `playwright ins$()tall && ${E2E_SCRIPT}`), /e2e script is not/],
  ['e2e script removed', (f) => void delete at(f.pkg, 'scripts')['e2e'], /script names: budget,build,test,typecheck\n.*e2e script is not/],
  ['typecheck script removed', (f) => void delete at(f.pkg, 'scripts')['typecheck'], /script names: budget,build,e2e,test$/],
  ['scripts missing', (f) => void delete f.pkg['scripts'], /scripts is not a mapping/],
  ['lockfile on 1.64.0, image on 1.63.0', (f) => bumpLock(f, '1.64.0'), /no pinned lockfile entries for Playwright 1\.64\.0/],
  ['tag and lockfile on 1.64.0 with the 1.63.0 digest', (f) => (bumpLock(f, '1.64.0'), setImage(f, IMAGE.replace('1.63.0', '1.64.0'))), /no pinned lockfile entries for Playwright 1\.64\.0/],
  ...([
    ['npm: alias', 'npm:@playwright/test@1.64.0'],
    ['workspace:', 'workspace:*'],
    ['catalog:', 'catalog:'],
    ['tarball URL', 'https://registry.npmjs.org/@playwright/test/-/test-1.64.0.tgz'],
    ['git URL', 'github:microsoft/playwright#v1.64.0'],
    ['another version', '1.64.0'],
  ] as const).map(([name, specifier]): [string, (f: Files) => void, RegExp] => [
    `importer specifier as ${name}`,
    (f) => void (at(f.lock, 'importers', '.', 'devDependencies', '@playwright/test')['specifier'] = specifier),
    /importer @playwright\/test is not \{ specifier: 1\.63\.0, version: 1\.63\.0 \}/,
  ]),
  ['importer version as a tarball URL', (f) => void (at(f.lock, 'importers', '.', 'devDependencies', '@playwright/test')['version'] = 'https://example.invalid/test-1.63.0.tgz'), /no @playwright\/test version/],
  ['importer without specifier', (f) => void delete at(f.lock, 'importers', '.', 'devDependencies', '@playwright/test')['specifier'], /importer @playwright\/test is not/],
  ['importer with an extra key', (f) => void (at(f.lock, 'importers', '.', 'devDependencies', '@playwright/test')['dev'] = true), /importer @playwright\/test is not/],
  ...['__proto__', 'toString'].map((key): [string, (f: Files) => void, RegExp] => [
    `importer with own key ${key}`,
    (f) => put(at(f.lock, 'importers', '.', 'devDependencies', '@playwright/test'), key, { specifier: '1.64.0' }),
    /importer @playwright\/test is not/,
  ]),
  ['importer specifier only inherited', (f) => {
    const deps = at(f.lock, 'importers', '.', 'devDependencies');
    deps['@playwright/test'] = Object.assign(Object.create({ specifier: '1.63.0' }) as Obj, { version: '1.63.0' });
  }, /no @playwright\/test version/], // not a plain mapping, so no own version is read
  ['second importer', (f) => void (at(f.lock, 'importers')['packages/x'] = {}), /importers are not \[\.\]/],
  ['importer gets playwright-core', (f) => void (at(f.lock, 'importers', '.', 'devDependencies')['playwright-core'] = { specifier: 'link:../x', version: 'link:../x' }), /importer has playwright-core in devDependencies/],
  ['lockfile without @playwright/test', (f) => void delete at(f.lock, 'importers', '.', 'devDependencies')['@playwright/test'], /no @playwright\/test version/],
  ['playwright-core resolved from a tarball', (f) => void (at(f.lock, 'packages', 'playwright-core@1.63.0')['resolution'] = {
    tarball: 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.64.0.tgz',
    integrity: 'sha512-AAAA',
  }), /packages playwright-core@1\.63\.0 is not the pinned entry/],
  ['playwright with another integrity', (f) => void (at(f.lock, 'packages', 'playwright@1.63.0', 'resolution')['integrity'] = 'sha512-AAAA'), /packages playwright@1\.63\.0 is not/],
  ['@playwright/test resolution gets a key', (f) => void (at(f.lock, 'packages', '@playwright/test@1.63.0', 'resolution')['directory'] = '../x'), /packages @playwright\/test@1\.63\.0 is not/],
  ['packages entry without its key', (f) => void delete at(f.lock, 'packages')['playwright@1.63.0'], /packages Playwright keys: /],
  ['two playwright-core versions', (f) => void (at(f.lock, 'packages')['playwright-core@1.62.0'] = {}), /packages Playwright keys: .*playwright-core@1\.62\.0/],
  ['second @playwright/test', (f) => void (at(f.lock, 'packages')['@playwright/test@1.62.0'] = {}), /packages Playwright keys: .*@playwright\/test@1\.62\.0/],
  ['snapshot of another playwright-core', (f) => void (at(f.lock, 'snapshots')['playwright-core@1.64.0'] = {}), /snapshots Playwright keys: /],
  ['snapshot dependency on another version', (f) => void (at(f.lock, 'snapshots', 'playwright@1.63.0', 'dependencies')['playwright-core'] = '1.64.0'), /snapshots playwright@1\.63\.0 is not the pinned entry/],
  ['npm alias for playwright-core', (f) => void (at(f.lock, 'snapshots', 'playwright@1.63.0', 'dependencies')['playwright-core'] = 'patchright-core@1.57.0'), /snapshots playwright@1\.63\.0 is not/],
  ['snapshot gets another dependency', (f) => void (at(f.lock, 'snapshots', 'playwright@1.63.0', 'dependencies')['x'] = 'playwright-core@1.64.0'), /snapshots playwright@1\.63\.0 is not/],
  ['axe resolves playwright-core to 1.64.0', (f) => void (at(f.lock, 'snapshots', '@axe-core/playwright@4.14.0(playwright-core@1.63.0)', 'dependencies')['playwright-core'] = '1.64.0'), /resolves playwright-core to "1\.64\.0"/],
  ['axe resolves playwright-core through npm:', (f) => void (at(f.lock, 'snapshots', '@axe-core/playwright@4.14.0(playwright-core@1.63.0)', 'dependencies')['playwright-core'] = 'npm:playwright-core@1.64.0'), /resolves playwright-core to "npm:playwright-core@1\.64\.0"/],
  ['snapshot with optional playwright', (f) => void (at(f.lock, 'snapshots', '@axe-core/playwright@4.14.0(playwright-core@1.63.0)')['optionalDependencies'] = { playwright: 'workspace:*' }), /resolves playwright to "workspace:\*"/],
  ['key that joins two keys with a comma', (f) => {
    const ok = job(f, 'ci-ok');
    delete ok['name'];
    delete ok['if'];
    ok['if,name'] = 'x';
  }, /^workflow\.jobs\.ci-ok keys: /m],
];
for (const [name, edit, reason] of cases) {
  test(`e2e allowlist refuses: ${name}`, () => {
    const f = structuredClone({ wf: WF, lock: LOCK, pkg: PKG });
    edit(f);
    assert.match(problems(f.wf, f.lock, f.pkg).join('\n'), reason);
  });
}

test('ci.yml, the lockfile and package.json equal the allowlist', () => {
  assert.deepEqual(problems(WF, LOCK, PKG), []);
});

test('the files read the same with CRLF line ends', () => {
  const crlf = (t: string): string => t.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  assert.deepEqual(parse(crlf(CI_TEXT)), WF);
  assert.deepEqual(parse(crlf(LOCK_TEXT)), LOCK);
  assert.deepEqual(JSON.parse(crlf(PKG_TEXT)), PKG);
});

// Text cases only for what the reader itself must refuse or keep visible.
// They edit LF text, so they also run in a CRLF checkout (core.autocrlf).
const CI_LF = CI_TEXT.replaceAll('\r\n', '\n');
const swap = (from: string, to: string): string => {
  assert.ok(CI_LF.includes(from), `ci.yml has ${JSON.stringify(from)}`);
  return CI_LF.replace(from, to);
};
const IMAGE_LINE = `      image: ${IMAGE}\n`;
test.each([
  ['duplicate container key', swap(IMAGE_LINE, `${IMAGE_LINE}    container: { image: x }\n`), /Map keys must be unique/],
  ['unknown tag', swap('    timeout-minutes: 20\n', '    timeout-minutes: !env 20\n'), /Unresolved tag/],
  ['alias as a key', swap('    timeout-minutes: 20\n', '    timeout-minutes: &k 20\n    *k : x\n'), /alias as a key/],
  ['tagged quoted number', swap('    timeout-minutes: 5\n', '    timeout-minutes: !!int "5"\n'), /explicit tag tag:yaml\.org,2002:int/],
  ['merge key with the allowed value', swap(IMAGE_LINE, `      <<: *img\n`).replace('permissions:\n', `x-img: &img { image: ${IMAGE} }\npermissions:\n`), /merge key <</],
  ['YAML 1.1 directive', `%YAML 1.1\n---\n${CI_LF}`, /%YAML 1\.1 directive/],
  ['YAML 1.2 directive', `%YAML 1.2\n---\n${CI_LF}`, /%YAML 1\.2 directive/],
  ['timeout as 020', swap('    timeout-minutes: 20\n', '    timeout-minutes: 020\n'), /scalar 020 is not plain/],
  ['second document', `${CI_LF}---\nname: x\n`, /Source contains multiple documents/],
  ['timeout as 0x14', swap('    timeout-minutes: 20\n', '    timeout-minutes: 0x14\n'), /scalar 0x14 is not plain/],
  ['persist-credentials as FALSE', swap('persist-credentials: false', 'persist-credentials: FALSE'), /scalar FALSE is not plain/],
])('reader refuses: %s', (_name, text, reason) => {
  assert.throws(() => parse(text), reason);
});

test('reader refuses a merge key in the lockfile', () => {
  const lock = LOCK_TEXT.replaceAll('\r\n', '\n');
  assert.ok(lock.includes('\npackages:\n'));
  assert.throws(() => parse(lock.replace('\npackages:\n', "\npackages:\n  <<: { 'playwright-core@1.64.0': {} }\n")), /merge key <</);
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
