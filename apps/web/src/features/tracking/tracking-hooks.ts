import type { Lot, LotEvaluation, PriceSummary } from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOT_MARKS_KEY } from '@/features/search/lot-marks-hooks';
import { api } from '@/lib/api';

export interface TrackedLotRow {
  lot: Lot;
  trackedAt: string;
  estimate: PriceSummary | null;
  market: PriceSummary | null;
  evaluation: LotEvaluation;
}

export interface TrackedLotsResponse {
  lots: TrackedLotRow[];
  usdToEur: number | null;
}

export const TRACKED_KEY = ['tracked'];

/** Tracked lots with verdicts computed on the server from stored data. */
export const useTrackedLots = () => useQuery({ queryKey: TRACKED_KEY, queryFn: api.tracked });

export function useSetTracked(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tracked: boolean) => (tracked ? api.track(lotId) : api.untrack(lotId)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lot', lotId] }),
        queryClient.invalidateQueries({ queryKey: TRACKED_KEY }),
        queryClient.invalidateQueries({ queryKey: LOT_MARKS_KEY }),
      ]),
  });
}
