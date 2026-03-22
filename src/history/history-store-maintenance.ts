import type Database from 'better-sqlite3';

export interface HistoryDatabaseStats {
  dbPath: string;
  counts: {
    plays: number;
    tracks: number;
    providerCache: number;
  };
}

export interface HistoryCleanupResult {
  stats: HistoryDatabaseStats;
  removed: {
    plays: number;
    tracks: number;
    providerCache: number;
  };
}

export function getHistoryDatabaseStats(db: Database.Database, dbPath: string): HistoryDatabaseStats {
  return {
    dbPath,
    counts: {
      plays: countRows(db, 'plays'),
      tracks: countRows(db, 'tracks'),
      providerCache: countRows(db, 'provider_cache'),
    },
  };
}

export function clearHistoryData(db: Database.Database, dbPath: string): HistoryCleanupResult {
  const removed = {
    plays: countRows(db, 'plays'),
    tracks: countRows(db, 'tracks'),
    providerCache: 0,
  };

  db.transaction(() => {
    db.prepare('DELETE FROM plays').run();
    db.prepare('DELETE FROM tracks WHERE NOT EXISTS (SELECT 1 FROM plays WHERE plays.track_id = tracks.id)').run();
  })();
  runHistoryDatabaseMaintenance(db);

  return {
    removed,
    stats: getHistoryDatabaseStats(db, dbPath),
  };
}

export function clearProviderCacheData(db: Database.Database, dbPath: string): HistoryCleanupResult {
  const removed = {
    plays: 0,
    tracks: 0,
    providerCache: countRows(db, 'provider_cache'),
  };

  db.prepare('DELETE FROM provider_cache').run();
  runHistoryDatabaseMaintenance(db);

  return {
    removed,
    stats: getHistoryDatabaseStats(db, dbPath),
  };
}

export function fullResetData(db: Database.Database, dbPath: string): HistoryCleanupResult {
  const removed = {
    plays: countRows(db, 'plays'),
    tracks: countRows(db, 'tracks'),
    providerCache: countRows(db, 'provider_cache'),
  };

  db.transaction(() => {
    db.prepare('DELETE FROM provider_cache').run();
    db.prepare('DELETE FROM plays').run();
    db.prepare('DELETE FROM tracks WHERE NOT EXISTS (SELECT 1 FROM plays WHERE plays.track_id = tracks.id)').run();
  })();
  runHistoryDatabaseMaintenance(db);

  return {
    removed,
    stats: getHistoryDatabaseStats(db, dbPath),
  };
}

export function runHistoryDatabaseMaintenance(db: Database.Database): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  db.pragma('optimize');
}

const VALID_TABLE_NAMES = new Set(['tracks', 'plays', 'provider_cache', 'session_state']);

function countRows(db: Database.Database, tableName: string): number {
  if (!VALID_TABLE_NAMES.has(tableName)) throw new Error(`Invalid table name: ${tableName}`);
  // SAFETY: tableName is validated against VALID_TABLE_NAMES allowlist above
  const row = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as { count: number };
  return row.count;
}
