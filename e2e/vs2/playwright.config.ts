import { defineConfig } from '@playwright/test';
import { MATRIX } from '../matrix/devices.ts';

export const EDGE_ORIGIN = 'http://localhost:8000';

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/vs2',
  forbidOnly: !!process.env['CI'],
  workers: 1,
  // Prvo otvaranje u hladnom pregledniku i lokalna Next kompilacija na zahtjev.
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: EDGE_ORIGIN, trace: 'retain-on-failure' },
  projects: MATRIX.map((device) => ({
    name: device.name,
    use: { ...device.use, browserName: device.engine },
  })),
});
