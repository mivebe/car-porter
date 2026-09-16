import { z } from 'zod';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError } from '../scraping/errors.ts';

export interface CatalogItem {
  id: number;
  name: string;
}

export type JsonFetcher = (url: string) => Promise<unknown>;

const BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const VEHICLE_TYPES = ['car', 'multipurpose passenger vehicle (mpv)', 'truck'];
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const makesResponse = z.object({
  Results: z.array(z.object({ MakeId: z.number(), MakeName: z.string() })),
});
const modelsResponse = z.object({
  Results: z.array(z.object({ Model_ID: z.number(), Model_Name: z.string() })),
});

const ACRONYMS = new Set(['BMW', 'GMC', 'MINI', 'RAM', 'BYD', 'MG', 'DS', 'SRT', 'AMC', 'KTM', 'VW']);

/** "MERCEDES-BENZ" → "Mercedes-Benz", "BMW" stays "BMW". */
export function displayName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name !== name.toUpperCase()) return name;
  return name
    .split(' ')
    .map((word) =>
      ACRONYMS.has(word)
        ? word
        : word
            .split('-')
            .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
            .join('-'),
    )
    .join(' ');
}

function sortByName(items: CatalogItem[]) {
  return items.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function parseMakes(responses: unknown[]): CatalogItem[] {
  const byId = new Map<number, CatalogItem>();
  for (const response of responses) {
    const parsed = makesResponse.safeParse(response);
    if (!parsed.success) throw new SourceError('parse_failed', 'nhtsa: unexpected makes response');
    for (const r of parsed.data.Results) {
      byId.set(r.MakeId, { id: r.MakeId, name: displayName(r.MakeName) });
    }
  }
  return sortByName([...byId.values()]);
}

export function parseModels(response: unknown): CatalogItem[] {
  const parsed = modelsResponse.safeParse(response);
  if (!parsed.success) throw new SourceError('parse_failed', 'nhtsa: unexpected models response');
  const byName = new Map<string, CatalogItem>();
  for (const r of parsed.data.Results) {
    const name = r.Model_Name.trim();
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { id: r.Model_ID, name });
  }
  return sortByName([...byName.values()]);
}

export const makesUrl = (vehicleType: string) =>
  `${BASE}/GetMakesForVehicleType/${encodeURIComponent(vehicleType)}?format=json`;
export const modelsUrl = (make: string) =>
  `${BASE}/GetModelsForMake/${encodeURIComponent(make.trim().toLowerCase())}?format=json`;

export const httpJsonFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new SourceError('network', `HTTP ${res.status} for ${url}`);
  return res.json();
};

export function createCatalogService(cache: CacheRepository, fetchJson: JsonFetcher) {
  return {
    makes: () =>
      cached(cache, { key: 'nhtsa:makes', source: 'nhtsa', ttlMs: TTL_MS }, async () =>
        parseMakes(await Promise.all(VEHICLE_TYPES.map((t) => fetchJson(makesUrl(t))))),
      ),
    models: (make: string) =>
      cached(
        cache,
        { key: `nhtsa:models:${make.trim().toLowerCase()}`, source: 'nhtsa', ttlMs: TTL_MS },
        async () => parseModels(await fetchJson(modelsUrl(make))),
      ),
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
