// DAN-1550: putanje odredišta u `src/config.ts` slijede jednu tablicu ruta (`deploy/edge/routes.ts`), iz koje
// čitaju i rewriteovi Nexta i lokalni edge. Pada čim se putanja preloadera i tablica razmimoiđu
// (npr. promjena basePatha Web_other ili Institution_web_mobile u tablici bez izmjene konfiguracije).
import { describe, expect, test } from 'vitest';
import { BASES, ENTRY_REWRITES, entryFor, serviceFor, type Service } from '../deploy/edge/routes.ts';
import { defaultConfig } from '../src/config.ts';

/** Usluga za odredište iz konfiguracije, po tablici ulaza (karta adresa D-318) pa po tablici ruta. */
function landsOn(url: string): Service | null {
  const path = url.split('?', 1)[0] ?? '';
  return entryFor(path)?.entry.service ?? serviceFor(path);
}

describe('putanje preloadera i tablica ruta', () => {
  test('preloader vodi na ekran prijave aplikacije, koji rub poslužuje iz fronta institucije', () => {
    expect(defaultConfig.frontends.web).toBe('/aplikacija/prijava');
    expect(landsOn(defaultConfig.frontends.web)).toBe('front');
    expect(entryFor(defaultConfig.frontends.web)?.path).toBe(`${BASES.front}/prijava`);
  });

  test('mobilne inačice nema dok ne postoji /mobilna/: konfiguracija je ne nudi, a tablica je ne poslužuje', () => {
    expect(defaultConfig.frontends.mobile).toBeUndefined();
    expect(ENTRY_REWRITES.some((e) => e.path.startsWith('/mobilna'))).toBe(false);
  });

  test('putanje preuzimanja pripadaju preloaderu, ne usluzi iz tablice', () => {
    for (const url of Object.values(defaultConfig.downloads)) expect(landsOn(url)).toBeNull();
  });

  test('preloader ne nudi prijavu ni administraciju: nijedno odredište nije /admin, /administracija ni /api', () => {
    for (const url of [...Object.values(defaultConfig.frontends), ...Object.values(defaultConfig.downloads)]) {
      expect(url).not.toMatch(/^\/(admin|administracija|api)(\/|$)/);
    }
  });
});
