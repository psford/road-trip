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
};
