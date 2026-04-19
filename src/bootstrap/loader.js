// pattern: Imperative Shell
// Bootstrap loader: fetches, caches, and injects the iOS hybrid bundle from Azure.
// Implements AC9 (offline-first bundle loading) and AC10.1 (platform-ios class before paint).

const BUNDLE_URL = 'https://app-roadtripmap-prod.azurewebsites.net/bundle';
const DB_NAME = 'RoadTripBundle';
const STORE_NAME = 'files';

// === Pure Helpers (Functional Core) ===

/**
 * Compare two semver strings (X.Y.Z format).
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 * Pure function: same input always produces same output.
 */
function compareSemver(a, b) {
  const aParts = (a || '0.0.0').split('.').map(x => parseInt(x, 10) || 0);
  const bParts = (b || '0.0.0').split('.').map(x => parseInt(x, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aN = aParts[i] || 0;
    const bN = bParts[i] || 0;
    if (aN < bN) return -1;
    if (aN > bN) return 1;
  }
  return 0;
}

/**
 * Fetch with absolute timeout using AbortSignal.timeout().
 * Throws on timeout or non-200 responses.
 */
async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch all bundle files (app.js, app.css, ios.css).
 * Manifest.files is { "app.js": {...}, "app.css": {...}, "ios.css": {...} }.
 * Returns { "app.js": "...", "app.css": "...", "ios.css": "..." }.
 */
async function fetchAll(baseUrl, manifest) {
  const files = {};
  const fileList = ['app.js', 'app.css', 'ios.css'];

  const promises = fileList.map(async (filename) => {
    const url = `${baseUrl}/${filename}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filename}: ${response.status}`);
    }
    const text = await response.text();
    files[filename] = text;
  });

  await Promise.all(promises);
  return files;
}

/**
 * Open IndexedDB connection and return the store.
 * Creates DB and store if they don't exist.
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Read cached bundle from IndexedDB.
 * Returns { version, files, client_min_version } or null if not found.
 */
async function readCache() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('bundle');

      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  } catch (e) {
    console.error('readCache failed', e);
    return null;
  }
}

/**
 * Write bundle to IndexedDB cache.
 * Rejects on any error (quota exceeded, transaction failure, etc.).
 * Caller must handle rejection to decide whether to proceed or halt.
 */
async function writeCache(obj) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(obj, 'bundle');

    req.onerror = () => reject(new Error(`failed to write cache: ${req.error}`));
    req.onsuccess = () => resolve();

    tx.onerror = () => reject(new Error(`cache transaction failed: ${tx.error}`));
  });
}

/**
 * Inject CSS and JS into the page.
 * Appends <style> to <head> with app.css + ios.css.
 * Appends <script> to <body> with app.js.
 * Removes the bootstrap-progress indicator.
 */
function inject(bundle) {
  // Create and inject CSS
  const style = document.createElement('style');
  style.textContent = bundle.files['app.css'] + '\n' + bundle.files['ios.css'];
  document.head.appendChild(style);

  // Create and inject JS
  const script = document.createElement('script');
  script.textContent = bundle.files['app.js'];
  document.body.appendChild(script);

  // Remove progress indicator
  const progress = document.getElementById('bootstrap-progress');
  if (progress) {
    progress.remove();
  }
}

/**
 * Fetch and render fallback.html.
 */
async function renderFallback() {
  try {
    const response = await fetch('fallback.html');
    if (!response.ok) {
      throw new Error(`Failed to fetch fallback: ${response.status}`);
    }
    const html = await response.text();
    document.body.innerHTML = html;
  } catch (e) {
    console.error('renderFallback failed', e);
    document.body.innerHTML = '<div style="padding:2rem;text-align:center;font-family:system-ui"><h1>Error</h1><p>Unable to load.</p></div>';
  }
}

// === Imperative Shell: Bootstrap IIFE ===

(async function bootstrap() {
  // AC10.1: Set platform-ios class BEFORE paint (synchronously, before first await)
  document.body.classList.add('platform-ios');

  try {
    // Try to read cached bundle
    const cached = await readCache();

    // Try to fetch fresh manifest
    let manifest;
    try {
      manifest = await fetchJson(BUNDLE_URL + '/manifest.json', 8000);
    } catch (e) {
      // Fetch failed (offline or network error)
      if (cached) {
        // AC9.2: Offline + cached → inject cached bundle
        return inject(cached);
      }
      // AC9.4: Offline + no cache → render fallback
      return renderFallback();
    }

    // Fetch succeeded; check version
    if (!cached || cached.version !== manifest.version) {
      // AC9.1: No cache, fresh fetch
      // AC9.3: Cache exists but version differs → re-fetch
      const files = await fetchAll(BUNDLE_URL, manifest);
      const bundle = {
        version: manifest.version,
        files,
        client_min_version: manifest.client_min_version
      };
      try {
        await writeCache(bundle);
      } catch (e) {
        console.error('failed to cache bundle (IDB error); proceeding with injection:', e);
      }
      return inject(bundle);
    }

    // Cache exists and version matches fresh manifest.
    // AC9.5 edge case: check if manifest's client_min_version invalidates cached version.
    if (manifest.client_min_version &&
        cached.client_min_version &&
        compareSemver(cached.version, manifest.client_min_version) < 0) {
      // Cached bundle is too old for the current server.
      alert('Site updated — reloading');
      const files = await fetchAll(BUNDLE_URL, manifest);
      const bundle = {
        version: manifest.version,
        files,
        client_min_version: manifest.client_min_version
      };
      try {
        await writeCache(bundle);
      } catch (e) {
        console.error('failed to cache updated bundle (IDB error); proceeding with injection:', e);
      }
      return inject(bundle);
    }

    // Cache is fresh and compatible; inject it.
    inject(cached);
  } catch (err) {
    // Unexpected error during bootstrap (JSON.parse, IndexedDB, etc.)
    console.error('Bootstrap failure', err);
    renderFallback();
  }
})();
