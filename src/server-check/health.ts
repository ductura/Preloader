// P-0.4 (samo poziv): jedan GET `platform.health.get` i čitanje odgovora. Ne baca; sve izvan
// oblika iz ugovora znači da server nije dostupan. Stranica ga još ne uključuje (proračun ostaje).
// Test pariteta (test/health-schema-parity.test.ts) dokazuje da prihvaća točno ono što prihvaća shema.
import type { Operations } from '@ductura/contracts';

type Body = Operations['platform.health.get']['success']['body'];
export const HEALTH_PATH = '/api/v1/health';
export type Get = (path: string, init: RequestInit) => Promise<Response>;
/** `null`: server nije dostupan ili odgovor nema oblik iz ugovora. */
export type Health = { state: NonNullable<Body['state']>; minClientVersion: string | null } | null;

/** Stanja koja `checkHealth` prihvaća; test ih koristi i kao probne vrijednosti. */
export const HEALTH_STATES: readonly string[] = ['ok', 'degraded'];
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_KEYS = ['version', 'apiVersion', 'serverVersion', 'minClientVersion'];
/** Ključevi koje `checkHealth` zna; test ih šalje i kao ključeve izvan sheme (uklonjeno polje). */
export const HEALTH_KEYS: readonly string[] = ['status', 'state', ...VERSION_KEYS];

export async function checkHealth(get: Get): Promise<Health> {
  try {
    // Preusmjerenje se ne slijedi (DAN-934-3): zdravlje vrijedi samo za izravan odgovor rute iz ugovora.
    const r = await get(HEALTH_PATH, { credentials: 'omit', cache: 'no-store', redirect: 'manual' });
    // Odgovor nakon praćenog preusmjerenja nije izravan; `opaqueredirect` (status 0) odbija provjera statusa niže.
    if (r.redirected) return null;
    // Ugovor za 200 propisuje application/json; drugi medijski tip nije oblik iz ugovora.
    const type = r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (r.status !== 200 || type !== 'application/json') return null;
    const b: unknown = await r.json();
    // Niz nema ključ `status`, pa ga odbija provjera obveznog polja niže.
    if (typeof b !== 'object' || b === null) return null;
    // Zatvoren oblik kao u ugovoru (additionalProperties: false): nepoznat ključ ili kriva vrijednost je null.
    for (const [k, v] of Object.entries(b)) {
      const ok = k === 'status' ? v === 'ok' : k === 'state' ? typeof v === 'string' && HEALTH_STATES.includes(v)
        : VERSION_KEYS.includes(k) && typeof v === 'string' && VERSION_RE.test(v);
      if (!ok) return null;
    }
    // Vrijednost `status` provjerena je gore; ovdje samo obveznost (required u ugovoru).
    if (!('status' in b)) return null;
    const h = b as Body;
    return { state: h.state ?? 'ok', minClientVersion: h.minClientVersion ?? null };
  } catch {
    return null;
  }
}
