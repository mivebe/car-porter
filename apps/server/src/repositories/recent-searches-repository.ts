import type { LotSearchFilters } from '@car-porter/core';
import { desc, eq, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { recentSearches } from '../db/schema.ts';

export const RECENT_SEARCHES_LIMIT = 20;

export interface RecentSearch {
  key: string;
  filters: LotSearchFilters;
  searchedAt: Date;
}

/** Same search typed differently (case, market order) shares one key. */
export function recentSearchKey(f: LotSearchFilters) {
  const norm = (s?: string) => s?.trim().toLowerCase() || '';
  return [
    norm(f.make),
    norm(f.model),
    `${f.yearFrom ?? ''}-${f.yearTo ?? ''}`,
    norm(f.trim),
    [...(f.iaaiMarkets ?? [])].sort().join(','),
    norm(f.bodyStyle),
    f.transmission ?? '',
    f.engine ?? '',
  ].join('|');
}

export function createRecentSearchesRepository(db: Db) {
  async function list(): Promise<RecentSearch[]> {
    return db.select().from(recentSearches).orderBy(desc(recentSearches.searchedAt), desc(recentSearches.key));
  }

  /** Upserts the search as the newest and drops the oldest beyond the limit. */
  async function record(filters: LotSearchFilters) {
    const key = recentSearchKey(filters);
    const searchedAt = new Date();
    await db
      .insert(recentSearches)
      .values({ key, filters, searchedAt })
      .onConflictDoUpdate({ target: recentSearches.key, set: { filters, searchedAt } });
    const keep = db
      .select({ key: recentSearches.key })
      .from(recentSearches)
      .orderBy(desc(recentSearches.searchedAt), desc(recentSearches.key))
      .limit(RECENT_SEARCHES_LIMIT);
    await db.delete(recentSearches).where(notInArray(recentSearches.key, keep));
  }

  async function remove(key: string) {
    await db.delete(recentSearches).where(eq(recentSearches.key, key));
  }

  async function clear() {
    await db.delete(recentSearches);
  }

  return { list, record, remove, clear };
}

export type RecentSearchesRepository = ReturnType<typeof createRecentSearchesRepository>;
