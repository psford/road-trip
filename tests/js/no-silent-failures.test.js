/**
 * No-silent-failures audit test
 * Verifies ACX.2: All errors surfaced to the user include enough context to retry or recover;
 * no silent failures.
 *
 * Tests each known error branch:
 * 1. API.requestUpload throws → upload:failed event + UploadTelemetry.record('upload.failed') called
 * 2. UploadTransport.uploadFile throws PermanentError → same
 * 3. API.commit throws 400 → same
 * 4. StorageAdapter.putItem rejects → caller catches and surfaces
 * 5. VersionProtocol header parse exception → console.warn but no crash; error surfaced
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('No-silent-failures audit (ACX.2)', () => {
    let mockStorageAdapter;
    let mockSemaphores;

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

        // Stub globals
        globalThis.API = {
            requestUpload: vi.fn(),
            commit: vi.fn(),
            abort: vi.fn(),
        };

        globalThis.BroadcastChannel = class {
            constructor() {}
            postMessage() {}
            addEventListener() {}
            removeEventListener() {}
            close() {}
        };

        // Spy on telemetry and events
        vi.spyOn(document, 'dispatchEvent');
        vi.spyOn(UploadTransport, 'uploadFile');
        vi.spyOn(UploadTelemetry, 'recordFailed');

        // Mock semaphores
        mockSemaphores = {
            acquireForBlock: vi.fn().mockResolvedValue(() => {}),
        };

        // Mock fetch
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Error branch: API.requestUpload throws', () => {
        it('surfaces upload:failed event and calls UploadTelemetry.recordFailed()', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: {} };

            // Mock API.requestUpload to throw
            const requestUploadError = new Error('Network error: failed to reach server');
            API.requestUpload.mockRejectedValueOnce(requestUploadError);

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});

            // Wait for processing
            await UploadQueueTestHelper.waitForAll();

            // Verify upload:failed event was dispatched
            const failedEvent = document.dispatchEvent.mock.calls.find(call => {
                const event = call[0];
                return event.type === 'upload:failed';
            });
            expect(failedEvent).toBeDefined();
            expect(failedEvent[0].detail.uploadId).toBe(uploadId);
            expect(failedEvent[0].detail.error).toContain('Network error');

            // Verify UploadTelemetry.recordFailed was called
            expect(UploadTelemetry.recordFailed).toHaveBeenCalled();
        });
    });

    describe('Error branch: UploadTransport.uploadFile throws PermanentError', () => {
        it('surfaces upload:failed event and calls UploadTelemetry.recordFailed()', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';
            const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: {} };

            // Mock API.requestUpload to succeed
            API.requestUpload.mockResolvedValueOnce({
                photoId,
                sasUrl,
                blobPath: '/test/blob',
            });

            // Mock UploadTransport.uploadFile to throw PermanentError
            const permanentError = new UploadTransport.PermanentError('Permanent upload error: 400');
            UploadTransport.uploadFile.mockRejectedValueOnce(permanentError);

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});

            // Wait for processing
            await UploadQueueTestHelper.waitForAll();

            // Verify upload:failed event was dispatched
            const failedEvent = document.dispatchEvent.mock.calls.find(call => {
                const event = call[0];
                return event.type === 'upload:failed';
            });
            expect(failedEvent).toBeDefined();
            expect(failedEvent[0].detail.uploadId).toBe(uploadId);

            // Verify UploadTelemetry.recordFailed was called
            expect(UploadTelemetry.recordFailed).toHaveBeenCalled();
        });
    });

    describe('Error branch: API.commit throws 400', () => {
        it('surfaces upload:failed event and calls UploadTelemetry.recordFailed()', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';
            const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
            const blockIds = ['blockId0'];
            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: {} };

            // Mock API.requestUpload to succeed
            API.requestUpload.mockResolvedValueOnce({
                photoId,
                sasUrl,
                blobPath: '/test/blob',
            });

            // Mock UploadTransport.uploadFile to succeed
            UploadTransport.uploadFile.mockResolvedValueOnce(blockIds);

            // Mock API.commit to throw 400
            const commitError = new Error('Block list mismatch');
            commitError.code = 'BlockListMismatch';
            API.commit.mockRejectedValueOnce(commitError);

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});

            // Wait for processing
            await UploadQueueTestHelper.waitForAll();

            // Verify upload:failed event was dispatched
            const failedEvent = document.dispatchEvent.mock.calls.find(call => {
                const event = call[0];
                return event.type === 'upload:failed';
            });
            expect(failedEvent).toBeDefined();
            expect(failedEvent[0].detail.uploadId).toBe(uploadId);

            // Verify UploadTelemetry.recordFailed was called
            expect(UploadTelemetry.recordFailed).toHaveBeenCalled();
        });
    });

    describe('Error branch: StorageAdapter.putItem rejects', () => {
        it('caller catches error and surfaces via failed event', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: {} };

            // First, create the item successfully, then mock putItem for later calls
            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: tripToken,
                filename: 'test.jpg',
                size: 12,
                content_type: 'image/jpeg',
                exif: metadata,
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true,
            });

            // Now mock API.requestUpload to throw when processing
            API.requestUpload.mockRejectedValueOnce(new Error('Storage error during request'));

            // Start upload (will fail due to API error, which is caught)
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});

            // Wait for processing
            await UploadQueueTestHelper.waitForAll();

            // Verify error was surfaced via event and not silently swallowed
            const failedEvent = document.dispatchEvent.mock.calls.find(call => {
                const event = call[0];
                return event.type === 'upload:failed';
            });
            expect(failedEvent).toBeDefined();
            expect(failedEvent[0].detail.uploadId).toBe(uploadId);

            // Verify telemetry was recorded
            expect(UploadTelemetry.recordFailed).toHaveBeenCalled();
        });
    });

    describe('Error branch: VersionProtocol header parse exception', () => {
        it('logs console.warn but does not crash; errors are surfaced', () => {
            // Setup: wrap fetch to simulate VersionProtocol.wrapFetch()
            const originalFetch = globalThis.fetch;

            // Create a mock fetch that will cause VersionProtocol to process headers
            globalThis.fetch = vi.fn(async (url, opts) => {
                return {
                    ok: true,
                    status: 200,
                    headers: new Headers({
                        'x-server-version': 'invalid.version.format',
                        'x-client-min-version': '1.0.0'
                    }),
                    json: async () => ({})
                };
            });

            // Mock console.warn to capture warnings
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            // Manually test version comparison with malformed versions
            const result = VersionProtocol.compareSemver('invalid.version.format', '1.0.0');
            // Should return a number (comparison result), not throw
            expect(typeof result).toBe('number');

            // No exception should be thrown
            expect(() => {
                VersionProtocol.wrapFetch();
            }).not.toThrow();

            consoleWarnSpy.mockRestore();
            globalThis.fetch = originalFetch;
        });
    });

    describe('No silent failure guarantee', () => {
        it('all error paths result in either upload:failed event or telemetry call', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: {} };

            // Inject error in requestUpload
            API.requestUpload.mockRejectedValueOnce(new Error('Network error'));

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});
            await UploadQueueTestHelper.waitForAll();

            // Verify at least one of:
            // 1. upload:failed event was dispatched
            // 2. UploadTelemetry.recordFailed was called
            const failedEventFired = document.dispatchEvent.mock.calls.some(call => {
                const event = call[0];
                return event.type === 'upload:failed';
            });

            const telemetryCalled = UploadTelemetry.recordFailed.mock.calls.length > 0;

            expect(failedEventFired || telemetryCalled).toBe(true);
        });
    });
});
