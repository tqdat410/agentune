import type Database from 'better-sqlite3';
import {
  HISTORY_SCHEMA_VERSION,
  INDEXES_SQL,
  PLAYS_TABLE_SQL,
  PROVIDER_CACHE_TABLE_SQL,
  SESSION_STATE_TABLE_SQL,
  TRACKS_TABLE_SQL,
} from './history-schema.js';

export function applyHistoryStoreMigrations(db: Database.Database): void {
  const version = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (!hasAnyHistoryTables(db)) {
    db.exec([
      TRACKS_TABLE_SQL,
      PLAYS_TABLE_SQL,
      SESSION_STATE_TABLE_SQL,
      PROVIDER_CACHE_TABLE_SQL,
      INDEXES_SQL,
    ].join('\n'));
    db.pragma(`user_version = ${HISTORY_SCHEMA_VERSION}`);
    return;
  }

  if (version < HISTORY_SCHEMA_VERSION) {
    migrateToVersion3(db);
  }

  db.exec([
    TRACKS_TABLE_SQL,
    PLAYS_TABLE_SQL,
    SESSION_STATE_TABLE_SQL,
    PROVIDER_CACHE_TABLE_SQL,
    INDEXES_SQL,
  ].join('\n'));
  db.pragma(`user_version = ${HISTORY_SCHEMA_VERSION}`);
}

function migrateToVersion3(db: Database.Database): void {
  const trackColumns = getColumnNames(db, 'tracks');
  const playColumns = getColumnNames(db, 'plays');
  const sessionStateColumns = getColumnNames(db, 'session_state');

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');

  try {
    db.exec(`
      CREATE TABLE tracks_next (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_sec INTEGER DEFAULT 0,
        thumbnail TEXT DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        yt_video_id TEXT DEFAULT '',
        first_played_at INTEGER NOT NULL,
        play_count INTEGER DEFAULT 0
      );

      CREATE TABLE plays_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL REFERENCES tracks_next(id),
        started_at INTEGER NOT NULL,
        played_sec INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        context_json TEXT DEFAULT '{}'
      );

      CREATE TABLE session_state_next (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        persona_taste_text TEXT DEFAULT ''
      );
    `);

    if (trackColumns.size > 0) {
      db.exec(`
        INSERT INTO tracks_next (
          id, title, artist, duration_sec, thumbnail, tags_json, yt_video_id, first_played_at, play_count
        )
        SELECT
          id,
          title,
          artist,
          ${selectColumn(trackColumns, 'duration_sec', '0')},
          ${selectColumn(trackColumns, 'thumbnail', "''")},
          ${selectColumn(trackColumns, 'tags_json', "'[]'")},
          ${selectColumn(trackColumns, 'yt_video_id', "''")},
          ${selectColumn(trackColumns, 'first_played_at', '0')},
          ${selectColumn(trackColumns, 'play_count', '0')}
        FROM tracks
      `);
    }

    if (playColumns.size > 0) {
      db.exec(`
        INSERT INTO plays_next (
          id, track_id, started_at, played_sec, skipped, context_json
        )
        SELECT
          id,
          track_id,
          started_at,
          ${selectColumn(playColumns, 'played_sec', '0')},
          ${selectColumn(playColumns, 'skipped', '0')},
          ${selectColumn(playColumns, 'context_json', "'{}'")}
        FROM plays
      `);
    }

    if (sessionStateColumns.size > 0) {
      db.exec(`
        INSERT INTO session_state_next (id, persona_taste_text)
        SELECT
          id,
          ${selectColumn(sessionStateColumns, 'persona_taste_text', "''")}
        FROM session_state
        WHERE id = 1
      `);
    }

    db.exec(`
      DROP TABLE IF EXISTS plays;
      DROP TABLE IF EXISTS tracks;
      DROP TABLE IF EXISTS session_state;
      DROP TABLE IF EXISTS preferences;
      ALTER TABLE tracks_next RENAME TO tracks;
      ALTER TABLE plays_next RENAME TO plays;
      ALTER TABLE session_state_next RENAME TO session_state;
    `);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function hasAnyHistoryTables(db: Database.Database): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('tracks', 'plays', 'session_state', 'provider_cache', 'preferences')
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  return !!row;
}

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  const tableExists = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName) as Record<string, unknown> | undefined;

  if (!tableExists) {
    return new Set();
  }

  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(columns.map((column) => column.name));
}

function selectColumn(columns: Set<string>, columnName: string, fallbackSql: string): string {
  return columns.has(columnName) ? columnName : fallbackSql;
}
