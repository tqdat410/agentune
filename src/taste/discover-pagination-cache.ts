import type { DiscoverCandidate } from './discover-batch-builder.js';

export interface DiscoverPaginationParams {
  artist?: string;
  keywords?: string[];
}

interface SnapshotEntry {
  candidates: DiscoverCandidate[];
  createdAt: number;
}

export class DiscoverPaginationCache {
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private accessOrder: string[] = [];

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly maxEntries = 10,
  ) {}

  getPage(
    params: DiscoverPaginationParams,
    page: number,
    limit: number,
  ): { candidates: DiscoverCandidate[]; hasMore: boolean } | null {
    const key = this.computeKey(params);
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return null;

    if (Date.now() - snapshot.createdAt > this.ttlMs) {
      this.deleteSnapshot(key);
      return null;
    }

    this.touchKey(key);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    return {
      candidates: snapshot.candidates.slice(startIndex, endIndex),
      hasMore: endIndex < snapshot.candidates.length,
    };
  }

  setSnapshot(params: DiscoverPaginationParams, candidates: DiscoverCandidate[]): void {
    if (candidates.length === 0) return;

    const key = this.computeKey(params);
    if (!this.snapshots.has(key) && this.snapshots.size >= this.maxEntries) {
      const evictedKey = this.accessOrder.shift();
      if (evictedKey) this.snapshots.delete(evictedKey);
    }

    this.snapshots.set(key, {
      candidates: [...candidates],
      createdAt: Date.now(),
    });
    this.touchKey(key);
  }

  invalidate(): void {
    this.snapshots.clear();
    this.accessOrder = [];
  }

  private computeKey(params: DiscoverPaginationParams): string {
    const artist = normalizeValue(params.artist);
    const keywords = [...new Set((params.keywords ?? []).map((keyword) => normalizeValue(keyword)).filter(Boolean))]
      .sort()
      .join(',');
    return `${artist}|${keywords}`;
  }

  private deleteSnapshot(key: string): void {
    this.snapshots.delete(key);
    this.accessOrder = this.accessOrder.filter((entry) => entry !== key);
  }

  private touchKey(key: string): void {
    this.accessOrder = this.accessOrder.filter((entry) => entry !== key);
    this.accessOrder.push(key);
  }
}

let discoverPaginationCache: DiscoverPaginationCache | null = null;

export function getDiscoverPaginationCache(): DiscoverPaginationCache {
  if (!discoverPaginationCache) {
    discoverPaginationCache = new DiscoverPaginationCache();
  }
  return discoverPaginationCache;
}

export function invalidateDiscoverCache(): void {
  getDiscoverPaginationCache().invalidate();
}

function normalizeValue(value?: string): string {
  return value?.toLowerCase().trim() ?? '';
}
