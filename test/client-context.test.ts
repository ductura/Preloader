// P-0.8 nad lažnim serverom: tijelo prolazi shemu `client.context.post`, a pad rute ne blokira nastavak.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  CLIENT_APP_VERSION_PATTERN, CLIENT_CONTEXT_MAX_BYTES, CLIENT_CONTEXT_PATH, CLIENT_CONTEXT_VALUES,
  APP_VERSION_RE, clientContextBody, clientContextFrom, sendClientContext, type Fetch,
} from '../src/client-context/index.ts';
import { APP_VERSION } from '../src/config.ts';
import { UA } from './user-agents.ts';

const LISTS = CLIENT_CONTEXT_VALUES as unknown as Record<string, readonly string[]>;
const FIELDS = [...Object.keys(LISTS), 'appVersion'].sort();

/** Provjera tijela kao `parseClientContext` (ductura/server `server/http/client-context.ts`, 7c0b8ec9). */
function accepts(text: string): boolean {
  if (Buffer.byteLength(text) > CLIENT_CONTEXT_MAX_BYTES) return false;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return false; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== FIELDS.join()) return false;
  if (typeof r['appVersion'] !== 'string' || !new RegExp(CLIENT_APP_VERSION_PATTERN, 'u').test(r['appVersion'])) return false;
  if (Object.entries(LISTS).some(([k, list]) => typeof r[k] !== 'string' || !list.includes(r[k] as string))) return false;
  return `{${FIELDS.map((k) => `"${k}":${JSON.stringify(r[k])}`).join(',')}}` === text;
}

const GOOD = { app: 'web', appVersion: '1.4.0', browser: 'firefox', device: 'desktop', os: 'linux', screen: 'expanded' };
const jcs = (o: Record<string, unknown>) => `{${Object.keys(o).sort().map((k) => `"${k}":${JSON.stringify(o[k])}`).join(',')}}`;

describe('vendorirana kopija prema vektorima izvora (7c0b8ec9)', () => {
  test('liste i uzorak jednaki su snimci izvora', () => {
    expect(CLIENT_CONTEXT_VALUES).toEqual({
      app: ['web', 'desktop'], os: ['windows', 'macos', 'linux', 'android', 'ios', 'other'],
      browser: ['chromium', 'firefox', 'safari', 'other'], device: ['desktop', 'tablet', 'phone', 'other'],
      screen: ['compact', 'medium', 'expanded'],
    });
    expect(CLIENT_APP_VERSION_PATTERN).toBe('^(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})\\.(?:0|[1-9][0-9]{0,5})$');
    expect([CLIENT_CONTEXT_PATH, CLIENT_CONTEXT_MAX_BYTES]).toEqual(['/api/v1/client-context', 256]);
  });

  test.each([
    ['invalid-input', jcs({ ...GOOD, os: 'haiku' })], ['unknown-field', jcs({ ...GOOD, screenWidth: 1920 })],
    ['not-canonical', JSON.stringify(GOOD, null, 1)], ['invalid-json', '{app: web}'],
    ['body-too-large', jcs({ ...GOOD, x: 'e'.repeat(200) })], ['__proto__', `{"__proto__":"x",${jcs(GOOD).slice(1)}`],
    ...['1.4', 'v1.4.0', '01.4.0', '1.04.0', '1.4.0-beta', '1.4.0+abcdef0', '1.4.0\n', '1.4.0\r\n', '1.4.0\t',
      '1.4.0 ', '1.4.0\u007f', '1.4.0.1', '1234567.0.0', '１.4.0', '1.4.0 '].map((v) => [`verzija ${JSON.stringify(v)}`, jcs({ ...GOOD, appVersion: v })]),
  ])('odbija %s', (_name, body) => expect(accepts(body)).toBe(false));

  test('kraći APP_VERSION_RE slaže se s uzorkom izvora', () => {
    const source = new RegExp(CLIENT_APP_VERSION_PATTERN, 'u');
    for (const v of ['0.0.0', '1.4.0', '2.0.1', '999999.999999.999999', '1.4', 'v1.4.0', '01.4.0', '1.04.0', '1.4.0-beta',
      '1.4.0+abcdef0', '1.4.0\n', '1.4.0\r\n', '1.4.0\t', '1.4.0\u00a0', '1.4.0\u007f', '1.4.0.1', '1234567.0.0',
      '\uff11.4.0', '1.4.0 ', '1.4.0\n1.4.0', '\u0661.4.0', '']) {
      expect([v, APP_VERSION_RE.test(v)]).toEqual([v, source.test(v)]);
    }
  });

  test('prihvaća recorded i recorded-desktop-signed-in; verzija izgradnje prolazi uzorak', () => {
    expect(accepts(jcs(GOOD))).toBe(true);
    expect(accepts(jcs({ app: 'desktop', appVersion: '2.0.1', browser: 'chromium', device: 'desktop', os: 'windows', screen: 'medium' }))).toBe(true);
    expect(APP_VERSION).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
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
  test.each(Object.entries(UA))('%s: jedan zahtjev, tijelo prolazi shemu', async (_name, userAgent) => {
    const { got, fetcher, settled } = await fake((_q, res) => res.writeHead(204).end());
    for (const width of widths) {
      sendClientContext(fetcher, { userAgent, maxTouchPoints: 5 }, width, APP_VERSION);
      await settled();
    }
    expect(got).toHaveLength(widths.length);
    for (const r of got) {
      expect([r.method, r.url, r.type]).toEqual(['POST', '/api/v1/client-context', 'application/json']);
      expect(accepts(r.body), r.body).toBe(true);
    }
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

  test('tijelo: samo šest ključeva po redu; najdulje ispravno tijelo stane u maxBodyBytes', () => {
    const c = clientContextFrom({ userAgent: UA.chromeAndroidTablet }, 900, '999999.999999.999999');
    expect(Object.keys(c)).toEqual(FIELDS);
    expect(clientContextBody(c)).toBe(jcs(c));
    // Najdulje vrijednosti s lista: desktop/chromium/desktop/android/expanded.
    const longest = jcs({ ...c, app: 'desktop', browser: 'chromium', device: 'desktop' });
    expect([longest.length, accepts(longest)]).toEqual([128, true]);
  });

  test('loša verzija: ništa se ne šalje', () => {
    let calls = 0;
    for (const v of ['1.4', '1.4.0\r\n', '1.4.0 ', '']) {
      sendClientContext(() => { calls += 1; return Promise.resolve(); }, { userAgent: UA.chromeMac }, 1200, v);
    }
    expect(calls).toBe(0);
  });
});
