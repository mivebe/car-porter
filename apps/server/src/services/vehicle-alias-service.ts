import {
  mapMakes,
  mapModels,
  normalizeMake,
  normalizeText,
  type AliasMapping,
  type AuctionSource,
  type LotSearchFilters,
} from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { VehicleAliasesRepository } from '../repositories/vehicle-aliases-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError } from '../scraping/errors.ts';
import type { AuctionSearchAdapter, ExternalFacet } from '../sources/auction-adapter.ts';
import type { CatalogService } from '../sources/nhtsa.ts';

export const ALIAS_FACETS_TTL_MS = 12 * 60 * 60 * 1000;

/** The site's own names a canonical search expanded to. Empty = the site has nothing under that name. */
export interface MatchedNames {
  makes: string[];
  models: string[];
}

export function createVehicleAliasService(deps: {
  catalog: CatalogService;
  cache: CacheRepository;
  aliases: VehicleAliasesRepository;
}) {
  async function facets(
    source: AuctionSource,
    key: string,
    force: boolean,
    load: () => Promise<ExternalFacet[]>,
  ): Promise<ExternalFacet[]> {
    const result = await cached(deps.cache, { key: `aliases:${source}:${key}`, source, ttlMs: ALIAS_FACETS_TTL_MS, force }, load);
    if (!result.ok) throw new SourceError(result.error.code, result.error.message);
    return result.data;
  }

  /** Manual overrides replace computed mappings for the same external name. */
  async function withOverrides(
    source: AuctionSource,
    kind: 'make' | 'model',
    canonicalMake: string,
    computed: AliasMapping[],
  ): Promise<AliasMapping[]> {
    const manual = (await deps.aliases.list({ source, kind, ...(kind === 'model' ? { canonicalMake } : {}) })).filter(
      (r) => r.match === 'manual',
    );
    if (manual.length === 0) return computed;
    const overridden = new Set(manual.map((r) => r.externalName));
    return [
      ...computed.filter((m) => !overridden.has(m.external)),
      ...manual.map((r) => ({
        external: r.externalName,
        canonical: (kind === 'make' ? r.canonicalMake : r.canonical) || null,
        match: 'manual' as const,
      })),
    ];
  }

  /**
   * Expands a canonical make/model into the names `adapter`'s site files lots under, reading the
   * site's make and model facets for the year range and recording every mapping in the alias table.
   */
  async function resolve(adapter: AuctionSearchAdapter, filters: LotSearchFilters, force = false): Promise<MatchedNames> {
    const { source } = adapter;
    const years = { yearFrom: filters.yearFrom, yearTo: filters.yearTo };
    const yearKey = `${years.yearFrom}-${years.yearTo}`;

    const catalogMakes = await deps.catalog.makes();
    const canonicalMakes = catalogMakes.ok ? catalogMakes.data.map((m) => m.name) : [];
    const requestedMake = canonicalMakes.find((m) => normalizeMake(m) === normalizeMake(filters.make)) ?? filters.make.trim();
    if (!canonicalMakes.includes(requestedMake)) canonicalMakes.push(requestedMake);

    const makeFacets = await facets(source, `makes:${yearKey}`, force, () => adapter.makeFacets(years));
    const makeCounts = new Map(makeFacets.map((f) => [f.name, f.count]));
    const makeRows = await withOverrides(source, 'make', '', mapMakes(canonicalMakes, makeFacets.map((f) => f.name)));
    await deps.aliases.replaceComputed(
      { source, kind: 'make' },
      makeRows.map((m) => ({
        source,
        kind: 'make',
        externalName: m.external,
        canonicalMake: m.canonical ?? '',
        canonical: '',
        match: m.match,
        lotCount: makeCounts.get(m.external) ?? null,
      })),
    );
    const makes = makeRows
      .filter((m) => m.canonical && normalizeMake(m.canonical) === normalizeMake(requestedMake))
      .map((m) => m.external);
    if (makes.length === 0) return { makes, models: [] };

    const catalogModels = await deps.catalog.models(requestedMake);
    const canonicalModels = catalogModels.ok ? catalogModels.data.map((m) => m.name) : [];
    const modelFacets = await facets(source, `models:${normalizeText([...makes].sort().join('|'))}:${yearKey}`, force, () =>
      adapter.modelFacets(makes, years),
    );
    const modelCounts = new Map(modelFacets.map((f) => [f.name, f.count]));
    const externalModels = modelFacets.map((f) => f.name);

    const modelRows = await withOverrides(source, 'model', requestedMake, mapModels(requestedMake, canonicalModels, externalModels));
    await deps.aliases.replaceComputed(
      { source, kind: 'model', canonicalMake: requestedMake },
      modelRows.map((m) => ({
        source,
        kind: 'model',
        externalName: m.external,
        canonicalMake: requestedMake,
        canonical: m.canonical ?? '',
        match: m.match,
        lotCount: modelCounts.get(m.external) ?? null,
      })),
    );

    // a model typed outside the catalog ("C 63 AMG") is matched on its own, without being stored
    const inCatalog = canonicalModels.find((m) => normalizeText(m) === normalizeText(filters.model));
    const rows = inCatalog
      ? modelRows
      : await withOverrides(source, 'model', requestedMake, mapModels(requestedMake, [...canonicalModels, filters.model], externalModels));
    const target = inCatalog ?? filters.model;
    const models = rows
      .filter((m) => m.canonical && normalizeText(m.canonical) === normalizeText(target))
      .map((m) => m.external);
    return { makes, models: [...new Set(models)] };
  }

  return { resolve };
}

export type VehicleAliasService = ReturnType<typeof createVehicleAliasService>;
