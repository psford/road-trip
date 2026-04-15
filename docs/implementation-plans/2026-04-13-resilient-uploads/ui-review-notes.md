# UI Review Notes — Resilient Uploads Phase 3

## Approved on 2026-04-15 by Patrick

### Progress Panel
- Collapsible panel with header showing count and toggle arrow
- Per-file rows: icon + filename + size + status/progress bar
- States: Queued (◻), Uploading (▶ with progress bar), Committed (✓), Failed (✕)
- Collapse state persists in sessionStorage per trip

### Failed Row
- Shows "gave up after 6 attempts" when retry exhausted
- Action buttons: [↻ Retry] (if retryable), [📍 Pin manually] (if GPS), [✕ Discard]

### Resume Banner
- "⚠ N uploads paused — [Resume] [Discard all]"
- Appears on trip load with non-terminal IndexedDB items
- Auto-dismisses when count reaches 0

### Optimistic Map Pins
- Pending: blue pulsing dot at GPS coords (~1s after request-upload)
- Committed: normal photo pin with thumbnail
- Failed: red dot; tap popup with retry/discard/pin-drop
- No GPS: no pin (AC7.4)

### Change Requests
None.
