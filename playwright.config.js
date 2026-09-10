const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  timeout: 45_000,
  globalTimeout: 5 * 60_000,
  expect: { timeout: 8_000 },
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['./tests/browser/require-executed.js']],
  use: {
    browserName: 'chromium',
    headless: true,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 8_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 }, colorScheme: 'light' } },
    { name: 'narrow', use: { viewport: { width: 390, height: 844 }, colorScheme: 'dark' } },
  ],
});
