import type { HistoryStore } from '../history/history-store.js';
import type { DiscoverRankingConfig } from '../runtime/runtime-config.js';
import type { DiscoverCandidate, DiscoverBatchParams } from './discover-batch-builder.js';
import { DiscoverBatchBuilder } from './discover-batch-builder.js';
import type { DiscoverPaginationCache } from './discover-pagination-cache.js';
import { getDiscoverPaginationCache } from './discover-pagination-cache.js';
import { mergeAndDedup } from './discover-merge-and-dedup.js';
import { rankCandidates } from './discover-soft-ranker.js';

export interface DiscoverRequest extends DiscoverBatchParams {
  page?: number;
  limit?: number;
  mode?: unknown;
  intent?: unknown;
}

export interface PublicDiscoverCandidate {
  title: string;
  artist: string;
  keywords: string[];
  provider: 'apple';
}

export interface DiscoverResponse {
  page: number;
  limit: number;
  hasMore: boolean;
  candidates: PublicDiscoverCandidate[];
  nextGuide: string;
  emptyReason?: 'no_candidates' | 'page_exhausted';
}

export class DiscoverPipeline {
  constructor(
    private readonly batchBuilder: DiscoverBatchBuilder,
    private readonly store: Pick<HistoryStore, 'getTopArtists' | 'getTopTags' | 'getRecentPlaysDetailed' | 'batchGetTrackStats'>,
    private readonly discoverRanking: DiscoverRankingConfig,
    private readonly cache: DiscoverPaginationCache,
  ) {}

  async discover(params: DiscoverRequest): Promise<DiscoverResponse> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 10;
    const cacheParams = { artist: params.artist, keywords: params.keywords };

    const cachedPage = this.cache.getPage(cacheParams, page, limit);
    if (cachedPage) {
      return buildDiscoverResponse(
        cachedPage.candidates,
        page,
        limit,
        cachedPage.hasMore,
        cachedPage.candidates.length === 0 ? 'page_exhausted' : undefined,
      );
    }

    const rawCandidates = await this.batchBuilder.buildBatches(cacheParams);
    if (rawCandidates.length === 0) {
      return buildDiscoverResponse([], page, limit, false, 'no_candidates');
    }

    const dedupedCandidates = mergeAndDedup(rawCandidates);
    const rankedCandidates = rankCandidates(dedupedCandidates, this.discoverRanking, this.store);
    this.cache.setSnapshot(cacheParams, rankedCandidates);

    const pagedCandidates = this.cache.getPage(cacheParams, page, limit);
    if (pagedCandidates) {
      return buildDiscoverResponse(
        pagedCandidates.candidates,
        page,
        limit,
        pagedCandidates.hasMore,
        pagedCandidates.candidates.length === 0 ? 'page_exhausted' : undefined,
      );
    }

    const candidates = rankedCandidates.slice((page - 1) * limit, page * limit);
    return buildDiscoverResponse(
      candidates,
      page,
      limit,
      page * limit < rankedCandidates.length,
      candidates.length === 0 ? 'page_exhausted' : undefined,
    );
  }
}

function buildDiscoverResponse(
  candidates: DiscoverCandidate[],
  page: number,
  limit: number,
  hasMore: boolean,
  emptyReason?: 'no_candidates' | 'page_exhausted',
): DiscoverResponse {
  return {
    page,
    limit,
    hasMore,
    candidates: candidates.map((candidate) => toPublicCandidate(candidate)),
    nextGuide: getNextGuide(candidates.length, hasMore, emptyReason),
    emptyReason,
  };
}

function toPublicCandidate(candidate: DiscoverCandidate): PublicDiscoverCandidate {
  return {
    title: candidate.title,
    artist: candidate.artist,
    keywords: candidate.tags,
    provider: candidate.provider,
  };
}

function getNextGuide(
  candidateCount: number,
  hasMore: boolean,
  emptyReason?: 'no_candidates' | 'page_exhausted',
): string {
  if (candidateCount === 0) {
    return emptyReason === 'page_exhausted'
      ? 'No more results on this page. Go back to an earlier page or improve artist/keywords input.'
      : 'No candidates found. Improve artist/keywords input or build more listening history first.';
  }

  return hasMore
    ? 'Pick from these candidates or call discover with the next page.'
    : 'Pick from these candidates or improve artist/keywords input for a fresh search.';
}

let discoverPipeline: DiscoverPipeline | null = null;

export function createDiscoverPipeline(
  batchBuilder: DiscoverBatchBuilder,
  store: Pick<HistoryStore, 'getTopArtists' | 'getTopTags' | 'getRecentPlaysDetailed' | 'batchGetTrackStats'>,
  discoverRanking: DiscoverRankingConfig,
  cache = getDiscoverPaginationCache(),
): DiscoverPipeline {
  if (!discoverPipeline) {
    discoverPipeline = new DiscoverPipeline(batchBuilder, store, discoverRanking, cache);
  }
  return discoverPipeline;
}

export function getDiscoverPipeline(): DiscoverPipeline | null {
  return discoverPipeline;
}
