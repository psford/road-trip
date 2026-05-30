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

  test('pinned-stack sits at viewport top — no phantom gap', async ({ page }) => {
    await page.goto('/post/layout-test-token-1');
    await applyIosShell(page);

    const pinnedStackTop = await page.evaluate(() => {
      const ps = document.querySelector('.pinned-stack');
      return ps ? ps.getBoundingClientRect().top : null;
    });

    expect(pinnedStackTop, '.pinned-stack element not found').not.toBeNull();
    // .pinned-stack is position: fixed with top: 0px, so it must sit exactly
    // at the viewport top. The pinned-stack contains the page-header inside it,
    // which is offset by padding-top: env(safe-area-inset-top, 0px).
    expect(pinnedStackTop).toBe(0);
  });

  test('.pinned-stack is position: fixed with computed top: 0px', async ({ page }) => {
    await page.goto('/post/layout-test-token-2');
    await applyIosShell(page);

    const computed = await page.evaluate(() => {
      const ps = document.querySelector('.pinned-stack');
      const cs = getComputedStyle(ps);
      return { position: cs.position, top: cs.top };
    });

    expect(computed.position).toBe('fixed');
    // position: fixed with top: 0px means the pinned-stack is locked to the
    // viewport top and never scrolls.
    expect(computed.top).toBe('0px');
  });

  test('pinned-stack remains fixed (rect.top stays at 0) after .scroll-content scroll', async ({ page }) => {
    await page.goto('/post/layout-test-token-3');
    await applyIosShell(page);

    // Force scrollable content so .scroll-content has something to scroll
    // — the photo list is empty in this stub.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      spacer.id = 'layout-test-spacer';
      document.querySelector('.scroll-content').appendChild(spacer);
    });

    const beforeTop = await page.evaluate(() => document.querySelector('.pinned-stack').getBoundingClientRect().top);
    await page.evaluate(() => document.querySelector('.scroll-content').scrollTo(0, 800));
    await page.waitForTimeout(80);
    const afterTop = await page.evaluate(() => document.querySelector('.pinned-stack').getBoundingClientRect().top);

    // .pinned-stack is position: fixed, so rect.top must always be 0 regardless
    // of .scroll-content's scroll position.
    expect(beforeTop).toBe(0);
    expect(afterTop).toBe(0);
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

  test('body has overflow: hidden on post page', async ({ page }) => {
    await page.goto('/post/layout-test-token-overflow');
    await applyIosShell(page);
    const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(overflow).toBe('hidden');
  });

  test('Add Photo button reachable after 800px scroll of .scroll-content', async ({ page }) => {
    await page.goto('/post/layout-test-token-reach');
    await applyIosShell(page);
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.querySelector('.scroll-content').appendChild(spacer);
    });
    await page.evaluate(() => {
      document.querySelector('.scroll-content').scrollTo({ top: 800 });
    });
    await page.waitForTimeout(80);
    // Verify button is visible and within viewport bounds after scroll.
    // Since .pinned-stack is fixed (position: fixed, top: 0), it stays
    // at viewport top regardless of .scroll-content scroll position.
    const buttonVisible = await page.evaluate(() => {
      const btn = document.getElementById('addPhotoButton');
      if (!btn) return false;
      const r = btn.getBoundingClientRect();
      // Button must be within viewport bounds (y between 0 and viewport height)
      return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    });
    expect(buttonVisible).toBe(true);
  });

  test('--pinned-stack-height is set to a px value on load', async ({ page }) => {
    await page.goto('/post/layout-test-token-var');
    await applyIosShell(page);
    await page.waitForFunction(() => {
      const v = document.documentElement.style.getPropertyValue('--pinned-stack-height');
      return /^\d+px$/.test(v);
    }, null, { timeout: 5000 });
  });

  test('.scroll-content padding-top equals --pinned-stack-height', async ({ page }) => {
    await page.goto('/post/layout-test-token-padding');
    await applyIosShell(page);
    await page.waitForFunction(() => /^\d+px$/.test(document.documentElement.style.getPropertyValue('--pinned-stack-height')));
    const equal = await page.evaluate(() => {
      const v = document.documentElement.style.getPropertyValue('--pinned-stack-height');
      const pt = getComputedStyle(document.querySelector('.scroll-content')).paddingTop;
      return v === pt;
    });
    expect(equal).toBe(true);
  });

  test('.scroll-content mask-image is a linear-gradient referencing pinned-stack-height', async ({ page }) => {
    await page.goto('/post/layout-test-token-mask');
    await applyIosShell(page);
    await page.waitForFunction(() => /^\d+px$/.test(document.documentElement.style.getPropertyValue('--pinned-stack-height')));
    const mask = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.scroll-content'));
      return cs.maskImage || cs.webkitMaskImage;
    });
    expect(mask).toMatch(/linear-gradient/);
    // Browser resolves var() before exposing computed style — assert the
    // resolved px value (matching --pinned-stack-height) appears in the gradient.
    const resolved = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pinned-stack-height'));
    expect(mask).toContain(resolved);
  });

  test('banner containers and errorMessage live inside .scroll-content (not .pinned-stack)', async ({ page }) => {
    await page.goto('/post/layout-test-token-banners');
    await applyIosShell(page);
    const placements = await page.evaluate(() => {
      const ids = ['resumeBannerContainer', 'progressPanelContainer', 'errorMessage'];
      return ids.map((id) => {
        const el = document.getElementById(id);
        return {
          id,
          inScroll: !!(el && el.closest('.scroll-content')),
          inPinned: !!(el && el.closest('.pinned-stack')),
        };
      });
    });
    for (const p of placements) {
      expect(p.inScroll, `${p.id} should be in .scroll-content`).toBe(true);
      expect(p.inPinned, `${p.id} should NOT be in .pinned-stack`).toBe(false);
    }
  });

  test('--pinned-stack-height updates when pinned-stack height changes', async ({ page }) => {
    await page.goto('/post/layout-test-token-resize');
    await applyIosShell(page);
    await page.waitForFunction(() => /^\d+px$/.test(document.documentElement.style.getPropertyValue('--pinned-stack-height')));
    const before = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pinned-stack-height'));
    await page.evaluate(() => {
      const tn = document.getElementById('tripName');
      if (tn) tn.textContent = 'A much longer trip name that wraps to multiple lines so the header definitely grows in rendered height';
    });
    // Two animation frames is enough for ResizeObserver to fire and the
    // style write to land.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pinned-stack-height'));
    expect(after).not.toBe(before);
  });

  test('--pinned-stack-height is unchanged when a banner mounts in .scroll-content', async ({ page }) => {
    await page.goto('/post/layout-test-token-banner-mount');
    await applyIosShell(page);
    await page.waitForFunction(() => /^\d+px$/.test(document.documentElement.style.getPropertyValue('--pinned-stack-height')));
    const before = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pinned-stack-height'));
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.id = 'fakeResumeBanner';
      banner.style.height = '120px';
      banner.style.background = 'red';
      document.getElementById('resumeBannerContainer').appendChild(banner);
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = await page.evaluate(() => document.documentElement.style.getPropertyValue('--pinned-stack-height'));
    expect(after).toBe(before);
  });
});

test.describe('iOS shell layout — create page', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('create page pinned-stack sits at viewport top (no phantom gap)', async ({ page }) => {
    await page.goto('/create');
    await applyIosShell(page);

    const pinnedStackTop = await page.evaluate(() => {
      const ps = document.querySelector('.pinned-stack');
      return ps ? ps.getBoundingClientRect().top : null;
    });

    expect(pinnedStackTop, '.pinned-stack element not found on create.html').not.toBeNull();
    expect(pinnedStackTop).toBe(0);
  });

  test('body has overflow: hidden on create page', async ({ page }) => {
    await page.goto('/create');
    await applyIosShell(page);
    const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(overflow).toBe('hidden');
  });
});

test.describe('scroll-fade — plain browser (no platform-ios)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('AC2.2: .pinned-stack uses light --color-bg in light scheme (no platform-ios)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/post/layout-test-token-plain-light');
    // Do NOT call applyIosShell — we want the plain-browser path.
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pinned-stack')).backgroundColor);
    expect(bg).toBe('rgb(250, 249, 247)'); // light --color-bg from styles.css:13
  });

  test('AC2.1: .pinned-stack uses dark --color-bg in dark scheme (no platform-ios)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/post/layout-test-token-plain-dark');
    // Do NOT call applyIosShell — we want the plain-browser path.
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pinned-stack')).backgroundColor);
    expect(bg).toBe('rgb(0, 0, 0)'); // dark --color-bg override from styles.css:82
  });
});

test.describe('scroll-fade — iOS chrome (.platform-ios)', () => {
  test.beforeEach(async ({ page }) => {
    await stubApi(page);
  });

  test('AC5 (iOS chrome): .platform-ios .pinned-stack uses --material-bg-light in light scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/post/layout-test-token-ios-light');
    await applyIosShell(page);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pinned-stack')).backgroundColor);
    expect(bg).toBe('rgba(255, 255, 255, 0.72)'); // --material-bg-light from styles.css:61
  });

  test('AC5 (iOS chrome): .platform-ios .pinned-stack uses --material-bg-dark in dark scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/post/layout-test-token-ios-dark');
    await applyIosShell(page);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pinned-stack')).backgroundColor);
    expect(bg).toBe('rgba(28, 28, 30, 0.72)'); // --material-bg-dark from styles.css:62
  });
});
