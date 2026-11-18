// P-0.4 (samo poziv): jedan GET `platform.health.get` i čitanje odgovora. Ne baca; sve izvan
// oblika iz ugovora znači da server nije dostupan. Stranica ga još ne uključuje (proračun ostaje).
import type { Operations } from '@ductura/contracts';

type Body = Operations['platform.health.get']['success']['body'];
/** Put rute `platform.health.get`; test ga uspoređuje s lažnim serverom iz `@ductura/test-fakes`. */
export const HEALTH_PATH = '/api/v1/health';
export type Get = (path: string, init: RequestInit) => Promise<Response>;
/** `null`: server nije dostupan ili odgovor nema oblik iz ugovora. */
export type Health = { state: NonNullable<Body['state']>; minClientVersion: string | null } | null;

/** Isti uzorak kao polja verzija u ugovoru (test ih uspoređuje). */
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_KEYS = ['version', 'apiVersion', 'serverVersion', 'minClientVersion'];

export async function checkHealth(get: Get): Promise<Health> {
  try {
    const r = await get(HEALTH_PATH, { credentials: 'omit', cache: 'no-store' });
    if (r.status !== 200) return null;
    const b: unknown = await r.json();
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return null;
    // Zatvoren oblik kao u ugovoru (additionalProperties: false): nepoznat ključ ili kriva vrijednost je null.
    for (const [k, v] of Object.entries(b)) {
      const ok = k === 'status' ? v === 'ok' : k === 'state' ? v === 'ok' || v === 'degraded'
        : VERSION_KEYS.includes(k) && typeof v === 'string' && VERSION_RE.test(v);
      if (!ok) return null;
    }
    const h = b as Body;
    if (h.status !== 'ok') return null;
    return { state: h.state ?? 'ok', minClientVersion: h.minClientVersion ?? null };
  } catch {
    return null;
  }
}
