// Za svaki uređaj iz matrice: pravi prikaz, pravi gumb, ručni izbor nakon ponovnog učitavanja
// i nastavak u webu kad paket nije dostupan. Stranica se poslužuje lokalno; mreže nema.
import { expect, test, type Page } from '@playwright/test';
import { REDIRECT_DELAY_MS } from '../../src/client.ts';
import { defaultConfig } from '../../src/config.ts';
import { clientText } from '../../src/text.ts';
import { matrixDevice, type MatrixDevice } from './devices.ts';
import { openFirstScreen } from './open.ts';

type Pkg = keyof typeof defaultConfig.downloads;

// Mobilne inačice još nema (D-318): svaki uređaj, i mobitel, ide na web.
const target = defaultConfig.frontends.web;

let d: MatrixDevice;

test.beforeEach(async ({ page, context }, info) => {
  d = matrixDevice(info.project.name);
  await openFirstScreen(page, context, d);
});

async function expectState(page: Page, pkg: Pkg | null): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-frontend', 'web');
  await expect(page.locator('#open-app')).toBeVisible();
  await expect(page.locator('#open-app')).toHaveAttribute('href', target);
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
  await expectState(page, d.pkg);
  await expect(page.locator('#choice')).toBeVisible();
  // Uski prozor i mobitel: bez vodoravnog pomicanja.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('manual choice is remembered after a reload', async ({ page }) => {
  const pkg: Pkg = d.pkg === 'windows' ? 'macos' : 'windows';
  await page.locator(`#choice button[data-package="${pkg}"]`).click();
  await expect(page.locator('#choice-status')).toHaveText(clientText.choiceSaved);
  await expectState(page, pkg);

  // Klik otkazuje automatsko preusmjeravanje.
  await page.clock.runFor(REDIRECT_DELAY_MS * 2);
  expect(new URL(page.url()).pathname).toBe('/');

  // Zapamćen izbor odmah vodi dalje; put za promjenu izbora je `/?izbor` (bez automatskog prijelaza).
  await page.goto('/?izbor');
  await expectState(page, pkg);
  await page.clock.runFor(REDIRECT_DELAY_MS * 2);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a remembered choice opens the web at once, without waiting', async ({ page }) => {
  await page.locator('#choice button[data-package]').first().click();
  await expect(page.locator('#choice-status')).toHaveText(clientText.choiceSaved);
  await page.goto('/');
  await page.waitForURL(`**${target}`);
});

test('first visit shows a polite countdown and "Stay here" stops it', async ({ page }) => {
  await expect(page.locator('#countdown')).toBeVisible();
  await expect(page.locator('#countdown')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('link[rel="prefetch"]')).toHaveCount(1);
  await page.locator('#stay-here').click();
  await expect(page.locator('#countdown')).toHaveText(clientText.stayed);
  await page.clock.runFor(REDIRECT_DELAY_MS * 2);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('opens the web in the right view after the delay', async ({ page }) => {
  await page.clock.runFor(REDIRECT_DELAY_MS);
  await page.waitForURL(`**${target}`);
});

test('the web is always offered; without a package it is the way on', async ({ page }) => {
  if (d.pkg === null) await expect(page.locator('#desktop-offer')).toBeHidden();
  await page.locator('#open-app').click();
  await page.waitForURL(`**${target}`);
  await expect(page.locator('p')).toHaveText('odredište');
});

// Karta adresa D-318: ulaz nema gumbe za prijavu i administraciju.
test('offers no sign-in or administration buttons', async ({ page }) => {
  await expect(page.locator('#sign-in, #sign-in-aai, #sign-in-admin')).toHaveCount(0);
  await expect(page.locator('a[href^="/admin"], a[href^="/api/"]')).toHaveCount(0);
});

test('offers only the views that exist: no view choice while /mobilna/ is missing', async ({ page }) => {
  await expect(page.locator('#choice button[data-view]')).toHaveCount(0);
});
