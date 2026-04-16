/**
 * Progress Panel — Event-driven UI for upload progress
 * Subscribes to upload:created, upload:progress, upload:committed, upload:failed, upload:aborted
 * Verifies AC5.1, AC5.2, AC5.4, AC5.5
 */

const ProgressPanel = (() => {
    let _container = null;
    let _tripToken = null;
    let _rows = new Map(); // uploadId -> DOM element
    let _collapsed = false;

    // Helper to format bytes to human-readable size
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i];
    }

    // Helper to get or create a row
    function getOrCreateRow(uploadId) {
        if (_rows.has(uploadId)) {
            return _rows.get(uploadId);
        }

        const list = _container.querySelector('.upload-panel__list');
        const row = document.createElement('li');
        row.className = 'upload-panel__row';
        row.setAttribute('data-upload-id', uploadId);
        row.setAttribute('data-status', 'pending');

        row.innerHTML = `
            <span class="upload-panel__icon">◻</span>
            <div class="upload-panel__meta">
                <span class="upload-panel__filename"></span>
                <span class="upload-panel__size"></span>
            </div>
            <div class="upload-panel__progress">
                <div class="upload-panel__progress-fill" style="width: 0%"></div>
            </div>
            <span class="upload-panel__status"></span>
            <div class="upload-panel__actions">
                <button class="upload-panel__retry" hidden>↻ Retry</button>
                <button class="upload-panel__pin-drop" hidden>📍 Pin manually</button>
                <button class="upload-panel__discard" hidden>✕ Discard</button>
            </div>
            <span class="upload-panel__failed-reason" hidden></span>
        `;

        // Wire up button handlers
        const retryBtn = row.querySelector('.upload-panel__retry');
        const pinDropBtn = row.querySelector('.upload-panel__pin-drop');
        const discardBtn = row.querySelector('.upload-panel__discard');

        retryBtn.addEventListener('click', () => {
            UploadQueue.retry(uploadId);
        });

        pinDropBtn.addEventListener('click', () => {
            PostUI.manualPinDropFor(uploadId);
        });

        discardBtn.addEventListener('click', () => {
            UploadQueue.abort(uploadId);
        });

        list.appendChild(row);
        _rows.set(uploadId, row);
        updatePanelCount();
        return row;
    }

    function updateRow(uploadId, status, data = {}) {
        const row = getOrCreateRow(uploadId);
        row.setAttribute('data-status', status);

        const icon = row.querySelector('.upload-panel__icon');
        const statusSpan = row.querySelector('.upload-panel__status');
        const retryBtn = row.querySelector('.upload-panel__retry');
        const pinDropBtn = row.querySelector('.upload-panel__pin-drop');
        const discardBtn = row.querySelector('.upload-panel__discard');
        const failedReason = row.querySelector('.upload-panel__failed-reason');

        // Update icon and status text based on status
        switch (status) {
            case 'pending':
                icon.textContent = '◻';
                statusSpan.textContent = 'Queued';
                retryBtn.hidden = true;
                pinDropBtn.hidden = true;
                discardBtn.hidden = true;
                failedReason.hidden = true;
                break;

            case 'uploading':
                icon.textContent = '▶';
                statusSpan.textContent = 'Uploading...';
                retryBtn.hidden = true;
                pinDropBtn.hidden = true;
                discardBtn.hidden = true;
                failedReason.hidden = true;
                break;

            case 'committed':
                icon.textContent = '✓';
                statusSpan.textContent = 'Committed';
                retryBtn.hidden = true;
                pinDropBtn.hidden = true;
                discardBtn.hidden = true;
                failedReason.hidden = true;
                break;

            case 'failed':
                icon.textContent = '✕';
                statusSpan.textContent = data.reason === 'retryExhausted' ? 'Failed' : 'Failed (retrying...)';

                const hasGps = data.exif && data.exif.gps;

                if (data.reason === 'retryExhausted') {
                    retryBtn.hidden = true;
                    failedReason.textContent = 'gave up after 6 attempts';
                    failedReason.hidden = false;
                } else {
                    retryBtn.hidden = false;
                    failedReason.hidden = true;
                }

                discardBtn.hidden = false;
                pinDropBtn.hidden = !hasGps;
                break;

            case 'aborted':
                // Row will be removed, don't update
                break;
        }
    }

    function updatePanelCount() {
        const count = _rows.size;
        const panel = _container.querySelector('.upload-panel');
        const title = _container.querySelector('.upload-panel__title');
        if (title) {
            title.textContent = `Upload Progress (${count})`;
        }
        // Show panel when items exist, hide when empty
        if (panel) {
            panel.hidden = count === 0;
        }
    }

    function toggleCollapse() {
        const body = _container.querySelector('.upload-panel__body');
        _collapsed = !_collapsed;
        body.hidden = _collapsed;

        if (_tripToken) {
            const key = `upload-panel:${_tripToken}:collapsed`;
            sessionStorage.setItem(key, _collapsed ? 'true' : 'false');
        }
    }

    function restoreCollapsedState() {
        if (_tripToken) {
            const key = `upload-panel:${_tripToken}:collapsed`;
            const collapsed = sessionStorage.getItem(key) === 'true';
            if (collapsed) {
                const body = _container.querySelector('.upload-panel__body');
                body.hidden = true;
                _collapsed = true;
            }
        }
    }

    // Event handlers
    function handleCreated(e) {
        const { uploadId, filename, size, exif } = e.detail;
        const row = getOrCreateRow(uploadId);
        row.querySelector('.upload-panel__filename').textContent = filename;
        row.querySelector('.upload-panel__size').textContent = formatBytes(size);
        updateRow(uploadId, 'pending', { exif });
    }

    function handleProgress(e) {
        const { uploadId, bytesUploaded, totalBytes } = e.detail;
        const row = _rows.get(uploadId);
        if (!row) return;

        updateRow(uploadId, 'uploading');
        const percentage = Math.round((bytesUploaded / totalBytes) * 100);
        const fill = row.querySelector('.upload-panel__progress-fill');
        fill.style.width = percentage + '%';
    }

    function handleCommitted(e) {
        const { uploadId, exif } = e.detail;
        updateRow(uploadId, 'committed', { exif });
    }

    function handleFailed(e) {
        const { uploadId, reason, exif } = e.detail;
        if (reason === 'aborted') {
            // Handle abort separately
            handleAborted(e);
            return;
        }
        updateRow(uploadId, 'failed', { reason, exif });
    }

    function handleAborted(e) {
        const { uploadId } = e.detail;
        const row = _rows.get(uploadId);
        if (row) {
            row.remove();
            _rows.delete(uploadId);
            updatePanelCount();
        }
    }

    return {
        /**
         * Mount the progress panel
         * @param {HTMLElement} container - Container element
         * @param {string} tripToken - Trip token for sessionStorage key (optional)
         */
        mount(container, tripToken = null) {
            _container = container;
            _tripToken = tripToken;
            _rows.clear();
            _collapsed = false;

            // Create panel structure
            const panel = document.createElement('div');
            panel.className = 'upload-panel';
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'Upload progress');

            panel.innerHTML = `
                <div class="upload-panel__header">
                    <button class="upload-panel__toggle" aria-label="Toggle upload panel">▼</button>
                    <h3 class="upload-panel__title">Upload Progress (0)</h3>
                </div>
                <ul class="upload-panel__list upload-panel__body"></ul>
            `;

            // Hidden by default — shown when first upload:created fires
            panel.hidden = true;

            _container.appendChild(panel);

            // Wire up toggle button
            const toggleBtn = panel.querySelector('.upload-panel__toggle');
            toggleBtn.addEventListener('click', toggleCollapse);

            // Restore collapsed state if applicable
            restoreCollapsedState();

            // Register event listeners
            document.addEventListener('upload:created', handleCreated);
            document.addEventListener('upload:progress', handleProgress);
            document.addEventListener('upload:committed', handleCommitted);
            document.addEventListener('upload:failed', handleFailed);
            document.addEventListener('upload:aborted', handleAborted);
        },

        /**
         * Unmount the progress panel
         */
        unmount() {
            if (_container && _container.querySelector('.upload-panel')) {
                _container.querySelector('.upload-panel').remove();
            }

            // Unregister event listeners
            document.removeEventListener('upload:created', handleCreated);
            document.removeEventListener('upload:progress', handleProgress);
            document.removeEventListener('upload:committed', handleCommitted);
            document.removeEventListener('upload:failed', handleFailed);
            document.removeEventListener('upload:aborted', handleAborted);

            _container = null;
            _tripToken = null;
            _rows.clear();
        },
    };
})();
