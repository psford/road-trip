describe('API.fetchParkBoundaries', () => {
    const mockBounds = {
        getSouth: () => 47.0,
        getNorth: () => 48.0,
        getWest: () => -122.0,
        getEast: () => -121.0,
    };

    it('constructs correct URL with query params', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ type: 'FeatureCollection', features: [] })
        });

        await API.fetchParkBoundaries(mockBounds, 9.7, 'moderate');

        const [url] = fetch.mock.calls[0];
        expect(url).toContain('/api/park-boundaries');
        expect(url).toContain('minLat=47');
        expect(url).toContain('maxLat=48');
        expect(url).toContain('zoom=9'); // Math.floor
        expect(url).toContain('detail=moderate');
    });

    it('defaults to moderate detail', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ type: 'FeatureCollection', features: [] })
        });

        await API.fetchParkBoundaries(mockBounds, 10);
        const [url] = fetch.mock.calls[0];
        expect(url).toContain('detail=moderate');
    });

    it('throws on non-ok response with error message', async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Missing minLat' })
        });

        await expect(API.fetchParkBoundaries(mockBounds, 10))
            .rejects.toThrow('Missing minLat');
    });

    it('throws generic message when error JSON fails', async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => { throw new Error('not json'); }
        });

        await expect(API.fetchParkBoundaries(mockBounds, 10))
            .rejects.toThrow('Failed to fetch park boundaries: 500');
    });
});

describe('API.fetchPois', () => {
    const mockBounds = {
        getSouth: () => 42.0,
        getNorth: () => 43.0,
        getWest: () => -72.0,
        getEast: () => -71.0,
    };

    it('constructs correct URL', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ([])
        });

        await API.fetchPois(mockBounds, 10);
        const [url] = fetch.mock.calls[0];
        expect(url).toContain('/api/poi');
        expect(url).toContain('minLat=42');
        expect(url).toContain('zoom=10');
    });
});
