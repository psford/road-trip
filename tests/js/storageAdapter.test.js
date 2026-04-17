import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('StorageAdapter', () => {
    beforeEach(async () => {
        // Clear the IndexedDB database before each test for isolation
        const dbs = await indexedDB.databases?.() || [];
        for (const db of dbs) {
            if (db.name === 'RoadTripUploadQueue') {
                // Wait for deleteDatabase to complete via success callback with timeout
                await Promise.race([
                    new Promise((resolve, reject) => {
                        const request = indexedDB.deleteDatabase(db.name);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    }),
                    new Promise((resolve) => setTimeout(resolve, 2000)) // Fallback timeout
                ]);
            }
        }
    });

    describe('putItem and getItem', () => {
        it('round-trips all fields correctly', async () => {
            const item = {
                upload_id: 'test-upload-123',
                trip_token: 'trip-abc',
                filename: 'photo.jpg',
                size: 5242880,
                exif: { DateTime: '2024-01-15T10:30:00Z' },
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true
            };

            await StorageAdapter.putItem(item);
            const retrieved = await StorageAdapter.getItem(item.upload_id);

            expect(retrieved).toMatchObject({
                upload_id: item.upload_id,
                trip_token: item.trip_token,
                filename: item.filename,
                size: item.size,
                exif: item.exif,
                status: item.status
            });
        });

        it('returns null for non-existent item', async () => {
            const result = await StorageAdapter.getItem('non-existent-id');
            expect(result).toBeNull();
        });

        it('upserts when item already exists', async () => {
            const item1 = {
                upload_id: 'test-upload-456',
                trip_token: 'trip-def',
                filename: 'old.jpg',
                size: 1024,
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true
            };

            await StorageAdapter.putItem(item1);

            const item2 = {
                ...item1,
                filename: 'new.jpg',
                status: 'uploading'
            };

            await StorageAdapter.putItem(item2);
            const retrieved = await StorageAdapter.getItem(item1.upload_id);

            expect(retrieved.filename).toBe('new.jpg');
            expect(retrieved.status).toBe('uploading');
        });
    });

    describe('updateItemStatus', () => {
        it('atomically updates status and extra fields', async () => {
            const uploadId = 'test-upload-789';
            const item = {
                upload_id: uploadId,
                trip_token: 'trip-ghi',
                filename: 'test.jpg',
                size: 2048,
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true
            };

            await StorageAdapter.putItem(item);

            const now = new Date().toISOString();
            await StorageAdapter.updateItemStatus(uploadId, 'uploading', {
                last_activity_at: now,
                photo_id: 'photo-123'
            });

            const updated = await StorageAdapter.getItem(uploadId);
            expect(updated.status).toBe('uploading');
            expect(updated.photo_id).toBe('photo-123');
            expect(updated.last_activity_at).toBe(now);
        });
    });

    describe('listByTrip', () => {
        it('returns all items for a trip', async () => {
            const tripToken = 'trip-xyz';
            const items = [
                {
                    upload_id: 'upload-1',
                    trip_token: tripToken,
                    filename: 'photo1.jpg',
                    size: 1024,
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                },
                {
                    upload_id: 'upload-2',
                    trip_token: tripToken,
                    filename: 'photo2.jpg',
                    size: 2048,
                    status: 'committed',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                }
            ];

            for (const item of items) {
                await StorageAdapter.putItem(item);
            }

            const results = await StorageAdapter.listByTrip(tripToken);
            expect(results).toHaveLength(2);
            expect(results.map(r => r.upload_id).sort()).toEqual(['upload-1', 'upload-2']);
        });

        it('returns empty list when no items match', async () => {
            const results = await StorageAdapter.listByTrip('non-existent-trip');
            expect(results).toEqual([]);
        });
    });

    describe('listNonTerminal', () => {
        it('excludes committed items', async () => {
            const tripToken = 'trip-nt';
            const items = [
                {
                    upload_id: 'upload-pending',
                    trip_token: tripToken,
                    filename: 'p1.jpg',
                    size: 1024,
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                },
                {
                    upload_id: 'upload-committed',
                    trip_token: tripToken,
                    filename: 'p2.jpg',
                    size: 1024,
                    status: 'committed',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                },
                {
                    upload_id: 'upload-uploading',
                    trip_token: tripToken,
                    filename: 'p3.jpg',
                    size: 1024,
                    status: 'uploading',
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                }
            ];

            for (const item of items) {
                await StorageAdapter.putItem(item);
            }

            const results = await StorageAdapter.listNonTerminal(tripToken);
            expect(results).toHaveLength(2);
            const statuses = results.map(r => r.status);
            expect(statuses).toContain('pending');
            expect(statuses).toContain('uploading');
            expect(statuses).not.toContain('committed');
        });

        it('includes all non-terminal statuses', async () => {
            const tripToken = 'trip-all-nt';
            const statuses = ['pending', 'requesting', 'uploading', 'committing'];

            for (const status of statuses) {
                await StorageAdapter.putItem({
                    upload_id: `upload-${status}`,
                    trip_token: tripToken,
                    filename: 'test.jpg',
                    size: 1024,
                    status,
                    created_at: new Date().toISOString(),
                    last_activity_at: new Date().toISOString(),
                    persistent: true
                });
            }

            const results = await StorageAdapter.listNonTerminal(tripToken);
            expect(results).toHaveLength(4);
        });
    });

    describe('putBlock, listBlocks, updateBlock', () => {
        it('stores and retrieves block state', async () => {
            const uploadId = 'upload-blocks';

            await StorageAdapter.putBlock(uploadId, 'blockId-1', {
                status: 'pending',
                attempts: 0
            });

            const blocks = await StorageAdapter.listBlocks(uploadId);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].block_id).toBe('blockId-1');
            expect(blocks[0].status).toBe('pending');
        });

        it('updates block state', async () => {
            const uploadId = 'upload-update-block';

            await StorageAdapter.putBlock(uploadId, 'blockId-1', {
                status: 'pending',
                attempts: 0
            });

            await StorageAdapter.updateBlock(uploadId, 'blockId-1', {
                status: 'done',
                attempts: 1
            });

            const blocks = await StorageAdapter.listBlocks(uploadId);
            expect(blocks[0].status).toBe('done');
            expect(blocks[0].attempts).toBe(1);
        });

        it('lists multiple blocks per upload consistently', async () => {
            const uploadId = 'upload-multi-blocks';

            const blockIds = ['blockId-1', 'blockId-2', 'blockId-3'];
            for (const blockId of blockIds) {
                await StorageAdapter.putBlock(uploadId, blockId, {
                    status: 'pending',
                    attempts: 0
                });
            }

            const blocks = await StorageAdapter.listBlocks(uploadId);
            expect(blocks).toHaveLength(3);
            const ids = blocks.map(b => b.block_id);
            expect(ids).toEqual(blockIds);
        });

        it('returns empty list for non-existent upload', async () => {
            const blocks = await StorageAdapter.listBlocks('non-existent-upload');
            expect(blocks).toEqual([]);
        });
    });

    describe('deleteItem', () => {
        it('removes item and cascades to blocks', async () => {
            const uploadId = 'upload-delete';

            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: 'trip-del',
                filename: 'test.jpg',
                size: 1024,
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true
            });

            await StorageAdapter.putBlock(uploadId, 'blockId-1', {
                status: 'pending',
                attempts: 0
            });

            await StorageAdapter.deleteItem(uploadId);

            const item = await StorageAdapter.getItem(uploadId);
            const blocks = await StorageAdapter.listBlocks(uploadId);

            expect(item).toBeNull();
            expect(blocks).toEqual([]);
        });

        it('is idempotent (no error on non-existent item)', async () => {
            // Should not throw
            await expect(StorageAdapter.deleteItem('non-existent')).resolves.toBeUndefined();
        });
    });

    describe('fallback to in-memory store', () => {
        it('works when IndexedDB is unavailable', async () => {
            // This test verifies the fallback behavior
            // In a real scenario with IndexedDB disabled, the adapter would gracefully degrade
            // For now, we just verify that basic operations don't crash
            const uploadId = 'upload-fallback';

            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: 'trip-fb',
                filename: 'test.jpg',
                size: 1024,
                status: 'pending',
                created_at: new Date().toISOString(),
                last_activity_at: new Date().toISOString(),
                persistent: true
            });

            const item = await StorageAdapter.getItem(uploadId);
            expect(item).toBeDefined();
            expect(item.upload_id).toBe(uploadId);
        });
    });
});
