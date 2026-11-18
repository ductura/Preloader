// Vizualni test (DAN-1076, docs/PLAN.md §6, red „Vizualni”): prvi ekran i dvije stranice greške iz kataloga
// na 1440, 768 i 400 px u Chromiumu. Stranice poslužuje lažni server iz `page.route`; mreže nema.
// Osnovne snimke nastaju u CI-ju (`ubuntu-24.04`): fontovi su sistemski, pa drugi OS daje druge piksele.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const dist = (file: string): string => readFileSync(new URL(`../../dist/${file}`, import.meta.url), 'utf8');
const PAGES: Readonly<Record<string, string>> = { '/': dist('index.html'), '/greska.html': dist('greska.html') };
const CLOCK_START = Date.UTC(2026, 0, 1);

const SCREENS = [
  { name: 'first-screen', path: '/' },
  { name: 'error-404', path: '/greska.html?status=404' },
  { name: 'error-503', path: '/greska.html?status=503' },
] as const;
const WIDTHS = [1440, 768, 400] as const;

async function open(page: Page, width: number, path: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.route('https://preloader.test/**', (route) => {
    const body = PAGES[new URL(route.request().url()).pathname];
    return body === undefined ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  // Sat stoji prije učitavanja: prvi ekran se ne preusmjerava i ništa ne ovisi o vremenu.
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 1000);
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

// Negativni slučaj prvi: jedan token boje pomaknut za jedan korak mora srušiti usporedbu s osnovnom snimkom.
// Korak se računa iz trenutačne vrijednosti (zadnji bit plave), pa test vrijedi i nakon odobrene promjene boje.
const ONE_STEP = [
  { screen: SCREENS[0], token: '--accent' },
  { screen: SCREENS[1], token: '--sheet' },
  { screen: SCREENS[2], token: '--ground' },
] as const;

for (const { screen, token } of ONE_STEP) {
  test(`${screen.name}: ${token} one step off fails the comparison`, async ({ page }) => {
    // Bez osnovne snimke ili uz `-u` usporedba bi zapisala izmijenjenu stranicu kao osnovnu.
    const baseline = `${screen.name}-1440.png`;
    expect(existsSync(test.info().snapshotPath(baseline, { kind: 'screenshot' })), `baseline ${baseline} exists`).toBe(true);
    expect(['none', 'missing'], 'negatives run without --update-snapshots').toContain(test.info().config.updateSnapshots);
    await open(page, 1440, screen.path);
    const current = await page.evaluate((t) => getComputedStyle(document.documentElement).getPropertyValue(t).trim(), token);
    expect(current, `${token} is a #rrggbb colour`).toMatch(/^#[0-9a-f]{6}$/i);
    const value = `#${(parseInt(current.slice(1), 16) ^ 1).toString(16).padStart(6, '0')}`;
    await page.addStyleTag({ content: `:root { ${token}: ${value}; }` });
    // Samo greška razlike u pikselima: istek vremena ili druga greška nije dokaz.
    let error = '';
    try {
      await expect(page).toHaveScreenshot(baseline, { fullPage: true, timeout: 2000 });
    } catch (e) {
      error = String(e);
    }
    expect(error, `${token} changed by one step still matched the baseline`).toMatch(/\d+ pixels .* are different/);
  });
}

for (const screen of SCREENS) {
  for (const width of WIDTHS) {
    test(`${screen.name} at ${width} px matches the baseline`, async ({ page }) => {
      await open(page, width, screen.path);
      await expect(page).toHaveScreenshot(`${screen.name}-${width}.png`, { fullPage: true });
    });
  }
}
