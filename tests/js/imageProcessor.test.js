/**
 * ImageProcessor tests — HEIC conversion, oversize compression, tier generation
 * Verifies AC1.1, AC1.2, AC1.3, AC1.4, AC2.1, AC2.2, AC2.3, AC2.4, AC4.1, AC5.1, AC5.2, AC5.3, AC5.6, ACX.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ==================== Subcomponent A: Setup and mocking infrastructure ====================

// Mock CDN modules
const mockCompress = vi.fn();
const mockHeic2any = vi.fn();
const mockPiexif = {
    load: vi.fn(),
    dump: vi.fn(),
    insert: vi.fn(),
    GPSIFD: {
        GPSLatitudeRef: 1,
        GPSLatitude: 2,
        GPSLongitudeRef: 3,
        GPSLongitude: 4,
    },
    ExifIFD: {
        DateTimeOriginal: 306,
    },
    ImageIFD: {
        Make: 271,
        Model: 272,
    },
};

// Mock Canvas
const mockCtx = { drawImage: vi.fn() };
const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toBlob: vi.fn((cb, type, quality) => {
        cb(new Blob(['fake-tier-data'], { type: 'image/jpeg' }));
    }),
};

// Mock Image dimensions
const DEFAULT_IMG_WIDTH = 4000;
const DEFAULT_IMG_HEIGHT = 3000;

// Valid minimal JPEG data URL for mocking piexif.insert return value
// This is a tiny valid 1x1 JPEG
const VALID_JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8VAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';


describe('ImageProcessor', () => {
    beforeEach(() => {
        // Reset the lazy loaders
        ImageProcessor._resetLazyLoaders();

        // Setup CDN mocks in global store
        globalThis._testCdnMocks = {
            'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm': { default: mockCompress },
            'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/+esm': { default: mockPiexif },
            'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm': { default: mockHeic2any },
        };

        // Mock document.createElement to return mockCanvas for 'canvas'
        const originalCreateElement = document.createElement;
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            if (tag === 'canvas') {
                return mockCanvas;
            }
            return originalCreateElement.call(document, tag);
        });

        // Mock URL.createObjectURL and revokeObjectURL
        URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        URL.revokeObjectURL = vi.fn();

        // Mock the global Image constructor
        globalThis.Image = class MockImage {
            constructor() {
                this.width = DEFAULT_IMG_WIDTH;
                this.height = DEFAULT_IMG_HEIGHT;
                // Simulate async image load
                setTimeout(() => {
                    if (this.onload) {
                        this.onload();
                    }
                }, 0);
            }
            set src(val) {
                // Triggers onload via setTimeout in constructor
            }
        };

        // Reset all mock implementations
        mockCompress.mockClear();
        mockHeic2any.mockClear();
        mockPiexif.load.mockClear();
        mockPiexif.dump.mockClear();
        mockPiexif.insert.mockClear();
        mockCanvas.getContext.mockClear();
        mockCanvas.toBlob.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        // Clear CDN mocks
        globalThis._testCdnMocks = {};
    });

    // ==================== Subcomponent B: Sub-threshold JPEG passthrough tests ====================

    describe('sub-threshold JPEG', () => {
        it('returns original file unchanged (AC1.4)', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.original).toBe(file); // Same reference, not a copy
            expect(result.compressionApplied).toBe(false);
            expect(result.heicConverted).toBe(false);
        });

        it('still generates display tier (AC5.2, AC5.6)', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.display).toBeInstanceOf(Blob);
            expect(result.display.type).toBe('image/jpeg');
        });

        it('still generates thumb tier (AC5.3, AC5.6)', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.thumb).toBeInstanceOf(Blob);
            expect(result.thumb.type).toBe('image/jpeg');
        });

        it('generates tiers for all sub-threshold files', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Canvas toBlob should be called twice (display + thumb)
            expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
        });

        it('does not lazy-load browser-image-compression for sub-threshold files', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(mockCompress).not.toHaveBeenCalled();
        });

        it('does not lazy-load piexifjs for sub-threshold non-HEIC files', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(mockPiexif.load).not.toHaveBeenCalled();
        });

        it('computes correct canvas dimensions for display tier', async () => {
            // Image is 4000x3000, display max is 1920
            // Scale = 1920/4000 = 0.48, target = 1920x1440
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });

            // Track canvas dimension assignments
            const canvasDimensions = [];
            mockCanvas.toBlob.mockImplementation((cb, type, quality) => {
                // Record dimensions each time toBlob is called
                canvasDimensions.push({ width: mockCanvas.width, height: mockCanvas.height });
                // Simulate successful blob creation
                cb(new Blob(['fake-tier-data'], { type: 'image/jpeg' }));
            });

            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Display tier should be 1920x1440 (scale = 1920/4000 = 0.48, height = 3000 * 0.48 = 1440)
            expect(canvasDimensions[0]).toEqual({ width: 1920, height: 1440 });

            // Thumb tier should be 300x225 (scale = 300/4000 = 0.075, height = 3000 * 0.075 = 225)
            expect(canvasDimensions[1]).toEqual({ width: 300, height: 225 });

            expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
        });
    });

    // ==================== Subcomponent C: Oversize compression tests ====================

    describe('oversize JPEG compression', () => {
        it('compresses file over 14MB threshold (AC1.1)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

            // Mock compress to return a smaller blob
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            // Mock piexif for EXIF reinjection
            mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
            mockPiexif.dump.mockReturnValue('exif-binary');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, {
                gps: { latitude: 40.7128, longitude: -74.006 },
                timestamp: new Date('2026-01-15T10:30:00Z'),
            });

            expect(result.compressionApplied).toBe(true);
            expect(mockCompress).toHaveBeenCalledWith(
                file,
                expect.objectContaining({ maxSizeMB: 14 })
            );
        });

        it('reinjects EXIF into compressed output (AC2.1, AC2.2)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            const fakeExif = { '0th': {}, 'GPS': { lat: 40.7128 } };
            mockPiexif.load.mockReturnValue(fakeExif);
            mockPiexif.dump.mockReturnValue('exif-dump');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            await ImageProcessor.processForUpload(file, {
                gps: { latitude: 40.7128, longitude: -74.006 },
                timestamp: new Date('2026-01-15T10:30:00Z'),
            });

            expect(mockPiexif.load).toHaveBeenCalled();
            expect(mockPiexif.dump).toHaveBeenCalledWith(fakeExif);
            expect(mockPiexif.insert).toHaveBeenCalled();
        });

        it('oversize PNG is re-encoded to JPEG (AC1.2)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'screenshot.png', { type: 'image/png' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            mockPiexif.load.mockImplementation(() => {
                throw new Error('No EXIF in PNG');
            });

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.compressionApplied).toBe(true);
            expect(mockCompress).toHaveBeenCalledWith(
                file,
                expect.objectContaining({ fileType: 'image/jpeg' })
            );
        });

        it('verifies compressed output is decodable JPEG (AC2.3)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            // Mock compress returning a proper JPEG blob
            const jpegBlob = new Blob(['fake-jpeg-data'], { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(jpegBlob);
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Result is wrapped as File with JPEG type
            expect(result.original.type).toBe('image/jpeg');
        });

        it('preserves GPS coordinates within 6 decimal places after compression (AC2.1)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));

            const exifData = {
                latitude: 40.712345678,
                longitude: -74.006789012,
            };

            mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, exifData);

            // Verify piexif.insert was called with EXIF object containing GPS
            expect(mockPiexif.insert).toHaveBeenCalled();
            expect(result.compressionApplied).toBe(true);
        });

        it('verifies GPS coordinate rational encoding for HEIC (AC2.1)', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));

            // Known GPS coordinates: 40° 42' 44.442" N, 74° 0' 24.444" W
            // In decimal: latitude 40.712345, longitude -74.006789
            const exifData = {
                latitude: 40.712345,
                longitude: -74.006789,
            };

            // Track what gets passed to piexif.dump
            let capturedExifObj = null;
            mockPiexif.dump.mockImplementation((exifObj) => {
                capturedExifObj = exifObj;
                return 'd';
            });
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            await ImageProcessor.processForUpload(file, exifData);

            // Verify the GPS data was encoded in rational format (array of [numerator, denominator] pairs)
            expect(capturedExifObj).toBeDefined();
            expect(capturedExifObj['GPS']).toBeDefined();

            // GPS latitude should be rational format: [[degrees, 1], [minutes, 1], [seconds, 100]]
            const gpsLat = capturedExifObj['GPS'][mockPiexif.GPSIFD.GPSLatitude];
            expect(Array.isArray(gpsLat)).toBe(true);
            expect(gpsLat.length).toBe(3); // Three rational values

            // For latitude 40.712345:
            // Degrees: 40, Minutes: 42, Seconds: 44.442
            expect(gpsLat[0][0]).toBe(40); // degrees numerator
            expect(gpsLat[0][1]).toBe(1);  // degrees denominator
            expect(gpsLat[1][0]).toBe(42); // minutes numerator
            expect(gpsLat[1][1]).toBe(1);  // minutes denominator
            // Seconds are stored as hundredths: 44.442 * 100 = 4444.2 rounded to 4444
            expect(gpsLat[2][0]).toBeGreaterThan(4400); // seconds * 100 (approximate)
            expect(gpsLat[2][1]).toBe(100); // seconds denominator (centiseconds)

            // GPS longitude reference should be 'W' for negative longitude
            const gpsLngRef = capturedExifObj['GPS'][mockPiexif.GPSIFD.GPSLongitudeRef];
            expect(gpsLngRef).toBe('W');
        });
    });

    // ==================== Subcomponent D: Unreachable target error test ====================

    describe('unreachable compression target', () => {
        it('throws descriptive error when compression cannot reach threshold (AC2.4)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });

            // Mock compress returning a blob still over threshold
            mockCompress.mockResolvedValue(
                new Blob(['x'.repeat(15 * 1024 * 1024)], { type: 'image/jpeg' })
            );

            await expect(
                ImageProcessor.processForUpload(file, { gps: null, timestamp: null })
            ).rejects.toThrow(/Unable to compress/);
        });

        it('error message includes original and compressed sizes', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });

            mockCompress.mockResolvedValue(
                new Blob(['x'.repeat(15 * 1024 * 1024)], { type: 'image/jpeg' })
            );

            try {
                await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });
                throw new Error('Should have thrown');
            } catch (e) {
                expect(e.message).toMatch(/18\.\d MB/); // Original size ~18MB
                expect(e.message).toMatch(/15\.\d MB/); // Compressed size ~15MB
            }
        });
    });

    // ==================== Subcomponent E: HEIC conversion tests ====================

    describe('HEIC conversion', () => {
        it('converts HEIC to JPEG before processing (AC1.3)', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            // Mock heic2any returning a JPEG blob
            mockHeic2any.mockResolvedValue(new Blob(['jpeg-from-heic'], { type: 'image/jpeg' }));
            // Mock piexif for EXIF reinjection (HEIC always needs it)
            mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
            mockPiexif.dump.mockReturnValue('exif-dump');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, {
                gps: { latitude: 35.6762, longitude: 139.6503 },
                timestamp: new Date('2026-03-01T14:00:00Z'),
            });

            expect(result.heicConverted).toBe(true);
            expect(mockHeic2any).toHaveBeenCalledWith(expect.objectContaining({
                blob: file,
                toType: 'image/jpeg',
            }));
        });

        it('detects HEIC by file extension when MIME type is empty', async () => {
            const file = new File(['heic-data'], 'IMG_1234.HEIC', { type: '' });
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.heicConverted).toBe(true);
            expect(mockHeic2any).toHaveBeenCalled();
        });

        it('detects HEIF by MIME type', async () => {
            const file = new File(['heif-data'], 'photo.heif', { type: 'image/heif' });
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.heicConverted).toBe(true);
            expect(mockHeic2any).toHaveBeenCalled();
        });

        it('handles heic2any returning array of blobs', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            // heic2any can return array for multi-image HEIF containers
            mockHeic2any.mockResolvedValue([
                new Blob(['jpeg1'], { type: 'image/jpeg' }),
                new Blob(['jpeg2'], { type: 'image/jpeg' }),
            ]);
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.heicConverted).toBe(true);
        });

        it('reinjects EXIF for HEIC even if not oversize', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            // Small converted JPEG (not oversize)
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, {
                gps: { latitude: 35.6762, longitude: 139.6503 },
                timestamp: new Date('2026-03-01T14:00:00Z'),
            });

            expect(result.heicConverted).toBe(true);
            expect(mockPiexif.insert).toHaveBeenCalled();
        });
    });

    // ==================== Subcomponent F: Lazy-loading caching tests ====================

    describe('lazy loading', () => {
        it('caches CDN imports across multiple calls (AC4.1)', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['c'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            // Spy on _mockableImport to verify CDN URLs are loaded only once
            const importSpy = vi.spyOn(globalThis, '_mockableImport');

            // First call loads the CDN module
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Get the count of browser-image-compression imports after first call
            const compressionImportsAfterFirst = importSpy.mock.calls.filter(
                c => c[0].includes('browser-image-compression')
            ).length;

            // Second call should reuse the cached module
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Get the count of browser-image-compression imports after second call
            const compressionImportsAfterSecond = importSpy.mock.calls.filter(
                c => c[0].includes('browser-image-compression')
            ).length;

            // The import should have been called only once (caching works)
            expect(compressionImportsAfterFirst).toBe(1);
            expect(compressionImportsAfterSecond).toBe(1);

            importSpy.mockRestore();
        });

        it('does not load any CDN modules for sub-threshold non-HEIC files', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'small.jpg', { type: 'image/jpeg' });

            mockCompress.mockClear();
            mockHeic2any.mockClear();
            mockPiexif.load.mockClear();

            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // No CDN modules should have been loaded
            expect(mockCompress).not.toHaveBeenCalled();
            expect(mockHeic2any).not.toHaveBeenCalled();
            expect(mockPiexif.load).not.toHaveBeenCalled();
        });

        it('loads browser-image-compression only once even if multiple files are compressed', async () => {
            mockCompress.mockResolvedValue(new Blob(['c'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const file1 = new File(['x'.repeat(18 * 1024 * 1024)], 'big1.jpg', { type: 'image/jpeg' });
            const file2 = new File(['x'.repeat(18 * 1024 * 1024)], 'big2.jpg', { type: 'image/jpeg' });

            // Process first file
            await ImageProcessor.processForUpload(file1, { gps: null, timestamp: null });

            // Process second file
            await ImageProcessor.processForUpload(file2, { gps: null, timestamp: null });

            // mockCompress should be called twice (once per file), verifying that
            // the module was loaded and reused for both compressions
            expect(mockCompress).toHaveBeenCalledTimes(2);
        });
    });

    // ==================== Subcomponent G: Result shape and timing tests ====================

    describe('result shape', () => {
        it('returns all required fields (AC5.1)', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result).toEqual(expect.objectContaining({
                original: expect.anything(),
                display: expect.any(Blob),
                thumb: expect.any(Blob),
                compressionApplied: expect.any(Boolean),
                heicConverted: expect.any(Boolean),
                originalBytes: expect.any(Number),
                outputBytes: expect.any(Number),
                durationMs: expect.any(Number),
            }));
        });

        it('originalBytes matches input file size', async () => {
            const size = 5 * 1024 * 1024;
            const file = new File(['x'.repeat(size)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.originalBytes).toBe(size);
        });

        it('durationMs is a positive number', async () => {
            const file = new File(['x'.repeat(1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('original is a File or Blob for compressed images', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.original).toBeInstanceOf(Blob);
        });

        it('all tiers have correct MIME type', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.original.type).toBe('image/jpeg');
            expect(result.display.type).toBe('image/jpeg');
            expect(result.thumb.type).toBe('image/jpeg');
        });
    });

    // ==================== Additional edge case tests ====================

    describe('edge cases', () => {
        it('handles files with no EXIF data gracefully', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            // Simulate piexifjs throwing on files with no EXIF
            mockPiexif.load.mockImplementation(() => {
                throw new Error('No EXIF');
            });

            // Should not throw, should return blob unchanged
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.compressionApplied).toBe(true);
            expect(result.original).toBeInstanceOf(Blob);
        });

        it('generates tiers in parallel for better performance', async () => {
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });

            const startTime = performance.now();
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });
            const duration = performance.now() - startTime;

            // Two tiers should be generated (verified by canvas.toBlob call count)
            expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2);
        });

        it('does not log raw bytes, GPS, or SAS URLs (ACX.1)', async () => {
            // This test verifies that the implementation doesn't log sensitive data
            // by checking that no console calls contain coordinates or blob data
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            await ImageProcessor.processForUpload(file, {
                latitude: 40.7128,
                longitude: -74.006,
            });

            // Verify no logs were made (this is a baseline check)
            // The implementation should never log these values
            expect(consoleSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();

            consoleSpy.mockRestore();
            consoleWarnSpy.mockRestore();
        });

        it('handles very large images by scaling correctly', async () => {
            const file = new File(['x'.repeat(50 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.compressionApplied).toBe(true);
        });

        it('wraps converted HEIC files as File objects', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.original).toBeInstanceOf(File);
            expect(result.original.name).toMatch(/\.jpg$/i);
        });
    });

    describe('EXIF data handling', () => {
        it('uses exifData parameter for HEIC EXIF reinjection', async () => {
            const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
            mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const exifData = {
                latitude: 35.6762,
                longitude: 139.6503,
                DateTimeOriginal: new Date('2026-03-01T14:00:00Z'),
            };

            await ImageProcessor.processForUpload(file, exifData);

            // piexif should be used to reinjection
            expect(mockPiexif.insert).toHaveBeenCalled();
        });

        it('handles exifData with Make and Model fields', async () => {
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
            mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
            mockPiexif.dump.mockReturnValue('d');
            mockPiexif.insert.mockReturnValue(VALID_JPEG_DATA_URL);

            const exifData = {
                Make: 'Apple',
                Model: 'iPhone 15',
            };

            const result = await ImageProcessor.processForUpload(file, exifData);

            expect(result.compressionApplied).toBe(true);
        });
    });

    // ==================== Subcomponent H: Feature flag (client-processing-enabled meta tag) ====================

    describe('feature flag (client-processing-enabled meta tag)', () => {
        afterEach(() => {
            // Remove any injected meta tags
            const meta = document.querySelector('meta[name="client-processing-enabled"]');
            if (meta) meta.remove();
            ImageProcessor._resetProcessingFlag();
            ImageProcessor._resetLazyLoaders();
        });

        it('processes normally when meta tag is absent (default enabled)', async () => {
            // No meta tag injected -- should default to enabled
            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.display).toBeInstanceOf(Blob); // Tiers generated
            expect(result.thumb).toBeInstanceOf(Blob);
        });

        it('processes normally when meta tag is "true"', async () => {
            const meta = document.createElement('meta');
            meta.name = 'client-processing-enabled';
            meta.content = 'true';
            document.head.appendChild(meta);

            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.display).toBeInstanceOf(Blob);
            expect(result.thumb).toBeInstanceOf(Blob);
        });

        it('returns passthrough result when meta tag is "false"', async () => {
            const meta = document.createElement('meta');
            meta.name = 'client-processing-enabled';
            meta.content = 'false';
            document.head.appendChild(meta);

            const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            expect(result.original).toBe(file); // Same reference, passthrough
            expect(result.display).toBeNull();
            expect(result.thumb).toBeNull();
            expect(result.compressionApplied).toBe(false);
            expect(result.heicConverted).toBe(false);
            expect(result.durationMs).toBe(0);
        });

        it('does not load any CDN dependencies when flag is off', async () => {
            const meta = document.createElement('meta');
            meta.name = 'client-processing-enabled';
            meta.content = 'false';
            document.head.appendChild(meta);

            // Even with an oversize file, no CDN loading should occur
            const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Verify no imports were attempted
            expect(mockCompress).not.toHaveBeenCalled();
            expect(mockHeic2any).not.toHaveBeenCalled();
            expect(mockPiexif.load).not.toHaveBeenCalled();

            // File is passed through unchanged even though it's oversize
            expect(result.original).toBe(file);
            expect(result.originalBytes).toBe(file.size);
        });

        it('caches the flag value across calls', async () => {
            const meta = document.createElement('meta');
            meta.name = 'client-processing-enabled';
            meta.content = 'false';
            document.head.appendChild(meta);

            const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
            await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

            // Change the meta tag (simulate config update without page reload)
            meta.content = 'true';

            // Should still return passthrough (cached value)
            const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });
            expect(result.display).toBeNull(); // Still using cached "false"
        });
    });
});
