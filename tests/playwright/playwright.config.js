/**
 * Playwright configuration for resilient-uploads end-to-end tests
 *
 * Requires:
 * - Docker and docker-compose for Azurite and SQL Server
 * - ASP.NET Core 8.0+ SDK
 * - npm dependencies (see README.md)
 */

const { defineConfig, devices } = require('@playwright/test');

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: {
    command: 'dotnet run --project src/RoadTripMap',
    url: 'http://localhost:5100/api/version',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
