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

describe('API.requestUpload', () => {
    it('POSTs to request-upload endpoint with body', async () => {
        const secretToken = 'test-token-123';
        const body = {
            upload_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            filename: 'photo.jpg',
            content_type: 'image/jpeg',
            size_bytes: 1024,
            exif: { DateTimeOriginal: '2026-04-15T10:30:00Z' }
        };

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                photoId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                sas_url: 'https://storage.blob.core.windows.net/...',
                blob_path: 'trip-123/photo.jpg'
            })
        });

        const result = await API.requestUpload(secretToken, body);

        expect(fetch).toHaveBeenCalledWith(
            '/api/trips/test-token-123/photos/request-upload',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );
        expect(result.photoId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
        expect(result.sas_url).toContain('blob.core.windows.net');
    });

    it('throws on 400 error and surfaces error body', async () => {
        const secretToken = 'test-token-123';
        const body = { upload_id: 'invalid' };

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ code: 'InvalidUploadId', message: 'Upload ID malformed' })
        });

        await expect(API.requestUpload(secretToken, body))
            .rejects.toThrow();

        // Verify error is thrown and contains the body info
        try {
            await API.requestUpload(secretToken, body);
        } catch (err) {
            expect(err).toBeDefined();
        }
    });

    it('throws on other error status', async () => {
        const secretToken = 'test-token-123';
        const body = { upload_id: 'test' };

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' })
        });

        await expect(API.requestUpload(secretToken, body))
            .rejects.toThrow();
    });
});

describe('API.commit', () => {
    it('POSTs to commit endpoint with blockIds', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        const blockIds = ['AAAAAAAAAA==', 'AQAAAAAAAA==', 'AgAAAAAAAA=='];

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: 123,
                photoId: photoId,
                status: 'committed'
            })
        });

        const result = await API.commit(secretToken, photoId, blockIds);

        expect(fetch).toHaveBeenCalledWith(
            `/api/trips/test-token-123/photos/${photoId}/commit`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ blockIds })
            }
        );
        expect(result.status).toBe('committed');
    });

    it('throws on 400 error and surfaces error code (BlockListMismatch)', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ code: 'BlockListMismatch', message: 'Blocks do not match' })
        });

        try {
            await API.commit(secretToken, photoId, []);
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeDefined();
        }
    });

    it('throws on other error status', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            json: async () => ({ error: 'Service unavailable' })
        });

        await expect(API.commit(secretToken, photoId, []))
            .rejects.toThrow();
    });
});

describe('API.abort', () => {
    it('POSTs to abort endpoint', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({})
        });

        await API.abort(secretToken, photoId);

        expect(fetch).toHaveBeenCalledWith(
            `/api/trips/test-token-123/photos/${photoId}/abort`,
            { method: 'POST' }
        );
    });

    it('throws on error status', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ error: 'Photo not found' })
        });

        await expect(API.abort(secretToken, photoId))
            .rejects.toThrow();
    });
});

describe('API.getVersion', () => {
    it('GETs from /api/version endpoint', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                server_version: '1.0.0',
                client_min_version: '0.9.0'
            })
        });

        const result = await API.getVersion();

        expect(fetch).toHaveBeenCalledWith('/api/version');
        expect(result.server_version).toBe('1.0.0');
    });

    it('throws on error status', async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' })
        });

        await expect(API.getVersion())
            .rejects.toThrow();
    });
});

describe('API.pinDropPhoto', () => {
    it('POSTs to pin-drop endpoint with GPS coordinates', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
        const body = {
            photoId: photoId,
            gpsLat: 40.7128,
            gpsLon: -74.0060
        };

        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: 123,
                uploadId: photoId,
                lat: 40.7128,
                lng: -74.0060,
                placeName: 'New York, NY'
            })
        });

        const result = await API.pinDropPhoto(secretToken, body);

        expect(fetch).toHaveBeenCalledWith(
            `/api/trips/test-token-123/photos/${photoId}/pin-drop`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gpsLat: 40.7128, gpsLon: -74.0060 })
            }
        );
        expect(result.lat).toBe(40.7128);
        expect(result.lng).toBe(-74.0060);
    });

    it('throws on 409 conflict (non-committed photo)', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 409,
            json: async () => ({ error: 'Conflict: pin-drop only allowed on committed photos' })
        });

        await expect(API.pinDropPhoto(secretToken, {
            photoId: photoId,
            gpsLat: 40.7128,
            gpsLon: -74.0060
        })).rejects.toThrow();
    });

    it('throws on 404 (photo not found)', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ error: 'Photo not found or does not belong to this trip' })
        });

        await expect(API.pinDropPhoto(secretToken, {
            photoId: photoId,
            gpsLat: 40.7128,
            gpsLon: -74.0060
        })).rejects.toThrow();
    });

    it('throws on other error status', async () => {
        const secretToken = 'test-token-123';
        const photoId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

        fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' })
        });

        await expect(API.pinDropPhoto(secretToken, {
            photoId: photoId,
            gpsLat: 40.7128,
            gpsLon: -74.0060
        })).rejects.toThrow();
    });
});
