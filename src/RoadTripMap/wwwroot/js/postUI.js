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
    photoMap: null,
    photoMapMarkers: [],
    routeVisible: false,
    currentFile: null,
    currentMetadata: null,
    currentLat: null,
    currentLng: null,
    carousel: null,
    markerLookup: new Map(),

    init(secretToken) {
        this.secretToken = secretToken;

        // Wire up event listeners
        document.getElementById('addPhotoButton').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.onFileSelected(e.target.files[0]);
            }
        });

        document.getElementById('cancelButton').addEventListener('click', () => {
            this.hidePreview();
        });

        document.getElementById('postButton').addEventListener('click', () => {
            this.onPostConfirm();
        });

        // Load trip info and existing photos
        this.loadTripInfo();
        this.loadPhotoList();
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

    async onFileSelected(file) {
        try {
            // Extract metadata (EXIF + geocoding)
            const metadata = await PostService.extractPhotoMetadata(file);
            this.currentFile = file;
            this.currentMetadata = metadata;

            if (metadata.gps) {
                // Has GPS data - show preview directly
                this.currentLat = metadata.gps.latitude;
                this.currentLng = metadata.gps.longitude;
                this.showPreview(file, metadata);
            } else {
                // No GPS - show pin-drop map for manual location
                this.showPinDropMap(file, metadata);
            }
        } catch (err) {
            console.error('Error selecting photo:', err);
            this.showToast('Error processing photo: ' + err.message, 'error');
        }
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

        // Show map section
        document.getElementById('mapSection').classList.add('visible');

        // Initialize map if not already done
        if (!this.map) {
            this.initializePinDropMap();
        }

        // Center map on default location (USA center)
        this.map.jumpTo({ center: [-98.5795, 39.8283], zoom: 4 });
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

    initializePinDropMap() {
        this.map = new maplibregl.Map({
            container: 'pinDropMap',
            style: MAP_STYLE,
            center: [-98.5795, 39.8283],
            zoom: 4
        });

        // Handle map clicks for marker placement
        this.map.on('click', async (e) => {
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
                this.currentMetadata.placeName = result.placeName;
            } catch (err) {
                console.warn('Failed to geocode:', err);
                const placeNameEl = document.getElementById('placeNameDisplay');
                placeNameEl.textContent = 'Location set';
                placeNameEl.classList.remove('no-gps');
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
        } catch (err) {
            console.error('Error posting photo:', err);
            this.showToast(err.message || 'Failed to post photo', 'error');
        } finally {
            const postBtn = document.getElementById('postButton');
            postBtn.disabled = false;
            postBtn.textContent = 'Post Photo';
        }
    },

    async refreshPhotoList() {
        await this.loadPhotoList();
    },

    async loadPhotoList() {
        try {
            const photos = await PostService.listPhotos(this.secretToken);

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

            // Render photo map
            this.renderPhotoMap(photos);

            // Initialize or update the carousel
            const container = document.getElementById('photoCarousel');
            container.innerHTML = '';
            this.carousel = PhotoCarousel.init(container, photos, {
                canDelete: true,
                onDelete: (photo) => this.onDeleteFromCarousel(photo),
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
                <button class="photo-popup-delete" data-photo-id="${photo.id}">✕</button>
            </div>`;

            const popup = new maplibregl.Popup({
                offset: 25,
                closeButton: false,
                maxWidth: 'none'
            }).setHTML(popupHtml);

            popup.on('open', () => {
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
                }
            });

            const marker = new maplibregl.Marker()
                .setLngLat([photo.lng, photo.lat])
                .setPopup(popup)
                .addTo(this.photoMap);

            this.photoMapMarkers.push(marker);
            this.markerLookup.set(photo.id, marker);
        });

        // Fit bounds
        if (photos.length === 1) {
            this.photoMap.jumpTo({ center: [photos[0].lng, photos[0].lat], zoom: 13 });
        } else {
            const bounds = new maplibregl.LngLatBounds();
            photos.forEach(p => bounds.extend([p.lng, p.lat]));
            this.photoMap.fitBounds(bounds, { padding: 50, maxZoom: 15 });
            this.setupRouteToggle(photos);
        }

        // Recalculate map size after container is visible
        setTimeout(() => this.photoMap.resize(), 100);
    },

    setupRouteToggle(photos) {
        if (photos.length < 2) return;
        const coords = photos.map(p => [p.lng, p.lat]);

        const addRoute = () => {
            if (this.photoMap.getSource('route')) return;
            this.photoMap.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: coords }
                }
            });
            this.photoMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { visibility: 'none' },
                paint: {
                    'line-color': '#3388ff',
                    'line-width': 3,
                    'line-opacity': 0.8
                }
            });
        };

        if (this.photoMap.loaded()) {
            addRoute();
        } else {
            this.photoMap.on('load', addRoute);
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

    hidePhotoMap() {
        const section = document.getElementById('photoMapSection');
        section.classList.remove('visible');
        const btn = document.getElementById('routeToggle');
        if (btn) btn.style.display = 'none';
    },

    showToast(message, type) {
        const container = document.getElementById('toastContainer');

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            toast.classList.add('dismissing');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
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
