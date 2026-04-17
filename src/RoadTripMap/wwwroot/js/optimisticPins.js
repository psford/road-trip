/**
 * OptimisticPins Module
 * Listens to upload events and manages map pins for in-flight uploads.
 * Pin states: pending (yellow), committed (normal), failed (red).
 * Lifecycle: upload:created → pending pin, upload:committed → committed pin, upload:failed → red pin, upload:aborted → removed.
 * AC7.1-7.5: Optimistic pin placement for resilient uploads.
 */

globalThis.OptimisticPins = (() => {
    // Map of uploadId -> maplibregl.Marker
    const pins = new Map();
    let mapUI = null;

    /**
     * Initialize the OptimisticPins module
     * @param {Object} mapUIInstance - Reference to MapUI instance containing the maplibregl.Map
     */
    function init(mapUIInstance) {
        mapUI = mapUIInstance;

        // Listen for upload:created event
        document.addEventListener('upload:created', onUploadCreated);

        // Listen for upload:committed event
        document.addEventListener('upload:committed', onUploadCommitted);

        // Listen for upload:failed event
        document.addEventListener('upload:failed', onUploadFailed);

        // Listen for upload:aborted event
        document.addEventListener('upload:aborted', onUploadAborted);
    }

    /**
     * AC7.1: Create pending pin on upload:created if EXIF GPS present
     */
    function onUploadCreated(event) {
        const detail = event.detail;
        const uploadId = detail.uploadId;

        // AC7.4: No GPS → no marker created
        if (!detail.exif?.gps || detail.exif.gps.lat === undefined || detail.exif.gps.lon === undefined) {
            return;
        }

        // Create pending pin element
        const pinElement = document.createElement('div');
        pinElement.className = 'photo-pin photo-pin--pending';

        // Create marker using custom element
        const marker = new maplibregl.Marker({
            element: pinElement
        }).setLngLat([detail.exif.gps.lon, detail.exif.gps.lat]);

        if (mapUI && mapUI.map) {
            marker.addTo(mapUI.map);
        }

        // Track the marker by uploadId
        pins.set(uploadId, {
            marker: marker,
            element: pinElement,
            status: 'pending'
        });
    }

    /**
     * AC7.2: Update pin to committed state on upload:committed
     */
    function onUploadCommitted(event) {
        const detail = event.detail;
        const uploadId = detail.uploadId;

        const pinData = pins.get(uploadId);
        if (!pinData) {
            // No optimistic pin was created (probably no GPS)
            return;
        }

        // Swap class from pending to committed
        pinData.element.classList.remove('photo-pin--pending');
        pinData.element.classList.add('photo-pin--committed');
        pinData.status = 'committed';

        // Update popup with real photo data if available
        if (detail.photo && mapUI && mapUI.createPopupHtml) {
            const popup = new maplibregl.Popup({
                offset: 25,
                closeButton: false,
                maxWidth: 'none',
                className: 'photo-map-popup'
            }).setHTML(mapUI.createPopupHtml(detail.photo));

            pinData.marker.setPopup(popup);
        }
    }

    /**
     * AC7.3: Update pin to failed state on upload:failed, add action buttons
     */
    function onUploadFailed(event) {
        const detail = event.detail;
        const uploadId = detail.uploadId;

        const pinData = pins.get(uploadId);
        if (!pinData) {
            // No optimistic pin was created (probably no GPS)
            return;
        }

        // Swap class to failed (red)
        pinData.element.classList.remove('photo-pin--pending');
        pinData.element.classList.add('photo-pin--failed');
        pinData.status = 'failed';

        // Create popup with action buttons
        const popupHtml = createFailedPinPopupHtml(uploadId, detail.exif);
        const popup = new maplibregl.Popup({
            offset: 25,
            closeButton: true,
            maxWidth: 'none',
            className: 'photo-map-popup'
        }).setHTML(popupHtml);

        pinData.marker.setPopup(popup);

        // Attach event listeners to buttons in popup
        popup.on('open', () => {
            attachFailedPinButtonHandlers(uploadId, popup, detail.exif);
        });
    }

    /**
     * AC7.5: Remove pin on upload:aborted
     */
    function onUploadAborted(event) {
        const uploadId = event.detail.uploadId;

        const pinData = pins.get(uploadId);
        if (!pinData) {
            return;
        }

        // Remove marker from map
        pinData.marker.remove();

        // Delete from map
        pins.delete(uploadId);
    }

    /**
     * Create HTML for failed pin popup with action buttons
     * @param {string} uploadId - Upload ID
     * @param {Object} exif - EXIF metadata
     * @returns {string} - HTML string
     */
    function createFailedPinPopupHtml(uploadId, exif) {
        const hasGps = exif?.gps && exif.gps.lat !== undefined && exif.gps.lon !== undefined;

        return `
            <div class="failed-pin-popup">
                <p>Upload failed</p>
                <div class="failed-pin-actions">
                    <button class="btn btn-retry" data-upload-id="${uploadId}">↻ Retry</button>
                    ${hasGps ? `<button class="btn btn-pin-drop" data-upload-id="${uploadId}">📍 Pin manually</button>` : ''}
                    <button class="btn btn-discard" data-upload-id="${uploadId}">✕ Discard</button>
                </div>
            </div>
        `;
    }

    /**
     * Attach event handlers to failed pin popup buttons
     * @param {string} uploadId - Upload ID
     * @param {maplibregl.Popup} popup - The popup instance
     * @param {Object} exif - EXIF metadata
     */
    function attachFailedPinButtonHandlers(uploadId, popup, exif) {
        const popupEl = popup.getElement();
        if (!popupEl) return;

        // Retry button
        const retryBtn = popupEl.querySelector('.btn-retry');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (UploadQueue && UploadQueue.retry) {
                    UploadQueue.retry(uploadId);
                }
                popup.remove();
            });
        }

        // Pin manually button (pin-drop)
        const pinDropBtn = popupEl.querySelector('.btn-pin-drop');
        if (pinDropBtn && exif?.gps) {
            pinDropBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (PostUI && PostUI.manualPinDropFor) {
                    PostUI.manualPinDropFor(uploadId);
                }
                popup.remove();
            });
        }

        // Discard button
        const discardBtn = popupEl.querySelector('.btn-discard');
        if (discardBtn) {
            discardBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (UploadQueue && UploadQueue.abort) {
                    UploadQueue.abort(uploadId);
                }
                popup.remove();
            });
        }
    }

    return {
        init: init
    };
})();
