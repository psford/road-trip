/**
 * mapUI.test.js
 * Unit tests for MapUI module, specifically sharePhoto and photo-popup haptic functionality.
 * Verifies AC3.3 (Native.share) and photo-popup haptic behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MapUI', () => {
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
            placeName: null,
        };

        photoWithPlaceName = {
            ...photo,
            placeName: 'Empire State Building',
        };

        vi.clearAllMocks();
    });

    describe('sharePhoto method', () => {
        it('delegates to Native.share when available', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };

            await MapUI.sharePhoto(photo.originalUrl, photoWithPlaceName.placeName);

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Empire State Building',
                url: 'https://example.test/api/photos/trip-1/photo-123/original',
            });
        });

        it('falls back to navigator.share when Native is unavailable', async () => {
            globalThis.Native = undefined;
            global.navigator.share = vi.fn().mockResolvedValue(undefined);

            await MapUI.sharePhoto(photo.originalUrl, photoWithPlaceName.placeName);

            expect(global.navigator.share).toHaveBeenCalledWith({
                title: 'Empire State Building',
                url: 'https://example.test/api/photos/trip-1/photo-123/original',
            });

            delete global.navigator.share;
        });

        it('uses RoadTrip.appOrigin() to build the shareable URL', async () => {
            const mockAppOrigin = vi.fn().mockReturnValue('https://custom.app');
            globalThis.RoadTrip = { appOrigin: mockAppOrigin };
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };

            await MapUI.sharePhoto(photo.originalUrl, photo.placeName);

            expect(mockAppOrigin).toHaveBeenCalled();
            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Photo',
                url: 'https://custom.app/api/photos/trip-1/photo-123/original',
            });
        });

        it('handles absolute URLs (starting with http) without prepending origin', async () => {
            globalThis.Native = { share: vi.fn().mockResolvedValue(undefined) };
            const absoluteUrl = 'https://example.com/photo.jpg';

            await MapUI.sharePhoto(absoluteUrl, 'Test');

            expect(globalThis.Native.share).toHaveBeenCalledWith({
                title: 'Test',
                url: 'https://example.com/photo.jpg',
            });
        });
    });

    describe('photo-popup image tap handler', () => {
        it('fires Native.haptic("light") on image tap', () => {
            globalThis.Native = { haptic: vi.fn() };
            globalThis.PhotoCarousel = { showFullscreen: vi.fn() };

            const photo = {
                id: 'photo-456',
                displayUrl: '/api/photos/trip-1/photo-456/display',
                originalUrl: '/api/photos/trip-1/photo-456/original',
                placeName: 'Test Location'
            };

            MapUI._onPhotoPopupImageTap(photo);

            expect(globalThis.Native.haptic).toHaveBeenCalledWith('light');
            expect(globalThis.PhotoCarousel.showFullscreen).toHaveBeenCalledWith(photo);
        });

        it('does not throw when Native is unavailable', () => {
            globalThis.Native = undefined;
            globalThis.PhotoCarousel = { showFullscreen: vi.fn() };

            const photo = {
                id: 'photo-789',
                displayUrl: '/api/photos/trip-1/photo-789/display',
                originalUrl: '/api/photos/trip-1/photo-789/original',
                placeName: 'Another Location'
            };

            expect(() => {
                MapUI._onPhotoPopupImageTap(photo);
            }).not.toThrow();
            expect(globalThis.PhotoCarousel.showFullscreen).toHaveBeenCalledWith(photo);
        });
    });
});
