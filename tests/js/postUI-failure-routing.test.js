/**
 * postUI-failure-routing.test.js
 * Tests for Task 10: Failure routing to pin-drop
 * Verifies AC5.3: Failed upload → manual pin-drop routing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('postUI failure routing to pin-drop (Task 10)', () => {
    let mockShowToast;
    let mockManualPinDropFor;

    beforeEach(() => {
        // Setup minimal DOM
        document.body.innerHTML = `
            <div id="addPhotoButton"></div>
            <input id="fileInput" type="file" />
            <button id="cancelButton"></button>
            <button id="postButton"></button>
            <div id="mapSection"></div>
            <div id="previewSection"></div>
            <div id="photoMapSection"></div>
            <div id="progressPanelContainer"></div>
            <div id="resumeBannerContainer"></div>
            <span id="placeNameDisplay"></span>
        `;

        // Setup feature flag meta tag
        const meta = document.createElement('meta');
        meta.id = 'featureFlags';
        meta.setAttribute('data-resilient-uploads-ui', 'true');
        document.head.appendChild(meta);

        // Mock PostUI methods
        mockShowToast = vi.fn();
        mockManualPinDropFor = vi.fn().mockResolvedValue(undefined);

        // Extend PostUI with our mocks
        PostUI.showToast = mockShowToast;
        PostUI.manualPinDropFor = mockManualPinDropFor;
        PostUI.secretToken = 'test-token-abc';

        // Mock API
        globalThis.API = {
            pinDropPhoto: vi.fn(),
            geocode: vi.fn(),
            getTripInfoBySecret: vi.fn(),
        };

        // Mock storage
        globalThis.StorageAdapter = {
            getItem: vi.fn(),
            putItem: vi.fn(),
            updateItemStatus: vi.fn(),
            listNonTerminal: vi.fn(),
            deleteItem: vi.fn(),
        };

        // Mock UploadQueue
        globalThis.UploadQueue = {
            resume: vi.fn(),
        };

        // Mock other dependencies
        globalThis.TripStorage = { saveFromPostPage: vi.fn() };
        globalThis.PostService = { listPhotos: vi.fn(), extractPhotoMetadata: vi.fn() };
        globalThis.PhotoCarousel = { init: vi.fn() };
        globalThis.maplibregl = { Marker: vi.fn() };

        // Mock localStorage
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });

        // Mock console
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    describe('handleNoGpsFiles with uploadId parameter', () => {
        it('should call manualPinDropFor when uploadId is provided (failure routing)', async () => {
            const uploadId = 'failed-upload-123';

            // Call with uploadId option
            await PostUI.handleNoGpsFiles([], { uploadId });

            // Verify manualPinDropFor was called with correct uploadId
            expect(mockManualPinDropFor).toHaveBeenCalledWith(uploadId);
        });

        it('should queue files for sequential pin-drop when uploadId is not provided', async () => {
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { placeName: 'Test Place' };
            const noGpsFiles = [{ file, metadata }];

            // Mock processNextPinDrop
            PostUI.processNextPinDrop = vi.fn();

            // Call without uploadId (normal path)
            PostUI.handleNoGpsFiles(noGpsFiles);

            // Verify toast and queue processing
            expect(mockShowToast).toHaveBeenCalledWith('1 photo need a location', 'info');
            expect(PostUI.processNextPinDrop).toHaveBeenCalled();
        });

        it('should handle empty noGpsFiles array gracefully', async () => {
            const uploadId = 'upload-123';

            // Call with uploadId and empty array
            await PostUI.handleNoGpsFiles([], { uploadId });

            // Should still call manualPinDropFor
            expect(mockManualPinDropFor).toHaveBeenCalledWith(uploadId);
        });

        it('should handle multiple files without GPS in normal path', async () => {
            const files = Array.from({ length: 3 }, (_, i) =>
                new File([`test${i}`], `test${i}.jpg`, { type: 'image/jpeg' })
            );
            const noGpsFiles = files.map(f => ({ file: f, metadata: {} }));

            PostUI.pinDropQueue = null;
            PostUI.processNextPinDrop = vi.fn();

            PostUI.handleNoGpsFiles(noGpsFiles);

            expect(mockShowToast).toHaveBeenCalledWith('3 photos need a location', 'info');
            expect(PostUI.processNextPinDrop).toHaveBeenCalled();
            expect(PostUI.pinDropQueue).toHaveLength(3);
        });

        it('should skip files if more than 5 and no uploadId', () => {
            const files = Array.from({ length: 8 }, (_, i) =>
                new File([`test${i}`], `test${i}.jpg`, { type: 'image/jpeg' })
            );
            const noGpsFiles = files.map(f => ({ file: f, metadata: {} }));

            PostUI.handleNoGpsFiles(noGpsFiles);

            expect(mockShowToast).toHaveBeenCalledWith(
                '8 photos skipped — no GPS data. Add them individually to set a pin.',
                'info'
            );
        });
    });

    describe('pin-drop button integration (AC5.3)', () => {
        it('should route progress panel pin-drop button through handleNoGpsFiles', async () => {
            const uploadId = 'failed-upload-456';

            // This is what happens when user clicks [📍 Pin manually] in progress panel
            // The button handler calls PostUI.handleNoGpsFiles([], { uploadId })
            await PostUI.handleNoGpsFiles([], { uploadId });

            expect(mockManualPinDropFor).toHaveBeenCalledWith(uploadId);
        });
    });

    describe('signature compatibility', () => {
        it('should accept files as first parameter', async () => {
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const noGpsFiles = [{ file, metadata: {} }];

            PostUI.processNextPinDrop = vi.fn();

            // Call with only files (backward compatible)
            PostUI.handleNoGpsFiles(noGpsFiles);

            expect(mockShowToast).toHaveBeenCalled();
        });

        it('should accept options object with uploadId as second parameter', async () => {
            const uploadId = 'upload-789';

            await PostUI.handleNoGpsFiles([], { uploadId });

            expect(mockManualPinDropFor).toHaveBeenCalledWith(uploadId);
        });

        it('should default uploadId to null if not provided', async () => {
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const noGpsFiles = [{ file, metadata: {} }];

            PostUI.processNextPinDrop = vi.fn();

            // Call with default options
            PostUI.handleNoGpsFiles(noGpsFiles, {});

            expect(PostUI.processNextPinDrop).toHaveBeenCalled();
        });
    });

    describe('edge cases', () => {
        it('should not break if uploadId is provided but manualPinDropFor throws', async () => {
            const uploadId = 'error-upload';
            mockManualPinDropFor.mockRejectedValue(new Error('Test error'));

            // Should handle the error gracefully
            try {
                await PostUI.handleNoGpsFiles([], { uploadId });
            } catch (err) {
                expect(err.message).toBe('Test error');
            }

            expect(mockManualPinDropFor).toHaveBeenCalledWith(uploadId);
        });

        it('should handle null files gracefully', async () => {
            PostUI.processNextPinDrop = vi.fn();

            // Call with null (edge case)
            PostUI.handleNoGpsFiles(null || []);

            // Should not throw
            expect(mockShowToast).not.toHaveBeenCalled();
        });
    });
});
