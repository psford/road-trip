/**
 * Vitest setup — loads wwwroot/js global-namespace modules into jsdom scope.
 * These files use `const Foo = {...}` pattern, not ES modules.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { vi } from 'vitest';

const wwwroot = resolve(process.cwd(), 'src/RoadTripMap/wwwroot/js');

// Store for mocked CDN imports (will be populated by tests)
globalThis._testCdnMocks = {};

function loadGlobal(filename) {
    const code = readFileSync(resolve(wwwroot, filename), 'utf-8');
    // Execute in global scope so declarations become global
    // Convert const X = {...} to globalThis.X = {...}
    let modifiedCode = code.replace(/^const (\w+) = /gm, 'globalThis.$1 = ');

    // For imageProcessor.js, patch the import calls to use a mock resolver
    if (filename === 'imageProcessor.js') {
        // Replace dynamic import calls with a function that checks mocks first
        modifiedCode = modifiedCode.replace(
            /import\((.*?)\)/g,
            'globalThis._mockableImport($1)'
        );

        // Inject test-only methods into the return statement
        modifiedCode = modifiedCode.replace(
            'return { processForUpload };',
            `return {
        processForUpload,
        _resetProcessingFlag() {
            _processingEnabled = null;
        },
        _resetLazyLoaders() {
            _browserImageCompressionPromise = null;
            _piexifjsPromise = null;
            _heic2anyPromise = null;
        }
    };`
        );
    }

    // Execute in eval to ensure true global scope
    eval(modifiedCode);
}

beforeAll(() => {
    // Stub fetch
    globalThis.fetch = vi.fn();

    // Stub MapLibre
    globalThis.maplibregl = {
        Popup: class {
            setLngLat() { return this; }
            setHTML() { return this; }
            addTo() { return this; }
            remove() {}
        }
    };

    // Stub performance.now
    if (!globalThis.performance) {
        globalThis.performance = { now: () => Date.now() };
    }

    // Setup mockable import function for testing
    globalThis._mockableImport = async (specifier) => {
        if (globalThis._testCdnMocks && globalThis._testCdnMocks[specifier]) {
            return globalThis._testCdnMocks[specifier];
        }
        // Fall through to actual import
        return import(specifier);
    };

    // Load modules
    loadGlobal('featureFlags.js');
    loadGlobal('api.js');
    loadGlobal('mapCache.js');
    loadGlobal('uploadUtils.js');
    loadGlobal('uploadSemaphore.js');
    loadGlobal('storageAdapter.js');
    loadGlobal('tripStorage.js');
    loadGlobal('uploadTelemetry.js');
    loadGlobal('uploadTransport.js');
    loadGlobal('versionProtocol.js');
    loadGlobal('imageProcessor.js');
    loadGlobal('uploadQueue.js');
    loadGlobal('progressPanel.js');
    loadGlobal('resumeBanner.js');
    loadGlobal('postUI.js');
});

/**
 * Test helper to wait for all UploadQueue processing to complete
 */
globalThis.UploadQueueTestHelper = {
    waitForAll: async () => {
        const promises = Array.from(globalThis.UploadQueue._processingPromises.values());
        return Promise.all(promises);
    }
};

afterEach(() => {
    vi.clearAllMocks();
    // Clear DOM modifications made during test
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});
