/**
 * Post UI - DOM-specific rendering layer
 * All business logic delegates to PostService.
 * Handles the UI rendering and event binding for the photo posting page.
 */

const MAPTILER_KEY = 'uctgdtdamYqEtDUPiPHB';
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

const PostUI = {
    secretToken: null,
    map: null,
    marker: null,
    poiPopup: null,
    photoMap: null,
    photoMapMarkers: [],
    routeVisible: false,
    currentFile: null,
    currentMetadata: null,
    currentLat: null,
    currentLng: null,
    carousel: null,
    markerLookup: new Map(),
    photos: [],
    _refreshTimer: null,

    init(secretToken) {
        this.secretToken = secretToken;

        // Wire up event listeners
        document.getElementById('addPhotoButton').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length === 0) return;
            if (files.length === 1) {
                this.onFileSelected(files[0]);
            } else {
                this.onMultipleFilesSelected(files);
            }
            e.target.value = '';
        });

        document.getElementById('cancelButton').addEventListener('click', () => {
            this.hidePreview();
        });

        document.getElementById('postButton').addEventListener('click', () => {
            this.onPostConfirm();
        });

        // Save trip to localStorage for My Trips
        TripStorage.saveFromPostPage(this.secretToken);

        // Show home screen prompt for iOS Safari (first visit only)
        this.maybeShowHomeScreenPrompt();

        // Show persistent home screen link for iOS Safari
        if (this.isIOSSafari()) {
            const link = document.getElementById('homescreenLink');
            if (link) {
                link.style.display = '';
                document.getElementById('homescreenLinkBtn').addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showHomeScreenInstructions();
                });
            }
        }

        // Load trip info and existing photos
        this.loadTripInfo();
        this.loadPhotoList();

        // Resume uploads from previous session
        this.resumeUploads();

        // Mount new resilient uploads UI behind feature flag
        if (FeatureFlags.isEnabled('resilient-uploads-ui')) {
            this.mountResilientUploadsUI();
        }

        // Listen for upload events
        this.setupUploadEventListeners();
    },

    async mountResilientUploadsUI() {
        try {
            // Mount progress panel
            const progressPanelContainer = document.getElementById('progressPanelContainer');
            if (progressPanelContainer) {
                ProgressPanel.mount(progressPanelContainer);
            }

            // Mount resume banner
            const resumeBannerContainer = document.getElementById('resumeBannerContainer');
            if (resumeBannerContainer) {
                await ResumeBanner.mount(resumeBannerContainer, this.secretToken);
            }

            // Initialize optimistic pins (Task 8)
            // Note: OptimisticPins may not exist yet in earlier phases
            if (typeof OptimisticPins !== 'undefined') {
                OptimisticPins.init(this.mapUI);
            }
        } catch (err) {
            console.warn('Failed to mount resilient uploads UI:', err);
        }
    },

    async resumeUploads() {
        try {
            await UploadQueue.resume(this.secretToken);
        } catch (err) {
            console.warn('Failed to resume uploads:', err);
        }
    },

    setupUploadEventListeners() {
        // On committed upload, refresh the photo list
        UploadQueue.subscribe('upload:committed', (detail) => {
            console.log(`[PostUI] Upload committed: ${detail.uploadId}`);
            this.refreshPhotoList();
        });

        // On version reload required, alert the user (Phase 3 will add proper banner)
        UploadQueue.subscribe('version:reload-required', (detail) => {
            console.warn(
                `[PostUI] Version reload required. Server version: ${detail.serverVersion}, ` +
                `client minimum: ${detail.clientMin}, current: ${detail.currentVersion}`
            );
            alert(
                'A new version of this app is available. Please reload the page to get the latest features.'
            );
        });
    },

    isIOSSafari() {
        const ua = navigator.userAgent;
        const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
        const isStandalone = window.navigator.standalone === true;
        return isIOS && isSafari && !isStandalone;
    },

    maybeShowHomeScreenPrompt() {
        if (!this.isIOSSafari()) return;
        if (localStorage.getItem('roadtripmap_homescreen_dismissed')) return;

        const overlay = document.createElement('div');
        overlay.className = 'homescreen-modal-overlay';
        overlay.innerHTML = this._homeScreenModalHTML(true);


        overlay.querySelector('.homescreen-dismiss').addEventListener('click', () => {
            localStorage.setItem('roadtripmap_homescreen_dismissed', 'true');
            overlay.remove();
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                localStorage.setItem('roadtripmap_homescreen_dismissed', 'true');
                overlay.remove();
            }
        });

        document.body.appendChild(overlay);
    },

    _homeScreenModalHTML(showIntro) {
        const intro = showIntro
            ? '<p>This page works better on mobile if you save it to your Home Screen. You\'ll get quick access without remembering the URL.</p>'
            : '';
        const btnText = showIntro ? 'Got it' : 'Close';
        return `
            <div class="homescreen-modal">
                <h2>Save to Home Screen</h2>
                ${intro}
                <div class="homescreen-diagram">
                    <div class="homescreen-step">
                        <div class="homescreen-step-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/></svg>
                        </div>
                        <div class="homescreen-step-label">Tap <strong>&#x22EF;</strong></div>
                    </div>
                    <div class="homescreen-step-arrow">&#x203A;</div>
                    <div class="homescreen-step">
                        <div class="homescreen-step-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="8" width="16" height="14" rx="2"/><polyline points="15 4 12 1 9 4"/><line x1="12" y1="1" x2="12" y2="14"/></svg>
                        </div>
                        <div class="homescreen-step-label">Tap <strong>Share</strong></div>
                    </div>
                    <div class="homescreen-step-arrow">&#x203A;</div>
                    <div class="homescreen-step">
                        <div class="homescreen-step-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="7 10 12 15 17 10"/></svg>
                        </div>
                        <div class="homescreen-step-label">Tap <strong>More</strong></div>
                    </div>
                    <div class="homescreen-step-arrow">&#x203A;</div>
                    <div class="homescreen-step">
                        <div class="homescreen-step-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        </div>
                        <div class="homescreen-step-label"><strong>Add to Home Screen</strong></div>
                    </div>
                </div>
                <button class="button button-primary homescreen-dismiss">${btnText}</button>
            </div>
        `;
    },

    showHomeScreenInstructions() {
        const overlay = document.createElement('div');
        overlay.className = 'homescreen-modal-overlay';
        overlay.innerHTML = this._homeScreenModalHTML(false);

        overlay.querySelector('.homescreen-dismiss').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async loadTripInfo() {
        try {
            const trip = await API.getTripInfoBySecret(this.secretToken);
            document.getElementById('tripName').textContent = trip.name;
            if (trip.description) {
                document.getElementById('tripDescription').textContent = trip.description;
            }
            // Show view link for sharing
            if (trip.viewUrl) {
                const section = document.getElementById('viewLinkSection');
                const origin = window.location.origin;
                document.getElementById('viewUrlValue').textContent = origin + trip.viewUrl;
                section.style.display = '';
                document.getElementById('copyViewLink').addEventListener('click', () => {
                    const text = document.getElementById('viewUrlValue').textContent;
                    navigator.clipboard.writeText(text).then(() => {
                        const btn = document.getElementById('copyViewLink');
                        btn.textContent = 'Copied!';
                        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
                    });
                });
            }
        } catch (err) {
            console.error('Failed to load trip info:', err);
            document.getElementById('tripName').textContent = 'Trip';
        }
    },

    showLocationPrompt(file, metadata) {
        const overlay = document.createElement('div');
        overlay.className = 'homescreen-modal-overlay';
        overlay.innerHTML = `
            <div class="homescreen-modal">
                <h2>Add Location</h2>
                <p>This photo doesn't have location data. Use your current location?</p>
                <div class="edit-location-actions">
                    <button class="button button-secondary" id="locationPromptPin">Set on map</button>
                    <button class="button button-primary" id="locationPromptUse">Use my location</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('locationPromptUse').addEventListener('click', () => {
            overlay.remove();
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    metadata.gps = {
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude
                    };
                    try {
                        const result = await API.geocode(pos.coords.latitude, pos.coords.longitude);
                        metadata.placeName = result.placeName;
                    } catch { /* geocode failure is non-fatal */ }
                    this.currentFile = file;
                    this.currentMetadata = metadata;
                    this.currentLat = pos.coords.latitude;
                    this.currentLng = pos.coords.longitude;
                    this.showPreview(file, metadata);
                },
                () => {
                    this.showToast('Location denied. Check Settings → Privacy → Location Services → Safari Websites', 'error', 6000);
                    this.showPinDropMap(file, metadata);
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });

        document.getElementById('locationPromptPin').addEventListener('click', () => {
            overlay.remove();
            this.showPinDropMap(file, metadata);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                this.showPinDropMap(file, metadata);
            }
        });
    },

    isFreshCameraCapture(file) {
        // Camera captures on iOS have lastModified within seconds of now
        return (Date.now() - file.lastModified) < 30000;
    },

    async onFileSelected(file) {
        try {
            // Extract metadata (EXIF + geocoding)
            const metadata = await PostService.extractPhotoMetadata(file);
            this.currentFile = file;
            this.currentMetadata = metadata;

            if (this.pendingPoiLocation) {
                // User selected a POI location before choosing a photo — use it
                const { lat, lng, name } = this.pendingPoiLocation;
                this.pendingPoiLocation = null;
                this.currentLat = lat;
                this.currentLng = lng;
                metadata.gps = { latitude: lat, longitude: lng };
                metadata.placeName = name;
                this.showPreview(file, metadata);
            } else if (metadata.gps) {
                // Has GPS data - show preview directly
                this.currentLat = metadata.gps.latitude;
                this.currentLng = metadata.gps.longitude;
                this.showPreview(file, metadata);
            } else if (this.isFreshCameraCapture(file)) {
                // Fresh camera capture with no EXIF GPS (iOS strips it)
                // Prompt user to use device location — must be a direct user gesture
                this.showLocationPrompt(file, metadata);
                return;
            } else {
                // Library photo with no GPS - show pin-drop map
                this.showPinDropMap(file, metadata);
            }
        } catch (err) {
            console.error('Error selecting photo:', err);
            this.showToast('Error processing photo: ' + err.message, 'error');
        }
    },

    async onMultipleFilesSelected(fileList) {
        const files = Array.from(fileList);
        this.showToast(`Processing ${files.length} photos...`, 'info');

        // Extract metadata for all files (sequential to avoid iOS file handle issues)
        const withMetadata = [];
        for (const file of files) {
            try {
                console.log(`[BulkUpload] Processing ${file.name} (${file.size} bytes, type: ${file.type})`);
                const metadata = await PostService.extractPhotoMetadata(file);
                console.log(`[BulkUpload] ${file.name}: gps=${metadata.gps ? 'yes' : 'no'}, place=${metadata.placeName}`);
                withMetadata.push({ file, metadata });
            } catch (err) {
                console.warn(`[BulkUpload] Failed to extract metadata from ${file.name}:`, err);
            }
        }
        console.log(`[BulkUpload] Triage: ${withMetadata.filter(f => f.metadata.gps).length} GPS, ${withMetadata.filter(f => !f.metadata.gps).length} no-GPS`);

        // Triage: split into GPS-tagged and untagged
        const gpsFiles = withMetadata.filter(f => f.metadata.gps);
        const noGpsFiles = withMetadata.filter(f => !f.metadata.gps);

        // Start GPS uploads immediately via queue with new format
        if (gpsFiles.length > 0) {
            // Transform to resilient queue format with image processing
            const filesWithUploadIds = [];
            for (const item of gpsFiles) {
                const uploadId = UploadUtils.newGuid();

                // Emit preparing event for progress panel
                document.dispatchEvent(new CustomEvent('upload:preparing', {
                    detail: { uploadId, fileName: item.file.name }
                }));

                let processResult;
                try {
                    processResult = await ImageProcessor.processForUpload(item.file, item.metadata);
                } catch (processingError) {
                    // Processing failed -- surface error, record telemetry, skip this file
                    document.dispatchEvent(new CustomEvent('upload:failed', {
                        detail: {
                            uploadId,
                            fileName: item.file.name,
                            error: processingError.message,
                            phase: 'processing',
                        }
                    }));
                    if (typeof UploadTelemetry !== 'undefined') {
                        UploadTelemetry.recordProcessingFailed(uploadId, processingError.message);
                    }
                    continue; // Skip to next file
                }

                filesWithUploadIds.push({
                    file: processResult.original,
                    metadata: item.metadata,
                    uploadId,
                    display: processResult.display,
                    thumb: processResult.thumb,
                });

                // Record telemetry
                if (typeof UploadTelemetry !== 'undefined') {
                    UploadTelemetry.recordProcessingApplied(uploadId, {
                        compressionApplied: processResult.compressionApplied,
                        heicConverted: processResult.heicConverted,
                        originalBytes: processResult.originalBytes,
                        outputBytes: processResult.outputBytes,
                        durationMs: processResult.durationMs,
                    });
                }
            }

            if (filesWithUploadIds.length > 0) {
                UploadQueue.start(this.secretToken, filesWithUploadIds, {
                    onEachComplete: () => this.refreshPhotoList(),
                    onAllComplete: () => this.handleNoGpsFiles(noGpsFiles)
                });
            } else {
                this.handleNoGpsFiles(noGpsFiles);
            }
        } else {
            this.handleNoGpsFiles(noGpsFiles);
        }

        // Show non-GPS info
        if (noGpsFiles.length > 0 && gpsFiles.length > 0) {
            if (noGpsFiles.length <= 5) {
                this.showToast(
                    `${noGpsFiles.length} photo${noGpsFiles.length > 1 ? 's' : ''} need a location — set pins after upload`,
                    'info'
                );
            } else {
                this.showToast(`${noGpsFiles.length} photos skipped — no GPS data`, 'info');
            }
        }
    },

    /**
     * Handle files without GPS data — either queue for sequential pin-drop
     * or route failed upload to manual pin-drop endpoint.
     * @param {Array} noGpsFiles - Array of {file, metadata} objects without GPS
     * @param {Object} options - Optional config
     * @param {string} options.uploadId - If provided, route to pin-drop endpoint for failed upload
     */
    async handleNoGpsFiles(noGpsFiles, { uploadId = null } = {}) {
        if (uploadId) {
            // Failure routing: user clicked [📍 Pin manually] on a failed upload
            // Delegate to manualPinDropFor which opens the pin-drop map
            await this.manualPinDropFor(uploadId);
            return;
        }

        // Normal path: queue for sequential pin-drop (new files from bulk upload)
        if (noGpsFiles.length === 0) return;

        if (noGpsFiles.length <= 5) {
            // Queue for sequential pin-drop
            this.pinDropQueue = [...noGpsFiles];
            this.showToast(`${noGpsFiles.length} photo${noGpsFiles.length > 1 ? 's' : ''} need a location`, 'info');
            this.processNextPinDrop();
        } else {
            this.showToast(`${noGpsFiles.length} photos skipped — no GPS data. Add them individually to set a pin.`, 'info');
        }
    },

    processNextPinDrop() {
        if (!this.pinDropQueue || this.pinDropQueue.length === 0) {
            this.pinDropQueue = null;
            return;
        }
        const next = this.pinDropQueue.shift();
        this.currentFile = next.file;
        this.currentMetadata = next.metadata;
        this.showPinDropMap(next.file, next.metadata);
    },

    showPreview(file, metadata) {
        // Show thumbnail
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('photoThumbnail').src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Show place name
        const placeNameEl = document.getElementById('placeNameDisplay');
        if (metadata.gps) {
            placeNameEl.textContent = metadata.placeName || 'Resolving location...';
            placeNameEl.classList.remove('no-gps');
        } else {
            placeNameEl.textContent = 'Tap map to set location';
            placeNameEl.classList.add('no-gps');
        }

        // Hide map section
        document.getElementById('mapSection').classList.remove('visible');

        // Clear caption input
        document.getElementById('captionInput').value = '';

        // Show preview section
        document.getElementById('previewSection').classList.add('visible');
        document.getElementById('fileInput').value = '';
    },

    showPinDropMap(file, metadata) {
        // Show thumbnail
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('photoThumbnail').src = e.target.result;
        };
        reader.readAsDataURL(file);

        // Show place name
        const placeNameEl = document.getElementById('placeNameDisplay');
        placeNameEl.textContent = 'Tap map to set location';
        placeNameEl.classList.add('no-gps');

        // Hide photo map when pin-drop opens (avoid two maps on screen)
        document.getElementById('photoMapSection')?.classList.remove('visible');

        // Show map section
        document.getElementById('mapSection').classList.add('visible');

        // Initialize map if not already done
        if (!this.map) {
            this.initializePinDropMap();
        }

        // If user came from "Pick nearby spot", center on that POI area
        // Otherwise use default (last photo or USA center)
        let center, zoom;
        if (this.pendingPoiZoom) {
            center = [this.pendingPoiZoom.lng, this.pendingPoiZoom.lat];
            zoom = 13;
            this.pendingPoiZoom = null;
        } else {
            ({ center, zoom } = this.getDefaultMapCenter());
        }
        this.map.jumpTo({ center, zoom });
        if (this.marker) {
            this.marker.remove();
        }

        // Clear caption input
        document.getElementById('captionInput').value = '';

        // Show preview section
        document.getElementById('previewSection').classList.add('visible');
        document.getElementById('fileInput').value = '';

        // MapLibre needs a size recalc after container becomes visible
        setTimeout(() => {
            if (this.map) this.map.resize();
        }, 100);
    },

    _poiActionOptions() {
        return {
            onPoiSelect: (lat, lng, name) => {
                // Store POI location for the next photo upload
                this.pendingPoiLocation = { lat, lng, name };
                this.currentLat = lat;
                this.currentLng = lng;

                // Check if pin-drop map is actively visible (not just initialized)
                const mapSection = document.getElementById('mapSection');
                const pinDropVisible = mapSection && mapSection.classList.contains('visible');

                if (pinDropVisible && this.map) {
                    // Pin-drop map is open — place marker there
                    if (this.marker) this.marker.remove();
                    this.marker = new maplibregl.Marker()
                        .setLngLat([lng, lat])
                        .addTo(this.map);
                    this.setLocationFromPoi(lat, lng, name);
                } else {
                    // Photo map context — open Add Photo flow with this location
                    this.showToast(`Location set: ${name}. Select a photo to post here.`, 'success');
                    document.getElementById('addPhotoButton')?.click();
                }
            },
            onPoiZoom: (lat, lng) => {
                if (this.map) {
                    // Pin-drop map already open: just zoom in for precise placement
                    this.map.flyTo({ center: [lng, lat], zoom: 13 });
                } else {
                    // Photo map: hide it and open pin-drop map centered on the POI area
                    document.getElementById('photoMapSection')?.classList.remove('visible');
                    document.getElementById('mapSection').classList.add('visible');
                    document.getElementById('previewSection').classList.add('visible');

                    // Set place name hint
                    const placeNameEl = document.getElementById('placeNameDisplay');
                    if (placeNameEl) {
                        placeNameEl.textContent = 'Tap map to set location';
                        placeNameEl.classList.add('no-gps');
                    }

                    if (!this.map) {
                        this.initializePinDropMap();
                    }

                    this.map.jumpTo({ center: [lng, lat], zoom: 13 });
                    if (this.marker) this.marker.remove();
                    this.map.resize();

                    // Initialize metadata so the click handler doesn't crash
                    if (!this.currentMetadata) {
                        this.currentMetadata = { gps: null, placeName: null };
                    }

                    // Mark that we're in "pick nearby" mode — next map tap places a pin
                    // and opens the file picker
                    this.pendingNearbyPinDrop = true;
                }
            }
        };
    },

    setLocationFromPoi(lat, lng, name) {
        // Update current coordinates
        this.currentLat = lat;
        this.currentLng = lng;

        // Update metadata with place name
        if (this.currentMetadata) {
            this.currentMetadata.placeName = name;
        }

        // Update place name display
        const placeNameEl = document.getElementById('placeNameDisplay');
        if (placeNameEl) {
            placeNameEl.textContent = name;
            placeNameEl.classList.remove('no-gps');
        }
    },

    getDefaultMapCenter() {
        // Determine map center and zoom level based on existing photos
        // Returns { center: [lng, lat], zoom: number }
        let center = [-98.5795, 39.8283];  // Center of US fallback
        let zoom = 4;

        if (this.photos && this.photos.length > 0) {
            const lastPhoto = this.photos[this.photos.length - 1];
            // Use explicit null/undefined checks to handle lat/lng of 0
            if (lastPhoto.lat != null && lastPhoto.lng != null) {
                center = [lastPhoto.lng, lastPhoto.lat];
                zoom = 10;
            }
        }

        return { center, zoom };
    },

    initializePinDropMap() {
        // Get default center and zoom from helper
        const { center, zoom } = this.getDefaultMapCenter();

        this.map = new maplibregl.Map({
            container: 'pinDropMap',
            style: MAP_STYLE,
            center: center,
            zoom: zoom
        });

        // Apply park restyling and POI layer with tap-to-pin actions
        this.map.on('load', () => {
            applyParkStyling(this.map, this._poiActionOptions());
            PoiLayer.init(this.map, this._poiActionOptions());
            StateParkLayer.init(this.map, this._poiActionOptions());
        });

        // Handle map clicks for marker placement
        this.map.on('click', async (e) => {
            // Skip if click was on a POI marker or national park dot
            const clickLayers = ['poi-markers'];
            if (this.map.getLayer('nps-centroid-dot')) clickLayers.push('nps-centroid-dot');
            const poiFeatures = this.map.queryRenderedFeatures(e.point, { layers: clickLayers });
            if (poiFeatures.length > 0) return;

            const { lng, lat } = e.lngLat;
            this.currentLat = lat;
            this.currentLng = lng;

            // Remove old marker
            if (this.marker) {
                this.marker.remove();
            }

            // Add new marker
            this.marker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(this.map);

            // Geocode the location
            try {
                const result = await API.geocode(lat, lng);
                const placeNameEl = document.getElementById('placeNameDisplay');
                placeNameEl.textContent = result.placeName || 'Location set';
                placeNameEl.classList.remove('no-gps');
                if (this.currentMetadata) {
                    this.currentMetadata.placeName = result.placeName;
                }
            } catch (err) {
                console.warn('Failed to geocode:', err);
                const placeNameEl = document.getElementById('placeNameDisplay');
                placeNameEl.textContent = 'Location set';
                placeNameEl.classList.remove('no-gps');
            }

            // If this is a manual pin-drop for a failed upload, submit it to the API
            if (this._manualPinDropUploadId) {
                await this.submitManualPinDrop(lat, lng);
                this._manualPinDropUploadId = null;
                return;
            }

            // If we came from "Pick nearby spot", open file picker after pin placement
            if (this.pendingNearbyPinDrop) {
                this.pendingNearbyPinDrop = false;
                // Store location so onFileSelected uses it
                this.pendingPoiLocation = { lat, lng, name: document.getElementById('placeNameDisplay')?.textContent || 'Location set' };
                document.getElementById('fileInput')?.click();
            }
        });
    },

    hidePreview() {
        document.getElementById('previewSection').classList.remove('visible');
        document.getElementById('mapSection').classList.remove('visible');
        this.currentFile = null;
        this.currentMetadata = null;
        this.currentLat = null;
        this.currentLng = null;
        this.marker = null;
    },

    async onPostConfirm() {
        if (!this.currentFile || this.currentLat === null || this.currentLng === null) {
            this.showToast('Please select a location', 'error');
            return;
        }

        const caption = document.getElementById('captionInput').value.trim() || null;
        const takenAt = this.currentMetadata?.timestamp || null;

        try {
            // Show loading state
            const postBtn = document.getElementById('postButton');
            postBtn.disabled = true;
            postBtn.textContent = 'Posting...';

            // Upload photo
            const result = await PostService.uploadPhoto(
                this.secretToken,
                this.currentFile,
                this.currentLat,
                this.currentLng,
                caption,
                takenAt
            );

            this.showToast('Photo posted!', 'success');
            this.hidePreview();
            await this.refreshPhotoList();
            // If pin-drop queue has more items, process next
            if (this.pinDropQueue && this.pinDropQueue.length > 0) {
                this.processNextPinDrop();
            }
        } catch (err) {
            console.error('Error posting photo:', err);
            this.showToast(err.message || 'Failed to post photo', 'error');
        } finally {
            const postBtn = document.getElementById('postButton');
            postBtn.disabled = false;
            postBtn.textContent = 'Post Photo';
        }
    },

    /**
     * Handle manual pin-drop for a failed upload
     * @param {string} uploadId - The upload ID to pin-drop
     */
    async manualPinDropFor(uploadId) {
        try {
            // Fetch the upload item from storage
            const item = await StorageAdapter.getItem(uploadId);
            if (!item) {
                this.showToast('Upload not found', 'error');
                return;
            }

            // Clear current state and set up for pin-drop
            this.currentFile = null;
            this.currentLat = null;
            this.currentLng = null;
            this.currentMetadata = item.exif || {};
            this._manualPinDropUploadId = uploadId; // Track which upload we're pinning

            // Show the pin-drop map
            const placeNameEl = document.getElementById('placeNameDisplay');
            placeNameEl.textContent = 'Tap map to set location for upload';
            placeNameEl.classList.add('no-gps');

            // Hide photo map if visible
            document.getElementById('photoMapSection')?.classList.remove('visible');

            // Show map section
            document.getElementById('mapSection').classList.add('visible');

            // Initialize map if not already done
            if (!this.map) {
                this.initializePinDropMap();
            }

            // Center map on last known location or USA center
            const { center, zoom } = this.getDefaultMapCenter();
            this.map.jumpTo({ center, zoom });

        } catch (err) {
            console.error('Error preparing manual pin-drop:', err);
            this.showToast('Failed to prepare pin-drop', 'error');
        }
    },

    /**
     * Submit manual pin-drop location for a failed upload
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     */
    async submitManualPinDrop(lat, lng) {
        const uploadId = this._manualPinDropUploadId;
        if (!uploadId) {
            this.showToast('No upload selected for pin-drop', 'error');
            return;
        }

        try {
            const postBtn = document.getElementById('postButton');
            if (postBtn) {
                postBtn.disabled = true;
                postBtn.textContent = 'Setting location...';
            }

            // Call the pin-drop API
            const result = await API.pinDropPhoto(this.secretToken, {
                photoId: uploadId,
                gpsLat: lat,
                gpsLon: lng,
            });

            // Update storage to mark as committed
            const item = await StorageAdapter.getItem(uploadId);
            if (item) {
                await StorageAdapter.putItem({
                    ...item,
                    status: 'committed',
                });

                // Emit upload:committed event for progress panel and optimistic pins
                document.dispatchEvent(
                    new CustomEvent('upload:committed', {
                        detail: {
                            uploadId,
                            tripToken: this.secretToken,
                            photo: result,
                        },
                    })
                );
            }

            this.showToast('Location set!', 'success');
            this.hidePreview();
            await this.refreshPhotoList();

        } catch (err) {
            console.error('Error setting pin-drop location:', err);
            this.showToast(err.message || 'Failed to set location', 'error');
        } finally {
            const postBtn = document.getElementById('postButton');
            if (postBtn) {
                postBtn.disabled = false;
                postBtn.textContent = 'Post Photo';
            }
        }
    },

    refreshPhotoList() {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.loadPhotoList(), 500);
    },

    async loadPhotoList() {
        try {
            const photos = await PostService.listPhotos(this.secretToken);
            this.photos = photos;

            // If pin-drop map is currently visible, update its center to reflect newly loaded photos
            const mapSection = document.getElementById('mapSection');
            if (this.map && mapSection && mapSection.classList.contains('visible')) {
                const { center, zoom } = this.getDefaultMapCenter();
                this.map.jumpTo({ center, zoom });
            }

            const photoList = document.getElementById('photoList');
            const photoMapSection = document.getElementById('photoMapSection');

            if (photos.length === 0) {
                photoList.classList.add('empty');
                photoMapSection.classList.remove('visible');
                this.hidePhotoMap();
                return;
            }

            photoList.classList.remove('empty');
            photoMapSection.classList.add('visible');

            // Render photo map (graceful degradation if WebGL unavailable)
            try {
                this.renderPhotoMap(photos);
            } catch (mapErr) {
                console.warn('Map render failed:', mapErr.message);
            }

            // Initialize or update the carousel
            const container = document.getElementById('photoCarousel');
            container.innerHTML = '';
            this.carousel = PhotoCarousel.init(container, photos, {
                canDelete: true,
                onDelete: (photo) => this.onDeleteFromCarousel(photo),
                onEditLocation: (photo) => this.onEditLocation(photo),
                onSelect: (photo) => this.onCarouselSelect(photo)
            });
        } catch (err) {
            console.error('Error loading photos:', err);
            this.showToast('Failed to load photos', 'error');
        }
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    renderPhotoMap(photos) {
        // Clear existing markers
        this.photoMapMarkers.forEach(m => m.remove());
        this.photoMapMarkers = [];
        this.markerLookup.clear();
        if (this.photoMap && this.photoMap.getLayer('route')) {
            this.photoMap.removeLayer('route');
            this.photoMap.removeSource('route');
            this.routeVisible = false;
        }

        // Initialize map if not done
        if (!this.photoMap) {
            this.photoMap = new maplibregl.Map({
                container: 'photoMap',
                style: MAP_STYLE,
                center: [-98.5795, 39.8283],
                zoom: 4
            });

            // Apply park restyling and POI layer with tap-to-pin on photo map too
            this.photoMap.on('load', () => {
                applyParkStyling(this.photoMap, this._poiActionOptions());
                PoiLayer.init(this.photoMap, this._poiActionOptions());
                StateParkLayer.init(this.photoMap, this._poiActionOptions());
            });
        }

        // Add markers with carousel sync
        photos.forEach(photo => {
            const date = photo.takenAt ? new Date(photo.takenAt).toLocaleDateString() : 'Date unknown';
            const escapedPlace = this.escapeHtml(photo.placeName);
            const escapedCaption = this.escapeHtml(photo.caption);

            const popupHtml = `<div class="photo-popup">
                <img src="${photo.displayUrl}" class="photo-popup-img" data-full-src="${photo.displayUrl}">
                <div class="photo-popup-overlay">
                    <div class="photo-popup-place">${escapedPlace}</div>
                    ${escapedCaption ? `<div class="photo-popup-caption">${escapedCaption}</div>` : ''}
                    <div class="photo-popup-date">${date}</div>
                </div>
            </div>`;

            const popup = new maplibregl.Popup({
                offset: 25,
                closeButton: false,
                maxWidth: 'none',
                className: 'photo-map-popup'
            }).setHTML(popupHtml);

            popup.on('open', () => {
                // Close all other popups (MapLibre allows multiple open)
                this.photoMapMarkers.forEach(m => {
                    if (m !== marker && m.getPopup().isOpen()) m.togglePopup();
                });
                if (this.carousel) {
                    this.carousel.selectPhoto(photo.id);
                }
                const popupEl = popup.getElement();
                if (popupEl) {
                    const img = popupEl.querySelector('.photo-popup-img');
                    if (img && !img.dataset.listenerAttached) {
                        img.dataset.listenerAttached = 'true';
                        img.style.cursor = 'pointer';
                        img.addEventListener('click', (e) => {
                            e.stopPropagation();
                            PhotoCarousel.showFullscreen(photo);
                        });
                    }
                    // Pan map to keep popup in view
                    this.panToFitPopup(this.photoMap, popupEl);
                }
            });

            const marker = new maplibregl.Marker()
                .setLngLat([photo.lng, photo.lat])
                .setPopup(popup)
                .addTo(this.photoMap);

            this.photoMapMarkers.push(marker);
            this.markerLookup.set(photo.id, marker);
        });

        // Resize first (container may have just become visible), then fit bounds
        // Also reload POIs for the new viewport
        setTimeout(() => {
            this.photoMap.resize();

            if (photos.length === 1) {
                this.photoMap.jumpTo({ center: [photos[0].lng, photos[0].lat], zoom: 13 });
            } else {
                const bounds = new maplibregl.LngLatBounds();
                photos.forEach(p => bounds.extend([p.lng, p.lat]));
                this.photoMap.fitBounds(bounds, { padding: 50, maxZoom: 15 });
                this.setupRouteToggle(photos);
            }

            // Reload POIs for the new viewport
            PoiLayer.loadPois(this.photoMap);
        }, 150);

        // Setup POI toggle button
        const poiBtn = document.getElementById('poiToggle');
        if (poiBtn && !poiBtn.dataset.bound) {
            poiBtn.dataset.bound = 'true';
            poiBtn.onclick = () => {
                const visible = PoiLayer.toggle(this.photoMap);
                poiBtn.textContent = visible ? 'Hide POIs' : 'Show POIs';
            };
        }
    },

    setupRouteToggle(photos) {
        if (photos.length < 2) return;
        const coords = photos.map(p => [p.lng, p.lat]);
        const smoothCoords = MapService.smoothRoute(coords);

        const addRoute = () => {
            if (this.photoMap.getSource('route')) return;
            this.photoMap.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: smoothCoords }
                }
            });
            this.photoMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { visibility: 'none' },
                paint: {
                    'line-color': '#2a9d8f',
                    'line-width': 2.5,
                    'line-opacity': 0.7,
                    'line-dasharray': [3, 2]
                }
            });
        };

        if (this.photoMap.isStyleLoaded()) {
            addRoute();
        } else {
            this.photoMap.once('idle', addRoute);
        }

        const btn = document.getElementById('routeToggle');
        if (btn) {
            btn.style.display = 'block';
            btn.textContent = 'Show Route';
            btn.onclick = () => this.toggleRoute();
        }
    },

    toggleRoute() {
        const btn = document.getElementById('routeToggle');
        if (this.routeVisible) {
            this.photoMap.setLayoutProperty('route', 'visibility', 'none');
            if (btn) btn.textContent = 'Show Route';
        } else {
            this.photoMap.setLayoutProperty('route', 'visibility', 'visible');
            if (btn) btn.textContent = 'Hide Route';
        }
        this.routeVisible = !this.routeVisible;
    },

    panToFitPopup(map, popupEl) {
        const padding = 20;
        const mapRect = map.getContainer().getBoundingClientRect();
        const popupRect = popupEl.getBoundingClientRect();
        let dx = 0, dy = 0;
        if (popupRect.left < mapRect.left + padding) dx = popupRect.left - mapRect.left - padding;
        if (popupRect.right > mapRect.right - padding) dx = popupRect.right - mapRect.right + padding;
        if (popupRect.top < mapRect.top + padding) dy = popupRect.top - mapRect.top - padding;
        if (popupRect.bottom > mapRect.bottom - padding) dy = popupRect.bottom - mapRect.bottom + padding;
        if (dx !== 0 || dy !== 0) {
            map.panBy([dx, dy], { duration: 300 });
        }
    },

    onCarouselSelect(photo) {
        const marker = this.markerLookup.get(photo.id);
        if (marker) {
            this.photoMap.flyTo({ center: [photo.lng, photo.lat], zoom: 15 });
            if (!marker.getPopup().isOpen()) {
                marker.togglePopup();
            }
        }
        PhotoCarousel.showFullscreen(photo);
    },

    async onDeleteFromCarousel(photo) {
        if (!confirm('Delete this photo?')) return;
        try {
            await PostService.deletePhoto(this.secretToken, photo.id);
            this.showToast('Photo deleted', 'success');
            await this.refreshPhotoList();
        } catch (err) {
            this.showToast('Failed to delete photo', 'error');
        }
    },

    onEditLocation(photo) {
        // Create modal overlay with pin-drop map
        const overlay = document.createElement('div');
        overlay.className = 'homescreen-modal-overlay';
        overlay.innerHTML = `
            <div class="edit-location-modal">
                <h2>Edit Location</h2>
                <p id="editLocationPlace">${photo.placeName || 'Unknown location'}</p>
                <div id="editLocationMap" class="edit-location-map"></div>
                <div class="edit-location-actions">
                    <button class="button button-secondary" id="editLocationCancel">Cancel</button>
                    <button class="button button-primary" id="editLocationSave" disabled>Save Location</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Initialize map centered on photo's current location
        const center = (photo.lat && photo.lng) ? [photo.lng, photo.lat] : [-98.5795, 39.8283];
        const zoom = (photo.lat && photo.lng) ? 12 : 4;

        const map = new maplibregl.Map({
            container: 'editLocationMap',
            style: MAP_STYLE,
            center: center,
            zoom: zoom
        });

        let marker = null;
        let newLat = null;
        let newLng = null;
        const saveBtn = document.getElementById('editLocationSave');
        const placeEl = document.getElementById('editLocationPlace');

        // Show existing location marker
        if (photo.lat && photo.lng) {
            marker = new maplibregl.Marker().setLngLat([photo.lng, photo.lat]).addTo(map);
        }

        // Handle map clicks
        map.on('click', async (e) => {
            const { lng, lat } = e.lngLat;
            newLat = lat;
            newLng = lng;

            if (marker) marker.remove();
            marker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(map);
            saveBtn.disabled = false;

            try {
                const result = await API.geocode(lat, lng);
                placeEl.textContent = result.placeName || 'Location set';
            } catch {
                placeEl.textContent = 'Location set';
            }
        });

        // Cancel
        document.getElementById('editLocationCancel').addEventListener('click', () => {
            map.remove();
            overlay.remove();
        });

        // Save
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            try {
                await API.updatePhotoLocation(this.secretToken, photo.id, newLat, newLng);
                this.showToast('Location updated', 'success');
                map.remove();
                overlay.remove();
                this.refreshPhotoList();
            } catch (err) {
                this.showToast('Failed to update location', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Location';
            }
        });

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                map.remove();
                overlay.remove();
            }
        });

        // Resize map after modal is visible
        setTimeout(() => map.resize(), 100);
    },

    hidePhotoMap() {
        const section = document.getElementById('photoMapSection');
        section.classList.remove('visible');
        const btn = document.getElementById('routeToggle');
        if (btn) btn.style.display = 'none';
    },

    showToast(message, type, duration) {
        const container = document.getElementById('toastContainer');

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('dismissing');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, duration || 3000);
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Extract secret token from URL
    const pathParts = window.location.pathname.split('/');
    const secretToken = pathParts[pathParts.length - 1];

    if (!secretToken || secretToken === 'post') { // pragma: allowlist secret
        document.getElementById('errorMessage').textContent = 'Invalid trip URL';
        document.getElementById('errorMessage').classList.remove('hidden');
        return;
    }

    PostUI.init(secretToken);
});
