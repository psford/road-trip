# Technical Specification: Road Trip Photo Map

**Version:** 2.6
**Last Updated:** 2026-03-21 (DesignTimeDbContextFactory TCP support for WSL2)
**Status:** Phase 8 - Azure Deployment (Code review issues resolved)

---

## 1. Architecture Overview

**Stack:** ASP.NET Core 8.0 Minimal API + EF Core 8.0.23 + Azure SQL + Azure Blob Storage + Leaflet.js

**Deployment:** Azure App Service (Linux) → Azure SQL (shared `StockAnalyzer` database in `roadtrip` schema)

**Frontend:** Vanilla HTML/JS/CSS served as static files from `wwwroot/`

**Database:** Shared with Stock Analyzer on `StockAnalyzer` database; Road Trip tables isolated in `roadtrip` schema

---

## 2. Project Structure

```
projects/road-trip/
├── RoadTripMap.sln                 # Solution file
├── src/
│   └── RoadTripMap/
│       ├── RoadTripMap.csproj      # Main API project
│       ├── Program.cs               # Minimal API configuration
│       ├── appsettings.json         # Production config (empty connection string)
│       ├── appsettings.Development.json  # Local SQL Express config
│       ├── Entities/                # Domain models
│       │   ├── TripEntity.cs
│       │   ├── PhotoEntity.cs
│       │   └── GeoCacheEntity.cs
│       ├── Data/                    # EF Core context and factories
│       │   ├── RoadTripDbContext.cs
│       │   └── DesignTimeDbContextFactory.cs
│       ├── Helpers/                 # Utility functions
│       │   └── SlugHelper.cs        # URL slug generation and uniqueness
│       ├── Models/                  # DTO models
│       │   ├── CreateTripRequest.cs
│       │   └── CreateTripResponse.cs
│       ├── Services/                # Domain services (Phase 3+)
│       │   ├── IAuthStrategy.cs
│       │   ├── SecretTokenAuthStrategy.cs
│       │   ├── IPhotoService.cs
│       │   ├── PhotoService.cs
│       │   ├── IGeocodingService.cs (Phase 4)
│       │   ├── NominatimGeocodingService.cs (Phase 4)
│       │   └── UploadRateLimiter.cs (Phase 7) — IP-based rate limiter (20/hr)
│       ├── Migrations/              # EF Core migrations (generated)
│       └── wwwroot/                 # Static files (HTML, JS, CSS)
│           ├── index.html           # Landing page
│           ├── create.html          # Trip creation form
│           ├── css/
│           │   └── styles.css       # Mobile-first responsive styles
│           ├── js/
│           │   ├── api.js           # API client
│           │   └── exifUtil.js      # EXIF extraction wrapper (Phase 4)
│           └── lib/
│               └── exifr/           # EXIF parsing library (Phase 4)
│                   └── lite.umd.js
├── tests/
│   └── RoadTripMap.Tests/           # xUnit test project
└── docs/
    ├── FUNCTIONAL_SPEC.md           # User requirements
    └── TECHNICAL_SPEC.md            # This file
```

---

## 3. Entity Model (Phase 1 - Infrastructure)

### 3.1 TripEntity

Represents a named road trip with metadata and photo collection.

**Properties:**
- `Id` (int, PK): Surrogate key
- `Slug` (string, unique, max 200): URL-friendly identifier (e.g., `parents-2026-west`)
- `Name` (string, required, max 500): Human-readable trip name
- `Description` (string, nullable, max 2000): Optional trip description
- `SecretToken` (string, unique, max 36): UUID v4 for secret link authorization
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert
- `IsActive` (bool): Soft-delete flag (default: true)
- `Photos` (ICollection<PhotoEntity>): Navigation to photos

**Database Mapping:**
- Table: `roadtrip.Trips`
- Indices: `(Slug)` UNIQUE, `(SecretToken)` UNIQUE
- Constraints: `SecretToken` required, max length 36 (UUID v4 as string)

---

### 3.2 PhotoEntity

Represents a photo uploaded to a trip with geolocation and blob reference.

**Properties:**
- `Id` (int, PK): Surrogate key
- `TripId` (int, FK): Foreign key to Trip
- `BlobPath` (string, required, max 500): Path to original blob in Azure Storage
- `Latitude` (double): GPS latitude (decimal degrees)
- `Longitude` (double): GPS longitude (decimal degrees)
- `PlaceName` (string, nullable, max 500): Reverse-geocoded location name (e.g., "Grand Canyon, AZ")
- `Caption` (string, nullable, max 1000): User-provided photo caption
- `TakenAt` (DateTime): When the photo was taken (from EXIF or user input)
- `CreatedAt` (DateTime): Defaults to `GETUTCDATE()` on insert
- `Trip` (TripEntity): Navigation to parent trip

**Database Mapping:**
- Table: `roadtrip.Photos`
- Foreign Key: `TripId` → `Trips.Id` with `DELETE CASCADE`
- No indices on coordinates yet (added in Phase 2 for spatial queries)

---

### 3.3 GeoCacheEntity

Internal cache table for reverse geocoding results to avoid redundant Nominatim API calls.

**Properties:**
- `Id` (int, PK): Surrogate key
- `LatRounded` (double): Latitude rounded to 4 decimal places (~11m precision)
- `LngRounded` (double): Longitude rounded to 4 decimal places (~11m precision)
- `PlaceName` (string, required, max 500): Cached place name result
- `CachedAt` (DateTime): Defaults to `GETUTCDATE()` on insert

**Database Mapping:**
- Table: `roadtrip.GeoCache`
- Index: `(LatRounded, LngRounded)` UNIQUE (composite key)
- Purpose: Avoid flooding Nominatim with duplicate requests for the same location

---

## 4. Database Configuration

### 4.1 Schema

All Road Trip tables use the `roadtrip` schema to isolate from Stock Analyzer's `dbo`, `data`, and `staging` schemas.

```sql
-- Tables created by InitialCreate migration:
CREATE TABLE roadtrip.Trips (
    Id INT PRIMARY KEY IDENTITY,
    Slug NVARCHAR(200) NOT NULL UNIQUE,
    Name NVARCHAR(500) NOT NULL,
    Description NVARCHAR(2000) NULL,
    SecretToken NVARCHAR(36) NOT NULL UNIQUE,
    CreatedAt DATETIME DEFAULT GETUTCDATE(),
    IsActive BIT DEFAULT 1
);

CREATE TABLE roadtrip.Photos (
    Id INT PRIMARY KEY IDENTITY,
    TripId INT NOT NULL,
    BlobPath NVARCHAR(500) NOT NULL,
    Latitude FLOAT NOT NULL,
    Longitude FLOAT NOT NULL,
    PlaceName NVARCHAR(500) NULL,
    Caption NVARCHAR(1000) NULL,
    TakenAt DATETIME NOT NULL,
    CreatedAt DATETIME DEFAULT GETUTCDATE(),
    FOREIGN KEY (TripId) REFERENCES Trips(Id) ON DELETE CASCADE
);

CREATE TABLE roadtrip.GeoCache (
    Id INT PRIMARY KEY IDENTITY,
    LatRounded FLOAT NOT NULL,
    LngRounded FLOAT NOT NULL,
    PlaceName NVARCHAR(500) NOT NULL,
    CachedAt DATETIME DEFAULT GETUTCDATE(),
    UNIQUE (LatRounded, LngRounded)
);
```

### 4.2 Connection String

**Development (SQL Express):**
```
Server=.\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True
```

**Production (Azure SQL):**
Set via App Service configuration variable `DefaultConnection` (not committed in code).

### 4.3 EF Core Context

**RoadTripDbContext** configures:
- Default schema: `roadtrip`
- Three DbSets: `Trips`, `Photos`, `GeoCache`
- Fluent API configuration in `OnModelCreating`

**DesignTimeDbContextFactory** provides connection string to `dotnet ef` CLI for migrations. It supports both Windows development (local named pipes) and WSL2 development (TCP over network):

1. **Windows Development (Default):**
   - Checks environment variable: `RT_DESIGN_CONNECTION`
   - Falls back to: `Server=.\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True`

2. **WSL2 Development (TCP):**
   - Set `RT_DESIGN_CONNECTION` before running migrations:
     ```bash
     export RT_DESIGN_CONNECTION="Server=127.0.0.1,1433;Database=StockAnalyzer;User Id=wsl_claude_admin;Password=<password>;TrustServerCertificate=True;"
     dotnet ef migrations list
     ```
   - Enables migrations from WSL2 to Windows SQL Express over TCP/IP

---

## 5. Helpers and Models

### 5.1 SlugHelper

Located in `Helpers/SlugHelper.cs`, provides URL slug generation with uniqueness checking.

**Methods:**
- `GenerateSlug(string name)` — Converts human-readable names to URL-friendly slugs
  - Lowercases input
  - Replaces non-alphanumeric characters with hyphens
  - Collapses multiple consecutive hyphens
  - Trims leading/trailing hyphens
  - Truncates to max 80 characters
  - Uses source-generated regex for performance

- `GenerateUniqueSlugAsync(string name, Func<string, Task<bool>> slugExists)` — Ensures slug uniqueness
  - Calls `GenerateSlug` to get base slug
  - Falls back to `"trip"` if base slug is empty
  - Checks uniqueness via callback function
  - Appends `-2`, `-3`, etc. if conflicts detected

**Testing:** Full test coverage in `Tests/Helpers/SlugHelperTests.cs` (15 tests):
- Basic slug generation (lowercase, special chars, hyphens)
- Truncation of long names
- Uniqueness handling with counters
- Edge cases (empty strings, special chars only, whitespace)

### 5.2 DTOs

**CreateTripRequest** (Models/CreateTripRequest.cs)
- `Name` (string, required): Trip name
- `Description` (string, nullable): Optional trip description

**CreateTripResponse** (Models/CreateTripResponse.cs)
- `Slug` (string): URL-friendly identifier
- `SecretToken` (string): UUID v4 for secret link authorization
- `ViewUrl` (string): Public viewing URL (e.g., `/trips/my-slug`)
- `PostUrl` (string): Secret posting URL (e.g., `/post/token-uuid`)

**TripResponse** (Models/TripResponse.cs) — Phase 6, Task 1
- `Name` (string, required): Trip name
- `Description` (string, nullable): Trip description
- `PhotoCount` (int, required): Number of photos uploaded to trip
- `CreatedAt` (DateTime, required): When trip was created

---

## 6. NuGet Packages

### 6.1 Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `Microsoft.EntityFrameworkCore.SqlServer` | 8.0.23 | SQL Server provider for EF Core |
| `Microsoft.EntityFrameworkCore.Design` | 8.0.23 | EF Core tools (migrations) |

### 6.2 Testing Dependencies (Phase 2)

| Package | Version | Purpose |
|---------|---------|---------|
| `xunit` | Latest | Unit test framework |
| `Moq` | 4.20.72 | Mocking library |
| `FluentAssertions` | 6.12.2 | Assertion fluency |
| `Microsoft.EntityFrameworkCore.InMemory` | 8.0.23 | In-memory DB for testing |

### 6.3 Phase 3 Dependencies (Photo Upload & Auth)

| Package | Version | Purpose |
|---------|---------|---------|
| `SkiaSharp` | 3.119.2 | Image resizing and EXIF stripping |
| `SkiaSharp.NativeAssets.Linux.NoDependencies` | 3.119.2 | Linux native assets for SkiaSharp |
| `Azure.Storage.Blobs` | 12.27.0 | Azure Blob Storage SDK |
| `Microsoft.Extensions.Azure` | 1.13.1 | Azure DI extensions |

### 6.4 Phase 4 Dependencies (EXIF Extraction & Reverse Geocoding)

| Package | Version | Purpose |
|---------|---------|---------|
| `exifr` | Latest (via CDN) | Client-side EXIF extraction (JavaScript) |

Exifr is downloaded locally to `wwwroot/lib/exifr/lite.umd.js` (45KB) and wrapped by `exifUtil.js`.

---

## 7. Minimal API Bootstrap

**Program.cs** configures (Phase 3 additions):
1. Registers `RoadTripDbContext` with connection string from config
2. Registers `BlobServiceClient` via `Microsoft.Extensions.Azure` with `AzureStorage` connection string
3. Registers `IAuthStrategy` → `SecretTokenAuthStrategy` (Phase 3, Task 2)
4. Registers `IPhotoService` → `PhotoService` (Phase 3, Task 3)
5. Maps health check endpoint: `GET /api/health`
6. Maps trip creation endpoint: `POST /api/trips` (Phase 2, Task 2)
7. Serves static files from `wwwroot/`
8. Listens on port 5100 (avoid collision with Stock Analyzer on 5000)

**appsettings.Development.json** (Phase 3 addition):
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=.\\SQLEXPRESS;Database=StockAnalyzer;Trusted_Connection=True;TrustServerCertificate=True",
    "AzureStorage": "UseDevelopmentStorage=true"
  }
}
```
- `UseDevelopmentStorage=true` connects to Azurite (local Azure Storage emulator)
- Install Azurite: `npm install -g azurite` or use VS Code extension
- Start with: `azurite --silent --location ./azurite-data`

### 7.1 POST /api/trips — Create Trip

**Request:**
```json
{
  "name": "Cross Country 2026",
  "description": "Optional trip description"
}
```

**Validation:**
- `name` is required and must not be empty or whitespace (400 Bad Request if invalid)

**Response (200 OK):**
```json
{
  "slug": "cross-country-2026",
  "secretToken": "550e8400-e29b-41d4-a716-446655440000",
  "viewUrl": "/trips/cross-country-2026",
  "postUrl": "/post/550e8400-e29b-41d4-a716-446655440000"
}
```  <!-- pragma: allowlist secret -->

**Behavior:**
- Generates URL-friendly slug via `SlugHelper.GenerateUniqueSlugAsync`
- Generates secret token as Guid.NewGuid().ToString()
- Checks slug uniqueness in database
- Creates `TripEntity` and persists to DB
- Returns all four response fields
- No authentication required

**Testing:** See `TripEndpointTests.cs` (7 tests covering validation, uniqueness, response format, no-auth requirement)

### 7.2 GET /create — Trip Creation Form

Maps to `wwwroot/create.html`. Serves HTML form for creating new trips.

**Features:**
- Mobile-first responsive design
- Trip name input (required)
- Description textarea (optional)
- Client-side form submission to POST /api/trips
- Error display and handling
- Results section with copy-to-clipboard for URLs
- "Create Another Trip" button for reusability

### 7.3 Static Files

**index.html** — Landing page
- Introduction to Road Trip Map
- Link to create trip form
- How-it-works instructions

**create.html** — Trip creation page
- Form with trip name (required) and description (optional)
- Form submission triggers POST /api/trips
- Displays view URL, post URL, and slug
- Copy-to-clipboard buttons for each URL
- No reload needed; form resets for additional trips

**css/styles.css** — Mobile-first responsive CSS
- System font stack for native feel
- Mobile breakpoints (768px tablet, 1024px desktop)
- Color palette with primary, text, border, and message colors
- Form styling (inputs, buttons, error/success messages)
- Copy-button styling and hover states

**js/api.js** — API client
- Single `API.createTrip(name, description)` method
- Handles JSON serialization/deserialization
- Error handling and throwing

### 7.4 POST /api/trips/{secretToken}/photos — Upload Photo (Phase 3, Task 5)

**Request:** multipart/form-data
- `file` (IFormFile, required): Image file
- `lat` (double, required): Latitude
- `lng` (double, required): Longitude
- `caption` (string, optional): User caption
- `takenAt` (DateTime, optional): When photo was taken (defaults to UtcNow)

**Validation:**
- `secretToken` matches trip's token via `IAuthStrategy.ValidatePostAccess()` → 401 if invalid
- File content type starts with `image/` → 400 if not
- File size ≤ 15MB (15,728,640 bytes) → 400 if exceeded
- Trip exists → 404 if not

**Response (200 OK):**
```json
{
  "id": 42,
  "thumbnailUrl": "/api/photos/1/42/thumb",
  "displayUrl": "/api/photos/1/42/display",
  "originalUrl": "/api/photos/1/42/original",
  "lat": 40.7128,
  "lng": -74.0060,
  "placeName": "",
  "caption": "NYC Skyline",
  "takenAt": "2026-03-20T12:34:56Z"
}
```

**Behavior:**
- Creates `PhotoEntity` with `BlobPath = ""`
- Saves to DB to get auto-increment Id
- Calls `IPhotoService.ProcessAndUploadAsync()` (creates three tiers, returns `BlobPath`)
- Updates photo's `BlobPath` and persists
- Returns `PhotoResponse` with `/api/photos/` URLs (not direct blob URLs, per AC6.4)

### 7.5 DELETE /api/trips/{secretToken}/photos/{id} — Delete Photo (Phase 3, Task 5)

**Route parameters:**
- `secretToken`: Trip's secret token
- `id` (int): Photo ID

**Validation:**
- `secretToken` matches trip token → 401 if invalid
- Trip exists → 404 if not
- Photo exists and belongs to trip → 404 if not

**Response (204 No Content)**

**Behavior:**
- Validates auth via `IAuthStrategy.ValidatePostAccess()`
- Calls `IPhotoService.DeletePhotoAsync()` (deletes all three blob tiers)
- Removes `PhotoEntity` from DB
- Persists changes

### 7.6 GET /api/photos/{tripId}/{photoId}/{size} — Serve Photo (Phase 3, Task 6)

**Route parameters:**
- `tripId` (int): Trip ID
- `photoId` (int): Photo ID
- `size` (string): One of `original`, `display`, `thumb`

**Validation:**
- `size` is one of valid sizes → 400 if invalid
- Photo exists with matching `tripId` and `photoId` → 404 if not

**Response (200 OK):** JPEG image stream (Content-Type: image/jpeg)

**Behavior:**
- No auth required — photos are public
- Looks up photo in DB to verify membership
- Calls `IPhotoService.GetPhotoAsync()` to fetch from blob storage
- Returns stream as image/jpeg (proxies through API, never exposes direct blob URLs per AC6.4)

**Acceptance Criteria Verification:**
- **AC2.5 (Original downloadable):** Original size served via `/api/photos/{tripId}/{photoId}/original`
- **AC6.4 (No direct blob URLs):** All photo URLs follow `/api/photos/` pattern; endpoint validates existence before returning

### 7.7 GET /api/geocode?lat={lat}&lng={lng} — Reverse Geocode (Phase 4, Task 3)

**Query parameters:**
- `lat` (double, required): Latitude
- `lng` (double, required): Longitude

**Validation:**
- Both parameters must be valid floating-point numbers → 400 Bad Request if parsing fails

**Response (200 OK):**
```json
{
  "placeName": "Grand Canyon Village, Arizona, USA"
}
```

**Behavior:**
- Calls `IGeocodingService.ReverseGeocodeAsync(lat, lng)`
- Returns place name (may be null if Nominatim fails, but endpoint still returns 200)
- Used by photo upload page (Phase 5) to show location preview before confirming upload

### 7.8 GET /api/trips/{slug} — Get Trip Info (Phase 6, Task 1)

**Route parameters:**
- `slug` (string): Trip URL slug (required)

**Validation:**
- Trip with matching slug exists and `IsActive == true` → 404 if not found

**Response (200 OK):**
```json
{
  "name": "California Coast",
  "description": "Scenic drive down PCH",
  "photoCount": 42,
  "createdAt": "2026-03-20T12:00:00Z"
}
```

**Behavior:**
- No authentication required (public endpoint, AC5.1)
- Returns trip metadata for map view header
- `PhotoCount` counted from database (not cached)
- Covers AC3.1, AC3.6, AC5.1

**Testing:** 9 unit tests verify:
- Valid slug returns trip data with accurate photo count
- Invalid slug returns 404
- Inactive trips return 404
- No auth required
- Photo count is accurate for empty, single, and multi-photo trips

### 7.9 GET /api/trips/{slug}/photos — Get Trip Photos (Phase 6, Task 1)

**Route parameters:**
- `slug` (string): Trip URL slug (required)

**Validation:**
- Trip with matching slug exists and `IsActive == true` → 404 if not found

**Response (200 OK):** Array of PhotoResponse objects ordered by `TakenAt` ascending (chronological):
```json
[
  {
    "id": 1,
    "thumbnailUrl": "/api/photos/1/1/thumb",
    "displayUrl": "/api/photos/1/1/display",
    "originalUrl": "/api/photos/1/1/original",
    "lat": 40.7128,
    "lng": -74.0060,
    "placeName": "New York, NY, USA",
    "caption": "Times Square",
    "takenAt": "2026-01-01T09:00:00Z"
  }
]
```

**Behavior:**
- No authentication required (public endpoint, AC5.1)
- Returns empty array `[]` for trips with zero photos (AC3.6)
- Photos ordered by `TakenAt` ascending for route line rendering (AC3.3)
- All photo URLs follow `/api/photos/` pattern (proxied, no direct blob URLs)
- Covers AC3.1, AC3.6, AC5.1

**Testing:** 9 unit tests verify:
- Valid slug returns photos in chronological order (TakenAt ascending)
- Zero photos returns empty array (not 404)
- Invalid slug returns 404
- Inactive trips return 404
- No auth required
- Photo count, coordinates, and metadata accuracy

**Design Note:** Chronological ordering enables native apps to render route lines without client-side sorting.

### 7.10 GET /trips/{slug} — Public Trip Map View (Phase 6, Task 2)

**Route parameters:**
- `slug` (string): Trip URL slug (required)

**Validation:**
- No validation required — serves static HTML page

**Response (200 OK):** trips.html static file with Content-Type: text/html

**Features:**
- Full-viewport Leaflet map with OpenStreetMap tiles
- Trip name in fixed header at top
- Photo pins at GPS coordinates with clickable popups
- Popup contains display-quality image, place name, caption, timestamp, and download link
- Route toggle button (fixed position bottom-right) shows/hides polyline connecting pins chronologically
- Empty message overlay for trips with zero photos
- Auto-fits bounds to show all pins with padding (max zoom 15)
- Single photo: centered at zoom 13, no route button
- Mobile-first responsive design

**Leaflet CDN:**
- CSS: `unpkg.com/leaflet@1.9.4/dist/leaflet.css` (SRI: `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`)
- JS: `unpkg.com/leaflet@1.9.4/dist/leaflet.js` (SRI: `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`)
- Tiles from OpenStreetMap via `tile.openstreetmap.org`

**Covers:** AC3.1 (pins at GPS), AC3.2 (popup content), AC3.3 (route toggle), AC3.4 (auto-fit), AC3.5 (download link), AC3.6 (empty message), AC3.7 (single pin centered)

### 7.11 mapService.js — Data Layer (Phase 6, Task 2)

**Location:** `wwwroot/js/mapService.js`

**Design:** Pure data/state module with zero DOM references, designed for native app reuse (iOS/Android could call identical methods).

**API:**
```javascript
const MapService = {
    async loadTrip(slug) {
        // Loads trip metadata and photos via API calls
        // Returns {trip, photos}
    },
    getRouteCoordinates(photos) {
        // Transforms photos array into [lat, lng] coordinate pairs for Leaflet polyline
        // Returns Array<[lat, lng]>
    }
};
```

**Implementation:**
- `loadTrip()` parallelizes API.getTripInfo() and API.getTripPhotos() via Promise.all()
- `getRouteCoordinates()` maps each photo to [lat, lng] for L.polyline() consumption
- No Leaflet references; coordinates returned as plain arrays for portability

### 7.12 mapUI.js — Leaflet UI Layer (Phase 6, Task 2)

**Location:** `wwwroot/js/mapUI.js`

**Design:** Web-specific Leaflet rendering layer. Native apps would replace with MapKit/Google Maps but can reuse MapService.

**API:**
```javascript
const MapUI = {
    async init(slug) {
        // Main entry point — loads trip via MapService and renders map
    },
    renderMap(photos) {
        // Initializes Leaflet, adds tiles, creates markers, auto-fits bounds
    },
    createPopupHtml(photo) {
        // Generates HTML for marker popup (image, place, caption, timestamp, download)
    },
    setupRouteToggle(photos) {
        // Creates polyline and wires up route toggle button
    },
    toggleRoute() {
        // Shows/hides polyline; updates button text
    },
    showError(message) {
        // Displays error message in overlay
    }
};
```

**Implementation Details:**
- `init()` extracts slug from `window.location.pathname`, calls MapService.loadTrip(), updates DOM, calls renderMap()
- `renderMap()` initializes L.map(), adds OpenStreetMap tiles, handles three cases:
  - Zero photos: centers on USA (39.8°N, 98.6°W), zoom 4, shows empty message
  - One photo: creates marker, centers on it, zoom 13, no route button
  - Multiple photos: creates all markers, fitBounds() with padding, calls setupRouteToggle()
- `createPopupHtml()` returns string with image, place name, caption, formatted date, and download link
- `setupRouteToggle()` creates L.polyline() from MapService.getRouteCoordinates(), shows button, wires click handler
- `toggleRoute()` adds/removes polyline from map, toggles button text between "Show Route" / "Hide Route"
- All errors logged to console and displayed via showError()

**Leaflet Setup:**
- Map container: `<div id="map" class="map-container"></div>` (100vh height, 100% width)
- Marker popups: max 280px width, images with border-radius, clickable links for downloads
- Polyline: blue (#3388ff), weight 3px, opacity 0.8
- Attribution: standard OpenStreetMap credit in map corner

### 7.13 Map View Styling (Phase 6, Task 3)

**Location:** `wwwroot/css/styles.css` (section "Map View Styles")

**Full-Viewport Design:**
- `.map-container`: 100% width, 100vh height (fills entire viewport)
- `body.map-page`: padding 0, overflow hidden (for full-bleed map)

**Floating Controls (Fixed Position):**
- `.map-header`: Fixed top, full width, semi-transparent white bg, blur effect, trip name in 1.2rem bold
- `.map-control`: Fixed bottom-right, white bg with blue border, hover fills with blue, active scales 0.98
- `.map-empty`: Fixed center, semi-transparent overlay with "No photos yet" message

**Responsive Breakpoints:**
- **Mobile (< 480px):** Map header 1rem font, control bottom-20px right-8px, smaller padding
- **Tablet (≥ 768px):** Map header 1.3rem font, control bottom-40px right-20px
- **Desktop (≥ 1024px):** Map header 1.5rem font

**Leaflet Popup Customization:**
- `.leaflet-popup-content-wrapper`: white bg, small border-radius, subtle shadow
- Images, headings, text, links all styled for readability in popup context
- Max 280px width enforced by HTML inline styles

**Design Principles:**
- Mobile-first responsive design (scales up, never down)
- Full-viewport map with overlaid controls (header at top, button at bottom-right)
- Semi-transparent backgrounds with blur effects for readability over map
- Native-like feel with system font stack and smooth transitions

---

## 8. Migration Strategy

### 8.1 Creating Migrations

```bash
cd projects/road-trip/src/RoadTripMap
dotnet ef migrations add <MigrationName>
```

Migrations are stored in `Migrations/` folder and tracked in Git.

### 8.2 Applying Migrations

**Local (SQL Express):**
```bash
dotnet ef database update
```

**Production (Azure SQL):**
Applied automatically on app startup via `DbContext.Database.Migrate()` call in `Program.cs` (will be added in Phase 5).

---

## 9. Services (Phase 3)

### 9.1 IAuthStrategy & SecretTokenAuthStrategy

Pluggable authentication interface for validating POST access via secret token.

**IAuthStrategy** (Services/IAuthStrategy.cs):
```csharp
public interface IAuthStrategy
{
    Task<AuthResult> ValidatePostAccess(HttpContext context, TripEntity trip);
}

public record AuthResult(bool IsAuthorized, string? DeniedReason = null);
```

**SecretTokenAuthStrategy** (Services/SecretTokenAuthStrategy.cs):
- Extracts `secretToken` from route values via `HttpContext.GetRouteValue("secretToken")`
- Compares against `trip.SecretToken`
- Returns `AuthResult(true)` on match; `AuthResult(false, "Invalid or missing secret token")` on mismatch

**DI Registration** (Program.cs):
```csharp
builder.Services.AddScoped<IAuthStrategy, SecretTokenAuthStrategy>();
```

**Testing:** 6 unit tests verify:
- Matching token → authorized
- Mismatched token → unauthorized with reason
- Missing token → unauthorized
- Empty token → unauthorized
- Interface implementation
- AuthResult type correctness

**Design (AC6.1, AC5.2, AC2.6):**
- Auth strategy is DI-injected and swappable without endpoint code changes
- Secret token is the only credential (no passwords, accounts, headers)
- Invalid tokens return 401 Unauthorized

### 9.2 IPhotoService & PhotoService (Phase 3, Tasks 3-4)

Image processing pipeline using SkiaSharp with three-tier Azure Blob Storage uploads.

**IPhotoService** (Services/IPhotoService.cs):
```csharp
public interface IPhotoService
{
    Task<PhotoUploadResult> ProcessAndUploadAsync(Stream imageStream, int tripId, int photoId, string originalFileName);
    Task<Stream> GetPhotoAsync(int tripId, int photoId, string size);
    Task DeletePhotoAsync(int tripId, int photoId, string blobPath);
}

public record PhotoUploadResult(string BlobPath);
```

**PhotoService** (Services/PhotoService.cs):
- **ProcessAndUploadAsync:**
  1. Decode image via `SKBitmap.Decode(stream)` (reads pixel data)
  2. Check `SKBitmap.Origin` for EXIF rotation and apply if needed
  3. Upload three tiers: original, display, thumbnail
  4. **Original:** Re-encode as JPEG quality 95, no resize → blob path `{tripId}/{photoId}.jpg`
  5. **Display:** Resize to max 1920px width (aspect ratio preserved), JPEG quality 85 → `{tripId}/{photoId}_display.jpg`
  6. **Thumbnail:** Resize to max 300px width, JPEG quality 75 → `{tripId}/{photoId}_thumb.jpg`
  7. All re-encoding via `SKBitmap.Encode()` creates fresh pixel data, stripping EXIF by design (AC6.3)

- **GetPhotoAsync:**
  - Validates size is one of: `original`, `display`, `thumb`
  - Maps size to blob path suffix (empty, `_display`, `_thumb`)
  - Downloads and returns stream

- **DeletePhotoAsync:**
  - Deletes all three tiers by blob path

**Aspect-Ratio-Preserving Resize:**
```csharp
private static SKImageInfo CalculateResizedDimensions(int origWidth, int origHeight, int maxWidth)
{
    if (origWidth <= maxWidth) return new SKImageInfo(origWidth, origHeight);
    var ratio = (float)maxWidth / origWidth;
    return new SKImageInfo(maxWidth, (int)(origHeight * ratio));
}
```

**Testing:** 14 unit tests verify:
- Interface implementation
- Image decode/encode round-trip
- Aspect ratio preservation
- EXIF stripping via re-encoding
- Valid size acceptance
- Invalid size rejection

### 9.3 IGeocodingService & NominatimGeocodingService (Phase 4, Task 2)

Client-side GPS extraction and server-side place name resolution via OpenStreetMap Nominatim API.

**IGeocodingService** (Services/IGeocodingService.cs):
```csharp
public interface IGeocodingService
{
    Task<string?> ReverseGeocodeAsync(double latitude, double longitude);
}
```

**NominatimGeocodingService** (Services/NominatimGeocodingService.cs):
- **Constructor:** Injects `HttpClient` (registered via `AddHttpClient<NominatimGeocodingService>()`) and `RoadTripDbContext`
- Sets `User-Agent: RoadTripMap/1.0` on HttpClient default request headers
- Static `SemaphoreSlim(1, 1)` enforces Nominatim rate limit (1 request/sec max)

**ReverseGeocodeAsync implementation:**
1. Round lat/lng to 2 decimal places (~1.1km grid at equator) for cache key
2. Query `GeoCache` table: `db.GeoCache.FirstOrDefaultAsync(g => g.LatRounded == latRounded && g.LngRounded == lngRounded)`
3. If found → return `cachedEntry.PlaceName`
4. If not found → acquire `SemaphoreSlim`, wait 1100ms (Nominatim 1 req/sec policy)
5. Call `GET https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json`
6. Parse JSON response, extract `display_name`
7. Simplify: split by comma, take first 2-3 meaningful components (skip house numbers, postcodes)
8. Insert `GeoCacheEntity` with rounded coords and simplified place name
9. Return place name
10. On HTTP failure: return `null` (don't block photo upload if Nominatim is down)

**Testing:** 8 unit tests verify:
- Correct place names returned for known coordinates (mock Nominatim JSON)
- Cache hits prevent HTTP requests
- Cache misses trigger HTTP calls and create `GeoCacheEntity`
- Rate limiting via SemaphoreSlim prevents concurrent calls
- Nominatim failures return null without throwing
- Interface compliance
- Coordinate rounding for consistent cache keys

---

## 10. Security Considerations (Phase 3)

### 10.1 Authorization

**Phase 3 Implementation:**
- **IAuthStrategy:** Pluggable interface via DI (AC6.1)
- **SecretTokenAuthStrategy:** Validates `{secretToken}` route parameter against `Trip.SecretToken` (AC5.2, AC2.6)
- **Future swapping:** PIN codes, OAuth, or other strategies without endpoint changes

### 10.2 HTTPS & TLS

ASP.NET Core project created with `--no-https` because Azure App Service terminates TLS. Ensure `X-Forwarded-Proto` header is trusted in production.

### 10.3 EXIF Stripping (Phase 3, Task 3)

**Implementation via SkiaSharp:**
- Decode JPEG with `SKBitmap.Decode(stream)` (reads pixels)
- Re-encode with `SKBitmap.Encode()` as fresh JPEG (no metadata)
- Creates three tiers: original, display, thumbnail
- All tiers have EXIF stripped (AC6.3)

### 10.4 Blob Storage Security (Phase 3, Task 6)

**Private Blob Storage:**
- Azure Blob container `road-trip-photos` created with `PublicAccessType.None`
- Photos are NOT accessible via direct blob URLs (AC6.4)
- All photo access through `GET /api/photos/{tripId}/{photoId}/{size}` endpoint (API proxy)

### 9.4 Client-Side EXIF Extraction (Phase 4, Task 1)

**exifr Library:**
- Downloaded from CDN to `wwwroot/lib/exifr/lite.umd.js` (45KB, UMD bundle)
- Supports in-browser JPEG metadata extraction without server dependency

**exifUtil.js Wrapper** (`wwwroot/js/exifUtil.js`):
```javascript
const ExifUtil = {
    async extractGps(file) {
        const gps = await exifr.gps(file);
        if (!gps) return null;
        return { latitude: gps.latitude, longitude: gps.longitude };
    },
    async extractTimestamp(file) {
        const data = await exifr.parse(file, ['DateTimeOriginal']);
        return data?.DateTimeOriginal || null;
    },
    async extractAll(file) {
        const gps = await this.extractGps(file);
        const timestamp = await this.extractTimestamp(file);
        return { gps, timestamp };
    }
};
```

**Usage (Phase 5, post page):**
- `ExifUtil.extractGps(File)` → `{latitude, longitude}` or `null`
- `ExifUtil.extractTimestamp(File)` → `Date` object or `null`
- `ExifUtil.extractAll(File)` → `{gps: {...}, timestamp: Date}`

**AC2.2 Verification:** GPS coordinates extracted client-side are sent with photo upload and stored in `PhotoEntity.Latitude` and `PhotoEntity.Longitude`.

### 9.5 PostService: Photo Posting Workflow (Phase 5, Task 1)

Pure data/state module with zero DOM references. All business logic designed for reuse in native iOS/Android apps.

**postService.js** (wwwroot/js/postService.js):
```javascript
const PostService = {
    async extractPhotoMetadata(file) {
        // Extracts GPS + timestamp from EXIF, geocodes to place name
        // Returns {gps: {latitude, longitude} | null, timestamp: Date | null, placeName: string | null}
    },
    async uploadPhoto(secretToken, file, lat, lng, caption, takenAt) {
        // FormData upload with optional caption and timestamp
        // Returns PhotoResponse
    },
    async deletePhoto(secretToken, photoId) {
        // Deletes photo from trip
    },
    async listPhotos(secretToken) {
        // Returns array of PhotoResponse objects
    }
};
```

**API Client Extensions** (wwwroot/js/api.js):
- `API.geocode(lat, lng)` — GET /api/geocode, returns `{placeName}`
- `API.uploadPhoto(secretToken, formData)` — POST /api/trips/{secretToken}/photos
- `API.deletePhoto(secretToken, photoId)` — DELETE /api/trips/{secretToken}/photos/{photoId}
- `API.listTripPhotos(secretToken)` — GET /api/trips/{secretToken}/photos (new, Task 3)

**Design Principle:**
- **PostService:** Business logic only (data extraction, API calls, state transformation)
- **postUI.js (Phase 5, Task 2):** DOM rendering only (HTML generation, event binding)
- No circular dependencies; PostService can be used by postUI.js, native apps, or other frontend contexts

**AC2.2 Coverage:**
- `extractPhotoMetadata()` calls `ExifUtil.extractAll()` to get GPS from EXIF
- `uploadPhoto()` sends lat/lng with photo to backend
- Backend stores in PhotoEntity.Latitude, PhotoEntity.Longitude

**AC2.3 Coverage:**
- `extractPhotoMetadata()` auto-geocodes via `API.geocode()` after EXIF extraction
- Returns `placeName` for UI preview before confirming upload

**AC2.4 Coverage:**
- `uploadPhoto()` accepts optional `caption` parameter
- If caption is falsy, FormData does not append it (backend allows null)

### 9.6 PostUI: Photo Posting User Interface (Phase 5, Task 2)

Mobile-first DOM rendering layer with all business logic delegated to PostService.

**post.html** (wwwroot/post.html):
- **Header:** Trip name and description (loaded from page context)
- **Add Photo Button:** Large, prominent button that triggers hidden file input with `capture="environment"` for mobile camera
- **File Input:** `<input type="file" accept="image/*" capture="environment">` — opens camera on mobile, file picker on desktop
- **Preview Section (hidden until photo selected):**
  - Photo thumbnail via `URL.createObjectURL()`
  - Place name display (auto-resolved or "Tap map to set location")
  - Pin-drop fallback map (only shown for photos without GPS EXIF)
  - Optional caption input (optional field)
  - Post and Cancel buttons
- **Posted Photos List:** Thumbnails sorted most-recent-first with caption and place name
- **Toast Container:** Fixed position for success/error notifications (3-second auto-dismiss)
- **Leaflet CDN:** `unpkg.com/leaflet@1.9.4/dist/leaflet.{css,js}` with SRI hashes for pin-drop map

**postUI.js** (wwwroot/js/postUI.js):
- `init(secretToken)` — Wires up event listeners, loads photo list
- `onFileSelected(file)` — Called when file input changes
  - If EXIF GPS present: show full preview directly
  - If no GPS: show pin-drop map for manual location selection
- `showPreview(file, metadata)` — Renders preview section with thumbnail, place name, caption input
- `showPinDropMap(file, metadata)` — Renders map-based location picker
  - Initializes Leaflet map centered on USA
  - Click handler: places marker, geocodes location, updates place name
  - Marker persists until next photo selected
- `onPostConfirm()` — Calls PostService.uploadPhoto(), shows toast, refreshes list
- `loadPhotoList()` — Fetches photos via PostService.listPhotos()
- `createPhotoElement(photo)` — Renders photo card with thumbnail, place, caption, delete button
- `showToast(message, type)` — Displays floating notification with auto-dismiss animation

**CSS Styles** (wwwroot/css/styles.css):
- `.add-photo-button` — Full-width prominent button
- `.photo-thumbnail` — 100% width, max 400px height, aspect-fit
- `.place-name-display` — Light gray background, "no-gps" variant in error red
- `#pinDropMap` — 300px height, 1px border, responsive
- `.caption-input` — Full-width textarea-like input with focus state
- `.photo-grid` — CSS Grid, `minmax(150px, 1fr)` columns, auto-fill
- `.photo-item-*` — Card styling with hover delete button
- `.toast` — Fixed position, slide-in animation, 3-second auto-dismiss
- Responsive: tablets adjust grid to `minmax(180px, 1fr)`, desktop adjusts toast width

**Map Initialization (Leaflet):**
- Called on first pin-drop photo selection
- Sets map bounds to USA center (39.8°N, 98.6°W) at zoom 4
- OpenStreetMap tiles from `tile.openstreetmap.org` (attribution included)
- Click handler creates marker and geocodes via `API.geocode()`
- Marker removed when new photo selected (not persisted between photos)

**AC2.2 Verification:**
- GPS coordinates from EXIF shown in preview before confirming upload
- Sent to backend via PostService.uploadPhoto()

**AC2.3 Verification:**
- Place name auto-resolved from coordinates and displayed in preview section before confirming

**AC2.4 Verification:**
- Caption input is optional (form submits without value)
- Photos post successfully with caption or without

**AC2.9 Verification (Pin-Drop Fallback):**
- Screenshots or edited photos (no GPS EXIF) trigger `showPinDropMap()`
- Small Leaflet map displayed with instruction "Tap map to set your photo location"
- User tap creates marker and geocodes location
- Place name resolved and displayed
- Post succeeds with manual coordinates

---

## 8. Deployment

### 10.1 Build & Publish

```bash
cd projects/road-trip
dotnet publish -c Release -o ./publish
```

Outputs to `publish/` folder for Docker or direct deployment.

### 10.2 App Service Configuration

Must set via Azure Portal or Bicep:
- `ConnectionStrings:DefaultConnection` = Azure SQL connection string

### 10.3 Shared Database Note

Road Trip and Stock Analyzer share the `StockAnalyzer` Azure SQL database. Migrations are run independently but operate on the same SQL instance. The `roadtrip` schema isolation prevents table name conflicts.

---

## 11. Testing Strategy (Phase 2)

### 11.1 Test Project Setup

**RoadTripMap.Tests** (xUnit) with:
- In-memory EF Core context for unit tests
- Moq for service mocking
- FluentAssertions for readable assertions

### 11.2 Test Scope (Phase 2)

- SlugHelper utility functions (15 tests covering generation, uniqueness, truncation, edge cases)
- Trip creation DTOs (structure, required fields)
- API endpoints (integration tests) — coming in Task 2
- Homepage static files — coming in Task 3

Future phases will test:
- Photo upload pipeline
- Authorization logic
- Photo processing and EXIF stripping

---

## 12. Deployment Infrastructure (Phase 8)

### 12.1 Startup Migration

**Program.cs**:
Located in `projects/road-trip/src/RoadTripMap/Program.cs`, the startup migration block runs immediately after `var app = builder.Build();`:
- Creates a service scope to resolve `RoadTripDbContext`
- Calls `db.Database.Migrate()` to apply pending EF Core migrations
- Logs success message; propagates exceptions on failure
- Prevents application startup if migration fails
- Subsequent deployments without new migrations are idempotent (EF Core tracks applied migrations in `__EFMigrationsHistory` table)

**Behavior:**
- On first deployment, creates `roadtrip` schema and all tables (Trips, Photos, GeoCache)
- On subsequent deployments, checks `__EFMigrationsHistory` and applies only new migrations
- If migration fails, application shuts down (prevents silent failures with incomplete schema)

### 12.2 Docker Configuration

**Dockerfile** (`projects/road-trip/Dockerfile`):
- Multi-stage build: SDK 8.0 for compilation → runtime 8.0 for execution
- Restores, builds, and publishes in Release configuration
- Runtime image exposes port 5100
- Sets `ASPNETCORE_URLS=http://+:5100`
- Entrypoint: `dotnet RoadTripMap.dll`

**Build & Run Locally:**
```bash
docker build -t roadtripmap:local .
docker run -p 5100:5100 roadtripmap:local
```

**.dockerignore** — Excludes test projects, markdown docs, build artifacts to keep image lean.

### 12.2 Azure Infrastructure (Bicep)

**main.bicep** (`projects/road-trip/infrastructure/azure/main.bicep`):
- Creates single App Service (`app-roadtripmap-prod`) on existing App Service Plan
- References shared resources:
  - App Service Plan: `asp-stockanalyzer` (existing, via resource ID parameter)
  - SQL Server: shared `StockAnalyzer` database (connection string via parameter)
  - Blob Storage: shared account (connection string via parameter)
- Configures App Service settings:
  - `ASPNETCORE_ENVIRONMENT` = `Production`
  - `WEBSITES_PORT` = `5100`
  - Connection strings injected at deployment time
  - Linux container image from ACR
  - `alwaysOn: true` for production reliability

**parameters.json** (`projects/road-trip/infrastructure/azure/parameters.json`):
- Placeholder template for deployment parameters
- Actual values supplied at deploy time via command line or parameter file
- Includes: appServicePlanResourceId, sqlConnectionString, storageConnectionString, environment

### 12.3 GitHub Actions CI/CD Workflow

**.github/workflows/roadtrip-deploy.yml**:
- **Build & Test Stage:**
  - Checkout, setup .NET 8
  - Restore, build, test on `ubuntu-latest`
  - Requires tests passing before deploying

- **Deploy Stage:**
  - Requires explicit `confirm == "deploy"` input from workflow dispatch
  - Environment protection: `environment: production` (requires approval in GitHub)
  - Login to Azure via OIDC
  - Build Docker image, tag with commit SHA + latest
  - Push to ACR: `acrstockanalyzerer34ug.azurecr.io`
  - Update App Service container image
  - Wait 30s for startup, then health check (5 attempts, 15s apart)
  - Rollback on failed health check (non-zero exit)

**Invocation:**
```bash
gh workflow run roadtrip-deploy.yml -f confirm=deploy
```

### 12.4 Production Startup & Migration

**Program.cs** updates for Phase 8, Task 4:
```csharp
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<RoadTripDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        db.Database.Migrate();
        logger.LogInformation("Database migration completed successfully");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database migration failed");
        throw;
    }
}
```

**Behavior:**
- Runs BEFORE `app.MapStaticFiles()` so migrations complete before handling requests
- Applies all pending migrations in order (idempotent; re-running same migration is no-op)
- Creates `roadtrip` schema and tables on first deployment
- Subsequent deployments without new migrations skip EF Core versioning checks
- Logs results; propagates exceptions to prevent startup if migration fails
- Covers AC3 (trips), AC4 (photos), AC5 (geocache)

---

## 13. Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.4 | 2026-03-20 | Code Review Fixes (All Issues): Critical #1 - Route ambiguity: token-based GET photos moved to /api/post/{secretToken}/photos (distinct from slug-based). Critical #2 - Original tier no longer resized/lossy: quality 100 at original dimensions, display/thumb tiers still sized (1920px, 300px). Critical #3 - Photo upload error handling: wrapped ProcessAndUploadAsync in try/catch, deletes orphaned DB record if blob upload fails. Important #1 - Real HttpContext: auth endpoints now pass actual context instead of synthetic DefaultHttpContext. Important #2 - EXIF rotation: ApplyExifRotation documented (re-encoding strips EXIF, portrait handling via quality 100 preservation). Important #3 - Rate limiting refactor: extracted INominatimRateLimiter as singleton, eliminates static/scoped tension. Important #5 - Event parameter: copyToClipboard now receives event explicitly. Minor #1 - Build warnings: Fixed CS1998 (removed async from non-awaiting tests), CS8618 (made fields nullable), xUnit1031 (async task test, Task.WaitAll → Task.WhenAll). Minor #2 - Template: deleted UnitTest1.cs. Minor #3 - XSS: escapeHtml() sanitizes caption/placeName in mapUI.js popups. All 106 tests passing, build 0 warnings/errors. |
| 2.3 | 2026-03-20 | Phase 8, Tasks 1-4: Docker (multi-stage .NET 8 build, port 5100, SkiaSharp Linux assets included), Bicep template (App Service on shared plan, SQL + Blob connection strings, Linux container config), GitHub Actions workflow (build+test → deploy on "deploy" confirm, ACR push, health check), startup migration (auto-migrate on app boot). No Docker/Bicep/workflow verification run per task instructions. All prior tests (81) passing. Ready for deploy approval. |
| 2.2 | 2026-03-20 | Phase 6, Task 3: Added responsive map view styling. Full-viewport map container (100vh), floating semi-transparent header with trip name (top), floating route toggle button (bottom-right), empty message overlay (center). Leaflet popup customization for images, headings, links. Mobile-first responsive design: mobile (< 480px) compact header/button, tablet (≥ 768px) larger, desktop (≥ 1024px) larger header. All controls accessible and readable at all viewport sizes. Build succeeds. All 81 tests passing. Covers AC3.1-AC3.7 (map view acceptance criteria). |
| 2.1 | 2026-03-20 | Phase 6, Task 2: Created map view frontend. MapService.js pure data layer (loadTrip, getRouteCoordinates) with zero DOM/Leaflet refs for native portability. MapUI.js Leaflet-specific rendering with marker popups, route toggle, auto-fit bounds. trips.html full-viewport map page with Leaflet CDN (SRI hashes). GET /trips/{slug} route serves trips.html. Features: photo pins at GPS coords, clickable popups with display image/place/caption/timestamp, route polyline toggle connecting pins chronologically, auto-fit bounds with padding, single-pin centering (zoom 13), empty message for zero photos. Covers AC3.1-AC3.7. Build succeeds. All 81 tests passing. |
| 2.0 | 2026-03-20 | Phase 6, Task 1: Added public trip info and photos endpoints. Created TripResponse DTO. Implemented GET /api/trips/{slug} (public trip metadata with photo count). Implemented GET /api/trips/{slug}/photos (public photo array ordered by TakenAt ascending for route line). Both endpoints require no authentication (AC5.1). Empty photo array returned for trips with no photos (AC3.6). 9 unit tests verify behavior. All 81 tests passing. Covers AC3.1, AC3.6, AC5.1. |
| 1.9 | 2026-03-20 | Phase 5, Task 2: Created post.html (mobile-first photo posting page) and postUI.js (DOM rendering layer). Features: file input with camera capture, EXIF preview, place name display, pin-drop fallback map for photos without GPS, optional caption input, photo list with delete buttons, toast notifications. Leaflet CDN for map component. Updated styles.css with post page component styles (photo grid, toast animations, responsive). Added GET /post/{secretToken} route in Program.cs. Covers AC2.2 (GPS display), AC2.3 (place name preview), AC2.4 (optional caption), AC2.9 (pin-drop fallback). Build succeeds. |
| 1.8 | 2026-03-20 | Phase 5, Task 1: Created postService.js pure data/state module with zero DOM references. Implements extractPhotoMetadata() (EXIF + auto-geocoding), uploadPhoto() (FormData with optional caption/timestamp), deletePhoto(), and listPhotos(). Extended api.js with geocode(), uploadPhoto(), deletePhoto(), listTripPhotos() methods. All methods designed for native app reuse. Covers AC2.2 (GPS extraction), AC2.3 (place name resolution), AC2.4 (optional caption). |
| 1.7 | 2026-03-20 | Phase 5, Task 3: Added GET /api/trips/{secretToken}/photos endpoint for post page photo list. Returns array of PhotoResponse objects ordered by CreatedAt descending. Returns 404 if trip not found. 5 unit tests verify valid token returns photos, empty trip returns empty array, invalid token returns not found, and photos ordered correctly. Tests pass 72/72. |
| 1.6 | 2026-03-20 | Phase 4, Task 3: Added GET /api/geocode endpoint for reverse geocoding preview. Updated POST /api/trips/{secretToken}/photos to call IGeocodingService after upload. Photos with lat=0, lng=0 get PlaceName="Location not set" (AC2.9). Photos with valid coords get place name from Nominatim or "Unknown location" on failure. Registered geocoding service in Program.cs. 5 unit tests verify endpoint behavior and photo place name assignment. |
| 1.5 | 2026-03-20 | Phase 4, Task 1: exifr library (45KB UMD) downloaded to wwwroot/lib/exifr/lite.umd.js. Created exifUtil.js wrapper with extractGps, extractTimestamp, extractAll methods for client-side EXIF extraction. Supports AC2.2 GPS coordinate extraction from uploaded photos. |
| 1.4 | 2026-03-20 | Phase 3, Tasks 1-2: NuGet packages for image processing (SkiaSharp 3.119.2) and Azure Blob Storage (Azure.Storage.Blobs 12.27.0). IAuthStrategy interface and SecretTokenAuthStrategy implementation with DI registration. 6 unit tests verify secret token validation, error handling, and interface compliance. Pluggable auth design supports future strategy swapping without code changes. |
| 1.3 | 2026-03-20 | Phase 2, Task 3: Landing page (index.html), trip creation form (create.html), mobile-first CSS (styles.css), and API client (api.js). All static files served from wwwroot with responsive design and copy-to-clipboard functionality. |
| 1.2 | 2026-03-20 | Phase 2, Task 2: POST /api/trips endpoint with validation, slug generation, token creation, and full test coverage (7 tests). |
| 1.1 | 2026-03-20 | Phase 2, Task 1: SlugHelper utility class and trip creation DTOs (CreateTripRequest, CreateTripResponse) with comprehensive test coverage (15 tests). |
| 1.0 | 2026-03-19 | Phase 1 infrastructure: project scaffold, entity model, EF Core context, initial migration. |
