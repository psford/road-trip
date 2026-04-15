/**
 * Network condition helpers for Playwright e2e tests
 * Simulates real-world network conditions to test resilient upload behavior
 */

/**
 * Apply Slow 3G throttling to page
 * Simulates slow mobile network speeds: ~400 kbps down, 400 kbps up
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<void>}
 */
async function applySlow3G(page) {
    // Set CDP (Chrome DevTools Protocol) network conditions for Slow 3G
    // Based on Chromium's built-in profiles: https://chromedevtools.github.io/devtools-protocol/tot/Network
    await page.context().route('**/*', async (route) => {
        // Simulate latency: 500ms per request
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get the request
        const request = route.request();

        // For PUT requests (block uploads), add artificial delay
        if (request.method() === 'PUT') {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Continue the request
        await route.continue();
    });
}

/**
 * Apply offline conditions to page
 * Network is completely unavailable until disabled
 *
 * @param {Page} page - Playwright page object
 * @param {boolean} offline - True to go offline, false to come back online
 * @returns {Promise<void>}
 */
async function setOffline(page, offline) {
    // Use CDP to set offline mode
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Network.emulateNetworkConditions', {
        offline: offline,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1,
        latency: offline ? 0 : 0
    });
    await cdpSession.detach();
}

/**
 * Apply packet loss simulation to page
 * Randomly drops a percentage of requests by returning 503 Service Unavailable
 *
 * @param {Page} page - Playwright page object
 * @param {Object} options - Options object
 * @param {number} options.ratio - Packet loss ratio (0.0-1.0), e.g., 0.1 for 10% loss
 * @returns {Promise<void>}
 */
async function applyPacketLoss(page, { ratio = 0.1 } = {}) {
    // Route all requests and drop some based on probability
    await page.context().route('**/*', async (route) => {
        const request = route.request();

        // Only apply packet loss to PUT requests (block uploads)
        // This simulates network packet loss more realistically
        if (request.method() === 'PUT' && Math.random() < ratio) {
            // Abort the request to simulate packet loss
            // Alternative: respond with 503 Service Unavailable
            await route.abort('failed');
            return;
        }

        // Continue normally
        await route.continue();
    });
}

/**
 * Clear all network routing rules
 * Restores normal network conditions
 *
 * @param {Page} page - Playwright page object
 * @returns {Promise<void>}
 */
async function clearNetworkConditions(page) {
    // Unroute all handlers
    await page.context().unroute('**/*');
}

/**
 * Helper to wait for all uploads to complete with timeout
 * Polls for completion of telemetry events
 *
 * @param {Page} page - Playwright page object
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<void>}
 */
/**
 * NOTE: This is structural scaffolding. Requires a running server to function.
 * When running against a live server, this polls the progress panel for committed status.
 */
async function waitForUploadsComplete(page, expectedCount, timeoutMs = 60000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        const committedCount = await page.evaluate(() => {
            const rows = document.querySelectorAll('.upload-panel__row[data-status="committed"]');
            return rows.length;
        });
        if (committedCount >= expectedCount) return;
        await page.waitForTimeout(500);
    }
    throw new Error(`Timed out waiting for ${expectedCount} uploads to complete after ${timeoutMs}ms`);
}

// Export all helpers
export {
    applySlow3G,
    setOffline,
    applyPacketLoss,
    clearNetworkConditions,
    waitForUploadsComplete
};
