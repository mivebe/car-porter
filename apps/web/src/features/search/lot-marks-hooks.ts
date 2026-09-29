import type { Lot } from '@car-porter/core';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const LOT_MARKS_KEY = ['lotMarks'];

export interface LotMarks {
  tracked: ReadonlySet<string>;
  opened: ReadonlySet<string>;
}

/** Which loaded lots are tracked or were opened, one request per result page like the insights. */
export function useLotMarks(pages: Lot[][]): LotMarks {
  return useQueries({
    queries: pages.map((lots) => {
      const ids = lots.map((l) => l.id);
      return { queryKey: [...LOT_MARKS_KEY, ids], queryFn: () => api.lotMarks(ids), enabled: ids.length > 0 };
    }),
    combine: (results) => ({
      tracked: new Set(results.flatMap((r) => r.data?.tracked ?? [])),
      opened: new Set(results.flatMap((r) => r.data?.opened ?? [])),
    }),
  });
}

export function useMarkOpened() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markOpened,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LOT_MARKS_KEY }),
  });
}
