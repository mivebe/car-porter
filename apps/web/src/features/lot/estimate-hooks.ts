import {
  summarizeIncluded,
  type AuctionCriterion,
  type AuctionRecord,
  type CriterionResult,
  type PriceSummary,
  type SourceErrorInfo,
} from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ScanStopReason =
  | 'no_results'
  | 'reached_known'
  | 'older_than_window'
  | 'max_matches'
  | 'max_pages'
  | 'last_page'
  | 'error';

export interface EstimateResponse {
  lotId: string;
  searchUrl: string | null;
  matches: { record: AuctionRecord; criteria: Record<AuctionCriterion, CriterionResult>; unknown: AuctionCriterion[] }[];
  excludedIds: string[];
  scan: { scannedAt: string; pagesScanned: number; newRecords: number; stopReason: ScanStopReason; fresh: boolean } | null;
  error?: SourceErrorInfo;
}

const key = (lotId: string) => ['estimate', lotId];

/** Stored estimate (no scraping). */
export const useEstimate = (lotId: string) =>
  useQuery({ queryKey: key(lotId), queryFn: () => api.estimate(lotId) });

/** Runs a bidfax scan (reuses a scan younger than 24 h unless refresh). */
export function useRunEstimate(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (refresh: boolean) => api.runEstimate(lotId, refresh),
    onSuccess: (data) => queryClient.setQueryData(key(lotId), data),
  });
}

export function useToggleEstimateRecord(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, included }: { recordId: string; included: boolean }) =>
      api.setEstimateSelection(lotId, recordId, included),
    onMutate: async ({ recordId, included }) => {
      await queryClient.cancelQueries({ queryKey: key(lotId) });
      const previous = queryClient.getQueryData<EstimateResponse>(key(lotId));
      if (previous) {
        const others = previous.excludedIds.filter((id) => id !== recordId);
        queryClient.setQueryData<EstimateResponse>(key(lotId), {
          ...previous,
          excludedIds: included ? others : [...others, recordId],
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key(lotId), context.previous);
    },
    onSuccess: ({ excludedIds }) => {
      const current = queryClient.getQueryData<EstimateResponse>(key(lotId));
      if (current) queryClient.setQueryData<EstimateResponse>(key(lotId), { ...current, excludedIds });
    },
  });
}

/** Summary of included matches — the lot's estimated final price. */
export function estimateSummary(data: EstimateResponse | undefined): PriceSummary | null {
  if (!data) return null;
  return summarizeIncluded(
    data.matches.map((m) => m.record),
    (r) => r.finalPriceUsdCents,
    new Set(data.excludedIds),
  );
}
