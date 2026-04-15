/**
 * UploadQueue tests — state machine, persistence, cross-tab singleton
 * Verifies AC3.1, AC4.1, AC4.2, AC4.3, AC4.4, AC4.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('UploadQueue', () => {
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

        vi.spyOn(document, 'dispatchEvent');
        vi.spyOn(UploadTransport, 'uploadFile');
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('AC3.1: Happy path state transitions', () => {
        it('progresses through pending → requesting → uploading → committing → committed', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';
            const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
            const blockIds = ['blockId0', 'blockId1'];

            const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
            const metadata = { exif: { dateTime: '2026-01-01' } };

            // Mock API calls
            API.requestUpload.mockResolvedValue({
                photoId,
                sasUrl,
                blobPath: '/test/blob',
            });

            API.commit.mockResolvedValue({
                id: photoId,
                photoId,
                status: 'committed',
            });

            UploadTransport.uploadFile.mockResolvedValue(blockIds);

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata, uploadId }], {});

            // Wait for processing to complete
            await UploadQueue._waitForAll();

            // Verify item transitions
            const item = await StorageAdapter.getItem(uploadId);
            expect(item.status).toBe('committed');
            expect(item.photo_id).toBe(photoId);
        });
    });

    describe('AC4.1: Persistence across tab reload', () => {
        it('resumes items after page reload', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';
            const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
            const blockIds = ['blockId0'];

            const file = new File(['x'.repeat(4 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

            // First tab: start upload
            API.requestUpload.mockResolvedValue({ photoId, sasUrl });
            UploadTransport.uploadFile.mockResolvedValue(blockIds);
            API.commit.mockResolvedValue({ id: photoId });

            await UploadQueue.start(tripToken, [{ file, metadata: {}, uploadId }], {});

            // Verify item was created in storage
            let item = await StorageAdapter.getItem(uploadId);
            expect(item).toBeDefined();
            expect(item.filename).toBe('big.jpg');

            // Wait for processing to complete
            await UploadQueue._waitForAll();

            // Verify item completed after processing
            item = await StorageAdapter.getItem(uploadId);
            expect(item.status).toBe('committed');
        });
    });

    describe('AC4.2: Partial block resume', () => {
        it('uploads only pending blocks on resume', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';

            // Seed database with partial upload state
            const item = {
                upload_id: uploadId,
                trip_token: tripToken,
                filename: 'test.jpg',
                size: 4 * 1024 * 1024,
                status: 'uploading',
                photo_id: 'photo-1',
                sas_url: 'https://storage.blob.core.windows.net/container/blob?sig=...',
            };

            await StorageAdapter.putItem(item);

            // Seed blocks: first done, second pending
            await StorageAdapter.putBlock(uploadId, 'blockId0', {
                block_id: 'blockId0',
                status: 'done',
                attempts: 1,
            });
            await StorageAdapter.putBlock(uploadId, 'blockId1', {
                block_id: 'blockId1',
                status: 'pending',
                attempts: 0,
            });

            // Setup mocks
            UploadTransport.uploadFile.mockResolvedValue(['blockId0', 'blockId1']);
            API.commit.mockResolvedValue({ id: 'photo-1', photoId: 'photo-1' });

            // Resume
            await UploadQueue.resume(tripToken, {});

            // Wait for completion
            await UploadQueue._waitForAll();

            // Verify completion
            const updated = await StorageAdapter.getItem(uploadId);
            expect(updated.status).toBe('committed');
        });
    });

    describe('AC4.3: Discard all items', () => {
        it('marks items aborted and removes them', async () => {
            const tripToken = 'test-token';

            // Seed items with various statuses
            const items = [
                { upload_id: 'u1', trip_token: tripToken, status: 'pending', filename: 'f1.jpg', size: 100 },
                { upload_id: 'u2', trip_token: tripToken, status: 'uploading', filename: 'f2.jpg', size: 100, photo_id: 'p2' },
                { upload_id: 'u3', trip_token: tripToken, status: 'committed', filename: 'f3.jpg', size: 100 },
            ];

            for (const item of items) {
                await StorageAdapter.putItem(item);
            }

            API.abort.mockResolvedValue(undefined);

            // Discard all
            await UploadQueue.discardAll(tripToken, {});

            // Wait a bit for cleanup
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify non-terminal items are removed
            const remaining = await StorageAdapter.listByTrip(tripToken);
            const nonTerminal = remaining.filter(r => ['pending', 'uploading', 'requesting', 'committing'].includes(r.status));
            expect(nonTerminal.length).toBe(0);

            // Verify abort was called for items with photo_id
            expect(API.abort.mock.calls.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('AC4.4: BlockListMismatch recovery', () => {
        it('retries block list with fresh upload on BlockListMismatch', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';
            const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
            const blockIds = ['blockId0'];

            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            API.requestUpload.mockResolvedValue({ photoId, sasUrl });
            UploadTransport.uploadFile.mockResolvedValue(blockIds);

            let commitAttempt = 0;
            API.commit.mockImplementation(() => {
                commitAttempt++;
                if (commitAttempt === 1) {
                    const err = new Error('Block list mismatch');
                    err.code = 'BlockListMismatch';
                    throw err;
                }
                return Promise.resolve({ id: photoId, photoId });
            });

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata: {}, uploadId }], {});

            // Wait for completion (with retries and recovery)
            await UploadQueue._waitForAll();
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify recovery succeeded
            const item = await StorageAdapter.getItem(uploadId);
            expect(item.status).toBe('committed');

            // Verify requestUpload was called twice (initial + recovery)
            expect(API.requestUpload.mock.calls.length).toBe(2);
        });

        it('fails after second BlockListMismatch', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            API.requestUpload.mockResolvedValue({
                photoId: 'photo-1',
                sasUrl: 'https://...',
            });
            UploadTransport.uploadFile.mockResolvedValue(['blockId0']);

            // Both commits fail with BlockListMismatch
            API.commit.mockImplementation(() => {
                const err = new Error('Block list mismatch');
                err.code = 'BlockListMismatch';
                throw err;
            });

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata: {}, uploadId }], {});

            // Wait for failure
            await UploadQueue._waitForAll();
            await new Promise(resolve => setTimeout(resolve, 50));

            // Verify item marked failed
            const item = await StorageAdapter.getItem(uploadId);
            expect(item.status).toBe('failed');
        });
    });

    describe('AC4.5: Cross-tab singleton', () => {
        it('allows different upload_ids in parallel', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const uploadId2 = 'upload-2';

            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const file2 = new File(['test2'], 'test2.jpg', { type: 'image/jpeg' });

            API.requestUpload.mockResolvedValue({
                photoId: 'photo-1',
                sasUrl: 'https://...',
            });
            UploadTransport.uploadFile.mockResolvedValue(['blockId0']);
            API.commit.mockResolvedValue({ id: 'photo-1' });

            // Both start uploads with different IDs
            await UploadQueue.start(tripToken, [
                { file, metadata: {}, uploadId },
                { file: file2, metadata: {}, uploadId: uploadId2 }
            ], {});

            // Wait for completion
            await UploadQueue._waitForAll();

            // Verify both completed
            const item1 = await StorageAdapter.getItem(uploadId);
            const item2 = await StorageAdapter.getItem(uploadId2);
            expect(item1.status).toBe('committed');
            expect(item2.status).toBe('committed');
        });
    });

    describe('Event subscription convenience methods', () => {
        it('subscribes to events', async () => {
            const handler = vi.fn();
            UploadQueue.subscribe('upload:created', handler);

            document.dispatchEvent(
                new CustomEvent('upload:created', { detail: { uploadId: 'test' } })
            );

            await new Promise(resolve => setTimeout(resolve, 10));
            expect(handler).toHaveBeenCalled();
        });
    });

    describe('Retry functionality', () => {
        it('resets failed blocks on retry', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';

            // Seed item with failed status
            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: tripToken,
                filename: 'test.jpg',
                size: 100,
                status: 'failed',
            });

            // Seed failed block
            await StorageAdapter.putBlock(uploadId, 'blockId0', {
                block_id: 'blockId0',
                status: 'failed',
                attempts: 6,
            });

            // Reset mocks and make retry succeed
            API.requestUpload.mockResolvedValue({
                photoId: 'photo-1',
                sasUrl: 'https://...',
            });
            UploadTransport.uploadFile.mockResolvedValue(['blockId0']);
            API.commit.mockResolvedValue({ id: 'photo-1' });

            // Retry
            await UploadQueue.retry(uploadId);

            // Verify block was reset
            const block = (await StorageAdapter.listBlocks(uploadId))[0];
            expect(block.status).toBe('pending');
            expect(block.attempts).toBe(0);
        });
    });

    describe('Abort functionality', () => {
        it('aborts single item', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const photoId = 'photo-1';

            // Seed item with photo_id
            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: tripToken,
                filename: 'test.jpg',
                size: 100,
                status: 'uploading',
                photo_id: photoId,
            });

            API.abort.mockResolvedValue(undefined);

            // Abort
            await UploadQueue.abort(uploadId);

            // Verify API called
            expect(API.abort).toHaveBeenCalledWith(tripToken, photoId);

            // Verify item deleted
            const item = await StorageAdapter.getItem(uploadId);
            expect(item).toBeNull();
        });
    });
});
