// Matrica preglednika (P-0.11). Stranica je `dist/index.html` (`pnpm e2e` je prvo izgradi).
import { defineConfig } from '@playwright/test';
import { MATRIX } from './devices.ts';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  outputDir: '../../test-results',
  use: { baseURL: 'https://preloader.test', trace: 'off' },
  projects: MATRIX.map((d) => ({ name: d.name, use: { ...d.use, browserName: d.engine } })),
});
