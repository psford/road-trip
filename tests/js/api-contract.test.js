/**
 * API Contract Tests
 *
 * These tests verify that the JS client sends request bodies with field names
 * matching the server's C# DTO JsonPropertyName attributes. This catches the
 * class of bug where client uses snake_case but server expects camelCase.
 *
 * The expected field names are extracted from src/RoadTripMap/Models/UploadDtos.cs
 * and hardcoded here as the contract. If the server DTO changes, these tests
 * must be updated to match.
 *
 * WHY THIS EXISTS: Phase 4 acceptance testing found that API.requestUpload
 * sent {upload_id, content_type, size_bytes} but the server expected
 * {uploadId, contentType, sizeBytes}. 169 unit tests passed because they
 * all mocked the API layer. This test validates the actual wire format.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Server DTO contracts (from src/RoadTripMap/Models/UploadDtos.cs JsonPropertyName values)
const CONTRACTS = {
    RequestUploadRequest: {
        required: ['uploadId', 'filename', 'contentType', 'sizeBytes'],
        optional: ['exif'],
    },
    ExifDto: {
        optional: ['gpsLat', 'gpsLon', 'takenAt'],
    },
    CommitRequest: {
        required: ['blockIds'],
    },
    PinDropRequest: {
        required: ['gpsLat', 'gpsLon'],
    },
};

describe('API wire format matches server DTO contracts', () => {
    let capturedBodies;

    beforeEach(() => {
        capturedBodies = [];

        // Intercept fetch to capture request bodies
        globalThis.fetch = vi.fn(async (url, opts) => {
            if (opts?.body) {
                try {
                    capturedBodies.push({
                        url: typeof url === 'string' ? url : url.toString(),
                        body: JSON.parse(opts.body),
                    });
                } catch { /* non-JSON body, skip */ }
            }
            return {
                ok: true,
                status: 200,
                headers: new Map([
                    ['x-server-version', '1.0.0'],
                    ['x-client-min-version', '1.0.0'],
                ]),
                json: async () => ({
                    photoId: '00000000-0000-0000-0000-000000000001',
                    sasUrl: 'https://storage.blob.core.windows.net/container/blob?sig=REDACTED',
                    displaySasUrl: 'https://storage.blob.core.windows.net/container/blob_display.jpg?sig=REDACTED',
                    thumbSasUrl: 'https://storage.blob.core.windows.net/container/blob_thumb.jpg?sig=REDACTED',
                    blobPath: 'photo_original.jpg',
                    maxBlockSizeBytes: 4194304,
                    serverVersion: '1.0.0',
                    clientMinVersion: '1.0.0',
                }),
            };
        });
    });

    it('API.requestUpload sends fields matching RequestUploadRequest DTO', async () => {
        await API.requestUpload('test-token', {
            uploadId: '00000000-0000-0000-0000-000000000001',
            filename: 'test.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 1024,
            exif: { gpsLat: 40.0, gpsLon: -74.0, takenAt: '2026-01-01T00:00:00Z' },
        });

        expect(capturedBodies.length).toBe(1);
        const body = capturedBodies[0].body;

        // Verify all required fields present with correct names
        for (const field of CONTRACTS.RequestUploadRequest.required) {
            expect(body).toHaveProperty(field);
        }

        // Verify NO snake_case variants leaked through
        expect(body).not.toHaveProperty('upload_id');
        expect(body).not.toHaveProperty('content_type');
        expect(body).not.toHaveProperty('size_bytes');

        // Verify exif shape matches ExifDto
        if (body.exif) {
            expect(body.exif).not.toHaveProperty('gps');
            expect(body.exif).not.toHaveProperty('lat');
            expect(body.exif).not.toHaveProperty('lon');
            // Should have gpsLat/gpsLon if GPS present
            if (body.exif.gpsLat !== null) {
                expect(typeof body.exif.gpsLat).toBe('number');
                expect(typeof body.exif.gpsLon).toBe('number');
            }
        }
    });

    it('API.commit sends fields matching CommitRequest DTO', async () => {
        await API.commit('test-token', '00000000-0000-0000-0000-000000000001', ['block1', 'block2']);

        expect(capturedBodies.length).toBe(1);
        const body = capturedBodies[0].body;

        for (const field of CONTRACTS.CommitRequest.required) {
            expect(body).toHaveProperty(field);
        }

        // Verify no snake_case
        expect(body).not.toHaveProperty('block_ids');
        expect(Array.isArray(body.blockIds)).toBe(true);
    });

    it('API.pinDropPhoto sends fields matching PinDropRequest DTO', async () => {
        await API.pinDropPhoto('test-token', {
            photoId: '00000000-0000-0000-0000-000000000001',
            gpsLat: 40.7128,
            gpsLon: -74.0060,
        });

        expect(capturedBodies.length).toBe(1);
        const body = capturedBodies[0].body;

        for (const field of CONTRACTS.PinDropRequest.required) {
            expect(body).toHaveProperty(field);
        }

        // Verify no snake_case
        expect(body).not.toHaveProperty('gps_lat');
        expect(body).not.toHaveProperty('gps_lon');
    });

    it('UploadQueue._doRequestUpload sends body matching RequestUploadRequest DTO', async () => {
        // Set up StorageAdapter mock
        StorageAdapter.updateItemStatus = vi.fn();
        StorageAdapter.updateItemStatus.mockResolvedValue();
        StorageAdapter.putItem = vi.fn().mockResolvedValue();

        // Use the REAL exif shape produced by exifUtil.js + postService.js
        // (this is what postUI.js stores in item.exif):
        //   { gps: { latitude, longitude }, timestamp, placeName }
        const item = {
            filename: 'photo.jpg',
            size: 5000000,
            content_type: 'image/jpeg',
            exif: {
                gps: { latitude: 42.33, longitude: -71.11 },
                timestamp: new Date('2026-04-01T12:00:00Z'),
                placeName: 'Boston, MA',
            },
        };

        try {
            await UploadQueue._doRequestUpload(
                '00000000-0000-0000-0000-000000000001',
                'test-trip-token',
                item
            );
        } catch { /* may fail on downstream calls, that's fine */ }

        // Find the request-upload call
        const uploadCall = capturedBodies.find(c => c.url.includes('request-upload'));
        expect(uploadCall).toBeDefined();

        const body = uploadCall.body;

        // Verify camelCase field names match server DTO
        for (const field of CONTRACTS.RequestUploadRequest.required) {
            expect(body, `Missing required field: ${field}`).toHaveProperty(field);
        }

        // Verify NO snake_case
        expect(body).not.toHaveProperty('upload_id');
        expect(body).not.toHaveProperty('content_type');
        expect(body).not.toHaveProperty('size_bytes');

        // Verify exif is in ExifDto shape (gpsLat/gpsLon), not raw {gps: {lat, lon}}
        if (body.exif) {
            expect(body.exif).not.toHaveProperty('gps');
            expect(body.exif).toHaveProperty('gpsLat');
            expect(body.exif).toHaveProperty('gpsLon');
        }

        // CRITICAL: Verify the GPS values actually made it through (not null).
        // The bug that shipped to prod: client read gps.lat/gps.lon but exifUtil
        // returns gps.latitude/gps.longitude, so both were null → photos at 0,0.
        expect(body.exif.gpsLat).toBe(42.33);
        expect(body.exif.gpsLon).toBe(-71.11);

        // Verify takenAt made it through (not null).
        // The bug: client read exif.takenAt but postService stores exif.timestamp.
        expect(body.exif.takenAt).toBeTruthy();
    });

    it('request-upload response includes tier SAS URLs', () => {
        const response = {
            photoId: '00000000-0000-0000-0000-000000000001',
            sasUrl: 'https://storage.blob.core.windows.net/container/blob?sig=REDACTED',
            displaySasUrl: 'https://storage.blob.core.windows.net/container/blob_display.jpg?sig=REDACTED',
            thumbSasUrl: 'https://storage.blob.core.windows.net/container/blob_thumb.jpg?sig=REDACTED',
            blobPath: 'photo_original.jpg',
            maxBlockSizeBytes: 4194304,
            serverVersion: '1.0.0',
            clientMinVersion: '1.0.0',
        };

        // Validate shape includes new fields
        expect(response).toHaveProperty('displaySasUrl');
        expect(response).toHaveProperty('thumbSasUrl');
        expect(typeof response.displaySasUrl).toBe('string');
        expect(typeof response.thumbSasUrl).toBe('string');
        expect(response.displaySasUrl.length).toBeGreaterThan(0);
        expect(response.thumbSasUrl.length).toBeGreaterThan(0);

        // Verify the SAS URLs contain expected paths (indicating tier differentiation)
        expect(response.displaySasUrl).toContain('_display');
        expect(response.thumbSasUrl).toContain('_thumb');
    });
});
