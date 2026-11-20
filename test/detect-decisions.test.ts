import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';
import { parseBudget } from '../scripts/budget.ts';
import { build as buildPage } from './static-build.ts';
import { choosePackage, chooseView, resolvePlatform, signalsFrom, type Signals } from '../src/detect/index.ts';
import { UA } from './user-agents.ts';

const hints = (platform: string, mobile = false) => ({ mobile, platform });

describe('obavezni slučaj: iPadOS u desktop načinu', () => {
  const ipad: Signals = { userAgent: UA.safariIpadDesktop, maxTouchPoints: 5 };
  const mac: Signals = { userAgent: UA.safariMac, maxTouchPoints: 0 };

  test('iPad s Mac UA-om i dodirom: mobilni prikaz, bez macOS paketa', () => {
    expect(resolvePlatform(ipad)).toBe('ios');
    expect(chooseView(ipad)).toBe('mobile');
    expect(choosePackage(ipad)).toBeNull();
  });

  test('Mac s istim UA-om bez dodira zadržava prikaz računala i macOS paket', () => {
    expect(chooseView(mac)).toBe('desktop');
    expect(choosePackage(mac)).toBe('macos');
  });

  test('Mac bez podatka o dodiru (stari preglednik) i dalje dobiva macOS paket', () => {
    expect(choosePackage({ userAgent: UA.safariMac })).toBe('macos');
  });

  test('jedna dodirna točka nije dovoljna za iPad', () => {
    expect(choosePackage({ userAgent: UA.safariMac, maxTouchPoints: 1 })).toBe('macos');
  });
});

describe('matrica prvog vala nakon A1 (prikaz, paket)', () => {
  test.each<[string, Signals, 'desktop' | 'mobile', 'windows' | 'macos' | null]>([
    ['Windows + Chrome (hints)', { userAgent: UA.chromeWindows, hints: hints('Windows'), maxTouchPoints: 0 }, 'desktop', 'windows'],
    ['Windows + Chrome (samo UA)', { userAgent: UA.chromeWindows }, 'desktop', 'windows'],
    ['Windows + Edge', { userAgent: UA.edgeWindows, hints: hints('Windows') }, 'desktop', 'windows'],
    ['Windows + Opera', { userAgent: UA.operaWindows, hints: hints('Windows') }, 'desktop', 'windows'],
    ['Windows + Firefox', { userAgent: UA.firefoxWindows, maxTouchPoints: 0 }, 'desktop', 'windows'],
    ['Windows dodirni laptop', { userAgent: UA.chromeWindows, hints: hints('Windows'), maxTouchPoints: 10 }, 'desktop', 'windows'],
    ['Mac + Chrome (hints)', { userAgent: UA.chromeMac, hints: hints('macOS'), maxTouchPoints: 0 }, 'desktop', 'macos'],
    ['Mac + Safari', { userAgent: UA.safariMac, maxTouchPoints: 0 }, 'desktop', 'macos'],
    ['Mac + Firefox', { userAgent: UA.firefoxMac, maxTouchPoints: 0 }, 'desktop', 'macos'],
    ['iPhone + Safari', { userAgent: UA.safariIphone, maxTouchPoints: 5 }, 'mobile', null],
    ['iPad u mobilnom UA-u', { userAgent: UA.safariIpad, maxTouchPoints: 5 }, 'mobile', null],
    ['Android + Chrome (hints)', { userAgent: UA.chromeAndroid, hints: hints('Android', true), maxTouchPoints: 5 }, 'mobile', null],
    ['Android + Chrome (samo UA)', { userAgent: UA.chromeAndroid }, 'mobile', null],
    ['Android tablet (hints mobile: false)', { userAgent: UA.chromeAndroidTablet, hints: hints('Android') }, 'mobile', null],
    ['Android + Firefox', { userAgent: UA.firefoxAndroid, maxTouchPoints: 5 }, 'mobile', null],
    ['Linux + Firefox: ručni izbor paketa', { userAgent: UA.firefoxLinux, maxTouchPoints: 0 }, 'desktop', null],
    ['ChromeOS', { userAgent: UA.chromeAndroidDesktopSite, hints: hints('Chrome OS') }, 'desktop', null],
    ['nepoznato', { userAgent: '' }, 'desktop', null],
  ])('%s', (_name, s, view, pkg) => {
    expect(chooseView(s)).toBe(view);
    expect(choosePackage(s)).toBe(pkg);
  });
});

describe('client hints su prije UA-a', () => {
  test('Android u „verziji za računala” (UA Linux): hints pobjeđuju, mobilno bez paketa', () => {
    const s = { userAgent: UA.chromeAndroidDesktopSite, hints: hints('Android') };
    expect(chooseView(s)).toBe('mobile');
    expect(choosePackage(s)).toBeNull();
  });

  test('UA kaže Mac, hints kažu Windows: Windows paket', () => {
    expect(choosePackage({ userAgent: UA.chromeMac, hints: hints('Windows') })).toBe('windows');
  });

  test('hints mobile: true bez poznatog sustava daju mobilni prikaz', () => {
    expect(chooseView({ userAgent: UA.chromeWindows, hints: hints('', true) })).toBe('mobile');
  });

  test('nepoznata platforma u hintsima pada na UA, a ne na nepoznat sustav', () => {
    expect(choosePackage({ userAgent: UA.chromeWindows, hints: hints('Unknown') })).toBe('windows');
  });

  test('mogućnosti su prije UA-a i kad hints kažu macOS', () => {
    expect(choosePackage({ userAgent: UA.chromeMac, hints: hints('macOS'), maxTouchPoints: 5 })).toBeNull();
  });
});

describe('signalsFrom propušta samo dopuštena polja', () => {
  test('ispravan navigator', () => {
    const nav = {
      userAgent: UA.chromeWindows,
      maxTouchPoints: 0,
      userAgentData: { mobile: false, platform: 'Windows', brands: [{ brand: 'Chromium', version: '131' }] },
      language: 'hr',
    };
    expect(signalsFrom(nav)).toEqual({ userAgent: UA.chromeWindows, hints: { mobile: false, platform: 'Windows' }, maxTouchPoints: 0 });
  });

  test.each([
    ['bez userAgentData', undefined],
    ['null', null],
    ['krivi tipovi', { mobile: 'no', platform: 1 }],
    ['nepotpuno', { platform: 'Windows' }],
  ])('neispravni hints (%s) se zanemaruju', (_name, userAgentData) => {
    expect(signalsFrom({ userAgent: UA.safariMac, userAgentData }).hints).toBeUndefined();
  });

  test.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('neispravan maxTouchPoints %s se zanemaruje', (touch) => {
    expect(signalsFrom({ userAgent: UA.safariMac, maxTouchPoints: touch }).maxTouchPoints).toBeUndefined();
  });

  test('iPad iz stvarnog oblika navigatora dobiva mobilni prikaz', () => {
    const s = signalsFrom({ userAgent: UA.safariIpadDesktop, maxTouchPoints: 5 });
    expect([chooseView(s), choosePackage(s)]).toEqual(['mobile', null]);
  });
});

test('svaka kombinacija signala daje jedan prikaz i najviše jedan paket; mobilno nikad nema paket', () => {
  const platforms = ['', 'Unknown', 'Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Chrome OS'];
  for (const userAgent of [...Object.values(UA), '']) {
    for (const h of [undefined, ...platforms.flatMap((p) => [hints(p), hints(p, true)])]) {
      for (const maxTouchPoints of [undefined, 0, 1, 5]) {
        const s: Signals = { userAgent, hints: h, maxTouchPoints };
        const view = chooseView(s);
        const pkg = choosePackage(s);
        expect(['desktop', 'mobile']).toContain(view);
        expect([null, 'windows', 'macos']).toContain(pkg);
        if (view === 'mobile') expect(pkg).toBeNull();
      }
    }
  }
});

test('odluke stanu u ostatak proračuna veličine iz P-0.1', async () => {
  const out = await build({
    entryPoints: ['src/detect/index.ts'], bundle: true, minify: true, format: 'iife',
    globalName: 'd', target: 'es2020', write: false, legalComments: 'none',
  });
  const decisions = gzipSync(out.outputFiles[0]?.text ?? '', { level: 9 }).length;
  const dir = mkdtempSync(join(tmpdir(), 'dist-'));
  await buildPage(dir);
  const page = gzipSync(readFileSync(join(dir, 'index.html')), { level: 9 }).length;
  rmSync(dir, { recursive: true, force: true });
  const budget = parseBudget(readFileSync('budget.json', 'utf8'));
  expect(decisions).toBeLessThan(1024);
  // Od P-0.3 stranica sama ugrađuje odluke, pa se mjeri izgrađena stranica, ne zbroj.
  expect(page).toBeLessThanOrEqual(budget.total);
});
