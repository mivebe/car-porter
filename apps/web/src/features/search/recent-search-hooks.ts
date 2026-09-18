import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const RECENT_SEARCHES_KEY = ['searches', 'recent'];

/** Newest first; the server records a search when its first page is requested. */
export function useRecentSearches() {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: RECENT_SEARCHES_KEY });
  return {
    list: useQuery({ queryKey: RECENT_SEARCHES_KEY, queryFn: api.recentSearches }),
    remove: useMutation({ mutationFn: api.removeRecentSearch, onSettled }),
    clear: useMutation({ mutationFn: api.clearRecentSearches, onSettled }),
  };
}
