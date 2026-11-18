// DAN-1101: e2e-matrix runs in the official Playwright image, whose browsers
// belong to one Playwright version. The image tag must be the exact
// @playwright/test version from package.json (pnpm install --frozen-lockfile
// keeps the lockfile equal to it) and the image is pinned by digest. A
// Playwright bump therefore fails here, in the node job, with a clear message,
// instead of only as a missing browser in e2e-matrix.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

// Problems of an image reference for a Playwright version; empty when it is
// exactly mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex>.
function imageProblems(image: unknown, version: unknown): string[] {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    return ['@playwright/test in package.json is not an exact x.y.z version'];
  }
  if (typeof image !== 'string') return ['e2e-matrix has no container image'];
  const want = `mcr.microsoft.com/playwright:v${version}-noble@sha256:`;
  if (!image.startsWith(want) || !/^[0-9a-f]{64}$/.test(image.slice(want.length))) {
    return [`e2e-matrix image must be ${want}<64 hex digest>, got ${JSON.stringify(image)}`];
  }
  return [];
}

test('e2e-matrix runs in the Playwright image of the package.json version, pinned by digest', () => {
  const doc = parseDocument(read('../.github/workflows/ci.yml'), { uniqueKeys: true });
  assert.equal(doc.errors.length, 0, doc.errors.map((e) => e.message).join('; '));
  const wf = doc.toJS() as { jobs?: Record<string, { container?: { image?: unknown } }> };
  const pkg = JSON.parse(read('../package.json')) as { devDependencies?: Record<string, unknown> };
  const image = wf.jobs?.['e2e-matrix']?.container?.image;
  assert.deepEqual(imageProblems(image, pkg.devDependencies?.['@playwright/test']), []);
});

test('the image check refuses another version, distro, registry or a missing digest', () => {
  const digest = `@sha256:${'a'.repeat(64)}`;
  assert.deepEqual(imageProblems(`mcr.microsoft.com/playwright:v1.63.0-noble${digest}`, '1.63.0'), []);
  for (const image of [
    `mcr.microsoft.com/playwright:v1.62.0-noble${digest}`,
    `mcr.microsoft.com/playwright:v1.63.0-jammy${digest}`,
    `docker.io/playwright:v1.63.0-noble${digest}`,
    'mcr.microsoft.com/playwright:v1.63.0-noble',
    `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${'A'.repeat(64)}`,
    `mcr.microsoft.com/playwright:v1.63.0-noble@sha256:${'a'.repeat(63)}`,
    `mcr.microsoft.com/playwright:v1.63.0-noble${digest}\n`,
    undefined,
  ]) {
    assert.notDeepEqual(imageProblems(image, '1.63.0'), [], String(image));
  }
  assert.notDeepEqual(imageProblems(`mcr.microsoft.com/playwright:v1.63.0-noble${digest}`, '^1.63.0'), []);
});
