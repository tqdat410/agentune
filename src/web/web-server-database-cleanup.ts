import type { HistoryCleanupResult, HistoryStore } from '../history/history-store.js';
import type { QueuePlaybackController } from '../queue/queue-playback-controller.js';
import { invalidateDiscoverCache } from '../taste/discover-pagination-cache.js';

export interface DatabaseActionResponse {
  updated: true;
  action: 'clear-history' | 'clear-provider-cache' | 'full-reset';
  removed: HistoryCleanupResult['removed'];
  stats: HistoryCleanupResult['stats'];
  message: string;
}

export function getDatabaseStatsPayload(store: HistoryStore): { stats: ReturnType<HistoryStore['getDatabaseStats']> } {
  return { stats: store.getDatabaseStats() };
}

export async function runDatabaseAction(
  action: 'clear-history' | 'clear-provider-cache' | 'full-reset',
  store: HistoryStore,
  queuePlaybackController: QueuePlaybackController | null,
): Promise<DatabaseActionResponse> {
  if (queuePlaybackController) {
    await queuePlaybackController.stopAndResetRuntimeState();
  }

  let result: HistoryCleanupResult;
  let message: string;

  if (action === 'clear-history') {
    result = store.clearHistory();
    message = 'Listening history cleared.';
  } else if (action === 'clear-provider-cache') {
    result = store.clearProviderCache();
    message = 'Provider cache cleared.';
  } else {
    result = store.fullReset();
    message = 'History and provider cache cleared.';
  }

  invalidateDiscoverCache();

  return {
    updated: true,
    action,
    removed: result.removed,
    stats: result.stats,
    message,
  };
}
