import type { MpvController } from '../audio/mpv-controller.js';
import { createTransitionController, type TransitionController, type TransitionLogicalTrackChange } from '../audio/transition-controller.js';
import { getHistoryStore } from '../history/history-store.js';
import { normalizeTrackId } from '../history/history-schema.js';
import { getAppleSearchProvider } from '../providers/apple-search-provider.js';
import type { AudioInfo, SearchResult, YouTubeProvider } from '../providers/youtube-provider.js';
import { getWebServer } from '../web/web-server.js';
import type { QueueItem, QueueManager } from './queue-manager.js';

type PlaybackMeta = { context?: string; canonicalArtist?: string; canonicalTitle?: string };

function mapSearchResultToQueueItem(result: SearchResult): QueueItem {
  return {
    id: result.id,
    title: result.title,
    artist: result.artist,
    duration: Math.round(result.durationMs / 1000),
    thumbnail: result.thumbnail,
    url: result.url,
  };
}

export class QueuePlaybackController {
  private currentPlayId: number | null = null;
  private playbackMutation = Promise.resolve();
  private prefetchedAudio: { id: string; audio: AudioInfo } | null = null;
  private prefetchInProgress: string | null = null;
  private playGeneration = 0;
  private shuttingDown = false;
  private readonly transitionController: TransitionController | null;

  constructor(
    private readonly mpv: MpvController,
    private readonly queueManager: QueueManager,
    private readonly youtubeProvider: YouTubeProvider,
    transitionController?: TransitionController | null,
  ) {
    this.transitionController = transitionController ?? null;
    this.mpv.on('stopped', () => {
      const generation = this.playGeneration;
      void this.handleStopped(generation);
    });
    this.transitionController?.on('logical-track-changed', (event: TransitionLogicalTrackChange) => {
      void this.handleLogicalTrackChanged(event);
    });
  }

  async playById(id: string, extraMeta?: PlaybackMeta): Promise<QueueItem> {
    const resolved = await this.resolveQueueItem(id, extraMeta);
    return await this.withPlaybackMutation(async () => {
      await this.startPlayback(resolved.item, resolved.audio, extraMeta);
      return resolved.item;
    });
  }

  async addById(
    id: string,
    extraMeta?: PlaybackMeta,
  ): Promise<{ item: QueueItem; action: 'queued'; position: number; startedPlayback: boolean }> {
    const resolved = await this.resolveQueueItem(id, extraMeta);
    return await this.withPlaybackMutation(async () => {
      const position = this.queueManager.add(resolved.item);
      if (!this.queueManager.getNowPlaying()) {
        await this.playNextQueuedTrackLocked({
          id: resolved.item.id,
          audio: resolved.audio,
          extraMeta,
        });
        return { item: resolved.item, action: 'queued', position, startedPlayback: true };
      }

      if (position === 1) {
        this.prefetchNextTrack();
      }
      return { item: resolved.item, action: 'queued', position, startedPlayback: false };
    });
  }

  async queueByQuery(query: string): Promise<{ item: QueueItem; position: number }> {
    const results = await this.youtubeProvider.search(query, 1);
    if (results.length === 0) {
      throw new Error(`No results found for "${query}".`);
    }

    const item = mapSearchResultToQueueItem(results[0]);
    const position = this.queueManager.add(item);
    return { item, position };
  }

  async skip(): Promise<QueueItem | null> {
    return await this.withPlaybackMutation(async () => {
      await this.recordCurrentPlay(await this.getCurrentPlaybackPosition(), true, 'skip');
      this.playGeneration++;
      const hadTransitionPlan = this.transitionController?.isActive() ?? false;
      this.transitionController?.handleSkip();

      if (this.queueManager.getNowPlaying()) {
        this.queueManager.finishCurrentTrack();
      }

      if (this.mpv.getCurrentTrack()) {
        this.mpv.suppressNextStopped();
        if (hadTransitionPlan) {
          this.mpv.clearPlaylist();
        }
        this.mpv.stop();
      }

      return await this.playNextQueuedTrackLocked();
    });
  }

  async stopAndResetRuntimeState(): Promise<void> {
    await this.withPlaybackMutation(async () => {
      this.playGeneration++;
      this.prefetchedAudio = null;
      this.prefetchInProgress = null;
      await this.recordInterruptedPlay();
      const hadTransitionPlan = this.transitionController?.isActive() ?? false;
      this.transitionController?.cancel();

      if (this.mpv.isReady() && this.mpv.getCurrentTrack()) {
        this.mpv.suppressNextStopped();
        if (hadTransitionPlan) {
          this.mpv.clearPlaylist();
        }
        this.mpv.stop();
      }

      this.queueManager.reset();
    });
  }

  listQueue(): QueueItem[] {
    return this.queueManager.list();
  }

  clearForShutdown(): void {
    this.shuttingDown = true;
  }

  async replaceCurrentTrack(id: string, extraMeta?: PlaybackMeta): Promise<QueueItem> {
    const resolved = await this.resolveQueueItem(id, extraMeta);
    return await this.withPlaybackMutation(async () => {
      this.playGeneration++;
      await this.recordInterruptedPlay();
      this.transitionController?.cancel();
      await this.startPlayback(resolved.item, resolved.audio, extraMeta);
      return resolved.item;
    });
  }

  private async handleStopped(generation: number): Promise<void> {
    await this.withPlaybackMutation(async () => {
      if (this.shuttingDown || generation !== this.playGeneration) {
        return;
      }

      const nowPlaying = this.queueManager.getNowPlaying();
      if (nowPlaying) {
        await this.recordCurrentPlay(this.getCurrentPlaybackDuration(nowPlaying), false, 'finish');
      }

      this.transitionController?.cancel();
      this.queueManager.finishCurrentTrack();
      await this.playNextQueuedTrackLocked();
    });
  }

  private async handleLogicalTrackChanged(event: TransitionLogicalTrackChange): Promise<void> {
    await this.withPlaybackMutation(async () => {
      if (this.shuttingDown || this.queueManager.getNowPlaying()?.id !== event.previousTrack.id) {
        return;
      }

      await this.recordCurrentPlay(this.getCurrentPlaybackDuration(event.previousTrack), false, 'handoff');

      const nextQueued = this.queueManager.peek();
      if (nextQueued?.id === event.track.id) {
        this.queueManager.next();
      } else {
        const removedQueuedTrack = this.queueManager.removeById(event.track.id);
        if (!removedQueuedTrack) {
          console.error('[agentune] Logical track handoff missing from queue state', {
            expectedTrackId: event.track.id,
            queuedTrackId: nextQueued?.id ?? null,
          });
        }
      }

      this.queueManager.setNowPlaying(event.track);
      this.recordPlayStart(event.track);
      this.enrichTrackTags(event.track.artist, event.track.title);
      this.prefetchNextTrack();
    });
  }

  private async enrichTrackTags(artist: string, title: string): Promise<void> {
    const apple = getAppleSearchProvider();
    const store = getHistoryStore();
    if (!apple || !store) {
      return;
    }

    try {
      const genres = await apple.getTrackGenre(artist, title);
      if (genres.length === 0) {
        return;
      }
      store.updateTrackTags(normalizeTrackId(artist, title), genres);
    } catch (error) {
      console.error('[agentune] Tag enrichment failed:', (error as Error).message);
    }
  }

  private async playNextQueuedTrackLocked(
    prefetched?: { id: string; audio: AudioInfo; extraMeta?: PlaybackMeta },
  ): Promise<QueueItem | null> {
    const nextItem = this.queueManager.next();
    if (!nextItem) {
      this.queueManager.clearNowPlaying();
      return null;
    }

    if (prefetched && prefetched.id === nextItem.id) {
      await this.startPlayback(nextItem, prefetched.audio, prefetched.extraMeta);
      return nextItem;
    }

    const nextExtraMeta = {
      canonicalArtist: nextItem.artist,
      canonicalTitle: nextItem.title,
      context: nextItem.context,
    };
    const resolved = await this.resolveQueueItem(nextItem.id, nextExtraMeta);
    await this.startPlayback(resolved.item, resolved.audio, nextExtraMeta);
    return resolved.item;
  }

  private async resolveQueueItem(
    id: string,
    extraMeta?: PlaybackMeta,
  ): Promise<{ item: QueueItem; audio: AudioInfo }> {
    let audio: AudioInfo;
    if (this.prefetchedAudio && this.prefetchedAudio.id === id) {
      audio = this.prefetchedAudio.audio;
      this.prefetchedAudio = null;
      console.error('[agentune] Using pre-fetched audio for:', id);
    } else {
      audio = await this.youtubeProvider.getAudioUrl(id);
    }

    return {
      audio,
      item: {
        id,
        title: extraMeta?.canonicalTitle ?? audio.title,
        artist: extraMeta?.canonicalArtist ?? audio.artist,
        duration: audio.duration,
        thumbnail: audio.thumbnail,
        url: `https://www.youtube.com/watch?v=${id}`,
        context: extraMeta?.context,
      },
    };
  }

  private prefetchNextTrack(): void {
    const nextItem = this.queueManager.peek();
    if (!nextItem) {
      return;
    }

    if (this.shouldUseTransitionController()) {
      // Prepare crossfade + append to playlist if plan is upgradeable,
      // otherwise falls back to download-only prefetch internally
      void this.transitionController?.prepareTransitionAsync(nextItem)
        .catch(() => void this.transitionController?.prefetch(nextItem));
      return;
    }

    if (this.prefetchedAudio?.id === nextItem.id || this.prefetchInProgress === nextItem.id) {
      return;
    }

    this.prefetchInProgress = nextItem.id;
    console.error('[agentune] Pre-fetching audio for next track:', nextItem.title);

    this.youtubeProvider.getAudioUrl(nextItem.id).then((audio) => {
      if (this.queueManager.peek()?.id === nextItem.id) {
        this.prefetchedAudio = { id: nextItem.id, audio };
        console.error('[agentune] Pre-fetch complete for:', nextItem.title);
      }
    }).catch((error) => {
      console.error('[agentune] Pre-fetch failed:', (error as Error).message);
    }).finally(() => {
      this.prefetchInProgress = null;
    });
  }

  private async recordInterruptedPlay(): Promise<void> {
    await this.recordCurrentPlay(await this.getCurrentPlaybackPosition(), true, 'interrupted');
  }

  private async recordCurrentPlay(playedSeconds: number, skipped: boolean, reason: string): Promise<void> {
    if (this.currentPlayId === null) {
      return;
    }

    try {
      const store = getHistoryStore();
      if (store) {
        store.updatePlay(this.currentPlayId, { played_sec: playedSeconds, skipped });
      }
    } catch (error) {
      console.error(`[agentune] Failed to record ${reason}:`, (error as Error).message);
    }

    this.currentPlayId = null;
  }

  private async startPlayback(queueItem: QueueItem, audio: AudioInfo, extraMeta?: PlaybackMeta): Promise<void> {
    let nextNowPlaying = queueItem;

    if (this.shouldUseTransitionController()) {
      try {
        const transitionStart = await this.transitionController!.startPlayback(queueItem, this.queueManager.peek());
        nextNowPlaying = transitionStart.track;
        this.mpv.resume();
        this.mpv.play(transitionStart.entryPath, nextNowPlaying);
        for (const appendPath of transitionStart.appendPaths) {
          this.mpv.appendToPlaylist(appendPath);
        }
      } catch (error) {
        console.error('[agentune] Crossfade pipeline failed, falling back to stream URL', {
          error: (error as Error).message,
          trackId: queueItem.id,
        });
        this.transitionController?.cancel();
        this.mpv.resume();
        this.mpv.play(audio.streamUrl, queueItem);
      }
    } else {
      this.mpv.resume();
      this.mpv.play(audio.streamUrl, queueItem);
    }

    this.queueManager.setNowPlaying(nextNowPlaying);
    getWebServer()?.openDashboardOnce();
    this.recordPlayStart(nextNowPlaying, extraMeta);
    this.enrichTrackTags(nextNowPlaying.artist, nextNowPlaying.title);
    this.prefetchNextTrack();
  }

  private recordPlayStart(queueItem: QueueItem, extraMeta?: PlaybackMeta): void {
    try {
      const store = getHistoryStore();
      if (!store) {
        return;
      }
      const canonical = extraMeta?.canonicalArtist && extraMeta?.canonicalTitle
        ? { artist: extraMeta.canonicalArtist, title: extraMeta.canonicalTitle }
        : undefined;
      this.currentPlayId = store.recordPlay(
        {
          title: queueItem.title,
          artist: queueItem.artist,
          duration: queueItem.duration,
          thumbnail: queueItem.thumbnail,
          ytVideoId: queueItem.id,
        },
        { context: queueItem.context, source: 'playById' },
        canonical,
      );
    } catch (error) {
      console.error('[agentune] Failed to record play:', (error as Error).message);
    }
  }

  private getCurrentPlaybackDuration(nowPlaying: QueueItem): number {
    const logicalTrack = this.transitionController?.getCurrentLogicalTrack();
    return logicalTrack?.id === nowPlaying.id ? logicalTrack.duration : nowPlaying.duration;
  }

  private async getCurrentPlaybackPosition(): Promise<number> {
    const rawPosition = await this.mpv.getPosition().catch(() => 0);
    const logicalPosition = this.transitionController?.getLogicalPosition(rawPosition);
    return Math.round(logicalPosition?.position ?? rawPosition);
  }

  private shouldUseTransitionController(): boolean {
    return this.transitionController?.isEnabled() ?? false;
  }

  private async withPlaybackMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.playbackMutation;
    let release!: () => void;
    this.playbackMutation = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}

let queuePlaybackController: QueuePlaybackController | null = null;

export function createQueuePlaybackController(
  mpv: MpvController,
  queueManager: QueueManager,
  youtubeProvider: YouTubeProvider,
  transitionController?: TransitionController | null,
): QueuePlaybackController {
  if (!queuePlaybackController) {
    queuePlaybackController = new QueuePlaybackController(
      mpv,
      queueManager,
      youtubeProvider,
      transitionController ?? createTransitionController(mpv),
    );
  }
  return queuePlaybackController;
}

export function getQueuePlaybackController(): QueuePlaybackController | null {
  return queuePlaybackController;
}
