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
};
