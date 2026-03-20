/**
 * Road Trip Map Service
 * Data layer for map view — no DOM references, designed for native app portability
 * Handles API calls, state management, and coordinate transformations
 */

const MapService = {
    /**
     * Load trip and photos from API
     * @param {string} slug - Trip slug
     * @returns {Promise<{trip, photos}>}
     */
    async loadTrip(slug) {
        const [trip, photos] = await Promise.all([
            API.getTripInfo(slug),
            API.getTripPhotos(slug)
        ]);
        return { trip, photos };
    },

    /**
     * Extract route coordinates from photos for polyline rendering
     * @param {Array} photos - Array of PhotoResponse objects
     * @returns {Array<[lat, lng]>} - Array of coordinate pairs in Leaflet format
     */
    getRouteCoordinates(photos) {
        return photos.map(p => [p.lat, p.lng]);
    }
};
