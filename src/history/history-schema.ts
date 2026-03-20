// SQLite schema definitions and track ID normalization for play history.

export const HISTORY_SCHEMA_VERSION = 3;

/**
 * Normalize artist + title into a deterministic track ID.
 * Collapses whitespace and lowercases for dedup.
 * Example: normalizeTrackId("Nils  Frahm", "Says") → "nils frahm::says"
 */
export function normalizeTrackId(artist: string, title: string): string {
  const norm = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');
  return `${norm(artist)}::${norm(title)}`;
}

export const TRACKS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS tracks (
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
`;

export const PLAYS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  started_at INTEGER NOT NULL,
  played_sec INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  context_json TEXT DEFAULT '{}'
);
`;

export const SESSION_STATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS session_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  persona_taste_text TEXT DEFAULT ''
);
`;

export const PROVIDER_CACHE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS provider_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

export const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_plays_track_id ON plays(track_id);
CREATE INDEX IF NOT EXISTS idx_plays_started_at ON plays(started_at);
CREATE INDEX IF NOT EXISTS idx_plays_track_id_started_at ON plays(track_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC) WHERE play_count > 0;
CREATE INDEX IF NOT EXISTS idx_provider_cache_fetched_at ON provider_cache(fetched_at);
`;

export const SCHEMA_SQL = [
  TRACKS_TABLE_SQL,
  PLAYS_TABLE_SQL,
  SESSION_STATE_TABLE_SQL,
  PROVIDER_CACHE_TABLE_SQL,
  INDEXES_SQL,
].join('\n');
