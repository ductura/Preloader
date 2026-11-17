// Zajedničko otvaranje prvog ekrana za specove matrice: stranica se poslužuje lokalno, mreže nema.
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import type { MatrixDevice } from './devices.ts';

const page_html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
/** Odredište weba ili paketa: samo oznaka da je navigacija stigla na pravu putanju. */
// `<meta charset>`: WebKit u `route.fulfill` ne čita charset iz Content-Type; stranica preloadera ga već ima.
const STUB = '<!doctype html><html lang="hr"><meta charset="utf-8"><title>odredište</title><p>odredište</p></html>';

const CLOCK_START = Date.UTC(2026, 0, 1);

export async function openFirstScreen(page: Page, context: BrowserContext, d: MatrixDevice): Promise<void> {
  if (d.maxTouchPoints !== undefined) {
    await context.addInitScript((n) => {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n, configurable: true });
    }, d.maxTouchPoints);
  }
  await page.route('https://preloader.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: path === '/' ? page_html : STUB });
  });
  // Lažni sat, zaustavljen prije učitavanja: preusmjeravanje nakon REDIRECT_DELAY_MS ide samo uz `runFor`.
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 1000);
  await page.goto('/');
}
