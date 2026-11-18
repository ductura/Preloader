// P-0.4 (samo poziv): jedan GET `platform.health.get` i čitanje odgovora. Ne baca; sve izvan
// oblika iz ugovora znači da server nije dostupan. Stranica ga još ne uključuje (proračun ostaje).
import type { Operations } from '@ductura/contracts';

type Body = Operations['platform.health.get']['success']['body'];
/** Put rute `platform.health.get`; test ga uspoređuje s lažnim serverom iz `@ductura/test-fakes`. */
export const HEALTH_PATH = '/api/v1/health';
export type Get = (path: string, init: RequestInit) => Promise<Response>;
/** `null`: server nije dostupan ili odgovor nema oblik iz ugovora. */
export type Health = { state: NonNullable<Body['state']>; minClientVersion: string | null } | null;

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function checkHealth(get: Get): Promise<Health> {
  try {
    const r = await get(HEALTH_PATH, { credentials: 'omit', cache: 'no-store' });
    if (r.status !== 200) return null;
    const b = (await r.json()) as { [K in keyof Body]?: unknown } | null;
    if (b?.status !== 'ok') return null;
    const state = b.state ?? 'ok';
    const min = b.minClientVersion ?? null;
    if (state !== 'ok' && state !== 'degraded') return null;
    if (min !== null && !(typeof min === 'string' && VERSION_RE.test(min))) return null;
    return { state, minClientVersion: min };
  } catch {
    return null;
  }
}
