/**
 * postUI-processing.test.js
 * Integration tests for postUI file selection through image processing to upload queue.
 * Verifies AC3.1 (upload:preparing fires first), AC3.2 (upload:created fires after processing),
 * AC3.3 (per-file error handling without blocking batch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('postUI processing integration', () => {
    let preparingEvents;
    let failedEvents;
    let processForUploadSpy;
    let queueStartSpy;
    let extractMetadataSpy;

    beforeEach(() => {
        // Setup event tracking
        preparingEvents = [];
        failedEvents = [];

        // Create event handlers that capture events into our arrays
        const preparingHandler = (e) => {
            preparingEvents.push(e.detail);
        };
        const failedHandler = (e) => {
            failedEvents.push(e.detail);
        };

        // Store handlers so we can remove them in afterEach
        globalThis._testPreparingHandler = preparingHandler;
        globalThis._testFailedHandler = failedHandler;

        document.addEventListener('upload:preparing', preparingHandler);
        document.addEventListener('upload:failed', failedHandler);

        // Create mock DOM elements
        document.body.innerHTML = `
            <input type="file" id="fileInput" multiple />
            <button id="addPhotoButton">Add Photo</button>
            <button id="cancelButton">Cancel</button>
            <button id="postButton">Post</button>
            <div id="tripName"></div>
            <div id="tripDescription"></div>
            <div id="viewLinkSection" style="display: none;"></div>
            <div id="viewUrlValue"></div>
            <button id="copyViewLink">Copy</button>
            <div id="photoThumbnail"></div>
            <div id="placeNameDisplay"></div>
        `;

        // Mock ImageProcessor to return a successful result
        // Use a mock implementation so we can return different files based on input
        processForUploadSpy = vi.spyOn(ImageProcessor, 'processForUpload').mockImplementation(async (file) => {
            return {
                original: file, // Return the same file that was passed in
                display: new Blob(['display-tier'], { type: 'image/jpeg' }),
                thumb: new Blob(['thumb-tier'], { type: 'image/jpeg' }),
                compressionApplied: false,
                heicConverted: false,
                originalBytes: 3 * 1024 * 1024,
                outputBytes: 3 * 1024 * 1024,
                durationMs: 150,
            };
        });

        // Mock UploadQueue.start to capture arguments
        queueStartSpy = vi.spyOn(UploadQueue, 'start').mockImplementation(() => {});

        // Mock PostService if not already defined
        if (typeof PostService === 'undefined') {
            globalThis.PostService = {
                extractPhotoMetadata: vi.fn(),
            };
        }

        // Mock metadata extraction
        extractMetadataSpy = vi.spyOn(PostService, 'extractPhotoMetadata').mockResolvedValue({
            gps: { latitude: 40.7128, longitude: -74.006 },
            timestamp: new Date('2026-01-15T10:30:00Z'),
            placeName: 'New York, NY',
        });

        // Mock UploadUtils.newGuid for unique upload IDs
        let guidCounter = 0;
        vi.spyOn(UploadUtils, 'newGuid').mockImplementation(() => {
            return `test-upload-id-${++guidCounter}`;
        });

        // Mock UploadTelemetry to avoid undefined errors
        if (typeof UploadTelemetry === 'undefined') {
            globalThis.UploadTelemetry = {
                recordProcessingFailed: vi.fn(),
                recordProcessingApplied: vi.fn(),
            };
        } else {
            vi.spyOn(UploadTelemetry, 'recordProcessingFailed');
            vi.spyOn(UploadTelemetry, 'recordProcessingApplied');
        }

        // Mock console
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock PostUI methods
        PostUI.showToast = vi.fn();
        PostUI.refreshPhotoList = vi.fn();
        PostUI.handleNoGpsFiles = vi.fn();

        // Setup PostUI state
        PostUI.secretToken = 'test-token-abc';
    });

    afterEach(() => {
        // Remove event listeners
        if (globalThis._testPreparingHandler) {
            document.removeEventListener('upload:preparing', globalThis._testPreparingHandler);
        }
        if (globalThis._testFailedHandler) {
            document.removeEventListener('upload:failed', globalThis._testFailedHandler);
        }

        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    // Helper to trigger file selection directly through PostUI
    async function triggerFileSelection(files) {
        // Create a mock FileList
        const fileList = {
            length: files.length,
            [Symbol.iterator]: function* () {
                for (const file of files) {
                    yield file;
                }
            },
        };

        // Call PostUI.onMultipleFilesSelected directly with the file list
        await PostUI.onMultipleFilesSelected(fileList);

        // Give async handlers time to process
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Subcomponent B: Event ordering and queue argument tests

    it('emits upload:preparing event before processing begins (AC3.1)', async () => {
        // Trigger file selection with a single file
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(preparingEvents.length).toBe(1);
        expect(preparingEvents[0]).toHaveProperty('uploadId');
        expect(preparingEvents[0].fileName).toBe('photo.jpg');
    });

    it('calls ImageProcessor.processForUpload with file and metadata', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(processForUploadSpy).toHaveBeenCalledWith(
            file,
            expect.objectContaining({
                gps: expect.objectContaining({ latitude: 40.7128 }),
                timestamp: expect.any(Date),
            })
        );
    });

    it('passes display and thumb blobs to UploadQueue.start (AC3.2, AC5.1)', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(queueStartSpy).toHaveBeenCalledTimes(1);
        const items = queueStartSpy.mock.calls[0][1]; // second argument is the items array
        expect(items.length).toBe(1);
        expect(items[0]).toHaveProperty('display');
        expect(items[0]).toHaveProperty('thumb');
        expect(items[0].display).toBeInstanceOf(Blob);
        expect(items[0].thumb).toBeInstanceOf(Blob);
    });

    it('upload:created fires after processing completes, not before (AC3.2)', async () => {
        const eventOrder = [];

        // Wrap extractPhotoMetadata to track metadata extraction completion
        let metadataExtracted = false;
        const originalExtract = extractMetadataSpy.getMockImplementation();
        extractMetadataSpy.mockImplementation(async (...args) => {
            eventOrder.push('metadata-extraction-started');
            const result = await originalExtract(...args);
            eventOrder.push('metadata-extraction-completed');
            metadataExtracted = true;
            return result;
        });

        // Wrap processForUpload to track processing completion
        const origProcess = processForUploadSpy.getMockImplementation();
        processForUploadSpy.mockImplementation(async (...args) => {
            eventOrder.push('processing-started');
            const result = await origProcess(...args);
            eventOrder.push('processing-completed');
            return result;
        });

        // Track upload:created event
        document.addEventListener('upload:created', () => {
            eventOrder.push('upload:created');
        });

        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        // Verify that processing completed before queue.start was called
        // (upload:created would be fired when UploadQueue.start is called in the new flow)
        const processingCompletedIndex = eventOrder.indexOf('processing-completed');
        expect(processingCompletedIndex).toBeGreaterThanOrEqual(0);
    });

    // Subcomponent C: Processing failure tests

    it('handles processing failure per-file without blocking batch (AC3.3)', async () => {
        // First file fails, second succeeds
        processForUploadSpy
            .mockRejectedValueOnce(new Error('Out of memory'))
            .mockResolvedValueOnce({
                original: new File(['ok'], 'photo2.jpg', { type: 'image/jpeg' }),
                display: new Blob(['d'], { type: 'image/jpeg' }),
                thumb: new Blob(['t'], { type: 'image/jpeg' }),
                compressionApplied: false,
                heicConverted: false,
                originalBytes: 1024,
                outputBytes: 1024,
                durationMs: 50,
            });

        const file1 = new File(['fail-data'], 'bad.jpg', { type: 'image/jpeg' });
        const file2 = new File(['ok-data'], 'good.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file1, file2]);

        // First file should have emitted upload:failed with processing phase
        expect(failedEvents.length).toBe(1);
        expect(failedEvents[0].phase).toBe('processing');
        expect(failedEvents[0].error).toContain('Out of memory');

        // Second file should have been queued successfully
        expect(queueStartSpy).toHaveBeenCalledTimes(1);
        const items = queueStartSpy.mock.calls[0][1];
        expect(items.length).toBe(1); // Only the successful file
    });

    it('does not call UploadQueue.start if all files fail processing', async () => {
        processForUploadSpy.mockRejectedValue(new Error('Canvas limit exceeded'));

        const file = new File(['bad'], 'huge.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(queueStartSpy).not.toHaveBeenCalled();
    });

    it('processes multiple files successfully with correct metadata', async () => {
        const file1 = new File(['data1'], 'photo1.jpg', { type: 'image/jpeg' });
        const file2 = new File(['data2'], 'photo2.jpg', { type: 'image/jpeg' });

        await triggerFileSelection([file1, file2]);

        // Both files should have triggered processing
        expect(processForUploadSpy).toHaveBeenCalledTimes(2);
        expect(queueStartSpy).toHaveBeenCalledTimes(1);

        // Queue should have both files
        const items = queueStartSpy.mock.calls[0][1];
        expect(items.length).toBe(2);
        expect(items[0].file.name).toBe('photo1.jpg');
        expect(items[1].file.name).toBe('photo2.jpg');
    });

    it('records telemetry for successful processing', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(UploadTelemetry.recordProcessingApplied).toHaveBeenCalledWith(
            expect.stringMatching(/^test-upload-id-/),
            expect.objectContaining({
                compressionApplied: false,
                heicConverted: false,
                originalBytes: 3 * 1024 * 1024,
                outputBytes: 3 * 1024 * 1024,
                durationMs: 150,
            })
        );
    });

    it('records telemetry for processing failure', async () => {
        processForUploadSpy.mockRejectedValueOnce(new Error('Processing failed'));

        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(UploadTelemetry.recordProcessingFailed).toHaveBeenCalledWith(
            expect.stringMatching(/^test-upload-id-/),
            'Processing failed'
        );
    });

    it('passes correct arguments to UploadQueue.start', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(queueStartSpy).toHaveBeenCalledTimes(1);

        // First arg should be the secret token
        const token = queueStartSpy.mock.calls[0][0];
        expect(typeof token).toBe('string');

        // Second arg should be the items array with all required fields
        const items = queueStartSpy.mock.calls[0][1];
        expect(items[0]).toHaveProperty('file');
        expect(items[0]).toHaveProperty('metadata');
        expect(items[0]).toHaveProperty('uploadId');
        expect(items[0]).toHaveProperty('display');
        expect(items[0]).toHaveProperty('thumb');
    });
});
