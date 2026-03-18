# System Architecture

## Overview

`sbotify` is a single-user music control system built around one shared daemon per device.

1. Coding agents connect through MCP.
2. The daemon owns playback, queue state, listening history, and the browser dashboard.
3. `mpv` handles audio playback; SQLite stores durable history and persona text.

```
Agent / MCP Client
  -> stdio proxy or HTTP MCP client
  -> sbotify daemon
     -> MCP tools
     -> queue + playback controller
     -> taste engine
     -> history store (SQLite)
     -> web dashboard (:3737)
     -> mpv
```

## Runtime Topology

### Proxy Mode

- `sbotify` without args starts the lightweight stdio proxy.
- The proxy auto-starts the daemon when needed.
- The proxy does not own queue, mpv, or database state.

### Daemon Mode

- `sbotify --daemon` starts the long-lived process.
- The daemon exposes:
  - `/mcp` on the daemon port for MCP traffic
  - `/health` for readiness checks
  - `/shutdown` for graceful stop
  - the dashboard on `http://127.0.0.1:3737` by default, with fallback through the next 9 ports if needed
- One daemon means one shared queue, one shared history DB, and one shared `mpv` process.

## Core Components

### History Store

File: `src/history/history-store.ts`

Responsibilities:

- Persist tracks and play events in SQLite
- Persist free-text persona taste in `session_state.persona_taste_text`
- Expose aggregate history queries for the taste engine and MCP tools
- Keep backward-compatible legacy session columns without using them in the new state model

Tables:

- `tracks`
- `plays`
- `preferences` (legacy, still present)
- `session_state`
- `provider_cache`

Important notes:

- `normalizeTrackId(artist, title)` is the canonical identity key.
- The constructor now performs a runtime migration to add `persona_taste_text` when an older DB is opened.

### Taste Engine

File: `src/taste/taste-engine.ts`

The redesign replaced the older weighted taste model with a smaller agent-first contract:

```ts
{
  context: { hour, period, dayOfWeek },
  persona: {
    traits: { exploration, variety, loyalty },
    taste: string
  },
  history: {
    recent: [...],
    stats: { topArtists, topTags }
  }
}
```

Behavior:

- `exploration`: derived from recent artists with low historical play counts
- `variety`: normalized tag entropy across recent plays
- `loyalty`: ratio of replayed high-completion tracks
- `taste`: editable free-text description stored in SQLite

Important constraints:

- Traits default to `0.5` when history is too small.
- Traits are computed on demand; there is no incremental scoring loop.
- Older structured persona/session objects are no longer part of the active runtime contract.

### Discovery Pipeline

File: `src/taste/candidate-generator.ts`

`discover()` is now a grouped-candidate API, not a server-side scoring API.

Returned lanes:

- `continuation`
- `comfort`
- `contextFit`
- `wildcard`

Behavior:

- The server guarantees candidate diversity by lane.
- The agent decides what to play from raw candidates plus `get_session_state()`.
- There is no server-side ranking module in the active codepath.
- `mode` still changes per-lane ratios.
- `intent.allowed_tags` and `intent.avoid_tags` still shape results.

### MCP Surface

Files:

- `src/mcp/mcp-server.ts`
- `src/mcp/tool-handlers.ts`

State-related tools:

- `get_session_state()`
  - returns `context`, `persona`, and `history`
- `discover(mode?, intent?)`
  - returns grouped candidates and `more_available: true`
- `update_persona({ taste })`
  - persists free-text taste text
  - empty string is allowed to clear the value

Playback tools remain queue-first:

- `play_song`
- `add_song`
- `skip`
- `queue_list`
- `now_playing`
- `volume`
- `history`

### Queue and Playback

Files:

- `src/queue/queue-manager.ts`
- `src/queue/queue-playback-controller.ts`
- `src/audio/mpv-controller.ts`

Behavior:

- `QueueManager` owns now playing, queued items, and playback history.
- `QueuePlaybackController` resolves audio, records plays, updates completion/skip status, and advances the queue.
- Track feedback is stored as raw history updates only.
- Playback feedback now stays in raw history rows; there is no secondary taste update loop.
- Apple genre enrichment still runs after playback starts and updates track tags asynchronously.

### Web Dashboard

Files:

- `src/web/web-server.ts`
- `src/web/state-broadcaster.ts`
- `public/index.html`
- `public/app.js`
- `public/style.css`

Endpoints:

- `GET /api/status`
- `GET /api/persona`
- `POST /api/persona`
- `POST /api/volume`
- `WS /ws`

Dashboard features:

- now-playing state
- queue preview
- volume + mute controls
- persona textarea
- read-only trait bars

Important notes:

- The dashboard no longer renders context badges.
- Persona changes can arrive through HTTP or WebSocket and are broadcast to connected clients.

## Main Flows

### Read Session State

1. Agent calls `get_session_state()`.
2. The taste engine reads recent history and aggregate stats from SQLite.
3. The tool returns time context, computed traits, stored taste text, recent plays, top artists, and top tags.

### Discover Music

1. Agent optionally calls `get_session_state()` first.
2. Agent calls `discover(mode?, intent?)`.
3. `CandidateGenerator` builds grouped candidates from current track, history, and optional tags.
4. The server returns grouped candidates without ranking them.
5. Agent chooses a track and calls `add_song()` or `play_song()`.

### Update Persona

1. Agent calls `update_persona({ taste })` or the dashboard posts `/api/persona`.
2. The taste engine writes the value to `session_state.persona_taste_text`.
3. Updated traits + taste are broadcast to dashboard clients.

### Playback Feedback

1. Queue playback starts and `recordPlay()` inserts a play row.
2. On skip or finish, `updatePlay()` records `played_sec` and `skipped`.
3. Future `get_session_state()` and `discover()` calls read from that raw history.

## Build and Validation

- `npm run build` cleans `dist/` before compiling so deleted test files do not leak into later runs.
- `npm test` currently validates:
  - history store behavior
  - queue behavior
  - resolver/provider behavior
  - candidate generation
  - taste engine redesign

Last verified:

- `2026-03-18`
- `npm test`: 77 passed, 0 failed

## Design Rules

- Never write to stdout from server internals; MCP stdio must stay clean.
- Keep queue state authoritative in one place.
- Prefer raw data plus agent reasoning over server-side taste prediction.
- Keep legacy DB columns only for compatibility, not as active state.
