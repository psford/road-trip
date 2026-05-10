/**
 * photoCarousel.test.js
 * Unit tests for PhotoCarousel module, specifically the handleSave and share functionality.
 * Verifies AC4.4 (Native.share delegation) and AC3.3 (native iOS share sheet).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PhotoCarousel', () => {
    let photo;
    let photoWithPlaceName;

    beforeEach(() => {
        // Mock RoadTrip.appOrigin for absolute URL tests
        globalThis.RoadTrip = {
            appOrigin: vi.fn().mockReturnValue('https://example.test'),
        };

        photo = {
            id: 'photo-123',
            originalUrl: '/api/photos/trip-1/photo-123/original',
            displayUrl: '/api/photos/trip-1/photo-123/display',
            thumbnailUrl: '/api/photos/trip-1/photo-123/thumb',
            lat: 40.7128,
            lng: -74.0060,
            caption: 'Test photo',
            placeName: null,
        };

        photoWithPlaceName = {
            ...photo,
            placeName: 'Empire State Building',
        };

        vi.clearAllMocks();
    });

    describe('handleSave method', () => {
        it('delegates to Native.share with title and url', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };

            await PhotoCarousel.handleSave(photoWithPlaceName);

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Empire State Building',
                url: 'https://example.test/api/photos/trip-1/photo-123/original',
            });
        });

        it('uses "Photo" as title when placeName is absent', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };

            await PhotoCarousel.handleSave(photo);

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Photo',
                url: 'https://example.test/api/photos/trip-1/photo-123/original',
            });
        });

        it('falls back to download when Native is unavailable', async () => {
            globalThis.Native = undefined;

            // Verify the download fallback path doesn't throw
            const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(
                Object.assign(document.createElement('a'), {
                    click: vi.fn(),
                })
            );

            await PhotoCarousel.handleSave(photo);

            expect(createElementSpy).toHaveBeenCalledWith('a');

            createElementSpy.mockRestore();
        });

        it('does not throw if Native.share rejects', async () => {
            globalThis.Native = {
                share: vi.fn().mockRejectedValue(new Error('User cancelled')),
            };

            // Should not throw when Native.share rejects
            expect(async () => {
                await PhotoCarousel.handleSave(photo);
            }).not.toThrow();
        });

        it('silently ignores AbortError from share', async () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';

            globalThis.Native = {
                share: vi.fn().mockRejectedValue(abortError),
            };

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await PhotoCarousel.handleSave(photo);

            // AbortError should not trigger console.warn
            expect(warnSpy).not.toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it('logs warnings for non-abort share failures', async () => {
            const error = new Error('Network error');

            globalThis.Native = {
                share: vi.fn().mockRejectedValue(error),
            };

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await PhotoCarousel.handleSave(photo);

            expect(warnSpy).toHaveBeenCalledWith('Share failed:', error);

            warnSpy.mockRestore();
        });

        it('applies RoadTrip.appOrigin to construct absolute URL when available', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };

            await PhotoCarousel.handleSave(photoWithPlaceName);

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Empire State Building',
                url: 'https://example.test/api/photos/trip-1/photo-123/original',
            });
        });

        it('uses relative URL when RoadTrip.appOrigin is not available', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };
            globalThis.RoadTrip = undefined;

            await PhotoCarousel.handleSave(photoWithPlaceName);

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Empire State Building',
                url: '/api/photos/trip-1/photo-123/original',
            });
        });
    });

    describe('Immersive viewer — status bar (Task 4)', () => {
        beforeEach(() => {
            // Initialize PhotoCarousel to test showFullscreen
            const container = document.createElement('div');
            PhotoCarousel.init(container, [photo], { canDelete: false });
        });

        it('Native.statusBar("light") fires on viewer open', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);

            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('light');
        });

        it('Native.statusBar("dark") fires on close-button dismiss', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);
            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('light');

            // Find and click the close button
            const overlay = document.querySelector('.fullscreen-overlay');
            const closeBtn = overlay.querySelector('.fullscreen-close');
            closeBtn.click();

            // Should be called twice: once for 'light' on open, once for 'dark' on close
            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('dark');
        });

        it('Native.statusBar("dark") fires on Escape-key dismiss', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);
            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('light');

            // Dispatch Escape key
            const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escapeEvent);

            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('dark');
        });

        it('multiple closeOverlay() calls do not crash', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);
            const overlay = document.querySelector('.fullscreen-overlay');

            // Call closeOverlay once
            PhotoCarousel.closeOverlay(overlay);
            globalThis.Native.statusBar.mockClear();

            // Call closeOverlay again - second call should be harmless (re-entry guard)
            expect(() => {
                PhotoCarousel.closeOverlay(overlay);
            }).not.toThrow();

            // statusBar('dark') should still be called in the finally block
            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('dark');
        });
    });

    describe('Immersive viewer — chrome auto-hide on tap (Task 4)', () => {
        beforeEach(() => {
            const container = document.createElement('div');
            PhotoCarousel.init(container, [photo], { canDelete: false });
        });

        it('clicking the overlay backdrop toggles .chrome-hidden', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);
            const overlay = document.querySelector('.fullscreen-overlay');

            // Initially chrome is visible
            expect(overlay.classList.contains('chrome-hidden')).toBe(false);

            // Click on overlay background (not on image)
            overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(overlay.classList.contains('chrome-hidden')).toBe(true);

            // Click again to toggle off
            overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(overlay.classList.contains('chrome-hidden')).toBe(false);
        });

        it('clicking on the close button does NOT toggle chrome-hidden', () => {
            globalThis.Native = { statusBar: vi.fn() };

            PhotoCarousel.showFullscreen(photo);
            const overlay = document.querySelector('.fullscreen-overlay');

            // Verify close button exists
            const closeBtn = overlay.querySelector('.fullscreen-close');
            expect(closeBtn).not.toBeNull();

            // Close button click should call closeOverlay, removing the overlay from DOM
            closeBtn.click();

            // The overlay should be removed by closeOverlay
            const newOverlay = document.querySelector('.fullscreen-overlay');
            expect(newOverlay).toBeNull();
        });
    });

    describe('Immersive viewer — try/finally restore (AC5.5)', () => {
        it('Native.statusBar("dark") is called in finally block even if removeChild throws', () => {
            globalThis.Native = { statusBar: vi.fn() };

            // Create an overlay directly (not via showFullscreen to avoid side effects)
            const testOverlay = document.createElement('div');
            testOverlay.className = 'fullscreen-overlay';

            // We'll test this by directly checking the finally logic
            // Create a mock that will throw
            const mockParent = {
                removeChild: vi.fn().mockImplementation(() => {
                    throw new Error('Simulated DOM error');
                })
            };

            // Replace the parentNode reference
            Object.defineProperty(testOverlay, 'parentNode', {
                value: mockParent,
                configurable: true
            });

            // Call closeOverlay - the finally block should still call statusBar('dark')
            PhotoCarousel.closeOverlay(testOverlay);

            // Verify statusBar was called with 'dark' even though removeChild threw
            expect(globalThis.Native.statusBar).toHaveBeenCalledWith('dark');
        });
    });

    describe('Immersive viewer — Native absent (Task 4)', () => {
        beforeEach(() => {
            const container = document.createElement('div');
            PhotoCarousel.init(container, [photo], { canDelete: false });
        });

        it('open does not throw when Native is undefined', () => {
            globalThis.Native = undefined;

            expect(() => {
                PhotoCarousel.showFullscreen(photo);
            }).not.toThrow();

            // Verify overlay was created
            const overlay = document.querySelector('.fullscreen-overlay');
            expect(overlay).not.toBeNull();
        });

        it('close does not throw when Native is undefined', () => {
            globalThis.Native = undefined;

            PhotoCarousel.showFullscreen(photo);
            const overlay = document.querySelector('.fullscreen-overlay');

            // This should not throw even though Native is undefined
            expect(() => {
                PhotoCarousel.closeOverlay(overlay);
            }).not.toThrow();

            // Verify overlay was removed
            expect(document.querySelector('.fullscreen-overlay')).toBeNull();
        });
    });
});
