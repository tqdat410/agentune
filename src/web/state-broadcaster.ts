import { EventEmitter } from 'events';
import type { TrackMeta, MpvController } from '../audio/mpv-controller.js';
import type { TransitionController } from '../audio/transition-controller.js';
import type { QueueManager } from '../queue/queue-manager.js';
import type { QueueItem } from '../queue/queue-manager.js';


export interface DashboardQueueItem {
  title: string;
  artist: string;
}

export interface DashboardState {
  playing: boolean;
  title: string | null;
  artist: string | null;
  thumbnail: string | null;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  queue: DashboardQueueItem[];
}

type TrackLike = Pick<TrackMeta, 'artist' | 'duration' | 'thumbnail' | 'title'> | QueueItem | null;

function mapTrack(track: TrackLike) {
  if (!track) {
    return { title: null, artist: null, thumbnail: null, duration: 0 };
  }

  return {
    title: track.title,
    artist: track.artist ?? 'Unknown',
    thumbnail: track.thumbnail ?? null,
    duration: track.duration ?? 0,
  };
}

export class StateBroadcaster extends EventEmitter {
  private lastSerializedState = '';
  private positionTimer: NodeJS.Timeout;
  private refreshGeneration = 0;
  private state: DashboardState;

  constructor(
    private readonly mpv: MpvController,
    private readonly queueManager: QueueManager,
    private readonly transitionController: TransitionController | null = null,
  ) {
    super();
    this.state = this.createBaseState();
    this.positionTimer = setInterval(() => {
      void this.refresh();
    }, 1000);

    this.mpv.on('state-change', () => {
      void this.refresh();
    });
    this.queueManager.on('state-change', () => {
      void this.refresh();
    });
  }

  getState(): DashboardState {
    return this.state;
  }

  async refresh(): Promise<void> {
    const refreshGeneration = ++this.refreshGeneration;
    const nextState = await this.buildState();
    if (refreshGeneration !== this.refreshGeneration) {
      return;
    }

    const serialized = JSON.stringify(nextState);
    if (serialized === this.lastSerializedState) {
      return;
    }

    this.state = nextState;
    this.lastSerializedState = serialized;
    this.emit('state', this.state);
  }

  destroy(): void {
    clearInterval(this.positionTimer);
  }

  private createBaseState(): DashboardState {
    return {
      playing: false,
      title: null,
      artist: null,
      thumbnail: null,
      position: 0,
      duration: 0,
      volume: this.mpv.getVolume(),
      muted: this.mpv.getIsMuted(),
      queue: this.queueManager.list().map((item) => ({ title: item.title, artist: item.artist })),
    };
  }

  private async buildState(): Promise<DashboardState> {
    const currentState = this.mpv.getState();
    const snapshot = {
      currentTrack: currentState.currentTrack ? { ...currentState.currentTrack } : null,
      isPlaying: currentState.isPlaying,
      isMuted: currentState.isMuted,
      volume: currentState.volume,
    };
    const logicalTrack = this.transitionController?.getCurrentLogicalTrack()
      ?? this.queueManager.getNowPlaying()
      ?? snapshot.currentTrack;
    const track = mapTrack(logicalTrack);
    const rawPosition = snapshot.currentTrack && this.mpv.isReady()
      ? Math.max(0, Math.round(await this.mpv.getPosition()))
      : 0;
    const logicalPosition = this.transitionController?.getLogicalPosition(rawPosition);
    const position = Math.round(logicalPosition?.position ?? rawPosition);
    const duration = Math.max(position, Math.round(logicalPosition?.duration ?? track.duration));

    return {
      playing: snapshot.isPlaying,
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      position,
      duration,
      volume: snapshot.volume,
      muted: snapshot.isMuted,
      queue: this.queueManager.list().map((item) => ({ title: item.title, artist: item.artist })),
    };
  }
}
