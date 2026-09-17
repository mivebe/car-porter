import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuctionSource } from '@car-porter/core';
import { api, type AliasChange, type AliasEntry, type AliasKind, type AliasListParams } from '@/lib/api';

export const ALIASES_KEY = ['aliases'];

/** What a site name is searched as right now: the user's targets, else the automatic ones. */
export const effectiveTargets = (entry: AliasEntry) => (entry.manual ? entry.manual.targets : entry.auto.targets);

export const useAliases = (params: AliasListParams, enabled = true) =>
  useQuery({
    queryKey: [...ALIASES_KEY, 'list', params],
    queryFn: () => api.aliases(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAliasMakes = (source?: AuctionSource) =>
  useQuery({ queryKey: [...ALIASES_KEY, 'makes', source], queryFn: () => api.aliasMakes(source) });

/** Our makes, or the models of a make, with their site name counts. */
export const useCanonicalItems = (params: { kind: AliasKind; make?: string; source?: AuctionSource }) =>
  useQuery({
    queryKey: [...ALIASES_KEY, 'canonical', params],
    queryFn: () => api.aliasCanonical(params),
    enabled: params.kind === 'make' || !!params.make,
    placeholderData: keepPreviousData,
  });

/** Unassigned counts for the nav badge and tabs. */
export const useAliasSummary = () =>
  useQuery({ queryKey: [...ALIASES_KEY, 'summary'], queryFn: api.aliasSummary, staleTime: 30_000 });

/** Invalidates everything derived from the alias table (lists, counts, catalog names, searches). */
function useInvalidateAliases() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ALIASES_KEY }),
      queryClient.invalidateQueries({ queryKey: ['catalog'] }),
      queryClient.invalidateQueries({ queryKey: ['lots'] }),
    ]);
}

/** Applies alias changes; resolves once the lists have been refetched. */
export function useChangeAliases() {
  const invalidate = useInvalidateAliases();
  return useMutation({ mutationFn: (changes: AliasChange[]) => api.changeAliases(changes), onSettled: invalidate });
}

/** Polls the background scan while it runs and refreshes the lists once it finishes. */
export function useAliasScan() {
  const invalidate = useInvalidateAliases();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['alias-scan'],
    queryFn: async () => {
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof api.aliasScan>>>(['alias-scan']);
      const next = await api.aliasScan();
      if (previous?.state === 'running' && next.state !== 'running') void invalidate();
      return next;
    },
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1500 : false),
  });
  const setStatus = (data: Awaited<ReturnType<typeof api.aliasScan>>) => queryClient.setQueryData(['alias-scan'], data);
  const start = useMutation({ mutationFn: (make?: string) => api.startAliasScan(make), onSuccess: setStatus });
  const cancel = useMutation({ mutationFn: api.cancelAliasScan, onSuccess: setStatus });
  return { status, start, cancel };
}
