/**
 * Layer 1: graphical-boundary tests for UI deploys.
 *
 * Each test loads a page in mobile WebKit, applies the `.platform-ios` class
 * and `/ios.css` (simulating the iOS shell), stubs the /api/* endpoints, and
 * asserts a DOM-geometry or DOM-structure invariant.
 *
 * What these tests catch:
 *   - Header drawn at the wrong y-position (gap above content, header pinned
 *     into the status bar zone, sticky failing to engage)
 *   - File input not replaced by the WKWebView-recreate workaround
 *   - Page-header rule regressed off `position: sticky`
 *
 * What these tests DON'T catch:
 *   - WKWebView-specific behavior (file picker delegate binding, contentInset
 *     interaction). Playwright's mobile WebKit ≠ real WKWebView for these.
 *     That coverage lives in Layer 2 (Maestro on Simulator).
 *   - Absolute pixel positions that depend on a real device's safe-area inset
 *     — Playwright doesn't emulate notch/island, so env(safe-area-inset-top)
 *     evaluates to 0 here. Tests assert structural/behavioral invariants
 *     instead.
 */

const { test, expect } = require('@playwright/test');

/**
 * Apply the iOS shell's runtime CSS hooks: add `platform-ios` class to body
 * and inject /ios.css. Mirrors what `src/bootstrap/loader.js` does on real
 * iOS, but skips the full document-swap dance — these tests are exercising
 * CSS layout, not the bootstrap shell.
 */
async function applyIosShell(page) {
  await page.evaluate(() => {
    document.body.classList.add('platform-ios');
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/ios.css';
      link.setAttribute('data-ios-css', 'true');
      link.onload = resolve;
      link.onerror = resolve;
      document.head.appendChild(link);
    });
  });
  // One frame for the stylesheet to apply.
  await page.waitForTimeout(50);
}

/**
 * Stub /api/* responses so pages don't fail to load on missing backend.
 * Tests focus on layout/DOM, not API behavior.
 */
async function stubApi(page) {
  await page.route('**/api/**', (route) => {
    const reqUrl = route.request().url();
    if (/\/api\/post\/[^/]+\/photos$/.test(reqUrl)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (/\/api\/post\/[^/]+\/info$/.test(reqUrl)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Layout Test Trip', description: '', viewUrl: '/trips/test-view-token' }),
      });
    }
    if (reqUrl.endsWith('/api/version')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: '0.0.0-layout-test' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test.describe('iOS shell layout — post page', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('header sits near the viewport top — no phantom gap', async ({ page }) => {
    await page.goto('/post/layout-test-token-1');
    await applyIosShell(page);

    const headerTop = await page.evaluate(() => {
      const h = document.querySelector('.page-header');
      return h ? h.getBoundingClientRect().top : null;
    });

    expect(headerTop, '.page-header element not found').not.toBeNull();
    // env(safe-area-inset-top) is 0 in Playwright. With our fix the header
    // should sit very close to viewport top. A gap > 30px means something
    // (a phantom env(), an empty element above, a stray padding) regressed.
    expect(headerTop).toBeGreaterThanOrEqual(-1);
    expect(headerTop).toBeLessThan(30);
  });

  test('.page-header is position: sticky with computed top: 0px (env fallback)', async ({ page }) => {
    await page.goto('/post/layout-test-token-2');
    await applyIosShell(page);

    const computed = await page.evaluate(() => {
      const h = document.querySelector('.page-header');
      const cs = getComputedStyle(h);
      return { position: cs.position, top: cs.top };
    });

    expect(computed.position).toBe('sticky');
    // CSS rule is `top: env(safe-area-inset-top, 0px)`. In Playwright (no
    // notch), env() resolves to the 0px fallback. On a real iPhone, env()
    // returns the actual safe-area inset (~59px on iPhone 16 Pro). The
    // structural assertion that env() is REFERENCED lives in
    // tests/js/ios-safe-area.test.js.
    expect(computed.top).toBe('0px');
  });

  test('header remains pinned (rect.top stays at pin point) after scroll', async ({ page }) => {
    await page.goto('/post/layout-test-token-3');
    await applyIosShell(page);

    // Force scrollable content so sticky actually has something to stick
    // against — the photo list is empty in this stub.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      spacer.id = 'layout-test-spacer';
      document.querySelector('.container').appendChild(spacer);
    });

    const beforeTop = await page.evaluate(() => document.querySelector('.page-header').getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(80);
    const afterTop = await page.evaluate(() => document.querySelector('.page-header').getBoundingClientRect().top);

    // Sticky must keep the header in view. rect.top going significantly
    // negative means the header scrolled away (sticky broken).
    expect(beforeTop).toBeGreaterThanOrEqual(-1);
    expect(afterTop).toBeGreaterThanOrEqual(-1);
    expect(afterTop).toBeLessThan(30); // pinned near top, not below it
  });

  test('PostUI.init replaces #fileInput with a freshly-created element (WKWebView workaround)', async ({ page }) => {
    await page.goto('/post/layout-test-token-4');
    await applyIosShell(page);

    // PostUI.init runs via RoadTrip.onPageLoad('post', ...) — in a normal
    // browser, RoadTrip synthesizes app:page-load from DOMContentLoaded. The
    // recreate-for-WKWebView code tags the fresh input with a data attr.
    await page.waitForFunction(
      () => {
        const i = document.getElementById('fileInput');
        return !!(i && i.dataset && i.dataset.iosWkwebviewRecreated === '1');
      },
      null,
      { timeout: 5000 }
    );

    const tagged = await page.evaluate(() => {
      const i = document.getElementById('fileInput');
      return {
        present: !!i,
        marker: i ? i.dataset.iosWkwebviewRecreated : null,
        type: i ? i.type : null,
        id: i ? i.id : null,
      };
    });

    expect(tagged.present).toBe(true);
    expect(tagged.marker).toBe('1');
    expect(tagged.type).toBe('file');
    expect(tagged.id).toBe('fileInput');
  });
});

test.describe('iOS shell layout — create page', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('create page header sits near viewport top (no phantom gap)', async ({ page }) => {
    await page.goto('/create');
    await applyIosShell(page);

    const headerTop = await page.evaluate(() => {
      const h = document.querySelector('.page-header');
      return h ? h.getBoundingClientRect().top : null;
    });

    expect(headerTop, '.page-header element not found on create.html').not.toBeNull();
    expect(headerTop).toBeGreaterThanOrEqual(-1);
    expect(headerTop).toBeLessThan(30);
  });
});
