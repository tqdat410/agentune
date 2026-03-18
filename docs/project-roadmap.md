# Project Roadmap

## Current State

`sbotify` is functionally in MVP-complete territory for local agent-controlled playback:

- daemon + proxy architecture: complete
- queue-based playback: complete
- browser dashboard: complete
- Apple-first resolution and discovery providers: complete
- agent-first state redesign: complete

Last validated:

- `2026-03-18`
- `npm test`: 77 passed, 0 failed

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
- queue preview
- volume and mute controls
- persona editor with trait bars
- `/api/persona` and WebSocket persona sync

### State Redesign

- removed scorer-driven taste loop from active runtime
- replaced old taste state with:
  - `context`
  - `persona` (`exploration`, `variety`, `loyalty`, `taste`)
  - `history`
- replaced scored discover output with grouped lane output
- added `update_persona`

## Active Focus

### 1. Hardening and Coverage

Status: in progress

Next work:

- add more direct MCP-layer coverage for `discover()` and `update_persona()`
- add dashboard HTTP coverage beyond persona sync
- add daemon/proxy integration coverage where practical

### 2. Documentation Maintenance

Status: in progress

Next work:

- keep `docs/system-architecture.md`, `docs/codebase-summary.md`, and this roadmap aligned with shipped code
- trim stale historical detail when it starts competing with current-state docs

### 3. Release Readiness

Status: pending

Next work:

- polish install/run docs for real users
- validate Windows/macOS/Linux prerequisites end-to-end
- decide when to publish the package

## Near-Term Backlog

- optional richer dashboard controls
- better end-to-end test harness around daemon + web flows
- publish checklist for npm release

## Explicitly Removed from the Current Direction

These are not current roadmap targets anymore:

- restoring server-side discover scoring
- restoring session-lane driven dashboard state
- reintroducing obsession/boredom/craving state as the primary taste model

## Success Criteria

The roadmap should stay true when these statements remain accurate:

- an agent can understand taste from raw state instead of opaque server scores
- the queue, dashboard, and MCP tools stay in sync
- the codebase can be validated with a clean `npm test`
- docs describe the current runtime, not superseded experiments
