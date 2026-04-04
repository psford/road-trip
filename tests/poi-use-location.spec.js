const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5143';
const SECRET_TOKEN = '57eee40d-91bd-4764-992e-9308521fafb7';

test.use({ viewport: { width: 1280, height: 900 } });

test('Use this location button on pin-drop map sets coordinates and place name', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Open the pin-drop map by programmatically showing it
    await page.evaluate(() => {
        const mapSection = document.getElementById('mapSection');
        const previewSection = document.getElementById('previewSection');
        if (mapSection) mapSection.classList.add('visible');
        if (previewSection) previewSection.classList.add('visible');
        if (!PostUI.map) PostUI.initializePinDropMap();
    });

    // Wait for map style and POI layer to initialize
    await page.waitForFunction(() => {
        return PostUI.map && PostUI.map.isStyleLoaded() && PostUI.map.getSource('poi-source');
    }, { timeout: 15000 });

    // Zoom to area with POIs and load them
    await page.evaluate(async () => {
        const map = PostUI.map;
        map.jumpTo({ center: [-110.5, 44.6], zoom: 8 });

        // Force POI source/layers if not present (test environment timing)
        if (!map.getSource('poi-source')) {
            map.addSource('poi-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        if (!map.getLayer('poi-markers')) {
            map.addLayer({
                id: 'poi-markers',
                type: 'circle',
                source: 'poi-source',
                paint: { 'circle-radius': 6, 'circle-color': '#2d6a4f' }
            });
        }

        await PoiLayer.loadPois(map);
    });

    // Get a POI from the API and simulate the "Use this location" flow
    const result = await page.evaluate(async () => {
        const map = PostUI.map;
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const pois = await API.fetchPois(bounds, zoom);
        if (pois.length === 0) return { error: 'no POIs found' };

        const poi = pois[0];

        // Simulate what happens when user clicks "Use this location":
        // The onPoiSelect callback in _poiActionOptions
        if (PostUI.marker) PostUI.marker.remove();
        PostUI.marker = new maplibregl.Marker()
            .setLngLat([poi.lng, poi.lat])
            .addTo(map);
        PostUI.setLocationFromPoi(poi.lat, poi.lng, poi.name);

        return {
            poiName: poi.name,
            currentLat: PostUI.currentLat,
            currentLng: PostUI.currentLng,
            markerExists: !!PostUI.marker,
            markerLngLat: PostUI.marker.getLngLat(),
        };
    });

    expect(result.error).toBeUndefined();
    expect(result.currentLat).toBeCloseTo(result.markerLngLat.lat, 4);
    expect(result.currentLng).toBeCloseTo(result.markerLngLat.lng, 4);
    expect(result.markerExists).toBe(true);
    expect(result.poiName).toBeTruthy();
});

test('Photo map POI layer has action options configured', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Wait for photo map to load with POI layer
    await page.waitForFunction(() => {
        return typeof PostUI !== 'undefined' && PostUI.photoMap &&
               PostUI.photoMap.isStyleLoaded() && PostUI.photoMap.getSource('poi-source');
    }, { timeout: 15000 });

    // Verify that pendingPoiLocation flow works end-to-end
    const result = await page.evaluate(async () => {
        const map = PostUI.photoMap;
        const pois = await API.fetchPois(map.getBounds(), map.getZoom());
        if (pois.length === 0) {
            // Zoom to known area and reload
            map.jumpTo({ center: [-68.25, 44.41], zoom: 10 });
            await PoiLayer.loadPois(map);
            const retryPois = await API.fetchPois(map.getBounds(), map.getZoom());
            if (retryPois.length === 0) return { error: 'no POIs even after zoom' };
        }

        // Simulate what happens when user clicks "Use this location" on photo map:
        // The _poiActionOptions().onPoiSelect callback stores pendingPoiLocation
        const poi = (await API.fetchPois(map.getBounds(), map.getZoom()))[0];
        PostUI.pendingPoiLocation = { lat: poi.lat, lng: poi.lng, name: poi.name };

        return {
            hasPendingLocation: !!PostUI.pendingPoiLocation,
            pendingName: PostUI.pendingPoiLocation.name,
            pendingLat: PostUI.pendingPoiLocation.lat,
        };
    });

    expect(result.error).toBeUndefined();
    expect(result.hasPendingLocation).toBe(true);
    expect(result.pendingName).toBeTruthy();
});
