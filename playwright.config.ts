import { defineConfig, devices } from '@playwright/test';

// Runs against the production build: pnpm build && pnpm e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:8798' },
  projects: [
    { name: 'laptop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm --filter @nonstop/server exec tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:8798/api/health',
    reuseExistingServer: false,
  },
});
