/**
 * Upload Queue — Resilient state machine for photo uploads
 * Manages transitions: pending → requesting → uploading → committing → committed | failed | aborted
 *
 * Verifies:
 * - AC3.1: State machine transitions on happy path
 * - AC4.1: Persistence across page reload
 * - AC4.2: Resume from partial uploads
 * - AC4.3: Discard all items
 * - AC4.4: BlockListMismatch recovery with bounds
 * - AC4.5: Cross-tab singleton via BroadcastChannel
 */

const UploadQueue = {
    // Runtime state
    _channels: new Map(), // tripToken -> BroadcastChannel
    _claimantId: null, // Unique ID for this tab/page load
    _processingPromises: new Map(), // uploadId -> Promise
    _blockListMismatchRetries: new Map(), // uploadId -> retry count

    /**
     * Initialize queue on page load
     */
    init() {
        if (!this._claimantId) {
            this._claimantId = UploadUtils.newGuid();
        }
    },

    /**
     * Start a new batch of uploads
     * @param {string} tripToken - Trip secret token
     * @param {Array<{file: File, metadata: Object, uploadId: string}>} filesWithMetadata
     * @param {Object} callbacks - { onEachComplete: fn(photoResponse), onAllComplete: fn() }
     * @returns {Promise<void>}
     */
    async start(tripToken, filesWithMetadata, callbacks = {}) {
        this.init();

        const promises = filesWithMetadata.map(async (item) => {
            const uploadId = item.uploadId || UploadUtils.newGuid();

            // Create item in storage
            const now = new Date().toISOString();
            await StorageAdapter.putItem({
                upload_id: uploadId,
                trip_token: tripToken,
                filename: item.file.name,
                size: item.file.size,
                content_type: item.file.type || 'application/octet-stream',
                exif: item.metadata || {},
                status: 'pending',
                created_at: now,
                last_activity_at: now,
                persistent: true,
            });

            // Emit created event
            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId,
                        filename: item.file.name,
                        size: item.file.size,
                        exif: item.metadata,
                    },
                })
            );

            // Start processing and track the promise
            const processingPromise = this._processItem(
                uploadId,
                tripToken,
                item.file,
                item.metadata,
                callbacks
            );
            this._processingPromises.set(uploadId, processingPromise);

            // Cleanup on completion
            return processingPromise.finally(() => {
                this._processingPromises.delete(uploadId);
            });
        });

        // Return after enqueueing (don't wait for completion)
        return Promise.all(promises);
    },

    /**
     * Resume incomplete uploads for a trip
     * @param {string} tripToken
     * @param {Object} callbacks - { onEachComplete, onAllComplete }
     * @returns {Promise<void>}
     */
    async resume(tripToken, callbacks = {}) {
        this.init();

        const items = await StorageAdapter.listNonTerminal(tripToken);

        const promises = items.map(async (item) => {
            const uploadId = item.upload_id;

            // Resume processing
            const processingPromise = this._processItem(
                uploadId,
                tripToken,
                null, // file is not available on resume
                item.exif || {},
                callbacks
            );
            this._processingPromises.set(uploadId, processingPromise);

            return processingPromise.finally(() => {
                this._processingPromises.delete(uploadId);
            });
        });

        return Promise.all(promises);
    },

    /**
     * Discard all non-terminal uploads for a trip
     * @param {string} tripToken
     * @param {Object} callbacks
     * @returns {Promise<void>}
     */
    async discardAll(tripToken, callbacks = {}) {
        this.init();

        const items = await StorageAdapter.listNonTerminal(tripToken);

        const promises = items.map(async (item) => {
            const uploadId = item.upload_id;

            // Abort on server if photo_id exists
            if (item.photo_id) {
                try {
                    await API.abort(tripToken, item.photo_id);
                } catch (err) {
                    // Log but don't fail
                    console.warn(`Failed to abort upload ${uploadId}:`, err.message);
                }
            }

            // Mark as aborted
            await StorageAdapter.updateItemStatus(uploadId, 'aborted');

            // Emit failed event
            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId,
                        reason: 'aborted',
                        error: null,
                    },
                })
            );

            // Remove from storage
            await StorageAdapter.deleteItem(uploadId);
        });

        return Promise.all(promises);
    },

    /**
     * Retry an item that previously failed
     * @param {string} uploadId
     * @returns {Promise<void>}
     */
    async retry(uploadId) {
        this.init();

        const item = await StorageAdapter.getItem(uploadId);
        if (!item) return;

        // Reset pending blocks to pending (recovery for transient failures)
        const blocks = await StorageAdapter.listBlocks(uploadId);
        for (const block of blocks.filter(b => b.status === 'failed')) {
            await StorageAdapter.updateBlock(uploadId, block.block_id, {
                status: 'pending',
                attempts: 0,
            });
        }

        // Re-enqueue
        const processingPromise = this._processItem(uploadId, item.trip_token, null, {}, {});
        this._processingPromises.set(uploadId, processingPromise);
        return processingPromise.finally(() => {
            this._processingPromises.delete(uploadId);
        });
    },

    /**
     * Abort a single item
     * @param {string} uploadId
     * @returns {Promise<void>}
     */
    async abort(uploadId) {
        this.init();

        const item = await StorageAdapter.getItem(uploadId);
        if (!item) return;

        if (item.photo_id) {
            try {
                await API.abort(item.trip_token, item.photo_id);
            } catch (err) {
                console.warn(`Failed to abort upload ${uploadId}:`, err.message);
            }
        }

        await StorageAdapter.updateItemStatus(uploadId, 'aborted');

        document.dispatchEvent(
            new CustomEvent('upload:failed', {
                detail: {
                    uploadId,
                    reason: 'aborted',
                    error: null,
                },
            })
        );

        await StorageAdapter.deleteItem(uploadId);
    },

    /**
     * Subscribe to upload events
     * @param {string} eventName
     * @param {Function} handler
     */
    subscribe(eventName, handler) {
        document.addEventListener(eventName, (e) => {
            handler(e.detail);
        });
    },


    /**
     * Process a single upload item through state machine
     * @private
     */
    async _processItem(uploadId, tripToken, file, metadata, callbacks) {
        try {
            let item = await StorageAdapter.getItem(uploadId);
            if (!item) return;

            // Try to claim ownership via BroadcastChannel
            if (!await this._claimItem(uploadId, tripToken)) {
                // Another tab owns this item, don't process
                return;
            }

            // State machine loop (may iterate if recovery happens)
            let maxIterations = 5;
            while (maxIterations-- > 0) {
                item = await StorageAdapter.getItem(uploadId);
                if (!item) return;

                // State: pending → requesting
                if (item.status === 'pending') {
                    item = await this._doRequestUpload(uploadId, tripToken, item);
                    continue;
                }

                // State: requesting → uploading
                if (item.status === 'requesting') {
                    if (!file) {
                        // File is unavailable after page reload - cannot resume
                        throw new Error('File unavailable after page reload — retry from UI');
                    }
                    item = await this._doUploadBlocks(uploadId, tripToken, file, item);
                    continue;
                }

                // State: uploading → committing
                if (item.status === 'uploading') {
                    item = await this._doCommit(uploadId, tripToken, item, file);
                    continue;
                }

                // State: committing → committed
                if (item.status === 'committing') {
                    item = await this._markCommitted(uploadId, tripToken, item, callbacks);
                    continue;
                }

                // No more state transitions needed
                break;
            }
        } catch (err) {
            // Mark item as failed
            await this._markFailed(uploadId, tripToken, err);
        }
    },

    /**
     * Claim item ownership via BroadcastChannel
     * Implements cross-tab singleton: only one tab processes a given upload_id
     * @private
     */
    async _claimItem(uploadId, tripToken) {
        const channelName = `roadtrip-uploads-${tripToken}`;
        let channel = this._channels.get(tripToken);

        if (!channel) {
            channel = new BroadcastChannel(channelName);
            this._channels.set(tripToken, channel);

            // Set up listener for claim/owned messages
            channel.addEventListener('message', (event) => {
                const { type, uploadId: claimedUploadId, claimantId, respondTo } = event.data || {};

                if (type === 'claim') {
                    // Another tab is claiming an upload_id
                    // If we already own it and are past requesting, respond with ownership
                    if (respondTo !== this._claimantId && this._processingPromises.has(claimedUploadId)) {
                        channel.postMessage({
                            type: 'owned',
                            uploadId: claimedUploadId,
                            claimantId: this._claimantId,
                        });
                    }
                }
            });
        }

        // Broadcast claim for this upload_id
        // Wait for either acknowledgment of ownership or timeout
        let isOwned = true;
        const claimPromise = new Promise((resolve) => {
            const handler = (event) => {
                const { type, uploadId: responseUploadId, claimantId } = event.data || {};
                if (type === 'owned' && responseUploadId === uploadId && claimantId !== this._claimantId) {
                    // Another tab owns this upload; yield
                    isOwned = false;
                    cleanup();
                    resolve();
                }
            };

            const cleanup = () => {
                channel.removeEventListener('message', handler);
                clearTimeout(timeoutId);
            };

            const timeoutId = setTimeout(() => {
                cleanup();
                resolve();
            }, 100); // Short timeout to avoid blocking

            channel.addEventListener('message', handler);
        });

        // Broadcast the claim message
        channel.postMessage({
            type: 'claim',
            uploadId,
            claimantId: this._claimantId,
            respondTo: this._claimantId,
        });

        // Wait for claim protocol to settle
        await claimPromise;

        return isOwned;
    },

    /**
     * Request upload from server
     * @private
     */
    async _doRequestUpload(uploadId, tripToken, item) {
        try {
            await StorageAdapter.updateItemStatus(uploadId, 'requesting');

            const response = await API.requestUpload(tripToken, {
                upload_id: uploadId,
                filename: item.filename,
                content_type: item.content_type || 'application/octet-stream',
                size_bytes: item.size,
                exif: item.exif,
            });

            await StorageAdapter.updateItemStatus(uploadId, 'requesting', {
                photo_id: response.photoId,
                sas_url: response.sasUrl,
                blob_path: response.blobPath,
            });

            return await StorageAdapter.getItem(uploadId);
        } catch (err) {
            console.error(`Request upload failed for ${uploadId}:`, err.message);
            throw err;
        }
    },

    /**
     * Upload blocks to Azure
     * @private
     */
    async _doUploadBlocks(uploadId, tripToken, file, item) {
        try {
            await StorageAdapter.updateItemStatus(uploadId, 'uploading');

            const semaphores = UploadConcurrency.create({
                perFile: 3,
                global: 9,
            });

            await UploadTransport.uploadFile({
                file,
                uploadId,
                tripToken,
                photoId: item.photo_id,
                sasUrl: item.sas_url,
                storageAdapter: StorageAdapter,
                semaphores,
                onSasExpired: (uid) => this._refreshSas(uid, tripToken),
            });

            return await StorageAdapter.getItem(uploadId);
        } catch (err) {
            console.error(`Upload blocks failed for ${uploadId}:`, err.message);
            throw err;
        }
    },

    /**
     * Refresh SAS URL when expired
     * @private
     */
    async _refreshSas(uploadId, tripToken) {
        const item = await StorageAdapter.getItem(uploadId);

        const response = await API.requestUpload(tripToken, {
            upload_id: uploadId,
            filename: item.filename,
            content_type: item.content_type || 'application/octet-stream',
            size_bytes: item.size,
            exif: item.exif,
        });

        await StorageAdapter.updateItemStatus(uploadId, 'uploading', {
            sas_url: response.sasUrl,
        });

        return response.sasUrl;
    },

    /**
     * Commit blocks to create the final blob
     * @private
     */
    async _doCommit(uploadId, tripToken, item, file) {
        try {
            await StorageAdapter.updateItemStatus(uploadId, 'committing');

            const blocks = await StorageAdapter.listBlocks(uploadId);
            const blockIds = blocks
                .filter(b => b.status === 'done')
                .map(b => b.block_id);

            try {
                await API.commit(tripToken, item.photo_id, blockIds);
                return await StorageAdapter.getItem(uploadId);
            } catch (err) {
                // Handle BlockListMismatch: when local blocks are done but server doesn't see them
                // (happens after >7 days of uncommitted blocks)
                if (err.code === 'BlockListMismatch') {
                    const retryCount = this._blockListMismatchRetries.get(uploadId) || 0;

                    if (retryCount === 0) {
                        // First occurrence: reset blocks and retry from upload
                        this._blockListMismatchRetries.set(uploadId, 1);

                        // Reset all blocks to pending
                        for (const block of blocks) {
                            await StorageAdapter.updateBlock(uploadId, block.block_id, {
                                status: 'pending',
                                attempts: 0,
                            });
                        }

                        // Request fresh upload session
                        const response = await API.requestUpload(tripToken, {
                            upload_id: uploadId,
                            filename: item.filename,
                            content_type: item.content_type || 'application/octet-stream',
                            size_bytes: item.size,
                            exif: item.exif,
                        });

                        await StorageAdapter.updateItemStatus(uploadId, 'uploading', {
                            sas_url: response.sasUrl,
                        });

                        // Re-upload blocks if we have the file
                        if (file) {
                            const semaphores = UploadConcurrency.create({
                                perFile: 3,
                                global: 9,
                            });

                            await UploadTransport.uploadFile({
                                file,
                                uploadId,
                                tripToken,
                                photoId: item.photo_id,
                                sasUrl: response.sasUrl,
                                storageAdapter: StorageAdapter,
                                semaphores,
                                onSasExpired: (uid) => this._refreshSas(uid, tripToken),
                            });

                            // Try commit again
                            const updatedBlocks = await StorageAdapter.listBlocks(uploadId);
                            const updatedBlockIds = updatedBlocks
                                .filter(b => b.status === 'done')
                                .map(b => b.block_id);

                            await API.commit(tripToken, item.photo_id, updatedBlockIds);
                        }

                        return await StorageAdapter.getItem(uploadId);
                    } else {
                        // Second occurrence: give up
                        throw err;
                    }
                }

                throw err;
            }
        } catch (err) {
            console.error(`Commit failed for ${uploadId}:`, err.message);
            throw err;
        }
    },

    /**
     * Mark item as committed
     * @private
     */
    async _markCommitted(uploadId, tripToken, item, callbacks) {
        await StorageAdapter.updateItemStatus(uploadId, 'committed', {
            last_activity_at: new Date().toISOString(),
        });

        // Clear retry counter
        this._blockListMismatchRetries.delete(uploadId);

        // Emit event
        document.dispatchEvent(
            new CustomEvent('upload:committed', {
                detail: {
                    uploadId,
                    photoId: item.photo_id,
                    tripToken,
                    exif: item.exif,
                },
            })
        );

        // Call callback
        if (callbacks && callbacks.onEachComplete) {
            callbacks.onEachComplete({
                id: item.photo_id,
                photoId: item.photo_id,
            });
        }

        return await StorageAdapter.getItem(uploadId);
    },

    /**
     * Mark item as failed
     * @private
     */
    async _markFailed(uploadId, tripToken, error) {
        const item = await StorageAdapter.getItem(uploadId);
        if (!item) return;

        await StorageAdapter.updateItemStatus(uploadId, 'failed', {
            error: error.message,
            last_activity_at: new Date().toISOString(),
        });

        // Clear retry counter
        this._blockListMismatchRetries.delete(uploadId);

        // Emit event
        document.dispatchEvent(
            new CustomEvent('upload:failed', {
                detail: {
                    uploadId,
                    reason: 'error',
                    error: error.message,
                },
            })
        );
    },
};
