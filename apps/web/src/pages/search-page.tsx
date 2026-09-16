import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CarFront, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LotDetailSheet } from '@/features/lot/lot-detail-sheet';
import { LotResults } from '@/features/search/lot-results';
import { SearchFilters } from '@/features/search/search-filters';
import { LOT_SORTS, sortAndFilterLots, uniqueLots, type LotSort, type SourceFilter } from '@/features/search/sort-lots';
import { SourceStatusBadge } from '@/features/search/source-status';
import { api, type LotSearchParams, type LotSearchResponse } from '@/lib/api';

function readParams(search: URLSearchParams): LotSearchParams | null {
  const make = search.get('make');
  const model = search.get('model');
  const yearFrom = Number(search.get('yearFrom'));
  const yearTo = Number(search.get('yearTo'));
  if (!make || !model || !yearFrom || !yearTo) return null;
  return { make, model, yearFrom, yearTo };
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
    queryFn: ({ pageParam }) => {
      const refresh = forceRefresh.current;
      forceRefresh.current = false;
      return api.searchLots({ ...params!, page: pageParam, refresh });
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

  const runSearch = (next: LotSearchParams) => {
    setSearchParams({
      make: next.make,
      model: next.model,
      yearFrom: String(next.yearFrom),
      yearTo: String(next.yearTo),
    });
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
      <PageHeader title={t('pages.search.title')} description={t('pages.search.description')} />
      <SearchFilters
        key={params ? `${params.make}|${params.model}|${params.yearFrom}|${params.yearTo}` : 'empty'}
        initial={params ?? {}}
        onSearch={runSearch}
        searching={results.isFetching && !results.isFetchingNextPage}
      />

      {!params && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <CarFront className="size-10" />
          <p className="max-w-md text-sm">{t('search.emptyState')}</p>
        </div>
      )}

      {params && results.isPending && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('search.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {params && results.isError && (
        <div role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          {t('search.requestFailed')}
        </div>
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
                  {...(s.ok ? { total: s.total, fetchedAt: s.fetchedAt, fromCache: s.fromCache, stale: s.stale } : {})}
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
                <SelectTrigger className="w-44" aria-label={t('search.sortBy')}>
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
              <Button variant="outline" size="icon" onClick={refresh} disabled={results.isFetching} aria-label={t('search.refresh')}>
                <RefreshCw className={results.isFetching ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </div>

          {lots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
              <SearchX className="size-10" />
              <p className="text-sm">{t('search.noResults')}</p>
            </div>
          ) : (
            <LotResults lots={lots} selectedId={selectedLotId} onSelect={(lot) => setSelectedLot(lot.id)} />
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

      <LotDetailSheet lotId={selectedLotId} onClose={() => setSelectedLot(null)} />
    </div>
  );
}
