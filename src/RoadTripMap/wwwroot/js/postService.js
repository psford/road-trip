/**
 * Post Service - Pure data/state module for photo posting workflow
 * Zero DOM references. All business logic reusable in native apps.
 * Handles the posting workflow that would be used by iOS/Android apps.
 */

const PostService = {
    /**
     * Extract photo metadata (GPS and timestamp) from file EXIF
     * @param {File} file - Photo file
     * @returns {Promise<{gps: {latitude, longitude} | null, timestamp: Date | null, placeName: string | null}>}
     */
    async extractPhotoMetadata(file) {
        const { gps, timestamp } = await ExifUtil.extractAll(file);
        let placeName = null;

        if (gps) {
            try {
                const result = await API.geocode(gps.latitude, gps.longitude);
                placeName = result.placeName;
            } catch (err) {
                console.warn('Failed to geocode:', err);
                placeName = null;
            }
        }

        return { gps, timestamp, placeName };
    },

    /**
     * Upload photo to trip with metadata
     * @param {string} secretToken - Trip secret token
     * @param {File} file - Photo file
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {string | null} caption - Optional photo caption
     * @param {Date | null} takenAt - Optional photo timestamp
     * @returns {Promise<PhotoResponse>}
     */
    async uploadPhoto(secretToken, file, lat, lng, caption, takenAt) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('lat', lat);
        formData.append('lng', lng);
        if (caption) {
            formData.append('caption', caption);
        }
        if (takenAt) {
            formData.append('takenAt', takenAt.toISOString());
        }
        return API.uploadPhoto(secretToken, formData);
    },

    /**
     * Delete photo from trip
     * @param {string} secretToken - Trip secret token
     * @param {number} photoId - Photo ID
     * @returns {Promise<void>}
     */
    async deletePhoto(secretToken, photoId) {
        return API.deletePhoto(secretToken, photoId);
    },

    /**
     * List all photos for a trip
     * @param {string} secretToken - Trip secret token
     * @returns {Promise<PhotoResponse[]>}
     */
    async listPhotos(secretToken) {
        return API.listTripPhotos(secretToken);
    }
};
