// DAN-1096: `pnpm lab:oporavak`, the recovery lab (docs/lab-oporavak.md).
// Starts the VS-1 stack of SERVER_DIR, commits one invented sentence as a
// student, restarts the server, reopens the work and writes the report.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Answer, type Meta, type Observed, preloaderSha, reportText, sha256Hex } from './claims.ts';
import { probePort } from './probe.ts';
import { type ReceiptTrust, publicKeyFromSeed, registryRow } from './receipt.ts';
import { withStack } from './stack-lock.ts';

type State = {
  startedAt?: unknown;
  repos?: { server?: { sha?: unknown; dirty?: unknown } };
  ports: { postgres: number; server: number };
  processes?: { server?: { pid?: unknown } };
};

const SERVER = resolve(process.env['SERVER_DIR'] ?? '');
const STACK = process.env['VS1_STACK_DIR'] ?? join(SERVER, '.stack', 'vs1');
const OUT = process.env['LAB_REPORT'] ?? 'lab-oporavak.json';
const INSTITUTION = 'demo-fakultet'; // server scripts/stack/evidence.ts INSTITUTION_SLUG

const fromServer = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(SERVER, path)).href)) as T;

function stack(cmd: 'up' | 'down'): void {
  const env = process.env['CI'] === 'true' ? 'ci' : 'local';
  execFileSync('pnpm', ['stack:vs1', cmd, ...(cmd === 'up' ? ['--env', env] : [])], {
    cwd: SERVER,
    stdio: ['ignore', process.stderr, 'inherit'],
  });
}

const readState = (): State => JSON.parse(readFileSync(join(STACK, 'state.json'), 'utf8')) as State;

/** The mark of the running stack (state.json startedAt), or null. */
function stackMark(): string | null {
  try {
    const at = readState().startedAt;
    return typeof at === 'string' ? at : null;
  } catch {
    return null;
  }
}

const psql = (port: number, input: string, stdout: 'pipe' | 'ignore'): string =>
  execFileSync('psql', ['-h', STACK, '-p', String(port), '-U', 'ductus', '-d', 'ductus', '-X', '-q', '-t', '-A'], {
    input,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '' },
    stdio: ['pipe', stdout, 'inherit'],
  }) ?? '';

/**
 * The receipt key the lab trusts: the public key of the seed the running
 * server signs with (its own environment, read by the stack's helper), and
 * that key's label and domain from the key registry. No server response.
 */
function stackTrust(port: number, env: Record<string, string>): ReceiptTrust {
  const file = env['DUCTUS_DEV_SIGNING_KEY_FILE'];
  if (!file) throw new Error('server stoga nema DUCTUS_DEV_SIGNING_KEY_FILE');
  const keyBase64Url = publicKeyFromSeed(readFileSync(file));
  const row = registryRow(
    psql(port, `\\set key '${keyBase64Url}'
SELECT k.key_id || '|' || k.key_version || '|' || k.evidence_domain_id || '|' || CASE WHEN k.key_base64url = :'key' AND k.algorithm = 'Ed25519' THEN 't' ELSE 'f' END
  FROM evidence.signing_key k
 WHERE k.evidence_domain_id IN (SELECT s.evidence_domain_id FROM evidence.signing_key s WHERE s.key_base64url = :'key')
   AND k.purpose = 'receipt' AND k.revoked_at IS NULL AND (k.valid_to IS NULL OR k.valid_to > now());
`, 'pipe'),
  );
  if (row === null) throw new Error('ključ sjemena nije točno jedan aktivan ključ potvrda u registru');
  return { keyBase64Url, ...row };
}

/** Invented student, course and assignment, written through the stack socket; seeding only. */
function seed(port: number, token: string): { assignmentId: string; studentId: string } {
  const ids = { student: randomUUID(), teacher: randomUUID(), course: randomUUID(), assignment: randomUUID() };
  const vars = { slug: INSTITUTION, tag: randomBytes(4).toString('hex'), token, ...ids };
  const sets = Object.entries(vars).map(([k, v]) => `\\set ${k} '${v}'`).join('\n');
  // Values reach psql through stdin, never argv: the session token is a live secret.
  const sql = `${sets}
\\set ON_ERROR_STOP on
BEGIN;
SELECT id AS inst FROM identity.institution WHERE slug = :'slug' \\gset
INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
VALUES (:'student', :'inst', 'https://issuer.test', 'sub-student-' || :'tag', 'student-' || :'tag' || '@fak.invalid'),
       (:'teacher', :'inst', 'https://issuer.test', 'sub-teacher-' || :'tag', 'teacher-' || :'tag' || '@fak.invalid');
INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
VALUES (sha256(convert_to(:'token', 'UTF8')), :'student', :'inst', now() + interval '1 hour');
INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
VALUES (:'course', :'inst', 'Kolegij (test)', '2026/2027', 'partially_allowed', :'teacher');
INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
VALUES (:'course', :'inst', :'teacher', 'teacher'), (:'course', :'inst', :'student', 'student');
INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
VALUES (:'assignment', :'course', :'inst', 1, :'teacher');
INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type,
  opens_at, due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
VALUES (:'assignment', 1, 'Zadatak (test)', 'Upute za izmišljeni zadatak.', 'essay', now(),
  now() + interval '30 days', 'partially_allowed', '{proofreading}', 'basic', true, :'teacher');
INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
VALUES (:'assignment', 1, :'student', :'inst');
COMMIT;
`;
  psql(port, sql, 'ignore');
  return { assignmentId: ids.assignment, studentId: ids.student };
}

type Segment = Record<string, unknown> & { events: Record<string, unknown>[] };
type Golden = { chain: { segments: { segment: Segment }[]; documentStates: { value: unknown }[] } };

/** One commit of one segment, from the server's invented golden segment with the lab sentence in place of its text. */
function commitRequest(canon: (v: unknown) => string, opened: Record<string, unknown>, sentence: string) {
  const golden = JSON.parse(readFileSync(join(SERVER, 'server/domain/forensics/golden-vectors/evidence-v2.json'), 'utf8')) as Golden;
  const value = golden.chain.documentStates[1]!.value as { nodes: { children: { text: string }[] }[] };
  const swap = <T>(x: T): T => {
    const from = JSON.stringify(value.nodes[0]!.children[0]!.text).slice(1, -1);
    return JSON.parse(JSON.stringify(x).split(from).join(JSON.stringify(sentence).slice(1, -1))) as T;
  };
  const template = swap(golden.chain.segments[0]!.segment);
  const document = canon(swap(value));
  const before = opened['documentHash'];
  const after = sha256Hex(Buffer.from(document, 'utf8'));
  const tx = `lab-${randomBytes(4).toString('hex')}`;
  const segment = canon({
    ...template,
    documentId: opened['documentId'],
    sessionId: `sesija-${tx}`,
    segmentId: `segment-${tx}`,
    sequenceFrom: 1,
    sequenceTo: 1,
    initialDocumentHash: before,
    finalDocumentHash: after,
    predecessorSegmentHash: null,
    evidenceProfileId: opened['evidenceProfileId'],
    events: [{ ...template.events[0], sequence: 1, beforeDocumentHash: before, afterDocumentHash: after }],
  });
  return {
    sent: Buffer.from(document, 'utf8'),
    segmentHash: sha256Hex(Buffer.from(segment, 'utf8')),
    body: {
      documentId: opened['documentId'],
      clientTransactionId: tx,
      baseRevision: 0,
      segments: [Buffer.from(segment, 'utf8').toString('base64')],
      document: Buffer.from(document, 'utf8').toString('base64'),
    },
  };
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const o: Observed = {
    sentence: `Izmišljena rečenica laboratorija ${randomUUID()}.`,
    sent: null, firstOpen: null, commit: null, trust: null, expected: null,
    healthBetween: null, pidBefore: null, pidAfter: null, secondOpen: null,
  };
  let head: string | null = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  } catch {
    head = null;
  }
  const sha = preloaderSha(head, process.env['LAB_PRELOADER_SHA']);
  let error: string | null = sha.error;
  let state: State | null = null;
  const meta = (why: string | null): Meta => {
    const repo = state?.repos?.server;
    return {
      preloaderSha: sha.sha,
      serverSha: typeof repo?.sha === 'string' ? repo.sha : null,
      serverDirty: typeof repo?.dirty === 'boolean' ? repo.dirty : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: why,
    };
  };
  // An older report never outlives this run: FAIL until the run writes its own.
  writeFileSync(OUT, reportText(o, meta('izvođenje nije završilo')));
  try {
    if (error !== null) throw new Error(error);
    if (!process.env['SERVER_DIR']) throw new Error('SERVER_DIR nije zadan');
    type CommitCheck = {
      post: (port: number, path: string, body: unknown, token: string) => Promise<Answer>;
      stackServerEnv: (state: State) => Record<string, string>;
    };
    const { post, stackServerEnv } = await fromServer<CommitCheck>('scripts/stack/vs1-commit-check.ts');
    const { canonicalizeJcs } = await fromServer<{ canonicalizeJcs: (v: unknown) => string }>('server/domain/index.ts');
    await withStack(STACK, stack, stackMark, async (s) => {
      await s.up();
      state = readState();
      const token = randomBytes(32).toString('base64url');
      const { assignmentId, studentId } = seed(state.ports.postgres, token);
      o.trust = stackTrust(state.ports.postgres, stackServerEnv(state));
      o.firstOpen = await post(state.ports.server, '/api/v1/evidence/open', { assignmentId, start: true }, token);
      if (o.firstOpen.status !== 200) throw new Error(`prvi open: ${o.firstOpen.status}`);
      const documentId = o.firstOpen.body['documentId'];
      if (typeof documentId !== 'string') throw new Error('prvi open nema documentId');
      const req = commitRequest(canonicalizeJcs, o.firstOpen.body, o.sentence);
      o.sent = req.sent;
      o.expected = {
        documentId,
        clientTransactionId: req.body.clientTransactionId,
        revision: 1,
        principalId: studentId,
        segmentHash: req.segmentHash,
      };
      o.commit = await post(state.ports.server, '/api/v1/evidence/commit', req.body, token);
      o.pidBefore = state.processes?.server?.pid ?? null;
      await s.down();
      o.healthBetween = await probePort(state.ports.server);
      await s.up();
      state = readState();
      o.pidAfter = state.processes?.server?.pid ?? null;
      o.secondOpen = await post(state.ports.server, '/api/v1/evidence/open', { assignmentId }, token);
    });
  } catch (e) {
    error ??= e instanceof Error ? e.message : 'nepoznata greška';
  }
  const text = reportText(o, meta(error));
  // The report is the file only: pnpm writes its own lines to stdout.
  writeFileSync(OUT, text);
  const out = JSON.parse(text) as { result: string; error: string | null; claims: { id: string; pass: boolean }[] };
  const lines = out.claims.map((c) => `${c.id} ${c.pass ? 'PASS' : 'FAIL'}`);
  process.stdout.write(`lab:oporavak ${out.result} ${OUT}\n${out.error === null ? '' : `greška: ${out.error}\n`}${lines.join('\n')}\n`);
  return out.result === 'PASS' ? 0 : 1;
}

process.exitCode = await main();
