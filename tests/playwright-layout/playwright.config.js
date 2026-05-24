/**
 * Playwright config for "layout" tests — UI boundary assertions that don't
 * need the .NET app, DB, or Azurite. Loads pages from a tiny static server,
 * stubs all /api/* responses via page.route(), and measures DOM geometry.
 *
 * Catches the kinds of CSS / DOM regressions that jsdom + CSS-text grep tests
 * can't see (e.g., header drawn behind status bar; gap above content; sticky
 * pin point at the wrong y-coordinate; file input not recreated for WKWebView).
 *
 * Does NOT catch WKWebView-specific behavior (file picker delegate binding,
 * contentInset interactions). That's Layer 2 (Maestro on Simulator).
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4123',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'node ' + path.join(__dirname, 'static-server.js'),
    url: 'http://127.0.0.1:4123/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    env: { QUIET: '1' },
  },

  projects: [
    {
      // Mobile WebKit emulates iOS Safari. Note: env(safe-area-inset-*) values
      // are 0 in Playwright (no notch simulation), so tests assert *structural*
      // and *behavioral* invariants, not absolute pixel offsets that depend on
      // a real device's safe-area inset.
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
