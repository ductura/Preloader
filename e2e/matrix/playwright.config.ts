// Matrica preglednika (P-0.11). Stranica je `dist/index.html` (`pnpm e2e` je prvo izgradi).
import { defineConfig, devices } from '@playwright/test';
import { MATRIX } from './devices.ts';

const VISUAL = 'visual.spec.ts';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  outputDir: '../../test-results',
  use: { baseURL: 'https://preloader.test', trace: 'off' },
  // Vizualni test (DAN-1076): stroga usporedba, i promjena boje za jedan korak pada.
  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0, animations: 'disabled', caret: 'hide' } },
  projects: [
    ...MATRIX.map((d) => ({ name: d.name, testIgnore: VISUAL, use: { ...d.use, browserName: d.engine } })),
    { name: 'visual', testMatch: VISUAL, use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
  ],
});
