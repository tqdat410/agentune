import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser helper lives in public/ and is loaded directly at runtime.
import { applyPlaybackVisualState, resolvePlaybackVisualState } from '../../public/dashboard/playback-visual-state.js';

test('resolvePlaybackVisualState returns idle when no track exists', () => {
  assert.equal(resolvePlaybackVisualState(false, false), 'idle');
  assert.equal(resolvePlaybackVisualState(false, true), 'idle');
});

test('resolvePlaybackVisualState returns playing when a track is active', () => {
  assert.equal(resolvePlaybackVisualState(true, true), 'playing');
});

test('resolvePlaybackVisualState returns paused when a track exists but playback is stopped', () => {
  assert.equal(resolvePlaybackVisualState(true, false), 'paused');
});

test('applyPlaybackVisualState writes the visual state dataset marker', () => {
  const root = { dataset: {} as Record<string, string> };

  applyPlaybackVisualState(root as never, true, false);
  assert.equal(root.dataset.playbackVisualState, 'paused');
});
