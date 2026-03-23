import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../runtime/runtime-data-paths.js';
import { loadRuntimeConfig, type CrossfadeConfig as RuntimeCrossfadeConfig } from '../runtime/runtime-config.js';

const FFMPEG_PROCESS_OPTS: SpawnOptions = {
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: process.platform === 'win32',
};

const DEFAULT_CROSSFADE_CONFIG: CrossfadeConfig = {
  curve: 'exp',
  durationSeconds: 5,
  enabled: true,
  loudnessNorm: true,
};

export type CrossfadeCurve = 'exp' | 'log' | 'lin';

export interface CrossfadeConfig {
  durationSeconds: number;
  curve: CrossfadeCurve;
  enabled: boolean;
  loudnessNorm: boolean;
}

export interface CrossfadeTrackInput {
  videoId: string;
  normalizedPath: string;
  duration: number;
}

export interface CrossfadeBodySegmentRequest {
  startSeconds: number;
  durationSeconds: number;
  keyTag?: string;
}

export interface CrossfadeResult {
  aBodyPath: string;
  crossfadePath: string;
  bBodyPath: string;
  aBodyDuration: number;
  bBodyDuration: number;
  crossfadeDuration: number;
  skipped: boolean;
}

export interface CrossfadePreMixerOptions {
  spawnProcess?: typeof spawn;
  resolveConfig?: () => CrossfadeConfig;
}

class CrossfadeCancelledError extends Error {
  constructor() {
    super('Crossfade pre-mix cancelled');
  }
}

export class CrossfadePreMixer {
  private readonly spawnProcess: typeof spawn;
  private readonly resolveConfig: () => CrossfadeConfig;
  private readonly activeProcesses = new Set<ChildProcess>();
  private generation = 0;

  constructor(options: CrossfadePreMixerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.resolveConfig = options.resolveConfig ?? resolveCrossfadeConfigFromRuntime;
  }

  getCacheDir(): string {
    return path.join(getDataDir(), 'cache');
  }

  getCrossfadesDir(): string {
    return path.join(this.getCacheDir(), 'crossfades');
  }

  getBodiesDir(): string {
    return path.join(this.getCacheDir(), 'bodies');
  }

  cancel(): void {
    this.generation += 1;
    for (const process of this.activeProcesses) {
      try {
        process.kill();
      } catch {
        // Ignore process kill errors.
      }
    }
    this.activeProcesses.clear();
  }

  async createBodySegment(track: CrossfadeTrackInput, request: CrossfadeBodySegmentRequest): Promise<string> {
    this.ensureCacheDirs();
    const normalizedRequest = normalizeBodySegmentRequest(track.duration, request);
    const cacheKey = request.keyTag ?? `s${secondsToken(normalizedRequest.startSeconds)}_d${secondsToken(normalizedRequest.durationSeconds)}`;
    const outputPath = path.join(this.getBodiesDir(), `${safeKey(track.videoId)}_body_${cacheKey}.wav`);
    const generation = this.generation;
    await this.createBodySegmentInternal(track, normalizedRequest.startSeconds, normalizedRequest.durationSeconds, outputPath, generation);
    return outputPath;
  }

  async createCrossfade(
    trackA: CrossfadeTrackInput,
    trackB: CrossfadeTrackInput,
    overrideConfig: Partial<CrossfadeConfig> = {},
  ): Promise<CrossfadeResult> {
    this.ensureCacheDirs();
    const config = mergeCrossfadeConfig(this.resolveConfig(), overrideConfig);
    const requestedDuration = Math.max(0.1, config.durationSeconds);
    if (!config.enabled || shouldSkipCrossfade(trackA.duration, trackB.duration, requestedDuration)) {
      return {
        aBodyPath: trackA.normalizedPath,
        crossfadePath: '',
        bBodyPath: trackB.normalizedPath,
        aBodyDuration: trackA.duration,
        bBodyDuration: trackB.duration,
        crossfadeDuration: 0,
        skipped: true,
      };
    }

    const ffmpegCurve = mapCurveToFfmpeg(config.curve);
    const configToken = `d${secondsToken(requestedDuration)}_c${ffmpegCurve}_ln${config.loudnessNorm ? '1' : '0'}`;
    const aBodyDuration = Math.max(0, trackA.duration - requestedDuration);
    const bBodyDuration = Math.max(0, trackB.duration - requestedDuration);
    const aBodyPath = path.join(this.getBodiesDir(), `${safeKey(trackA.videoId)}_body_head_${configToken}.wav`);
    const bBodyPath = path.join(this.getBodiesDir(), `${safeKey(trackB.videoId)}_body_tail_${configToken}.wav`);
    const crossfadePath = path.join(
      this.getCrossfadesDir(),
      `${safeKey(trackA.videoId)}_${safeKey(trackB.videoId)}_${configToken}.wav`,
    );

    if (fs.existsSync(aBodyPath) && fs.existsSync(bBodyPath) && fs.existsSync(crossfadePath)) {
      return {
        aBodyPath,
        bBodyPath,
        crossfadePath,
        aBodyDuration,
        bBodyDuration,
        crossfadeDuration: requestedDuration,
        skipped: false,
      };
    }

    const generation = this.generation;
    const tempTail = path.join(this.getCrossfadesDir(), `${safeKey(trackA.videoId)}-tail-${randomUUID()}.wav`);
    const tempHead = path.join(this.getCrossfadesDir(), `${safeKey(trackB.videoId)}-head-${randomUUID()}.wav`);

    try {
      await this.runFfmpeg(['-y', '-sseof', `-${toFfmpegTime(requestedDuration)}`, '-i', trackA.normalizedPath, '-f', 'wav', tempTail], generation);
      await this.runFfmpeg(['-y', '-t', toFfmpegTime(requestedDuration), '-i', trackB.normalizedPath, '-f', 'wav', tempHead], generation);

      const filterGraph = [
        '[0]volume=-3dB[a]',
        '[1]volume=-3dB[b]',
        `[a][b]acrossfade=d=${toFfmpegTime(requestedDuration)}:c1=${ffmpegCurve}:c2=${ffmpegCurve},alimiter=limit=0.95:attack=0.1:release=50`,
      ].join(';');
      await this.runFfmpeg([
        '-y',
        '-i',
        tempTail,
        '-i',
        tempHead,
        '-filter_complex',
        filterGraph,
        '-f',
        'wav',
        crossfadePath,
      ], generation);

      await this.createBodySegmentInternal(trackA, 0, aBodyDuration, aBodyPath, generation);
      await this.createBodySegmentInternal(trackB, requestedDuration, bBodyDuration, bBodyPath, generation);

      return {
        aBodyPath,
        bBodyPath,
        crossfadePath,
        aBodyDuration,
        bBodyDuration,
        crossfadeDuration: requestedDuration,
        skipped: false,
      };
    } catch (error) {
      if (error instanceof CrossfadeCancelledError) {
        this.safeRemove(crossfadePath);
        this.safeRemove(aBodyPath);
        this.safeRemove(bBodyPath);
      }
      throw error;
    } finally {
      this.safeRemove(tempTail);
      this.safeRemove(tempHead);
    }
  }

  cleanup(videoIdA: string, videoIdB: string): void {
    this.removeByPrefix(this.getCrossfadesDir(), `${safeKey(videoIdA)}_${safeKey(videoIdB)}_`);
    this.removeByPrefix(this.getBodiesDir(), `${safeKey(videoIdA)}_body_`);
    this.removeByPrefix(this.getBodiesDir(), `${safeKey(videoIdB)}_body_`);
  }

  private async createBodySegmentInternal(
    track: CrossfadeTrackInput,
    startSeconds: number,
    durationSeconds: number,
    outputPath: string,
    generation: number,
  ): Promise<void> {
    if (fs.existsSync(outputPath)) {
      return;
    }
    const args = ['-y', '-ss', toFfmpegTime(startSeconds), '-i', track.normalizedPath, '-t', toFfmpegTime(durationSeconds), '-f', 'wav', outputPath];
    await this.runFfmpeg(args, generation);
  }

  private async runFfmpeg(args: string[], generation: number): Promise<void> {
    if (generation !== this.generation) {
      throw new CrossfadeCancelledError();
    }

    await new Promise<void>((resolve, reject) => {
      let childProcess: ChildProcess;
      try {
        childProcess = this.spawnProcess('ffmpeg', args, FFMPEG_PROCESS_OPTS);
      } catch (error) {
        reject(error);
        return;
      }

      this.activeProcesses.add(childProcess);
      let stderr = '';
      childProcess.stderr?.setEncoding('utf8');
      childProcess.stderr?.on('data', (chunk: string) => { stderr += chunk; });
      childProcess.once('error', (error) => {
        this.activeProcesses.delete(childProcess);
        reject(error);
      });
      childProcess.once('close', (code, signal) => {
        this.activeProcesses.delete(childProcess);
        if (generation !== this.generation || signal === 'SIGTERM') {
          reject(new CrossfadeCancelledError());
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg failed: ${stderr.trim() || `exit code ${code ?? 'unknown'}`}`));
      });
    });

    if (generation !== this.generation) {
      throw new CrossfadeCancelledError();
    }
  }

  private removeByPrefix(directory: string, prefix: string): void {
    if (!fs.existsSync(directory)) {
      return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(prefix)) {
        this.safeRemove(path.join(directory, entry.name));
      }
    }
  }

  private safeRemove(filePath: string): void {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }

  private ensureCacheDirs(): void {
    fs.mkdirSync(this.getCrossfadesDir(), { recursive: true });
    fs.mkdirSync(this.getBodiesDir(), { recursive: true });
  }
}

let crossfadePreMixer: CrossfadePreMixer | null = null;

export function createCrossfadePreMixer(options: CrossfadePreMixerOptions = {}): CrossfadePreMixer {
  if (!crossfadePreMixer) {
    crossfadePreMixer = new CrossfadePreMixer(options);
  }
  return crossfadePreMixer;
}

export function getCrossfadePreMixer(): CrossfadePreMixer | null {
  return crossfadePreMixer;
}

export function shouldSkipCrossfade(durationA: number, durationB: number, crossfadeDuration: number): boolean {
  return durationA < crossfadeDuration * 2 || durationB < crossfadeDuration * 2;
}

function mergeCrossfadeConfig(baseConfig: CrossfadeConfig, overrideConfig: Partial<CrossfadeConfig>): CrossfadeConfig {
  return {
    enabled: overrideConfig.enabled ?? baseConfig.enabled,
    durationSeconds: overrideConfig.durationSeconds ?? baseConfig.durationSeconds,
    curve: overrideConfig.curve ?? baseConfig.curve,
    loudnessNorm: overrideConfig.loudnessNorm ?? baseConfig.loudnessNorm,
  };
}

function resolveCrossfadeConfigFromRuntime(): CrossfadeConfig {
  return mapRuntimeCrossfadeConfigToPreMixerConfig(loadRuntimeConfig().crossfade);
}

export function mapRuntimeCrossfadeConfigToPreMixerConfig(
  runtimeCrossfade?: Partial<RuntimeCrossfadeConfig>,
): CrossfadeConfig {
  return mergeCrossfadeConfig(DEFAULT_CROSSFADE_CONFIG, {
    curve: runtimeCrossfade?.curve,
    durationSeconds: runtimeCrossfade?.duration,
    enabled: runtimeCrossfade?.enabled,
    loudnessNorm: runtimeCrossfade?.loudnessNorm,
  });
}

function mapCurveToFfmpeg(curve: CrossfadeCurve): 'exp' | 'log' | 'tri' {
  if (curve === 'lin') {
    return 'tri';
  }
  return curve;
}

function normalizeBodySegmentRequest(trackDuration: number, request: CrossfadeBodySegmentRequest): CrossfadeBodySegmentRequest {
  const startSeconds = clampFiniteNumber(request.startSeconds, 0, trackDuration);
  const maxDuration = Math.max(0, trackDuration - startSeconds);
  const durationSeconds = clampFiniteNumber(request.durationSeconds, 0, maxDuration);
  if (durationSeconds <= 0) {
    throw new Error('Body segment duration must be greater than zero.');
  }
  return {
    ...request,
    startSeconds,
    durationSeconds,
  };
}

function clampFiniteNumber(value: unknown, minValue: number, maxValue: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minValue;
  }
  return Math.max(minValue, Math.min(maxValue, value));
}

function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '_');
}

function secondsToken(value: number): string {
  return toFfmpegTime(value).replace('.', '_');
}

function toFfmpegTime(value: number): string {
  const fixed = Number.isFinite(value) ? value.toFixed(3) : '0.000';
  return fixed.replace(/\.?0+$/u, '');
}
