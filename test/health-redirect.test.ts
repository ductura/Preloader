// DAN-934-3a: `checkHealth` ne slijedi preusmjerenje. Zdravlje vrijedi samo za izravan odgovor rute iz ugovora.
import { describe, expect, test } from 'vitest';
import { checkHealth, HEALTH_PATH } from '../src/server-check/index.ts';

const OK_JSON = { 'content-type': 'application/json' };
const ok = (status = 200, headers: Record<string, string> = OK_JSON) => new Response('{"status":"ok"}', { status, headers });

describe('checkHealth: preusmjerenje', () => {
  test('šalje točno jedan zahtjev na put i metodu iz ugovora, bez kolačića i bez praćenja preusmjerenja', async () => {
    const calls: [string, RequestInit][] = [];
    await checkHealth((path, init) => {
      calls.push([path, init]);
      return Promise.resolve(ok());
    });
    expect(calls.map(([path, init]) => [path, init.method ?? 'GET', init.credentials, init.redirect, init.cache, init.body]))
      .toEqual([[HEALTH_PATH, 'GET', 'omit', 'manual', 'no-store', undefined]]);
    expect(HEALTH_PATH).toBe('/api/v1/health');
  });

  test('pozitivna kontrola: izravan 200 s valjanim tijelom nije null', async () => {
    expect(await checkHealth(() => Promise.resolve(ok()))).toEqual({ state: 'ok', minClientVersion: null });
  });

  test.each([301, 302, 303, 307, 308])('preusmjerenje %i s valjanim tijelom daje null', async (status) => {
    const res = ok(status, { ...OK_JSON, location: '/elsewhere' });
    expect(await checkHealth(() => Promise.resolve(res))).toBeNull();
  });

  test('neproziran odgovor preusmjerenja (redirect: manual) daje null', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, redirected: false, headers: new Headers(OK_JSON),
      json: () => Promise.resolve({ status: 'ok' }) } as unknown as Response;
    expect(await checkHealth(() => Promise.resolve(opaque))).toBeNull();
  });

  test('odgovor nakon praćenog preusmjerenja daje null, i kad get zanemari redirect', async () => {
    const followed = ok();
    Object.defineProperty(followed, 'redirected', { value: true });
    expect(followed.status).toBe(200);
    expect(await checkHealth(() => Promise.resolve(followed))).toBeNull();
  });
});
