// DAN-934-2/3: paritet `checkHealth` i sheme odgovora 200 `platform.health.get` iz `@ductura/contracts`.
// Shema postaje validator (ajv, samo u testu). Iz svakog ograničenja sheme generator radi vektore na
// granici i korak preko nje; za svaki vektor `checkHealth` mora prihvatiti točno kad shema prihvaća.
// Ključna riječ koju generator ne zna obraditi ruši test.
import openapi from '@ductura/contracts/openapi/v1.json' with { type: 'json' };
import { Ajv } from 'ajv';
import { describe, expect, test } from 'vitest';
import { checkHealth, HEALTH_KEYS, HEALTH_STATES } from '../src/server-check/health.ts';

type Schema = {
  type?: string; const?: unknown; enum?: unknown[]; anyOf?: Schema[]; required?: string[];
  properties?: Record<string, Schema>; additionalProperties?: unknown; minLength?: number; maxLength?: number;
  pattern?: string; minimum?: number; maximum?: number; format?: string;
};
type Op = { operationId?: string; responses?: Record<string, { content?: Record<string, { schema: Schema }> }> };
const [PATH, METHOD, OP] = Object.entries(openapi.paths as unknown as Record<string, Record<string, Op>>)
  .flatMap(([path, ops]) => Object.entries(ops).map(([m, op]) => [path, m.toUpperCase(), op] as const))
  .find(([, , op]) => op.operationId === 'platform.health.get')!;
const SCHEMA = OP.responses!['200']!.content!['application/json']!.schema;

const KNOWN = new Set(['type', 'const', 'enum', 'anyOf', 'required', 'properties', 'additionalProperties', 'minLength',
  'maxLength', 'pattern', 'minimum', 'maximum', 'format', 'description', 'title']);
/** Formati koje generator zna; ajv ih dobiva iz iste tablice. Nepoznat format ruši test. */
const FORMATS: Record<string, { re: RegExp; samples: string[] }> = {
  'date-time': { re: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/, samples: ['2026-01-02T03:04:05Z', '2026-01-02 03:04:05Z'] },
};
const SEMVER = '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';
/** Oblici jedne komponente verzije: svaka znamenka na prvom i drugom mjestu, duljine 1–3, 9, 10, 20 i 40, vodeća
 *  nula, Unicode znamenka i neznamenke. Tako sužen skup znamenki, duljina komponente ili ukupna duljina ruši paritet. */
const PARTS = [...'0123456789', ...[...'0123456789'].map((d) => `1${d}`), ...[...'123456789'].map((d) => d + d), '100', '999',
  '123456789', '1234567890', '98765432109876543210', '9'.repeat(40), '00', '01', '007', '\u0663', '1\u0663', '', 'a', '-1', '+1'];
/** Vektori po komponentama: svaka komponenta dobiva svaki oblik, ostale ostaju valjane (DAN-934-3). */
const SEMVER_VECTORS = [0, 1, 2].flatMap((i) => PARTS.map((p) => ['1', '2', '3'].map((c, j) => (j === i ? p : c)).join('.')));
/** Uzorci koje generator zna, s vektorima uz svaku granicu uzorka. Drugi uzorak ruši test. */
const PATTERNS: Record<string, string[]> = {
  [SEMVER]: [...SEMVER_VECTORS, '1.2', '1.2.3.4', '1.2.3+abc', '1.2.3-rc.1', 'v1.2.3', '1.2.3 ', '.1.2', '-1.2.3', 'latest'],
};
const ajv = new Ajv({ strict: true });
for (const [name, f] of Object.entries(FORMATS)) ajv.addFormat(name, f.re);

const WRONG_TYPES: unknown[] = ['', 0, 1, -1, 1.5, true, false, null, [], {}];
/** Probne vrijednosti: općenite, plus stanja koja `checkHealth` zna (da uži enum u ugovoru bude vidljiv). */
const SEEDS = ['', 'x', '0', '1', '0.0.0', '1.2.3', ...HEALTH_STATES];
const near = (s: string) => [s, `${s}x`, `x${s}`, s.toUpperCase(), s.slice(1), s.slice(0, -1), `${s}\n`, ` ${s}`, `0${s}`, `v${s}`, `${s}-rc`];

/** Niz duljine `n` koji i dalje odgovara uzorku: umeće ili briše po jedan znak. */
function resize(from: string, n: number, re: RegExp): string {
  let s = from;
  while (s.length !== n) {
    const next = [...Array(s.length + 1).keys()].flatMap((i) => (s.length < n
      ? [...'1234567890.ax'].map((c) => s.slice(0, i) + c + s.slice(i)) : [s.slice(0, i) + s.slice(i + 1)]))
      .find((c) => re.test(c));
    if (next === undefined) throw new Error(`generator ne zna niz duljine ${n} za uzorak ${re}`);
    s = next;
  }
  return s;
}

function strings(s: Schema): unknown[] {
  const out = [...SEEDS, ...[s.const, ...(s.enum ?? [])].filter((v): v is string => typeof v === 'string')].flatMap(near);
  if (s.format !== undefined) {
    const f = FORMATS[s.format];
    if (!f) throw new Error(`generator ne zna format: ${s.format}`);
    out.push(...f.samples.flatMap(near));
  }
  if (s.pattern !== undefined) {
    if (!PATTERNS[s.pattern]) throw new Error(`generator ne zna pattern: ${s.pattern}`);
    out.push(...PATTERNS[s.pattern]!);
  }
  const re = new RegExp(s.pattern ?? '^[\\s\\S]*$', 'u');
  const valid = out.filter((v) => re.test(v));
  if (valid.length === 0) throw new Error(`generator nema uzorak za pattern ${s.pattern}`);
  for (const n of [s.minLength, s.maxLength]) {
    if (n !== undefined) for (const m of [n - 1, n, n + 1]) if (m >= 0) out.push(resize(valid[0]!, m, re));
  }
  // Korak preko tipa: valjana vrijednost umotana u niz ili objekt.
  return [...out, ...valid.flatMap(near), ...valid.flatMap((v) => [[v], { v }])];
}

function objects(s: Schema): unknown[] {
  const props = s.properties ?? {};
  if (![undefined, true, false].includes(s.additionalProperties as boolean | undefined)) {
    throw new Error('generator ne zna additionalProperties kao shemu');
  }
  const base: Record<string, unknown> = {};
  const each = Object.entries(props).map(([k, p]) => {
    const vs = values(p);
    const check = ajv.compile(p);
    if (!vs.some((v) => check(v))) throw new Error(`generator nema valjanu vrijednost za ${k}`);
    base[k] = vs.find((v) => check(v));
    return [k, vs] as const;
  });
  // Svaki podskup ključeva (zavisnosti među poljima) i ključ izvan sheme: `extra` i svaki ključ koji zna checkHealth.
  const keys = Object.keys(base);
  const subsets = [...Array(2 ** keys.length).keys()].map((m) => Object.fromEntries(keys.filter((_, i) => m & (2 ** i)).map((k) => [k, base[k]])));
  const outside = ['extra', ...HEALTH_KEYS].filter((k) => !(k in props));
  return [...subsets, ...outside.flatMap((k) => [...Object.values(base), 'x'].map((v) => ({ ...base, [k]: v }))),
    ...each.flatMap(([k, vs]) => vs.map((v) => ({ ...base, [k]: v })))];
}

/** Vektori iz svih ograničenja sheme: granica i korak preko nje. */
function values(s: Schema): unknown[] {
  const unknown = Object.keys(s).filter((k) => !KNOWN.has(k));
  if (unknown.length > 0) throw new Error(`generator ne zna ključnu riječ: ${unknown.join(', ')}`);
  // anyOf nad objektima (zavisnosti među ključevima) generator ne zna; samo nad skalarima.
  if ((s.anyOf ?? []).some((b) => b.type === 'object' || b.properties || b.required || b.anyOf)) {
    throw new Error('generator ne zna anyOf nad objektima ili ugniježđen anyOf');
  }
  // Grana anyOf vrijedi uz ograničenja izvan nje (npr. pattern), pa se vektori grane grade iz njihova spoja.
  const { anyOf, ...rest } = s;
  const branches = (anyOf ?? []).map((b) => {
    const r = rest as Record<string, unknown>, br = b as Record<string, unknown>;
    const clash = Object.keys(br).filter((k) => k in r && JSON.stringify(br[k]) !== JSON.stringify(r[k]));
    if (clash.length > 0) throw new Error(`generator ne zna anyOf s ključnom riječi i u grani i izvan nje: ${clash.join(', ')}`);
    return { ...rest, ...b };
  });
  const out = [...WRONG_TYPES, ...branches.flatMap(values)];
  if ('const' in s) out.push(s.const);
  out.push(...(s.enum ?? []));
  if (s.type === 'object') out.push(...objects(s));
  else if (s.type === 'string' || [s.const, ...(s.enum ?? [])].some((v) => typeof v === 'string')) out.push(...strings(s));
  else if (s.type === 'number' || s.type === 'integer') {
    out.push(...[s.minimum, s.maximum].flatMap((n) => (n === undefined ? [] : [n - 1, n - 0.5, n, n + 0.5, n + 1])));
  } else if (s.type !== undefined) throw new Error(`generator ne zna tip: ${s.type}`);
  return out;
}

/** Vektori na kojima se `checkHealth` i shema ne slažu; prazan popis je paritet. */
async function mismatches(schema: Schema): Promise<string[]> {
  const check = ajv.compile(schema);
  const vectors = [...new Map(values(schema).map((v) => [JSON.stringify(v), v])).values()];
  const out: string[] = [];
  for (const v of vectors) {
    const body = JSON.stringify(v);
    const got = await checkHealth(() => Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })));
    const want = check(v);
    if (want !== (got !== null)) out.push(`shema ${want ? 'prihvaća' : 'odbija'}, checkHealth ne: ${body}`);
    else if (got !== null) {
      const b = v as { state?: string; minClientVersion?: string };
      const exp = { state: b.state ?? 'ok', minClientVersion: b.minClientVersion ?? null };
      if (JSON.stringify(got) !== JSON.stringify(exp)) out.push(`krivo pročitano: ${body}`);
    }
  }
  return out;
}

const edit = (f: (s: Schema & { properties: Record<string, Schema>; required: string[] }) => void): Schema => {
  const s = structuredClone(SCHEMA) as Schema & { properties: Record<string, Schema>; required: string[] };
  f(s);
  return s;
};

describe('platform.health.get 200: paritet sheme i checkHealth', () => {
  test('pozitivna kontrola: generator daje i prihvaćene i odbijene vektore', () => {
    const check = ajv.compile(SCHEMA);
    const vs = values(SCHEMA);
    expect(vs.filter((v) => check(v)).length).toBeGreaterThan(10);
    expect(vs.filter((v) => !check(v)).length).toBeGreaterThan(100);
  });

  test('checkHealth prihvaća točno ono što prihvaća shema iz ugovora', async () => {
    expect(await mismatches(SCHEMA)).toEqual([]);
  });

  test.each([
    ['text/plain', 200, 'text/plain'], ['application/jsonx', 200, 'application/jsonx'], ['bez zaglavlja', 200, null],
    ['status 500', 500, 'application/json'], ['status 203', 203, 'application/json'],
    ['text/json', 200, 'text/json'], ['application/problem+json', 200, 'application/problem+json'],
    ['application/json; charset', 200, 'Application/JSON; charset=utf-8'], ['application/json ; charset', 200, 'application/json ; charset=utf-8'],
  ])('ugovor odgovora 200 traži application/json: %s', async (name, status, type) => {
    const headers: Record<string, string> = type === null ? {} : { 'content-type': type };
    const res = new Response(JSON.stringify({ status: 'ok' }), { status, headers });
    if (type === null) res.headers.delete('content-type');
    const got = await checkHealth(() => Promise.resolve(res));
    expect(got).toEqual(name.includes('charset') ? { state: 'ok', minClientVersion: null } : null);
  });

  test('šalje točno jedan zahtjev na put i metodu iz ugovora, bez kolačića i bez praćenja preusmjerenja', async () => {
    const calls: [string, RequestInit][] = [];
    await checkHealth((path, init) => {
      calls.push([path, init]);
      return Promise.resolve(new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    expect(calls.map(([path, init]) => [path, init.method ?? 'GET', init.credentials, init.redirect, init.cache, init.body]))
      .toEqual([[PATH, METHOD, 'omit', 'manual', 'no-store', undefined]]);
  });

  const OK_JSON = { 'content-type': 'application/json' };
  test.each([301, 302, 303, 307, 308])('preusmjerenje %i s valjanim tijelom daje null', async (status) => {
    const res = new Response('{"status":"ok"}', { status, headers: { ...OK_JSON, location: '/elsewhere' } });
    expect(await checkHealth(() => Promise.resolve(res))).toBeNull();
  });

  test('neproziran odgovor preusmjerenja (redirect: manual) daje null', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, redirected: false, headers: new Headers(OK_JSON),
      json: () => Promise.resolve({ status: 'ok' }) } as unknown as Response;
    expect(await checkHealth(() => Promise.resolve(opaque))).toBeNull();
  });

  test('odgovor nakon praćenog preusmjerenja daje null, i kad get zanemari redirect', async () => {
    const followed = new Response('{"status":"ok"}', { status: 200, headers: OK_JSON });
    Object.defineProperty(followed, 'redirected', { value: true });
    expect(await checkHealth(() => Promise.resolve(followed))).toBeNull();
  });

  test('mreža ili tijelo koje nije JSON daje null', async () => {
    expect(await checkHealth(() => Promise.reject(new TypeError('mreža')))).toBeNull();
    const bad = new Response('{"status":"ok"', { status: 200, headers: { 'content-type': 'application/json' } });
    expect(await checkHealth(() => Promise.resolve(bad))).toBeNull();
  });

  test.each([
    ['maxLength: 16 na minClientVersion', edit((s) => { s.properties.minClientVersion!.maxLength = 16; })],
    ['minLength: 6 na minClientVersion', edit((s) => { s.properties.minClientVersion!.minLength = 6; })],
    ['novo obvezno polje', edit((s) => { s.properties.region = { type: 'string' }; s.required.push('region'); })],
    ['postojeće polje postaje obvezno', edit((s) => { s.required.push('state'); })],
    ['uži enum stanja', edit((s) => { s.properties.state!.anyOf = s.properties.state!.anyOf!.filter((b) => b.const !== 'degraded'); })],
    ['uži enum stanja kao enum', edit((s) => { delete s.properties.state!.anyOf; s.properties.state!.enum = ['ok']; })],
    ['additionalProperties: false uklonjen', edit((s) => { delete s.additionalProperties; })],
    ['anyOf duljina uz pattern (rupa na 20)', edit((s) => { s.properties.minClientVersion!.anyOf = [{ type: 'string', maxLength: 19 }, { type: 'string', minLength: 21 }]; })],
    ['uklonjeno polje serverVersion', edit((s) => { delete s.properties.serverVersion; })],
    ['uklonjeno polje state', edit((s) => { delete s.properties.state; })],
    ['drugi const statusa', edit((s) => { s.properties.status!.const = 'up'; })],
  ])('izmijenjen ugovor ruši paritet: %s', async (_name, schema) => {
    expect((await mismatches(schema)).length).toBeGreaterThan(0);
  });

  // Sužen uzorak verzije (komponenta na najviše dvije znamenke) mora odbiti barem jedan vektor koji shema prihvaća.
  const NARROW = '(0|[1-9]\\d?)';
  test.each([0, 1, 2])('sužena komponenta %i uzorka verzije ruši paritet', (i) => {
    const parts = SEMVER.slice(1, -1).split('\\.');
    const mutant = new RegExp(`^${parts.map((p, j) => (j === i ? NARROW : p)).join('\\.')}$`, 'u');
    const check = ajv.compile(SCHEMA.properties!.minClientVersion!);
    expect(parts).toHaveLength(3);
    expect(values(SCHEMA.properties!.minClientVersion!).filter((v) => typeof v === 'string' && check(v) && !mutant.test(v)).length).toBeGreaterThan(0);
  });

  test.each([
    ['multipleOf', edit((s) => { (s.properties.version as Record<string, unknown>).multipleOf = 2; })],
    ['oneOf', edit((s) => { (s as Record<string, unknown>).oneOf = [{}]; })],
    ['nepoznat format', edit((s) => { s.properties.version!.format = 'email'; })],
    ['drugi pattern verzije', edit((s) => { s.properties.version!.pattern = '^\\d+\\.\\d+\\.\\d+$'; })],
    ['pattern umjesto const statusa', edit((s) => { s.properties.status = { type: 'string', pattern: '^(ok|up)$' }; })],
    ['anyOf s istom ključnom riječi u grani', edit((s) => { s.properties.version!.anyOf = [{ type: 'string', pattern: '^1$' }]; })],
    ['anyOf nad objektima', edit((s) => { s.anyOf = [{ type: 'object', required: ['version'] }]; })],
    ['tip boolean', edit((s) => { s.properties.flag = { type: 'boolean' }; })],
  ])('ključna riječ koju generator ne zna ruši test: %s', (_name, schema) => {
    expect(() => values(schema)).toThrow(/generator ne zna/);
  });
});
