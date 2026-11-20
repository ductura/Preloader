// DAN-1096: the claims of the recovery lab (docs/lab-oporavak.md) over what
// one run observed; the report around them follows in DAN-1096-a2-i-b. Pure, so
// each claim is tested on its own; the run itself is scripts/lab/oporavak.ts.
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
