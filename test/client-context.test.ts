// P-0.8 nad lažnim serverom: tijelo prolazi shemu `client.context.post` iz `@ductura/contracts`,
// a pad rute ne blokira nastavak.
import { canonicalJson, validateInput, VALIDATORS, type OperationId } from '@ductura/contracts';
import openapi from '@ductura/contracts/openapi/v1.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  APP_VERSION_RE, CLIENT_CONTEXT_PATH, clientContextBody, clientContextFrom, sendClientContext, type Fetch,
} from '../src/client-context/index.ts';
import { APP_VERSION } from '../src/config.ts';
import { UA } from './user-agents.ts';

const ID: OperationId = 'client.context.post';
type Op = {
  operationId?: string; 'x-max-body-bytes'?: number;
  requestBody?: { content: { 'application/json': { schema: { required: string[]; properties: Record<string, { pattern?: string; anyOf?: { const: string }[] }> } } } };
};
/** Ruta `client.context.post` iz OpenAPI dokumenta paketa: put, metoda, granica tijela i shema. */
const [PATH, METHOD, OP] = Object.entries(openapi.paths as unknown as Record<string, Record<string, Op>>)
  .flatMap(([path, ops]) => Object.entries(ops).filter(([, op]) => op.operationId === ID)
    .map(([method, op]) => [path, method.toUpperCase(), op] as const))[0]!;
const SCHEMA = OP.requestBody!.content['application/json'].schema;
const MAX_BYTES = OP['x-max-body-bytes']!;
const FIELDS = [...SCHEMA.required].sort();

/** Tijelo kakvo server prima: unutar granice, JSON, prolazi validator paketa i jednako je svom JCS obliku. */
function accepts(text: string): boolean {
  if (Buffer.byteLength(text) > MAX_BYTES) return false;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return false; }
  return validateInput(ID, 'body', value) && canonicalJson(value) === text;
}

const GOOD = { app: 'web', appVersion: '1.4.0', browser: 'firefox', device: 'desktop', os: 'linux', screen: 'expanded' };
const jcs = (o: Record<string, unknown>) => canonicalJson(o);
const { os: _os, ...noOs } = GOOD;
const BAD_VERSIONS = ['1.4', 'v1.4.0', '01.4.0', '1.04.0', '+1.4.0', '-1.4.0', '1.4.0-beta', '1.4.0+abcdef0', '1.4.0\n',
  '1.4.0\r\n', '\r\n1.4.0', '1.4.0\t', '1.4.0\u00a0', '\u00a01.4.0', '1.4.0\u007f', '1.4.0 ', '1.4.0.1', '1234567.0.0',
  '\uff11.4.0', '\u0661.4.0', '1.4.0\n1.4.0', ''];

describe('ugovor iz @ductura/contracts (negativni slučajevi prvi)', () => {
  test('pozitivna kontrola: validator rute postoji i prihvaća ispravno tijelo', () => {
    expect(typeof VALIDATORS[`${ID}:body`]).toBe('function');
    expect(validateInput(ID, 'body', GOOD)).toBe(true);
    expect(accepts(jcs(GOOD))).toBe(true);
  });

  test.each([
    ['ključevi izvan reda', `{"os":"linux",${jcs(GOOD).slice(1).replace(',"os":"linux"', '')}`],
    ['razmak', jcs(GOOD).replace(':', ': ')], ['dvostruki ključ', `{"os":"haiku",${jcs(GOOD).slice(1)}`],
    ['dvostruki ključ, oba ispravna', jcs(GOOD).replace('"os":"linux"', '"os":"linux","os":"linux"')],
    ['nepoznata vrijednost', jcs({ ...GOOD, os: 'haiku' })], ['nepoznato polje', jcs({ ...GOOD, screenWidth: 1920 })],
    ['nedostaje polje', jcs(noOs)], ['nije kanonski', JSON.stringify(GOOD, null, 1)], ['nije JSON', '{app: web}'],
    ['preko granice', jcs({ ...GOOD, x: 'e'.repeat(MAX_BYTES) })], ['niz', '[]'], ['null', 'null'], ['broj', '1'],
    ...['__proto__', 'toString', 'constructor', 'hasOwnProperty'].map((k) => [`vlastiti ključ ${k}`, `{"${k}":"x",${jcs(GOOD).slice(1)}`]),
    ...BAD_VERSIONS.map((v) => [`verzija ${JSON.stringify(v)}`, jcs({ ...GOOD, appVersion: v })]),
  ])('odbija: %s', (_name, body) => expect(accepts(body)).toBe(false));

  test('loša verzija: APP_VERSION_RE se slaže s uzorkom ugovora i ništa se ne šalje', () => {
    const pattern = new RegExp(SCHEMA.properties['appVersion']!.pattern!, 'u');
    let calls = 0;
    for (const v of [...BAD_VERSIONS, '0.0.0', '1.4.0', '999999.999999.999999']) {
      expect([v, APP_VERSION_RE.test(v)]).toEqual([v, pattern.test(v)]);
    }
    for (const v of BAD_VERSIONS) {
      expect(sendClientContext(() => { calls += 1; return Promise.resolve(); }, { userAgent: UA.chromeMac }, 1200, v)).toBeUndefined();
    }
    expect(calls).toBe(0);
  });

  test('prihvaća ispravna tijela; put i verzija izgradnje slažu se s ugovorom', () => {
    expect(accepts(jcs(GOOD))).toBe(true);
    expect(accepts(jcs({ app: 'desktop', appVersion: '2.0.1', browser: 'chromium', device: 'desktop', os: 'windows', screen: 'medium' }))).toBe(true);
    expect([METHOD, CLIENT_CONTEXT_PATH]).toEqual(['POST', PATH]);
    expect(APP_VERSION).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    expect(APP_VERSION_RE.test(APP_VERSION)).toBe(true);
  });
});

describe('slanje lažnom serveru', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((done) => server ? server.close(done) : done(undefined));
    server = undefined;
    await new Promise((done) => setImmediate(done));
  });

  /** Lažni server; `answer` odlučuje odgovor (ili ga ne daje). Vraća primljene zahtjeve i `fetch` s baznim URL-om. */
  async function fake(answer: (req: IncomingMessage, res: import('node:http').ServerResponse) => void) {
    const got: { method: string | undefined; url: string | undefined; type: string | undefined; body: string }[] = [];
    server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8').on('data', (c: string) => { body += c; }).on('end', () => {
        got.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
        answer(req, res);
      });
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    let settled: Promise<unknown> = Promise.resolve();
    const fetcher: Fetch = (path, init) => (settled = fetch(new URL(path, base), init).catch(() => undefined));
    return { got, fetcher, settled: () => settled };
  }

  const widths = [0, 599.5, 600, 839, 840, Number.NaN, -1, Infinity];
  const seenOs = new Set<string>();
  // Bez dodira i s dodirom: Mac bez dodira šalje `macos`, a isti UA s dodirom je iPad (`ios`).
  test.each([...Object.entries(UA), ['prazan UA', '']])('%s: jedan zahtjev po širini, tijelo prolazi shemu', async (_name, userAgent) => {
    const { got, fetcher, settled } = await fake((_q, res) => res.writeHead(204).end());
    for (const maxTouchPoints of [0, 5]) {
      for (const width of widths) {
        sendClientContext(fetcher, { userAgent, maxTouchPoints }, width, APP_VERSION);
        await settled();
      }
    }
    expect(got).toHaveLength(2 * widths.length);
    for (const r of got) {
      expect([r.method, r.url, r.type]).toEqual([METHOD, PATH, 'application/json']);
      expect(accepts(r.body), r.body).toBe(true);
      seenOs.add(JSON.parse(r.body).os);
    }
  });

  test('lažni server je primio svaki sustav iz ugovora', () => {
    expect([...seenOs].sort()).toEqual(SCHEMA.properties['os']!.anyOf!.map((a) => a.const).sort());
  });

  test('preslikavanje na zatvorene vrijednosti', () => {
    const at = (userAgent: string, width = 1000, maxTouchPoints?: number) => clientContextFrom({ userAgent, maxTouchPoints }, width, '1.0.0');
    expect(at(UA.edgeWindows)).toMatchObject({ os: 'windows', browser: 'chromium', device: 'desktop', screen: 'expanded' });
    expect(at(UA.safariIpadDesktop, 700, 5)).toMatchObject({ os: 'ios', browser: 'safari', device: 'tablet', screen: 'medium' });
    expect(at(UA.chromeAndroidTablet)).toMatchObject({ os: 'android', browser: 'chromium', device: 'tablet' });
    expect(at(UA.firefoxAndroid, 400)).toMatchObject({ os: 'android', browser: 'firefox', device: 'phone', screen: 'compact' });
    for (const platform of ['__proto__', 'toString', 'constructor']) {
      expect(clientContextFrom({ userAgent: '', hints: { mobile: false, platform } }, 1000, '1.0.0').os).toBe('other');
    }
  });

  test.each([500, 400, 403, 429])('odgovor %i ne blokira nastavak', async (status) => {
    const { got, fetcher, settled } = await fake((_q, res) => res.writeHead(status).end());
    expect(sendClientContext(fetcher, { userAgent: UA.chromeMac }, 1200, '1.0.0')).toBeUndefined();
    await settled();
    expect(got).toHaveLength(1);
  });

  test('prekinuta veza ne blokira nastavak', async () => {
    const { got, fetcher, settled } = await fake((req) => req.socket.destroy());
    expect(sendClientContext(fetcher, { userAgent: UA.chromeMac }, 1200, '1.0.0')).toBeUndefined();
    await settled();
    expect(got).toHaveLength(1);
  });

  test('server bez odgovora: povrat odmah, veza se zatvara u čišćenju', async () => {
    let arrived!: () => void;
    const seen = new Promise<void>((done) => { arrived = done; });
    const { fetcher } = await fake(() => arrived());
    expect(sendClientContext(fetcher, { userAgent: UA.chromeMac }, 1200, '1.0.0')).toBeUndefined();
    await seen;
  });

  test('fetch koji baca, odbija ili nikad ne završi ne blokira nastavak', async () => {
    const at = [{ userAgent: UA.chromeMac }, 1200, '1.0.0'] as const;
    expect(sendClientContext(() => { throw new TypeError('nema mreže'); }, ...at)).toBeUndefined();
    expect(sendClientContext(() => Promise.reject(new Error('pad')), ...at)).toBeUndefined();
    expect(sendClientContext(() => new Promise<never>(() => {}), ...at)).toBeUndefined();
    await new Promise((done) => setImmediate(done));
  });

  test('tijelo: samo ključevi sheme po redu; najdulje ispravno tijelo stane u x-max-body-bytes', () => {
    const c = clientContextFrom({ userAgent: UA.chromeAndroidTablet }, 900, '999999.999999.999999');
    expect(Object.keys(c)).toEqual(FIELDS);
    expect(clientContextBody(c)).toBe(jcs(c));
    // Najdulje tijelo koje ugovor dopušta: najdulja `const` iz `anyOf` za svako polje i najdulja verzija.
    const longest = jcs(Object.fromEntries(Object.entries(SCHEMA.properties).map(([k, p]) => [k,
      p.anyOf ? p.anyOf.map((a) => a.const).sort((x, y) => y.length - x.length)[0] : '999999.999999.999999'])));
    expect(accepts(longest), longest).toBe(true);
    expect(Buffer.byteLength(longest)).toBeLessThanOrEqual(MAX_BYTES);
  });

});
