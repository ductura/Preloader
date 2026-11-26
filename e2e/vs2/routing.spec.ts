import { expect, test } from '@playwright/test';
import { FIRST_SCREEN_PATH } from '../../deploy/edge/routes.ts';
import { REDIRECT_DELAY_MS } from '../../src/client.ts';
import { text } from '../../src/text.ts';
import { matrixDevice } from '../matrix/devices.ts';
import { prepareFirstScreen } from '../matrix/open.ts';
import { EDGE_ORIGIN } from './playwright.config.ts';

// Karta adresa D-318: preloader sam vodi na ekran prijave aplikacije (`/aplikacija/prijava`), i mobitel dok
// `/mobilna/` ne postoji. Rub ga poslužuje s osnove fronta institucije.
test('automatski vodi na /aplikacija/prijava kroz lokalni edge', async ({ page, context }, info) => {
  const device = matrixDevice(info.project.name);
  await prepareFirstScreen(page, context, device);
  // Karta adresa (D-318): preloader je na `/ulaz`; `/` je naslovnica fronta institucije.
  const home = await page.goto(FIRST_SCREEN_PATH, { waitUntil: 'domcontentloaded' });
  expect(home?.status()).toBe(200);
  expect(home?.headers()['content-security-policy']).toMatch(/script-src 'sha256-/);
  await expect(page.locator('body')).toHaveAttribute('data-frontend', 'web');
  await expect(page.locator('#open-app')).toHaveAttribute('href', '/aplikacija/prijava');
  await expect(page.locator('#sign-in, #sign-in-aai, #sign-in-admin')).toHaveCount(0);

  const arrival = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().isNavigationRequest() && url.origin === EDGE_ORIGIN && url.pathname === '/aplikacija/prijava';
  });
  await page.clock.runFor(REDIRECT_DELAY_MS);
  const response = await arrival;
  // Adresa ostaje /aplikacija/prijava; rub je poslužuje iz fronta institucije bez preusmjeravanja.
  expect(response.status()).toBe(200);
  await page.waitForURL((url) => url.pathname === '/aplikacija/prijava');
  if (info.config.metadata['fixture']) {
    expect(response.headers()['x-vs2-frontend']).toBe('prijava');
    const callbackTarget = await page.request.get('/app/web/', {
      headers: { Referer: `${EDGE_ORIGIN}/api/v1/auth/callback` },
      maxRedirects: 0,
    });
    expect(callbackTarget.status()).toBe(200);
    expect(callbackTarget.headers()['x-vs2-frontend']).toBe('chrome');
  }
});

test('/ poslužuje naslovnicu fronta institucije, adresa ostaje /', async ({ page }, info) => {
  const response = await page.goto('/?izvor=e2e', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  expect(response?.request().redirectedFrom()).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/');
  if (info.config.metadata['fixture']) {
    expect(response?.headers()['x-vs2-frontend']).toBe('naslovnica');
    await expect(page.getByRole('heading', { name: 'naslovnica' })).toBeVisible();
  } else {
    // Pravi front institucije: stranica i njezini resursi dolaze s fronta (`/app/web/_next/`), ne s preloadera.
    const html = (await response?.text()) ?? '';
    expect(html).toContain('/app/web/_next/');
    expect(html).not.toContain('id="sign-in-aai"');
  }
});

test('/ulaz i /aplikacija nisu za tražilice; /aplikacija otvara web aplikaciju bez preusmjeravanja', async ({ page }) => {
  for (const path of ['/ulaz', '/aplikacija/']) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toBe('noindex');
  }
  // Naslovnica i javne stranice smiju u tražilice.
  expect((await page.request.get('/', { maxRedirects: 0 })).headers()['x-robots-tag']).toBeUndefined();
});

test('stare adrese preusmjeravaju na nove (tablica 301, /api/auth 308)', async ({ page }) => {
  const cases = [
    ['/prijava?greska=x', 301, '/app/web/prijava?greska=x'],
    ['/aplikacija/naslovnica', 301, '/'],
    ['/app/web/naslovnica', 301, '/'],
    ['/download/windows', 301, '/preuzimanja/windows'],
    ['/admin/prijava?x=1', 301, '/administracija/prijava?x=1'],
    ['/api/auth/logout', 308, '/api/v1/auth/logout'],
  ] as const;
  for (const [path, status, location] of cases) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect([response.status(), response.headers()['location']], path).toEqual([status, location]);
  }
  // Dok front ne prijeđe na `/aplikacija`, stara adresa aplikacije radi bez preusmjeravanja.
  expect((await page.request.get('/app/web/', { maxRedirects: 0 })).status()).toBe(200);
});

test('nepoznata putanja vraća hrvatsku stranicu greške sa statusom 404', async ({ page }) => {
  const response = await page.goto('/nepoznata-putanja-vs2', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(404);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'none'");
  await expect(page.getByRole('heading', { name: 'Stranica ne postoji' })).toBeVisible();
  await expect(page.getByRole('link', { name: text.home })).toHaveAttribute('href', '/');
});
