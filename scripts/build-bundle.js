#!/usr/bin/env node
/**
 * Phase 5 iOS bundle builder (design: docs/design-plans/2026-04-13-resilient-uploads.md §bundle).
 *
 * Concatenates the JS/CSS files loaded by post.html into single files under
 * src/RoadTripMap/wwwroot/bundle/, then emits a manifest.json that the iOS
 * bootstrap loader (src/bootstrap/loader.js, Phase 5 Task 6) uses to decide
 * whether its cached copy is still fresh.
 *
 * Pure Node. No esbuild dependency yet — concatenation is all we need for
 * Phase 5. Minification can be added in a later optimization pass.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const jsDir = path.join(repoRoot, 'src/RoadTripMap/wwwroot/js');
const cssDir = path.join(repoRoot, 'src/RoadTripMap/wwwroot/css');
const iosCssSrc = path.join(repoRoot, 'src/RoadTripMap/wwwroot/ios.css');
const outDir = path.join(repoRoot, 'src/RoadTripMap/wwwroot/bundle');

// Source order matches post.html <script src="/js/..."> tags verbatim.
// CDN scripts (exifr, maplibre-gl) are NOT bundled — they load from CDN at runtime
// and have their own cache story.
const jsFiles = [
  'featureFlags.js',
  'exifUtil.js',
  'api.js',
  'mapCache.js',
  'tripStorage.js',
  'postService.js',
  'mapService.js',
  'poiLayer.js',
  'parkStyle.js',
  'stateParkLayer.js',
  'photoCarousel.js',
  'uploadUtils.js',
  'uploadSemaphore.js',
  'storageAdapter.js',
  'uploadTelemetry.js',
  'uploadTransport.js',
  'imageProcessor.js',
  'versionProtocol.js',
  'uploadQueue.js',
  'progressPanel.js',
  'resumeBanner.js',
  'optimisticPins.js',
  'postUI.js',
];

const CLIENT_MIN_VERSION = '1.0.0';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.version;
}

// Version suffix fallback chain:
//   1. Local dev / CI with .git available → git short SHA
//   2. Containerized build with .git excluded → BUNDLE_VERSION_SUFFIX env (set by caller)
//   3. Nothing available → UTC timestamp (ensures per-build uniqueness for cache-busting)
function versionSuffix() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    if (process.env.BUNDLE_VERSION_SUFFIX) return process.env.BUNDLE_VERSION_SUFFIX;
    return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  }
}

// Concatenate JS files as-is. Each file's top-level `const X = {...}` stays
// top-level after concatenation, preserving the existing window-global pattern
// (API, UploadQueue, PostUI, etc.). An IIFE wrapper would break this — the
// plan mentions one but it would require regex-rewriting every intentional
// global, which is fragile. In the iOS in-app WebView the window is already
// isolated from the native side, so global-scope pollution is a non-issue.
function concatJs() {
  return jsFiles
    .map((f) => {
      const contents = fs.readFileSync(path.join(jsDir, f), 'utf8');
      return `// ==== ${f} ====\n${contents}\n`;
    })
    .join('\n');
}

function concatCss(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  return files
    .map((f) => {
      const contents = fs.readFileSync(path.join(dir, f), 'utf8');
      return `/* ==== ${f} ==== */\n${contents}\n`;
    })
    .join('\n');
}

function checkBundleSyntax(bundlePath) {
  try {
    execSync(`node --check "${bundlePath}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (err) {
    console.error(`\nSyntax check failed for ${bundlePath}`);
    console.error(err.stderr ? err.stderr.toString() : err.toString());
    return false;
  }
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const jsOut = concatJs();
  const jsPath = path.join(outDir, 'app.js');
  fs.writeFileSync(jsPath, jsOut);

  // Regression test: verify bundle is syntactically valid
  if (!checkBundleSyntax(jsPath)) {
    process.exit(1);
  }

  const cssOut = concatCss(cssDir);
  const cssPath = path.join(outDir, 'app.css');
  fs.writeFileSync(cssPath, cssOut);

  const iosCssPath = path.join(outDir, 'ios.css');
  if (fs.existsSync(iosCssSrc)) {
    fs.copyFileSync(iosCssSrc, iosCssPath);
  } else {
    // Task 8 hasn't run yet; emit a placeholder so the manifest is complete
    // and the iOS loader doesn't 404 on first fetch during intermediate builds.
    fs.writeFileSync(iosCssPath, '/* ios.css placeholder — populated by Phase 5 Task 8 */\n');
  }

  const version = `${readPackageVersion()}-${versionSuffix()}`;
  const files = {};
  for (const name of ['app.js', 'app.css', 'ios.css']) {
    const p = path.join(outDir, name);
    const buf = fs.readFileSync(p);
    files[name] = { size: buf.length, sha256: sha256(buf) };
  }
  const manifest = {
    version,
    client_min_version: CLIENT_MIN_VERSION,
    files,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Bundle built: version=${version}`);
  for (const [name, meta] of Object.entries(files)) {
    console.log(`  ${name.padEnd(10)} ${String(meta.size).padStart(8)} bytes  sha256=${meta.sha256.slice(0, 12)}…`);
  }
}

main();
