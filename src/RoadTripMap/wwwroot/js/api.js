/**
 * Road Trip Map API Client
 * Handles all API communication with the backend
 */

const API = {
    baseUrl: '/api',

    /**
     * Create a new trip
     * @param {string} name - Trip name (required)
     * @param {string} description - Trip description (optional)
     * @returns {Promise<{slug, secretToken, viewUrl, postUrl}>}
     */
    async createTrip(name, description) {
        const response = await fetch(`${this.baseUrl}/trips`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name,
                description,
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create trip');
        }

        return response.json();
    },

    /**
     * Reverse geocode coordinates to place name
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @returns {Promise<{placeName}>}
     */
    async geocode(lat, lng) {
        const response = await fetch(`${this.baseUrl}/geocode?lat=${lat}&lng=${lng}`);
        if (!response.ok) {
            throw new Error('Failed to geocode coordinates');
        }
        return response.json();
    },

    /**
     * Upload photo to trip
     * @param {string} secretToken - Trip secret token
     * @param {FormData} formData - Photo file and metadata
     * @returns {Promise<PhotoResponse>}
     */
    async uploadPhoto(secretToken, formData) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to upload photo');
        }
        return response.json();
    },

    /**
     * Delete photo from trip
     * @param {string} secretToken - Trip secret token
     * @param {number} photoId - Photo ID
     * @returns {Promise<void>}
     */
    async deletePhoto(secretToken, photoId) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/${photoId}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error('Failed to delete photo');
        }
    },

    /**
     * Update photo location
     * @param {string} secretToken - Trip secret token
     * @param {number} photoId - Photo ID
     * @param {number} lat - New latitude
     * @param {number} lng - New longitude
     * @returns {Promise<PhotoResponse>}
     */
    async updatePhotoLocation(secretToken, photoId, lat, lng) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/${photoId}/location`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to update location');
        }
        return response.json();
    },

    /**
     * List all photos for a trip (authenticated, for post page)
     * @param {string} secretToken - Trip secret token
     * @returns {Promise<PhotoResponse[]>}
     */
    async listTripPhotos(secretToken) {
        const response = await fetch(`${this.baseUrl}/post/${secretToken}/photos`);
        if (!response.ok) {
            throw new Error('Failed to load photos');
        }
        return response.json();
    },

    /**
     * Get trip info by secret token (for post page)
     * @param {string} secretToken - Trip secret token
     * @returns {Promise<{name, description, photoCount, createdAt}>}
     */
    async getTripInfoBySecret(secretToken) {
        const response = await fetch(`${this.baseUrl}/post/${secretToken}`);
        if (!response.ok) throw new Error('Trip not found');
        return response.json();
    },

    /**
     * Get trip info by view token
     * @param {string} viewToken - Trip view token
     * @returns {Promise<{name, description, photoCount, createdAt}>}
     */
    async getTripInfo(viewToken) {
        const response = await fetch(`${this.baseUrl}/trips/view/${viewToken}`);
        if (!response.ok) throw new Error('Trip not found');
        return response.json();
    },

    /**
     * Get trip photos by view token
     * @param {string} viewToken - Trip view token
     * @returns {Promise<PhotoResponse[]>}
     */
    async getTripPhotos(viewToken) {
        const response = await fetch(`${this.baseUrl}/trips/view/${viewToken}/photos`);
        if (!response.ok) throw new Error('Failed to load photos');
        return response.json();
    },

    /**
     * Fetch POIs within map bounds and zoom level
     * @param {maplibregl.LngLatBounds} bounds - Map bounds from map.getBounds()
     * @param {number} zoom - Current zoom level from map.getZoom()
     * @returns {Promise<Array>} - Array of POI objects or empty array on error
     */
    async fetchPois(bounds, zoom) {
        const params = new URLSearchParams({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
            zoom: Math.floor(zoom)
        });
        const response = await fetch(`${this.baseUrl}/poi?${params}`);
        if (!response.ok) return [];
        return response.json();
    },

    /**
     * Fetch state park boundaries within map bounds and zoom level
     * @param {maplibregl.LngLatBounds} bounds - Map bounds from map.getBounds()
     * @param {number} zoom - Current zoom level from map.getZoom()
     * @param {string} [detail='moderate'] - Detail level for boundary simplification
     * @returns {Promise<Object>} - GeoJSON FeatureCollection of park boundaries
     */
    async fetchParkBoundaries(bounds, zoom, detail = 'moderate') {
        const params = new URLSearchParams({
            minLat: bounds.getSouth(),
            maxLat: bounds.getNorth(),
            minLng: bounds.getWest(),
            maxLng: bounds.getEast(),
            zoom: Math.floor(zoom),
            detail: detail
        });
        const response = await fetch(`${this.baseUrl}/park-boundaries?${params}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Failed to fetch park boundaries: ${response.status}`);
        }
        return response.json();
    },

    /**
     * Request a new upload session and receive SAS URL for block uploads
     * @param {string} secretToken - Trip secret token
     * @param {Object} body - Request body { upload_id, filename, content_type, size_bytes, exif }
     * @returns {Promise<{photoId, sas_url, blob_path}>}
     */
    async requestUpload(secretToken, body) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/request-upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const errorObj = new Error(error.message || error.error || 'Failed to request upload');
            errorObj.code = error.code;
            throw errorObj;
        }
        return response.json();
    },

    /**
     * Commit uploaded blocks to finalize a photo
     * @param {string} secretToken - Trip secret token
     * @param {string} photoId - Photo ID (GUID)
     * @param {Array<string>} blockIds - Array of block IDs in upload order
     * @returns {Promise<PhotoResponse>}
     */
    async commit(secretToken, photoId, blockIds) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/${photoId}/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blockIds })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const errorObj = new Error(error.message || error.error || 'Failed to commit upload');
            errorObj.code = error.code;
            throw errorObj;
        }
        return response.json();
    },

    /**
     * Abort an in-flight upload
     * @param {string} secretToken - Trip secret token
     * @param {string} photoId - Photo ID (GUID)
     * @returns {Promise<void>}
     */
    async abort(secretToken, photoId) {
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/${photoId}/abort`, {
            method: 'POST'
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to abort upload');
        }
    },

    /**
     * Get current server version and minimum required client version
     * @returns {Promise<{server_version, client_min_version}>}
     */
    async getVersion() {
        const response = await fetch(`${this.baseUrl}/version`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to get version');
        }
        return response.json();
    },

    /**
     * Manually update a photo's GPS coordinates via pin-drop
     * @param {string} secretToken - Trip secret token
     * @param {Object} body - Request body { photoId, gpsLat, gpsLon }
     * @returns {Promise<PhotoResponse>}
     */
    async pinDropPhoto(secretToken, body) {
        const { photoId, gpsLat, gpsLon } = body;
        const response = await fetch(`${this.baseUrl}/trips/${secretToken}/photos/${photoId}/pin-drop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gpsLat, gpsLon })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const errorObj = new Error(error.message || error.error || 'Failed to pin-drop photo');
            errorObj.code = error.code;
            throw errorObj;
        }
        return response.json();
    },
};
