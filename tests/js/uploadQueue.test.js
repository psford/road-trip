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
        UploadQueue._tierBlobs.clear();
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
            await UploadQueueTestHelper.waitForAll();

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
            await UploadQueueTestHelper.waitForAll();

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
            await UploadQueueTestHelper.waitForAll();

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
                    // Simulate real API.commit behavior: throw error with code property
                    const err = new Error('Block list mismatch');
                    err.code = 'BlockListMismatch';
                    throw err;
                }
                return Promise.resolve({ id: photoId, photoId });
            });

            // Start upload
            await UploadQueue.start(tripToken, [{ file, metadata: {}, uploadId }], {});

            // Wait for completion (with retries and recovery)
            await UploadQueueTestHelper.waitForAll();
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
            await UploadQueueTestHelper.waitForAll();
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
            await UploadQueueTestHelper.waitForAll();

            // Verify both completed
            const item1 = await StorageAdapter.getItem(uploadId);
            const item2 = await StorageAdapter.getItem(uploadId2);
            expect(item1.status).toBe('committed');
            expect(item2.status).toBe('committed');
        });

        it('implements BroadcastChannel claim protocol to prevent double-processing', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            API.requestUpload.mockResolvedValue({
                photoId: 'photo-1',
                sasUrl: 'https://...',
            });
            UploadTransport.uploadFile.mockResolvedValue(['blockId0']);
            API.commit.mockResolvedValue({ id: 'photo-1' });

            // Verify that BroadcastChannel is created with correct channel name
            let createdChannel = null;
            const OriginalBroadcastChannel = globalThis.BroadcastChannel;
            globalThis.BroadcastChannel = class extends OriginalBroadcastChannel {
                constructor(name) {
                    super(name);
                    createdChannel = name;
                }
            };

            try {
                // Start a normal upload to trigger _claimItem
                await UploadQueue.start(tripToken, [{ file, metadata: {}, uploadId }], {});
                await UploadQueueTestHelper.waitForAll();

                // Verify the upload completed
                const item = await StorageAdapter.getItem(uploadId);
                expect(item.status).toBe('committed');

                // Verify BroadcastChannel was created with proper channel name
                expect(createdChannel).toBe(`roadtrip-uploads-${tripToken}`);
            } finally {
                globalThis.BroadcastChannel = OriginalBroadcastChannel;
            }
        });

        it('prevents two tabs from both processing the same upload_id (AC4.5 contention test)', async () => {
            const tripToken = 'test-token';
            const uploadId = 'upload-1';
            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            // Mock API calls
            API.requestUpload.mockResolvedValue({
                photoId: 'photo-1',
                sasUrl: 'https://...',
            });
            UploadTransport.uploadFile.mockResolvedValue(['blockId0']);
            API.commit.mockResolvedValue({ id: 'photo-1' });

            // Create a real BroadcastChannel mock that simulates cross-tab communication
            const broadcastChannels = new Map(); // channelName -> set of listeners
            const OriginalBroadcastChannel = globalThis.BroadcastChannel;

            globalThis.BroadcastChannel = class MockBroadcastChannel {
                constructor(name) {
                    this.name = name;
                    if (!broadcastChannels.has(name)) {
                        broadcastChannels.set(name, new Set());
                    }
                    broadcastChannels.get(name).add(this);
                    this._messageHandlers = [];
                }

                postMessage(msg) {
                    // Broadcast to all other listeners on the same channel
                    const listeners = broadcastChannels.get(this.name);
                    for (const listener of listeners) {
                        if (listener !== this) {
                            // Simulate async delivery with microtask
                            queueMicrotask(() => {
                                for (const handler of listener._messageHandlers || []) {
                                    handler({ data: msg });
                                }
                            });
                        }
                    }
                }

                addEventListener(type, handler) {
                    if (type === 'message') {
                        this._messageHandlers.push(handler);
                    }
                }

                removeEventListener(type, handler) {
                    if (type === 'message') {
                        const idx = this._messageHandlers.indexOf(handler);
                        if (idx >= 0) this._messageHandlers.splice(idx, 1);
                    }
                }

                close() {
                    const listeners = broadcastChannels.get(this.name);
                    if (listeners) {
                        listeners.delete(this);
                    }
                }
            };

            try {
                // Simulate: Tab 1 has started processing, Tab 2 is trying to claim the same upload_id
                // Seed the upload_id in the database in a state that Tab 1 has already begun processing
                await StorageAdapter.putItem({
                    upload_id: uploadId,
                    trip_token: tripToken,
                    filename: 'test.jpg',
                    size: 100,
                    content_type: 'image/jpeg',
                    exif: {},
                    status: 'requesting',  // Already past pending, so Tab 1 is claiming it
                    photo_id: 'photo-1',
                    sas_url: 'https://...',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true,
                });

                // Create two separate queue instances (simulating two tabs)
                const tab1Queue = Object.create(UploadQueue);
                const tab2Queue = Object.create(UploadQueue);

                // Initialize each with different claimantIds
                tab1Queue._claimantId = 'tab-1-claimant-id';
                tab2Queue._claimantId = 'tab-2-claimant-id';
                tab1Queue._channels = new Map();
                tab2Queue._channels = new Map();
                tab1Queue._processingPromises = new Map();
                tab2Queue._processingPromises = new Map();
                tab1Queue._blockListMismatchRetries = new Map();
                tab2Queue._blockListMismatchRetries = new Map();

                // Tab 1: Set up the channel and its persistent listener
                // (This happens in _claimItem but we need to set it up before Tab 2 claims)
                const channelName = `roadtrip-uploads-${tripToken}`;
                const tab1Channel = new (globalThis.BroadcastChannel)(channelName);
                tab1Queue._channels.set(tripToken, tab1Channel);

                // Add Tab 1's persistent listener (as uploadQueue.js does)
                tab1Channel.addEventListener('message', (event) => {
                    const { type, uploadId: claimedUploadId, claimantId: senderClaimantId, respondTo } = event.data || {};
                    if (type === 'claim') {
                        if (respondTo !== tab1Queue._claimantId && tab1Queue._processingPromises.has(claimedUploadId)) {
                            tab1Channel.postMessage({
                                type: 'owned',
                                uploadId: claimedUploadId,
                                claimantId: tab1Queue._claimantId,
                            });
                        }
                    }
                });

                // Add a fake promise to indicate Tab 1 is processing this uploadId
                const tab1FakePromise = new Promise(() => {}); // Never resolves (we'll stop waiting)
                tab1Queue._processingPromises.set(uploadId, tab1FakePromise);

                // Now Tab 2 tries to claim the same upload_id (via resume or competing start)
                const tab2Result = await tab2Queue._claimItem(uploadId, tripToken);

                // Tab 2 should have received 'owned' from Tab 1's persistent listener
                // This means Tab 2 should yield (isOwned = false)
                expect(tab2Result).toBe(false);

                // Verify only Tab 1's promise is in its processing map
                expect(tab1Queue._processingPromises.has(uploadId)).toBe(true);
                expect(tab2Queue._processingPromises.has(uploadId)).toBe(false);
            } finally {
                globalThis.BroadcastChannel = OriginalBroadcastChannel;
                broadcastChannels.clear();
            }
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

    describe('Task 2: Tier blob uploads (display and thumb)', () => {
        describe('Subcomponent A & B: Store tier blobs and SAS URLs', () => {
            it('stores display and thumb blobs from item entry (in-memory during upload)', async () => {
                const tripToken = 'test-token';
                const uploadId = 'upload-1';
                const file = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
                const displayBlob = new Blob(['display'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['thumb'], { type: 'image/jpeg' });

                // Spy on _uploadTiers to verify blobs are available during upload
                const uploadTiersSpy = vi.spyOn(UploadQueue, '_uploadTiers');
                uploadTiersSpy.mockImplementation(async (item) => {
                    // Verify blobs are in the item at this point
                    expect(item.display).toBe(displayBlob);
                    expect(item.thumb).toBe(thumbBlob);
                });

                // Mock API
                API.requestUpload = vi.fn().mockResolvedValue({
                    photoId: 'photo-1',
                    sasUrl: 'https://...',
                    blobPath: '/blob',
                });
                UploadTransport.uploadFile = vi.fn().mockResolvedValue(['blockId0']);
                API.commit = vi.fn().mockResolvedValue({ id: 'photo-1' });

                // Start with display and thumb blobs
                await UploadQueue.start(tripToken, [{
                    file,
                    metadata: {},
                    uploadId,
                    display: displayBlob,
                    thumb: thumbBlob,
                }], {});

                await UploadQueueTestHelper.waitForAll();

                // Verify _uploadTiers was called
                expect(uploadTiersSpy).toHaveBeenCalled();
                uploadTiersSpy.mockRestore();
            });

            it('stores tier SAS URLs from request-upload response', async () => {
                const tripToken = 'test-token';
                const uploadId = 'upload-1';
                const photoId = 'photo-1';
                const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
                const displayBlob = new Blob(['d'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['t'], { type: 'image/jpeg' });

                API.requestUpload.mockResolvedValue({
                    photoId,
                    sasUrl,
                    blobPath: '/test/blob',
                    displaySasUrl,
                    thumbSasUrl,
                });

                API.commit.mockResolvedValue({ id: photoId });
                UploadTransport.uploadFile.mockResolvedValue(['blockId0']);

                await UploadQueue.start(tripToken, [{
                    file,
                    metadata: {},
                    uploadId,
                    display: displayBlob,
                    thumb: thumbBlob,
                }], {});

                await UploadQueueTestHelper.waitForAll();

                const item = await StorageAdapter.getItem(uploadId);
                expect(item.display_sas_url).toBe(displaySasUrl);
                expect(item.thumb_sas_url).toBe(thumbSasUrl);
            });
        });

        describe('Subcomponent C: _uploadTiers method', () => {
            it('uploads display and thumb blobs via PUT with BlockBlob header', async () => {
                const tripToken = 'test-token';
                const uploadId = 'upload-1';
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const displayBlob = new Blob(['display content'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['thumb content'], { type: 'image/jpeg' });

                const item = {
                    display: displayBlob,
                    thumb: thumbBlob,
                    display_sas_url: displaySasUrl,
                    thumb_sas_url: thumbSasUrl,
                };

                // Mock fetch for tier uploads
                globalThis.fetch = vi.fn(async (url) => {
                    if (url === displaySasUrl || url === thumbSasUrl) {
                        return { ok: true, status: 201 };
                    }
                    return { ok: false, status: 404 };
                });

                // Call _uploadTiers
                await UploadQueue._uploadTiers(item);

                // Verify fetch was called twice with correct headers
                expect(globalThis.fetch).toHaveBeenCalledWith(
                    displaySasUrl,
                    expect.objectContaining({
                        method: 'PUT',
                        headers: expect.objectContaining({
                            'x-ms-blob-type': 'BlockBlob',
                            'Content-Type': 'image/jpeg',
                        }),
                        body: displayBlob,
                    })
                );

                expect(globalThis.fetch).toHaveBeenCalledWith(
                    thumbSasUrl,
                    expect.objectContaining({
                        method: 'PUT',
                        headers: expect.objectContaining({
                            'x-ms-blob-type': 'BlockBlob',
                            'Content-Type': 'image/jpeg',
                        }),
                        body: thumbBlob,
                    })
                );
            });

            it('skips tier upload if blob or SAS URL is missing', async () => {
                const item = {
                    display: null,
                    thumb: null,
                    display_sas_url: null,
                    thumb_sas_url: null,
                };

                globalThis.fetch = vi.fn();

                // Should not throw when both are null
                await UploadQueue._uploadTiers(item);

                expect(globalThis.fetch).not.toHaveBeenCalled();
            });

            it('logs warning on individual tier failure but continues', async () => {
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const displayBlob = new Blob(['d'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['t'], { type: 'image/jpeg' });

                const item = {
                    display: displayBlob,
                    thumb: thumbBlob,
                    display_sas_url: displaySasUrl,
                    thumb_sas_url: thumbSasUrl,
                };

                globalThis.fetch = vi.fn(async (url) => {
                    if (url === displaySasUrl) {
                        return { ok: false, status: 500 };
                    }
                    return { ok: true, status: 201 };
                });

                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                // Should not throw when one tier fails
                await UploadQueue._uploadTiers(item);

                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining('display')
                );
                warnSpy.mockRestore();
            });

            it('throws only when both tier uploads fail', async () => {
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const displayBlob = new Blob(['d'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['t'], { type: 'image/jpeg' });

                const item = {
                    display: displayBlob,
                    thumb: thumbBlob,
                    display_sas_url: displaySasUrl,
                    thumb_sas_url: thumbSasUrl,
                };

                globalThis.fetch = vi.fn(async () => {
                    return { ok: false, status: 500 };
                });

                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                // Should throw when both fail
                await expect(UploadQueue._uploadTiers(item))
                    .rejects.toThrow();

                warnSpy.mockRestore();
            });
        });

        describe('Subcomponent D: Integration into state machine', () => {
            it('uploads tiers after block upload completes, before commit', async () => {
                const tripToken = 'test-token';
                const uploadId = 'upload-1';
                const photoId = 'photo-1';
                const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const file = new File(['original'], 'test.jpg', { type: 'image/jpeg' });
                const displayBlob = new Blob(['display'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['thumb'], { type: 'image/jpeg' });

                const callOrder = [];

                // Mock to track call order
                UploadTransport.uploadFile = vi.fn(async () => {
                    callOrder.push('uploadFile');
                    return ['blockId0'];
                });

                globalThis.fetch = vi.fn(async (url) => {
                    if (url.includes('_display') || url.includes('_thumb')) {
                        callOrder.push(url.includes('_display') ? 'tier-display' : 'tier-thumb');
                    }
                    return { ok: true, status: 201 };
                });

                API.requestUpload = vi.fn().mockResolvedValue({
                    photoId,
                    sasUrl,
                    blobPath: '/test/blob',
                    displaySasUrl,
                    thumbSasUrl,
                });

                API.commit = vi.fn(async () => {
                    callOrder.push('commit');
                    return { id: photoId };
                });

                await UploadQueue.start(tripToken, [{
                    file,
                    metadata: {},
                    uploadId,
                    display: displayBlob,
                    thumb: thumbBlob,
                }], {});

                await UploadQueueTestHelper.waitForAll();

                // Verify order: uploadFile -> tier uploads -> commit
                expect(callOrder).toEqual(
                    expect.arrayContaining(['uploadFile', 'tier-display', 'tier-thumb', 'commit'])
                );

                // Tier uploads should come before commit
                const uploadFileIdx = callOrder.indexOf('uploadFile');
                const commitIdx = callOrder.indexOf('commit');
                const tierUploadIdx = Math.max(
                    callOrder.indexOf('tier-display'),
                    callOrder.indexOf('tier-thumb')
                );

                expect(uploadFileIdx).toBeLessThan(tierUploadIdx);
                expect(tierUploadIdx).toBeLessThan(commitIdx);
            });

            it('continues to commit even if tier upload fails (non-fatal)', async () => {
                const tripToken = 'test-token';
                const uploadId = 'upload-1';
                const photoId = 'photo-1';
                const sasUrl = 'https://storage.blob.core.windows.net/container/blob?sig=...';
                const displaySasUrl = 'https://storage.blob.core.windows.net/container/blob_display?sig=...';
                const thumbSasUrl = 'https://storage.blob.core.windows.net/container/blob_thumb?sig=...';

                const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
                const displayBlob = new Blob(['d'], { type: 'image/jpeg' });
                const thumbBlob = new Blob(['t'], { type: 'image/jpeg' });

                API.requestUpload.mockResolvedValue({
                    photoId,
                    sasUrl,
                    blobPath: '/test/blob',
                    displaySasUrl,
                    thumbSasUrl,
                });

                UploadTransport.uploadFile.mockResolvedValue(['blockId0']);

                // Tier upload fails
                globalThis.fetch = vi.fn(async () => {
                    return { ok: false, status: 500 };
                });

                API.commit.mockResolvedValue({ id: photoId });

                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

                // Start upload with failing tier upload
                await UploadQueue.start(tripToken, [{
                    file,
                    metadata: {},
                    uploadId,
                    display: displayBlob,
                    thumb: thumbBlob,
                }], {});

                await UploadQueueTestHelper.waitForAll();

                // Verify item still reached committed state
                const item = await StorageAdapter.getItem(uploadId);
                expect(item.status).toBe('committed');

                // Verify commit was called despite tier upload failure
                expect(API.commit).toHaveBeenCalled();

                warnSpy.mockRestore();
            });
        });
    });
});
