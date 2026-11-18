// DAN-934-2: paritet `checkHealth` i sheme odgovora 200 `platform.health.get` iz `@ductura/contracts`.
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
const SCHEMA = Object.values(openapi.paths as unknown as Record<string, Record<string, Op>>)
  .flatMap((ops) => Object.values(ops)).find((op) => op.operationId === 'platform.health.get')!
  .responses!['200']!.content!['application/json']!.schema;

const KNOWN = new Set(['type', 'const', 'enum', 'anyOf', 'required', 'properties', 'additionalProperties', 'minLength',
  'maxLength', 'pattern', 'minimum', 'maximum', 'format', 'description', 'title']);
/** Formati koje generator zna; ajv ih dobiva iz iste tablice. Nepoznat format ruši test. */
const FORMATS: Record<string, { re: RegExp; samples: string[] }> = {
  'date-time': { re: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/, samples: ['2026-01-02T03:04:05Z', '2026-01-02 03:04:05Z'] },
};
const SEMVER = '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';
/** Uzorci koje generator zna, s vektorima uz svaku granicu uzorka. Drugi uzorak ruši test. */
const PATTERNS: Record<string, string[]> = {
  [SEMVER]: ['0.0.0', '1.2.3', '10.20.30', '1000.0.0', '7.8.9', '99999999.0.0', '01.0.0', '1.00.0', '1.0.01', '1.2', '1.2.3.4',
    '1.2.3+abc', '1.2.3-rc.1', 'v1.2.3', '1.2.3 ', '1..3', '.1.2', '1.2.', '-1.2.3', '1.a.3', '\u0661.0.0', '1\u0663.0.0', 'latest'],
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
  const out = [...WRONG_TYPES, ...(s.anyOf ?? []).flatMap(values)];
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
    ['application/json; charset', 200, 'Application/JSON; charset=utf-8'],
  ])('ugovor odgovora 200 traži application/json: %s', async (name, status, type) => {
    const headers: Record<string, string> = type === null ? {} : { 'content-type': type };
    const res = new Response(JSON.stringify({ status: 'ok' }), { status, headers });
    if (type === null) res.headers.delete('content-type');
    const got = await checkHealth(() => Promise.resolve(res));
    expect(got).toEqual(name === 'application/json; charset' ? { state: 'ok', minClientVersion: null } : null);
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
    ['uklonjeno polje serverVersion', edit((s) => { delete s.properties.serverVersion; })],
    ['uklonjeno polje state', edit((s) => { delete s.properties.state; })],
    ['drugi const statusa', edit((s) => { s.properties.status!.const = 'up'; })],
  ])('izmijenjen ugovor ruši paritet: %s', async (_name, schema) => {
    expect((await mismatches(schema)).length).toBeGreaterThan(0);
  });

  test.each([
    ['multipleOf', edit((s) => { (s.properties.version as Record<string, unknown>).multipleOf = 2; })],
    ['oneOf', edit((s) => { (s as Record<string, unknown>).oneOf = [{}]; })],
    ['nepoznat format', edit((s) => { s.properties.version!.format = 'email'; })],
    ['drugi pattern verzije', edit((s) => { s.properties.version!.pattern = '^\\d+\\.\\d+\\.\\d+$'; })],
    ['pattern umjesto const statusa', edit((s) => { s.properties.status = { type: 'string', pattern: '^(ok|up)$' }; })],
    ['anyOf nad objektima', edit((s) => { s.anyOf = [{ type: 'object', required: ['version'] }]; })],
    ['tip boolean', edit((s) => { s.properties.flag = { type: 'boolean' }; })],
  ])('ključna riječ koju generator ne zna ruši test: %s', (_name, schema) => {
    expect(() => values(schema)).toThrow(/generator ne zna/);
  });
});
