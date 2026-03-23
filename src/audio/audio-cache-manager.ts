import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { youtubeDl } from 'youtube-dl-exec';
import { getDataDir } from '../runtime/runtime-data-paths.js';
import { loadRuntimeConfig } from '../runtime/runtime-config.js';

const SPAWN_OPTS = process.platform === 'win32' ? { windowsHide: true } : {};
const FFMPEG_PROCESS_OPTS: SpawnOptions = {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: process.platform === 'win32',
};
const DEFAULT_CACHE_MAX_MB = 2000;

export interface PreparedAudioTrack {
  videoId: string;
  normalizedPath: string;
  duration: number;
}

export interface AudioCacheManagerOptions {
  spawnProcess?: typeof spawn;
  youtubeDlFn?: typeof youtubeDl;
  resolveCacheMaxMB?: () => number;
}

type PreparedTrackMeta = {
  duration?: number;
  preparedPath?: string;
};

class FfmpegUnavailableError extends Error {
  constructor() {
    super('ffmpeg unavailable');
  }
}

export class AudioCacheManager {
  private readonly spawnProcess: typeof spawn;
  private readonly youtubeDlFn: typeof youtubeDl;
  private readonly resolveCacheMaxMB: () => number;
  private readonly inFlight = new Map<string, Promise<PreparedAudioTrack>>();
  private readonly inUsePaths = new Set<string>();
  private ffmpegUnavailable = false;

  constructor(options: AudioCacheManagerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.youtubeDlFn = options.youtubeDlFn ?? youtubeDl;
    this.resolveCacheMaxMB = options.resolveCacheMaxMB ?? defaultCacheMaxMbResolver;
  }

  getCacheDir(): string {
    return path.join(getDataDir(), 'cache');
  }

  getDownloadsDir(): string {
    return path.join(this.getCacheDir(), 'downloads');
  }

  getNormalizedDir(): string {
    return path.join(this.getCacheDir(), 'normalized');
  }

  getCrossfadesDir(): string {
    return path.join(this.getCacheDir(), 'crossfades');
  }

  getBodiesDir(): string {
    return path.join(this.getCacheDir(), 'bodies');
  }

  markInUse(filePath: string): void {
    this.inUsePaths.add(path.resolve(filePath));
  }

  releaseInUse(filePath: string): void {
    this.inUsePaths.delete(path.resolve(filePath));
  }

  isInUse(filePath: string): boolean {
    return this.inUsePaths.has(path.resolve(filePath));
  }

  async getOrPrepare(videoId: string): Promise<PreparedAudioTrack> {
    const existing = this.inFlight.get(videoId);
    if (existing) {
      return existing;
    }

    const preparation = this.prepareTrack(videoId).finally(() => {
      this.inFlight.delete(videoId);
    });
    this.inFlight.set(videoId, preparation);
    return preparation;
  }

  async evictIfNeeded(maxMB = this.resolveCacheMaxMB()): Promise<void> {
    const maxBytes = Math.max(0, Math.floor(maxMB * 1024 * 1024));
    const files = this.collectCacheFiles();
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes <= maxBytes) {
      return;
    }

    files.sort((left, right) => left.mtimeMs - right.mtimeMs);
    for (const file of files) {
      if (totalBytes <= maxBytes) {
        break;
      }
      if (this.inUsePaths.has(path.resolve(file.path))) {
        continue;
      }
      try {
        fs.rmSync(file.path, { force: true });
        totalBytes -= file.size;
      } catch (error) {
        console.error('[audio-cache-manager] failed to evict file', { file: file.path, error: (error as Error).message });
      }
    }
  }

  private async prepareTrack(videoId: string): Promise<PreparedAudioTrack> {
    this.ensureCacheDirs();

    const normalizedPath = path.join(this.getNormalizedDir(), `${videoId}.wav`);
    const metadata = this.readMetadata(videoId);
    const duration = metadata.duration ?? await this.fetchDuration(videoId);
    if (fs.existsSync(normalizedPath)) {
      this.writeMetadata(videoId, { duration, preparedPath: normalizedPath });
      this.touchFile(normalizedPath);
      this.scheduleEviction();
      return { videoId, normalizedPath, duration };
    }

    const rawPath = await this.downloadTrack(videoId);
    let preparedPath = rawPath;

    if (!this.ffmpegUnavailable) {
      try {
        await this.normalizeTrack(rawPath, normalizedPath);
        preparedPath = normalizedPath;
      } catch (error) {
        if (error instanceof FfmpegUnavailableError) {
          this.ffmpegUnavailable = true;
          console.error('[audio-cache-manager] ffmpeg unavailable, using raw download path');
        } else {
          throw error;
        }
      }
    }

    this.writeMetadata(videoId, { duration, preparedPath });
    this.touchFile(preparedPath);
    this.scheduleEviction();
    return { videoId, normalizedPath: preparedPath, duration };
  }

  private async downloadTrack(videoId: string): Promise<string> {
    const existing = this.findDownloadedTrack(videoId);
    if (existing) {
      this.touchFile(existing);
      return existing;
    }

    const outputTemplate = path.join(this.getDownloadsDir(), `${videoId}.%(ext)s`);
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
    await this.youtubeDlFn(sourceUrl, {
      output: outputTemplate,
      format: 'bestaudio[ext=m4a]/bestaudio',
      noWarnings: true,
      noPlaylist: true,
    }, SPAWN_OPTS);

    const downloadedPath = this.findDownloadedTrack(videoId);
    if (!downloadedPath) {
      throw new Error(`yt-dlp did not produce a download for ${videoId}`);
    }
    return downloadedPath;
  }

  private async normalizeTrack(rawPath: string, normalizedPath: string): Promise<void> {
    if (fs.existsSync(normalizedPath)) {
      return;
    }

    await this.runProcess('ffmpeg', [
      '-y',
      '-i',
      rawPath,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-af',
      'loudnorm=I=-14:TP=-1:LRA=11',
      '-f',
      'wav',
      normalizedPath,
    ]);
  }

  private async runProcess(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let childProcess: ChildProcess;
      try {
        childProcess = this.spawnProcess(command, args, FFMPEG_PROCESS_OPTS);
      } catch (error) {
        const startError = error as NodeJS.ErrnoException;
        if (startError.code === 'ENOENT') {
          reject(new FfmpegUnavailableError());
          return;
        }
        reject(startError);
        return;
      }

      let stderr = '';
      childProcess.stderr?.setEncoding('utf8');
      childProcess.stderr?.on('data', (chunk: string) => { stderr += chunk; });
      childProcess.once('error', (error) => {
        const spawnError = error as NodeJS.ErrnoException;
        if (spawnError.code === 'ENOENT') {
          reject(new FfmpegUnavailableError());
          return;
        }
        reject(spawnError);
      });
      childProcess.once('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Process failed (${command}): ${stderr.trim() || `exit code ${code ?? 'unknown'}`}`));
      });
    });
  }

  private async fetchDuration(videoId: string): Promise<number> {
    try {
      const metadata = await this.youtubeDlFn(`https://www.youtube.com/watch?v=${videoId}`, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
      }, SPAWN_OPTS) as { duration?: unknown };
      return toFiniteNumber(metadata.duration) ?? 0;
    } catch (error) {
      console.error('[audio-cache-manager] duration probe failed', { videoId, error: (error as Error).message });
      return 0;
    }
  }

  private metadataPath(videoId: string): string {
    return path.join(this.getNormalizedDir(), `${videoId}.meta.json`);
  }

  private readMetadata(videoId: string): PreparedTrackMeta {
    const metadataPath = this.metadataPath(videoId);
    if (!fs.existsSync(metadataPath)) {
      return {};
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as PreparedTrackMeta;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeMetadata(videoId: string, metadata: PreparedTrackMeta): void {
    fs.writeFileSync(this.metadataPath(videoId), `${JSON.stringify(metadata)}\n`, 'utf8');
  }

  private findDownloadedTrack(videoId: string): string | null {
    const entries = fs.readdirSync(this.getDownloadsDir(), { withFileTypes: true });
    const matches = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${videoId}.`))
      .map((entry) => path.join(this.getDownloadsDir(), entry.name));
    if (matches.length === 0) {
      return null;
    }
    matches.sort();
    return matches[0];
  }

  private scheduleEviction(): void {
    setImmediate(() => {
      void this.evictIfNeeded().catch((error) => {
        console.error('[audio-cache-manager] eviction failed', { error: (error as Error).message });
      });
    });
  }

  private collectCacheFiles(): Array<{ path: string; size: number; mtimeMs: number }> {
    const directories = [this.getDownloadsDir(), this.getNormalizedDir(), this.getCrossfadesDir(), this.getBodiesDir()];
    const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const directory of directories) {
      if (!fs.existsSync(directory)) {
        continue;
      }
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        const absolutePath = path.join(directory, entry.name);
        const stat = fs.statSync(absolutePath);
        files.push({ path: absolutePath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
    return files;
  }

  private touchFile(filePath: string): void {
    const now = new Date();
    try {
      fs.utimesSync(filePath, now, now);
    } catch {
      // Ignore touch failures; it only affects eviction ordering.
    }
  }

  private ensureCacheDirs(): void {
    fs.mkdirSync(this.getDownloadsDir(), { recursive: true });
    fs.mkdirSync(this.getNormalizedDir(), { recursive: true });
    fs.mkdirSync(this.getCrossfadesDir(), { recursive: true });
    fs.mkdirSync(this.getBodiesDir(), { recursive: true });
  }
}

let audioCacheManager: AudioCacheManager | null = null;

export function createAudioCacheManager(options: AudioCacheManagerOptions = {}): AudioCacheManager {
  if (!audioCacheManager) {
    audioCacheManager = new AudioCacheManager(options);
  }
  return audioCacheManager;
}

export function getAudioCacheManager(): AudioCacheManager | null {
  return audioCacheManager;
}

function defaultCacheMaxMbResolver(): number {
  const config = loadRuntimeConfig() as ReturnType<typeof loadRuntimeConfig> & {
    crossfade?: { cacheMaxMB?: unknown };
  };
  return toFiniteNumber(config.crossfade?.cacheMaxMB) ?? DEFAULT_CACHE_MAX_MB;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}
