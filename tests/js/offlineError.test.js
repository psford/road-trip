import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/offlineError.js'),
    'utf8'
);

describe('OfflineError', () => {
    beforeEach(() => {
        delete globalThis.OfflineError;
        eval(SOURCE);
        // Reset navigator.onLine to true for each test
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            get: () => true,
        });
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            get: () => true,
        });
    });

    describe('AC4.1 — isOfflineError(err) returns true for TypeError', () => {
        test('returns true for TypeError with generic message', () => {
            const err = new TypeError('Load failed');
            expect(globalThis.OfflineError.isOfflineError(err)).toBe(true);
        });

        test('returns true for TypeError with network-like message', () => {
            const err = new TypeError('NetworkError when attempting to fetch resource');
            expect(globalThis.OfflineError.isOfflineError(err)).toBe(true);
        });
    });

    describe('AC4.2 — isOfflineError(err) returns true when navigator.onLine === false', () => {
        beforeEach(() => {
            Object.defineProperty(navigator, 'onLine', {
                configurable: true,
                get: () => false,
            });
        });

        test('returns true for undefined', () => {
            expect(globalThis.OfflineError.isOfflineError(undefined)).toBe(true);
        });

        test('returns true for null', () => {
            expect(globalThis.OfflineError.isOfflineError(null)).toBe(true);
        });

        test('returns true for Error with any message', () => {
            expect(globalThis.OfflineError.isOfflineError(new Error('any message'))).toBe(true);
        });

        test('returns true for string', () => {
            expect(globalThis.OfflineError.isOfflineError('string')).toBe(true);
        });

        test('returns true for plain object', () => {
            expect(globalThis.OfflineError.isOfflineError({})).toBe(true);
        });
    });

    describe('AC4.4 — Non-offline errors do NOT classify as offline', () => {
        test('returns false for Error with validation message', () => {
            expect(globalThis.OfflineError.isOfflineError(new Error('Trip name required'))).toBe(false);
        });

        test('returns false for object with status and message', () => {
            expect(globalThis.OfflineError.isOfflineError({ status: 400, message: 'Bad Request' })).toBe(false);
        });

        test('returns false for object with ValidationError name', () => {
            expect(globalThis.OfflineError.isOfflineError({ name: 'ValidationError' })).toBe(false);
        });
    });

    describe('friendlyMessage — context-specific copy when offline', () => {
        beforeEach(() => {
            Object.defineProperty(navigator, 'onLine', {
                configurable: true,
                get: () => false,
            });
        });

        test('returns create context copy for create context', () => {
            const err = new TypeError('x');
            expect(globalThis.OfflineError.friendlyMessage(err, 'create')).toBe(
                "Can't create a trip while offline. Try again when you're back online."
            );
        });

        test('returns photos context copy for photos context', () => {
            const err = new TypeError('x');
            expect(globalThis.OfflineError.friendlyMessage(err, 'photos')).toBe(
                'Photos unavailable offline. Reconnect to see the latest.'
            );
        });

        test('returns generic context copy for generic context', () => {
            const err = new TypeError('x');
            expect(globalThis.OfflineError.friendlyMessage(err, 'generic')).toBe(
                "You're offline. Reconnect and try again."
            );
        });

        test('falls back to generic for unknown context', () => {
            const err = new TypeError('x');
            expect(globalThis.OfflineError.friendlyMessage(err, 'unknown')).toBe(
                "You're offline. Reconnect and try again."
            );
        });

        test('falls back to generic when context is undefined', () => {
            const err = new TypeError('x');
            expect(globalThis.OfflineError.friendlyMessage(err)).toBe(
                "You're offline. Reconnect and try again."
            );
        });
    });

    describe('friendlyMessage — non-offline preserves err.message', () => {
        test('returns Error.message for online non-offline error', () => {
            const err = new Error('Trip name required');
            expect(globalThis.OfflineError.friendlyMessage(err, 'create')).toBe('Trip name required');
        });

        test('returns object.message for plain object', () => {
            const err = { message: 'Bad Request' };
            expect(globalThis.OfflineError.friendlyMessage(err, 'create')).toBe('Bad Request');
        });

        test('returns fallback for null error', () => {
            expect(globalThis.OfflineError.friendlyMessage(null, 'create')).toBe('Something went wrong.');
        });
    });

    describe('Idempotent re-install', () => {
        test('re-eval does not crash and preserves behavior', () => {
            // First usage
            const err1 = new TypeError('test');
            expect(globalThis.OfflineError.isOfflineError(err1)).toBe(true);

            // Re-eval (without deleting globalThis.OfflineError to simulate swap re-injection)
            eval(SOURCE);

            // Verify still works after re-eval
            const err2 = new TypeError('another');
            expect(globalThis.OfflineError.isOfflineError(err2)).toBe(true);
        });
    });
});
