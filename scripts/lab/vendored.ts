// DAN-1096: test/fixtures/receipt-v2-golden.json is a copy of two values of
// the server's golden vectors. The lab-oporavak CI job runs this against the
// server checkout at SERVER_SHA, so the copy never drifts from its source.
//   node scripts/lab/vendored.ts <server checkout> <fixture>
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The one source the copy may come from. */
export const SOURCE_PATH = 'server/domain/forensics/golden-vectors/evidence-v2.json';

type Fixture = { source: { commit: string; path: string; blob: string }; verificationKey: unknown; accepted: unknown };

/** Null when `fixture` holds exactly the source's values and names the source's blob and commit; otherwise why not. */
export function vendoredProblem(source: Buffer, fixture: Fixture, serverSha: string): string | null {
  if (fixture.source.path !== SOURCE_PATH) return `kopija nije iz ${SOURCE_PATH}`;
  const blob = createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex');
  if (fixture.source.blob !== blob) return `izvor nije blob ${fixture.source.blob}`;
  if (fixture.source.commit !== serverSha) return `kopija je iz ${fixture.source.commit}, a CI veže ${serverSha}`;
  const d = JSON.parse(source.toString('utf8')) as { chain: { verificationKey: unknown }; receiptV2: { accepted: unknown[] } };
  if (!isDeepStrictEqual(fixture.verificationKey, d.chain.verificationKey)) return 'verificationKey se razlikuje od izvora';
  if (!isDeepStrictEqual(fixture.accepted, d.receiptV2.accepted[0])) return 'accepted[0] se razlikuje od izvora';
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [server = '', file = ''] = process.argv.slice(2);
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
  const problem = vendoredProblem(readFileSync(join(server, SOURCE_PATH)), fixture, process.env['SERVER_SHA'] ?? '');
  if (problem !== null) {
    console.error(`Vendorirani vektor: ${problem}`);
    process.exitCode = 1;
  }
}
