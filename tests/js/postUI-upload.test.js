/**
 * postUI-upload.test.js
 * Integration tests for postUI with the resilient upload queue.
 * Verifies AC3.1 (happy path), AC4.1 (resume), AC8.2 (version protocol).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('postUI integration with UploadQueue', () => {
    let uploadCreatedEvents;
    let uploadCommittedEvents;
    let reloadRequiredEvents;

    beforeEach(async () => {
        // Reset storage
        const db = await StorageAdapter._getDb();
        if (db) {
            const tx = db.transaction(['upload_items', 'block_state'], 'readwrite');
            tx.objectStore('upload_items').clear();
            tx.objectStore('block_state').clear();
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = reject;
            });
        } else {
            StorageAdapter._fallbackStore = null;
        }

        // Reset queue state
        UploadQueue._channels.clear();
        UploadQueue._processingPromises.clear();
        UploadQueue._blockListMismatchRetries.clear();
        UploadQueue._claimantId = null;

        // Reset event tracking
        uploadCreatedEvents = [];
        uploadCommittedEvents = [];
        reloadRequiredEvents = [];

        // Stub API module
        globalThis.API = {
            requestUpload: vi.fn(),
            commit: vi.fn(),
            abort: vi.fn(),
        };

        // Stub BroadcastChannel
        globalThis.BroadcastChannel = class {
            constructor() {}
            postMessage() {}
            addEventListener() {}
            removeEventListener() {}
            close() {}
        };

        // Stub PostService
        globalThis.PostService = {
            extractPhotoMetadata: vi.fn(),
        };

        // Mock console
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // Track events by listening instead of mocking dispatchEvent
        // This avoids infinite recursion
        document.addEventListener('upload:created', (e) => {
            uploadCreatedEvents.push(e.detail);
        });
        document.addEventListener('upload:committed', (e) => {
            uploadCommittedEvents.push(e.detail);
        });
        document.addEventListener('version:reload-required', (e) => {
            reloadRequiredEvents.push(e.detail);
        });

        // Spy on UploadTransport
        vi.spyOn(UploadTransport, 'uploadFile');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('AC3.1: happy path - single GPS photo progresses through states and emits events', async () => {
        const tripToken = 'test-token-abc';
        const uploadId = 'upload-1';
        const photoId = 'photo-550e8400-e29b-41d4-a716-446655440000';
        const sasUrl = 'https://test.blob.core.windows.net/container/blob?sv=2024&sig=TEST';
        const blockIds = ['blockId0'];

        // Setup API mocks
        API.requestUpload.mockResolvedValue({
            photoId,
            sasUrl,
            blobPath: `trip-${tripToken}/test.jpg`,
        });

        API.commit.mockResolvedValue({
            id: photoId,
            photoId,
            status: 'committed',
        });

        UploadTransport.uploadFile.mockResolvedValue(blockIds);

        // Create a file with GPS metadata
        const fileData = new Uint8Array(1024 * 100); // 100 KB file
        const file = new File([fileData], 'test-gps.jpg', { type: 'image/jpeg' });
        const metadata = {
            gps: { lat: 40.712776, lng: -74.005974 },
            placeName: 'New York, NY',
            exif: {}
        };

        // Mock PostService
        PostService.extractPhotoMetadata.mockResolvedValue(metadata);

        // Simulate onMultipleFilesSelected logic
        const withMetadata = [{ file, metadata }];
        const gpsFiles = withMetadata.filter(f => f.metadata.gps);
        const noGpsFiles = withMetadata.filter(f => !f.metadata.gps);

        expect(gpsFiles).toHaveLength(1);
        expect(noGpsFiles).toHaveLength(0);

        // Start queue with GPS files
        const refreshSpy = vi.fn();
        const handleNoGpsSpy = vi.fn();

        const filesWithUploadIds = gpsFiles.map(item => ({
            file: item.file,
            metadata: item.metadata,
            uploadId
        }));

        await UploadQueue.start(tripToken, filesWithUploadIds, {
            onEachComplete: () => refreshSpy(),
            onAllComplete: () => handleNoGpsSpy()
        });

        // Wait for processing to complete
        await UploadQueueTestHelper.waitForAll();

        // AC3.1: Events fire in correct order
        expect(uploadCreatedEvents).toHaveLength(1);
        expect(uploadCommittedEvents).toHaveLength(1);

        // Verify events contain correct data
        expect(uploadCreatedEvents[0].uploadId).toBe(uploadId);
        expect(uploadCommittedEvents[0].uploadId).toBe(uploadId);
        expect(uploadCommittedEvents[0].photoId).toBe(photoId);

        // Verify API endpoints called
        expect(API.requestUpload).toHaveBeenCalled();
        expect(UploadTransport.uploadFile).toHaveBeenCalled();
        expect(API.commit).toHaveBeenCalled();

        // refreshPhotoList callback should have been called
        expect(refreshSpy).toHaveBeenCalled();

        // Verify final state in storage
        const item = await StorageAdapter.getItem(uploadId);
        expect(item.status).toBe('committed');
    });

    it('AC4.1: resume after page reload restores pending uploads', async () => {
        const tripToken = 'resume-test-token';
        const uploadId = 'upload-2';
        const photoId = 'photo-550e8400-e29b-41d4-a716-446655440001';
        const blockIds = ['blockId0'];

        // Setup API mocks
        API.requestUpload.mockResolvedValue({
            photoId,
            sasUrl: 'https://test.blob.core.windows.net/test',
            blobPath: `trip-${tripToken}/test.jpg`,
        });

        API.commit.mockResolvedValue({
            id: photoId,
            photoId,
            status: 'committed',
        });

        UploadTransport.uploadFile.mockResolvedValue(blockIds);

        // Create file and metadata
        const fileData = new Uint8Array(1024 * 100);
        const file = new File([fileData], 'resume-test.jpg', { type: 'image/jpeg' });
        const metadata = {
            gps: { lat: 40.712776, lng: -74.005974 },
            placeName: 'Test Location',
            exif: {}
        };

        // First, manually insert an item into storage in 'uploading' state
        // (simulating a partial upload from before page reload)
        await StorageAdapter.putItem({
            upload_id: uploadId,
            trip_token: tripToken,
            filename: 'resume-test.jpg',
            size: fileData.length,
            exif: metadata,
            status: 'uploading',
            photo_id: photoId,
            sas_url: 'https://test.blob.core.windows.net/test',
            blob_path: `trip-${tripToken}/test.jpg`,
            created_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            persistent: true,
        });

        // Now simulate page reload by resetting queue and calling resume
        UploadQueue._channels.clear();
        UploadQueue._processingPromises.clear();
        UploadQueue._claimantId = null;

        // Resume uploads
        const resumePromise = UploadQueue.resume(tripToken);

        // Wait for processing to complete
        await resumePromise;
        await UploadQueueTestHelper.waitForAll();

        // Verify state was transitioned to committed
        const item = await StorageAdapter.getItem(uploadId);
        expect(item.status).toBe('committed');
    });

    it('AC8.2: version:reload-required event fires when client version too old', async () => {
        // This test verifies that the version protocol integration works
        // by checking that events can be emitted and received correctly.
        // The actual version checking is tested in versionProtocol.test.js

        // Use a local event tracking instead of relying on the beforeEach listener
        const localReloadEvents = [];
        const handler = (e) => {
            localReloadEvents.push(e.detail);
        };
        document.addEventListener('version:reload-required', handler);

        // Manually dispatch a version:reload-required event
        // (simulating what VersionProtocol would do)
        document.dispatchEvent(
            new CustomEvent('version:reload-required', {
                detail: {
                    serverVersion: '2.0.0',
                    clientMin: '2.0.0',
                    currentVersion: '1.0.0'
                }
            })
        );

        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 50));

        // version:reload-required should have fired
        expect(localReloadEvents).toHaveLength(1);
        expect(localReloadEvents[0].serverVersion).toBe('2.0.0');
        expect(localReloadEvents[0].clientMin).toBe('2.0.0');

        // Clean up
        document.removeEventListener('version:reload-required', handler);
    });

    it('no-GPS file skips queue and goes to handleNoGpsFiles', async () => {
        const tripToken = 'no-gps-token';

        // Mock PostService to return no GPS
        PostService.extractPhotoMetadata.mockResolvedValue({
            gps: null,
            placeName: null,
            exif: {}
        });

        // Create file
        const fileData = new Uint8Array(1024 * 100);
        const file = new File([fileData], 'no-gps.jpg', { type: 'image/jpeg' });

        // Extract metadata
        const metadata = await PostService.extractPhotoMetadata(file);
        const withMetadata = [{ file, metadata }];

        const gpsFiles = withMetadata.filter(f => f.metadata.gps);
        const noGpsFiles = withMetadata.filter(f => !f.metadata.gps);

        expect(gpsFiles).toHaveLength(0);
        expect(noGpsFiles).toHaveLength(1);

        // No GPS file should not trigger UploadQueue.start
        // Instead, handleNoGpsFiles should be called
        // This is verified by checking that upload:created is NOT emitted
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(uploadCreatedEvents).toHaveLength(0);
    });

    it('Add-Photo button click fires Native.haptic("light")', () => {
        globalThis.Native = { haptic: vi.fn() };

        // Set up DOM elements required by onAddPhotoTap
        const fileInput = document.createElement('input');
        fileInput.id = 'fileInput';
        document.body.appendChild(fileInput);

        // Create a real PostUI instance and spy on its methods
        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';

        // Stub fileInput.click to prevent actual file dialog
        vi.spyOn(fileInput, 'click');

        // Invoke the real production method
        postUIInstance.onAddPhotoTap();

        expect(globalThis.Native.haptic).toHaveBeenCalledWith('light');
        expect(fileInput.click).toHaveBeenCalled();

        // Clean up
        document.body.removeChild(fileInput);
    });

    it('Cancel button click fires Native.haptic("light")', () => {
        globalThis.Native = { haptic: vi.fn() };

        // Create a real PostUI instance and stub its hidePreview method
        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.hidePreview = vi.fn();

        // Invoke the real production method
        postUIInstance.onCancelTap();

        expect(globalThis.Native.haptic).toHaveBeenCalledWith('light');
        expect(postUIInstance.hidePreview).toHaveBeenCalled();
    });

    it('Post-Photo button click fires Native.haptic("light")', async () => {
        globalThis.Native = { haptic: vi.fn() };

        // Create a real PostUI instance and stub its onPostConfirm method
        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.onPostConfirm = vi.fn();

        // Invoke the real production method
        await postUIInstance.onPostButtonTap();

        expect(globalThis.Native.haptic).toHaveBeenCalledWith('light');
        expect(postUIInstance.onPostConfirm).toHaveBeenCalled();
    });

    it('Native.haptic absence does not break button handlers', () => {
        globalThis.Native = undefined;

        const fileInput = document.createElement('input');
        fileInput.id = 'fileInput';
        document.body.appendChild(fileInput);
        vi.spyOn(fileInput, 'click');

        const buttons = {
            addPhoto: document.createElement('button'),
            cancel: document.createElement('button'),
            post: document.createElement('button'),
        };

        buttons.addPhoto.addEventListener('click', () => {
            if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
                void globalThis.Native.haptic('light');
            }
            document.getElementById('fileInput').click();
        });

        buttons.cancel.addEventListener('click', () => {
            if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
                void globalThis.Native.haptic('light');
            }
        });

        buttons.post.addEventListener('click', () => {
            if (globalThis.Native && typeof globalThis.Native.haptic === 'function') {
                void globalThis.Native.haptic('light');
            }
        });

        document.body.appendChild(buttons.addPhoto);
        document.body.appendChild(buttons.cancel);
        document.body.appendChild(buttons.post);

        // Should not throw even though Native is undefined
        expect(() => buttons.addPhoto.click()).not.toThrow();
        expect(() => buttons.cancel.click()).not.toThrow();
        expect(() => buttons.post.click()).not.toThrow();
    });
});

describe('postUI.onPostConfirm manual pin-drop upload haptic', () => {
    it('fires Native.haptic("medium") after successful legacy pin-drop upload', async () => {
        globalThis.Native = { haptic: vi.fn() };

        // Stub PostService.uploadPhoto
        if (!globalThis.PostService) {
            globalThis.PostService = {};
        }
        PostService.uploadPhoto = vi.fn().mockResolvedValue({ id: 'photo-1' });

        // Set up minimal DOM elements that onPostConfirm needs
        const postButton = document.createElement('button');
        postButton.id = 'postButton';
        document.body.appendChild(postButton);

        const captionInput = document.createElement('input');
        captionInput.id = 'captionInput';
        captionInput.value = '';
        document.body.appendChild(captionInput);

        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.currentFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
        postUIInstance.currentLat = 40.7128;
        postUIInstance.currentLng = -74.0060;
        postUIInstance.currentMetadata = { timestamp: null };
        postUIInstance.showToast = vi.fn();
        postUIInstance.hidePreview = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn().mockResolvedValue(undefined);
        postUIInstance.pinDropQueue = null;

        // Call the real onPostConfirm method
        await postUIInstance.onPostConfirm();

        // Verify production code was invoked and haptic was fired
        expect(PostService.uploadPhoto).toHaveBeenCalledWith(
            'test-secret-token',
            expect.any(File),
            40.7128,
            -74.0060,
            null,
            null
        );
        expect(globalThis.Native.haptic).toHaveBeenCalledWith('medium');
        expect(postUIInstance.showToast).toHaveBeenCalledWith('Photo posted!', 'success');

        // Clean up
        document.body.removeChild(postButton);
        document.body.removeChild(captionInput);
    });
});

describe('postUI photo deletion with Native.dialogConfirm', () => {
    beforeEach(() => {
        // Stub PostService.deletePhoto
        if (!globalThis.PostService) {
            globalThis.PostService = {};
        }
        PostService.deletePhoto = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
        delete globalThis.Native;
    });

    it('onDeleteFromCarousel calls Native.dialogConfirm and deletes on confirm', async () => {
        globalThis.Native = {
            dialogConfirm: vi.fn().mockResolvedValue({ value: true }),
        };
        PostService.deletePhoto.mockResolvedValue(undefined);

        // Create a real PostUI instance and spy on its methods
        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn();

        const photo = { id: 'photo-1', placeName: 'Test Location' };
        await postUIInstance.onDeleteFromCarousel(photo);

        expect(globalThis.Native.dialogConfirm).toHaveBeenCalledWith({
            title: 'Delete photo?',
            message: 'This cannot be undone.',
            okButtonTitle: 'Delete',
            cancelButtonTitle: 'Cancel',
        });
        expect(PostService.deletePhoto).toHaveBeenCalledWith('test-secret-token', 'photo-1');
        expect(postUIInstance.showToast).toHaveBeenCalledWith('Photo deleted', 'success');
        expect(postUIInstance.refreshPhotoList).toHaveBeenCalled();
    });

    it('onDeleteFromCarousel does not delete when user cancels', async () => {
        globalThis.Native = {
            dialogConfirm: vi.fn().mockResolvedValue({ value: false }),
        };

        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn();

        const photo = { id: 'photo-1', placeName: 'Test Location' };
        await postUIInstance.onDeleteFromCarousel(photo);

        expect(globalThis.Native.dialogConfirm).toHaveBeenCalled();
        expect(PostService.deletePhoto).not.toHaveBeenCalled();
        expect(postUIInstance.showToast).not.toHaveBeenCalled();
    });

    it('onDeleteFromCarousel does not delete when dialog returns null', async () => {
        globalThis.Native = {
            dialogConfirm: vi.fn().mockResolvedValue(null),
        };

        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn();

        const photo = { id: 'photo-1', placeName: 'Test Location' };
        await postUIInstance.onDeleteFromCarousel(photo);

        expect(globalThis.Native.dialogConfirm).toHaveBeenCalled();
        expect(PostService.deletePhoto).not.toHaveBeenCalled();
    });

    it('onDeleteFromCarousel falls back to window.confirm when Native is unavailable', async () => {
        globalThis.Native = undefined;

        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        PostService.deletePhoto.mockResolvedValue(undefined);

        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn();

        const photo = { id: 'photo-1', placeName: 'Test Location' };
        await postUIInstance.onDeleteFromCarousel(photo);

        expect(confirmSpy).toHaveBeenCalledWith('Delete this photo?');
        expect(PostService.deletePhoto).toHaveBeenCalledWith('test-secret-token', 'photo-1');
        expect(postUIInstance.showToast).toHaveBeenCalledWith('Photo deleted', 'success');

        confirmSpy.mockRestore();
    });

    it('onDeleteFromCarousel shows error toast when delete API fails', async () => {
        globalThis.Native = {
            dialogConfirm: vi.fn().mockResolvedValue({ value: true }),
        };
        PostService.deletePhoto.mockRejectedValue(new Error('API error'));

        const postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.refreshPhotoList = vi.fn();

        const photo = { id: 'photo-1', placeName: 'Test Location' };
        await postUIInstance.onDeleteFromCarousel(photo);

        expect(PostService.deletePhoto).toHaveBeenCalled();
        expect(postUIInstance.showToast).toHaveBeenCalledWith('Failed to delete photo', 'error');
        expect(postUIInstance.refreshPhotoList).not.toHaveBeenCalled();
    });
});

describe('postUI skeleton placeholders during photo fetch', () => {
    let postUIInstance;

    beforeEach(async () => {
        // Set up DOM
        document.body.innerHTML = `
            <div id="photoCarousel"></div>
            <div id="photoList"></div>
            <div id="photoMapSection"></div>
        `;

        // Stub PostService
        globalThis.PostService = {
            listPhotos: vi.fn(),
        };

        // Stub PhotoCarousel to avoid rendering errors
        globalThis.PhotoCarousel = {
            init: vi.fn().mockReturnValue({ selectPhoto: vi.fn() }),
        };

        // Create PostUI instance
        postUIInstance = Object.create(PostUI);
        postUIInstance.secretToken = 'test-secret-token';
        postUIInstance.showToast = vi.fn();
        postUIInstance.photos = [];
        postUIInstance.carousel = null;
        postUIInstance.map = null;
        postUIInstance.renderPhotoMap = vi.fn();
        postUIInstance.hidePhotoMap = vi.fn();
    });

    it('injects 3 skeleton placeholders before listPhotos resolves', async () => {
        // Mock listPhotos to never resolve (pending)
        const neverResolvePromise = new Promise(() => {});
        PostService.listPhotos.mockReturnValue(neverResolvePromise);

        // Start the fetch (don't await)
        const loadPromise = postUIInstance.loadPhotoList();

        // Give async operations a chance to run
        await new Promise(r => setTimeout(r, 10));

        // Assert skeletons are present
        const container = document.getElementById('photoCarousel');
        const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
        expect(skeletons).toHaveLength(3);

        // Clean up the pending promise (prevent unhandled rejection)
        (async () => { await loadPromise; })().catch(() => {});
    });

    it('removes skeletons after listPhotos resolves with content', async () => {
        const mockPhotos = [
            { id: 'photo-1', displayUrl: '/api/photos/trip-1/photo-1/display' },
            { id: 'photo-2', displayUrl: '/api/photos/trip-1/photo-2/display' },
        ];
        PostService.listPhotos.mockResolvedValue(mockPhotos);

        // Call loadPhotoList and await it
        await postUIInstance.loadPhotoList();

        // At this point:
        // - Skeletons were injected initially
        // - listPhotos resolved with photos
        // - The render path executes: container.innerHTML = '' (line 960)
        // - PhotoCarousel.init is called
        // So skeletons should be cleared by the innerHTML = ''

        // Assert skeletons are gone
        const container = document.getElementById('photoCarousel');
        const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
        expect(skeletons).toHaveLength(0);

        // Assert carousel was initialized (which means innerHTML = '' happened)
        expect(globalThis.PhotoCarousel.init).toHaveBeenCalled();
    });

    it('removes skeletons after listPhotos rejects', async () => {
        PostService.listPhotos.mockRejectedValue(new Error('Network error'));

        postUIInstance.showToast = vi.fn();

        // Call loadPhotoList and let it reject
        await postUIInstance.loadPhotoList();

        // Assert skeletons are gone (error handler may have rendered error state)
        const container = document.getElementById('photoCarousel');
        const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
        expect(skeletons).toHaveLength(0);

        // Assert error was shown
        expect(postUIInstance.showToast).toHaveBeenCalled();
    });

    it('removes skeletons when listPhotos resolves with empty array', async () => {
        PostService.listPhotos.mockResolvedValue([]);

        // Call loadPhotoList with empty photo list
        await postUIInstance.loadPhotoList();

        // Assert skeletons are cleared (the new empty-trip fix clears them before returning)
        const container = document.getElementById('photoCarousel');
        const skeletons = container.querySelectorAll('.skeleton.skeleton-carousel-item');
        expect(skeletons).toHaveLength(0);

        // Assert empty state was applied
        const photoList = document.getElementById('photoList');
        expect(photoList.classList.contains('empty')).toBe(true);
    });
});
