import type { Lot } from '@car-porter/core';
import { useQueries } from '@tanstack/react-query';
import { api, type LotInsights } from '@/lib/api';

export const LOT_INSIGHTS_KEY = ['lotInsights'];

/**
 * Insights for the loaded result pages, one request per page so loading more doesn't refetch
 * the pages already shown. Lots missing from the map are still loading.
 */
export function useLotInsights(pages: Lot[][], enabled: boolean): Map<string, LotInsights> {
  return useQueries({
    queries: pages.map((lots) => {
      const ids = lots.map((l) => l.id);
      return {
        queryKey: [...LOT_INSIGHTS_KEY, ids],
        queryFn: () => api.lotInsights(ids),
        enabled: enabled && ids.length > 0,
      };
    }),
    combine: (results) => new Map(results.flatMap((r) => r.data?.items.map((i) => [i.lotId, i] as const) ?? [])),
  });
}
