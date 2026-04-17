/**
 * imageSynthesis.js — Playwright helper for generating large test images
 *
 * Exports functions that can be called inside page.evaluate() to generate
 * Blobs/Files of specific sizes using Canvas. This avoids committing large
 * binary fixtures to the repo.
 *
 * Usage in Playwright:
 *   const { imageSynthesis } = require('./helpers/imageSynthesis');
 *   await imageSynthesis.inject(page);
 *   const fileHandle = await page.evaluateHandle(async () => {
 *       return window.__imageSynthesis.createLargePng(18 * 1024 * 1024);
 *   });
 */

const imageSynthesis = {
    /**
     * Inject the synthesis functions into the page's window scope.
     * Call this once before using the other methods.
     *
     * @param {Page} page - Playwright page object
     */
    async inject(page) {
        await page.evaluate(() => {
            window.__imageSynthesis = {
                /**
                 * Generate a synthetic PNG of approximately the target size in bytes.
                 * Creates a Canvas filled with pseudo-random pixel data to resist compression.
                 *
                 * @param {number} targetBytes - Target size in bytes (e.g., 18 * 1024 * 1024 for 18MB)
                 * @returns {Promise<File>} A File object with PNG data
                 */
                createLargePng(targetBytes) {
                    // Approximate: PNG with random data is ~4 bytes per pixel (RGBA)
                    // Target pixel count = targetBytes / 4, then find square dimensions
                    const pixelCount = Math.ceil(targetBytes / 4);
                    const side = Math.ceil(Math.sqrt(pixelCount));

                    const canvas = document.createElement('canvas');
                    canvas.width = side;
                    canvas.height = side;
                    const ctx = canvas.getContext('2d');

                    // Fill with pseudo-random data to prevent PNG compression from shrinking it
                    const imageData = ctx.createImageData(side, side);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = (i * 7 + 13) & 0xFF;     // R
                        imageData.data[i + 1] = (i * 11 + 29) & 0xFF; // G
                        imageData.data[i + 2] = (i * 3 + 41) & 0xFF;  // B
                        imageData.data[i + 3] = 255;                   // A
                    }
                    ctx.putImageData(imageData, 0, 0);

                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            const file = new File([blob], 'synthetic-large.png', {
                                type: 'image/png',
                            });
                            resolve(file);
                        }, 'image/png');
                    });
                },

                /**
                 * Generate a JPEG of specific pixel dimensions.
                 * Creates a gradient-filled image suitable for testing display/thumb tier generation.
                 *
                 * @param {number} widthPx - Canvas width in pixels
                 * @param {number} heightPx - Canvas height in pixels
                 * @param {number} qualityFraction - JPEG quality as a fraction (0–1)
                 * @returns {Promise<File>} A File object with JPEG data
                 */
                createJpeg(widthPx, heightPx, qualityFraction) {
                    const canvas = document.createElement('canvas');
                    canvas.width = widthPx;
                    canvas.height = heightPx;
                    const ctx = canvas.getContext('2d');

                    // Fill with a gradient to create realistic-ish JPEG content
                    const gradient = ctx.createLinearGradient(0, 0, widthPx, heightPx);
                    gradient.addColorStop(0, '#ff6600');
                    gradient.addColorStop(0.5, '#0066ff');
                    gradient.addColorStop(1, '#00ff66');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, widthPx, heightPx);

                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            const file = new File([blob], 'synthetic.jpg', {
                                type: 'image/jpeg',
                            });
                            resolve(file);
                        }, 'image/jpeg', qualityFraction || 0.95);
                    });
                },
            };
        });
    },
};

module.exports = { imageSynthesis };
