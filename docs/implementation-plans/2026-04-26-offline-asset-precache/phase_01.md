# Offline Asset Pre-Cache — Phase 1: Manifest emitter

**Goal:** Extend `scripts/build-bundle.js` to emit a new `src/RoadTripMap/wwwroot/asset-manifest.json` artifact listing every `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `wwwroot/ios.css` file with `{ url, size, sha256 }`, so downstream phases can diff cached assets against the deployed manifest.

**Architecture:** Reuse the existing build script's helpers (`sha256`, `versionSuffix`, `readPackageVersion`) and add a `buildAssetManifest(version)` function that dynamically enumerates files from disk (not from the hardcoded `jsFiles` array — that array is missing three files on disk and would produce an incomplete manifest). Write the manifest at the end of `main()`, after the existing `bundle/*` artifacts. The new file is a sibling of `wwwroot/bundle/` so App Service serves it at the URL `/asset-manifest.json` from its existing static-files middleware. Schema is `{ version, files: Array<{url, size, sha256}> }`, deliberately distinct from `bundle/manifest.json` (which uses an object-keyed `files` map for a different consumer).

**Tech Stack:** Node.js (built-in modules: `fs`, `path`, `crypto`, `child_process`). No new dependencies. No tests.

**Scope:** Phase 1 of 4 from `docs/design-plans/2026-04-26-offline-asset-precache.md`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

**Verifies:** None — this is an infrastructure phase, verified operationally per the design plan's Phase 1 "Done when" section: "Running `npm run build:bundle` produces a syntactically valid `asset-manifest.json` whose `files` array contains every file under `wwwroot/css/`, `wwwroot/js/`, and `ios.css` with correct `size` (bytes) and `sha256` (hex string). Existing bundle output is unchanged. CLAUDE.md is updated. (Infrastructure phase — verified operationally; no test ACs.)"

`offline-asset-precache.AC1.1` (manifest produced) is satisfied by Phase 1 in practice but is pinned as an automated test deliverable in Phase 4 (the end-to-end AC phase) — not here.

---

## Codebase verification findings (2026-04-27)

These are the planner's notes from investigating the codebase before writing the tasks below. They are NOT part of the implementation work — they explain *why* the tasks below are written the way they are. Skip if you don't care.

- ✓ `scripts/build-bundle.js` exists at `/Users/patrickford/Documents/claudeProjects/road-trip/scripts/build-bundle.js` (161 lines).
- ✓ Existing `sha256` helper at lines 56-58. `versionSuffix()` at 69-77. `readPackageVersion()` at 60-63. Reuse all three.
- ✗ **JS enumeration is hardcoded.** Lines 28-52 declare a 23-entry `jsFiles` array used by `concatJs()` (line 85). Three files on disk are NOT in that array: `mapUI.js`, `offlineError.js`, `roadTrip.js`. The design says the manifest must include "every `wwwroot/js/*.js`" — so the new manifest emitter MUST enumerate dynamically (`fs.readdirSync(jsDir)`) and NOT reuse `jsFiles`. Don't extend the hardcoded array — that would change the bundle output, which the design forbids ("Existing bundle output is unchanged").
- ✓ CSS dir has 1 file: `styles.css`. `wwwroot/ios.css` is a sibling of `wwwroot/css/`, not inside it.
- ✓ Total JS file count on disk: 26 (`fs.readdirSync` finds all of them).
- ✓ `src/RoadTripMap/wwwroot/asset-manifest.json` does NOT exist. This phase creates it.
- ✓ `.gitignore` ignores `bundle/*` artifacts but does NOT ignore `asset-manifest.json` — it will be checked into git as designed.
- ✓ `package.json` line 13: `"build:bundle": "node scripts/build-bundle.js"`. No script change needed — extending the existing script is enough.
- ✓ CLAUDE.md (repo root) — Commands section starts at line 20; the `build:bundle` entry is line 27. Key Files section starts at line 103; `scripts/build-bundle.js` entry is line 139, `src/RoadTripMap/wwwroot/bundle/` entry is line 140. No nested CLAUDE.md files in the repo.
- ✓ No existing tests target `scripts/build-bundle.js` — consistent with the design's "infrastructure phase, verified operationally; no test ACs" note.

---

<!-- START_TASK_1 -->
### Task 1: Add `buildAssetManifest()` to `scripts/build-bundle.js` and emit the new file

**Verifies:** None (infrastructure)

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/scripts/build-bundle.js` (add a new function and call it from `main()`)

**Step 1: Add the `buildAssetManifest(version)` function**

Insert this function immediately above `function main() {` (so above the current line 115). It enumerates all three asset roots dynamically — never use the hardcoded `jsFiles` array, because that array is missing files on disk:

```javascript
// Asset manifest: per-file listing consumed by the iOS shell asset pre-cache
// (src/bootstrap/assetCache.js, see docs/design-plans/2026-04-26-offline-asset-precache.md).
// Schema is intentionally distinct from bundle/manifest.json — different consumer,
// different shape. Enumerate every file on disk, not the hardcoded jsFiles array
// (jsFiles is bundle-specific and may not include every wwwroot/js/*.js file).
function buildAssetManifest(version) {
  const entries = [];

  const cssNames = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort();
  for (const name of cssNames) {
    const buf = fs.readFileSync(path.join(cssDir, name));
    entries.push({ url: `/css/${name}`, size: buf.length, sha256: sha256(buf) });
  }

  const jsNames = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
  for (const name of jsNames) {
    const buf = fs.readFileSync(path.join(jsDir, name));
    entries.push({ url: `/js/${name}`, size: buf.length, sha256: sha256(buf) });
  }

  if (fs.existsSync(iosCssSrc)) {
    const buf = fs.readFileSync(iosCssSrc);
    entries.push({ url: '/ios.css', size: buf.length, sha256: sha256(buf) });
  }

  return { version, files: entries };
}
```

**Step 2: Call it from `main()` and write the file**

Insert the following immediately after the existing `bundle/manifest.json` write (currently line 152, the line `fs.writeFileSync(path.join(outDir, 'manifest.json'), ...)`) and before the `console.log` summary at line 154:

```javascript
  const assetManifest = buildAssetManifest(version);
  const assetManifestPath = path.join(repoRoot, 'src/RoadTripMap/wwwroot/asset-manifest.json');
  fs.writeFileSync(assetManifestPath, JSON.stringify(assetManifest, null, 2) + '\n');
  console.log(`Asset manifest: ${assetManifest.files.length} files → asset-manifest.json`);
```

**Why a sibling of `bundle/`, not inside it:** App Service's static-files middleware serves `wwwroot/` recursively. A file at `wwwroot/asset-manifest.json` is reachable at the URL `/asset-manifest.json` (which is what `AssetCache.precacheFromManifest()` will fetch in Phase 2). Putting it inside `wwwroot/bundle/` would make it `/bundle/asset-manifest.json` — fine technically, but conflates a per-file artifact with the rollback-only bundle output. Keep them separate.

**Why use `version` from the existing flow:** The function takes `version` as an argument (a string like `1.0.0-4964285`) rather than recomputing it. This guarantees `bundle/manifest.json` and `asset-manifest.json` agree on version within a single build, which matters for rollback symmetry and debug traceability.

**Step 3: Verify operationally**

Run from repo root:

```bash
npm run build:bundle
```

Expected stdout (last lines):
```
Bundle built: version=<package-version>-<git-sha>
  app.js     ...
  app.css    ...
  ios.css    ...
Asset manifest: <N> files → asset-manifest.json
```

`<N>` should be `26 + 1 + 1 = 28` for the current tree (26 JS files in `wwwroot/js/` + 1 CSS file in `wwwroot/css/` + 1 `ios.css`). If `<N>` is different, something is wrong — recount with `ls src/RoadTripMap/wwwroot/css/*.css src/RoadTripMap/wwwroot/js/*.js | wc -l` and resolve before proceeding.

Verify the file exists and is valid JSON:

```bash
test -f src/RoadTripMap/wwwroot/asset-manifest.json && echo OK
node -e "const m = require('./src/RoadTripMap/wwwroot/asset-manifest.json'); console.log('version:', m.version); console.log('files:', m.files.length); console.log('first:', m.files[0]); const bad = m.files.filter(f => !f.url || !f.url.startsWith('/') || typeof f.size !== 'number' || f.size <= 0 || !/^[0-9a-f]{64}$/.test(f.sha256)); if (bad.length) { console.error('BAD ENTRIES:', bad); process.exit(1); } console.log('All entries well-formed.');"
```

Expected: `OK`, then a printed manifest version + file count + a sample entry, then `All entries well-formed.` All three URLs (`/css/...`, `/js/...`, `/ios.css`) should appear in the output.

Verify the existing `bundle/*` output is unchanged from before:

```bash
git diff --stat src/RoadTripMap/wwwroot/bundle/
```

Expected: zero lines of diff (or only sha256/version drift due to the build re-running, which is acceptable). If you see structural changes to `app.js` / `app.css` / `ios.css` content, the change is wrong — `concatJs` / `concatCss` / the `ios.css` copy MUST NOT have been touched. Revert the build.

**Step 4: Commit**

```bash
git add scripts/build-bundle.js src/RoadTripMap/wwwroot/asset-manifest.json
git commit -m "$(cat <<'EOF'
build(bundle): emit asset-manifest.json for the offline asset pre-cache

Adds buildAssetManifest() to scripts/build-bundle.js and writes
src/RoadTripMap/wwwroot/asset-manifest.json — a per-file listing
({version, files: [{url, size, sha256}]}) of every wwwroot/css/*.css,
wwwroot/js/*.js, and ios.css. Consumed by the iOS shell asset pre-cache
(src/bootstrap/assetCache.js, Phase 2 of the offline-asset-precache
design plan).

Existing bundle/* output is unchanged. JS files are enumerated dynamically
from disk rather than the hardcoded jsFiles array, which is bundle-specific
and currently misses three files on disk.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update CLAUDE.md (Commands and Key Files sections)

**Verifies:** None (documentation)

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/CLAUDE.md`

**Step 1: Update the Commands section entry for `npm run build:bundle` (line 27)**

Find this line (currently line 27):

```
- `npm run build:bundle` -- Concat `src/RoadTripMap/wwwroot/js/*.js` + `css/*.css` into `src/RoadTripMap/wwwroot/bundle/{app.js,app.css,ios.css,manifest.json}`. Runs `node --check` against `app.js` and fails on syntax errors (guards against duplicate-const regressions from naive concatenation). As of the iOS Offline Shell branch the iOS loader no longer consumes this bundle; it is retained for inspection / potential rollback.
```

Replace with:

```
- `npm run build:bundle` -- Concat `src/RoadTripMap/wwwroot/js/*.js` + `css/*.css` into `src/RoadTripMap/wwwroot/bundle/{app.js,app.css,ios.css,manifest.json}`. Runs `node --check` against `app.js` and fails on syntax errors (guards against duplicate-const regressions from naive concatenation). As of the iOS Offline Shell branch the iOS loader no longer consumes this bundle; it is retained for inspection / potential rollback. Also emits `src/RoadTripMap/wwwroot/asset-manifest.json` — a per-file listing of every `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `ios.css` consumed by the iOS shell asset pre-cache (`src/bootstrap/assetCache.js`).
```

**Step 2: Add a new Key Files entry between the existing `scripts/build-bundle.js` and `src/RoadTripMap/wwwroot/bundle/` entries**

Find these adjacent lines (currently lines 139-140):

```
- `scripts/build-bundle.js` -- Node script that concatenates `wwwroot/js/*.js` + `wwwroot/css/*.css` into the `/bundle/*` assets + `manifest.json` (sha256 + size per file). Runs `node --check` on the output and fails the build on syntax errors.
- `src/RoadTripMap/wwwroot/bundle/` -- Build output served at `/bundle/*`. Regenerated by `npm run build:bundle`; checked in so prod App Service serves it without a JS build step.
```

Insert a new line between them so the result reads:

```
- `scripts/build-bundle.js` -- Node script that concatenates `wwwroot/js/*.js` + `wwwroot/css/*.css` into the `/bundle/*` assets + `manifest.json` (sha256 + size per file). Runs `node --check` on the output and fails the build on syntax errors. Also emits `src/RoadTripMap/wwwroot/asset-manifest.json` (per-file `{url, size, sha256}` listing consumed by the iOS shell asset pre-cache).
- `src/RoadTripMap/wwwroot/asset-manifest.json` -- Generated artifact (`{version, files: [{url, size, sha256}]}`) listing every `wwwroot/css/*.css`, `wwwroot/js/*.js`, and `ios.css`. Served at `/asset-manifest.json` by App Service's static-files middleware. Consumed by `src/bootstrap/assetCache.js` to populate the offline asset pre-cache. Regenerated by `npm run build:bundle`; checked in.
- `src/RoadTripMap/wwwroot/bundle/` -- Build output served at `/bundle/*`. Regenerated by `npm run build:bundle`; checked in so prod App Service serves it without a JS build step.
```

**Step 3: Update the "Last verified" date at the top of CLAUDE.md (line 3)**

Find:
```
Last verified: 2026-04-26
```

Replace with:
```
Last verified: 2026-04-27
```

**Step 4: Verify the diff is sensible**

```bash
git diff CLAUDE.md
```

Expected: three localized hunks — the Commands entry update (line 27 area), the new Key Files entry insertion (line 139-140 area), and the "Last verified" date bump (line 3). No other lines changed.

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): document asset-manifest.json artifact

Updates Commands section to note `npm run build:bundle` also emits
`asset-manifest.json` and adds a Key Files entry describing the new
artifact's schema and consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: End-of-phase verification

**Verifies:** Phase 1 "Done when" criteria from the design plan.

**Files:** None (verification only)

**Step 1: Re-run the build from a clean state and confirm idempotency**

```bash
rm src/RoadTripMap/wwwroot/asset-manifest.json
npm run build:bundle
git diff --stat src/RoadTripMap/wwwroot/asset-manifest.json
```

Expected: the file is regenerated with identical content (no diff after re-running), modulo `version` if the git SHA changed since the last commit. If you see content drift unrelated to `version`, investigate `buildAssetManifest()` — its output must be deterministic for a given working tree.

**Step 2: Confirm the existing bundle output is byte-stable**

```bash
git diff src/RoadTripMap/wwwroot/bundle/
```

Expected: at most a `version` / `sha256` drift in `bundle/manifest.json`. The `bundle/app.js`, `bundle/app.css`, `bundle/ios.css` files MUST be byte-identical to the version on `origin/develop`. If they differ in content, the change has accidentally regressed the bundle pipeline. Investigate before continuing to Phase 2.

**Step 3: Confirm the manifest is published-ready**

The manifest will be served by App Service at `/asset-manifest.json` because it lives directly under `wwwroot/`. Verify the path is correct:

```bash
ls -la src/RoadTripMap/wwwroot/asset-manifest.json
```

Expected: file exists at exactly that path (not nested in `bundle/` or `static/` or anywhere else).

**Step 4: Smoke-check the manifest is parseable, complete, and well-typed**

```bash
node -e "const m = require('./src/RoadTripMap/wwwroot/asset-manifest.json'); const urls = m.files.map(f => f.url); const cssCount = urls.filter(u => u.startsWith('/css/')).length; const jsCount = urls.filter(u => u.startsWith('/js/')).length; const iosCount = urls.filter(u => u === '/ios.css').length; console.log({ version: m.version, total: m.files.length, css: cssCount, js: jsCount, ios: iosCount });"
```

Expected: `total === css + js + ios`, `iosCount === 1`, `cssCount` ≥ 1, `jsCount` ≥ 1. The exact totals depend on the working tree at the time of the build — recount via `ls src/RoadTripMap/wwwroot/css/*.css src/RoadTripMap/wwwroot/js/*.js | wc -l` and add 1 for `ios.css` if you want a hard expected value. As of 2026-04-27 the tree had 1 CSS + 26 JS + 1 ios.css = 28 entries; if your tree differs, that's fine as long as the structure holds.

If `iosCount` is 0, `wwwroot/ios.css` was missing during the build — re-investigate before Phase 2 (the iOS shell relies on this file).

**Step 5: No commit needed for this verification task.** If any check above failed, return to Task 1 or Task 2 to fix the underlying issue and re-commit.
<!-- END_TASK_3 -->

---

## Phase 1 done when

All three tasks above are completed and committed, and the verification commands in Task 3 all pass. The branch state should be:
- Two new commits on `offline-asset-precache`: `build(bundle): ...` and `docs(claude-md): ...`.
- A new file `src/RoadTripMap/wwwroot/asset-manifest.json` checked into the repo.
- No content changes to `src/RoadTripMap/wwwroot/bundle/{app.js,app.css,ios.css}`.
- CLAUDE.md updated in three places (Commands entry, new Key Files entry, "Last verified" date).
