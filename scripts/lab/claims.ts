// DAN-1096: the claims of the recovery lab (docs/lab-oporavak.md) over what
// one run observed, and the report around them. Pure, so each claim is tested
// on its own; the run itself is scripts/lab/oporavak.ts.
import { createHash } from 'node:crypto';

export type Answer = { status: number; body: Record<string, unknown> };

/** What the probe of the server's port saw (probe.ts, DAN-1096-c); only 'refused' is down. */
export type Probe = 'refused' | 'open' | 'unknown';

/**
 * L-1's check of the commit's receipt: null when it holds, else why not. The
 * run binds checkReceipt (receipt.ts, DAN-1096-a1) to the stack's key and the
 * expected commit; here it is only called, with the commit's own receipt.
 */
export type ReceiptCheck = (receipt: unknown) => string | null;

export type Observed = {
  sentence: string;
  /** Document bytes sent with the commit. */
  sent: Uint8Array | null;
  firstOpen: Answer | null;
  commit: Answer | null;
  /** The receipt check bound to the stack's key and the expected commit; null when the run has neither. */
  receipt: ReceiptCheck | null;
  /** The server's port between down and up (probe.ts); only 'refused' is down. */
  healthBetween: Probe | null;
  /** From state.json: unchecked, so any JSON value. */
  pidBefore: unknown;
  pidAfter: unknown;
  secondOpen: Answer | null;
};

export type Claim = { id: string; pass: boolean; detail: string };

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const claim = (id: string, pass: boolean, detail: string): Claim => ({ id, pass, detail });

/** A value of an answer as text for a detail, calling nothing on it (no toString, valueOf or toJSON). */
export function text(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' || typeof v === 'function') return Array.isArray(v) ? '[niz]' : '[objekt]';
  return String(v);
}

/** An own field of an answer body; nothing inherited. */
const own = (body: Record<string, unknown> | null, key: string): unknown =>
  body !== null && Object.hasOwn(body, key) ? body[key] : undefined;

const isPid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** The body of a 200 answer when it is a JSON object, else null: a body of null or a list counts as no answer. */
function okBody(a: Answer | null): Record<string, unknown> | null {
  const body: unknown = a?.status === 200 ? a.body : null;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** The document of the second open in strict standard base64, decoded here, or null. */
function reopened(o: Observed): Buffer | null {
  const doc = own(okBody(o.secondOpen), 'document');
  if (typeof doc !== 'string') return null;
  const bytes = Buffer.from(doc, 'base64');
  // Node skips stray characters; only one spelling of the bytes counts.
  return bytes.toString('base64') === doc ? bytes : null;
}

export function claims(o: Observed): Claim[] {
  const second = okBody(o.secondOpen);
  const commit = okBody(o.commit);
  const doc = reopened(o);
  const mine = doc === null ? null : sha256Hex(doc);
  const sent = o.sent === null ? null : sha256Hex(o.sent);
  const why =
    o.receipt === null
      ? 'nema ključa stoga ili očekivanog commita'
      : o.receipt(own(commit, 'receipt'));
  const first = own(okBody(o.firstOpen), 'documentId');
  const [status, revision] = [own(commit, 'status'), own(commit, 'revision')];
  const [docId, current, docHash] = [own(second, 'documentId'), own(second, 'currentRevision'), own(second, 'documentHash')];
  return [
    claim(
      'L-1',
      status === 'committed' && revision === 1 && why === null,
      `commit ${text(o.commit?.status)} ${text(status)}, revizija ${text(revision)}, potvrda: ${why ?? 'potpis provjeren ključem stoga'}`,
    ),
    claim(
      'L-2',
      o.healthBetween === 'refused' && isPid(o.pidBefore) && isPid(o.pidAfter) && o.pidBefore !== o.pidAfter,
      `port servera između down i up: ${text(o.healthBetween)}; PID ${text(o.pidBefore)} -> ${text(o.pidAfter)}`,
    ),
    claim(
      'L-3',
      typeof first === 'string' && docId === first,
      `drugi open ${text(o.secondOpen?.status)}, documentId ${text(docId)}`,
    ),
    claim('L-4', current === 1, `currentRevision ${text(current)}`),
    claim(
      'L-5',
      doc !== null && o.sent !== null && Buffer.compare(doc, o.sent) === 0 && doc.toString('utf8').includes(o.sentence),
      doc === null ? 'nema dokumenta' : `${doc.byteLength} B, rečenica ${doc.toString('utf8').includes(o.sentence) ? 'je' : 'nije'} u tekstu`,
    ),
    claim(
      'L-6',
      mine !== null && mine === docHash && mine === sent,
      `ovdje ${text(mine)}, server ${text(docHash)}, poslano ${text(sent)}`,
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
  const second = okBody(o.secondOpen);
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
    documentId: typeof own(second, 'documentId') === 'string' ? own(second, 'documentId') : null,
    revision: Number.isSafeInteger(own(second, 'currentRevision')) ? own(second, 'currentRevision') : null,
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

/**
 * The report file's text, always: a report that cannot be built or written
 * out (an answer of an odd shape) is a FAIL report naming why, never an
 * exception that leaves an older report in place.
 */
export function reportText(o: Observed, meta: Meta): string {
  try {
    return `${JSON.stringify(report(o, meta), null, 2)}\n`;
  } catch (e) {
    const why = `izvještaj: ${e instanceof Error ? text(e.message) : text(e)}`;
    const empty: Observed = {
      sentence: text(o.sentence), sent: null, firstOpen: null, commit: null, receipt: null,
      healthBetween: null, pidBefore: null, pidAfter: null, secondOpen: null,
    };
    return `${JSON.stringify(report(empty, { ...meta, error: meta.error === null ? why : `${meta.error}; ${why}` }), null, 2)}\n`;
  }
}
