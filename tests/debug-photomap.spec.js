const { test, expect } = require('@playwright/test');

test('photo map initializes POI layer after style loads', async ({ page }) => {
    await page.goto('http://localhost:5143/post/57eee40d-91bd-4764-992e-9308521fafb7');

    // Wait for photo map to have POI source (retries via setTimeout in init)
    await page.waitForFunction(() => {
        return typeof PostUI !== 'undefined' &&
               PostUI.photoMap &&
               PostUI.photoMap.getSource('poi-source');
    }, { timeout: 15000 });

    const state = await page.evaluate(() => {
        const pm = PostUI.photoMap;
        return {
            hasPoiSource: !!pm.getSource('poi-source'),
            hasPoiMarkers: !!pm.getLayer('poi-markers'),
            hasPoiLabels: !!pm.getLayer('poi-labels'),
            styleLoaded: pm.isStyleLoaded(),
        };
    });

    expect(state.hasPoiSource).toBe(true);
    expect(state.hasPoiMarkers).toBe(true);
    expect(state.hasPoiLabels).toBe(true);
});
