import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AliasEntry, type AliasKey, type AliasListParams } from '@/lib/api';

export const ALIASES_KEY = ['aliases'];

/** What a site name currently maps to: the user's assignment, else the automatic match. */
export const effectiveTargets = (entry: AliasEntry) => entry.manual?.targets ?? entry.auto.targets;

export const useAliases = (params: AliasListParams) =>
  useQuery({ queryKey: [...ALIASES_KEY, 'list', params], queryFn: () => api.aliases(params), placeholderData: keepPreviousData });

export const useAliasMakes = () => useQuery({ queryKey: [...ALIASES_KEY, 'makes'], queryFn: api.aliasMakes });

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

export function useAssignAliases() {
  const invalidate = useInvalidateAliases();
  return useMutation({
    mutationFn: ({ items, targets }: { items: AliasKey[]; targets: string[] | null }) => api.assignAliases(items, targets),
    onSettled: invalidate,
  });
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
