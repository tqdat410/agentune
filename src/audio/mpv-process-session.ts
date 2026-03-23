import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { cleanupStaleIpcPath, spawnMpvProcess } from './mpv-launch-helpers.js';
import { MpvIpcClient } from './mpv-ipc-client.js';

type MpvProcessSessionOptions = {
  binary?: string;
  ipcPath: string;
};

export type MpvProcessExitEvent = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

export type MpvPropertyChangeEvent = {
  data?: unknown;
  id?: number;
  name: string;
};

const OBSERVE_PAUSE_ID = 1;
const OBSERVE_IDLE_ACTIVE_ID = 2;
const OBSERVE_PLAYLIST_POS_ID = 3;

export class MpvProcessSession extends EventEmitter {
  private readonly client = new MpvIpcClient();
  private destroyed = false;
  private process: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly options: MpvProcessSessionOptions) {
    super();
    this.client.on('property-change', (event: MpvPropertyChangeEvent) => {
      this.emit('property-change', event);
    });
  }

  start(): void {
    if (this.readyPromise) {
      return;
    }

    cleanupStaleIpcPath(this.options.ipcPath);
    this.process = spawnMpvProcess(this.options.ipcPath, this.options.binary);
    this.process.once('exit', (code, signal) => {
      this.emit('exit', { code, signal } satisfies MpvProcessExitEvent);
    });

    const exitedBeforeReady = new Promise<never>((_, reject) => {
      this.process?.once('exit', () => {
        reject(new Error('mpv exited before IPC was ready.'));
      });
    });

    this.readyPromise = Promise.race([
      this.client.connect(this.options.ipcPath),
      exitedBeforeReady,
    ]).then(async () => {
      await this.client.observeProperty(OBSERVE_PAUSE_ID, 'pause');
      await this.client.observeProperty(OBSERVE_IDLE_ACTIVE_ID, 'idle-active');
      await this.client.observeProperty(OBSERVE_PLAYLIST_POS_ID, 'playlist-pos');
    });
  }

  async loadFile(url: string): Promise<void> {
    await this.command('loadfile', url, 'replace');
  }

  async setPause(paused: boolean): Promise<void> {
    await this.command('set_property', 'pause', paused);
  }

  async setVolume(level: number): Promise<void> {
    await this.command('set_property', 'volume', level);
  }

  async setMute(muted: boolean): Promise<void> {
    await this.command('set_property', 'mute', muted);
  }

  async appendToPlaylist(filePath: string): Promise<void> {
    await this.command('loadfile', filePath, 'append');
  }

  async clearPlaylist(): Promise<void> {
    await this.command('playlist-clear');
  }

  async getPlaylistCount(): Promise<number> {
    const value = await this.getProperty('playlist-count');
    return typeof value === 'number' ? value : 0;
  }

  async stop(): Promise<void> {
    await this.command('stop');
  }

  async getProperty(name: string): Promise<unknown> {
    await this.ensureReady();
    return await this.client.getProperty(name);
  }

  destroy(): void {
    this.destroyed = true;
    this.client.notify('quit');
    this.client.destroy();

    const child = this.process;
    this.process = null;
    if (child && child.exitCode === null && !child.killed) {
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill();
          } catch {
            // mpv already exited.
          }
        }
      }, 100);
    }

    cleanupStaleIpcPath(this.options.ipcPath);
  }

  private async command(name: string, ...args: unknown[]): Promise<void> {
    await this.ensureReady();
    await this.client.command(name, ...args);
  }

  private async ensureReady(): Promise<void> {
    if (this.destroyed) {
      throw new Error('mpv session destroyed.');
    }
    if (!this.readyPromise) {
      throw new Error('mpv session not started.');
    }

    await this.readyPromise;
  }
}

export function createMpvProcessSession(options: MpvProcessSessionOptions): MpvProcessSession {
  return new MpvProcessSession(options);
}
