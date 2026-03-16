# Project Changelog

## 2026-03-16 (Continued)

### Phase 4: Taste Intelligence + Session Lanes
- Added `src/taste/taste-engine.ts` — TasteEngine class with taste state, agent persona, and session lanes
  - Taste state: obsessions (artist/tag affinity 0-1), boredom (fatigue 0-1), cravings (active tag interests), noveltyAppetite, repeatTolerance
  - Agent persona: curiosity, dramaticTransition, callbackLove, antiMonotony (evolved separately from user prefs)
  - Session lanes: groups 2-5 songs by tag overlap (30% threshold); pivots on mood shift
  - Time-based decay: `value * 0.95^hours` for natural preference evolution
  - Implicit feedback processing: skip ratio + completion rate → obsession/boredom adjustments
- Added new MCP tool `get_session_state` to `src/mcp/mcp-server.ts` — returns taste profile + persona + current lane + recent plays
- Integrated feedback wiring into `src/queue/queue-playback-controller.ts` — calls `taste.processFeedback()` on skip and natural finish events
- Extended `src/history/history-store.ts` with `getTrackTags()` method to support tag-level feedback from Last.fm cache
- All state persisted to `session_state` table in SQLite (non-blocking)
- Added `src/taste/taste-engine.test.ts` with unit tests for taste state transitions
- All 60+ unit tests passing; build clean; zero new external dependencies

### Phase 3: Last.fm Provider + Cache
- Added `src/providers/lastfm-provider.ts` — Last.fm API client with 7-day SQLite cache
  - 4 endpoints: `getSimilarArtists(artist, limit?)`, `getSimilarTracks(artist, track, limit?)`, `getTopTags(artist, track?)`, `getTopTracksByTag(tag, limit?)`
  - Cache eviction on startup: deletes expired rows with 7-day TTL
  - YouTube metadata normalization: `normalizeForQuery()` strips official/lyric/live/ft. suffixes before querying Last.fm
  - Graceful degradation: returns empty arrays if API call fails or times out (5s timeout)
  - Singleton pattern: `createLastFmProvider(apiKey, db)` + `getLastFmProvider()`
- Extended `src/history/history-store.ts` with two new methods:
  - `getDatabase(): Database.Database` — Direct DB access for external providers (e.g., Last.fm)
  - `updateTrackTags(trackId: string, tags: string[]): void` — Store Last.fm tags in track record
- Updated `src/queue/queue-playback-controller.ts` — Async tag enrichment on every play (fire-and-forget)
  - After playback starts, fetches `getTopTags()` from Last.fm provider and stores in history DB
  - Does not block audio playback; runs in background
- Updated `src/index.ts` — Optional Last.fm provider init gated by `LASTFM_API_KEY` env var
  - Non-fatal: provider gracefully disabled if env var missing or API key invalid
- All 60+ unit tests passing; build clean; no new external dependencies (Last.fm API is free, no auth)

## 2026-03-16

### Phase 2: Smart Play (play_song + Search Result Scorer)
- Added `src/providers/search-result-scorer.ts` — fuzzy-match scoring module for YouTube search results
  - Scores titles, artists, duration, and applies quality penalties (live, remix, slowed, 8d) and bonuses (official audio, topic/auto-generated)
  - Returns scored results sorted by confidence (0–2 scale)
  - Strips quality suffixes and normalizes for robust comparison
- Added new MCP tool `play_song(title, artist?)` to `src/mcp/mcp-server.ts` and `handlePlaySong` to `src/mcp/tool-handlers.ts`
  - Primary query: `"{artist} - {title} official audio"` (searches 10 results)
  - Fallback query: `"{artist} {title}"` if top score below 0.2 minimum
  - Returns `{matched, nowPlaying, matchScore, matchReasons, alternatives}` for transparency
  - Uses canonical artist/title overrides to ensure accurate history recording
- Updated `queue_add` tool to accept optional `id` parameter for direct video ID queuing (alongside existing `query` parameter)
- Updated `YouTube` search default limit from 5 to 10 when used in play_song flow for better match options
- Extended `playById` in queue-playback-controller to accept optional `canonicalArtist` and `canonicalTitle` for override history recording
- All 60 unit tests passing; build clean; no new dependencies added

## 2026-03-15

### Phase 1+: SQLite History Foundation
- Added `src/history/history-store.ts` with `HistoryStore` class backed by better-sqlite3; singleton pattern via `createHistoryStore()` and `getHistoryStore()`
- Added `src/history/history-schema.ts` with SQLite table definitions (tracks, plays, preferences, session_state, lastfm_cache) and `normalizeTrackId()` for consistent track dedup
- Database location: `~/.sbotify/history.db` (configurable via `SBOTIFY_DATA_DIR` env var); auto-created on first run with WAL mode for concurrent safety
- Added MCP tool `history` to `src/mcp/mcp-server.ts` — enables agent to query recent plays with play counts and skip rates
- Integrated history recording into `src/queue/queue-playback-controller.ts` — `recordPlay()` called when track starts, `updatePlay()` called on finish/skip
- Updated `src/index.ts` to initialize history store on startup (non-fatal) and close DB gracefully on shutdown
- Added `src/history/history-store.test.ts` with unit tests for recordPlay, updatePlay, getRecent, getTrackStats
- New dependency: better-sqlite3 v12.8.0 (+ @types/better-sqlite3 dev dependency)
- Backward compatible with existing queue/MCP workflow; history persistence is a new feature layer

## Earlier Updates (Phase 7 and prior)

### Phase 7: Queue + Polish
- Replaced the queue placeholder with a real `QueueManager` in `src/queue/queue-manager.ts` that tracks now playing, upcoming queue, and playback history.
- Added `src/queue/queue-playback-controller.ts` to coordinate queue advancement, manual skip, YouTube stream resolution, and mpv playback without duplicating tool logic.
- Updated `src/mcp/tool-handlers.ts`, `src/index.ts`, and `src/audio/mpv-controller.ts` so `queue_add`, `queue_list`, `skip`, graceful shutdown, and natural track-end auto-advance all run through the same playback path.
- Updated `src/web/state-broadcaster.ts` and `src/web/web-server.ts` so the browser dashboard receives live queue state instead of placeholder data.
- Hardened `src/providers/youtube-provider.ts` with a retry path for transient `yt-dlp` extraction failures.
- Added `src/queue/queue-manager.test.ts`, `src/queue/queue-playback-controller.test.ts`, `.npmignore`, and the `npm test` script for Phase 7 verification and release prep.
- Updated README, roadmap, architecture docs, and plan files to mark MVP feature work complete while explicitly deferring the actual npm publish step.

### Phase 6: Mood Mode
- Replaced the mood stub in `src/mood/mood-presets.ts` with 5 curated mood pools and random query selection helpers.
- Wired `play_mood` in `src/mcp/tool-handlers.ts` to normalize user mood input, select a curated search query, search YouTube, and reuse the existing playback flow.
- Updated `src/mcp/mcp-server.ts` to accept case-insensitive mood input at the tool boundary instead of rejecting non-lowercase variants.
- Extended `src/audio/mpv-controller.ts` and `src/web/state-broadcaster.ts` so active mood metadata flows into dashboard state.

### Phase 5: Browser Dashboard
- Added `src/web/web-server.ts` with static file serving, `/api/status`, `/api/volume`, WebSocket upgrade handling, and one-time browser auto-open on first successful play.
- Added `src/web/state-broadcaster.ts` and `src/web/web-server-helpers.ts` to push 1-second playback snapshots and keep the HTTP/WebSocket layer modular.
- Extended `src/audio/mpv-controller.ts` with state-change events, mute tracking, and a readable state snapshot for the dashboard.
- Updated `src/index.ts` and `src/mcp/tool-handlers.ts` to initialize the dashboard with the mpv controller and open the browser on first play.
- Replaced placeholder dashboard assets in `public/index.html`, `public/style.css`, and `public/app.js` with a responsive dark UI, reconnecting WebSocket client, progress bar, volume slider, and mute toggle.
- Hardened degraded-mode behavior so `/api/volume` returns `503` instead of crashing when mpv is unavailable, while `/api/status` and WebSocket state remain available.
- Added a Phase 5 journal entry in `docs/journals/2026-03-15-phase-05-browser-dashboard.md`.

### Validation
- `npm test`
- `npm run build`
- Queue manager unit tests
- Queue playback controller unit tests
- Local queue broadcaster smoke: queue + mood appear in dashboard state snapshot
- Local mood helper smoke: normalization, query pool size, random query selection
- Local handler smoke: invalid mood returns MCP error result
- Local broadcaster smoke: mood metadata appears in dashboard state
- Smoke test: `GET /`
- Smoke test: `GET /api/status`
- Smoke test: `WS /ws` initial state message
- Smoke test: `POST /api/volume` returns safe `503` when mpv is unavailable
