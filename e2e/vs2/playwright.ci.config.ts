import { defineConfig } from '@playwright/test';
import { PRELOADER_ORIGIN, PRELOADER_PORT } from '../matrix/server.ts';
import vs2, { EDGE_ORIGIN } from './playwright.config.ts';

// CI ovog repoa ima preloader i pravi lokalni edge. Susjedne frontove zamjenjuju HTTP fixturei.
export default defineConfig(vs2, {
  metadata: { fixture: true },
  webServer: [
    {
      command: `pnpm exec next start -p ${PRELOADER_PORT}`,
      cwd: '../..',
      url: `${PRELOADER_ORIGIN}/greska`,
      timeout: 60_000,
    },
    {
      command: 'node e2e/vs2/edge-fixture.mjs',
      cwd: '../..',
      url: `${EDGE_ORIGIN}/greska`,
      timeout: 60_000,
    },
  ],
});
