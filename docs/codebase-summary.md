# Codebase Summary

## Current Implementation

`sbotify` is a shared local daemon for agent-controlled music playback.

- Agents talk to the daemon through MCP.
- The daemon owns queue state, playback, listening history, and the browser dashboard.
- `mpv` handles audio output.
- SQLite stores tracks, play events, provider cache data, and persisted persona taste text.

The active state redesign is agent-first:

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

`discover()` now returns grouped candidates from four lanes. The server does not rank them before returning them; the agent chooses what to play from raw grouped suggestions plus `get_session_state()`.

## Project Structure

```text
sbotify/
├── src/
│   ├── index.ts
│   ├── audio/
│   │   ├── mpv-controller.ts
│   │   └── platform-ipc-path.ts
│   ├── cli/
│   │   ├── status-command.ts
│   │   └── stop-command.ts
│   ├── daemon/
│   │   ├── daemon-server.ts
│   │   ├── health-endpoint.ts
│   │   └── pid-manager.ts
│   ├── history/
│   │   ├── history-schema.ts
│   │   ├── history-store.ts
│   │   ├── history-store-state-redesign.test.ts
│   │   └── history-store.test.ts
│   ├── mcp/
│   │   ├── mcp-server.ts
│   │   ├── song-resolver.ts
│   │   └── tool-handlers.ts
│   ├── providers/
│   │   ├── apple-search-provider.ts
│   │   ├── metadata-normalizer.ts
│   │   ├── search-result-scorer.ts
│   │   ├── smart-search-provider.ts
│   │   └── youtube-provider.ts
│   ├── proxy/
│   │   ├── daemon-launcher.ts
│   │   └── stdio-proxy.ts
│   ├── queue/
│   │   ├── queue-manager.ts
│   │   └── queue-playback-controller.ts
│   ├── taste/
│   │   ├── candidate-generator.ts
│   │   ├── candidate-generator.test.ts
│   │   ├── taste-engine.ts
│   │   └── taste-engine.test.ts
│   ├── types/
│   │   └── node-mpv.d.ts
│   └── web/
│       ├── state-broadcaster.ts
│       ├── web-server-helpers.ts
│       └── web-server.ts
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── docs/
├── package.json
├── README.md
└── repomix-output.xml
```

## State Redesign

### History Store

Files:

- `src/history/history-schema.ts`
- `src/history/history-store.ts`

Current responsibilities:

- persist `tracks`, `plays`, `provider_cache`, and `session_state`
- store free-text persona taste in `session_state.persona_taste_text`
- keep older `lane_json`, `taste_state_json`, `agent_persona_json`, and `current_intent_json` columns for compatibility
- expose aggregate queries used by the taste engine:
  - `getRecentPlaysDetailed()`
  - `getTopArtists()`
  - `getTopTags()`
  - `getTrackPlayCount()`

Important details:

- `normalizeTrackId(artist, title)` is the canonical track key.
- The constructor performs a runtime migration to add `persona_taste_text` when an older database is opened.
- `preferences` still exists in schema, but it is not the active persona model.

### Taste Engine

File: `src/taste/taste-engine.ts`

Current responsibilities:

- compute the three behavioral traits on demand
- expose current time context
- read and persist free-text taste text
- package the agent-facing session summary for MCP and the dashboard

Traits:

- `exploration`: recent unique artists with low historical play counts
- `variety`: normalized Shannon entropy of recent tags
- `loyalty`: replayed high-completion tracks in recent history

Important details:

- Traits default to `0.5` until there are at least 10 recent plays.
- The engine does not run a feedback scoring loop.
- There is no active weighted taste runtime outside the returned summary.

### Discovery

File: `src/taste/candidate-generator.ts`

Current responsibilities:

- generate grouped candidates for `discover()`
- deduplicate repeated artist/title pairs
- trim each lane using the selected mode ratio
- apply `allowed_tags` and `avoid_tags`

Current lanes:

- `continuation`: current-artist catalog plus Smart Search fallback
- `comfort`: top local tracks from history
- `contextFit`: Apple genre/search plus Smart Search tag fallback
- `wildcard`: artist expansion for new discoveries

Modes:

- `focus`: `50 / 30 / 15 / 5`
- `balanced`: `40 / 30 / 20 / 10`
- `explore`: `20 / 15 / 30 / 35`

Important details:

- The handler returns grouped lanes, not scored candidates.
- `contextFit` falls back to recent history tags when no `intent.allowed_tags` are supplied.
- Each candidate carries a `sourceDetail` string to explain where it came from.

## MCP Surface

Files:

- `src/mcp/mcp-server.ts`
- `src/mcp/tool-handlers.ts`

State-related MCP tools:

- `get_session_state()`
  - returns `context`, `persona`, and `history`
- `discover(mode?, intent?)`
  - returns grouped candidates under `continuation`, `comfort`, `contextFit`, and `wildcard`
- `update_persona({ taste })`
  - persists free-text taste text
  - empty string is allowed to clear it

Playback-related MCP tools:

- `play_song(title, artist?)`
- `add_song(title, artist?)`
- `pause()`
- `resume()`
- `skip()`
- `queue_list()`
- `now_playing()`
- `volume(level?)`
- `history(limit?, query?)`

Important details:

- `play_song` and `add_song` are Apple-first for canonical metadata.
- `discover()` returns grouped raw candidates plus a tip to call `add_song()` or `play_song()`.
- `get_session_state()` and `update_persona()` are the state entry points; there is no public ranking API.

## Queue and Playback

Files:

- `src/queue/queue-manager.ts`
- `src/queue/queue-playback-controller.ts`
- `src/audio/mpv-controller.ts`

Current responsibilities:

- `QueueManager` owns `nowPlaying`, queued items, and playback history.
- `QueuePlaybackController` resolves audio, starts playback, records plays, updates skip/completion status, and advances the queue.
- `MpvController` owns the actual audio engine and emits playback state.

Important details:

- Raw history is recorded with `recordPlay()` on start and `updatePlay()` on skip/finish.
- Playback feedback remains as raw history rows; there is no secondary taste-update path.
- The controller still enriches track tags from Apple after playback begins.
- The next queued track can be prefetched for smoother transitions.

## Web Dashboard

Files:

- `src/web/web-server.ts`
- `src/web/state-broadcaster.ts`
- `src/web/web-server-helpers.ts`
- `public/index.html`
- `public/app.js`
- `public/style.css`

Current HTTP and WebSocket surface:

- `GET /api/status`
- `GET /api/persona`
- `POST /api/persona`
- `POST /api/volume`
- `WS /ws`

Current behavior:

- `StateBroadcaster` publishes playback snapshots: playing, title, artist, thumbnail, position, duration, volume, muted, queue.
- Persona data is fetched separately from `/api/persona`.
- Persona changes are broadcast separately over WebSocket as `{ type: "persona", data: { traits, taste } }`.
- The dashboard includes:
  - now-playing card
  - queue preview
  - volume and mute controls
  - persona textarea
  - read-only trait bars

Important details:

- The old dashboard context badge is gone.
- `public/app.js` loads initial playback and persona state with HTTP, then listens for live `state` and `persona` messages.

## Tests and Validation

Current state-redesign coverage lives in:

- `src/history/history-store-state-redesign.test.ts`
- `src/taste/taste-engine.test.ts`
- `src/taste/candidate-generator.test.ts`

`package.json` currently defines:

```json
"test": "npm run build && node --test dist/**/*.test.js"
```

That means every test run compiles first, then runs the built Node test suite from `dist/`.

## Not Current Anymore

These are no longer current behavior:

- server-side candidate ranking
- scored `discover()` responses
- the older weighted taste runtime
- lane-based state summaries
- dashboard context badges

Historical changelog entries may still mention those older designs, but the active implementation does not.
