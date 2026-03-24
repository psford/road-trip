const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5143';
// Use the existing trip with 2 photos (Maine + NJ)
const SECRET_TOKEN = '0aae6c68-2789-47b9-90a1-0cbc624c3a01';

test.use({ viewport: { width: 375, height: 812 } });

test('popup is fully visible within map on first and subsequent clicks', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);
    await page.waitForSelector('.leaflet-marker-icon');
    await page.waitForTimeout(500);

    const checkPopup = async () => {
        return await page.evaluate(() => {
            const mapEl = document.getElementById('photoMap');
            const popup = document.querySelector('.leaflet-popup');
            if (!mapEl || !popup) return { error: 'missing elements' };
            const mapRect = mapEl.getBoundingClientRect();
            const popupRect = popup.getBoundingClientRect();
            return {
                mapTop: Math.round(mapRect.top),
                mapBottom: Math.round(mapRect.bottom),
                popupTop: Math.round(popupRect.top),
                popupBottom: Math.round(popupRect.bottom),
                fullyVisible: popupRect.top >= mapRect.top - 1 && popupRect.bottom <= mapRect.bottom + 1,
                overflowTop: Math.round(mapRect.top - popupRect.top),
            };
        });
    };

    // Click the first marker
    const markers = page.locator('.leaflet-marker-icon');
    await markers.first().click();
    await page.waitForSelector('.photo-popup');
    await page.waitForTimeout(600);

    const first = await checkPopup();
    console.log('First click:', first);
    expect(first.fullyVisible, `First click: popup overflows by ${first.overflowTop}px`).toBe(true);

    // Close popup by pressing Escape, then click again (cached images)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await markers.first().click();
    await page.waitForSelector('.photo-popup');
    await page.waitForTimeout(600);

    const second = await checkPopup();
    console.log('Second click:', second);
    expect(second.fullyVisible, `Second click: popup overflows by ${second.overflowTop}px`).toBe(true);
});
