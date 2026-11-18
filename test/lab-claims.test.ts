// DAN-1096: every claim of the recovery lab passes on a good run and fails
// when the one thing it checks breaks (docs/lab-oporavak.md).
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { type Observed, type ReceiptCheck, claims, preloaderSha, report, reportText, sha256Hex, text } from '../scripts/lab/claims.ts';

const sentence = 'Izmišljena rečenica laboratorija 0000.';
const bytes = Buffer.from(`{"text":"${sentence}"}`, 'utf8');
const hash = sha256Hex(bytes);
const open = (body: Record<string, unknown>) => ({ status: 200, body });

// L-1's receipt check is checkReceipt (receipt.ts, DAN-1096-a1, tested there)
// bound by the run; here a stand-in that holds only for the one good receipt.
const signed = { status: 'signed', signedReceipt: 'potpisano ključem stoga' };
const check: ReceiptCheck = (r) => (r === signed ? null : 'potpis ne odgovara ključu stoga');
const committed = (r: unknown) => ({ status: 200, body: { status: 'committed', revision: 1, receipt: r } });

function good(): Observed {
  return {
    sentence,
    sent: bytes,
    firstOpen: open({ documentId: 'd-1', currentRevision: 0 }),
    commit: committed(signed),
    receipt: check,
    healthBetween: 'refused',
    pidBefore: 100,
    pidAfter: 200,
    secondOpen: open({ documentId: 'd-1', currentRevision: 1, documentHash: hash, document: bytes.toString('base64') }),
  };
}

// A revoked Proxy: Array.isArray and Object.hasOwn throw on it.
const revoked = (): unknown => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; };
const failing = (o: Observed) => claims(o).filter((c) => !c.pass).map((c) => c.id);
const other = Buffer.from(`{"text":"Drugi tekst."}`, 'utf8');
const padded = Buffer.from(`{"text":"${sentence}"} `, 'utf8');
const urlish = Buffer.from(`{"text":"${sentence}"}?>`, 'utf8');

const cases: [string, (o: Observed) => Observed, string[]][] = [
  ['commit refused', (o) => ({ ...o, commit: { status: 409, body: { status: 'stale_base' } } }), ['L-1']],
  ['receipt pending', (o) => ({ ...o, commit: committed({ status: 'pending_signature' }) }), ['L-1']],
  ['receipt says signed but carries no signature', (o) => ({ ...o, commit: committed({ status: 'signed' }) }), ['L-1']],
  ['receipt check says no', (o) => ({ ...o, commit: committed({ ...signed }) }), ['L-1']],
  ['commit is a duplicate', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, status: 'duplicate' } } }), ['L-1']],
  ['commit wrote another revision', (o) => ({ ...o, commit: { status: 200, body: { ...o.commit!.body, revision: 2 } } }), ['L-1']],
  ['commit body is null', (o) => ({ ...o, commit: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-1']],
  ['commit is not 200', (o) => ({ ...o, commit: { ...o.commit!, status: 201 } }), ['L-1']],
  ['no receipt check (no stack key or expected commit)', (o) => ({ ...o, receipt: null }), ['L-1']],
  ['port still open between', (o) => ({ ...o, healthBetween: 'open' }), ['L-2']],
  ['port unknown between', (o) => ({ ...o, healthBetween: 'unknown' }), ['L-2']],
  ['port not probed', (o) => ({ ...o, healthBetween: null }), ['L-2']],
  ['same pid', (o) => ({ ...o, pidAfter: 100 }), ['L-2']],
  ['no pid', (o) => ({ ...o, pidBefore: null }), ['L-2']],
  // QA 2 on 55f02977: a new PID is a safe integer above 0, before and after.
  ...[0, -0, -1, NaN, 1.5, Infinity, 2 ** 53, '200', null, undefined, {}, [], JSON.parse('{"toString":null}'),
    Object.assign(() => 200, { valueOf: () => 200 }), revoked()].flatMap((pid, i) => [
    [`pid after is bad value ${i} (${text(pid)})`, (o: Observed) => ({ ...o, pidAfter: pid }), ['L-2']],
    [`pid before is bad value ${i} (${text(pid)})`, (o: Observed) => ({ ...o, pidBefore: pid }), ['L-2']],
  ] as [string, (o: Observed) => Observed, string[]][]),
  ['first open has no documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }) }), ['L-3']],
  ['neither open has a documentId', (o) => ({ ...o, firstOpen: open({ currentRevision: 0 }), secondOpen: open({ ...o.secondOpen!.body, documentId: undefined }) }), ['L-3']],
  ['other document', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentId: 'd-2' }) }), ['L-3']],
  ['revision 0', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, currentRevision: 0 }) }), ['L-4']],
  ['server hash differs', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentHash: '0'.repeat(64) }) }), ['L-6']],
  // L-5 one condition at a time: same bytes without the sentence, then the sentence in other bytes.
  ['the sentence is not in the same bytes', (o) => ({ ...o, sentence: 'Rečenica koje nema.' }), ['L-5']],
  ['the sentence is in other bytes', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: padded.toString('base64'), documentHash: sha256Hex(padded) }) }), ['L-5', 'L-6']],
  ['other text back', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: other.toString('base64'), documentHash: sha256Hex(other) }) }), ['L-5', 'L-6']],
  ['the document has junk after its padding', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: `${bytes.toString('base64')}@@ ne` }) }), ['L-5', 'L-6']],
  ['the document has line breaks', (o) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: bytes.toString('base64').replace(/(.{8})/g, '$1\r\n') }) }), ['L-5', 'L-6']],
  // A document whose standard base64 has '+', '/' or padding, so the url spelling differs.
  ['the document is base64url', (o) => ({ ...o, sent: urlish, secondOpen: open({ ...o.secondOpen!.body, documentHash: sha256Hex(urlish), document: urlish.toString('base64url') }) }), ['L-5', 'L-6']],
  ['second open is 201', (o) => ({ ...o, secondOpen: { ...o.secondOpen!, status: 201 } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open body is null', (o) => ({ ...o, secondOpen: { status: 200, body: null as unknown as Record<string, unknown> } }), ['L-3', 'L-4', 'L-5', 'L-6']],
  ['second open refused', (o) => ({ ...o, secondOpen: { status: 409, body: { status: 'not_started' } } }), ['L-3', 'L-4', 'L-5', 'L-6']],
];

test('a good run passes every claim', () => {
  assert.deepEqual(failing(good()), []);
  assert.deepEqual(claims(good()).map((c) => c.id), ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6']);
});

for (const [name, change, want] of cases) {
  test(`fails exactly ${want.join(', ')} when ${name}`, () => {
    assert.deepEqual(failing(change(good())), want);
  });
}

test('the report is PASS only without an error and with every claim', () => {
  const meta = { preloaderSha: 'a'.repeat(40), serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1', error: null };
  const ok = report(good(), meta);
  assert.equal(ok.result, 'PASS');
  assert.equal(ok.hash, hash);
  assert.equal(ok.revision, 1);
  assert.equal(ok.webSha, null);
  assert.equal(ok.browser, null);
  assert.equal(report(good(), { ...meta, error: 'down nije uspio' }).result, 'FAIL');
  assert.equal(report({ ...good(), secondOpen: { status: 200, body: null as unknown as Record<string, unknown> } }, meta).documentId, null);
  assert.equal(report({ ...good(), pidAfter: 100 }, meta).result, 'FAIL');
});

// Review finding 3, QA finding 5: the report names the code that ran, never a SHA it was told.
test('the preloader SHA is the checked-out HEAD, and a named SHA must be it', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(preloaderSha(`${head}\n`, undefined), { sha: head, error: null });
  assert.deepEqual(preloaderSha(`${head}\n`, head), { sha: head, error: null });
  assert.match(preloaderSha(`${head}\n`, 'd'.repeat(40)).error ?? '', /nije izvršeni HEAD/);
  for (const bad of [null, '', head, `${head}\r\n`, `${head.toUpperCase()}\n`, `${head}\n\n`, ` ${head}\n`, `${head} \n`]) {
    assert.deepEqual(preloaderSha(bad, undefined), { sha: null, error: 'HEAD preloadera nije čitljiv' }, JSON.stringify(bad));
  }
});

// Review 3 and QA 3 on 55f02977: no value in an answer or in state.json makes
// the report throw; each is text in a detail, and the claim it feeds fails.
const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('zamka'); }, ownKeys() { throw new Error('zamka'); } });
const BAD: unknown[] = [null, undefined, 0, -1, '', {}, [], NaN, JSON.parse('{"toString":null}'), JSON.parse('{"valueOf":null,"toString":null}'),
  JSON.parse('{"__proto__":{"documentId":"d-1","currentRevision":1}}'), Object.create(null), revoked(), hostile];
const FIELDS: [string, (o: Observed, v: unknown) => Observed, string][] = [
  ['commit status code', (o, v) => ({ ...o, commit: { ...o.commit!, status: v as number } }), 'L-1'],
  ['commit.status', (o, v) => ({ ...o, commit: open({ ...o.commit!.body, status: v }) }), 'L-1'],
  ['commit.revision', (o, v) => ({ ...o, commit: open({ ...o.commit!.body, revision: v }) }), 'L-1'],
  ['commit.receipt', (o, v) => ({ ...o, commit: open({ ...o.commit!.body, receipt: v }) }), 'L-1'],
  ['commit body', (o, v) => ({ ...o, commit: { status: 200, body: v as Record<string, unknown> } }), 'L-1'],
  ['first documentId', (o, v) => ({ ...o, firstOpen: open({ currentRevision: 0, documentId: v }) }), 'L-3'],
  ['second open status code', (o, v) => ({ ...o, secondOpen: { ...o.secondOpen!, status: v as number } }), 'L-3'],
  ['second documentId', (o, v) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentId: v }) }), 'L-3'],
  ['currentRevision', (o, v) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, currentRevision: v }) }), 'L-4'],
  ['document', (o, v) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: v }) }), 'L-5'],
  ['documentHash', (o, v) => ({ ...o, secondOpen: open({ ...o.secondOpen!.body, documentHash: v }) }), 'L-6'],
  ['second open body', (o, v) => ({ ...o, secondOpen: { status: 200, body: v as Record<string, unknown> } }), 'L-4'],
  ['healthBetween', (o, v) => ({ ...o, healthBetween: v as 'refused' }), 'L-2'],
];
// Both SHAs are named, so a FAIL below comes from the claim, not from the meta.
const meta = { preloaderSha: 'a'.repeat(40), serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1', error: null };

for (const [field, set, id] of FIELDS) {
  test(`a bad ${field} fails ${id} and still gives a FAIL report`, () => {
    for (const v of BAD) {
      const o = set(good(), v);
      assert.ok(failing(o).includes(id), `${field}: ${text(v)}`);
      const file = JSON.parse(reportText(o, meta)) as { result: string; claims: unknown[] };
      assert.equal(file.result, 'FAIL');
      assert.equal(file.claims.length, 6);
    }
  });
}

test('text calls nothing on the value', () => {
  assert.equal(text(JSON.parse('{"toString":null,"valueOf":null}')), '[objekt]');
  assert.equal(text(Object.create(null)), '[objekt]');
  assert.equal(text([1]), '[niz]');
  assert.deepEqual([text(null), text(undefined), text(NaN), text(-0), text('x')], ['-', '-', 'NaN', '0', 'x']);
});

test('a report that cannot be built is a FAIL report naming why', () => {
  const trap = { status: 200, get body(): Record<string, unknown> { throw new Error('zamka'); } };
  const file = JSON.parse(reportText({ ...good(), secondOpen: trap }, meta)) as { result: string; error: string; claims: { pass: boolean }[] };
  assert.equal(file.result, 'FAIL');
  assert.equal(file.error, 'izvještaj: zamka');
  assert.ok(file.claims.every((c) => !c.pass));
  assert.equal(JSON.parse(reportText({ ...good(), secondOpen: trap }, { ...meta, error: 'down' })).error, 'down; izvještaj: zamka');
});

// QA 2 on edb4664f, the class of a1's K3/K4: a LAB_PRELOADER_SHA that is set
// has to be the HEAD exactly, untrimmed; empty or only whitespace is a FAIL.
test('a set LAB_PRELOADER_SHA that is empty, blank or not exactly HEAD fails the run', () => {
  const head = 'c'.repeat(40);
  const meta = { preloaderSha: head, serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1' };
  const blank = ['', ' ', '\t', '\r\n', '\n', '\u00a0', '\ufeff', '\u2028', '\u3000', ' \t\u00a0'];
  const other = [`${head}\r\n`, ` ${head}`, `${head}\u00a0`, `${head}\u007f`, head.toUpperCase(), head.slice(1), `\t${head}`, 'd'.repeat(40)];
  for (const claimed of [...blank, ...other]) {
    const got = preloaderSha(`${head}\n`, claimed);
    assert.equal(got.sha, head, JSON.stringify(claimed));
    if (blank.includes(claimed)) assert.equal(got.error, 'LAB_PRELOADER_SHA je zadan, a prazan', JSON.stringify(claimed));
    else assert.match(got.error ?? '', new RegExp(`^LAB_PRELOADER_SHA "[\\x20-\\x7e]+" nije izvršeni HEAD ${head}$`), JSON.stringify(claimed));
    assert.equal(report(good(), { ...meta, error: got.error }).result, 'FAIL', JSON.stringify(claimed));
  }
  // The odd characters show in the message, not just as a blank.
  assert.match(preloaderSha(`${head}\n`, `${head}\u00a0`).error ?? '', /"c{40}\\u00a0" nije/);
  assert.match(preloaderSha(`${head}\n`, `${head}\u007f`).error ?? '', /"c{40}\\u007f" nije/);
  assert.match(preloaderSha(`${head}\n`, `${head}\r\n`).error ?? '', /"c{40}\\r\\n" nije/);
});

// A PASS report names the code that ran: both SHAs, 40 lowercase hex.
test('the report is FAIL when it does not name the preloader and server code', () => {
  const meta = { preloaderSha: 'a'.repeat(40), serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1', error: null };
  assert.equal(report(good(), meta).result, 'PASS');
  for (const bad of [null, '', ' ', 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(64), 'A'.repeat(40), `${'a'.repeat(40)}\n`, ` ${'a'.repeat(39)}`]) {
    assert.equal(report(good(), { ...meta, preloaderSha: bad }).result, 'FAIL', `preloaderSha ${JSON.stringify(bad)}`);
    assert.equal(report(good(), { ...meta, serverSha: bad }).result, 'FAIL', `serverSha ${JSON.stringify(bad)}`);
  }
  // An error that is empty text is still an error: only null is none.
  assert.equal(report(good(), { ...meta, error: '' }).result, 'FAIL');
});

// An empty value is no evidence: '' === '' and includes('') hold for anything.
const BLANK = ['', ' ', '\t', '\u00a0', '\r\n'];
test('a blank documentId in both opens fails L-3 only', () => {
  for (const id of BLANK) {
    const o = good();
    assert.deepEqual(failing({ ...o, firstOpen: open({ documentId: id, currentRevision: 0 }), secondOpen: open({ ...o.secondOpen!.body, documentId: id }) }), ['L-3'], JSON.stringify(id));
  }
});

test('a blank sentence fails L-5 only', () => {
  for (const sentence of BLANK) {
    // The run's document carries the blank sentence, so only its emptiness can fail L-5.
    const own = Buffer.from(JSON.stringify({ text: sentence }), 'utf8');
    const o = { ...good(), sentence, sent: own };
    const run = { ...o, secondOpen: open({ ...o.secondOpen!.body, document: own.toString('base64'), documentHash: sha256Hex(own) }) };
    assert.deepEqual(failing(run), ['L-5'], JSON.stringify(sentence));
    assert.equal(claims(run)[4]!.detail, 'rečenica je prazna');
  }
});

test('an empty document sent and reopened fails L-5 and L-6', () => {
  const none = new Uint8Array(0);
  const o = { ...good(), sent: none };
  assert.deepEqual(failing({ ...o, secondOpen: open({ ...o.secondOpen!.body, document: '', documentHash: sha256Hex(none) }) }), ['L-5', 'L-6']);
});

// The receipt check is the run's code: whatever it throws or returns, L-1
// fails with a reason and the report is still written.
const odd = { get message(): string { throw new Error('getter'); } };
const CHECKS: [string, ReceiptCheck, RegExp][] = [
  ['throws an Error', () => { throw new Error('ključ nije čitljiv'); }, /provjera potvrde: ključ nije čitljiv/],
  ['throws a string', () => { throw 'tekst'; }, /provjera potvrde: tekst/],
  ['throws null', () => { throw null; }, /provjera potvrde: -/],
  ['throws an object whose message getter throws', () => { throw odd; }, /provjera potvrde: \[objekt\]/],
  ['throws an Error whose message getter throws', () => { throw Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('getter'); } }); }, /provjera potvrde: -$/],
  ['throws a revoked Proxy', () => { const p = Proxy.revocable({}, {}); p.revoke(); throw p.proxy; }, /provjera potvrde: -$/],
  ['is not a function', 'nije funkcija' as unknown as ReceiptCheck, /potvrda: provjera potvrde: .*not a function$/],
  ['throws an Error with a blank message', () => { throw new Error(' \t'); }, /provjera potvrde: -$/],
  ...([[undefined, 'undefined'], ['', "''"], [' ', "' '"], ['\u00a0', 'NBSP'], [0, '0'], [false, 'false'], [{}, '{}'], [Symbol('s'), 'Symbol'], [Object.create(null), 'Object.create(null)'],
    [{ toString() { throw new Error('toString'); } }, 'an object whose toString throws']] as const).map(
    ([v, name]): [string, ReceiptCheck, RegExp] => [`returns ${name}`, () => v as unknown as string, /provjera potvrde nije dala razlog/]),
];
for (const [name, bad, why] of CHECKS) {
  test(`a receipt check that ${name} fails L-1 only, with a FAIL report`, () => {
    const o = { ...good(), receipt: bad };
    const list = claims(o);
    assert.deepEqual(list.filter((c) => !c.pass).map((c) => c.id), ['L-1']);
    assert.match(list[0]!.detail, why);
    const meta = { preloaderSha: 'a'.repeat(40), serverSha: 'b'.repeat(40), serverDirty: false, startedAt: 't0', finishedAt: 't1', error: null };
    const file = JSON.parse(reportText(o, meta)) as { result: string; error: string | null; claims: unknown[] };
    assert.deepEqual([file.result, file.error, file.claims.length], ['FAIL', null, 6]);
  });
}

test('the receipt check gets the commit\'s own receipt, never an inherited one', () => {
  const seen: unknown[] = [];
  const spy: ReceiptCheck = (r) => (seen.push(r), check(r));
  assert.deepEqual(failing({ ...good(), receipt: spy }), []);
  const inherited = { status: 200, body: Object.assign(Object.create({ receipt: signed }) as Record<string, unknown>, { status: 'committed', revision: 1 }) };
  assert.deepEqual(failing({ ...good(), receipt: spy, commit: inherited }), ['L-1']);
  const proto = { status: 200, body: JSON.parse('{"status":"committed","revision":1,"__proto__":{"receipt":1}}') as Record<string, unknown> };
  assert.deepEqual(failing({ ...good(), receipt: spy, commit: proto }), ['L-1']);
  assert.deepEqual(seen, [signed, undefined, undefined]);
});

test('the fallback report survives a sentence and a meta that throw when read', () => {
  const trap = { status: 200, get body(): Record<string, unknown> { throw new Error('zamka'); } };
  const o = { ...good(), secondOpen: trap };
  Object.defineProperty(o, 'sentence', { get(): string { throw new Error('rečenica'); } });
  const file = JSON.parse(reportText(o, meta)) as { result: string; sentence: string; claims: unknown[] };
  assert.deepEqual([file.result, file.sentence, file.claims.length], ['FAIL', '-', 6]);
  // Not even meta can be read: still a FAIL report with six failed claims.
  const hostile = Object.defineProperty({ ...meta }, 'error', { enumerable: true, get(): string { throw new Error('meta'); } });
  const last = JSON.parse(reportText(o, hostile)) as { result: string; error: string; claims: { pass: boolean }[] };
  assert.deepEqual([last.result, last.error, last.claims.length, last.claims.some((c) => c.pass)], ['FAIL', 'izvještaj se ne može složiti', 6, false]);
});
