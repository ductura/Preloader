// DAN-1096: `pnpm lab:oporavak`, the recovery lab (docs/lab-oporavak.md).
// Starts the VS-1 stack of SERVER_DIR, commits one invented sentence as a
// student, restarts the server, reopens the work and writes the report.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Answer, type Observed, report, sha256Hex } from './claims.ts';

type State = {
  repos: { server: { sha: string; dirty: boolean } };
  ports: { postgres: number; server: number };
  processes: { server?: { pid: number } };
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

async function healthAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/** Invented student, course and assignment, written through the stack socket; seeding only. */
function seed(port: number, token: string): string {
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
  execFileSync('psql', ['-h', STACK, '-p', String(port), '-U', 'ductus', '-d', 'ductus', '-X', '-q'], {
    input: sql,
    env: { PATH: process.env['PATH'] ?? '' },
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  return ids.assignment;
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
    sent: null, firstOpen: null, commit: null, healthBetween: null, pidBefore: null, pidAfter: null, secondOpen: null,
  };
  let error: string | null = null;
  let state: State | null = null;
  let started = false;
  try {
    if (!process.env['SERVER_DIR']) throw new Error('SERVER_DIR nije zadan');
    const { post } = await fromServer<{ post: (port: number, path: string, body: unknown, token: string) => Promise<Answer> }>('scripts/stack/vs1-commit-check.ts');
    const { canonicalizeJcs } = await fromServer<{ canonicalizeJcs: (v: unknown) => string }>('server/domain/index.ts');
    started = true;
    stack('up');
    state = readState();
    const token = randomBytes(32).toString('base64url');
    const assignmentId = seed(state.ports.postgres, token);
    o.firstOpen = await post(state.ports.server, '/api/v1/evidence/open', { assignmentId, start: true }, token);
    if (o.firstOpen.status !== 200) throw new Error(`prvi open: ${o.firstOpen.status}`);
    const req = commitRequest(canonicalizeJcs, o.firstOpen.body, o.sentence);
    o.sent = req.sent;
    o.commit = await post(state.ports.server, '/api/v1/evidence/commit', req.body, token);
    o.pidBefore = state.processes.server?.pid ?? null;
    stack('down');
    o.healthBetween = await healthAnswers(state.ports.server);
    stack('up');
    state = readState();
    o.pidAfter = state.processes.server?.pid ?? null;
    o.secondOpen = await post(state.ports.server, '/api/v1/evidence/open', { assignmentId }, token);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (started) {
      try {
        stack('down');
      } catch (e) {
        error ??= `down: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  let preloaderSha = process.env['LAB_PRELOADER_SHA'] ?? null;
  if (preloaderSha === null) {
    try {
      preloaderSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      preloaderSha = null;
    }
  }
  const out = report(o, {
    preloaderSha,
    serverSha: state?.repos.server.sha ?? null,
    serverDirty: state?.repos.server.dirty ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    error,
  });
  const text = `${JSON.stringify(out, null, 2)}\n`;
  writeFileSync(OUT, text);
  process.stdout.write(text);
  return out.result === 'PASS' ? 0 : 1;
}

process.exitCode = await main();
