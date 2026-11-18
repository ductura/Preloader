// The PGDG key file of the lab-oporavak job holds exactly the pinned key (QA
// finding 4 on 3e05a73b: a second key next to it passed). Listings in the
// form of `gpg --show-keys --with-colons`; the keys are invented.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { pinnedKeyProblem } from '../scripts/ci/pgdg-key.ts';

const FPR = 'B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8';
const OTHER = '41644DA237456A24FB90461C5FBEFF3968168C71';
const key = (fpr: string, uid = 'Izmišljeni ključ <kljuc@example.invalid>') =>
  [
    `pub:-:4096:1:${fpr.slice(24)}:1311852115:::-:::scSC:::::::::0:`,
    `fpr:::::::::${fpr}:`,
    `uid:-::::1311852115::0000000000000000000000000000000000000000::${uid}::::::::::0:`,
    'sub:-:255:18:0877900D50EB74F2:1795007859::::::e:::::cv25519::',
    'fpr:::::::::1A805BD32163A7A16B3487620877900D50EB74F2:',
    '',
  ].join('\n');

test('exactly the pinned key passes, a non-ASCII uid included', () => {
  assert.equal(pinnedKeyProblem(key(FPR), FPR), null);
  assert.equal(pinnedKeyProblem(key(FPR, 'Ključ test'), FPR), null);
});

const refused: [string, string, string?][] = [
  ['an extra key after the pinned one', key(FPR) + key(OTHER)],
  ['an extra key before the pinned one', key(OTHER) + key(FPR)],
  ['another key', key(OTHER)],
  ['the pinned fingerprint only as a subkey', key(OTHER).replace('1A805BD32163A7A16B3487620877900D50EB74F2', FPR)],
  ['a secret key', `sec${key(FPR).slice(3)}`],
  ['a secret subkey', key(FPR).replace('sub:', 'ssb:')],
  ['no key', ''],
  ['CRLF lines', key(FPR).replaceAll('\n', '\r\n')],
  ['a tab', key(FPR).replace('uid:-', 'uid:\t-')],
  ['DEL', key(FPR).replace('ključ', 'klju\u007f')],
  ['NUL', `${key(FPR)}\0`],
  ['a lowercase pin', key(FPR), FPR.toLowerCase()],
  ['a short pin', key(FPR), FPR.slice(8)],
  ['a pin with a newline', key(FPR), `${FPR}\n`],
];

for (const [name, listing, pin] of refused) {
  test(`refuses ${name}`, () => {
    assert.notEqual(pinnedKeyProblem(listing, pin ?? FPR), null);
  });
}

test('the command fails on an extra key and passes on the pinned one', () => {
  const script = fileURLToPath(new URL('../scripts/ci/pgdg-key.ts', import.meta.url));
  const run = (input: string) => spawnSync(process.execPath, [script, FPR], { input, encoding: 'utf8' });
  assert.equal(run(key(FPR)).status, 0);
  const bad = run(key(FPR) + key(OTHER));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /2 javnih ključeva/);
});
