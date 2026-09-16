import type { LotInputs, LotInputsPatch } from '@car-porter/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });

export const useFx = () => useQuery({ queryKey: ['fx'], queryFn: api.fx, staleTime: 60 * 60 * 1000 });

export const useLot = (id: string | null) =>
  useQuery({ queryKey: ['lot', id], queryFn: () => api.lot(id!), enabled: !!id });

export const useLotInputs = (id: string | null) =>
  useQuery({ queryKey: ['lotInputs', id], queryFn: () => api.lotInputs(id!), enabled: !!id });

/** Saves a partial update with an optimistic cache update (rolled back on error). */
export function useUpdateLotInputs(id: string) {
  const queryClient = useQueryClient();
  const key = ['lotInputs', id];
  return useMutation({
    mutationFn: (patch: LotInputsPatch) => api.updateLotInputs(id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LotInputs>(key);
      if (previous) queryClient.setQueryData<LotInputs>(key, { ...previous, ...patch } as LotInputs);
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });
}
