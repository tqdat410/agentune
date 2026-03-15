# Phase 5 Dashboard Landed, But The First Smoke Test Broke It

**Date**: 2026-03-15 20:10
**Severity**: Medium
**Component**: Browser dashboard / web server
**Status**: Resolved

## What Happened

Phase 5 shipped as a real browser dashboard: HTTP server, static assets, WebSocket state sync, volume slider, mute toggle, and auto-open on first play. The build passed immediately. That was not enough. The first live smoke test against `POST /api/volume` exposed a server-side failure path when `mpv` was unavailable.

## The Brutal Truth

This was the exact kind of bug that slips through when a team congratulates itself too early because TypeScript is green. The dashboard looked done. It was not done. A simple request against a perfectly valid endpoint could still tear down the request path because the happy-path assumption was wrong. That is annoying because the whole point of this dashboard is to be useful even when audio is temporarily unavailable.

## Technical Details

`npm run build` passed, `GET /api/status` passed, and WebSocket connection to `/ws` returned the expected initial `state` payload. Then `POST /api/volume` triggered the broken path. The request should have failed gracefully, but instead the transport got severed because `MpvController.setVolume()` required a ready player and the HTTP layer did not guard that case. The fix added:

- `503` for volume updates when the audio engine is unavailable
- request-level error handling in the HTTP server
- safe ignore behavior for WebSocket volume/mute messages when `mpv` is not ready

## What We Tried

- Built first with `npm run build`
- Ran live HTTP smoke tests
- Re-ran after patching request handling
- Verified WebSocket handshake and initial state payload again

## Root Cause Analysis

The root problem was assuming dashboard controls and audio readiness are the same thing. They are not. The dashboard is display-first. Audio can be down while the dashboard stays up. The original server code treated them as one availability boundary.

## Lessons Learned

- Passing compilation means almost nothing for control-plane features
- For local dashboards, degraded mode matters as much as the happy path
- Request handlers must own their own failure boundaries, not trust downstream services

## Next Steps

- Add real automated tests for `/api/status`, `/api/volume`, and `/ws`
- Wire queue and mood data into dashboard state in Phases 6 and 7
- Keep smoke-testing endpoints before calling any phase done
