import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('TripStorage', () => {
    let store;

    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => { store.set(k, String(v)); },
            removeItem: (k) => { store.delete(k); },
            clear: () => { store.clear(); },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getTrips', () => {
        it('returns empty array when localStorage is empty', () => {
            const trips = TripStorage.getTrips();
            expect(trips).toEqual([]);
        });

        it('returns single saved record with correct shape', () => {
            const entry = {
                name: 'Trip A',
                postUrl: '/post/abc',
                viewUrl: '/trips/aaa',
                savedAt: new Date().toISOString(),
            };
            store.set(TripStorage.STORAGE_KEY, JSON.stringify([entry]));

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(1);
            expect(trips[0]).toMatchObject({
                name: 'Trip A',
                postUrl: '/post/abc',
                viewUrl: '/trips/aaa',
            });
            expect(typeof trips[0].savedAt).toBe('string');
        });

        it('returns empty array when JSON is corrupt', () => {
            store.set(TripStorage.STORAGE_KEY, 'not json');
            const trips = TripStorage.getTrips();
            expect(trips).toEqual([]);
        });

        it('returns two records in insertion order (most-recent first)', () => {
            const entries = [
                {
                    name: 'Trip B',
                    postUrl: '/post/bbb',
                    viewUrl: '/trips/bbb',
                    savedAt: new Date(2).toISOString(),
                },
                {
                    name: 'Trip A',
                    postUrl: '/post/aaa',
                    viewUrl: '/trips/aaa',
                    savedAt: new Date(1).toISOString(),
                },
            ];
            store.set(TripStorage.STORAGE_KEY, JSON.stringify(entries));

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(2);
            expect(trips[0].name).toBe('Trip B');
            expect(trips[1].name).toBe('Trip A');
        });
    });

    describe('saveTrip', () => {
        it('persists a new trip to localStorage', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');

            const stored = JSON.parse(store.get(TripStorage.STORAGE_KEY));
            expect(stored).toHaveLength(1);
            expect(stored[0]).toMatchObject({
                name: 'Trip A',
                postUrl: '/post/abc',
                viewUrl: '/trips/aaa',
            });
        });

        it('stored shape matches {name, postUrl, viewUrl, savedAt}', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');

            const stored = JSON.parse(store.get(TripStorage.STORAGE_KEY))[0];
            expect(Object.keys(stored)).toEqual(['name', 'postUrl', 'viewUrl', 'savedAt']);
            expect(Date.parse(stored.savedAt)).toBeGreaterThan(0);
        });

        it('replaces record with same postUrl', () => {
            TripStorage.saveTrip('Trip A v1', '/post/abc', '/trips/aaa');
            TripStorage.saveTrip('Trip A v2', '/post/abc', '/trips/bbb');

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(1);
            expect(trips[0].name).toBe('Trip A v2');
            expect(trips[0].viewUrl).toBe('/trips/bbb');
        });

        it('prepends record with different postUrl (most-recent first)', () => {
            TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
            TripStorage.saveTrip('Trip B', '/post/bbb', '/trips/bbb');

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(2);
            expect(trips[0].postUrl).toBe('/post/bbb');
            expect(trips[1].postUrl).toBe('/post/aaa');
        });

        it('silent fail when localStorage.setItem throws', () => {
            // Override stub mid-test to throw
            vi.stubGlobal('localStorage', {
                getItem: (k) => (store.has(k) ? store.get(k) : null),
                setItem: () => { throw new Error('Storage full'); },
                removeItem: (k) => { store.delete(k); },
                clear: () => { store.clear(); },
            });

            // Should not throw
            expect(() => TripStorage.saveTrip('Trip', '/post/test', '/trips/test')).not.toThrow();
        });
    });

    describe('removeTrip', () => {
        it('removes record matching postUrl', () => {
            TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
            TripStorage.saveTrip('Trip B', '/post/bbb', '/trips/bbb');

            TripStorage.removeTrip('/post/aaa');

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(1);
            expect(trips[0].postUrl).toBe('/post/bbb');
        });

        it('other records survive removal', () => {
            TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
            TripStorage.saveTrip('Trip B', '/post/bbb', '/trips/bbb');
            TripStorage.saveTrip('Trip C', '/post/ccc', '/trips/ccc');

            TripStorage.removeTrip('/post/bbb');

            const trips = TripStorage.getTrips();
            expect(trips.map(t => t.name)).toEqual(['Trip C', 'Trip A']);
        });

        it('no-op when no record matches', () => {
            TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
            const before = JSON.stringify(TripStorage.getTrips());

            TripStorage.removeTrip('/post/never-saved');

            const after = JSON.stringify(TripStorage.getTrips());
            expect(after).toBe(before);
        });
    });

    describe('saveFromPostPage', () => {
        beforeEach(() => {
            // Setup API mock for all tests in this describe block
            globalThis.API = {
                getTripInfoBySecret: vi.fn(),
            };
        });

        it('first call invokes API and saves record', async () => {
            API.getTripInfoBySecret.mockResolvedValue({
                name: 'My Trip',
                viewUrl: '/trips/view-token-xyz',
            });

            await TripStorage.saveFromPostPage('secret-token-abc');

            expect(API.getTripInfoBySecret).toHaveBeenCalledTimes(1);
            expect(API.getTripInfoBySecret).toHaveBeenCalledWith('secret-token-abc');

            const trips = TripStorage.getTrips();
            expect(trips).toHaveLength(1);
            expect(trips[0]).toMatchObject({
                name: 'My Trip',
                postUrl: '/post/secret-token-abc',
                viewUrl: '/trips/view-token-xyz',
            });
        });

        it('second call with same secretToken does NOT invoke API (dedup)', async () => {
            API.getTripInfoBySecret.mockResolvedValue({
                name: 'My Trip',
                viewUrl: '/trips/view-token-xyz',
            });

            await TripStorage.saveFromPostPage('secret-token-abc');
            await TripStorage.saveFromPostPage('secret-token-abc');

            expect(API.getTripInfoBySecret).toHaveBeenCalledTimes(1);
        });

        it('different secretToken triggers new API call', async () => {
            API.getTripInfoBySecret
                .mockResolvedValueOnce({
                    name: 'Trip A',
                    viewUrl: '/trips/aaa',
                })
                .mockResolvedValueOnce({
                    name: 'Trip B',
                    viewUrl: '/trips/bbb',
                });

            await TripStorage.saveFromPostPage('secret-a');
            await TripStorage.saveFromPostPage('secret-b');

            expect(API.getTripInfoBySecret).toHaveBeenCalledTimes(2);
            expect(TripStorage.getTrips()).toHaveLength(2);
        });

        it('handles missing viewUrl gracefully', async () => {
            API.getTripInfoBySecret.mockResolvedValue({
                name: 'Trip No View',
                viewUrl: undefined,
            });

            await TripStorage.saveFromPostPage('secret-token');

            const trips = TripStorage.getTrips();
            expect(trips[0].viewUrl).toBe('');
        });

        it('silent fail when API throws', async () => {
            API.getTripInfoBySecret.mockRejectedValue(new Error('API error'));

            // Should not throw
            await expect(TripStorage.saveFromPostPage('secret-token')).resolves.toBeUndefined();

            // Record not saved
            expect(TripStorage.getTrips()).toHaveLength(0);
        });
    });

    describe('markOpened', () => {
        it('AC2.3: sets lastOpenedAt to Date.now() on the matching postUrl record', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const before = Date.now();
            const matched = TripStorage.markOpened('/post/abc');
            const after = Date.now();
            expect(matched).toBe(true);
            const trip = TripStorage.getTrips()[0];
            expect(trip.lastOpenedAt).toBeGreaterThanOrEqual(before);
            expect(trip.lastOpenedAt).toBeLessThanOrEqual(after);
        });

        it('matches by viewUrl as well as postUrl', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const matched = TripStorage.markOpened('/trips/aaa');
            expect(matched).toBe(true);
            expect(typeof TripStorage.getTrips()[0].lastOpenedAt).toBe('number');
        });

        it('returns false and does not modify storage when no record matches', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const before = JSON.stringify(TripStorage.getTrips());
            const matched = TripStorage.markOpened('/post/never-saved');
            expect(matched).toBe(false);
            expect(JSON.stringify(TripStorage.getTrips())).toBe(before);
        });

        it('only updates the matched record, not siblings', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            TripStorage.saveTrip('Trip B', '/post/def', '/trips/bbb');
            TripStorage.markOpened('/post/abc');
            const tripsByPost = Object.fromEntries(TripStorage.getTrips().map(t => [t.postUrl, t]));
            expect(typeof tripsByPost['/post/abc'].lastOpenedAt).toBe('number');
            expect(tripsByPost['/post/def'].lastOpenedAt).toBeUndefined();
        });

        it('AC2.6: existing fields preserved after markOpened', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const before = TripStorage.getTrips()[0];
            TripStorage.markOpened('/post/abc');
            const after = TripStorage.getTrips()[0];
            expect(after.name).toBe(before.name);
            expect(after.postUrl).toBe(before.postUrl);
            expect(after.viewUrl).toBe(before.viewUrl);
            expect(after.savedAt).toBe(before.savedAt);
        });
    });

    describe('getRoleForUrl', () => {
        it.each([
            ['/post/abc', 'owner'],
            ['/post/abc?query=x', 'owner'],
            ['https://app-roadtripmap-prod.azurewebsites.net/post/abc', 'owner'],
            ['/trips/xyz', 'viewer'],
            ['/trips/xyz?query=y', 'viewer'],
            ['https://app-roadtripmap-prod.azurewebsites.net/trips/xyz', 'viewer'],
            ['/', 'unknown'],
            ['/api/trips/view/xyz', 'unknown'],
            ['/post/', 'unknown'],
            ['/trips/', 'unknown'],
            ['not a url', 'unknown'],
            ['', 'unknown'],
            [null, 'unknown'],
            [undefined, 'unknown'],
        ])('classifies %s as %s', (input, expected) => {
            expect(TripStorage.getRoleForUrl(input)).toBe(expected);
        });
    });

    describe('getDefaultTrip', () => {
        it('returns null when no trips are saved', () => {
            expect(TripStorage.getDefaultTrip()).toBeNull();
        });

        it('AC2.5 success: returns the trip with greatest lastOpenedAt', () => {
            const nowSpy = vi.spyOn(Date, 'now');
            TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
            TripStorage.saveTrip('Trip B', '/post/bbb', '/trips/bbb');
            nowSpy.mockReturnValue(1000);
            TripStorage.markOpened('/post/aaa');
            nowSpy.mockReturnValue(2000);
            TripStorage.markOpened('/post/bbb');
            expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/bbb');
            nowSpy.mockRestore();
        });

        it('AC2.5 fallback: legacy entry without lastOpenedAt uses savedAt', () => {
            const legacy = [
                { name: 'Old', postUrl: '/post/old', viewUrl: '/trips/old', savedAt: '2026-01-01T00:00:00.000Z' },
                { name: 'New', postUrl: '/post/new', viewUrl: '/trips/new', savedAt: '2026-04-01T00:00:00.000Z' },
            ];
            localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(legacy));
            expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/new');
        });

        it('AC2.5 mixed: lastOpenedAt beats savedAt fallback', () => {
            const records = [
                { name: 'A', postUrl: '/post/a', viewUrl: '/trips/a', savedAt: '2026-04-01T00:00:00.000Z' },
                { name: 'B', postUrl: '/post/b', viewUrl: '/trips/b', savedAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: Date.now() },
            ];
            localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(records));
            expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/b');
        });

        it('returned record is enriched with role field', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            expect(TripStorage.getDefaultTrip().role).toBe('owner');
        });

        it('AC2.6: returned record preserves existing fields', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const defaultTrip = TripStorage.getDefaultTrip();
            expect(defaultTrip).toMatchObject({
                name: 'Trip A',
                postUrl: '/post/abc',
                viewUrl: '/trips/aaa',
            });
            expect(typeof defaultTrip.savedAt).toBe('string');
        });

        it('handles unparseable savedAt by treating as 0 (lowest priority)', () => {
            const records = [
                { name: 'A', postUrl: '/post/a', viewUrl: '/trips/a', savedAt: 'not-a-date' },
                { name: 'B', postUrl: '/post/b', viewUrl: '/trips/b', savedAt: '2026-01-01T00:00:00.000Z' },
            ];
            localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(records));
            expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/b');
        });

        it('returns a clone (mutating result does not affect storage)', () => {
            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
            const defaultTrip = TripStorage.getDefaultTrip();
            defaultTrip.name = 'Mutated';
            expect(TripStorage.getTrips()[0].name).toBe('Trip A');
        });
    });
});
