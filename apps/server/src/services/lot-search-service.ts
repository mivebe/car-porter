import type { AuctionSource, Lot, LotSearchFilters, SourceErrorInfo } from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import { cached } from '../scraping/cached.ts';
import type { AuctionSearchAdapter } from '../sources/auction-adapter.ts';

export const LOT_SEARCH_TTL_MS = 30 * 60 * 1000;

export type LotSourceResult =
  | {
      source: AuctionSource;
      ok: true;
      total: number;
      count: number;
      hasMore: boolean;
      fetchedAt: string;
      fromCache: boolean;
      stale: boolean;
      error?: SourceErrorInfo;
    }
  | { source: AuctionSource; ok: false; error: SourceErrorInfo };

export interface LotSearchResponse {
  lots: Lot[];
  sources: LotSourceResult[];
  page: number;
}

export function lotSearchCacheKey(source: string, f: LotSearchFilters, page: number) {
  const norm = (s: string) => s.trim().toLowerCase();
  return `lots:${source}:${norm(f.make)}:${norm(f.model)}:${f.yearFrom}-${f.yearTo}:p${page}`;
}

export function createLotSearchService(deps: {
  adapters: AuctionSearchAdapter[];
  cache: CacheRepository;
  lots: LotsRepository;
}) {
  async function search(filters: LotSearchFilters, page: number, force = false): Promise<LotSearchResponse> {
    const perSource = await Promise.all(
      deps.adapters.map(async (adapter) => {
        const result = await cached(
          deps.cache,
          { key: lotSearchCacheKey(adapter.source, filters, page), source: adapter.source, ttlMs: LOT_SEARCH_TTL_MS, force },
          () => adapter.search(filters, page),
        );
        return { adapter, result };
      }),
    );

    const lots: Lot[] = [];
    const sources: LotSourceResult[] = [];
    for (const { adapter, result } of perSource) {
      if (!result.ok) {
        sources.push({ source: adapter.source, ok: false, error: result.error });
        continue;
      }
      const { data } = result;
      lots.push(...data.lots);
      sources.push({
        source: adapter.source,
        ok: true,
        total: data.total,
        count: data.lots.length,
        hasMore: data.page * data.pageSize < data.total,
        fetchedAt: result.fetchedAt.toISOString(),
        fromCache: result.fromCache,
        stale: result.stale,
        ...(result.error ? { error: result.error } : {}),
      });
    }

    await deps.lots.upsertMany(lots);
    return { lots, sources, page };
  }

  return { search };
}

export type LotSearchService = ReturnType<typeof createLotSearchService>;
