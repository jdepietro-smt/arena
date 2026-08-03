import { defineConfig, devices } from '@playwright/test'

// Read-only E2E smoke tests against a real running ArenaHub instance —
// unlike the vitest suite, nothing here mocks the API. Never run in CI:
// it hits a real server (production, by default) with real credentials,
// so it's a deliberate, local-only, human-triggered check — see
// e2e/README.md for how to configure and run it.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // shares one login session's lockout budget — see README
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://5.78.236.254:8001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
