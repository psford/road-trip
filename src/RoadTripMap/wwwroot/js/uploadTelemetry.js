/**
 * Structured upload telemetry module
 * Records telemetry events for observability across the upload pipeline
 *
 * If window.appInsights is available, calls appInsights.trackEvent()
 * Otherwise logs structured JSON via console.info() for server-side consumption
 *
 * Telemetry Sanitization (ACX.1):
 * - Never include SAS URLs in any payload
 * - Never include blob paths with secret tokens
 * - Never include GPS coordinates
 * - Use tripTokenPrefix (first 4 chars) for safe logging
 */

const UploadTelemetry = {
    /**
     * Get safe trip token prefix (first 4 chars) for logging
     * @param {string} tripToken - Full trip secret token
     * @returns {string} First 4 characters of token
     */
    getTripTokenPrefix(tripToken) {
        if (!tripToken || tripToken.length < 4) {
            return 'xxxx';
        }
        return tripToken.substring(0, 4);
    },

    /**
     * Record a telemetry event
     *
     * @param {string} eventName - Event name (e.g., 'upload.requested')
     * @param {Object} payload - Event payload (sanitized)
     *
     * Supported events:
     * - upload.requested { uploadId, tripTokenPrefix, sizeBytes, exifPresent }
     * - upload.block_completed { uploadId, blockIndex, attempts, durationMs }
     * - upload.block_retry { uploadId, blockIndex, attempt, statusCode, nextBackoffMs }
     * - upload.committed { uploadId, photoId, totalDurationMs, blockCount }
     * - upload.failed { uploadId, reason, lastError, attemptCount }
     * - upload.sas_refreshed { uploadId }
     * - upload.resumed { uploadId, remainingBlocks }
     */
    record(eventName, payload = {}) {
        const timestamp = new Date().toISOString();
        const event = {
            event: eventName,
            ...payload,
            ts: timestamp
        };

        // Check if App Insights is available
        if (typeof window !== 'undefined' && window.appInsights) {
            // Use App Insights if available
            window.appInsights.trackEvent({
                name: eventName,
                properties: payload,
                measurements: {}
            });
        } else {
            // Fall back to console logging for DevTools inspection and server-side log aggregation
            console.info(JSON.stringify(event));
        }
    },

    /**
     * Record upload.requested event
     */
    recordUploadRequested(uploadId, tripToken, sizeBytes, exifPresent = false) {
        this.record('upload.requested', {
            uploadId,
            tripTokenPrefix: this.getTripTokenPrefix(tripToken),
            sizeBytes,
            exifPresent
        });
    },

    /**
     * Record upload.block_completed event
     */
    recordBlockCompleted(uploadId, blockIndex, attempts, durationMs) {
        this.record('upload.block_completed', {
            uploadId,
            blockIndex,
            attempts,
            durationMs
        });
    },

    /**
     * Record upload.block_retry event
     */
    recordBlockRetry(uploadId, blockIndex, attempt, statusCode, nextBackoffMs) {
        this.record('upload.block_retry', {
            uploadId,
            blockIndex,
            attempt,
            statusCode,
            nextBackoffMs
        });
    },

    /**
     * Record upload.committed event
     */
    recordCommitted(uploadId, photoId, totalDurationMs, blockCount) {
        this.record('upload.committed', {
            uploadId,
            photoId,
            totalDurationMs,
            blockCount
        });
    },

    /**
     * Record upload.failed event
     */
    recordFailed(uploadId, reason, lastError = null, attemptCount = 0) {
        this.record('upload.failed', {
            uploadId,
            reason,
            lastError: lastError ? lastError.substring(0, 200) : null, // Truncate error messages
            attemptCount
        });
    },

    /**
     * Record upload.sas_refreshed event
     */
    recordSasRefreshed(uploadId) {
        this.record('upload.sas_refreshed', {
            uploadId
        });
    },

    /**
     * Record upload.resumed event
     */
    recordResumed(uploadId, remainingBlocks) {
        this.record('upload.resumed', {
            uploadId,
            remainingBlocks
        });
    },

    /**
     * Record processing.applied event
     * @param {string} uploadId - Upload ID
     * @param {Object} details - { compressionApplied, heicConverted, originalBytes, outputBytes, durationMs }
     */
    recordProcessingApplied(uploadId, details) {
        this.record('processing.applied', {
            uploadId,
            compressionApplied: details.compressionApplied,
            heicConverted: details.heicConverted,
            originalBytes: details.originalBytes,
            outputBytes: details.outputBytes,
            durationMs: details.durationMs,
            reductionPercent: details.originalBytes > 0
                ? Math.round((1 - details.outputBytes / details.originalBytes) * 100)
                : 0,
        });
    },

    /**
     * Record processing.failed event
     * @param {string} uploadId - Upload ID
     * @param {string} errorMessage - Error message
     */
    recordProcessingFailed(uploadId, errorMessage) {
        this.record('processing.failed', {
            uploadId,
            error: errorMessage,
        });
    }
};
