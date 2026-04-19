/**
 * Block upload transport with retry, backoff, and SAS refresh
 * Implements AC3.2 (retry with backoff), AC3.3 (failure after 6 attempts), AC3.5 (SAS refresh)
 */

const _uploadTransportImpl = {
    /**
     * Error class for transient failures that should be retried
     */
    RetryableError: class extends Error {
        constructor(message) {
            super(message);
            this.name = 'RetryableError';
        }
    },

    /**
     * Error class for permanent failures that should not be retried
     */
    PermanentError: class extends Error {
        constructor(message) {
            super(message);
            this.name = 'PermanentError';
        }
    },

    /**
     * Error class for SAS token expiration (triggers refresh)
     * Extends RetryableError so it can be caught and retried with new SAS URL
     */
    SasExpiredError: class extends Error {
        constructor(message) {
            super(message);
            this.name = 'SasExpiredError';
        }
    },

    /**
     * Upload a single block to Azure Blob Storage
     *
     * @param {string} sasUrl - Base SAS URL (without comp=block and blockid params)
     * @param {string} blockId - Azure block ID (must be base64-encoded)
     * @param {Blob} blob - File chunk to upload
     * @param {Object} options - Options object
     * @param {AbortSignal} options.signal - Abort signal for cancellation
     * @returns {Promise<void>}
     * @throws {SasExpiredError} on 403 (SAS token expired)
     * @throws {RetryableError} on 408, 429, 500, 503
     * @throws {PermanentError} on all other errors (400, etc.)
     */
    async putBlock(sasUrl, blockId, blob, { signal }) {
        // Build URL with Azure blob storage query parameters
        const url = new URL(sasUrl);
        url.searchParams.set('comp', 'block');
        url.searchParams.set('blockid', blockId);

        const response = await fetch(url.toString(), {
            method: 'PUT',
            body: blob,
            headers: {
                'x-ms-blob-type': 'BlockBlob',
            },
            signal,
        });

        // Handle response status
        if (response.status === 201) {
            // Success: block uploaded
            return;
        }

        if (response.status === 403) {
            // SAS token expired or invalid — caller will refresh and retry
            throw new UploadTransport.SasExpiredError('SAS token expired (403)');
        }

        if ([408, 429, 500, 503].includes(response.status)) {
            // Transient failure — retry with backoff
            throw new UploadTransport.RetryableError(
                `Transient upload error: ${response.status}`
            );
        }

        // All other errors are permanent
        throw new UploadTransport.PermanentError(
            `Permanent upload error: ${response.status}`
        );
    },

    /**
     * Upload entire file as blocks with retry, backoff, and SAS refresh
     * Implements AC3.2 (exponential backoff retry), AC3.3 (failure after 6 attempts),
     * AC3.5 (SAS refresh on 403)
     *
     * @param {Object} params
     * @param {File} params.file - File to upload
     * @param {string} params.uploadId - Upload session ID (for idempotency)
     * @param {string} params.tripToken - Trip secret token
     * @param {string} params.photoId - Photo ID from server
     * @param {string} params.sasUrl - SAS URL for block uploads
     * @param {Object} params.storageAdapter - IndexedDB adapter for persisting block state
     * @param {Object} params.semaphores - Concurrency control (per-file + global)
     * @param {Function} params.onProgress - Progress callback (optional)
     * @param {Function} params.onSasExpired - Callback when SAS expires, returns new URL
     * @returns {Promise<Array<string>>} Array of block IDs in order
     * @throws {Error} If all retries exhausted or permanent error occurs
     */
    async uploadFile({
        file,
        uploadId,
        tripToken,
        photoId,
        sasUrl,
        storageAdapter,
        semaphores,
        onProgress,
        onSasExpired,
    }) {
        const maxRetries = 6; // AC3.3: fail after 6 attempts
        const blockIds = [];
        let currentSasUrl = sasUrl;

        // Determine which blocks need uploading
        let existingBlocks = await storageAdapter.listBlocks(uploadId);
        let blocksToUpload = [];

        if (existingBlocks.length === 0) {
            // First time: slice file into blocks
            for (const { index, blockId, blob, start, end } of UploadUtils.sliceFile(file)) {
                blocksToUpload.push({
                    index,
                    blockId,
                    blob,
                    start,
                    end,
                    attempts: 0,
                });
                // Initialize block state in storage
                await storageAdapter.putBlock(uploadId, blockId, {
                    block_id: blockId,
                    status: 'pending',
                    attempts: 0,
                });
            }
        } else {
            // Resume: load pending and failed blocks
            blocksToUpload = existingBlocks
                .filter(b => b.status === 'pending' || b.status === 'failed')
                .map((b, idx) => ({
                    index: idx,
                    blockId: b.block_id,
                    blob: null, // Will be re-sliced from file
                    attempts: b.attempts || 0,
                    _fromStorage: true,
                }));

            // Re-slice file to get blob data for resumed blocks
            const slices = Array.from(UploadUtils.sliceFile(file));
            for (let i = 0; i < blocksToUpload.length; i++) {
                const matching = slices.find(s => s.blockId === blocksToUpload[i].blockId);
                if (matching) {
                    blocksToUpload[i].blob = matching.blob;
                }
            }
        }

        // Build complete list of block IDs in order (for return value)
        if (existingBlocks.length > 0) {
            // Use existing blocks to maintain order
            blockIds.push(...existingBlocks.map(b => b.block_id));
        } else {
            // Use new blocks in order
            blockIds.push(...blocksToUpload.map(b => b.blockId));
        }

        // Upload each block with retry logic
        for (const blockInfo of blocksToUpload) {
            let lastError = null;
            let uploadSucceeded = false;

            // Acquire semaphore for this block (per-file + global)
            const release = await semaphores.acquireForBlock(uploadId);

            try {
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    const blockStartMs = Date.now();
                    try {
                        // Upload block
                        await UploadTransport.putBlock(
                            currentSasUrl,
                            blockInfo.blockId,
                            blockInfo.blob,
                            { signal: new AbortController().signal }
                        );

                        // Success: record block as done
                        await storageAdapter.updateBlock(uploadId, blockInfo.blockId, {
                            status: 'done',
                            attempts: attempt,
                        });

                        // Record block completion telemetry
                        UploadTelemetry.recordBlockCompleted(uploadId, blockInfo.index, attempt, Date.now() - blockStartMs);

                        lastError = null;
                        uploadSucceeded = true;
                        break; // Exit retry loop
                    } catch (error) {
                        lastError = error;

                        // Handle SAS expiry: refresh and retry
                        if (error instanceof UploadTransport.SasExpiredError) {
                            // Call onSasExpired to get fresh SAS URL
                            const newSasUrl = await onSasExpired(uploadId);
                            currentSasUrl = newSasUrl;
                            // Retry with new URL (decrement attempt to not count this toward max retries)
                            attempt--;
                            continue;
                        }

                        // Handle permanent errors: record as failed and throw immediately
                        if (error instanceof UploadTransport.PermanentError) {
                            await storageAdapter.updateBlock(uploadId, blockInfo.blockId, {
                                status: 'failed',
                                error: error.message,
                            });
                            throw error;
                        }

                        // Handle retryable errors: wait and retry
                        if (error instanceof UploadTransport.RetryableError) {
                            if (attempt < maxRetries - 1) {
                                // Record retry telemetry
                                const statusMatch = error.message.match(/\b([45]\d{2})\b/);
                                const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
                                const delayMs = UploadUtils.backoffMs(attempt);
                                UploadTelemetry.recordBlockRetry(uploadId, blockInfo.index, attempt + 1, statusCode, delayMs);

                                // Sleep before retry using backoff
                                await new Promise(resolve => setTimeout(resolve, delayMs));
                                continue;
                            }
                            // All retries exhausted, will record failure after loop
                        }

                        // Unknown error type: record as failed and throw
                        await storageAdapter.updateBlock(uploadId, blockInfo.blockId, {
                            status: 'failed',
                            error: error.message,
                        });
                        throw error;
                    }
                }

                // If we exited loop without success and have a retryable error, record and throw
                if (!uploadSucceeded && lastError && lastError instanceof UploadTransport.RetryableError) {
                    // Record block as failed
                    await storageAdapter.updateBlock(uploadId, blockInfo.blockId, {
                        status: 'failed',
                        error: lastError.message,
                    });
                    throw lastError;
                }
            } finally {
                // Always release semaphore
                release();
            }
        }

        // Return block IDs in order
        return blockIds;
    },
};

// Exported transport for use in uploadQueue.js and tests
// Phase 6 will add platform detection and iOS-specific adapter (native BackgroundUpload.enqueue)
const UploadTransport = _uploadTransportImpl;
