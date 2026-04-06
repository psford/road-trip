/**
 * Map Cache Module
 * Persistent IndexedDB-backed cache for map data (boundaries, POIs, etc.)
 * Keyed by composite string {type}_{id}_{detailLevel}
 * No TTL or expiration — entries persist indefinitely
 */

const MapCache = {
    _db: null,
    _dbName: 'roadtripmap-cache',
    _storeName: 'map-data',
    _version: 1,

    /**
     * Lazy-open IndexedDB connection, cache in _db
     * On first call, creates object store if needed (onupgradeneeded)
     * Subsequent calls return cached _db
     * Wraps in try/catch — if IndexedDB unavailable (private browsing),
     * silently returns null and methods fail gracefully
     *
     * @returns {Promise<IDBDatabase|null>}
     * @private
     */
    async _getDb() {
        if (this._db) {
            return this._db;
        }

        try {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this._dbName, this._version);

                request.onerror = () => {
                    console.warn('IndexedDB unavailable (may be private browsing)');
                    this._db = null;
                    resolve(null);
                };

                request.onsuccess = () => {
                    this._db = request.result;
                    resolve(this._db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create object store with 'key' as keyPath
                    if (!db.objectStoreNames.contains(this._storeName)) {
                        const store = db.createObjectStore(this._storeName, { keyPath: 'key' });
                        // Create indexes for filtering by type and id
                        store.createIndex('type', 'type', { unique: false });
                        store.createIndex('id', 'id', { unique: false });
                    }
                };
            });
        } catch (err) {
            console.warn('IndexedDB error:', err);
            this._db = null;
            return null;
        }
    },

    /**
     * Get cached data by type, id, and detail level
     *
     * @param {string} type - Data type (e.g., 'park-boundary')
     * @param {string|number} id - Entity ID (e.g., '123')
     * @param {string} detailLevel - Detail level (e.g., 'moderate', 'full')
     * @returns {Promise<Object|null>} Cached data object or null if not found
     */
    async get(type, id, detailLevel) {
        const db = await this._getDb();
        if (!db) {
            return null;
        }

        try {
            const key = `${type}_${id}_${detailLevel}`;
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this._storeName], 'readonly');
                const store = transaction.objectStore(this._storeName);
                const request = store.get(key);

                request.onerror = () => {
                    reject(new Error('Failed to get from cache'));
                };

                request.onsuccess = () => {
                    const entry = request.result;
                    resolve(entry ? entry.data : null);
                };
            });
        } catch (err) {
            console.warn('MapCache.get error:', err);
            return null;
        }
    },

    /**
     * Store data in cache by type, id, and detail level
     * Uses put (not add) so it overwrites existing entries for the same key
     *
     * @param {string} type - Data type (e.g., 'park-boundary')
     * @param {string|number} id - Entity ID (e.g., '123')
     * @param {string} detailLevel - Detail level (e.g., 'moderate', 'full')
     * @param {Object} data - Data to store (must include centroid/bbox for spatial queries)
     * @returns {Promise<void>}
     */
    async put(type, id, detailLevel, data) {
        const db = await this._getDb();
        if (!db) {
            return;
        }

        try {
            const key = `${type}_${id}_${detailLevel}`;
            const entry = {
                key,
                type,
                id,
                detailLevel,
                data
            };

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this._storeName], 'readwrite');
                const store = transaction.objectStore(this._storeName);
                const request = store.put(entry);

                request.onerror = () => {
                    reject(new Error('Failed to put to cache'));
                };

                request.onsuccess = () => {
                    resolve();
                };
            });
        } catch (err) {
            console.warn('MapCache.put error:', err);
        }
    },

    /**
     * Get all cached IDs of a given type within bounds
     * Opens cursor on type index and checks spatial intersection
     * The data field must include centroid or bbox for this check
     *
     * @param {string} type - Data type (e.g., 'park-boundary')
     * @param {Object} bounds - Viewport bounds { minLat, maxLat, minLng, maxLng }
     * @returns {Promise<Set<string|number>>} Set of matching IDs
     */
    async getIds(type, bounds) {
        const db = await this._getDb();
        if (!db) {
            return new Set();
        }

        try {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this._storeName], 'readonly');
                const store = transaction.objectStore(this._storeName);
                const typeIndex = store.index('type');
                const range = IDBKeyRange.only(type);
                const request = typeIndex.openCursor(range);

                const matchingIds = new Set();

                request.onerror = () => {
                    reject(new Error('Failed to query cache'));
                };

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const entry = cursor.value;
                        // Check if entry's data intersects with bounds
                        if (this._boundsIntersect(entry.data, bounds)) {
                            matchingIds.add(entry.id);
                        }
                        cursor.continue();
                    } else {
                        // Cursor iteration complete
                        resolve(matchingIds);
                    }
                };
            });
        } catch (err) {
            console.warn('MapCache.getIds error:', err);
            return new Set();
        }
    },

    /**
     * Clear all cached entries of a given type
     * Opens cursor on type index and deletes all matching entries
     *
     * @param {string} type - Data type (e.g., 'park-boundary')
     * @returns {Promise<void>}
     */
    async clear(type) {
        const db = await this._getDb();
        if (!db) {
            return;
        }

        try {
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this._storeName], 'readwrite');
                const store = transaction.objectStore(this._storeName);
                const typeIndex = store.index('type');
                const range = IDBKeyRange.only(type);
                const request = typeIndex.openCursor(range);

                request.onerror = () => {
                    reject(new Error('Failed to clear cache'));
                };

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        cursor.continue();
                    } else {
                        // Cursor iteration complete
                        resolve();
                    }
                };
            });
        } catch (err) {
            console.warn('MapCache.clear error:', err);
        }
    },

    /**
     * Check if entry data bounds intersect with viewport bounds
     * Entry data must include centroid or bbox property
     *
     * @param {Object} entryData - Entry data with centroid or bbox
     * @param {Object} bounds - Viewport bounds { minLat, maxLat, minLng, maxLng }
     * @returns {boolean} True if bounds intersect
     * @private
     */
    _boundsIntersect(entryData, bounds) {
        // Handle case where entryData has centroid property
        if (entryData.centroid) {
            const lat = entryData.centroid.lat || entryData.centroid[0];
            const lng = entryData.centroid.lng || entryData.centroid[1];
            return lat >= bounds.minLat && lat <= bounds.maxLat &&
                   lng >= bounds.minLng && lng <= bounds.maxLng;
        }

        // Handle case where entryData has bbox property
        if (entryData.bbox) {
            const [minLng, minLat, maxLng, maxLat] = entryData.bbox;
            return !(maxLng < bounds.minLng || minLng > bounds.maxLng ||
                     maxLat < bounds.minLat || minLat > bounds.maxLat);
        }

        // If neither centroid nor bbox, cannot determine intersection
        return false;
    }
};
