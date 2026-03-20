# Functional Specification: Road Trip Photo Map

**Version:** 1.4
**Last Updated:** 2026-03-20 (Phase 7, Task 1: Privacy hardening with robots.txt and noindex meta tags)
**Author:** Claude (AI Assistant)
**Status:** In Development
**Audience:** Business Users, Product Owners, QA Testers

---

## 1. Executive Summary

### 1.1 Purpose

Road Trip Photo Map is a mobile-first web application that lets anyone create a shared road trip, hand out two links (one for posting photos, one for viewing the map), and watch a photo-pinned map come together as the trip unfolds. There are no accounts, no logins, and no app to install.

### 1.2 Business Objectives

| Objective | Description |
|-----------|-------------|
| **Zero-friction sharing** | One link to post, one link to view -- no accounts, no installs |
| **Automatic geography** | GPS extracted from photos, place names resolved automatically |
| **Visual storytelling** | Map with photo pins tells the trip story geographically |
| **Privacy by default** | Photos not indexable, EXIF stripped, locations not discoverable by crawlers |
| **Reusable** | Anyone can create unlimited independent trips from the homepage |

### 1.3 Target Users

| User Type | Description | Primary Use Case |
|-----------|-------------|------------------|
| Trip Organizer | Person who creates the trip | Creates trip, distributes links to travelers |
| Traveler | Person on the trip with a phone | Posts photos via the secret link |
| Viewer | Friend or family member at home | Views the map and photos via the public link |

---

## 2. Product Overview

### 2.1 What the System Does

Road Trip Photo Map allows users to:

1. **Create** a named road trip and receive two links: a secret post link and a public view link
2. **Post** photos from a phone using the secret link -- GPS is auto-extracted, place names auto-resolved
3. **View** an interactive map with photo pins, popups with images and metadata, and an optional route line
4. **Download** original full-quality photos from the map view

### 2.2 What the System Does NOT Do

- Does not require user accounts or passwords of any kind
- Does not provide a trip discovery or browsing page (must know the link)
- Does not support video uploads (photos only)
- Does not provide real-time location tracking
- Does not support collaborative editing or comments on photos

---

## 3. Functional Requirements

### 3.1 Trip Creation (FR-001)

| ID | Requirement |
|----|-------------|
| FR-001.1 | The system must provide a homepage at `/create` with a form for creating trips |
| FR-001.2 | The form must accept a trip name (required) and description (optional) |
| FR-001.3 | Submitting the form must create a trip and display a unique slug, secret token, view URL, and post URL |
| FR-001.4 | The generated slug must be URL-friendly: lowercase, hyphens, no special characters |
| FR-001.5 | Duplicate trip names must produce unique slugs (via numeric suffix) |
| FR-001.6 | Empty or whitespace-only trip names must return a 400 validation error |
| FR-001.7 | Very long trip names must be truncated to a reasonable slug length (max 80 characters) |
| FR-001.8 | The view URL and post URL must be displayed with copy-to-clipboard buttons |
| FR-001.9 | Creating a trip must require no authentication |

**User Story:** *As a trip organizer, I want to create a trip in seconds and get shareable links so that travelers can start posting immediately without creating accounts.*

**Acceptance Criteria:** road-trip-map.AC1, road-trip-map.AC4, road-trip-map.AC5.3

---

### 3.2 Photo Posting (FR-002)

| ID | Requirement |
|----|-------------|
| FR-002.1 | The system must provide a posting page at `/post/{secret-token}` |
| FR-002.2 | The page must display a large "Add Photo" button that triggers the device camera/gallery picker |
| FR-002.3 | After selecting a photo, the system must extract GPS coordinates from EXIF metadata in the browser |
| FR-002.4 | The system must auto-resolve GPS coordinates to a human-readable place name (e.g., "Grand Canyon, AZ") and display it before confirming the upload |
| FR-002.5 | If the photo has no GPS EXIF data, the system must show a fallback mini-map where the user can tap to place a pin |
| FR-002.6 | The user must be able to add an optional caption before posting |
| FR-002.7 | On confirm, the photo must be uploaded and stored in three quality tiers: original (unmodified), display (max 1920px), and thumbnail (max 300px) |
| FR-002.8 | EXIF metadata must be stripped from all stored copies for privacy |
| FR-002.9 | The posting page must show a list of already-posted photos (most recent first) with thumbnails |
| FR-002.10 | The system must display success/error feedback after posting (toast notifications) |
| FR-002.11 | An upload without a valid secret token must return 401 Unauthorized |
| FR-002.12 | A non-image file upload must return 400 Bad Request |
| FR-002.13 | A file exceeding 15MB must return 400 Bad Request |
| FR-002.14 | The original photo must be downloadable at full quality -- no degradation of the uploaded file |
| FR-002.15 | A caption field is optional -- photo posts successfully with or without one |
| FR-002.16 | Posting requires only the secret link -- no username, password, or account |

**User Story:** *As a traveler on a road trip, I want to post a photo from my phone in one tap -- pick the photo, see where it was taken, add a caption if I want, and done.*

**Acceptance Criteria:** road-trip-map.AC2, road-trip-map.AC5.2

---

### 3.3 Map View (FR-003)

| ID | Requirement |
|----|-------------|
| FR-003.1 | The system must provide a public map page at `/trips/{slug}` |
| FR-003.2 | The map must display pins at the correct GPS coordinates for each photo |
| FR-003.3 | Clicking a pin must show a popup with the display-quality image, place name, caption, and timestamp |
| FR-003.4 | The popup must include a "Download original" link that serves the full-quality photo |
| FR-003.5 | A route-line toggle button must connect pins chronologically with a polyline when enabled |
| FR-003.6 | The map must auto-fit bounds to show all pins on initial load |
| FR-003.7 | A trip with zero photos must show an empty map with a "No photos yet" message |
| FR-003.8 | A trip with one photo must center the map on that pin (no route line) |
| FR-003.9 | Viewing a trip map must require no authentication -- just the URL |
| FR-003.10 | The map must use OpenStreetMap tiles via Leaflet.js |

**User Story:** *As a family member at home, I want to open a link and see a map of where my parents are on their road trip, with photos pinned at each stop.*

**Acceptance Criteria:** road-trip-map.AC3, road-trip-map.AC5.1

---

### 3.4 Reusability (FR-004)

| ID | Requirement |
|----|-------------|
| FR-004.1 | The homepage must allow creating multiple independent trips |
| FR-004.2 | Each trip must have its own slug, secret token, photos, and map |
| FR-004.3 | Photos uploaded to one trip must not appear on another trip's map |

**User Story:** *As a repeat user, I want to create a new trip for each vacation without the old one interfering.*

**Acceptance Criteria:** road-trip-map.AC4

---

### 3.5 Privacy & Security (FR-005)

| ID | Requirement |
|----|-------------|
| FR-005.1 | `robots.txt` must disallow `/post/`, `/trips/`, and `/api/` |
| FR-005.2 | All trip pages must include `<meta name="robots" content="noindex, nofollow">` |
| FR-005.3 | All API responses must include the `X-Robots-Tag: noindex, nofollow` header |
| FR-005.4 | There must be no trip listing or discovery page -- users must know the slug |
| FR-005.5 | Guessing a random slug must return 404 with a generic error (no enumeration) |
| FR-005.6 | Secret tokens must be UUID v4 (122 bits of entropy) |
| FR-005.7 | EXIF data must be stripped from all stored photo files |
| FR-005.8 | Photos must not be accessible via direct blob storage URLs -- served through API proxy only |
| FR-005.9 | Upload rate limiting must cap at 20 uploads/hour per IP address |
| FR-005.10 | The authorization mechanism must be pluggable via dependency injection, allowing the secret-token strategy to be swapped for PIN codes or OAuth later without changing endpoint code |

**User Story:** *As a trip organizer sharing my parents' trip, I want their route and location data to be invisible to search engines and random internet users.*

**Acceptance Criteria:** road-trip-map.AC5, road-trip-map.AC6

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|-------------|
| NFR-001 | Photo upload must complete within 10 seconds on a typical mobile connection |
| NFR-002 | Map page must load and render pins within 3 seconds |
| NFR-003 | Reverse geocoding must use a caching layer (GeoCache) to avoid redundant Nominatim lookups |
| NFR-004 | Nominatim rate limiting must not exceed 1 request/second per their usage policy |

### 4.2 Compatibility

| ID | Requirement |
|----|-------------|
| NFR-005 | The posting page must be optimized for mobile-first (iPhone Safari, Android Chrome) |
| NFR-006 | The map view must work on desktop and mobile browsers |
| NFR-007 | No app installation required -- pure web, works in any modern browser |

### 4.3 Data Integrity

| ID | Requirement |
|----|-------------|
| NFR-008 | Original uploaded photos must be preserved at full quality (no lossy re-encoding of the original tier) |
| NFR-009 | GPS coordinates must be stored with sufficient precision for accurate map pinning |

---

## 5. URL Structure

| URL | Purpose | Access Level |
|-----|---------|--------------|
| `/create` | Create new trip form | Public |
| `/trips/{slug}` | Map view | Public (unlisted) |
| `/post/{secret-token}` | Photo posting page | Secret link only |
| `/api/trips` | Trip creation endpoint | Public |
| `/api/trips/{slug}` | Trip metadata | Public |
| `/api/trips/{slug}/photos` | Photo list for a trip | Public |
| `/api/trips/{secret-token}/photos` | Photo upload | Secret token required |
| `/api/photos/{tripId}/{photoId}/{size}` | Photo binary (original/display/thumb) | Public |
| `/api/geocode?lat=...&lng=...` | Reverse geocode lookup | Internal |

---

## 6. Photo Pipeline

Each uploaded photo is processed into three storage tiers:

| Tier | Max Width | Purpose | When Used |
|------|-----------|---------|-----------|
| Original | Unchanged | Full-quality download | "Download original" link in map popup |
| Display | 1920px | Lightbox/popup view | Click on map pin |
| Thumbnail | 300px | Map markers, lists | Map view, post page list |

Processing on upload:
1. Validate image type and size (max 15MB)
2. Strip EXIF from all stored copies (privacy)
3. Generate display and thumbnail versions via SkiaSharp
4. Upload all three tiers to Azure Blob Storage
5. Serve through API endpoint only (no direct blob URLs)

---

## 7. User Flows

### 7.1 Trip Creation Flow

```
Homepage (/create)
    │
    ▼
┌─────────────────────┐
│ Enter trip name     │
│ (optional desc)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ POST /api/trips     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Display:            │
│ • View link (copy)  │
│ • Post link (copy)  │
└─────────────────────┘
```

### 7.2 Photo Posting Flow

```
Post page (/post/{token})
    │
    ▼
┌─────────────────────┐
│ Tap "Add Photo"     │
│ → camera/gallery    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Extract EXIF GPS    │
│ (client-side)       │
└──────────┬──────────┘
      Has GPS?
     ┌────┴────┐
    Yes        No
     │          │
     ▼          ▼
┌──────────┐ ┌──────────┐
│ Auto-    │ │ Pin-drop │
│ resolve  │ │ mini-map │
│ place    │ │ fallback │
└────┬─────┘ └────┬─────┘
     │             │
     └──────┬──────┘
            ▼
┌─────────────────────┐
│ Preview: photo +    │
│ place name + caption│
│ → Confirm upload    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Upload, process,    │
│ store 3 tiers       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Success toast       │
│ Photo in list       │
└─────────────────────┘
```

### 7.3 Map Viewing Flow

```
Map page (/trips/{slug})
    │
    ▼
┌─────────────────────┐
│ Load trip + photos  │
│ via API             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Render Leaflet map  │
│ with photo pins     │
│ (auto-fit bounds)   │
└──────────┬──────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌──────────┐ ┌──────────┐
│ Click    │ │ Toggle   │
│ pin →    │ │ route    │
│ popup    │ │ line     │
└──────────┘ └──────────┘
```

---

## 8. Glossary

| Term | Definition |
|------|------------|
| Slug | URL-friendly identifier derived from trip name (e.g., `parents-cross-country-2026`) |
| Secret token | UUID v4 string embedded in the post URL -- possession of the link is the credential |
| Three-tier storage | Original, display (1920px), and thumbnail (300px) versions of each photo |
| Reverse geocoding | Converting GPS coordinates into a human-readable place name |
| GeoCache | Internal cache table to avoid redundant reverse-geocoding lookups |
| EXIF | Metadata embedded in photos by cameras/phones (GPS, timestamp, camera model) |
| Pin drop | Manual location selection on a mini-map when a photo has no GPS data |
| Route line | Polyline connecting photo pins in chronological order on the map |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.3 | 2026-03-20 | Phase 6, Task 2: Public map view (trips.html) with Leaflet interactive map. Features: photo pins at GPS coordinates, clickable popups with display image, place name, caption, timestamp, and download link, route-line toggle connecting pins chronologically, auto-fit bounds with padding, single-photo centering (zoom 13), empty message for zero photos. Trip name displayed in fixed header. Responsive design for mobile/tablet/desktop. No authentication required. Functional requirements FR-003.1 through FR-003.10 satisfied. Covers AC3.1-AC3.7 (map view acceptance criteria). |
| 1.2 | 2026-03-20 | Phase 5, Task 2: Photo posting page (post.html) with EXIF preview and pin-drop fallback. Features: camera capture input (capture="environment"), photo thumbnail preview, auto-resolved place name display, optional caption input, Leaflet pin-drop map for manual location (photos without GPS), photo list with thumbnails and delete buttons, toast notifications. Functional requirements FR-002.1 through FR-002.16 satisfied. |
| 1.1 | 2026-03-20 | Phase 2, Task 3: Trip creation form implemented (create.html) with copy-to-clipboard for URLs, landing page (index.html), and mobile-first responsive design. Functional requirements FR-001.1 through FR-001.9 satisfied. |
| 1.0 | 2026-03-19 | Initial functional spec inferred from design plan and implementation phases |
