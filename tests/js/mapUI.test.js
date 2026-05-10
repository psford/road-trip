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

    describe('MapUI skeleton placeholders during fetch', () => {
        let mapUIInstance;

        beforeEach(() => {
            // Set up DOM
            document.body.innerHTML = `
                <div id="map"></div>
                <div id="viewCarousel"></div>
                <div id="tripName"></div>
                <div id="tripNameLarge"></div>
                <div id="emptyMessage"></div>
            `;

            // Stub MapService
            globalThis.MapService = {
                loadTrip: vi.fn(),
            };

            // Stub PhotoCarousel to avoid rendering errors
            globalThis.PhotoCarousel = {
                init: vi.fn().mockReturnValue({ selectPhoto: vi.fn() }),
            };

            // Stub maplibregl
            globalThis.maplibregl = {
                Map: class MockMap {
                    constructor() {}
                    on() {}
                    jumpTo() {}
                },
                Marker: class MockMarker {
                    constructor() {}
                    setLngLat() { return this; }
                    setPopup() { return this; }
                    addTo() { return this; }
                },
                Popup: class MockPopup {
                    constructor() {}
                    setHTML() { return this; }
                    on() { return this; }
                    getElement() { return null; }
                    isOpen() { return false; }
                },
            };

            // Create MapUI instance
            mapUIInstance = Object.create(MapUI);
            mapUIInstance.map = null;
            mapUIInstance.markers = [];
            mapUIInstance.markerLookup = new Map();
            mapUIInstance.carousel = null;
            mapUIInstance.createPopupHtml = vi.fn().mockReturnValue('<div>popup</div>');
            mapUIInstance.panToFitPopup = vi.fn();
            mapUIInstance.showError = vi.fn();
        });

        it('mapUI.init injects skeletons in #viewCarousel before fetch resolves', async () => {
            // Mock MapService.loadTrip to never resolve (pending)
            const neverResolvePromise = new Promise(() => {});
            MapService.loadTrip.mockReturnValue(neverResolvePromise);

            // Start the fetch (don't await)
            const initPromise = mapUIInstance.init('test-view-token');

            // Give async operations a chance to run
            await new Promise(r => setTimeout(r, 10));

            // Assert skeletons are present
            const container = document.getElementById('viewCarousel');
            const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
            expect(skeletons).toHaveLength(3);

            // Clean up the pending promise (prevent unhandled rejection)
            (async () => { await initPromise; })().catch(() => {});
        });

        it('mapUI.init removes skeletons after fetch resolves', async () => {
            const mockPhotos = [
                { id: 'photo-1', displayUrl: '/api/photos/trip-1/photo-1/display', lng: -98, lat: 39 },
                { id: 'photo-2', displayUrl: '/api/photos/trip-1/photo-2/display', lng: -99, lat: 38 },
            ];
            const mockTrip = { name: 'Test Trip' };
            MapService.loadTrip.mockResolvedValue({ trip: mockTrip, photos: mockPhotos });

            // Call init and await it
            await mapUIInstance.init('test-view-token');

            // Assert skeletons are gone
            const container = document.getElementById('viewCarousel');
            const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
            expect(skeletons).toHaveLength(0);

            // Assert carousel was initialized
            expect(globalThis.PhotoCarousel.init).toHaveBeenCalled();
        });

        it('mapUI.init removes skeletons after fetch rejects', async () => {
            MapService.loadTrip.mockRejectedValue(new Error('Network error'));

            // Call init and let it reject
            await mapUIInstance.init('test-view-token');

            // Assert skeletons are gone
            const container = document.getElementById('viewCarousel');
            const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
            expect(skeletons).toHaveLength(0);

            // Assert error handler was called
            expect(mapUIInstance.showError).toHaveBeenCalled();
        });

        it('mapUI.renderMap removes skeletons when trip has no photos', () => {
            const mockTrip = { name: 'Empty Trip' };
            MapService.loadTrip.mockResolvedValue({ trip: mockTrip, photos: [] });

            // Call renderMap with empty photos
            mapUIInstance.renderMap([]);

            // Assert skeletons are cleared (the new empty-trip fix clears them before returning)
            const container = document.getElementById('viewCarousel');
            const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
            expect(skeletons).toHaveLength(0);

            // Assert empty message was displayed
            const emptyMsg = document.getElementById('emptyMessage');
            expect(emptyMsg.style.display).toBe('block');
        });
    });
});
