/**
 * Post UI - DOM-specific rendering layer
 * All business logic delegates to PostService.
 * Handles the UI rendering and event binding for the photo posting page.
 */

const PostUI = {
    secretToken: null,
    map: null,
    marker: null,
    photoMap: null,
    photoMapMarkers: [],
    routeLayer: null,
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
        this.map.setView([39.8283, -98.5795], 4);
        if (this.marker) {
            this.map.removeLayer(this.marker);
        }

        // Clear caption input
        document.getElementById('captionInput').value = '';

        // Show preview section
        document.getElementById('previewSection').classList.add('visible');
        document.getElementById('fileInput').value = '';

        // Leaflet needs a size recalc after container becomes visible
        setTimeout(() => {
            if (this.map) this.map.invalidateSize();
        }, 100);
    },

    initializePinDropMap() {
        // Create map
        this.map = L.map('pinDropMap').setView([39.8283, -98.5795], 4);

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
        }).addTo(this.map);

        // Handle map clicks for marker placement
        this.map.on('click', async (e) => {
            const { lat, lng } = e.latlng;
            this.currentLat = lat;
            this.currentLng = lng;

            // Remove old marker
            if (this.marker) {
                this.map.removeLayer(this.marker);
            }

            // Add new marker
            this.marker = L.marker([lat, lng]).addTo(this.map);

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
            // Disable button
            document.getElementById('postButton').disabled = true;

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
            document.getElementById('postButton').disabled = false;
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
        if (this.routeLayer) {
            this.routeLayer.remove();
            this.routeLayer = null;
            this.routeVisible = false;
        }

        // Initialize map if not done
        if (!this.photoMap) {
            this.photoMap = L.map('photoMap');
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(this.photoMap);
        }

        // Add markers with carousel sync
        photos.forEach(photo => {
            const marker = L.marker([photo.lat, photo.lng]);
            const date = new Date(photo.takenAt).toLocaleDateString();
            const escapedPlace = this.escapeHtml(photo.placeName);
            const escapedCaption = this.escapeHtml(photo.caption);

            const popupHtml = `<div class="photo-popup">
                <img src="${photo.displayUrl}" class="photo-popup-img" loading="lazy">
                <div class="photo-popup-info">
                    <div class="photo-popup-place">${escapedPlace}</div>
                    ${escapedCaption ? `<div class="photo-popup-caption">${escapedCaption}</div>` : ''}
                    <div class="photo-popup-date">${date}</div>
                </div>
            </div>`;

            marker.bindPopup(popupHtml, {
                autoPan: true,
                autoPanPaddingTopLeft: L.point(10, 20),
                autoPanPaddingBottomRight: L.point(10, 20),
                autoPanAnimation: true
            });
            marker.on('popupopen', () => {
                if (this.carousel) {
                    this.carousel.selectPhoto(photo.id);
                }
            });
            marker.addTo(this.photoMap);
            this.photoMapMarkers.push(marker);
            this.markerLookup.set(photo.id, marker);
        });

        // Fit bounds
        if (photos.length === 1) {
            this.photoMap.setView([photos[0].lat, photos[0].lng], 13);
        } else {
            const group = new L.featureGroup(this.photoMapMarkers);
            this.photoMap.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
            this.setupRouteToggle(photos);
        }

        // Recalculate map size
        setTimeout(() => this.photoMap.invalidateSize(), 100);
    },

    setupRouteToggle(photos) {
        const coords = photos.map(p => [p.lat, p.lng]);
        this.routeLayer = L.polyline(coords, { color: '#3388ff', weight: 3, opacity: 0.8 });

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
            this.photoMap.removeLayer(this.routeLayer);
            if (btn) btn.textContent = 'Show Route';
        } else {
            this.routeLayer.addTo(this.photoMap);
            if (btn) btn.textContent = 'Hide Route';
        }
        this.routeVisible = !this.routeVisible;
    },

    onCarouselSelect(photo) {
        const marker = this.markerLookup.get(photo.id);
        if (marker) {
            this.photoMap.flyTo([photo.lat, photo.lng], 15);
            marker.openPopup();
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
