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
});
