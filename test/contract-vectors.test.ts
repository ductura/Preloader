// DAN-934: vektori `platform.health.get` i `client.context.post` iz @ductura/test-fakes kroz pozive
// preloadera nad lažnim serverom. Novi, uklonjeni ili promijenjeni vektor, ili poziv koji šalje
// drugi oblik, ruši test.
import { createFakeServer, FAKE_VECTOR_HEADER, ROUTE_TABLE, VECTORS, type FakeVector } from '@ductura/test-fakes/fake-server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CLIENT_CONTEXT_PATH, clientContextBody, clientContextFrom, sendClientContext } from '../src/client-context/index.ts';
import { checkHealth, HEALTH_PATH, type Health } from '../src/server-check/health.ts';
import { UA } from './user-agents.ts';

const server = createFakeServer();
let base = '';
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

const of = (route: string): FakeVector[] => VECTORS.filter((v) => v.route === route);
/** Zaglavlja koja dodaje preglednik, ne preloader; iz vektora ih uzima samo test. */
const BROWSER_HEADERS = ['origin', 'sec-fetch-site', 'cookie'];

/** Fetch prema lažnom serveru s odabranim vektorom; pamti status koji je server vratio. */
function fetchFor(v: FakeVector, seen: number[], pending: Promise<unknown>[] = []) {
  const extra = Object.fromEntries(Object.entries(v.request.headers ?? {}).filter(([k]) => BROWSER_HEADERS.includes(k)));
  return (path: string, init: RequestInit): Promise<Response> => {
    const p = fetch(base + path, { ...init, headers: { ...(init.headers as Record<string, string>), ...extra, [FAKE_VECTOR_HEADER]: v.name } })
      .then((r) => { seen.push(r.status); return r; });
    pending.push(p);
    return p;
  };
}

describe('platform.health.get: vektori kroz checkHealth', () => {
  const EXPECTED: Record<string, Health> = {
    alive: { state: 'ok', minClientVersion: null },
    'alive-with-version': { state: 'ok', minClientVersion: null },
    'alive-current': { state: 'ok', minClientVersion: '1.0.0' },
    degraded: { state: 'degraded', minClientVersion: '1.0.0' },
    internal: null,
    'too-many-requests': null,
  };

  test('put je iz ugovora i svaki vektor rute ima očekivani ishod (novi ili uklonjeni ruši test)', () => {
    expect(HEALTH_PATH).toBe(ROUTE_TABLE['platform.health.get'].path);
    expect(of('platform.health.get').map((v) => v.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  test.each(of('platform.health.get').map((v) => [v.name, v] as const))('%s', async (name, v) => {
    const seen: number[] = [];
    expect(await checkHealth(fetchFor(v, seen))).toEqual(EXPECTED[name]);
    // Odgovor je baš taj vektor, ne 501 lažnog servera za zahtjev koji nijedan vektor ne opisuje.
    expect(seen).toEqual([v.response.status]);
  });

  const ok = { status: 'ok', state: 'ok', apiVersion: '1.20.0', serverVersion: '0.1.0', minClientVersion: '1.0.0' };
  test.each([
    ['status nije ok', { ...ok, status: 'fine' }], ['bez statusa', { state: 'ok' }], ['nepoznato stanje', { ...ok, state: 'down' }],
    ['verzija s v', { ...ok, minClientVersion: 'v1.0.0' }], ['verzija kao niz', { ...ok, minClientVersion: ['1.0.0'] }],
    ['verzija kao broj', { ...ok, minClientVersion: 1 }], ['niz', [ok]], ['null', null], ['tekst', 'ok'],
  ])('kriv oblik odgovora 200 daje null: %s', async (_name, body) => {
    const get = () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await checkHealth(get)).toBeNull();
  });

  test('nije JSON ili mreža pada: null, bez bacanja', async () => {
    expect(await checkHealth(() => Promise.resolve(new Response('<html>', { status: 200 })))).toBeNull();
    expect(await checkHealth(() => Promise.reject(new TypeError('offline')))).toBeNull();
    expect(await checkHealth(() => { throw new TypeError('no fetch'); })).toBeNull();
  });
});

describe('client.context.post: vektori kroz sendClientContext', () => {
  const BODY = JSON.parse(clientContextBody(clientContextFrom({ userAgent: UA.firefoxLinux }, 1200, '1.4.0'))) as unknown;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  // Vektori koje poziv preloadera može proizvesti: isto tijelo, JSON, bez ručnog content-length.
  const reachable = of('client.context.post').filter((v) => same(v.request.body, BODY)
    && v.request.headers?.['content-type'] === 'application/json' && !('content-length' in v.request.headers));

  test('put je iz ugovora i tijelo preloadera pogađa točno ove vektore', () => {
    expect(CLIENT_CONTEXT_PATH).toBe(ROUTE_TABLE['client.context.post'].path);
    expect(reachable.map((v) => v.name)).toEqual(['recorded', 'origin-missing', 'origin-mismatch', 'cross-site']);
  });

  test.each(reachable.map((v) => [v.name, v] as const))('%s: server vraća status vektora, poziv ne baca', async (_name, v) => {
    const seen: number[] = [];
    const pending: Promise<unknown>[] = [];
    expect(sendClientContext(fetchFor(v, seen, pending), { userAgent: UA.firefoxLinux }, 1200, '1.4.0')).toBeUndefined();
    await Promise.all(pending);
    expect(seen).toEqual([v.response.status]);
  });

  test('drugi oblik tijela ne pogađa vektor: lažni server vraća 501, pa bi test pao', async () => {
    const recorded = reachable.find((v) => v.name === 'recorded')!;
    for (const [ua, width, version] of [[UA.firefoxLinux, 700, '1.4.0'], [UA.chromeMac, 1200, '1.4.0'], [UA.firefoxLinux, 1200, '1.4.1']] as const) {
      const seen: number[] = [];
      const pending: Promise<unknown>[] = [];
      sendClientContext(fetchFor(recorded, seen, pending), { userAgent: ua }, width, version);
      await Promise.all(pending);
      expect(seen).toEqual([501]);
    }
  });
});
