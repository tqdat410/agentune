# Project Roadmap

## Current State

`agentune` is functionally in MVP-complete territory for local agent-controlled playback:

- daemon + proxy architecture: complete
- queue-based playback: complete
- browser dashboard redesign: complete
- Apple-first resolution flow: complete
- flat Apple-only discover rewrite: implemented
- agent-first state redesign: complete
- config-driven discover ranking: complete
- agent-facing discover guidance cleanup: complete
- explicit daemon lifecycle + dashboard stop: complete
- optional daemon auto-start + manual `agentune start`: complete
- web/dashboard hardening + safer daemon stop: complete
- discover rewrite automated validation: complete
- local-gated npm release workflow: complete
- daemon/MCP end-to-end smoke record: pending

Last validated:

- `2026-03-21`
- `npm run build`: passed
- `npm test`: 114 passed, 0 failed
- `npm run verify:publish`: passed
- built-handler smoke: `discover({ artist: "Nils Frahm", limit: 1 })` returned a paginated Apple candidate

## Completed Milestones

### Foundation

- TypeScript/Node runtime and CLI packaging
- `mpv` playback integration
- YouTube search and stream resolution
- SQLite history store

### Agent Control Surface

- MCP tools for playback, queue inspection, volume, and history
- Apple-first `play_song` / `add_song` resolution flow
- shared daemon so multiple agent sessions see the same queue and history

### Dashboard

- live playback state
- artwork-first player shell with full-screen `Queue / Now Playing / Settings` tabs
- read-only queue view
- pause, next, and volume controls
- minimal dashboard insights in `Settings`
- persona taste editor
- `/api/persona`, `/api/artwork`, and WebSocket sync

### State Redesign

- removed scorer-driven taste loop from active runtime
- replaced old taste state with:
  - `context`
  - `persona` (`Preferences`)
  - `history`
- moved discover reranking weights into runtime config
- replaced grouped discover lanes with flat paginated Apple-only discover output
- added soft ranking from fixed config weights + history plus snapshot pagination cache
- renamed agent-facing discover seeds/results from `genres`/`tags` to `keywords`
- added `nextGuide` so the agent knows whether to paginate or improve input
- kept `mode` / `intent` accepted but ignored for one compatibility cycle
- added `update_persona`

## Active Focus

### 1. End-to-End Smoke Coverage

Status: in progress

Next work:

- run and record a full daemon/MCP smoke test for paginated `discover()`
- add direct daemon/proxy coverage where practical

### 2. Documentation Maintenance

Status: in progress

Next work:

- keep `README.md`, `docs/system-architecture.md`, `docs/codebase-summary.md`, this roadmap, and the changelog aligned with the shipped discover contract
- trim stale historical detail when it starts competing with current-state docs

### 3. Release Readiness

Status: in progress

Next work:

- publish and validate an `alpha` prerelease from the new gated flow
- validate Windows/macOS/Linux prerequisites end-to-end
- decide when to promote the first stable `latest` release

## Near-Term Backlog

- more direct MCP coverage around discover pagination and cache invalidation
- more daemon/proxy end-to-end coverage for taste updates
- optional richer dashboard controls
- cross-platform release rehearsal notes for npm publish

## Explicitly Removed from the Current Direction

These are not current roadmap targets anymore:

- restoring grouped-lane discover output
- reintroducing Smart Search into the discover pipeline
- reintroducing obsession/boredom/craving state as the primary taste model

## Success Criteria

The roadmap should stay true when these statements remain accurate:

- an agent can understand taste from raw state instead of opaque server scores
- `discover()` returns flat paginated Apple candidates with cache-backed follow-up pages
- the queue, dashboard, and MCP tools stay in sync
- the codebase can be validated with a clean `npm run build` and `npm test`
- docs describe the current runtime, not superseded experiments
