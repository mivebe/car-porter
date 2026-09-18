import {
  lotMatchesTrim,
  trimKeyword,
  trimWords,
  type AuctionSource,
  type Lot,
  type LotSearchFilters,
  type LotSearchPage,
  type SourceErrorInfo,
} from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import { cached } from '../scraping/cached.ts';
import { AUCTION_PAGE_SIZE, type AuctionSearchAdapter } from '../sources/auction-adapter.ts';
import type { MatchedNames, VehicleAliasService } from './vehicle-alias-service.ts';

export const LOT_SEARCH_TTL_MS = 30 * 60 * 1000;

export type LotSourceResult =
  | {
      source: AuctionSource;
      ok: true;
      total: number;
      count: number;
      hasMore: boolean;
      /** The site's own make/model names the search was run with. */
      matched: MatchedNames;
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

// v2: results are searched through the alias table and carry `matched`
export const LOT_SEARCH_CACHE_PREFIX = 'lots:v2:';

export function lotSearchCacheKey(source: string, f: LotSearchFilters, page: number) {
  const norm = (s: string) => s.trim().toLowerCase();
  const trim = trimWords(f.trim ?? '', f.make, f.model).join(' ');
  const markets = source === 'iaai' ? [...(f.iaaiMarkets ?? [])].sort().join(',') : '';
  const extra = `${trim ? `:t=${trim}` : ''}${markets ? `:m=${markets}` : ''}`;
  return `${LOT_SEARCH_CACHE_PREFIX}${source}:${norm(f.make)}:${norm(f.model)}:${f.yearFrom}-${f.yearTo}${extra}:p${page}`;
}

export function createLotSearchService(deps: {
  adapters: AuctionSearchAdapter[];
  aliases: VehicleAliasService;
  cache: CacheRepository;
  lots: LotsRepository;
}) {
  async function searchSource(adapter: AuctionSearchAdapter, filters: LotSearchFilters, page: number, force: boolean) {
    // site names are re-read on an explicit refresh of the first page only
    const matched = await deps.aliases.resolve(adapter, filters, force && page === 1);
    const { yearFrom, yearTo, iaaiMarkets } = filters;
    // the site narrows by one trim word, every word is then checked here
    const words = trimWords(filters.trim ?? '', filters.make, filters.model);
    const keyword = trimKeyword(words);
    const query = { ...matched, yearFrom, yearTo, ...(keyword ? { keyword } : {}), ...(iaaiMarkets?.length ? { iaaiMarkets } : {}) };
    const result: LotSearchPage =
      matched.makes.length > 0 && matched.models.length > 0
        ? await adapter.search(query, page)
        : { lots: [], total: 0, page, pageSize: AUCTION_PAGE_SIZE };
    return { ...result, lots: result.lots.filter((l) => lotMatchesTrim(l, words)), matched };
  }

  async function search(filters: LotSearchFilters, page: number, force = false): Promise<LotSearchResponse> {
    const perSource = await Promise.all(
      deps.adapters.map(async (adapter) => {
        const result = await cached(
          deps.cache,
          { key: lotSearchCacheKey(adapter.source, filters, page), source: adapter.source, ttlMs: LOT_SEARCH_TTL_MS, force },
          () => searchSource(adapter, filters, page, force),
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
        matched: data.matched,
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
