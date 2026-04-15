/**
 * Vitest setup — loads wwwroot/js global-namespace modules into jsdom scope.
 * These files use `const Foo = {...}` pattern, not ES modules.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const wwwroot = resolve(process.cwd(), 'src/RoadTripMap/wwwroot/js');

function loadGlobal(filename) {
    const code = readFileSync(resolve(wwwroot, filename), 'utf-8');
    // Execute in global scope so declarations become global
    // Convert const X = {...} to globalThis.X = {...}
    let modifiedCode = code.replace(/^const (\w+) = /gm, 'globalThis.$1 = ');
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

    // Load modules
    loadGlobal('api.js');
    loadGlobal('mapCache.js');
    loadGlobal('uploadUtils.js');
    loadGlobal('uploadSemaphore.js');
    loadGlobal('storageAdapter.js');
    loadGlobal('uploadTransport.js');
    loadGlobal('versionProtocol.js');
    loadGlobal('uploadQueue.js');
    loadGlobal('postUI.js');
});

afterEach(() => {
    vi.clearAllMocks();
});
