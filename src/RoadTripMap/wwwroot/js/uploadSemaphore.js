/**
 * Semaphore for controlling concurrent operations
 * Limits the number of concurrent acquires to a fixed capacity
 */
const UploadSemaphore = class {
    constructor(capacity) {
        this.capacity = capacity;
        this.current = 0;
        this.queue = [];
    }

    /**
     * Acquire a slot
     * @returns {Promise<Function>} Promise that resolves with a release function
     */
    acquire() {
        return new Promise((resolve) => {
            if (this.current < this.capacity) {
                this.current++;
                resolve(() => {
                    this.current--;
                    this._processQueue();
                });
            } else {
                this.queue.push(resolve);
            }
        });
    }

    _processQueue() {
        if (this.queue.length > 0 && this.current < this.capacity) {
            const resolve = this.queue.shift();
            this.current++;
            resolve(() => {
                this.current--;
                this._processQueue();
            });
        }
    }
};

/**
 * Nested concurrency control: per-file semaphore + global semaphore
 * Acquires per-file first, then global, releasing in reverse order
 */
const UploadConcurrency = {
    /**
     * Create a concurrency controller
     * @param {{perFile: number, global: number}} config - Concurrency limits
     * @returns {{acquireForBlock(uploadId): Promise<Function>}}
     */
    create(config) {
        const perFileSemaphores = new Map();
        const globalSemaphore = new UploadSemaphore(config.global);

        return {
            /**
             * Acquire a slot for a block upload
             * Acquires per-file first, then global
             * Release function releases in reverse order
             * @param {string} uploadId - Upload ID (correlates blocks for same file)
             * @returns {Promise<Function>} Release function
             */
            async acquireForBlock(uploadId) {
                // Get or create per-file semaphore
                if (!perFileSemaphores.has(uploadId)) {
                    perFileSemaphores.set(uploadId, new UploadSemaphore(config.perFile));
                }
                const perFileSem = perFileSemaphores.get(uploadId);

                // Acquire per-file first
                const releasePerFile = await perFileSem.acquire();

                // Then acquire global
                const releaseGlobal = await globalSemaphore.acquire();

                // Return release function that releases in reverse order
                return () => {
                    releaseGlobal();
                    releasePerFile();
                };
            }
        };
    }
};
