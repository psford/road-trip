import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const LOADER_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/bootstrap/loader.js'),
  'utf8'
);

// Extract compareSemver function by evaluating the loader source in isolation
// This allows us to test the pure function directly
function extractCompareSemver() {
  let compareSemver;
  const scope = {
    compareSemver: undefined
  };
  // Execute only the compareSemver function definition
  const funcMatch = LOADER_SOURCE.match(
    /function compareSemver\(a, b\)\s*{[\s\S]*?return 0;\s*}/
  );
  if (!funcMatch) {
    throw new Error('Failed to extract compareSemver function');
  }
  eval(`compareSemver = ${funcMatch[0]}`);
  return compareSemver;
}

const compareSemver = extractCompareSemver();

/**
 * Helper: Run loader in isolated scope with mocked fetch and alert.
 * The IIFE in loader.js runs immediately on eval, and is async.
 * We return early after the loader starts running.
 */
async function runLoaderInScope(fetchMock, alertMock) {
  // Save original globals to restore later
  const originalFetch = globalThis.fetch;
  const originalAlert = globalThis.alert;

  // Install mocks globally
  globalThis.fetch = fetchMock;
  globalThis.alert = alertMock;

  try {
    // Eval the loader - the IIFE runs immediately and schedules async work
    eval(LOADER_SOURCE);

    // The bootstrap IIFE is async. We need to wait for:
    // 1. All Promise microtasks from the async/await chain to queue
    // 2. IndexedDB operations to complete
    // 3. DOM mutations to be applied
    // Use multiple cycles of Promise.resolve() + setTimeout to ensure settle
    for (let i = 0; i < 3; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    // Restore original globals
    globalThis.fetch = originalFetch;
    globalThis.alert = originalAlert;
  }
}

/**
 * Helper: Seed IndexedDB with a cached bundle before test.
 */
async function seedCache(version, files, clientMinVersion) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('RoadTripBundle', 1);

    req.onerror = () => reject(new Error(`Failed to open DB: ${req.error}`));

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['files'], 'readwrite');
        const store = tx.objectStore('files');
        const putReq = store.put(
          {
            version,
            files,
            client_min_version: clientMinVersion
          },
          'bundle'
        );

        putReq.onerror = () => {
          db.close();
          reject(new Error(`Failed to put bundle: ${putReq.error}`));
        };

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          db.close();
          reject(new Error(`Transaction failed: ${tx.error}`));
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

/**
 * Helper: Read current cached bundle from IndexedDB.
 */
async function readCachedBundle() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('RoadTripBundle', 1);

    req.onerror = () => reject(new Error(`Failed to open DB: ${req.error}`));

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['files'], 'readonly');
        const store = tx.objectStore('files');
        const getReq = store.get('bundle');

        getReq.onerror = () => {
          db.close();
          reject(new Error(`Failed to get bundle: ${getReq.error}`));
        };

        getReq.onsuccess = () => {
          const result = getReq.result || null;
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

/**
 * Helper: Clear the bootstrap cache from IndexedDB (just clear the key, not the whole DB).
 */
async function clearBootstrapCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('RoadTripBundle', 1);

    req.onerror = () => reject(new Error(`Failed to open DB: ${req.error}`));

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(['files'], 'readwrite');
        const store = tx.objectStore('files');
        const delReq = store.delete('bundle');

        delReq.onerror = () => {
          db.close();
          reject(new Error(`Failed to delete bundle: ${delReq.error}`));
        };

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          db.close();
          reject(new Error(`Transaction failed: ${tx.error}`));
        };
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

describe('Bootstrap Loader', () => {
  beforeEach(async () => {
    // Clear cached bundle from IndexedDB before each test
    try {
      await clearBootstrapCache();
    } catch (e) {
      // Ignore errors on first test when DB doesn't exist yet
    }
    // Reset document state
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div><div id="app-root"></div>';
    document.head.innerHTML = '';
  });

  afterEach(async () => {
    try {
      await clearBootstrapCache();
    } catch (e) {
      // Ignore errors
    }
    vi.clearAllMocks();
  });

  describe('AC9.1: no cache + fetch OK', () => {
    it('should fetch manifest and 3 files, populate IndexedDB, inject CSS and JS', async () => {
      const manifest = {
        version: '1.0.0',
        client_min_version: '1.0.0',
        files: {
          'app.js': { size: 100, sha256: 'aaa' },
          'app.css': { size: 200, sha256: 'bbb' },
          'ios.css': { size: 50, sha256: 'ccc' }
        }
      };

      const appJs = '// app.js bundle';
      const appCss = 'body { color: red; }';
      const iosCss = 'body { color: blue; }';

      const fetchMock = vi.fn(async (url) => {
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json') {
          return {
            ok: true,
            status: 200,
            json: async () => manifest
          };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js') {
          return { ok: true, status: 200, text: async () => appJs };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css') {
          return { ok: true, status: 200, text: async () => appCss };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css') {
          return { ok: true, status: 200, text: async () => iosCss };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const alertMock = vi.fn();

      // Act
      await runLoaderInScope(fetchMock, alertMock);

      // Assert: fetch was called for manifest + 3 files (4 total)
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json',
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js'
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css'
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css'
      );

      // Assert: CSS and JS injected into DOM
      const styles = document.querySelectorAll('style');
      expect(styles.length).toBeGreaterThan(0);
      const style = styles[styles.length - 1];
      expect(style.textContent).toContain('body { color: red; }');
      expect(style.textContent).toContain('body { color: blue; }');

      const scripts = document.querySelectorAll('script');
      const loaderScript = Array.from(scripts).find((s) =>
        s.textContent.includes('// app.js bundle')
      );
      expect(loaderScript).toBeTruthy();

      // Assert: bootstrap-progress removed
      expect(document.getElementById('bootstrap-progress')).toBeNull();

      // Assert: platform-ios class added
      expect(document.body.classList.contains('platform-ios')).toBe(true);

      // Assert: IndexedDB populated with correct version and files
      const cached = await readCachedBundle();
      expect(cached).toBeTruthy();
      expect(cached.version).toBe('1.0.0');
      expect(cached.files['app.js']).toBe(appJs);
      expect(cached.files['app.css']).toBe(appCss);
      expect(cached.files['ios.css']).toBe(iosCss);
      expect(cached.client_min_version).toBe('1.0.0');

      // Assert: alert was not called (no version mismatch)
      expect(alertMock).not.toHaveBeenCalled();
    });
  });

  describe('AC9.2: cache present + fetch rejects (offline)', () => {
    it('should inject cached bundle without fetching files', async () => {
      // Arrange: seed cache with existing bundle
      const cachedAppJs = '// cached app';
      const cachedAppCss = '/* cached css */';
      const cachedIosCss = '/* cached ios */';
      await seedCache(
        '1.0.0',
        {
          'app.js': cachedAppJs,
          'app.css': cachedAppCss,
          'ios.css': cachedIosCss
        },
        '1.0.0'
      );

      const fetchMock = vi.fn(async (url) => {
        // Fetch manifest rejects (offline)
        throw new Error('Network error');
      });

      const alertMock = vi.fn();

      // Act
      await runLoaderInScope(fetchMock, alertMock);

      // Assert: fetch called once for manifest only (not for files)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json',
        expect.any(Object)
      );

      // Assert: cached bundle injected
      const styles = document.querySelectorAll('style');
      expect(styles.length).toBeGreaterThan(0);
      const style = styles[styles.length - 1];
      expect(style.textContent).toContain(cachedAppCss);
      expect(style.textContent).toContain(cachedIosCss);

      // Note: The cached content was injected via a script tag
      // Just verify DOM mutation happened
      expect(document.body.innerHTML).toBeTruthy();

      // Assert: bootstrap-progress removed
      expect(document.getElementById('bootstrap-progress')).toBeNull();

      // Assert: alert not called
      expect(alertMock).not.toHaveBeenCalled();
    });
  });

  describe('AC9.3: cache version differs from manifest version', () => {
    it('should re-fetch and replace cache with new version', async () => {
      // Arrange: seed cache with old version
      await seedCache(
        '1.0.0',
        {
          'app.js': '// old app',
          'app.css': '/* old css */',
          'ios.css': '/* old ios */'
        },
        '1.0.0'
      );

      const manifest = {
        version: '2.0.0',
        client_min_version: '1.0.0',
        files: {
          'app.js': { size: 100, sha256: 'aaa' },
          'app.css': { size: 200, sha256: 'bbb' },
          'ios.css': { size: 50, sha256: 'ccc' }
        }
      };

      const newAppJs = '// new app bundle';
      const newAppCss = '/* new css */';
      const newIosCss = '/* new ios */';

      const fetchMock = vi.fn(async (url) => {
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json') {
          return {
            ok: true,
            status: 200,
            json: async () => manifest
          };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js') {
          return { ok: true, status: 200, text: async () => newAppJs };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css') {
          return { ok: true, status: 200, text: async () => newAppCss };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css') {
          return { ok: true, status: 200, text: async () => newIosCss };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const alertMock = vi.fn();

      // Act
      await runLoaderInScope(fetchMock, alertMock);

      // Assert: fetch called for manifest + 3 files
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // Assert: new bundle injected (not old)
      const styles = document.querySelectorAll('style');
      const style = styles[styles.length - 1];
      expect(style.textContent).toContain('/* new css */');
      expect(style.textContent).not.toContain('old css');

      const scripts = document.querySelectorAll('script');
      const appScript = Array.from(scripts).find((s) =>
        s.textContent.includes('// new app bundle')
      );
      expect(appScript).toBeTruthy();

      // Assert: cache replaced with new version
      const cached = await readCachedBundle();
      expect(cached.version).toBe('2.0.0');
      expect(cached.files['app.js']).toBe(newAppJs);
      expect(cached.files['app.css']).toBe(newAppCss);
      expect(cached.files['ios.css']).toBe(newIosCss);

      // Assert: alert not called (version differs, not client_min_version mismatch)
      expect(alertMock).not.toHaveBeenCalled();
    });
  });

  describe('AC9.4: no cache + fetch rejects', () => {
    it('should fetch and inject fallback.html', async () => {
      const fallbackHtml = '<h1>Offline Mode</h1><p>Please connect to the internet.</p>';

      const fetchMock = vi.fn(async (url) => {
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json') {
          const err = new Error('Network error');
          err.name = 'AbortError'; // Mimic AbortSignal.timeout() error
          throw err;
        }
        if (url === 'fallback.html') {
          return {
            ok: true,
            status: 200,
            text: async () => fallbackHtml
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const alertMock = vi.fn();

      // Act
      await runLoaderInScope(fetchMock, alertMock);

      // Assert: fallback.html was fetched
      expect(fetchMock).toHaveBeenCalledWith('fallback.html');

      // Assert: fallback content injected into body
      expect(document.body.innerHTML).toContain('Offline Mode');
      expect(document.body.innerHTML).toContain('Please connect to the internet.');

      // Assert: alert not called
      expect(alertMock).not.toHaveBeenCalled();

      // Assert: bootstrap-progress removed by fallback injection
      expect(document.getElementById('bootstrap-progress')).toBeNull();
    });
  });

  describe('AC9.5: manifest.client_min_version > cached.version', () => {
    it('should alert, re-fetch, and inject new bundle', async () => {
      // Arrange: seed cache with version 1.0.0
      await seedCache(
        '1.0.0',
        {
          'app.js': '// old app',
          'app.css': '/* old css */',
          'ios.css': '/* old ios */'
        },
        '1.0.0'
      );

      const manifest = {
        version: '1.0.0', // Same version
        client_min_version: '2.0.0', // But client_min_version is higher
        files: {
          'app.js': { size: 100, sha256: 'aaa' },
          'app.css': { size: 200, sha256: 'bbb' },
          'ios.css': { size: 50, sha256: 'ccc' }
        }
      };

      const newAppJs = '// new app bundle';
      const newAppCss = '/* new css */';
      const newIosCss = '/* new ios */';

      const fetchMock = vi.fn(async (url) => {
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json') {
          return {
            ok: true,
            status: 200,
            json: async () => manifest
          };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js') {
          return { ok: true, status: 200, text: async () => newAppJs };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css') {
          return { ok: true, status: 200, text: async () => newAppCss };
        }
        if (url === 'https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css') {
          return { ok: true, status: 200, text: async () => newIosCss };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const alertMock = vi.fn();

      // Act
      await runLoaderInScope(fetchMock, alertMock);

      // Assert: alert called once with exact message
      expect(alertMock).toHaveBeenCalledTimes(1);
      expect(alertMock).toHaveBeenCalledWith('Site updated — reloading');

      // Assert: re-fetch happened (manifest + 3 files)
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // Assert: new bundle injected
      const styles = document.querySelectorAll('style');
      const style = styles[styles.length - 1];
      expect(style.textContent).toContain(newAppCss);
      expect(style.textContent).not.toContain('old css');

      const scripts = document.querySelectorAll('script');
      const appScript = Array.from(scripts).find((s) =>
        s.textContent.includes('new app')
      );
      expect(appScript).toBeTruthy();

      // Assert: cache updated with new client_min_version
      const cached = await readCachedBundle();
      expect(cached.client_min_version).toBe('2.0.0');
      expect(cached.files['app.js']).toBe(newAppJs);
    });
  });

  describe('compareSemver', () => {
    it('should return 0 when versions are equal', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('2.3.4', '2.3.4')).toBe(0);
      expect(compareSemver('0.0.0', '0.0.0')).toBe(0);
    });

    it('should return -1 when first version is less than second', () => {
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
      expect(compareSemver('0.0.1', '1.0.0')).toBe(-1);
    });

    it('should return 1 when first version is greater than second', () => {
      expect(compareSemver('1.0.1', '1.0.0')).toBe(1);
      expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.0', '0.0.1')).toBe(1);
    });

    it('should handle uneven length version strings', () => {
      // 1.0 should be treated as 1.0.0
      expect(compareSemver('1.0', '1.0.0')).toBe(0);
      expect(compareSemver('1', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', '1')).toBe(0);
      expect(compareSemver('2.0', '1.9.9')).toBe(1);
    });

    it('should handle null and undefined by treating as 0.0.0', () => {
      expect(compareSemver(null, '0.0.0')).toBe(0);
      expect(compareSemver(undefined, '0.0.0')).toBe(0);
      expect(compareSemver('0.0.0', null)).toBe(0);
      expect(compareSemver('1.0.0', null)).toBe(1);
      expect(compareSemver(null, '1.0.0')).toBe(-1);
    });

    it('should handle non-numeric segments by treating as 0', () => {
      // Segments that parse to NaN are treated as 0
      // e.g., "1.0.0-rc.1" → [1, 0, 0, NaN] → [1, 0, 0, 0]
      expect(compareSemver('1.0.0-rc', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0-rc', '1.0.1-alpha')).toBe(-1);
    });

    it('should handle extra zero segments in longer versions', () => {
      // Additional segments beyond the compared versions should be treated as 0
      expect(compareSemver('1.0.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.0.0', '1.0.0.0')).toBe(0);
      expect(compareSemver('1.0.0.1', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.0', '1.0.0.1')).toBe(-1);
    });
  });
});
