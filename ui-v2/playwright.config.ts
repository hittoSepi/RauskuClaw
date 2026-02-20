import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI
const isLocalLite = !!process.env.PW_LITE

export default defineConfig({
  testDir: './e2e',

  // Lite mode: don't try to be clever, just be stable.
  fullyParallel: isLocalLite ? false : true,

  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : (isLocalLite ? 1 : undefined),

  reporter: isCI ? 'html' : (isLocalLite ? 'line' : 'html'),

  use: {
    baseURL: 'http://localhost:5173',
    trace: isCI ? 'retain-on-failure' : (isLocalLite ? 'off' : 'retain-on-failure'),
    video: isCI ? 'retain-on-failure' : (isLocalLite ? 'off' : 'retain-on-failure'),
    screenshot: isCI ? 'only-on-failure' : (isLocalLite ? 'off' : 'only-on-failure'),
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev -- --strictPort --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})