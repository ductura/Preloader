// DAN-1550: putanje odredišta u `src/config.ts` slijede jednu tablicu ruta (`deploy/edge/routes.ts`), iz koje
// čitaju i rewriteovi Nexta i lokalni edge. Pada čim se putanja preloadera i tablica razmimoiđu
// (npr. promjena basePatha Web_other ili Institution_web_mobile u tablici bez izmjene konfiguracije).
import { describe, expect, test } from 'vitest';
import { EDGE_ONLY_REDIRECT, pathsOf, SERVICES, serviceFor, type Service } from '../deploy/edge/routes.ts';
import { defaultConfig } from '../src/config.ts';

/** Usluga koja mora poslužiti svako odredište iz konfiguracije. */
const EXPECTED = {
  frontends: { chrome: 'front', mobile: 'mobile', other: 'other' },
  signIn: { returnTo: 'front', admin: 'admin' },
} as const satisfies Record<string, Record<string, Service>>;

/** Usluga za odredište; lokalni edge `/app/web/` s početne stranice šalje na Web_other (EDGE_ONLY_REDIRECT). */
function landsOn(url: string, viaFirstScreen: boolean): Service | null {
  const path = url.split('?', 1)[0] ?? '';
  if (viaFirstScreen && EDGE_ONLY_REDIRECT.paths.includes(path)) return serviceFor(EDGE_ONLY_REDIRECT.location);
  return serviceFor(path);
}

describe('putanje preloadera i tablica ruta', () => {
  test.each(Object.entries(EXPECTED.frontends))('sučelje %s: izravno otvara %s, a Vercel i edge ga poslužuju iz tablice', (name, service) => {
    const url = defaultConfig.frontends[name as keyof typeof defaultConfig.frontends];
    // Putanja počinje i završava kosom crtom i nema upita: tablica je uspoređuje doslovno.
    expect(url).toMatch(/^\/[a-z0-9/-]+\/$/);
    expect(landsOn(url, true)).toBe(service);
    // Bez početnog ekrana (Vercel, izravan ulaz): odredište je ili usluga iz tablice ili Chromeov front.
    expect([service, 'front']).toContain(landsOn(url, false));
  });

  test('mobilno i ostalo sučelje otvaraju se pod putanjom usluge koju tablica zna', () => {
    expect(pathsOf('mobile')).toContain(defaultConfig.frontends.mobile.replace(/\/$/, ''));
    expect(pathsOf('other')).toContain(serviceFor(EDGE_ONLY_REDIRECT.location) === 'other' ? EDGE_ONLY_REDIRECT.location.replace(/\/$/, '') : '');
  });

  test.each(Object.entries(EXPECTED.signIn))('prijava %s ide usluzi %s', (name, service) => {
    const url = defaultConfig.signIn[name as keyof typeof defaultConfig.signIn];
    expect(landsOn(url, false)).toBe(service);
  });

  test('putanje preuzimanja pripadaju preloaderu, ne usluzi iz tablice', () => {
    for (const url of Object.values(defaultConfig.downloads)) expect(landsOn(url, false)).toBeNull();
  });

  test('svaka usluga iz tablice ima putanju, a svaka putanja usluge je u konfiguraciji ili je zapisana kao izuzetak', () => {
    const configured = new Set<Service | null>([
      ...Object.values(defaultConfig.frontends).map((u) => landsOn(u, true)),
      ...Object.values(defaultConfig.signIn).map((u) => landsOn(u, false)),
    ]);
    // `api` je ugovor za klijenta (ne poveznica preloadera), pa ga konfiguracija ne mora imati.
    for (const service of Object.keys(SERVICES) as Service[]) {
      if (service === 'api') continue;
      expect(pathsOf(service).length).toBeGreaterThan(0);
      expect(configured.has(service)).toBe(true);
    }
  });
});
