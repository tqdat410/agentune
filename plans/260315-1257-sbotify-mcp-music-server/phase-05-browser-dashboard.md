# Phase 5: Browser Dashboard

## Context
- [plan.md](plan.md)

## Overview
- **Priority**: P1
- **Status**: complete
- **Description**: Build a minimal browser dashboard (localhost:3737) showing now-playing info + volume slider. No audio playback in browser — display only. WebSocket for real-time state sync.

## Requirements
- Functional: Show song title, artist, progress bar, album art, volume slider, mute toggle
- Non-functional: Auto-opens in browser on first play, responsive, dark theme, no framework (vanilla HTML/CSS/JS)

## Related Code Files
### Create
- `src/web/web-server.ts` — HTTP static file server + WebSocket server
- `src/web/state-broadcaster.ts` — broadcasts playback state to all connected clients
- `src/web/web-server-helpers.ts` — shared HTTP/static/open helpers
- `public/index.html` — dashboard layout
- `public/style.css` — dark theme styles
- `public/app.js` — WebSocket client, DOM updates, volume control

## Architecture
```
MpvController (state changes)
    ↓ events
StateBroadcaster
    ↓ WebSocket
Browser tab (localhost:3737)
    ├── Display: title, artist, thumbnail, progress bar
    ├── Controls: volume slider → WebSocket → MCP server → mpv
    └── Read-only: queue list, current mood
```

### WebSocket Messages

**Server → Client (state updates):**
```json
{
  "type": "state",
  "data": {
    "playing": true,
    "title": "Song Name",
    "artist": "Artist",
    "thumbnail": "https://...",
    "position": 145,
    "duration": 240,
    "volume": 70,
    "muted": false,
    "queue": [{ "title": "...", "artist": "..." }],
    "mood": "focus"
  }
}
```

**Client → Server (user commands):**
```json
{ "type": "volume", "level": 50 }
{ "type": "mute" }
```

## Implementation Steps

### 1. Create HTTP server (`src/web/web-server.ts`)
- Serve `public/` directory on localhost:3737
- Use Node.js built-in `http` + `fs` (no Express needed)
- MIME type handling for .html, .css, .js

### 2. Create WebSocket server
- Use `ws` package on same port (upgrade handler)
- Track connected clients
- Broadcast state on every mpv property change

### 3. Create StateBroadcaster (`src/web/state-broadcaster.ts`)
- Listen to MpvController events (position, pause, volume, track change)
- Throttle position updates to 1/second (avoid flooding)
- Broadcast to all connected WebSocket clients

### 4. Handle client commands
- `volume` → `MpvController.setVolume()`
- `mute` → `MpvController.toggleMute()`
- Ignore any other commands (agent controls playback, not user)

### 5. Build dashboard UI (`public/`)
- Dark theme, minimal, Spotify-inspired layout
- Album art (large thumbnail from YouTube)
- Song title + artist
- Progress bar (updates every second via WebSocket)
- Volume slider (sends WebSocket message on change)
- Mute toggle button
- Queue list (read-only)
- Current mood badge (if mood mode active)
- No play/pause/skip buttons — agent controls those

### 6. Auto-open browser
- On first `play` command, open `http://localhost:3737` in default browser
- Use `open` package or `child_process.exec` with platform-specific command
- Only open once per session
- If no fallback port can be bound, skip auto-open cleanly and log the reason

## Todo
- [x] Create `src/web/web-server.ts` (HTTP + static files)
- [x] Add WebSocket server with `ws` package
- [x] Create `src/web/state-broadcaster.ts`
- [x] Wire StateBroadcaster to MpvController events
- [x] Handle volume/mute client commands
- [x] Build `public/index.html` layout
- [x] Style with `public/style.css` (dark theme)
- [x] Implement `public/app.js` WebSocket client
- [x] Auto-open browser on first play
- [x] Test real-time state sync

## Success Criteria
- [x] Dashboard shows correct now-playing info in real-time
- [x] Volume slider controls mpv volume when mpv is available
- [x] Progress bar updates every second
- [x] Multiple browser tabs stay in sync
- [x] Dashboard works without audio (display-only, returns 503 for volume API if mpv unavailable)
- [x] Dark theme, looks good

## Risk Assessment
- Low risk. Standard HTTP + WebSocket.
- **Handled**: Port 3737 fallback detection implemented across `3737-3746`.
- **Deferred**: Queue and mood data are placeholder values until Phases 6 and 7 land.

## Next Steps
→ Phase 6: Mood Mode
→ Phase 7: Queue + Polish + Publish
