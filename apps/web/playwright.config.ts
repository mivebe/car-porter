import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3101;
const WEB_PORT = 5174;

/**
 * E2E runs against a real server using fixture-backed mock sources (MOCK_SOURCES=1) and an
 * in-memory database, so tests are deterministic and never hit real sites.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /happy-path\.spec\.ts/ },
    // The happy path touches the shared model/year scans, VIN history and tracking list that the
    // focused specs assert exactly, so it runs after them on the same server.
    {
      name: 'happy-path',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /happy-path\.spec\.ts/,
      dependencies: ['chromium'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @car-porter/server start',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DB_FILE: ':memory:', MOCK_SOURCES: '1', LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite',
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { WEB_PORT: String(WEB_PORT), API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
