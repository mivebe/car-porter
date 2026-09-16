import type { HistoryEntry, SourceErrorInfo } from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface HistoryCheck {
  site: 'bidfax' | 'statvin';
  query: 'vin' | 'lot';
  value: string;
  checkedAt: string | null;
  fromCache: boolean;
  found: number | null;
  error?: SourceErrorInfo;
}

export interface HistoryResponse {
  lotId: string;
  vin: string | null;
  vinSource: 'override' | 'lot' | null;
  lotNumber: string;
  entries: HistoryEntry[];
  checks: HistoryCheck[];
}

export const historyKey = (lotId: string) => ['history', lotId];

/** Stored history (no scraping); refetched when the pasted VIN changes. */
export const useHistory = (lotId: string) =>
  useQuery({ queryKey: historyKey(lotId), queryFn: () => api.history(lotId) });

/** Checks the history sites (reuses checks younger than 24 h unless refresh). */
export function useRunHistory(lotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (refresh: boolean) => api.runHistory(lotId, refresh),
    onSuccess: (data) => queryClient.setQueryData(historyKey(lotId), data),
  });
}
