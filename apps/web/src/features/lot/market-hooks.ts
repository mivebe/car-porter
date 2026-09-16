import type { MarketListing, MarketSource, SourceErrorInfo } from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface StoredMarketListing extends MarketListing {
  firstSeenAt: string;
  lastSeenAt: string;
  previousPriceEurCents: number | null;
}

export interface MarketSiteResult {
  site: MarketSource;
  enabled: boolean;
  checkedAt: string | null;
  fromCache: boolean;
  found: number | null;
  removed: number | null;
  pagesScanned: number | null;
  complete: boolean | null;
  searchUrl: string | null;
  error?: SourceErrorInfo;
}

export interface MarketResponse {
  lotId: string;
  sites: MarketSiteResult[];
  listings: StoredMarketListing[];
  excludedIds: string[];
}

const key = (lotId: string) => ['market', lotId];

/** Stored listings (no scraping). */
export const useMarket = (lotId: string) => useQuery({ queryKey: key(lotId), queryFn: () => api.market(lotId) });

/** Searches the lot's marketplaces (reuses searches younger than 24 h unless refresh). */
export function useRunMarket(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (refresh: boolean) => api.runMarket(lotId, refresh),
    onSuccess: (data) => queryClient.setQueryData(key(lotId), data),
  });
}

export function useToggleMarketListing(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, included }: { listingId: string; included: boolean }) =>
      api.setMarketSelection(lotId, listingId, included),
    onMutate: async ({ listingId, included }) => {
      await queryClient.cancelQueries({ queryKey: key(lotId) });
      const previous = queryClient.getQueryData<MarketResponse>(key(lotId));
      if (previous) {
        const others = previous.excludedIds.filter((id) => id !== listingId);
        queryClient.setQueryData<MarketResponse>(key(lotId), {
          ...previous,
          excludedIds: included ? others : [...others, listingId],
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key(lotId), context.previous);
    },
    onSuccess: ({ excludedIds }) => {
      const current = queryClient.getQueryData<MarketResponse>(key(lotId));
      if (current) queryClient.setQueryData<MarketResponse>(key(lotId), { ...current, excludedIds });
    },
  });
}
