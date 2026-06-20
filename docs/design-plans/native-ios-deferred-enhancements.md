# Native iOS — Deferred Enhancements (future versions)

**Freshness:** 2026-06-19. Owner: Patrick.

These are features we **deliberately deferred** while shaping the photo-popup-polish +
sharing design (2026-06-19). For v1 we chose the simplest family-only path; Patrick has
confirmed he **will** want these in a future version. Each entry records the v1 decision,
why we deferred, what v1 does instead, and a concrete head-start for the future build
(grounded in the current code, so this doesn't go stale into hand-waving).

Current baseline these build on: **no server-side identity** — ownership is pure
token-bearer. The server (`src/RoadTripMap/Entities/TripEntity.cs`) stores only
`Slug, Name, Description, SecretToken, ViewToken, CreatedAt, IsActive`. The iOS app keeps
both tokens in the Keychain (`ios-swift/RoadTrip/RoadTrip/Storage/KeychainStore.swift`,
kinds `.secret`/`.view`, keyed by a local `Trip.id` UUID) plus a GRDB cache. The only auth
strategy is `Services/SecretTokenAuthStrategy.cs` (case-sensitive token compare).

---

## 1. Universal Links for share-to-import

**v1 decision (2026-06-19):** manual paste. Share sheet sends the secret token / post URL +
a hint; the recipient opens the app → **Import via Token** (`Views/Trips/PasteTokenView.swift`
→ `RoadTripAPI.importTrip`) → pastes.

**Why deferred:** Universal Links need server + entitlement setup that isn't worth it before
the app is even on TestFlight; manual paste works today with zero new infra.

**Future version entails:**
- Host an **`apple-app-site-association`** (AASA) JSON at the web host root
  (`/.well-known/apple-app-site-association`), served by the same ASP.NET app that already
  serves `/trips/{viewToken}` (`Program.cs`). Map paths like `/post/{secretToken}` (import /
  write) and `/trips/{viewToken}` (view) to the app's `appID` (`GP2M7H6R3U.com.psford.roadtripmap.native`).
- Add the **Associated Domains** entitlement (`applinks:<host>`) in `project.yml` /
  entitlements. NOTE: the domain must be the **prod** public host eventually — today the app
  targets the Azure **dev slot** (`APIEnvironment.baseURL`), so revisit alongside the prod
  graduation (see §4 context).
- Handle the incoming URL in SwiftUI via `.onOpenURL` (or `onContinueUserActivity` for web
  links): parse the token out of the path, then drive the **existing** `importTrip` (write)
  or open a view (read). Has-app → opens + imports; no-app → falls back to the web page.
- Considered-and-rejected alternative: a **custom URL scheme** (`roadtrip://import?token=…`).
  Simpler (no AASA), but the link is dead for anyone without the app (no web fallback) and
  reads as less polished — Universal Links is the target.

**Revisit trigger:** when polishing the invite/onboarding flow, or when the app graduates
from the dev slot to prod (so the AASA host is stable).

---

## 2. Contributor tier (write-without-delete)

**v1 decision (2026-06-19):** **secret token = full access.** Anyone you grant write access
to can also delete the whole trip / any photo; there's no per-person revocation. Acceptable
for trusted family/friends.

**Why deferred:** a safe "can add, can't delete" tier needs real backend work; the family
trust model doesn't need it yet.

**Future version entails:**
- Server: a **third token/role** beyond secret/view (e.g. `ContributorToken` on `TripEntity`,
  or a roles table), and a **second auth strategy** alongside `SecretTokenAuthStrategy` that
  authorizes posts/edits but **denies** `DELETE /api/trips/{token}` and
  `DELETE …/photos/{id}`. Endpoint role checks in `Program.cs` for the write routes.
- iOS: a third Keychain `TokenKind` (`.contributor`) and a third import path; UI to surface
  "invite to contribute (no delete)" vs "invite as co-owner".
- Enables **per-person revocation** (rotate one contributor's token without nuking the trip)
  — call that out as the real payoff.

**Revisit trigger:** first time a trip is shared beyond close family, or when someone
accidentally deletes shared content.

---

## 3. Trip recovery / multi-device (server-side identity)

**v1 decision (2026-06-19):** **re-import via token is fine.** Trips live only in this
device's GRDB cache + Keychain tokens. Deleting+reinstalling the app, or moving to a new
device, loses trips from the UI unless the user re-imports the token. (iOS Keychain may
survive reinstall on the *same* device, but the GRDB rows do not, and nothing re-hydrates
trips from Keychain tokens — so even same-device reinstall currently shows an empty list.)

**Why deferred:** real recovery means real identity (accounts or device registration), which
is a large lift against YAGNI for a 2–3 person app.

**Future version entails:**
- A server-side **identity** trips associate to: either lightweight **device registration**
  (register a device id → list its trips) or full **accounts** (Sign in with Apple is the
  low-friction iOS-native choice). New schema linking `TripEntity` → owner identity.
- A **"my trips" list/restore** endpoint so trips reappear automatically on reinstall / new
  device, and a sync path on launch.
- Smaller intermediate step worth considering first: **re-hydrate trips from Keychain tokens
  on launch** (the tokens often survive same-device reinstall) — recovers the common case
  without any server identity. Could ship well before full multi-device.

**Revisit trigger:** Patrick or dad gets a new phone, or an app reinstall loses trips in a
way that hurts.

---

## Related, already-tracked deferrals (not from this discussion)

- **Finer upload progress** — background uploader currently bumps progress per-block; most
  photos are a single 4 MB block so the banner reads pending→done. `didSendBodyData` not
  wired. (See project memory handoff.)
- **AC4.4 fully-optimistic delete-trip**, **AC5.5 50+ pin perf**, **richer loading/no-network
  states** — Phase 7 polish, tracked in the design doc + memory.
