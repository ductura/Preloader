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

/** Whether v is a list; a revoked Proxy, on which Array.isArray throws, is null: neither list nor object. */
function isList(v: unknown): boolean | null {
  try {
    return Array.isArray(v);
  } catch {
    return null;
  }
}

/** A value of an answer as text for a detail, calling nothing on it (no toString, valueOf or toJSON). */
export function text(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' || typeof v === 'function') return isList(v) === true ? '[niz]' : '[objekt]';
  return String(v);
}

/** An own field of an answer body; nothing inherited, and a field that cannot be read is no field. */
function own(body: Record<string, unknown> | null, key: string): unknown {
  try {
    return body !== null && Object.hasOwn(body, key) ? body[key] : undefined;
  } catch {
    return undefined;
  }
}

const isPid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Text with something in it: '' === '' and includes('') hold for anything, so a blank is no evidence. */
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);

/** A value thrown at us as text, or '-' when it is blank or even reading it throws. */
function thrown(e: unknown): string {
  try {
    const why = e instanceof Error ? text(e.message) : text(e);
    return filled(why) ? why : '-';
  } catch {
    return '-';
  }
}

/** L-1's receipt check run as foreign code: whatever it throws or returns, the answer is null or a reason. */
function receiptProblem(check: ReceiptCheck | null, receipt: unknown): string | null {
  if (check === null) return 'nema ključa stoga ili očekivanog commita';
  let why: unknown;
  try {
    why = check(receipt);
  } catch (e) {
    return `provjera potvrde: ${thrown(e)}`;
  }
  return why === null ? null : filled(why) ? why : 'provjera potvrde nije dala razlog';
}

/** An answer read once: its status, and the asked-for own fields of a 200 JSON object body, each read once. */
type Snap = { status: unknown; body: Record<string, unknown> | null };

/** A body of null or a list counts as no answer. */
function snap(a: Answer | null, keys: readonly string[]): Snap {
  if (a === null) return { status: undefined, body: null };
  const status: unknown = a.status;
  const raw: unknown = status === 200 ? a.body : null;
  if (typeof raw !== 'object' || raw === null || isList(raw) !== false) return { status, body: null };
  const body: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const v = own(raw as Record<string, unknown>, key);
    if (v !== undefined) body[key] = v;
  }
  return { status, body };
}

/**
 * What one run observed, read once: every claim and the report work on this
 * copy, so a value checked is the value reported (a getter that answers twice
 * gets asked once). The sent bytes are copied for the same reason.
 */
type Seen = {
  sentence: unknown;
  sent: Buffer | null;
  first: Snap;
  commit: Snap;
  receipt: ReceiptCheck | null;
  healthBetween: unknown;
  pidBefore: unknown;
  pidAfter: unknown;
  second: Snap;
};

function see(o: Observed): Seen {
  const sent: unknown = o.sent;
  return {
    sentence: o.sentence,
    sent: sent instanceof Uint8Array ? Buffer.from(sent) : null,
    first: snap(o.firstOpen, ['documentId']),
    commit: snap(o.commit, ['status', 'revision', 'receipt']),
    receipt: o.receipt,
    healthBetween: o.healthBetween,
    pidBefore: o.pidBefore,
    pidAfter: o.pidAfter,
    second: snap(o.secondOpen, ['documentId', 'currentRevision', 'documentHash', 'document']),
  };
}

/** The document of the second open in strict standard base64, decoded here, or null. */
function reopened(s: Seen): Buffer | null {
  const doc = own(s.second.body, 'document');
  if (typeof doc !== 'string') return null;
  const bytes = Buffer.from(doc, 'base64');
  // Node skips stray characters; only one spelling of the bytes counts, and no bytes are no document.
  return bytes.byteLength > 0 && bytes.toString('base64') === doc ? bytes : null;
}

export function claims(o: Observed): Claim[] {
  return claimsOf(see(o));
}

function claimsOf(s: Seen): Claim[] {
  const [second, commit] = [s.second.body, s.commit.body];
  const doc = reopened(s);
  const mine = doc === null ? null : sha256Hex(doc);
  const sent = s.sent === null ? null : sha256Hex(s.sent);
  const why = receiptProblem(s.receipt, own(commit, 'receipt'));
  const first = own(s.first.body, 'documentId');
  const [status, revision] = [own(commit, 'status'), own(commit, 'revision')];
  const [docId, current, docHash] = [own(second, 'documentId'), own(second, 'currentRevision'), own(second, 'documentHash')];
  const sentence = filled(s.sentence) ? s.sentence : null;
  return [
    claim(
      'L-1',
      status === 'committed' && revision === 1 && why === null,
      `commit ${text(s.commit.status)} ${text(status)}, revizija ${text(revision)}, potvrda: ${why ?? 'potpis provjeren ključem stoga'}`,
    ),
    claim(
      'L-2',
      s.healthBetween === 'refused' && isPid(s.pidBefore) && isPid(s.pidAfter) && s.pidBefore !== s.pidAfter,
      `port servera između down i up: ${text(s.healthBetween)}; PID ${text(s.pidBefore)} -> ${text(s.pidAfter)}`,
    ),
    claim(
      'L-3',
      filled(first) && docId === first,
      `drugi open ${text(s.second.status)}, documentId ${text(docId)}`,
    ),
    claim('L-4', current === 1, `currentRevision ${text(current)}`),
    claim(
      'L-5',
      sentence !== null && doc !== null && s.sent !== null && Buffer.compare(doc, s.sent) === 0 && doc.toString('utf8').includes(sentence),
      sentence === null ? 'rečenica je prazna' : doc === null ? 'nema dokumenta' : `${doc.byteLength} B, rečenica ${doc.toString('utf8').includes(sentence) ? 'je' : 'nije'} u tekstu`,
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
 * against it, so the report never names code other than what ran. Once set it
 * has to be that HEAD exactly, untrimmed: empty or blank is a FAIL, not unset.
 */
export function preloaderSha(head: string | null, claimed: string | undefined): { sha: string | null; error: string | null } {
  const sha = head !== null && /^[0-9a-f]{40}\n$/.test(head) ? head.slice(0, 40) : null;
  if (sha === null) return { sha: null, error: 'HEAD preloadera nije čitljiv' };
  if (claimed === undefined || claimed === sha) return { sha, error: null };
  if (!filled(claimed)) return { sha, error: 'LAB_PRELOADER_SHA je zadan, a prazan' };
  // Quoted and with every character outside printable ASCII escaped, so a stray NBSP or DEL shows.
  const shown = JSON.stringify(claimed).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return { sha, error: `LAB_PRELOADER_SHA ${shown} nije izvršeni HEAD ${sha}` };
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
  // Each field of meta read once, like the observation: what is checked is what is written.
  const m: Meta = {
    preloaderSha: meta.preloaderSha, serverSha: meta.serverSha, serverDirty: meta.serverDirty,
    startedAt: meta.startedAt, finishedAt: meta.finishedAt, error: meta.error,
  };
  const s = see(o);
  const list = claimsOf(s);
  const second = s.second.body;
  const doc = reopened(s);
  return {
    schema: 'ductura.lab.oporavak/1',
    ticket: 'DAN-1096',
    covers: 'VS-1.13, samo API dio (bez preglednika)',
    // A PASS names the code that ran: both SHAs, or it proves nothing.
    result: m.error === null && isSha(m.preloaderSha) && isSha(m.serverSha) && list.every((c) => c.pass) ? 'PASS' : 'FAIL',
    preloaderSha: m.preloaderSha,
    webSha: null,
    serverSha: m.serverSha,
    serverDirty: m.serverDirty,
    browser: null,
    documentId: typeof own(second, 'documentId') === 'string' ? own(second, 'documentId') : null,
    revision: Number.isSafeInteger(own(second, 'currentRevision')) ? own(second, 'currentRevision') : null,
    hash: doc === null ? null : sha256Hex(doc),
    sentence: s.sentence,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    error: m.error,
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
    const why = `izvještaj: ${thrown(e)}`;
    let sentence = '-';
    try {
      sentence = text(o.sentence);
    } catch {
      // A sentence that cannot be read is not reported.
    }
    const empty: Observed = {
      sentence, sent: null, firstOpen: null, commit: null, receipt: null,
      healthBetween: null, pidBefore: null, pidAfter: null, secondOpen: null,
    };
    try {
      return `${JSON.stringify(report(empty, { ...meta, error: meta.error === null ? why : `${meta.error}; ${why}` }), null, 2)}\n`;
    } catch {
      // Not even meta can be read: a FAIL with no claim passed, naming nothing it cannot read.
      const none = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6'].map((id) => claim(id, false, 'izvještaj se ne može složiti'));
      return `${JSON.stringify({ schema: 'ductura.lab.oporavak/1', ticket: 'DAN-1096', result: 'FAIL', error: 'izvještaj se ne može složiti', claims: none }, null, 2)}\n`;
    }
  }
}
