import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, CarFront, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState } from '@/components/feedback';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSettings } from '@/features/lot/hooks';
import { LotDetailSheet } from '@/features/lot/lot-detail-sheet';
import { ColumnPicker } from '@/features/search/column-picker';
import { LOT_INSIGHTS_KEY, useLotInsights } from '@/features/search/insights-hooks';
import { useLotMarks } from '@/features/search/lot-marks-hooks';
import { INSIGHT_COLUMNS, resolveLotColumns } from '@/features/search/lot-columns';
import { LotResults } from '@/features/search/lot-results';
import { RECENT_SEARCHES_KEY } from '@/features/search/recent-search-hooks';
import { RecentSearches } from '@/features/search/recent-searches';
import { SearchFilters } from '@/features/search/search-filters';
import { LOT_SORTS, sortAndFilterLots, uniqueLots, type LotSort, type SourceFilter } from '@/features/search/sort-lots';
import { SourceStatusBadge } from '@/features/search/source-status';
import { DAMAGE_TYPES, DEFAULT_IAAI_MARKETS, IAAI_MARKETS, LOT_CONDITIONS, TRANSMISSIONS } from '@car-porter/core';
import { api, type LotSearchParams, type LotSearchResponse } from '@/lib/api';
import { useUpdatePreferences } from '@/lib/preferences';

const isDefaultMarkets = (markets: readonly string[] | undefined) =>
  !markets?.length || markets.join(',') === DEFAULT_IAAI_MARKETS.join(',');

/** Marks a search with no filters at all, which would otherwise leave the URL empty. */
const ALL_PARAM = 'all';
const FILTER_PARAMS = [
  ALL_PARAM,
  'make',
  'model',
  'yearFrom',
  'yearTo',
  'trim',
  'iaaiMarkets',
  'bodyStyle',
  'transmission',
  'engine',
  'damage',
  'condition',
  'keys',
];

function readParams(search: URLSearchParams): LotSearchParams | null {
  if (!FILTER_PARAMS.some((key) => search.has(key))) return null;
  const make = search.get('make')?.trim();
  const model = make && search.get('model')?.trim();
  const yearFrom = Number(search.get('yearFrom')) || undefined;
  const yearTo = Number(search.get('yearTo')) || undefined;
  const trim = search.get('trim')?.trim();
  const listed = search.get('iaaiMarkets')?.split(',') ?? [];
  const chosen = IAAI_MARKETS.filter((m) => listed.includes(m));
  const iaaiMarkets = chosen.length ? chosen : DEFAULT_IAAI_MARKETS;
  const bodyStyle = search.get('bodyStyle')?.trim();
  const transmission = TRANSMISSIONS.find((x) => x === search.get('transmission'));
  const engine = search.get('engine')?.trim();
  const damageListed = search.get('damage')?.split(',') ?? [];
  const damage = DAMAGE_TYPES.filter((d) => damageListed.includes(d));
  const condition = LOT_CONDITIONS.find((c) => c === search.get('condition'));
  const keysParam = search.get('keys');
  const keys = keysParam === '1' ? true : keysParam === '0' ? false : undefined;
  return {
    ...(make ? { make } : {}),
    ...(model ? { model } : {}),
    ...(yearFrom ? { yearFrom } : {}),
    ...(yearTo ? { yearTo } : {}),
    ...(trim ? { trim } : {}),
    iaaiMarkets,
    ...(bodyStyle ? { bodyStyle } : {}),
    ...(transmission ? { transmission } : {}),
    ...(engine ? { engine } : {}),
    ...(damage.length ? { damage } : {}),
    ...(condition ? { condition } : {}),
    ...(keys !== undefined ? { keys } : {}),
  };
}

export function SearchPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = readParams(searchParams);
  const selectedLotId = searchParams.get('lot');
  const [sort, setSort] = useState<LotSort>('saleDate');
  const [source, setSource] = useState<SourceFilter>('all');
  /** Set right before a manual refresh so the next page-1 request bypasses the server cache. */
  const forceRefresh = useRef(false);

  const results = useInfiniteQuery({
    queryKey: ['lots', params],
    enabled: !!params,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const refresh = forceRefresh.current;
      forceRefresh.current = false;
      const page = await api.searchLots({ ...params!, page: pageParam, refresh });
      // the server records every first page as a recent search
      if (pageParam === 1) void queryClient.invalidateQueries({ queryKey: RECENT_SEARCHES_KEY });
      return page;
    },
    getNextPageParam: (last: LotSearchResponse) =>
      last.sources.some((s) => s.ok && s.hasMore) ? last.page + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });

  const lots = useMemo(
    () => sortAndFilterLots(uniqueLots(results.data?.pages.map((p) => p.lots) ?? []), sort, source),
    [results.data, sort, source],
  );
  const firstPage = results.data?.pages[0];
  const latestSources = results.data?.pages.at(-1)?.sources ?? [];
  const totalLoaded = results.data ? uniqueLots(results.data.pages.map((p) => p.lots)).length : 0;

  const { setLotColumns } = useUpdatePreferences();
  const columns = resolveLotColumns(useSettings().data?.ui.lotColumns ?? []);
  const visibleColumns = columns.filter((c) => c.visible).map((c) => c.id);
  const insights = useLotInsights(
    results.data?.pages.map((p) => p.lots) ?? [],
    visibleColumns.some((id) => INSIGHT_COLUMNS.has(id)),
  );
  const marks = useLotMarks(results.data?.pages.map((p) => p.lots) ?? []);

  const runSearch = (next: LotSearchParams) => {
    const params: Record<string, string> = {
      ...(next.make ? { make: next.make } : {}),
      ...(next.model ? { model: next.model } : {}),
      ...(next.yearFrom ? { yearFrom: String(next.yearFrom) } : {}),
      ...(next.yearTo ? { yearTo: String(next.yearTo) } : {}),
      ...(next.trim ? { trim: next.trim } : {}),
      ...(isDefaultMarkets(next.iaaiMarkets) ? {} : { iaaiMarkets: next.iaaiMarkets!.join(',') }),
      ...(next.bodyStyle ? { bodyStyle: next.bodyStyle } : {}),
      ...(next.transmission ? { transmission: next.transmission } : {}),
      ...(next.engine ? { engine: next.engine } : {}),
      ...(next.damage?.length ? { damage: next.damage.join(',') } : {}),
      ...(next.condition ? { condition: next.condition } : {}),
      ...(next.keys !== undefined ? { keys: next.keys ? '1' : '0' } : {}),
    };
    setSearchParams(Object.keys(params).length ? params : { [ALL_PARAM]: '1' });
  };

  const refresh = async () => {
    forceRefresh.current = true;
    await queryClient.resetQueries({ queryKey: ['lots', params] });
  };

  const setSelectedLot = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('lot', id);
    else next.delete('lot');
    setSearchParams(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('pages.search.title')} actions={<RecentSearches onSearch={runSearch} />} />
      <SearchFilters
        key={params ? JSON.stringify(params) : 'empty'}
        initial={params ?? {}}
        onSearch={runSearch}
        searching={results.isFetching && !results.isFetchingNextPage}
      />

      {!params && (
        <EmptyState icon={CarFront}>{t('search.emptyState')}</EmptyState>
      )}

      {params && results.isPending && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('search.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {params && results.isError && (
        <EmptyState tone="destructive">{t('search.requestFailed')}</EmptyState>
      )}

      {firstPage && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {latestSources.map((s) => (
                <SourceStatusBadge
                  key={s.source}
                  label={t(`sources.${s.source}`)}
                  ok={s.ok}
                  error={s.error}
                  {...(s.ok
                    ? { total: s.total, matched: s.matched, fetchedAt: s.fetchedAt, fromCache: s.fromCache, stale: s.stale }
                    : {})}
                />
              ))}
              <span className="text-xs text-muted-foreground">{t('search.loadedCount', { count: totalLoaded })}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
                <TabsList>
                  <TabsTrigger value="all">{t('search.allSources')}</TabsTrigger>
                  <TabsTrigger value="copart">{t('sources.copart')}</TabsTrigger>
                  <TabsTrigger value="iaai">{t('sources.iaai')}</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={sort} onValueChange={(v) => setSort(v as LotSort)}>
                <SelectTrigger className="w-48" aria-label={t('search.sortBy')}>
                  <ArrowUpDown />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOT_SORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`search.sort.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ColumnPicker columns={columns} onChange={setLotColumns} onReset={() => setLotColumns([])} />
              <Button variant="outline" onClick={refresh} disabled={results.isFetching} title={t('search.refresh')}>
                <RefreshCw className={results.isFetching ? 'animate-spin' : undefined} />
                {t('search.refreshShort')}
              </Button>
            </div>
          </div>

          {lots.length === 0 && latestSources.every((s) => !s.ok) ? (
            <EmptyState tone="destructive">{t('search.allSourcesFailed')}</EmptyState>
          ) : lots.length === 0 ? (
            <EmptyState icon={SearchX}>{t('search.noResults')}</EmptyState>
          ) : (
            <LotResults
              lots={lots}
              columns={visibleColumns}
              insights={insights}
              marks={marks}
              selectedId={selectedLotId}
              onSelect={(lot) => setSelectedLot(lot.id)}
            />
          )}

          {results.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => void results.fetchNextPage()}
              disabled={results.isFetchingNextPage}
            >
              {results.isFetchingNextPage && <Loader2 className="animate-spin" />}
              {t('search.loadMore')}
            </Button>
          )}
        </div>
      )}

      <LotDetailSheet
        lotId={selectedLotId}
        onClose={() => {
          setSelectedLot(null);
          // scans, inputs and exclusions may have changed in the sheet
          void queryClient.invalidateQueries({ queryKey: LOT_INSIGHTS_KEY });
        }}
      />
    </div>
  );
}
