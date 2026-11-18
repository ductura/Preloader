// DAN-1096: the claims of the recovery lab (docs/lab-oporavak.md) over what
// one run observed, and the report around them. Pure, so each claim is tested
// on its own; the run itself is scripts/lab/oporavak.ts.
import { createHash } from 'node:crypto';

import type { Probe } from './probe.ts';
import { type ReceiptExpectation, type ReceiptTrust, checkReceipt } from './receipt.ts';

export type Answer = { status: number; body: Record<string, unknown> };

export type Observed = {
  sentence: string;
  /** Document bytes sent with the commit. */
  sent: Uint8Array | null;
  firstOpen: Answer | null;
  commit: Answer | null;
  /** The stack's receipt key, from its seed and the key registry (receipt.ts). */
  trust: ReceiptTrust | null;
  /** The commit, segment and student the receipt has to name. */
  expected: ReceiptExpectation | null;
  /** The server's port between down and up (probe.ts); only 'refused' is down. */
  healthBetween: Probe | null;
  pidBefore: number | null;
  pidAfter: number | null;
  secondOpen: Answer | null;
};

export type Claim = { id: string; pass: boolean; detail: string };

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const claim = (id: string, pass: boolean, detail: string): Claim => ({ id, pass, detail });

/** The document of the second open, decoded here, or null. */
function reopened(o: Observed): Buffer | null {
  const doc = o.secondOpen?.status === 200 ? o.secondOpen.body['document'] : undefined;
  return typeof doc === 'string' ? Buffer.from(doc, 'base64') : null;
}

export function claims(o: Observed): Claim[] {
  const second = o.secondOpen?.status === 200 ? o.secondOpen.body : null;
  const doc = reopened(o);
  const own = doc === null ? null : sha256Hex(doc);
  const sent = o.sent === null ? null : sha256Hex(o.sent);
  const why =
    o.trust === null || o.expected === null
      ? 'nema ključa stoga ili očekivanog commita'
      : checkReceipt(o.commit?.body['receipt'], o.trust, o.expected);
  const first = o.firstOpen?.status === 200 ? o.firstOpen.body['documentId'] : undefined;
  return [
    claim(
      'L-1',
      o.commit?.status === 200 && o.commit.body['status'] === 'committed' && o.commit.body['revision'] === 1 && why === null,
      `commit ${o.commit?.status ?? '-'} ${String(o.commit?.body['status'] ?? '-')}, revizija ${String(o.commit?.body['revision'] ?? '-')}, potvrda: ${why ?? 'potpis provjeren ključem stoga'}`,
    ),
    claim(
      'L-2',
      o.healthBetween === 'refused' && o.pidBefore !== null && o.pidAfter !== null && o.pidBefore !== o.pidAfter,
      `port servera između down i up: ${o.healthBetween ?? '-'}; PID ${o.pidBefore ?? '-'} -> ${o.pidAfter ?? '-'}`,
    ),
    claim(
      'L-3',
      typeof first === 'string' && second?.['documentId'] === first,
      `drugi open ${o.secondOpen?.status ?? '-'}, documentId ${String(second?.['documentId'] ?? '-')}`,
    ),
    claim('L-4', second?.['currentRevision'] === 1, `currentRevision ${String(second?.['currentRevision'] ?? '-')}`),
    claim(
      'L-5',
      doc !== null && o.sent !== null && Buffer.compare(doc, o.sent) === 0 && doc.toString('utf8').includes(o.sentence),
      doc === null ? 'nema dokumenta' : `${doc.byteLength} B, rečenica ${doc.toString('utf8').includes(o.sentence) ? 'je' : 'nije'} u tekstu`,
    ),
    claim(
      'L-6',
      own !== null && own === second?.['documentHash'] && own === sent,
      `ovdje ${own ?? '-'}, server ${String(second?.['documentHash'] ?? '-')}, poslano ${sent ?? '-'}`,
    ),
  ];
}

/**
 * The preloader SHA of the report: always the checked-out HEAD (`git rev-parse
 * HEAD` output). A SHA the caller names (LAB_PRELOADER_SHA) is only checked
 * against it, so the report never names code other than what ran.
 */
export function preloaderSha(head: string | null, claimed: string | undefined): { sha: string | null; error: string | null } {
  const sha = head !== null && /^[0-9a-f]{40}\n$/.test(head) ? head.slice(0, 40) : null;
  if (sha === null) return { sha: null, error: 'HEAD preloadera nije čitljiv' };
  if (claimed !== undefined && claimed !== '' && claimed !== sha) {
    return { sha, error: `LAB_PRELOADER_SHA ${claimed} nije izvršeni HEAD ${sha}` };
  }
  return { sha, error: null };
}

export type Meta = {
  preloaderSha: string | null;
  serverSha: string | null;
  serverDirty: boolean | null;
  startedAt: string;
  finishedAt: string;
  error: string | null;
};

/** The report; field names of VS-1.12 so a later vs-run.json (DAN-887) can take them over. */
export function report(o: Observed, meta: Meta) {
  const list = claims(o);
  const second = o.secondOpen?.status === 200 ? o.secondOpen.body : null;
  const doc = reopened(o);
  return {
    schema: 'ductura.lab.oporavak/1',
    ticket: 'DAN-1096',
    covers: 'VS-1.13, samo API dio (bez preglednika)',
    result: meta.error === null && list.every((c) => c.pass) ? 'PASS' : 'FAIL',
    preloaderSha: meta.preloaderSha,
    webSha: null,
    serverSha: meta.serverSha,
    serverDirty: meta.serverDirty,
    browser: null,
    documentId: typeof second?.['documentId'] === 'string' ? second['documentId'] : null,
    revision: typeof second?.['currentRevision'] === 'number' ? second['currentRevision'] : null,
    hash: doc === null ? null : sha256Hex(doc),
    sentence: o.sentence,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    error: meta.error,
    claims: list,
    limits: [
      'webSha i browser su null: preglednik nije u v1 (DAN-1022)',
      'prijava lažnim OIDC-om nije pokrivena; sesija je upisani red (DAN-887)',
      'radnik se ne restartira: stog VS-1 ga još nema',
    ],
  };
}
