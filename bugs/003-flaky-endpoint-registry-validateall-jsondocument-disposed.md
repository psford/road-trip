---
id: 3
title: Flaky CI — EndpointRegistry.ValidateAll() throws ObjectDisposedException on cached JsonDocument
status: open
severity: important
surface: api
opened: 2026-05-24
closed:
fixed-by:
regression-from: unknown — observed first on PR #83 (closed 2026-05-13 for this same failure), then PR #93 CI run 26353121763 (2026-05-24). Two confirmed observations months apart suggest the race has been latent for a while; the test ran green between those points more often than it failed.
regression-test:                  # the failing test IS the canary; this bug is about fixing the race so the canary stops failing
---

## Bug

`RoadTripMap.Tests.Endpoints.UploadEndpointHttpTests.DeleteTrip_WithUnknownToken_Returns404AndDoesNotCascade` intermittently fails in CI with `System.ObjectDisposedException: Cannot access a disposed object. Object name: 'JsonDocument'` inside `EndpointRegistry.ValidateAll()` (`src/RoadTripMap/EndpointRegistry.cs:85`).

Re-running the same CI run passes (confirmed 2026-05-24: PR #93 run 26353121763 failed → re-run passed). PR #83 was closed for the same failure 2026-05-13 because re-runs weren't attempted then.

Flaky CI is a real defect even when retries pass: it weakens the merge signal, costs human time on triage, and a test that "usually passes" eventually merges code that "usually works."

## Steps to reproduce

The failure is non-deterministic in CI under parallel xUnit execution. Steps that consistently surface it locally aren't yet known — but the static-state hypothesis below gives a clear target for a regression test (forcing the race).

Best current repro recipe:

1. Open a PR against develop with any change.
2. Wait for `build-and-test` to complete in the PR CI.
3. Observe — the run will either pass or fail with the stack trace below. Failure frequency from the two confirmed incidents is roughly 1 in N runs (N unknown, low single-digit guess).
4. If it fails, the stack trace will be on `UploadEndpointHttpTests.DeleteTrip_WithUnknownToken_Returns404AndDoesNotCascade`.

Local repro target (not yet validated):

1. From `tests/RoadTripMap.Tests/`, run `dotnet test --filter "FullyQualifiedName~UploadEndpointHttpTests" --logger:"console;verbosity=detailed"` with `RunSettings` configured to run tests in parallel within the assembly.
2. Repeat many times (the race is timing-dependent).

## Expected results

The test passes every time. `EndpointRegistry.ValidateAll()` reads from a live `JsonDocument` regardless of parallel test execution order.

## Actual results

Intermittent `ObjectDisposedException` from `JsonDocument.TryGetNamedPropertyValue` deep inside `JsonElement.GetProperty("environments")`. Stack trace:

```
System.ObjectDisposedException : Cannot access a disposed object.
Object name: 'JsonDocument'.
  at System.Text.Json.ThrowHelper.ThrowObjectDisposedException_JsonDocument()
  at System.Text.Json.JsonDocument.TryGetNamedPropertyValue(Int32 index, ReadOnlySpan`1 propertyName, JsonElement& value)
  at System.Text.Json.JsonElement.GetProperty(String propertyName)
  at RoadTripMap.EndpointRegistry.ValidateAll() in src/RoadTripMap/EndpointRegistry.cs:line 85
  at Program.<Main>$(String[] args) in src/RoadTripMap/Program.cs:line 125
```

## Environment

- CI: `roadtrip-ci.yml` on `ubuntu-latest` GitHub Actions runner
- Confirmed CI runs: 25779926490 (2026-05-13, PR #83), 26353121763 (2026-05-24, PR #93)
- .NET 8 SDK, xUnit (parallel within assembly)

## Notes for Claude

**Likely root cause:** `EndpointRegistry` caches `JsonDocument` in a static field `_doc` (src/RoadTripMap/EndpointRegistry.cs:8) populated lazily by `GetDocument()` (line 185). Static fields are process-global. Tests share the cache. If any test path (or `WebApplicationFactory` teardown) disposes the cached document while a parallel test or the next test's `Program.Main` is still using the shared `JsonElement` references derived from it, the second consumer hits `ObjectDisposedException`. JsonElement is just a view into JsonDocument; disposing the document invalidates all views.

**Fix surfaces:**

- **(a) Don't cache a `JsonDocument` across the test process.** Parse on every call to `GetDocument()`. Cost: small (a tiny endpoints.json file parsed N times). Eliminates the lifetime question entirely. Probably the right call given how rarely `GetDocument()` is on a hot path.
- **(b) Materialize the values out of `JsonDocument` at parse time.** Convert the JsonDocument into a plain `Dictionary<string, EndpointDef>` (or similar POCO) immediately, then never hold a `JsonElement` reference past the parse scope. The `using var doc = ...` becomes possible.
- **(c) Make the test runner not share static state.** xUnit `[CollectionDefinition]` with `DisableParallelization`, or use `IClassFixture` to isolate. This addresses the symptom (test order) without fixing the root design (static JsonDocument lifetime), so (a) or (b) is preferred.

**Regression test:** once the race is fixed, add a test that loads `EndpointRegistry`, disposes the underlying JsonDocument (or simulates), then calls `Resolve` / `ValidateAll` again — should not throw. With (a), the test confirms `GetDocument()` returns a fresh, undisposed document on each call.
