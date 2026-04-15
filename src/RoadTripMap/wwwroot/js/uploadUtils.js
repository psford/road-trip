/**
 * Upload utilities for resilient photo uploads
 * Provides backoff calculation, block ID generation, file slicing, and log sanitization
 */

const UploadUtils = {
    /**
     * Calculate backoff delay with decorrelated jitter
     * Formula: min(2^attempt * 1000, 30000) + jitter(0, min(cap, 3 * base) - base)
     * @param {number} attempt - Attempt number (0-indexed)
     * @returns {number} Milliseconds to wait before retry
     */
    backoffMs(attempt) {
        const base = 1000;
        const cap = 30000;
        const exponential = Math.pow(2, attempt) * base;
        const baseDelay = Math.min(exponential, cap);

        // Jitter: random value between 0 and min(3 * base, cap) - base
        const maxJitter = Math.min(3 * base, cap) - base;
        const jitter = Math.random() * maxJitter;

        return Math.floor(baseDelay + jitter);
    },

    /**
     * Generate a block ID for Azure blob storage
     * Azure requires all block IDs in a blob to have equal length
     * Returns a 64-character base64 string (8 bytes = 64 bits, base64 encodes to 12 chars, padded to 64)
     * @param {number} index - Block index (0-indexed)
     * @returns {string} 64-character base64-encoded block ID
     */
    makeBlockId(index) {
        // Create a 64-byte buffer filled with zeros, then set the last 8 bytes to the index
        // This ensures all block IDs have the same length when base64 encoded
        const buffer = new Uint8Array(64);
        // Write the index as a 64-bit big-endian integer to the last 8 bytes
        const view = new DataView(buffer.buffer);
        view.setBigInt64(56, BigInt(index), false); // big-endian

        // Convert to base64
        let binary = '';
        for (let i = 0; i < buffer.length; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        return btoa(binary);
    },

    /**
     * Generator: slice a file into chunks for upload
     * @param {Blob} file - File to slice
     * @param {number} [chunkSize=4194304] - Chunk size in bytes (default 4 MB)
     * @yields {{index: number, blockId: string, blob: Blob, start: number, end: number}}
     */
    *sliceFile(file, chunkSize = 4 * 1024 * 1024) {
        let index = 0;
        let start = 0;

        while (start < file.size) {
            const end = Math.min(start + chunkSize, file.size);
            const blob = file.slice(start, end);
            const blockId = this.makeBlockId(index);

            yield {
                index,
                blockId,
                blob,
                start,
                end
            };

            start = end;
            index++;
        }
    },

    /**
     * Redact sensitive parameters from a SAS URL for logging
     * Strips sig= and se= parameters but preserves other query params
     * @param {string} url - SAS URL
     * @returns {string} URL with sig and se values replaced with REDACTED
     */
    redactSasForLog(url) {
        return url
            .replace(/sig=[^&]*/g, 'sig=REDACTED')
            .replace(/se=[^&]*/g, 'se=REDACTED');
    },

    /**
     * Generate a new GUID
     * @returns {string} RFC 4122 v4 UUID
     */
    newGuid() {
        return crypto.randomUUID();
    }
};
