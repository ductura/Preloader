// Zajedničko otvaranje prvog ekrana za specove matrice: stranicu poslužuje lokalni `next start`
// (`server.ts`), a web, paketi i kontekst klijenta su lažni; mreže nema.
import type { BrowserContext, Page } from '@playwright/test';
import type { MatrixDevice } from './devices.ts';
import { fromPreloader } from './server.ts';

/** Odredište weba ili paketa: samo oznaka da je navigacija stigla na pravu putanju. */
// `<meta charset>`: WebKit u `route.fulfill` ne čita charset iz Content-Type.
const STUB = '<!doctype html><html lang="hr"><meta charset="utf-8"><title>odredište</title><p>odredište</p></html>';

const CLOCK_START = Date.UTC(2026, 0, 1);

export async function openFirstScreen(page: Page, context: BrowserContext, d: MatrixDevice): Promise<void> {
  if (d.maxTouchPoints !== undefined) {
    await context.addInitScript((n) => {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n, configurable: true });
    }, d.maxTouchPoints);
  }
  await page.route('**/*', (route) =>
    fromPreloader(new URL(route.request().url()))
      ? route.continue()
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: STUB }),
  );
  // Lažni sat, zaustavljen prije učitavanja: preusmjeravanje nakon REDIRECT_DELAY_MS ide samo uz `runFor`.
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 1000);
  await page.goto('/');
}
