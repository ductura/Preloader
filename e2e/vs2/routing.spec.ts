import { expect, test } from '@playwright/test';
import { FIRST_SCREEN_PATH } from '../../deploy/edge/routes.ts';
import { REDIRECT_DELAY_MS } from '../../src/client.ts';
import { text } from '../../src/text.ts';
import { matrixDevice } from '../matrix/devices.ts';
import { prepareFirstScreen } from '../matrix/open.ts';
import { EDGE_ORIGIN } from './playwright.config.ts';

const destinations = {
  chrome: { href: '/app/chrome/', path: '/app/chrome' },
  mobile: { href: '/app/mobile/', path: '/app/mobile' },
  other: { href: '/app/web/', path: '/o' },
};

test('automatski otvara odgovarajući frontend kroz lokalni edge', async ({ page, context }, info) => {
  const device = matrixDevice(info.project.name);
  const variant = device.view === 'mobile' ? 'mobile' : device.desktopFrontend;
  const { href, path } = destinations[variant];
  await prepareFirstScreen(page, context, device);
  // Karta adresa (D-318): preloader je na `/ulaz`; `/` je naslovnica fronta institucije.
  const home = await page.goto(FIRST_SCREEN_PATH, { waitUntil: 'domcontentloaded' });
  expect(home?.status()).toBe(200);
  expect(home?.headers()['content-security-policy']).toMatch(/script-src 'sha256-/);
  await expect(page.locator('body')).toHaveAttribute('data-frontend', variant);
  await expect(page.locator('#open-app')).toHaveAttribute('href', href);

  const arrival = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().isNavigationRequest() && response.status() !== 308 &&
      url.origin === EDGE_ORIGIN && url.pathname.replace(/\/$/, '') === path;
  });
  await page.clock.runFor(REDIRECT_DELAY_MS);
  const response = await arrival;

  if (info.config.metadata['fixture']) {
    expect(response.status()).toBe(200);
    expect(response.headers()['x-vs2-frontend']).toBe(variant);
    await expect(page.getByRole('heading', { name: variant })).toBeVisible();
    const callbackTarget = await page.request.get('/app/web/', {
      headers: { Referer: `${EDGE_ORIGIN}/api/v1/auth/callback` },
      maxRedirects: 0,
    });
    expect(callbackTarget.status()).toBe(200);
    expect(callbackTarget.headers()['x-vs2-frontend']).toBe('chrome');
  } else if (variant === 'other') {
    // Svježi kontekst: Web_other šalje neprijavljenog korisnika na vlastitu prijavu.
    expect(response.status()).toBe(307);
    const login = new URL(response.headers()['location'] ?? '', response.url());
    expect(login.origin).toBe(EDGE_ORIGIN);
    expect(login.pathname).toBe('/o/prijava');
  } else {
    expect(response.status()).toBe(200);
    const assets = variant === 'mobile' ? '/app/mobile/_next/' : '/app/web/_next/';
    expect(await response.text()).toContain(assets);
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

test('stare adrese preusmjeravaju na nove (lokalno 307, /api/auth 308)', async ({ page }) => {
  const cases = [
    ['/prijava?greska=x', 307, '/app/web/prijava?greska=x'],
    ['/aplikacija/naslovnica', 307, '/'],
    ['/download/windows', 307, '/preuzimanja/windows'],
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
