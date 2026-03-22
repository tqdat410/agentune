import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';

const CONNECT_RETRY_DELAY_MS = 50;
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
};

type MpvMessage = {
  data?: unknown;
  error?: string;
  event?: string;
  id?: number;
  name?: string;
  request_id?: number;
  result?: unknown;
};

type PropertyChangeEvent = {
  data?: unknown;
  id?: number;
  name: string;
};

export class MpvIpcClient extends EventEmitter {
  private buffer = '';
  private connectPromise: Promise<void> | null = null;
  private destroyed = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private socket: Socket | null = null;

  connect(socketPath: string, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectWithRetry(socketPath, Date.now() + timeoutMs);
    return this.connectPromise;
  }

  async command(name: string, ...args: unknown[]): Promise<unknown> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket) {
      throw new Error('mpv IPC socket is unavailable.');
    }

    const requestId = this.nextRequestId++;
    return await new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      try {
        socket.write(JSON.stringify({
          command: [name, ...args],
          request_id: requestId,
        }) + '\n');
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  async getProperty(name: string): Promise<unknown> {
    return await this.command('get_property', name);
  }

  async observeProperty(id: number, name: string): Promise<void> {
    await this.command('observe_property', id, name);
  }

  notify(name: string, ...args: unknown[]): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    socket.write(JSON.stringify({ command: [name, ...args] }) + '\n');
  }

  destroy(): void {
    this.destroyed = true;
    this.rejectPendingRequests(new Error('mpv IPC client destroyed.'));
    this.socket?.destroy();
    this.socket = null;
  }

  private connectWithRetry(socketPath: string, deadline: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const attemptConnection = () => {
        if (this.destroyed) {
          reject(new Error('mpv IPC client destroyed.'));
          return;
        }

        const socket = createConnection(socketPath);
        socket.once('connect', () => {
          this.attachSocket(socket);
          resolve();
        });
        socket.once('error', (error: NodeJS.ErrnoException) => {
          socket.destroy();
          if (Date.now() < deadline && isRetryableConnectionError(error)) {
            setTimeout(attemptConnection, CONNECT_RETRY_DELAY_MS);
            return;
          }
          reject(error);
        });
      };

      attemptConnection();
    });
  }

  private attachSocket(socket: Socket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.consumeBufferedLines();
    });
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.rejectPendingRequests(new Error('mpv IPC connection closed.'));
      if (!this.destroyed) {
        this.emit('disconnect');
      }
    });
  }

  private consumeBufferedLines(): void {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      this.handleIncomingMessage(line);
    }
  }

  private ensureConnected(): Promise<void> {
    if (!this.connectPromise) {
      throw new Error('mpv IPC client is not connected.');
    }
    return this.connectPromise;
  }

  private handleIncomingMessage(line: string): void {
    const message = JSON.parse(line) as MpvMessage;
    if (typeof message.request_id === 'number') {
      this.resolvePendingRequest(message);
      return;
    }

    if (message.event === 'property-change' && typeof message.name === 'string') {
      this.emit('property-change', {
        data: message.data,
        id: message.id,
        name: message.name,
      } satisfies PropertyChangeEvent);
      return;
    }

    if (message.event) {
      this.emit('event', message);
    }
  }

  private rejectPendingRequests(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      pendingRequest.reject(error);
    }
    this.pendingRequests.clear();
  }

  private resolvePendingRequest(message: MpvMessage): void {
    const pendingRequest = this.pendingRequests.get(message.request_id!);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(message.request_id!);
    if (message.error && message.error !== 'success') {
      pendingRequest.reject(new Error(`mpv command failed: ${message.error}`));
      return;
    }

    pendingRequest.resolve(message.data ?? message.result);
  }
}

function isRetryableConnectionError(error: NodeJS.ErrnoException): boolean {
  return error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
}
