// The PGDG APT key file of the lab-oporavak CI job must hold exactly one
// public key, the pinned one: a second key in the same file would become an
// APT trust anchor for the PGDG source too. Reads the output of
// `gpg --show-keys --with-colons <file>` on stdin, the fingerprint as argv.
//   gpg --show-keys --with-colons pgdg.asc | node scripts/ci/pgdg-key.ts <FPR>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Null when the listing is one public key with fingerprint `fpr` and no secret key; otherwise why not. */
export function pinnedKeyProblem(colons: string, fpr: string): string | null {
  if (!/^[0-9A-F]{40}$/.test(fpr)) return 'zadani otisak nije 40 heksadekadskih znakova';
  // gpg writes LF and escapes control characters in a field; anything else is not its listing.
  if (/[\x00-\x09\x0b-\x1f\x7f]/.test(colons)) return 'ispis sadrži kontrolni znak';
  const records = colons.split('\n').filter((line) => line !== '').map((line) => line.split(':'));
  if (records.some((r) => r[0] === 'sec' || r[0] === 'ssb')) return 'datoteka sadrži tajni ključ';
  const primaries = records.flatMap((r, i) => (r[0] === 'pub' ? [i] : []));
  if (primaries.length !== 1) return `datoteka sadrži ${primaries.length} javnih ključeva, a smije točno jedan`;
  const fp = records[primaries[0]! + 1];
  return fp?.[0] === 'fpr' && fp[9] === fpr ? null : 'otisak ključa nije zadani';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = pinnedKeyProblem(readFileSync(0, 'utf8'), process.argv[2] ?? '');
  if (problem !== null) {
    console.error(`PGDG ključ: ${problem}`);
    process.exitCode = 1;
  }
}
