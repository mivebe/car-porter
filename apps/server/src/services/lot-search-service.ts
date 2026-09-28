import {
  DEFAULT_IAAI_MARKETS,
  IAAI_MARKETS,
  lotMatchesTrim,
  searchYears,
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

/** The IAAI marketplaces to filter by, in IAAI_MARKETS order; undefined when every one is chosen. */
function iaaiMarketFilter(f: LotSearchFilters) {
  const chosen = f.iaaiMarkets?.length ? f.iaaiMarkets : DEFAULT_IAAI_MARKETS;
  return chosen.length >= IAAI_MARKETS.length ? undefined : IAAI_MARKETS.filter((m) => chosen.includes(m));
}

export function lotSearchCacheKey(source: string, f: LotSearchFilters, page: number) {
  const norm = (s: string) => s.trim().toLowerCase();
  const trim = trimWords(f.trim ?? '', f.make, f.model).join(' ');
  const markets = source === 'iaai' ? (iaaiMarketFilter(f) ?? []).join(',') : '';
  const options = [
    trim && `t=${trim}`,
    markets && `m=${markets}`,
    f.bodyStyle && `b=${norm(f.bodyStyle)}`,
    f.transmission && `x=${f.transmission}`,
    f.engine && `e=${f.engine}`,
    f.damage?.length && `d=${[...f.damage].sort().join(',')}`,
    f.condition && `c=${f.condition}`,
    f.keys !== undefined && `k=${f.keys ? 1 : 0}`,
  ].filter(Boolean);
  const extra = options.map((o) => `:${o}`).join('');
  const { yearFrom, yearTo } = searchYears(f);
  return `${LOT_SEARCH_CACHE_PREFIX}${source}:${norm(f.make)}:${norm(f.model)}:${yearFrom}-${yearTo}${extra}:p${page}`;
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
    const { transmission, damage, condition, keys } = filters;
    const { yearFrom, yearTo } = searchYears(filters);
    const iaaiMarkets = adapter.source === 'iaai' ? iaaiMarketFilter(filters) : undefined;
    // the site narrows by one trim word, every word is then checked here
    const words = trimWords(filters.trim ?? '', filters.make, filters.model);
    const keyword = trimKeyword(words);
    const found = matched.makes.length > 0 && matched.models.length > 0;
    const options = found ? await deps.aliases.resolveOptions(adapter, matched, filters, force && page === 1) : {};
    const query = {
      ...matched,
      yearFrom,
      yearTo,
      ...(keyword ? { keyword } : {}),
      ...(iaaiMarkets ? { iaaiMarkets } : {}),
      ...(transmission ? { transmission } : {}),
      ...(damage?.length ? { damage } : {}),
      ...(condition ? { condition } : {}),
      ...(keys !== undefined ? { keys } : {}),
      ...options,
    };
    // a body style or engine the site has no values for finds nothing there
    const none = Object.values(options).some((values) => values.length === 0);
    const result: LotSearchPage =
      found && !none
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
