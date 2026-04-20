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
            const originalSetItem = store.set;
            let setItemThrew = false;

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
});
