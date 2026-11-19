// Matrica preglednika (P-0.11). Stranice poslužuje `next start` iz izgradnje (`pnpm e2e` je prvo izgradi).
import { defineConfig, devices } from '@playwright/test';
import { MATRIX } from './devices.ts';
import { PRELOADER_ORIGIN, PRELOADER_PORT } from './server.ts';

const VISUAL = 'visual.spec.ts';
// Osnovne snimke vrijede samo za Linux iz CI-ja (sistemski fontovi): projekt `visual` je u CI-ju
// (GitHub Actions postavlja CI) ili uz izričit E2E_VISUAL=1, inače bi `pnpm e2e` na Windowsu i macOS-u pao.
const WITH_VISUAL = !!process.env['CI'] || process.env['E2E_VISUAL'] === '1';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]] : 'list',
  outputDir: '../../test-results',
  use: { baseURL: PRELOADER_ORIGIN, trace: 'off' },
  // Bez varijabli usluga (src/rewrites.ts): izvan preloadera ništa ne ide na mrežu.
  webServer: {
    command: `pnpm exec next start -p ${PRELOADER_PORT}`,
    cwd: '../..',
    url: `${PRELOADER_ORIGIN}/greska`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  // Vizualni test (DAN-1076): stroga usporedba, i promjena boje za jedan korak pada.
  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0, animations: 'disabled', caret: 'hide' } },
  projects: [
    ...MATRIX.map((d) => ({ name: d.name, testIgnore: VISUAL, use: { ...d.use, browserName: d.engine } })),
    ...(WITH_VISUAL ? [{ name: 'visual', testMatch: VISUAL, use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }] : []),
  ],
});
