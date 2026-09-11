import { defineConfig, devices } from '@playwright/test';

const e2eBaseUrl = process.env.APP_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const videoMode = process.env.PLAYWRIGHT_VIDEO === 'off' ? 'off' : 'retain-on-failure';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // Keep the visual/interaction contract deterministic against the local Next dev server.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: videoMode,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: 'node scripts/start-e2e-server.mjs',
    url: `${e2eBaseUrl}/`,
    reuseExistingServer: process.env.REUSE_E2E_SERVER === '1',
    timeout: 600_000,
  },
});
