/**
 * Storage Adapter for upload queue persistence
 * Uses IndexedDB with graceful fallback to in-memory Map storage
 * Implements the pattern from mapCache.js for consistency
 */

const _storageAdapterImpl = {
    _db: null,
    _dbName: 'RoadTripUploadQueue',
    _version: 1,
    _fallbackStore: null, // In-memory fallback when IndexedDB unavailable
    _hasLoggedWarning: false,

    /**
     * Initialize fallback in-memory store
     * @private
     */
    _initFallbackStore() {
        if (!this._fallbackStore) {
            this._fallbackStore = {
                items: new Map(), // upload_id -> item
                blocks: new Map() // "upload_id:block_id" -> block state
            };
        }
    },

    /**
     * Lazy-open IndexedDB connection with schema initialization
     * Creates stores with appropriate indices
     * Falls back to in-memory Map if unavailable
     * @returns {Promise<IDBDatabase|null>}
     * @private
     */
    async _getDb() {
        if (this._db !== null) {
            return this._db;
        }

        try {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this._dbName, this._version);

                request.onerror = () => {
                    if (!this._hasLoggedWarning) {
                        console.warn('IndexedDB unavailable for upload queue (falling back to in-memory storage)');
                        this._hasLoggedWarning = true;
                    }
                    this._db = null;
                    this._initFallbackStore();
                    resolve(null);
                };

                request.onsuccess = () => {
                    this._db = request.result;
                    resolve(this._db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create upload_items store
                    if (!db.objectStoreNames.contains('upload_items')) {
                        const itemStore = db.createObjectStore('upload_items', { keyPath: 'upload_id' });
                        itemStore.createIndex('by_status', 'status', { unique: false });
                        itemStore.createIndex('by_trip_token', 'trip_token', { unique: false });
                    }

                    // Create block_state store with composite key
                    if (!db.objectStoreNames.contains('block_state')) {
                        const blockStore = db.createObjectStore('block_state', { keyPath: ['upload_id', 'block_id'] });
                        blockStore.createIndex('by_upload', 'upload_id', { unique: false });
                    }
                };
            });
        } catch (err) {
            console.warn('IndexedDB initialization error:', err);
            this._db = null;
            this._initFallbackStore();
            return null;
        }
    },

    /**
     * Insert or update an upload item
     * @param {Object} item - Item with upload_id, trip_token, filename, size, exif, status, created_at, last_activity_at
     * @returns {Promise<void>}
     */
    async putItem(item) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['upload_items'], 'readwrite');
                    const store = transaction.objectStore('upload_items');
                    const request = store.put(item);

                    request.onerror = () => {
                        console.warn('Failed to put item to storage');
                        reject(new Error('Failed to put item'));
                    };

                    request.onsuccess = () => {
                        resolve();
                    };

                    transaction.onerror = () => {
                        reject(new Error('Transaction failed'));
                    };
                } catch (err) {
                    console.warn('StorageAdapter.putItem error:', err);
                    reject(err);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            this._fallbackStore.items.set(item.upload_id, item);
            return Promise.resolve();
        }
    },

    /**
     * Update item status and merge extra fields atomically
     * @param {string} uploadId - Upload ID
     * @param {string} status - New status
     * @param {Object} [extraFields] - Additional fields to merge
     * @returns {Promise<void>}
     */
    async updateItemStatus(uploadId, status, extraFields = {}) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['upload_items'], 'readwrite');
                    const store = transaction.objectStore('upload_items');
                    const getRequest = store.get(uploadId);

                    getRequest.onerror = () => {
                        reject(new Error('Failed to get item'));
                    };

                    getRequest.onsuccess = () => {
                        const item = getRequest.result;
                        if (item) {
                            item.status = status;
                            Object.assign(item, extraFields);
                            const putRequest = store.put(item);

                            putRequest.onerror = () => {
                                reject(new Error('Failed to update item'));
                            };

                            putRequest.onsuccess = () => {
                                resolve();
                            };
                        } else {
                            resolve();
                        }
                    };

                    transaction.onerror = () => {
                        reject(new Error('Transaction failed'));
                    };
                } catch (err) {
                    console.warn('StorageAdapter.updateItemStatus error:', err);
                    reject(err);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const item = this._fallbackStore.items.get(uploadId);
            if (item) {
                item.status = status;
                Object.assign(item, extraFields);
            }
            return Promise.resolve();
        }
    },

    /**
     * Get a single item by upload ID
     * @param {string} uploadId - Upload ID
     * @returns {Promise<Object|null>}
     */
    async getItem(uploadId) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['upload_items'], 'readonly');
                    const store = transaction.objectStore('upload_items');
                    const request = store.get(uploadId);

                    request.onerror = () => {
                        console.warn('Failed to get item from storage');
                        resolve(null);
                    };

                    request.onsuccess = () => {
                        resolve(request.result || null);
                    };

                    transaction.onerror = () => {
                        resolve(null);
                    };
                } catch (err) {
                    console.warn('StorageAdapter.getItem error:', err);
                    resolve(null);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const item = this._fallbackStore.items.get(uploadId);
            return Promise.resolve(item || null);
        }
    },

    /**
     * Get all items for a trip
     * @param {string} tripToken - Trip token
     * @returns {Promise<Array>}
     */
    async listByTrip(tripToken) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['upload_items'], 'readonly');
                    const store = transaction.objectStore('upload_items');
                    const index = store.index('by_trip_token');
                    const range = IDBKeyRange.only(tripToken);
                    const request = index.getAll(range);

                    request.onerror = () => {
                        console.warn('Failed to list items by trip');
                        resolve([]);
                    };

                    request.onsuccess = () => {
                        resolve(request.result || []);
                    };

                    transaction.onerror = () => {
                        resolve([]);
                    };
                } catch (err) {
                    console.warn('StorageAdapter.listByTrip error:', err);
                    resolve([]);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const results = Array.from(this._fallbackStore.items.values()).filter(
                item => item.trip_token === tripToken
            );
            return Promise.resolve(results);
        }
    },

    /**
     * Get all non-terminal items for a trip
     * Non-terminal statuses: pending, requesting, uploading, committing
     * @param {string} tripToken - Trip token
     * @returns {Promise<Array>}
     */
    async listNonTerminal(tripToken) {
        const allItems = await this.listByTrip(tripToken);
        const nonTerminalStatuses = new Set(['pending', 'requesting', 'uploading', 'committing']);
        return allItems.filter(item => nonTerminalStatuses.has(item.status));
    },

    /**
     * Insert or update block state
     * @param {string} uploadId - Upload ID
     * @param {string} blockId - Block ID
     * @param {Object} state - Block state (status, attempts, error, etc.)
     * @returns {Promise<void>}
     */
    async putBlock(uploadId, blockId, state) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['block_state'], 'readwrite');
                    const store = transaction.objectStore('block_state');
                    const blockRecord = {
                        upload_id: uploadId,
                        block_id: blockId,
                        ...state
                    };
                    const request = store.put(blockRecord);

                    request.onerror = () => {
                        console.warn('Failed to put block to storage');
                        reject(new Error('Failed to put block'));
                    };

                    request.onsuccess = () => {
                        resolve();
                    };

                    transaction.onerror = () => {
                        reject(new Error('Transaction failed'));
                    };
                } catch (err) {
                    console.warn('StorageAdapter.putBlock error:', err);
                    reject(err);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const key = `${uploadId}:${blockId}`;
            this._fallbackStore.blocks.set(key, {
                upload_id: uploadId,
                block_id: blockId,
                ...state
            });
            return Promise.resolve();
        }
    },

    /**
     * Get all blocks for an upload, ordered consistently
     * @param {string} uploadId - Upload ID
     * @returns {Promise<Array>}
     */
    async listBlocks(uploadId) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['block_state'], 'readonly');
                    const store = transaction.objectStore('block_state');
                    const index = store.index('by_upload');
                    const range = IDBKeyRange.only(uploadId);
                    const request = index.getAll(range);

                    request.onerror = () => {
                        console.warn('Failed to list blocks');
                        resolve([]);
                    };

                    request.onsuccess = () => {
                        const blocks = request.result || [];
                        // Sort by block_id for consistent ordering
                        blocks.sort((a, b) => a.block_id.localeCompare(b.block_id));
                        resolve(blocks);
                    };

                    transaction.onerror = () => {
                        resolve([]);
                    };
                } catch (err) {
                    console.warn('StorageAdapter.listBlocks error:', err);
                    resolve([]);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const blocks = Array.from(this._fallbackStore.blocks.values())
                .filter(block => block.upload_id === uploadId);
            blocks.sort((a, b) => a.block_id.localeCompare(b.block_id));
            return Promise.resolve(blocks);
        }
    },

    /**
     * Update a single block's state
     * @param {string} uploadId - Upload ID
     * @param {string} blockId - Block ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<void>}
     */
    async updateBlock(uploadId, blockId, updates) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['block_state'], 'readwrite');
                    const store = transaction.objectStore('block_state');
                    const getRequest = store.get([uploadId, blockId]);

                    getRequest.onerror = () => {
                        reject(new Error('Failed to get block'));
                    };

                    getRequest.onsuccess = () => {
                        const block = getRequest.result;
                        if (block) {
                            Object.assign(block, updates);
                            const putRequest = store.put(block);

                            putRequest.onerror = () => {
                                reject(new Error('Failed to update block'));
                            };

                            putRequest.onsuccess = () => {
                                resolve();
                            };
                        } else {
                            resolve();
                        }
                    };

                    transaction.onerror = () => {
                        reject(new Error('Transaction failed'));
                    };
                } catch (err) {
                    console.warn('StorageAdapter.updateBlock error:', err);
                    reject(err);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            const key = `${uploadId}:${blockId}`;
            const block = this._fallbackStore.blocks.get(key);
            if (block) {
                Object.assign(block, updates);
            }
            return Promise.resolve();
        }
    },

    /**
     * Delete an item and cascade delete all its blocks
     * @param {string} uploadId - Upload ID
     * @returns {Promise<void>}
     */
    async deleteItem(uploadId) {
        const db = await this._getDb();

        if (db) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(['upload_items', 'block_state'], 'readwrite');

                    // Delete the item
                    const itemStore = transaction.objectStore('upload_items');
                    const itemRequest = itemStore.delete(uploadId);

                    itemRequest.onerror = () => {
                        console.warn('Failed to delete item');
                        // Continue with block deletion even if item delete fails
                    };

                    // Delete all blocks for this upload
                    const blockStore = transaction.objectStore('block_state');
                    const index = blockStore.index('by_upload');
                    const range = IDBKeyRange.only(uploadId);
                    const cursorRequest = index.openCursor(range);

                    cursorRequest.onerror = () => {
                        console.warn('Failed to delete blocks');
                    };

                    cursorRequest.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            cursor.delete();
                            cursor.continue();
                        }
                    };

                    transaction.onerror = () => {
                        reject(new Error('Transaction failed'));
                    };

                    transaction.oncomplete = () => {
                        resolve();
                    };
                } catch (err) {
                    console.warn('StorageAdapter.deleteItem error:', err);
                    reject(err);
                }
            });
        } else {
            // Fallback to in-memory
            this._initFallbackStore();
            this._fallbackStore.items.delete(uploadId);

            // Delete all blocks for this upload
            const keysToDelete = [];
            for (const key of this._fallbackStore.blocks.keys()) {
                if (key.startsWith(`${uploadId}:`)) {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => this._fallbackStore.blocks.delete(key));

            return Promise.resolve();
        }
    }
};

// Exported adapter for use in uploadQueue.js and tests
// Phase 6 will add platform detection and iOS-specific adapter (createSqliteAdapter)
const StorageAdapter = _storageAdapterImpl;
