import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SHELL = path.join(REPO_ROOT, 'src/bootstrap');

const SOURCES = {
  cachedFetch: fs.readFileSync(path.join(SHELL, 'cachedFetch.js'), 'utf8'),
  assetCache: fs.readFileSync(path.join(SHELL, 'assetCache.js'), 'utf8'),
  listenerShim: fs.readFileSync(path.join(SHELL, 'listenerShim.js'), 'utf8'),
  tripStorage: fs.readFileSync(path.join(SHELL, 'tripStorage.js'), 'utf8'),
  fetchAndSwap: fs.readFileSync(path.join(SHELL, 'fetchAndSwap.js'), 'utf8'),
};

let _appendSpy;

beforeEach(async () => {
  // Close any cached IDB handles from a previous test before deleting the database.
  if (typeof globalThis.CachedFetch !== 'undefined' && globalThis.CachedFetch._internals) {
    globalThis.CachedFetch._internals._closeDb();
  }
  if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals) {
    globalThis.AssetCache._internals._closeDb();
  }

  delete globalThis.CachedFetch;
  delete globalThis.AssetCache;
  delete globalThis.ListenerShim;
  delete globalThis.TripStorage;
  delete globalThis.FetchAndSwap;

  // Reset DOM.
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  Array.from(document.body.attributes).forEach((a) => document.body.removeAttribute(a.name));

  // Delete IDB so each test starts cold.
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('RoadTripPageCache');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  await new Promise((r) => setTimeout(r, 10));

  // Map-backed localStorage so TripStorage round-trips actually persist.
  const lsStore = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => { lsStore.set(k, String(v)); },
    removeItem: (k) => { lsStore.delete(k); },
    clear: () => { lsStore.clear(); },
  });

  // Script appendChild stub: JSDOM does not load remote <script src>; fire onload
  // synchronously so _recreateScripts' awaited Promise resolves.
  const realAppendChild = Node.prototype.appendChild;
  _appendSpy = vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
    const result = realAppendChild.call(this, node);
    if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
      setTimeout(() => { if (node.onload) node.onload(); }, 0);
    }
    return result;
  });

  // Spy on dispatchEvent to silence postUI.js DOMContentLoaded handlers from setup.js.
  vi.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
  vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);

  // Eval modules in production load order (matches src/bootstrap/index.html).
  eval(SOURCES.cachedFetch);
  eval(SOURCES.assetCache);
  eval(SOURCES.listenerShim);
  const tripStorageCode = SOURCES.tripStorage.replace(/^const TripStorage = /m, 'globalThis.TripStorage = ');
  eval(tripStorageCode);
  eval(SOURCES.fetchAndSwap);
});

afterEach(() => {
  if (_appendSpy) {
    _appendSpy.mockRestore();
    _appendSpy = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (typeof globalThis.CachedFetch !== 'undefined' && globalThis.CachedFetch._internals) {
    globalThis.CachedFetch._internals._closeDb();
  }
  if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals) {
    globalThis.AssetCache._internals._closeDb();
  }
  delete globalThis.ListenerShim;
});

describe('AC1.1: checked-in asset-manifest.json is well-formed', () => {
  const MANIFEST_PATH = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/asset-manifest.json');

  it('exists and parses as JSON', () => {
    expect(fs.existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    expect(typeof manifest.version).toBe('string');
    expect(Array.isArray(manifest.files)).toBe(true);
  });

  it('every entry has a non-empty url, positive size, and 64-char hex sha256', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const entry of manifest.files) {
      expect(typeof entry.url).toBe('string');
      expect(entry.url.startsWith('/')).toBe(true);
      expect(typeof entry.size).toBe('number');
      expect(entry.size).toBeGreaterThan(0);
      expect(typeof entry.sha256).toBe('string');
      expect(/^[0-9a-f]{64}$/.test(entry.sha256)).toBe(true);
    }
  });

  it('contains an entry for every wwwroot/css/*.css', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    const cssDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/css');
    const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
    for (const name of cssFiles) {
      expect(manifestUrls.has(`/css/${name}`)).toBe(true);
    }
  });

  it('contains an entry for every wwwroot/js/*.js', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    const jsDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot/js');
    const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
    for (const name of jsFiles) {
      expect(manifestUrls.has(`/js/${name}`)).toBe(true);
    }
  });

  it('contains an entry for /ios.css', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const manifestUrls = new Set(manifest.files.map((f) => f.url));
    expect(manifestUrls.has('/ios.css')).toBe(true);
  });
});

describe('AC3.1 + AC3.2: offline + cached page renders styled with cached JS', () => {
  it('renders a previously-cached page with cached CSS (AC3.1) and cached JS (AC3.2) when fetch rejects', async () => {
    // Spy on URL.createObjectURL BEFORE the swap so we can inspect the Blob _mintBlobUrl
    // produced for /js/foo.js. Phase 3 revokes blob URLs at swap-end, so we cannot
    // fetch the blob URL after the swap. Inspecting the Blob argument at mint time is
    // the strongest in-JSDOM proof that the cached bytes would execute correctly in
    // a real browser.
    const createSpy = vi.spyOn(URL, 'createObjectURL');

    // Seed the pages store with cached HTML for /post/abc.
    const cachedHtml = `<html>
      <head>
        <link rel="stylesheet" href="/css/styles.css?v=4">
        <script src="/js/foo.js"></script>
      </head>
      <body data-page="post">cached body content</body>
    </html>`;
    await globalThis.CachedFetch._internals._putRecord(
      globalThis.CachedFetch._internals.STORE_PAGES,
      '/post/abc',
      { html: cachedHtml, etag: null, lastModified: null, cachedAt: Date.now() }
    );

    // Seed the assets store with cached bytes for /css/styles.css and /js/foo.js.
    const cssBytes = new TextEncoder().encode('body { color: red; }').buffer;
    await globalThis.AssetCache._internals._putAsset({
      url: '/css/styles.css',
      bytes: cssBytes,
      contentType: 'text/css',
      sha256: 'css-sha',
      etag: null,
      lastModified: null,
      cachedAt: Date.now(),
    });

    const jsSource = 'globalThis.__cachedJsExecuted = true;';
    const jsBytes = new TextEncoder().encode(jsSource).buffer;
    await globalThis.AssetCache._internals._putAsset({
      url: '/js/foo.js',
      bytes: jsBytes,
      contentType: 'application/javascript',
      sha256: 'js-sha',
      etag: null,
      lastModified: null,
      cachedAt: Date.now(),
    });

    // Simulate offline.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    // Navigate to the cached page.
    await globalThis.FetchAndSwap.fetchAndSwap('/post/abc');

    // AC3.1: cached CSS as <style> applied; no <link> to /css/styles.css remains.
    expect(document.head.querySelector('link[href*="/css/styles.css"]')).toBeNull();
    const style = document.head.querySelector('style');
    expect(style).not.toBeNull();
    expect(style.textContent).toContain('color: red');

    // AC3.2 plumbing: cached <script src> rewritten to a blob URL with the canonical
    // path on dataset.assetCacheOrigin. _recreateScripts moves all <script> elements
    // to document.body in the offline shell.
    const script = document.body.querySelector('script[data-asset-cache-origin]');
    expect(script).not.toBeNull();
    expect(script.dataset.assetCacheOrigin).toBe('/js/foo.js');
    expect(script.getAttribute('src')).toMatch(/^blob:/);

    // AC3.2 bytes-correctness: verify URL.createObjectURL was called with a Blob whose
    // type === 'application/javascript' and whose contents are byte-identical to the
    // cached jsBytes. This proves a real browser would execute the correct cached bytes,
    // even though JSDOM cannot execute <script src=blob:>.
    const jsCreateCall = createSpy.mock.calls.find((call) => {
      const blob = call[0];
      return blob && blob.type === 'application/javascript';
    });
    expect(jsCreateCall).toBeDefined();
    const blob = jsCreateCall[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/javascript');
    const blobText = await blob.text();
    expect(blobText).toBe(jsSource);
    // Side-effect demonstration: eval-ing those exact bytes produces the expected
    // global, so a real-browser-executed <script src=blob:> would do the same.
    // (JSDOM does NOT execute remote-src scripts; this eval is a parity check, not
    // a substitute for a real-browser integration test.)
    eval.call(globalThis, blobText);
    expect(globalThis.__cachedJsExecuted).toBe(true);
    delete globalThis.__cachedJsExecuted;

    // Cached page body content rendered with body attributes.
    expect(document.body.textContent).toContain('cached body content');
    expect(document.body.dataset.page).toBe('post');

    createSpy.mockRestore();
  });
});

describe('AC4.2: regular browsers (non-shell) never load assetCache.js', () => {
  // The asset cache is shell-gated by file location: src/bootstrap/* is the Capacitor
  // webDir, served only inside the iOS shell. App Service serves wwwroot/*. Any
  // wwwroot/*.html that loaded assetCache.js would break this invariant. Static check.
  it('no wwwroot/*.html page references assetCache.js', () => {
    const wwwrootDir = path.join(REPO_ROOT, 'src/RoadTripMap/wwwroot');
    const htmlFiles = fs.readdirSync(wwwrootDir).filter((f) => f.endsWith('.html'));
    expect(htmlFiles.length).toBeGreaterThan(0); // sanity: index.html, post.html, view.html, etc. exist
    for (const name of htmlFiles) {
      const contents = fs.readFileSync(path.join(wwwrootDir, name), 'utf8');
      expect(contents).not.toMatch(/assetCache\.js/);
    }
  });

  it('only src/bootstrap/index.html references assetCache.js (the Capacitor webDir entry)', () => {
    const bootstrapHtml = fs.readFileSync(path.join(SHELL, 'index.html'), 'utf8');
    expect(bootstrapHtml).toMatch(/assetCache\.js/);
  });
});

describe('AC5.1: lazy fallback fills the asset cache from a fresh HTML page', () => {
  it('after a successful revalidate of a cached page, asset URLs in the page are downloaded into IDB', async () => {
    // Pre-populate stale page so the cachedFetch goes through the cache-hit-then-
    // revalidate path (where the lazy precache trigger is wired).
    await globalThis.CachedFetch._internals._putRecord(
      globalThis.CachedFetch._internals.STORE_PAGES,
      '/post/lazy-integration',
      {
        html: '<html><body>stale</body></html>',
        etag: 'W/"old"',
        lastModified: null,
        cachedAt: Date.now() - 60000,
      }
    );

    const cssBytes = new TextEncoder().encode('body { color: blue; }').buffer;
    const jsBytes = new TextEncoder().encode('//').buffer;

    globalThis.fetch = vi.fn(async (urlArg) => {
      const url = typeof urlArg === 'string' ? urlArg : urlArg.url;
      if (url.endsWith('/post/lazy-integration')) {
        return new Response('<html><head><link rel="stylesheet" href="/css/integration-fresh.css"><script src="/js/integration-fresh.js"></script></head><body data-page="post">fresh</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html', 'ETag': 'W/"v2"' },
        });
      }
      if (url.endsWith('/css/integration-fresh.css')) {
        return new Response(cssBytes, { status: 200, headers: { 'Content-Type': 'text/css' } });
      }
      if (url.endsWith('/js/integration-fresh.js')) {
        return new Response(jsBytes, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
      }
      return new Response(null, { status: 404 });
    });

    await globalThis.CachedFetch.cachedFetch('/post/lazy-integration');

    // Condition-based wait for the fire-and-forget lazy pre-fetch to populate IDB.
    async function waitForAsset(url, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const record = await globalThis.AssetCache._internals._getAsset(url);
        if (record !== null) return record;
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    }

    const cssRecord = await waitForAsset('/css/integration-fresh.css');
    expect(cssRecord).not.toBeNull();
    expect(cssRecord.bytes.byteLength).toBe(cssBytes.byteLength);

    const jsRecord = await waitForAsset('/js/integration-fresh.js');
    expect(jsRecord).not.toBeNull();
  });
});
