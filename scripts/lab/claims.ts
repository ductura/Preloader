// DAN-1096: the claims of the recovery lab (docs/lab-oporavak.md) over what
// one run observed, and the report around them. Pure, so each claim is tested
// on its own; the run itself is scripts/lab/oporavak.ts.
import { createHash } from 'node:crypto';

export type Answer = { status: number; body: Record<string, unknown> };

export type Observed = {
  sentence: string;
  /** Document bytes sent with the commit. */
  sent: Uint8Array | null;
  firstOpen: Answer | null;
  commit: Answer | null;
  /** Whether /api/v1/health answered between down and up. */
  healthBetween: boolean | null;
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
  const receipt = o.commit?.body['receipt'];
  const signed = typeof receipt === 'object' && receipt !== null && (receipt as { status?: unknown }).status === 'signed';
  const first = o.firstOpen?.status === 200 ? o.firstOpen.body['documentId'] : undefined;
  return [
    claim(
      'L-1',
      o.commit?.status === 200 && o.commit.body['status'] === 'committed' && o.commit.body['revision'] === 1 && signed,
      `commit ${o.commit?.status ?? '-'} ${String(o.commit?.body['status'] ?? '-')}, revizija ${String(o.commit?.body['revision'] ?? '-')}, potvrda ${signed ? 'potpisana' : 'nije potpisana'}`,
    ),
    claim(
      'L-2',
      o.healthBetween === false && o.pidBefore !== null && o.pidAfter !== null && o.pidBefore !== o.pidAfter,
      `health između down i up: ${o.healthBetween === null ? '-' : o.healthBetween ? 'odgovara' : 'ne odgovara'}; PID ${o.pidBefore ?? '-'} -> ${o.pidAfter ?? '-'}`,
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
