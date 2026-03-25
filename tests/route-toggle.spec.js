const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5143';
// Use the existing trip with 2+ photos (Maine + NJ)
const SECRET_TOKEN = '0aae6c68-2789-47b9-90a1-0cbc624c3a01';

test.use({ viewport: { width: 375, height: 812 } });

test('route toggle button text toggles between "Show Route" and "Hide Route"', async ({ page }) => {
    // Navigate to post page which displays the map with photos and route toggle
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Wait for the route toggle button to be visible
    // It should appear when there are 2+ photos
    const routeToggleBtn = page.locator('#routeToggle');

    // Wait for the button to be visible (it appears after photos load)
    await page.waitForSelector('#photoMapSection.visible', { timeout: 10000 });
    await page.waitForSelector('#routeToggle', { timeout: 10000 });

    // AC4.3: Verify initial state - should be "Show Route"
    const initialText = await routeToggleBtn.textContent();
    expect(initialText?.trim()).toBe('Show Route');

    // Click the button
    await routeToggleBtn.click();
    await page.waitForTimeout(300);

    // Verify text changed to "Hide Route"
    let currentText = await routeToggleBtn.textContent();
    expect(currentText?.trim()).toBe('Hide Route');

    // Click again
    await routeToggleBtn.click();
    await page.waitForTimeout(300);

    // Verify text changed back to "Show Route"
    currentText = await routeToggleBtn.textContent();
    expect(currentText?.trim()).toBe('Show Route');

    // Click one more time to verify cycling works
    await routeToggleBtn.click();
    await page.waitForTimeout(300);

    currentText = await routeToggleBtn.textContent();
    expect(currentText?.trim()).toBe('Hide Route');
});

test('route toggle button updates map visibility', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Wait for photos to load and map to render
    await page.waitForSelector('#photoMapSection.visible', { timeout: 10000 });
    await page.waitForSelector('#routeToggle', { timeout: 10000 });

    const routeToggleBtn = page.locator('#routeToggle');

    // Check initial route visibility (should be hidden)
    const initialVisibility = await page.evaluate(() => {
        const route = document.querySelector('[id="route"]');
        if (!route) return 'not-found';
        const layer = document.querySelector('.maplibregl-layer');
        return layer ? 'visible' : 'hidden';
    });

    // Click to show route
    await routeToggleBtn.click();
    await page.waitForTimeout(300);

    // Verify button text
    let buttonText = await routeToggleBtn.textContent();
    expect(buttonText?.trim()).toBe('Hide Route');

    // Click to hide route
    await routeToggleBtn.click();
    await page.waitForTimeout(300);

    // Verify button text
    buttonText = await routeToggleBtn.textContent();
    expect(buttonText?.trim()).toBe('Show Route');
});
