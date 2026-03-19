import type { DiscoverCandidate } from './discover-batch-builder.js';

export function mergeAndDedup(candidates: DiscoverCandidate[]): DiscoverCandidate[] {
  const deduped = deduplicateCandidates(candidates);
  return interleaveArtists(deduped);
}

function deduplicateCandidates(candidates: DiscoverCandidate[]): DiscoverCandidate[] {
  const seen = new Map<string, DiscoverCandidate>();
  const deduped: DiscoverCandidate[] = [];

  for (const candidate of candidates) {
    const key = normalizeCandidateKey(candidate);
    const existingCandidate = seen.get(key);
    if (existingCandidate) {
      existingCandidate.tags = mergeTags(existingCandidate.tags, candidate.tags);
      existingCandidate.appleTrackId ??= candidate.appleTrackId;
      existingCandidate.appleArtistId ??= candidate.appleArtistId;
      continue;
    }

    const nextCandidate = { ...candidate, tags: [...candidate.tags] };
    seen.set(key, nextCandidate);
    deduped.push(nextCandidate);
  }

  return deduped;
}

function interleaveArtists(candidates: DiscoverCandidate[]): DiscoverCandidate[] {
  const grouped = new Map<string, DiscoverCandidate[]>();
  const artistOrder: string[] = [];

  for (const candidate of candidates) {
    const artistKey = normalizeValue(candidate.artist);
    const artistCandidates = grouped.get(artistKey);
    if (!artistCandidates) {
      grouped.set(artistKey, [candidate]);
      artistOrder.push(artistKey);
      continue;
    }

    if (artistCandidates.length < 3) {
      artistCandidates.push(candidate);
    }
  }

  const merged: DiscoverCandidate[] = [];
  let hasRemaining = true;

  while (hasRemaining) {
    hasRemaining = false;
    for (const artistKey of artistOrder) {
      const artistCandidates = grouped.get(artistKey);
      const nextCandidate = artistCandidates?.shift();
      if (!nextCandidate) continue;
      merged.push(nextCandidate);
      hasRemaining = true;
    }
  }

  return merged;
}

function normalizeCandidateKey(candidate: DiscoverCandidate): string {
  return `${normalizeValue(candidate.artist)}::${normalizeValue(candidate.title)}`;
}

function mergeTags(currentTags: string[], nextTags: string[]): string[] {
  const mergedTags: string[] = [];
  const seen = new Set<string>();

  for (const tag of [...currentTags, ...nextTags]) {
    const normalizedTag = normalizeValue(tag);
    if (!normalizedTag || seen.has(normalizedTag)) continue;
    seen.add(normalizedTag);
    mergedTags.push(tag);
  }

  return mergedTags;
}

function normalizeValue(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}
