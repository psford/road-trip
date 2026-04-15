/**
 * ProgressPanel tests — Event-driven UI for upload progress
 * Verifies AC5.1, AC5.2, AC5.4, AC5.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ProgressPanel', () => {
    let container;

    beforeEach(() => {
        // Create a container for the progress panel
        container = document.createElement('div');
        document.body.appendChild(container);

        // Setup stubs for UploadQueue and PostUI
        globalThis.UploadQueue = {
            retry: vi.fn(),
            abort: vi.fn(),
        };

        globalThis.PostUI = {
            manualPinDropFor: vi.fn(),
        };

        // Clear sessionStorage
        sessionStorage.clear();

        // Spies
        vi.spyOn(document, 'dispatchEvent').mockClear();
    });

    afterEach(() => {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
        vi.clearAllMocks();
    });

    describe('AC5.1: upload:created event creates row with filename, size, status', () => {
        it('creates a row with filename and formatted size on upload:created', async () => {
            ProgressPanel.mount(container);

            const event = new CustomEvent('upload:created', {
                detail: {
                    uploadId: 'upload-1',
                    filename: 'beach.jpg',
                    size: 2097152, // 2 MB
                    exif: {},
                },
            });

            document.dispatchEvent(event);

            // Check DOM
            const row = container.querySelector('[data-upload-id="upload-1"]');
            expect(row).toBeTruthy();
            expect(row.getAttribute('data-status')).toBe('pending');

            const filename = row.querySelector('.upload-panel__filename');
            expect(filename.textContent).toContain('beach.jpg');

            const size = row.querySelector('.upload-panel__size');
            expect(size.textContent).toContain('2');
            expect(size.textContent).toContain('MB');
        });

        it('creates multiple rows for multiple uploads', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'photo1.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-2',
                        filename: 'photo2.jpg',
                        size: 2097152,
                        exif: {},
                    },
                })
            );

            const rows = container.querySelectorAll('.upload-panel__row');
            expect(rows.length).toBe(2);
        });
    });

    describe('AC5.2: Retry button on failed row calls UploadQueue.retry', () => {
        it('shows retry button on failed non-exhausted row', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'blockFailed', // retryable
                        error: 'Connection timeout',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const retryBtn = row.querySelector('.upload-panel__retry');
            expect(retryBtn).toBeTruthy();
            expect(retryBtn.hidden).toBe(false);
        });

        it('calls UploadQueue.retry when retry button clicked', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'blockFailed',
                        error: 'Error',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const retryBtn = row.querySelector('.upload-panel__retry');
            retryBtn.click();

            expect(UploadQueue.retry).toHaveBeenCalledWith('upload-1');
        });
    });

    describe('AC5.4: Failed row shows "gave up after 6 attempts" when exhausted', () => {
        it('shows exhausted message when reason is retryExhausted', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'retryExhausted',
                        error: 'Max retries exceeded',
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const failedReason = row.querySelector('.upload-panel__failed-reason');
            expect(failedReason.textContent).toContain('gave up after 6 attempts');
            expect(failedReason.hidden).toBe(false);
        });

        it('hides retry button when exhausted', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'retryExhausted',
                        error: 'Max retries',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const retryBtn = row.querySelector('.upload-panel__retry');
            expect(retryBtn.hidden).toBe(true);
        });

        it('shows discard button when exhausted', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'retryExhausted',
                        error: 'Max retries',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const discardBtn = row.querySelector('.upload-panel__discard');
            expect(discardBtn).toBeTruthy();
            expect(discardBtn.hidden).toBe(false);
        });

        it('shows pin-drop button when exhausted and has GPS', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'retryExhausted',
                        error: 'Max retries',
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const pinDropBtn = row.querySelector('.upload-panel__pin-drop');
            expect(pinDropBtn).toBeTruthy();
            expect(pinDropBtn.hidden).toBe(false);
        });

        it('hides pin-drop button when exhausted and no GPS', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'retryExhausted',
                        error: 'Max retries',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const pinDropBtn = row.querySelector('.upload-panel__pin-drop');
            expect(pinDropBtn.hidden).toBe(true);
        });
    });

    describe('AC5.3: Pin-drop button calls PostUI.manualPinDropFor', () => {
        it('calls PostUI.manualPinDropFor when pin-drop clicked', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'blockFailed',
                        error: 'Error',
                        exif: { gps: { lat: 37.7749, lon: -122.4194 } },
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const pinDropBtn = row.querySelector('.upload-panel__pin-drop');
            pinDropBtn.click();

            expect(PostUI.manualPinDropFor).toHaveBeenCalledWith('upload-1');
        });
    });

    describe('Discard button calls UploadQueue.abort', () => {
        it('calls UploadQueue.abort when discard clicked', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:failed', {
                    detail: {
                        uploadId: 'upload-1',
                        reason: 'blockFailed',
                        error: 'Error',
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const discardBtn = row.querySelector('.upload-panel__discard');
            discardBtn.click();

            expect(UploadQueue.abort).toHaveBeenCalledWith('upload-1');
        });
    });

    describe('AC5.5: Collapse state persists in sessionStorage', () => {
        it('stores collapsed state in sessionStorage', async () => {
            const tripToken = 'trip-abc123';
            ProgressPanel.mount(container, tripToken);

            const toggleBtn = container.querySelector('.upload-panel__toggle');
            toggleBtn.click();

            const key = `upload-panel:${tripToken}:collapsed`;
            expect(sessionStorage.getItem(key)).toBe('true');
        });

        it('restores collapsed state on remount', async () => {
            const tripToken = 'trip-abc123';

            // First mount and collapse
            const container1 = document.createElement('div');
            document.body.appendChild(container1);
            ProgressPanel.mount(container1, tripToken);

            const toggleBtn = container1.querySelector('.upload-panel__toggle');
            toggleBtn.click();

            // Unmount
            ProgressPanel.unmount();

            // Remount should be collapsed
            const container2 = document.createElement('div');
            document.body.appendChild(container2);
            ProgressPanel.mount(container2, tripToken);

            const panelBody = container2.querySelector('.upload-panel__body');
            expect(panelBody.hidden).toBe(true);

            // Cleanup
            document.body.removeChild(container1);
            document.body.removeChild(container2);
        });

        it('toggles collapse state on button click', async () => {
            ProgressPanel.mount(container);

            const panelBody = container.querySelector('.upload-panel__body');
            expect(panelBody.hidden).toBe(false);

            const toggleBtn = container.querySelector('.upload-panel__toggle');
            toggleBtn.click();

            expect(panelBody.hidden).toBe(true);

            toggleBtn.click();
            expect(panelBody.hidden).toBe(false);
        });
    });

    describe('Progress bar updates on upload:progress', () => {
        it('updates progress bar width on upload:progress event', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:progress', {
                    detail: {
                        uploadId: 'upload-1',
                        bytesUploaded: 524288, // 50%
                        totalBytes: 1048576,
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const fill = row.querySelector('.upload-panel__progress-fill');
            expect(fill.style.width).toBe('50%');
        });
    });

    describe('Committed row state', () => {
        it('shows check icon on upload:committed', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:committed', {
                    detail: {
                        uploadId: 'upload-1',
                        photoId: 'photo-1',
                        photo: {},
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            expect(row.getAttribute('data-status')).toBe('committed');
            const icon = row.querySelector('.upload-panel__icon');
            expect(icon.textContent).toContain('✓');
        });

        it('hides all action buttons on committed', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:committed', {
                    detail: {
                        uploadId: 'upload-1',
                        photoId: 'photo-1',
                        photo: {},
                        exif: {},
                    },
                })
            );

            const row = container.querySelector('[data-upload-id="upload-1"]');
            const retry = row.querySelector('.upload-panel__retry');
            const pinDrop = row.querySelector('.upload-panel__pin-drop');
            const discard = row.querySelector('.upload-panel__discard');

            expect(retry.hidden).toBe(true);
            expect(pinDrop.hidden).toBe(true);
            expect(discard.hidden).toBe(true);
        });
    });

    describe('Panel header shows count', () => {
        it('displays upload count in header', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            const title = container.querySelector('.upload-panel__title');
            expect(title.textContent).toContain('1');
        });

        it('updates count when new upload created', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-2',
                        filename: 'test2.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            const title = container.querySelector('.upload-panel__title');
            expect(title.textContent).toContain('2');
        });
    });

    describe('upload:aborted removes row', () => {
        it('removes row on upload:aborted event', async () => {
            ProgressPanel.mount(container);

            document.dispatchEvent(
                new CustomEvent('upload:created', {
                    detail: {
                        uploadId: 'upload-1',
                        filename: 'test.jpg',
                        size: 1048576,
                        exif: {},
                    },
                })
            );

            let row = container.querySelector('[data-upload-id="upload-1"]');
            expect(row).toBeTruthy();

            document.dispatchEvent(
                new CustomEvent('upload:aborted', {
                    detail: {
                        uploadId: 'upload-1',
                    },
                })
            );

            row = container.querySelector('[data-upload-id="upload-1"]');
            expect(row).toBeFalsy();
        });
    });
});
