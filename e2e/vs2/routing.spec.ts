import { expect, test } from '@playwright/test';
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
  const home = await page.goto('/');
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

test('nepoznata putanja vraća hrvatsku stranicu greške sa statusom 404', async ({ page }) => {
  const response = await page.goto('/nepoznata-putanja-vs2');
  expect(response?.status()).toBe(404);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'none'");
  await expect(page.getByRole('heading', { name: 'Stranica ne postoji' })).toBeVisible();
  await expect(page.getByRole('link', { name: text.home })).toHaveAttribute('href', '/');
});
