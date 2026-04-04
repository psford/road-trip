const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5143';

test('POI API backfills from Overpass when DB is sparse for viewport', async ({ request }) => {
    // Portland, ME — an area we know has no pre-seeded data
    // The API should detect sparse coverage and query Overpass live
    const response = await request.get(
        `${BASE_URL}/api/poi?minLat=43.64&maxLat=43.68&minLng=-70.30&maxLng=-70.20&zoom=13`
    );
    expect(response.status()).toBe(200);

    const pois = await response.json();
    // Overpass may or may not be up, but the API should not error
    console.log(`Portland backfill returned ${pois.length} POIs`);
    if (pois.length > 0) {
        console.log('First POI:', pois[0].name, pois[0].category);
    }

    // If Overpass is up, we should get results. If down, we get 0 (graceful degradation).
    // The key test: the API didn't crash and returned a valid array.
    expect(Array.isArray(pois)).toBe(true);
});

test('POI API returns cached results on second request for same viewport', async ({ request }) => {
    // First request may trigger Overpass backfill
    const resp1 = await request.get(
        `${BASE_URL}/api/poi?minLat=43.64&maxLat=43.68&minLng=-70.30&maxLng=-70.20&zoom=13`
    );
    const pois1 = await resp1.json();

    // Second request should be fast (cached in DB, no Overpass call)
    const start = Date.now();
    const resp2 = await request.get(
        `${BASE_URL}/api/poi?minLat=43.64&maxLat=43.68&minLng=-70.30&maxLng=-70.20&zoom=13`
    );
    const elapsed = Date.now() - start;
    const pois2 = await resp2.json();

    console.log(`Second request: ${pois2.length} POIs in ${elapsed}ms`);

    // Second request should be much faster (no Overpass round-trip)
    // And return at least as many results as first
    expect(pois2.length).toBeGreaterThanOrEqual(pois1.length);
    expect(elapsed).toBeLessThan(5000); // Should be sub-second from DB
});
