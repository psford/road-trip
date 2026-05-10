import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/nativeBridge.js'), 'utf8');

/**
 * Flush all pending promises and microtasks.
 */
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => queueMicrotask(r));
}

beforeEach(() => {
    // Reset globalThis.Native completely
    delete globalThis.Native;
    // Ensure RoadTrip exists for isNativePlatform checks
    globalThis.RoadTrip = globalThis.RoadTrip || {};
    // Eval the source to install the module fresh
    eval(SOURCE);
    // Verify module is installed correctly
    expect(globalThis.Native).toBeDefined();
    expect(globalThis.Native._installed).toBe(true);
});

afterEach(() => {
    delete globalThis.Native;
    vi.clearAllMocks();
});

describe('Native module exports', () => {
    it('exposes globalThis.Native with the documented method surface', () => {
        expect(typeof globalThis.Native.haptic).toBe('function');
        expect(typeof globalThis.Native.share).toBe('function');
        expect(typeof globalThis.Native.dialogConfirm).toBe('function');
        expect(typeof globalThis.Native.dialogAlert).toBe('function');
        expect(typeof globalThis.Native.statusBar).toBe('function');
        expect(typeof globalThis.Native.install).toBe('function');
        expect(typeof globalThis.Native._installed).toBe('boolean');
        expect(typeof globalThis.Native._isNative).toBe('boolean');
    });
});

describe('Native.install idempotency', () => {
    it('re-evaluating the module does not re-run install side effects', async () => {
        // First install already happened in beforeEach
        expect(globalThis.Native._installed).toBe(true);

        // Capture initial state: method reference before re-eval
        const hapticBefore = globalThis.Native.haptic;

        // Re-eval the source (simulating a script re-execution in a swap)
        eval(SOURCE);

        // Verify idempotency: methods should be identical (IIFE early-returned)
        expect(globalThis.Native.haptic).toBe(hapticBefore);
        // _installed should still be true
        expect(globalThis.Native._installed).toBe(true);
    });
});

describe('Web fallbacks (RoadTrip.isNativePlatform === false)', () => {
    beforeEach(() => {
        // Stub isNativePlatform to return false
        globalThis.RoadTrip = globalThis.RoadTrip || {};
        globalThis.RoadTrip.isNativePlatform = vi.fn().mockReturnValue(false);
        // Re-eval with the stub in place
        delete globalThis.Native;
        eval(SOURCE);
    });

    it('Native.haptic is a no-op and resolves', async () => {
        const labels = ['light', 'medium', 'heavy', 'success', 'warning', 'error'];
        for (const label of labels) {
            const result = await globalThis.Native.haptic(label);
            expect(result).toBeUndefined();
        }
    });

    it('Native.haptic with unknown label resolves silently', async () => {
        const result = await globalThis.Native.haptic('bogus');
        expect(result).toBeUndefined();
    });

    it('Native.share with navigator.share available calls navigator.share', async () => {
        const mockShare = vi.fn().mockResolvedValue(undefined);
        globalThis.navigator.share = mockShare;

        const payload = { title: 'Test', url: 'https://example.com' };
        await globalThis.Native.share(payload);

        expect(mockShare).toHaveBeenCalledWith(payload);
    });

    it('Native.share without navigator.share falls through to clipboard', async () => {
        delete globalThis.navigator.share;
        const mockWriteText = vi.fn().mockResolvedValue(undefined);
        globalThis.navigator.clipboard = { writeText: mockWriteText };

        const payload = { title: 't', url: 'https://example.com' };
        await globalThis.Native.share(payload);

        expect(mockWriteText).toHaveBeenCalledWith('https://example.com');
    });

    it('Native.share when navigator.share rejects with AbortError resolves silently', async () => {
        const mockShare = vi.fn().mockRejectedValue(new DOMException('User cancelled', 'AbortError'));
        globalThis.navigator.share = mockShare;

        const payload = { title: 'Test', url: 'https://example.com' };
        const result = await globalThis.Native.share(payload);

        expect(result).toBeUndefined();
    });

    it('Native.dialogConfirm falls through to window.confirm and returns { value: boolean }', async () => {
        globalThis.window.confirm = vi.fn().mockReturnValue(true);

        const result = await globalThis.Native.dialogConfirm({ title: 'Test?', message: 'Are you sure?' });

        expect(result).toEqual({ value: true });
        expect(globalThis.window.confirm).toHaveBeenCalledWith('Are you sure?');
    });

    it('Native.dialogConfirm with false result', async () => {
        globalThis.window.confirm = vi.fn().mockReturnValue(false);

        const result = await globalThis.Native.dialogConfirm({ title: 'Test?', message: 'Are you sure?' });

        expect(result).toEqual({ value: false });
    });

    it('Native.dialogAlert falls through to window.alert and resolves void', async () => {
        globalThis.window.alert = vi.fn();

        const result = await globalThis.Native.dialogAlert({ title: 'Info', message: 'All done' });

        expect(globalThis.window.alert).toHaveBeenCalledWith('All done');
        expect(result).toBeUndefined();
    });

    it('Native.statusBar is a no-op on web', async () => {
        const result1 = await globalThis.Native.statusBar('light');
        const result2 = await globalThis.Native.statusBar('dark');

        expect(result1).toBeUndefined();
        expect(result2).toBeUndefined();
    });
});

describe('Native bridge — iOS path (RoadTrip.isNativePlatform === true)', () => {
    beforeEach(() => {
        // Stub isNativePlatform to return true
        globalThis.RoadTrip = globalThis.RoadTrip || {};
        globalThis.RoadTrip.isNativePlatform = vi.fn().mockReturnValue(true);
        // Re-eval with the stub in place
        delete globalThis.Native;
        eval(SOURCE);
    });

    it('Native.haptic("light") calls Haptics.impact with ImpactStyle.Light', async () => {
        const mockImpact = vi.fn().mockResolvedValue(undefined);
        const mockNotification = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { impact: mockImpact, notification: mockNotification },
            ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
            NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' }
        });

        await globalThis.Native.haptic('light');

        expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
    });

    it('Native.haptic("medium") calls Haptics.impact with ImpactStyle.Medium', async () => {
        const mockImpact = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { impact: mockImpact },
            ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
            NotificationType: {}
        });

        await globalThis.Native.haptic('medium');

        expect(mockImpact).toHaveBeenCalledWith({ style: 'MEDIUM' });
    });

    it('Native.haptic("heavy") calls Haptics.impact with ImpactStyle.Heavy', async () => {
        const mockImpact = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { impact: mockImpact },
            ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
            NotificationType: {}
        });

        await globalThis.Native.haptic('heavy');

        expect(mockImpact).toHaveBeenCalledWith({ style: 'HEAVY' });
    });

    it('Native.haptic("success") calls Haptics.notification with NotificationType.Success', async () => {
        const mockNotification = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { notification: mockNotification },
            ImpactStyle: {},
            NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' }
        });

        await globalThis.Native.haptic('success');

        expect(mockNotification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    });

    it('Native.haptic("warning") calls Haptics.notification with NotificationType.Warning', async () => {
        const mockNotification = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { notification: mockNotification },
            ImpactStyle: {},
            NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' }
        });

        await globalThis.Native.haptic('warning');

        expect(mockNotification).toHaveBeenCalledWith({ type: 'WARNING' });
    });

    it('Native.haptic("error") calls Haptics.notification with NotificationType.Error', async () => {
        const mockNotification = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Haptics: { notification: mockNotification },
            ImpactStyle: {},
            NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' }
        });

        await globalThis.Native.haptic('error');

        expect(mockNotification).toHaveBeenCalledWith({ type: 'ERROR' });
    });

    it('Native.share calls Share.share', async () => {
        const mockShareApi = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Share: { share: mockShareApi }
        });

        const payload = { title: 'Test', url: 'https://example.com' };
        await globalThis.Native.share(payload);

        expect(mockShareApi).toHaveBeenCalledWith(payload);
    });

    it('Native.dialogConfirm calls Dialog.confirm and returns { value: boolean }', async () => {
        const mockConfirm = vi.fn().mockResolvedValue({ value: true });

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            Dialog: { confirm: mockConfirm }
        });

        const payload = { title: 'Test?', message: 'Are you sure?' };
        const result = await globalThis.Native.dialogConfirm(payload);

        expect(mockConfirm).toHaveBeenCalledWith(payload);
        expect(result).toEqual({ value: true });
    });

    it('Native.statusBar("dark") calls StatusBar.setStyle with Style.Light', async () => {
        const mockSetStyle = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            StatusBar: { setStyle: mockSetStyle },
            Style: { Light: 'LIGHT', Dark: 'DARK' }
        });

        await globalThis.Native.statusBar('dark');

        expect(mockSetStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
    });

    it('Native.statusBar("light") calls StatusBar.setStyle with Style.Dark', async () => {
        const mockSetStyle = vi.fn().mockResolvedValue(undefined);

        globalThis.Native._internals.import = vi.fn().mockResolvedValue({
            StatusBar: { setStyle: mockSetStyle },
            Style: { Light: 'LIGHT', Dark: 'DARK' }
        });

        await globalThis.Native.statusBar('light');

        expect(mockSetStyle).toHaveBeenCalledWith({ style: 'DARK' });
    });
});

describe('Plugin import failure resilience', () => {
    beforeEach(() => {
        globalThis.RoadTrip = globalThis.RoadTrip || {};
        globalThis.RoadTrip.isNativePlatform = vi.fn().mockReturnValue(true);
        delete globalThis.Native;
        eval(SOURCE);
    });

    it('Native.haptic resolves silently if dynamic import rejects', async () => {
        globalThis.Native._internals.import = vi.fn().mockRejectedValue(new Error('Module not found'));

        const result = await globalThis.Native.haptic('light');

        expect(result).toBeUndefined();
    });

    it('Native.share falls back to web path if dynamic import rejects', async () => {
        globalThis.Native._internals.import = vi.fn().mockRejectedValue(new Error('Module not found'));
        const mockShare = vi.fn().mockResolvedValue(undefined);
        globalThis.navigator.share = mockShare;

        const payload = { title: 'Test', url: 'https://example.com' };
        await globalThis.Native.share(payload);

        expect(mockShare).toHaveBeenCalledWith(payload);
    });

    it('Native.dialogConfirm falls back to web path if dynamic import rejects', async () => {
        globalThis.Native._internals.import = vi.fn().mockRejectedValue(new Error('Module not found'));
        globalThis.window.confirm = vi.fn().mockReturnValue(true);

        const result = await globalThis.Native.dialogConfirm({ title: 'Test?', message: 'Are you sure?' });

        expect(result).toEqual({ value: true });
    });
});
