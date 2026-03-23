# Crossfade MVP Landed After We Cut the Fantasy Plan Down

**Date**: 2026-03-23 17:53
**Severity**: Medium
**Component**: Crossfade transition engine
**Status**: Resolved

## What Happened

This session started with a plan inconsistency that had to be called out. The brainstorm and phase docs described a chained crossfade pipeline like `[A_body] -> [xfade_AB] -> [B_body] -> [xfade_BC] -> ...`, but the implementation that actually held together was a single-boundary controller: prepare one `A -> B` transition, hand off safely, then decide the next boundary later. That was the right cut for v1. Anything bigger would have turned queue mutation, skip logic, and cache ownership into a brittle mess.

## The Brutal Truth

The original plan was overconfident. It sounded smooth on paper and would have been ugly in runtime state. We were describing multi-hop elegance before proving one boundary was safe. That is exactly how playback code becomes a haunted house of edge cases. The useful outcome here is not "we shipped the grand design." It is that we stopped lying to ourselves early and shipped the smaller thing that we can actually defend.

## Technical Details

QA forced four concrete fixes:

- `agentune doctor` now probes `ffmpeg` explicitly with `-version` and reports `WARN: Not found in PATH (crossfade disabled)` instead of leaving the dependency failure implicit.
- The pre-mixer now maps runtime config into its real internal shape: `crossfade.duration -> durationSeconds`, `crossfade.enabled -> enabled`, and `lin -> tri` for FFmpeg `acrossfade`.
- Queue handoff is safer. When logical playback promoted `queued-next` but queue head had drifted to `unexpected-head`, the controller now removes the promoted track by id and preserves the unrelated queued item instead of corrupting queue order.
- Cache eviction timing stopped being stupid. Eviction is deferred with `setImmediate(...)` so a freshly prepared WAV can be marked in use before LRU cleanup runs and deletes the thing we just built.

## What We Tried

We kept the MVP at one prepared boundary, added tests around logical handoff and transition-aware skip behavior, and fixed the dependency/config/cache plumbing instead of chasing chained crossfades.

## Root Cause Analysis

We planned the UX before we had a disciplined model for playlist ownership, queue drift, and file lifetime under pressure.

## Lessons Learned

One safe boundary beats a fake infinite pipeline. Playback features punish optimism fast.

## Next Steps

Run this boundary-first model through real playback longer, then decide if chained crossfades are worth the added state complexity.

**Status:** DONE
**Summary:** Journal entry written for the crossfade session, focused on the single-boundary MVP decision and the specific QA fixes that made it viable.
**Concerns/Blockers:** None.
