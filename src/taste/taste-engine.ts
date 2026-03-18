// Agent-first taste engine — computes 3 behavioral traits from history,
// provides time context, and manages free-text persona taste description.
// No scoring/decay — agent reasons from raw data.

import type { HistoryStore } from '../history/history-store.js';
import { normalizeTrackId } from '../history/history-schema.js';

// --- Interfaces ---

export interface PersonaTraits {
  exploration: number;  // 0-1: ratio of new artists in recent plays
  variety: number;      // 0-1: normalized Shannon entropy of tags
  loyalty: number;      // 0-1: ratio of replayed high-completion tracks
}

export interface TimeContext {
  hour: number;
  period: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;
}

export interface TrackInfo {
  artist: string;
  title: string;
  duration?: number;
}

export interface SessionSummary {
  context: TimeContext;
  persona: { traits: PersonaTraits; taste: string };
  history: {
    recent: Array<{ title: string; artist: string; completion: number; skipped: boolean }>;
    stats: { topArtists: Array<{ artist: string; plays: number }>; topTags: Array<{ tag: string; frequency: number }> };
  };
}

// --- Constants ---

const RECENT_PLAYS_FOR_TRAITS = 20;
const MIN_PLAYS_FOR_TRAITS = 10;
const DEFAULT_TRAIT = 0.5;
const MAX_TASTE_TEXT_LENGTH = 1000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- TasteEngine ---

export class TasteEngine {
  constructor(private readonly store: HistoryStore) {}

  /** Compute 3 behavioral traits from recent listening history. */
  computeTraits(): PersonaTraits {
    const recent = this.store.getRecentPlaysDetailed(RECENT_PLAYS_FOR_TRAITS);
    if (recent.length < MIN_PLAYS_FOR_TRAITS) {
      return { exploration: DEFAULT_TRAIT, variety: DEFAULT_TRAIT, loyalty: DEFAULT_TRAIT };
    }

    return {
      exploration: this.computeExploration(recent),
      variety: this.computeVariety(recent),
      loyalty: this.computeLoyalty(recent),
    };
  }

  /** Current time context for agent decision-making. */
  getTimeContext(): TimeContext {
    const now = new Date();
    const hour = now.getHours();
    return {
      hour,
      period: hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening',
      dayOfWeek: DAYS[now.getDay()],
    };
  }

  /** Read persisted free-text taste description. */
  getTasteText(): string {
    return this.store.getPersonaTasteText();
  }

  /** Save free-text taste description (max 1000 chars). */
  saveTasteText(text: string): void {
    this.store.savePersonaTasteText(text.slice(0, MAX_TASTE_TEXT_LENGTH));
  }

  /** Full session summary for get_session_state MCP tool. */
  getSummary(): SessionSummary {
    const recent = this.store.getRecentPlaysDetailed(5);
    const topArtists = this.store.getTopArtists(5);
    const topTags = this.store.getTopTags(5);

    return {
      context: this.getTimeContext(),
      persona: {
        traits: this.computeTraits(),
        taste: this.getTasteText(),
      },
      history: {
        recent: recent.map(r => ({
          title: r.title,
          artist: r.artist,
          completion: round2(r.completion),
          skipped: r.skipped,
        })),
        stats: {
          topArtists: topArtists.map(a => ({ artist: a.artist, plays: a.plays })),
          topTags: topTags.map(t => ({ tag: t.tag, frequency: t.frequency })),
        },
      },
    };
  }

  // --- Trait computation ---

  /** Exploration = ratio of unique new artists (≤2 total plays) in recent plays. */
  private computeExploration(recent: Array<{ artist: string }>): number {
    const topArtists = this.store.getTopArtists(100);
    const artistPlayMap = new Map(topArtists.map(a => [a.artist.toLowerCase(), a.plays]));

    const uniqueArtists = new Set<string>();
    let newArtistCount = 0;

    for (const play of recent) {
      const key = play.artist.toLowerCase();
      if (!uniqueArtists.has(key)) {
        uniqueArtists.add(key);
        const totalPlays = artistPlayMap.get(key) ?? 0;
        if (totalPlays <= 2) newArtistCount++;
      }
    }

    return clamp(newArtistCount / recent.length);
  }

  /** Variety = normalized Shannon entropy of tags across recent plays. */
  private computeVariety(recent: Array<{ tags: string[] }>): number {
    const tagFreq: Record<string, number> = {};
    let totalTags = 0;

    for (const play of recent) {
      for (const tag of play.tags) {
        const key = tag.toLowerCase();
        tagFreq[key] = (tagFreq[key] ?? 0) + 1;
        totalTags++;
      }
    }

    if (totalTags === 0) return DEFAULT_TRAIT;

    const uniqueTags = Object.keys(tagFreq).length;
    if (uniqueTags <= 1) return 0;

    // Shannon entropy: -Σ(p * log2(p))
    let entropy = 0;
    for (const count of Object.values(tagFreq)) {
      const p = count / totalTags;
      if (p > 0) entropy -= p * Math.log2(p);
    }

    // Normalize by max possible entropy (log2 of unique tag count)
    const maxEntropy = Math.log2(uniqueTags);
    return clamp(maxEntropy > 0 ? entropy / maxEntropy : DEFAULT_TRAIT);
  }

  /** Loyalty = ratio of replayed tracks (>1 play, avgCompletion > 0.7) in recent plays. */
  private computeLoyalty(recent: Array<{ title: string; artist: string; completion: number }>): number {
    let replayCount = 0;

    for (const play of recent) {
      const stats = this.store.getTrackStats(normalizeTrackId(play.artist, play.title));
      if (stats.playCount > 1 && stats.avgCompletion > 0.7) {
        replayCount++;
      }
    }

    return clamp(replayCount / recent.length);
  }
}

// --- Helpers ---

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Singleton ---

let tasteEngine: TasteEngine | null = null;

export function createTasteEngine(store: HistoryStore): TasteEngine {
  if (!tasteEngine) {
    tasteEngine = new TasteEngine(store);
  }
  return tasteEngine;
}

export function getTasteEngine(): TasteEngine | null {
  return tasteEngine;
}
