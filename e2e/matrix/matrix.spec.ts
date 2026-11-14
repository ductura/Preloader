// Za svaki uređaj iz matrice: pravi prikaz, pravi gumb, ručni izbor nakon ponovnog učitavanja
// i nastavak u webu kad paket nije dostupan. Stranica se poslužuje lokalno; mreže nema.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { REDIRECT_DELAY_MS } from '../../src/client.ts';
import { defaultConfig } from '../../src/config.ts';
import { clientText } from '../../src/text.ts';
import { matrixDevice, type MatrixDevice } from './devices.ts';

const page_html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
/** Odredište weba ili paketa: samo oznaka da je navigacija stigla na pravu putanju. */
const STUB = '<!doctype html><html lang="hr"><title>odredište</title><p>odredište</p></html>';

type Frontend = keyof typeof defaultConfig.frontends;
type Pkg = keyof typeof defaultConfig.downloads;

const frontendFor = (d: MatrixDevice, view: 'desktop' | 'mobile'): Frontend =>
  view === 'mobile' ? 'mobile' : d.desktopFrontend;

let d: MatrixDevice;

test.beforeEach(async ({ page, context }, info) => {
  d = matrixDevice(info.project.name);
  if (d.maxTouchPoints !== undefined) {
    await context.addInitScript((n) => {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n, configurable: true });
    }, d.maxTouchPoints);
  }
  await page.route('https://preloader.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: path === '/' ? page_html : STUB });
  });
  // Lažni sat: preusmjeravanje nakon REDIRECT_DELAY_MS ne smije preteći provjere.
  await page.clock.install();
  await page.goto('/');
});

async function expectState(page: Page, view: 'desktop' | 'mobile', pkg: Pkg | null): Promise<void> {
  const frontend = frontendFor(d, view);
  await expect(page.locator('body')).toHaveAttribute('data-frontend', frontend);
  await expect(page.locator('#open-app')).toBeVisible();
  await expect(page.locator('#open-app')).toHaveAttribute('href', defaultConfig.frontends[frontend]);
  for (const v of ['desktop', 'mobile'] as const) {
    await expect(page.locator(`#choice button[data-view="${v}"]`)).toHaveAttribute('aria-pressed', String(v === view));
  }
  for (const p of ['windows', 'macos'] as const) {
    await expect(page.locator(`#choice button[data-package="${p}"]`)).toHaveAttribute('aria-pressed', String(p === pkg));
  }
  const download = page.locator('#desktop-download');
  if (pkg) {
    await expect(download).toBeVisible();
    await expect(download).toHaveText(clientText.download(pkg));
    await expect(download).toHaveAttribute('href', defaultConfig.downloads[pkg]);
  } else {
    await expect(page.locator('#desktop-offer')).toBeHidden();
  }
}

test('shows the right view and the right button', async ({ page }) => {
  await expectState(page, d.view, d.pkg);
  await expect(page.locator('#choice')).toBeVisible();
  // Uski prozor i mobitel: bez vodoravnog pomicanja.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('manual choice is remembered after a reload', async ({ page }) => {
  const view = d.view === 'desktop' ? 'mobile' : 'desktop';
  const pkg: Pkg = d.pkg === 'windows' ? 'macos' : 'windows';
  await page.locator(`#choice button[data-view="${view}"]`).click();
  await page.locator(`#choice button[data-package="${pkg}"]`).click();
  await expect(page.locator('#choice-status')).toHaveText(clientText.choiceSaved);
  await expectState(page, view, pkg);

  // Klik otkazuje automatsko preusmjeravanje.
  await page.clock.runFor(REDIRECT_DELAY_MS * 2);
  expect(new URL(page.url()).pathname).toBe('/');

  await page.reload();
  await expectState(page, view, pkg);
});

test('opens the web in the right view after the delay', async ({ page }) => {
  await page.clock.runFor(REDIRECT_DELAY_MS);
  await page.waitForURL(`**${defaultConfig.frontends[frontendFor(d, d.view)]}`);
});

test('the web is always offered; without a package it is the way on', async ({ page }) => {
  if (d.pkg === null) await expect(page.locator('#desktop-offer')).toBeHidden();
  const target = defaultConfig.frontends[frontendFor(d, d.view)];
  await page.locator('#open-app').click();
  await page.waitForURL(`**${target}`);
  await expect(page.locator('p')).toHaveText('odredište');
});
