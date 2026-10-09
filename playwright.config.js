import { defineConfig, devices } from '@playwright/test';

// Browser tests for the site in demo mode (sample data in the browser, no
// Supabase). Run with `npm run test:e2e`; they start their own dev server.
// @playwright/test is pinned to match the Chromium build in Claude's cloud
// sessions; CI installs the matching browser itself.
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Full Chromium in headless mode, not the stripped-down headless shell, which
    // always blocks notifications.
    channel: 'chromium',
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Blank Supabase settings force demo mode, even with a .env.local present.
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});
