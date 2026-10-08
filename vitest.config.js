import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// Unit tests (npm test). The browser tests in tests/e2e run with Playwright instead.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/unit/**/*.test.{js,jsx}'],
      environment: 'node',
      setupFiles: ['tests/unit/setup.js'],
    },
  }),
);
