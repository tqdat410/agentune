import { EventEmitter } from 'node:events';
import { createAudioCacheManager, type AudioCacheManager, type PreparedAudioTrack } from './audio-cache-manager.js';
import { createCrossfadePreMixer, type CrossfadePreMixer, type CrossfadeTrackInput, type CrossfadeResult } from './crossfade-pre-mixer.js';
import type { MpvController } from './mpv-controller.js';
import { DEFAULT_CROSSFADE_CONFIG, loadRuntimeConfig, type CrossfadeConfig as RuntimeCrossfadeConfig } from '../runtime/runtime-config.js';
import type { QueueItem } from '../queue/queue-manager.js';

export interface TransitionStartResult {
  appendPaths: string[];
  entryPath: string;
  mode: 'crossfade' | 'direct';
  track: QueueItem;
}

export interface TransitionLogicalPosition {
  duration: number;
  position: number;
  track: QueueItem;
}

export interface TransitionLogicalTrackChange {
  previousTrack: QueueItem;
  track: QueueItem;
}

export interface TransitionControllerOptions {
  audioCacheManager?: AudioCacheManager;
  config?: RuntimeCrossfadeConfig;
  crossfadePreMixer?: CrossfadePreMixer;
}

type PreparedTrack = PreparedAudioTrack & { item: QueueItem };

type PlaylistSegment = {
  duration: number;
  path: string;
  playlistIndex: number;
  positionOffset: number;
  promotesTrack?: QueueItem;
  track: QueueItem;
  type: 'body' | 'crossfade';
};

type ActivePlan = {
  mode: 'crossfade' | 'direct';
  currentTrack: QueueItem;
  pathsInUse: string[];
  segments: PlaylistSegment[];
  currentPlaylistIndex: number;
};

export class TransitionController extends EventEmitter {
  private activePlan: ActivePlan | null = null;
  private pendingUpgrade: { trackId: string; promise: Promise<boolean> } | null = null;
  private readonly audioCacheManager: AudioCacheManager;
  private readonly config: RuntimeCrossfadeConfig;
  private readonly crossfadePreMixer: CrossfadePreMixer;

  constructor(
    private readonly mpv: MpvController,
    options: TransitionControllerOptions = {},
  ) {
    super();
    this.audioCacheManager = options.audioCacheManager ?? createAudioCacheManager();
    this.crossfadePreMixer = options.crossfadePreMixer ?? createCrossfadePreMixer();
    this.config = options.config ?? (loadRuntimeConfig().crossfade ?? DEFAULT_CROSSFADE_CONFIG);
    this.mpv.on('segment-changed', (playlistIndex: number) => {
      this.handleSegmentChanged(playlistIndex);
    });
  }

  /**
   * Start playback immediately in direct mode from cached/normalized file.
   * If nextItem is provided and crossfade is enabled, an async background
   * task prepares the crossfade and appends segments to the mpv playlist.
   */
  async startPlayback(currentItem: QueueItem, nextItem: QueueItem | null): Promise<TransitionStartResult> {
    this.cancel();
    const preparedCurrent = await this.prepareTrack(currentItem);

    // Always start immediately in direct mode — no blocking on next track
    this.activePlan = createDirectPlan(preparedCurrent.item, preparedCurrent.normalizedPath);
    this.markInUse(this.activePlan.pathsInUse);

    // Kick off async crossfade preparation if next track is known
    if (this.config.enabled && nextItem) {
      void this.prepareTransitionAsync(nextItem);
    }

    return {
      appendPaths: [],
      entryPath: preparedCurrent.normalizedPath,
      mode: 'direct',
      track: preparedCurrent.item,
    };
  }

  /**
   * Prepare the next track and, if the current plan is still in direct mode,
   * upgrade it to a crossfade plan by appending segments to the mpv playlist.
   * Safe to call multiple times — deduplicates concurrent requests for the
   * same track. Returns true if the plan was upgraded to crossfade.
   */
  async prepareTransitionAsync(nextItem: QueueItem): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    // Dedup: return existing promise if already preparing for same track
    if (this.pendingUpgrade?.trackId === nextItem.id) {
      return this.pendingUpgrade.promise;
    }

    const promise = this.doPrepareTransition(nextItem);
    this.pendingUpgrade = { trackId: nextItem.id, promise };
    return promise.finally(() => {
      if (this.pendingUpgrade?.promise === promise) {
        this.pendingUpgrade = null;
      }
    });
  }

  /**
   * Download and normalize the next track into the audio cache.
   * Does not create crossfade segments or modify the playlist.
   */
  async prefetch(nextItem: QueueItem | null): Promise<void> {
    if (!this.config.enabled || !nextItem) {
      return;
    }
    try {
      await this.audioCacheManager.getOrPrepare(nextItem.id);
    } catch (error) {
      console.error('[transition-controller] prefetch failed', {
        error: (error as Error).message,
        trackId: nextItem.id,
      });
    }
  }

  cancel(): void {
    this.pendingUpgrade = null;
    this.crossfadePreMixer.cancel();
    if (this.activePlan) {
      this.releaseInUse(this.activePlan.pathsInUse);
      this.activePlan = null;
    }
  }

  getCurrentLogicalTrack(): QueueItem | null {
    const segment = this.getCurrentSegment();
    return segment?.track ?? null;
  }

  getLogicalPosition(rawPosition: number): TransitionLogicalPosition | null {
    const segment = this.getCurrentSegment();
    if (!segment) {
      return null;
    }
    return {
      duration: segment.track.duration,
      position: Math.max(0, Math.min(segment.track.duration, segment.positionOffset + rawPosition)),
      track: segment.track,
    };
  }

  isActive(): boolean {
    return this.activePlan !== null;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isInCrossfade(): boolean {
    return this.getCurrentSegment()?.type === 'crossfade';
  }

  handleSkip(): 'clean-skip' | 'direct' | 'hard-cut' {
    const segment = this.getCurrentSegment();
    const mode = this.activePlan?.mode === 'direct'
      ? 'direct'
      : segment?.type === 'crossfade'
      ? 'hard-cut'
      : this.activePlan
        ? 'clean-skip'
        : 'direct';
    this.cancel();
    return mode;
  }

  private async prepareTrack(item: QueueItem): Promise<PreparedTrack> {
    const prepared = await this.audioCacheManager.getOrPrepare(item.id);
    return {
      ...prepared,
      item: {
        ...item,
        duration: prepared.duration || item.duration,
      },
    };
  }

  /**
   * Internal: download+normalize next track, create crossfade, and append
   * segments to the mpv playlist if the plan is still in direct mode.
   */
  private async doPrepareTransition(nextItem: QueueItem): Promise<boolean> {
    // Capture current plan reference to detect cancellation/changes
    const planSnapshot = this.activePlan;

    // Always download+normalize next track (serves as prefetch even if
    // the plan can't be upgraded to crossfade)
    let preparedNext: PreparedTrack;
    try {
      preparedNext = await this.prepareTrack(nextItem);
    } catch (error) {
      console.error('[transition-controller] async prefetch failed', {
        error: (error as Error).message,
        trackId: nextItem.id,
      });
      return false;
    }

    // Plan must still be alive and in direct mode to upgrade
    if (!this.activePlan || this.activePlan !== planSnapshot || this.activePlan.mode !== 'direct') {
      return false;
    }

    const currentTrack = this.activePlan.currentTrack;
    const currentPath = this.activePlan.segments[0].path;

    try {
      const mix = await this.crossfadePreMixer.createCrossfade(
        { videoId: currentTrack.id, normalizedPath: currentPath, duration: currentTrack.duration },
        toCrossfadeTrackInput(preparedNext),
        toPreMixerConfig(this.config),
      );

      if (mix.skipped || !mix.crossfadePath) {
        return false;
      }

      // Re-check plan validity after async crossfade work
      if (!this.activePlan || this.activePlan !== planSnapshot || this.activePlan.mode !== 'direct') {
        return false;
      }

      const segments = createPlaylistSegments(currentTrack, preparedNext.item, mix);
      this.releaseInUse(this.activePlan.pathsInUse);
      this.markInUse(segments.map((segment) => segment.path));

      // Append crossfade and next-body to the live mpv playlist
      this.mpv.appendToPlaylist(segments[1].path);
      this.mpv.appendToPlaylist(segments[2].path);

      this.activePlan = {
        currentPlaylistIndex: this.activePlan.currentPlaylistIndex,
        currentTrack,
        mode: 'crossfade',
        pathsInUse: segments.map((segment) => segment.path),
        segments,
      };

      console.error('[transition-controller] upgraded to crossfade', {
        currentTrackId: currentTrack.id,
        nextTrackId: nextItem.id,
      });
      return true;
    } catch (error) {
      console.error('[transition-controller] async crossfade preparation failed', {
        error: (error as Error).message,
        trackId: nextItem.id,
      });
      return false;
    }
  }

  private handleSegmentChanged(playlistIndex: number): void {
    if (!this.activePlan) {
      return;
    }
    this.activePlan.currentPlaylistIndex = playlistIndex;
    const segment = this.getCurrentSegment();
    if (segment?.promotesTrack && segment.promotesTrack.id !== this.activePlan.currentTrack.id) {
      const previousTrack = this.activePlan.currentTrack;
      this.activePlan.currentTrack = segment.promotesTrack;
      this.emit('logical-track-changed', {
        previousTrack,
        track: segment.promotesTrack,
      } satisfies TransitionLogicalTrackChange);
    }
  }

  private getCurrentSegment(): PlaylistSegment | null {
    if (!this.activePlan) {
      return null;
    }
    return this.activePlan.segments.find((segment) => segment.playlistIndex === this.activePlan?.currentPlaylistIndex) ?? null;
  }

  private markInUse(filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.audioCacheManager.markInUse(filePath);
    }
  }

  private releaseInUse(filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.audioCacheManager.releaseInUse(filePath);
    }
  }
}

let transitionController: TransitionController | null = null;

export function createTransitionController(
  mpv: MpvController,
  options: TransitionControllerOptions = {},
): TransitionController {
  if (!transitionController) {
    transitionController = new TransitionController(mpv, options);
  }
  return transitionController;
}

export function getTransitionController(): TransitionController | null {
  return transitionController;
}

function createDirectPlan(track: QueueItem, path: string): ActivePlan {
  return {
    currentPlaylistIndex: 0,
    currentTrack: track,
    mode: 'direct',
    pathsInUse: [path],
    segments: [
      {
        duration: track.duration,
        path,
        playlistIndex: 0,
        positionOffset: 0,
        track,
        type: 'body',
      },
    ],
  };
}

function createPlaylistSegments(currentTrack: QueueItem, nextTrack: QueueItem, mix: CrossfadeResult): PlaylistSegment[] {
  return [
    {
      duration: mix.aBodyDuration,
      path: mix.aBodyPath,
      playlistIndex: 0,
      positionOffset: 0,
      track: currentTrack,
      type: 'body',
    },
    {
      duration: mix.crossfadeDuration,
      path: mix.crossfadePath,
      playlistIndex: 1,
      positionOffset: Math.max(0, currentTrack.duration - mix.crossfadeDuration),
      track: currentTrack,
      type: 'crossfade',
    },
    {
      duration: mix.bBodyDuration,
      path: mix.bBodyPath,
      playlistIndex: 2,
      positionOffset: mix.crossfadeDuration,
      promotesTrack: nextTrack,
      track: nextTrack,
      type: 'body',
    },
  ];
}

function toCrossfadeTrackInput(track: PreparedTrack): CrossfadeTrackInput {
  return {
    duration: track.duration,
    normalizedPath: track.normalizedPath,
    videoId: track.videoId,
  };
}

function toPreMixerConfig(config: RuntimeCrossfadeConfig): Partial<{
  curve: 'exp' | 'log' | 'lin';
  durationSeconds: number;
  enabled: boolean;
  loudnessNorm: boolean;
}> {
  return {
    curve: config.curve,
    durationSeconds: config.duration,
    enabled: config.enabled,
    loudnessNorm: config.loudnessNorm,
  };
}
