import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { scrapeCache } from '../db/schema.ts';

export interface CacheEntry<T> {
  payload: T;
  fetchedAt: Date;
  expiresAt: Date | null;
  fresh: boolean;
}

export function createCacheRepository(db: Db, now: () => Date = () => new Date()) {
  async function get<T>(key: string): Promise<CacheEntry<T> | null> {
    const row = await db.query.scrapeCache.findFirst({ where: eq(scrapeCache.key, key) });
    if (!row) return null;
    return {
      payload: row.payload as T,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      fresh: row.expiresAt === null || row.expiresAt.getTime() > now().getTime(),
    };
  }

  /** `ttlMs` null = never expires. */
  async function set<T>(key: string, source: string, payload: T, ttlMs: number | null) {
    const fetchedAt = now();
    const expiresAt = ttlMs === null ? null : new Date(fetchedAt.getTime() + ttlMs);
    await db
      .insert(scrapeCache)
      .values({ key, source, payload, fetchedAt, expiresAt })
      .onConflictDoUpdate({ target: scrapeCache.key, set: { source, payload, fetchedAt, expiresAt } });
  }

  async function remove(key: string) {
    await db.delete(scrapeCache).where(eq(scrapeCache.key, key));
  }

  return { get, set, remove };
}

export type CacheRepository = ReturnType<typeof createCacheRepository>;
