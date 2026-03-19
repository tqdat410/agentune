// Score YouTube search results against a canonical title/artist for best match selection

import type { SearchResult } from './youtube-provider.js';

export interface ScoredResult {
  result: SearchResult;
  score: number;
  reasons: string[];
}

/** Strip punctuation, collapse whitespace, normalize to lowercase for comparison. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Known quality suffixes that YouTube appends — strip before title matching. */
const QUALITY_SUFFIXES = /\b(official audio|official video|official music video|audio|music video|lyric video|lyrics|provided to youtube|hd|hq|4k)\b/gi;

/** Strip quality suffixes for cleaner title-to-title comparison. */
function stripQualitySuffixes(text: string): string {
  return text.replace(QUALITY_SUFFIXES, '').replace(/\s+/g, ' ').trim();
}

/** Word overlap ratio between two strings. */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches / Math.max(wordsA.size, wordsB.size);
}

/** Score a single result's title match (0-1). Strips quality suffixes before comparing. */
function scoreTitleMatch(resultTitle: string, queryTitle: string): { score: number; reason: string } {
  const rt = normalize(stripQualitySuffixes(resultTitle));
  const qt = normalize(queryTitle);

  if (rt === qt) return { score: 1.0, reason: 'exact title match' };
  if (rt.startsWith(qt)) return { score: 0.8, reason: 'title starts with query' };
  if (rt.includes(qt)) return { score: 0.6, reason: 'title contains query' };

  const overlap = wordOverlap(rt, qt);
  return { score: overlap * 0.4, reason: `word overlap ${Math.round(overlap * 100)}%` };
}

/** Check if query text contains a keyword (case-insensitive). */
function queryContains(query: string, keyword: string): boolean {
  return normalize(query).includes(keyword);
}

/** Score a single search result against canonical title/artist. */
function scoreResult(result: SearchResult, title: string, artist?: string): ScoredResult {
  const reasons: string[] = [];
  let score = 0;

  // 1. Title match (0-1)
  const titleMatch = scoreTitleMatch(result.title, title);
  score += titleMatch.score;
  reasons.push(`title: ${titleMatch.reason} (${titleMatch.score.toFixed(2)})`);

  // 2. Artist match bonus (+0.3)
  if (artist) {
    const normalizedArtist = normalize(artist);
    const normalizedChannel = normalize(result.artist);
    if (normalizedChannel.includes(normalizedArtist) || normalizedArtist.includes(normalizedChannel)) {
      score += 0.3;
      reasons.push('artist match (+0.30)');
    }
  }

  // Build full query string for keyword checks
  const fullQuery = artist ? `${artist} ${title}` : title;

  // 3. Quality penalties
  const rt = normalize(result.title);
  const penalties: [string, number][] = [
    ['live', -0.3],
    ['remix', -0.25],
    ['slowed', -0.4],
    ['8d', -0.4],
    ['reverb', -0.4],
    ['teaser', -0.3],
    ['preview', -0.3],
    ['karaoke', -0.4],
    ['cover', -0.4],
    ['nightcore', -0.4],
    ['sped up', -0.4],
    ['shorts', -0.3],
    ['playlist', -0.2],
    ['full album', -0.2],
  ];
  for (const [keyword, penalty] of penalties) {
    if (rt.includes(keyword) && !queryContains(fullQuery, keyword)) {
      score += penalty;
      reasons.push(`"${keyword}" penalty (${penalty.toFixed(2)})`);
    }
  }

  // Duration penalty: >600s likely mix/compilation
  const durationSec = result.durationMs / 1000;
  if (durationSec > 600) {
    score -= 0.2;
    reasons.push('long duration penalty (-0.20)');
  }

  // 4. Quality bonuses
  if (rt.includes('official audio')) {
    score += 0.15;
    reasons.push('"official audio" bonus (+0.15)');
  }
  if (normalize(result.artist).includes('topic') || rt.includes('provided to youtube')) {
    score += 0.1;
    reasons.push('topic/auto-generated bonus (+0.10)');
  }
  if (durationSec >= 120 && durationSec <= 420) {
    score += 0.05;
    reasons.push('typical song length bonus (+0.05)');
  }

  return { result, score: Math.round(score * 100) / 100, reasons };
}

/**
 * Score and rank search results against a canonical title + optional artist.
 * Returns all results sorted by score descending.
 */
export function scoreSearchResults(
  results: SearchResult[],
  title: string,
  artist?: string,
): ScoredResult[] {
  return results
    .map((r) => scoreResult(r, title, artist))
    .sort((a, b) => b.score - a.score);
}
