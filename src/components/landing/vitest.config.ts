import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import preloader from '../../../vitest.config.ts';

export default mergeConfig(preloader, defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  test: { include: ['src/components/landing/**/*.test.ts'] },
}));
