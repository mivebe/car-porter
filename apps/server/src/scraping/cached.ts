import type { SourceErrorInfo } from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import { toSourceErrorInfo } from './errors.ts';

export interface CachedOptions {
  key: string;
  source: string;
  /** null = never expires */
  ttlMs: number | null;
  /** bypass a fresh cache entry */
  force?: boolean;
}

export type CachedResult<T> =
  | { ok: true; data: T; fetchedAt: Date; fromCache: boolean; stale: boolean; error?: SourceErrorInfo }
  | { ok: false; error: SourceErrorInfo };

/**
 * Returns a fresh cache entry if present, otherwise runs the loader and stores its result.
 * If the loader fails and a stale entry exists, the stale data is returned along with the error.
 */
export async function cached<T>(
  cache: CacheRepository,
  { key, source, ttlMs, force = false }: CachedOptions,
  loader: () => Promise<T>,
): Promise<CachedResult<T>> {
  const entry = await cache.get<T>(key);
  if (entry && entry.fresh && !force) {
    return { ok: true, data: entry.payload, fetchedAt: entry.fetchedAt, fromCache: true, stale: false };
  }

  try {
    const data = await loader();
    await cache.set(key, source, data, ttlMs);
    const stored = await cache.get<T>(key);
    return { ok: true, data, fetchedAt: stored!.fetchedAt, fromCache: false, stale: false };
  } catch (err) {
    const error = toSourceErrorInfo(err);
    if (entry) {
      return { ok: true, data: entry.payload, fetchedAt: entry.fetchedAt, fromCache: true, stale: true, error };
    }
    return { ok: false, error };
  }
}
