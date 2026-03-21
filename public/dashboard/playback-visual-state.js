export function resolvePlaybackVisualState(hasTrack, isPlaying) {
  if (!hasTrack) {
    return 'idle';
  }

  return isPlaying ? 'playing' : 'paused';
}

export function applyPlaybackVisualState(root, hasTrack, isPlaying) {
  root.dataset.playbackVisualState = resolvePlaybackVisualState(hasTrack, isPlaying);
}
