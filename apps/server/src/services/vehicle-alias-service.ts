import {
  ALIAS_SOURCES,
  BODY_STYLES,
  mapBodyStyles,
  mapMakes,
  mapMakesByName,
  mapModels,
  normalizeMake,
  normalizeText,
  type AliasMapping,
  type AliasSource,
  isCatalogMarketSource,
  type LotSearchFilters,
  searchYears,
  siteEngineLiters,
} from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type {
  AliasKey,
  AliasKind,
  AutoMatch,
  ManualState,
  VehicleAlias,
  VehicleAliasesRepository,
} from '../repositories/vehicle-aliases-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError } from '../scraping/errors.ts';
import type { AuctionQuery, AuctionSearchAdapter, ExternalFacet, YearRange } from '../sources/auction-adapter.ts';
import type { CatalogService } from '../sources/nhtsa.ts';
import { LOT_SEARCH_CACHE_PREFIX } from './lot-search-service.ts';
import { marketScanPrefix } from './market-service.ts';

export const ALIAS_FACETS_TTL_MS = 12 * 60 * 60 * 1000;

/** The site's own names a canonical search expanded to. Empty = the site has nothing under that name. */
export interface MatchedNames {
  makes: string[];
  models: string[];
}

/** A name from a site's make/model list; count = its lots or listings, when the site says. */
export interface SiteName {
  name: string;
  count: number | null;
}

/** Body and engine values of a site to search with; missing = not filtered, empty = nothing matches. */
export type MatchedOptions = Pick<AuctionQuery, 'bodyStyles' | 'engines'>;

/** non_car: automatically recognised as a motorcycle/trailer/bus make, so not waiting for assignment */
export type AliasStatus = 'unassigned' | 'auto' | 'non_car' | 'manual' | 'ignored';
export const ALIAS_STATUSES: AliasStatus[] = ['unassigned', 'auto', 'non_car', 'manual', 'ignored'];

/** One site name with its automatic suggestion and the user's assignment, if any. */
export interface AliasEntry {
  source: AliasSource;
  kind: AliasKind;
  externalName: string;
  /** models: the make the site listed it under; '' for makes */
  make: string;
  lotCount: number | null;
  lastSeenAt: string;
  /** nonCarMake: the NHTSA motorcycle/trailer/bus make it was recognised as */
  auto: { targets: string[]; match: AutoMatch | null; nonCarMake: string | null };
  /** null = no decision by the user */
  manual: { state: ManualState; targets: string[] } | null;
  status: AliasStatus;
}

/** What a site name is searched as right now: the user's targets, else the automatic ones. */
export const effectiveTargets = (e: AliasEntry) => (e.manual ? e.manual.targets : e.auto.targets);

/** A user decision for one site name. */
export type AliasChange =
  | { action: 'assign'; targets: string[] }
  | { action: 'ignore' }
  | { action: 'unassign' }
  /** back to automatic matching */
  | { action: 'reset' };

/** One of our makes (or models of a make) with how many site names are searched as it. */
export interface CanonicalItem {
  name: string;
  siteNames: number;
  /** site names per auction site, so the column can show where they come from */
  bySource: Record<AliasSource, number>;
  lots: number;
}

export interface AliasEntryFilter {
  kind: AliasKind;
  source?: AliasSource;
  make?: string;
  status?: AliasStatus;
  /** only site names searched as this make/model */
  target?: string;
  q?: string;
  limit?: number;
}

const ALL_YEARS = (): YearRange => ({ yearFrom: 1900, yearTo: new Date().getFullYear() + 1 });

/** Ranges up to this many years are split straight into single years (they nearly always hit the limit). */
const SPLIT_TO_YEARS_SPAN = 16;

/**
 * Reads a facet over a year range. When the site truncates facets (Copart) and the limit is hit,
 * the range is split (halves, or single years once short) and the parts merged, so rare
 * spellings are not cut off. `onRequest` is told about every site request, for progress.
 */
export async function readFacetsFully(
  limit: number | undefined,
  years: YearRange,
  load: (years: YearRange) => Promise<ExternalFacet[]>,
  options: { shouldStop?: () => boolean; onRequest?: (years: YearRange) => void } = {},
): Promise<ExternalFacet[]> {
  const { shouldStop = () => false, onRequest } = options;
  onRequest?.(years);
  const facets = await load(years);
  if (!limit || facets.length < limit || years.yearFrom >= years.yearTo || shouldStop()) return facets;
  const span = years.yearTo - years.yearFrom + 1;
  const mid = Math.floor((years.yearFrom + years.yearTo) / 2);
  const ranges =
    span <= SPLIT_TO_YEARS_SPAN
      ? Array.from({ length: span }, (_, i) => ({ yearFrom: years.yearFrom + i, yearTo: years.yearFrom + i }))
      : [
          { yearFrom: years.yearFrom, yearTo: mid },
          { yearFrom: mid + 1, yearTo: years.yearTo },
        ];
  const parts: ExternalFacet[][] = [];
  for (const range of ranges) {
    if (shouldStop()) break;
    parts.push(await readFacetsFully(limit, range, load, options));
  }
  const merged = new Map<string, number>();
  for (const f of parts.flat()) merged.set(f.name, (merged.get(f.name) ?? 0) + f.count);
  return [...merged].map(([name, count]) => ({ name, count }));
}

export function createVehicleAliasService(deps: {
  catalog: CatalogService;
  cache: CacheRepository;
  aliases: VehicleAliasesRepository;
}) {
  async function cachedFacets<T = ExternalFacet[]>(source: AliasSource, key: string, force: boolean, load: () => Promise<T>) {
    // v2: facets read with the sites' car-only filter; older entries also hold boats and trailers
    const result = await cached(deps.cache, { key: `aliases:v2:${source}:${key}`, source, ttlMs: ALIAS_FACETS_TTL_MS, force }, load);
    if (!result.ok) throw new SourceError(result.error.code, result.error.message);
    return result.data;
  }

  async function canonicalMakes(): Promise<string[]> {
    const catalog = await deps.catalog.makes();
    const names = catalog.ok ? catalog.data.map((m) => m.name) : [];
    return [...new Set([...names, ...(await deps.aliases.manualTargets('make'))])];
  }

  /** NHTSA non-car makes that aren't also car makes (e.g. Harley-Davidson, but not Ford). */
  async function nonCarMakes(carMakes: string[]): Promise<string[]> {
    const catalog = await deps.catalog.nonCarMakes();
    if (!catalog.ok) return [];
    const cars = new Set(carMakes.map(normalizeMake));
    return catalog.data.map((m) => m.name).filter((name) => !cars.has(normalizeMake(name)));
  }

  async function catalogModels(make: string): Promise<string[]> {
    const catalog = await deps.catalog.models(make);
    return catalog.ok ? catalog.data.map((m) => m.name) : [];
  }

  /** Our spelling of a make: the catalog's (or a user-made) name, else what was typed. */
  async function canonicalMakeName(make: string): Promise<string> {
    return (await canonicalMakes()).find((m) => normalizeMake(m) === normalizeMake(make)) ?? make.trim();
  }

  /** Auto mappings with the user's assignments laid over them (manual wins per site name). */
  async function effective(source: AliasSource, kind: AliasKind, make: string, computed: AliasMapping[]) {
    const manual = await deps.aliases.list({ source, kind, origin: 'manual', ...(kind === 'model' ? { canonicalMake: make } : {}) });
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

  /** Maps and stores a site's make facets; returns the effective mappings. */
  async function applyMakeFacets(source: AliasSource, facets: SiteName[]) {
    const makes = await canonicalMakes();
    const computed = mapMakes(makes, facets.map((f) => f.name));
    const unmatched = computed.filter((m) => !m.canonical).map((m) => m.external);
    const nonCar = new Map(
      (unmatched.length ? mapMakesByName(await nonCarMakes(makes), unmatched) : [])
        .filter((m) => m.canonical)
        .map((m) => [m.external, m.canonical!]),
    );
    const counts = new Map(facets.map((f) => [f.name, f.count]));
    await deps.aliases.replaceAuto(
      { source, kind: 'make' },
      computed.map((m) => ({
        externalName: m.external,
        canonicalMake: m.canonical ?? '',
        canonical: nonCar.get(m.external) ?? '',
        match: nonCar.has(m.external) ? 'non_car' : m.match === 'manual' ? null : m.match,
        lotCount: counts.get(m.external) ?? null,
      })),
    );
    return effective(source, 'make', '', computed);
  }

  /** Maps and stores a site's model facets for one make; returns the effective mappings. */
  async function applyModelFacets(source: AliasSource, make: string, facets: SiteName[], models?: string[]) {
    const computed = mapModels(make, models ?? (await catalogModels(make)), facets.map((f) => f.name));
    const counts = new Map(facets.map((f) => [f.name, f.count]));
    await deps.aliases.replaceAuto(
      { source, kind: 'model', make },
      computed.map((m) => ({
        externalName: m.external,
        canonicalMake: make,
        canonical: m.canonical ?? '',
        match: m.match === 'manual' ? null : m.match,
        lotCount: counts.get(m.external) ?? null,
      })),
    );
    return effective(source, 'model', make, computed);
  }

  /** Our body styles plus the ones the user made by assigning to them. */
  async function canonicalBodyStyles(): Promise<string[]> {
    return [...new Set([...BODY_STYLES, ...(await deps.aliases.manualTargets('body'))])];
  }

  /** Maps and stores a site's body style facets; returns the effective mappings. */
  async function applyBodyFacets(source: AliasSource, facets: ExternalFacet[]) {
    const computed = mapBodyStyles(await canonicalBodyStyles(), facets.map((f) => f.name));
    const counts = new Map(facets.map((f) => [f.name, f.count]));
    await deps.aliases.replaceAuto(
      { source, kind: 'body' },
      computed.map((m) => ({
        externalName: m.external,
        canonicalMake: '',
        canonical: m.canonical ?? '',
        match: m.match === 'manual' ? null : m.match,
        lotCount: counts.get(m.external) ?? null,
      })),
    );
    return effective(source, 'body', '', computed);
  }

  /**
   * The site's body and engine values for the body style / engine filters of a search, read from
   * the site's facets for the matched makes and models; body names are recorded in the alias table.
   */
  async function resolveOptions(
    adapter: AuctionSearchAdapter,
    matched: MatchedNames,
    filters: LotSearchFilters,
    force = false,
  ): Promise<MatchedOptions> {
    if (!filters.bodyStyle && !filters.engine) return {};
    const years = searchYears(filters);
    const names = (list: string[]) => normalizeText([...list].sort().join('|'));
    const facets = await cachedFacets(
      adapter.source,
      `options:${names(matched.makes)}:${names(matched.models)}:${years.yearFrom}-${years.yearTo}`,
      force,
      () => adapter.optionFacets({ ...matched, ...years }),
    );
    const options: MatchedOptions = {};
    if (filters.bodyStyle) {
      const target = normalizeText(filters.bodyStyle);
      const rows = await applyBodyFacets(adapter.source, facets.body);
      options.bodyStyles = rows.filter((m) => m.canonical && normalizeText(m.canonical) === target).map((m) => m.external);
    }
    if (filters.engine) {
      options.engines = facets.engine.filter((f) => siteEngineLiters(f.name) === filters.engine).map((f) => f.name);
    }
    return options;
  }

  /** Site make names currently tied to a canonical make, from stored rows (no site request). */
  async function storedExternalMakes(source: AliasSource, make: string): Promise<string[]> {
    const rows = await deps.aliases.list({ source, kind: 'make' });
    const mappings = await effective(
      source,
      'make',
      '',
      rows
        .filter((r) => r.origin === 'auto')
        .map((r) => ({ external: r.externalName, canonical: r.canonicalMake || null, match: r.match === 'non_car' || r.match === 'unassigned' ? null : r.match })),
    );
    return mappings.filter((m) => m.canonical && normalizeMake(m.canonical) === normalizeMake(make)).map((m) => m.external);
  }

  /**
   * Expands a canonical make/model into the names `adapter`'s site files lots under, reading the
   * site's make and model facets for the year range and recording every mapping in the alias table.
   */
  async function resolve(adapter: AuctionSearchAdapter, filters: LotSearchFilters, force = false): Promise<MatchedNames> {
    const { source } = adapter;
    const years = searchYears(filters);
    const yearKey = `${years.yearFrom}-${years.yearTo}`;
    return resolveNames(source, filters, {
      makes: () => cachedFacets(source, `makes:${yearKey}`, force, () => adapter.makeFacets(years)),
      models: (makes) =>
        cachedFacets(source, `models:${normalizeText([...makes].sort().join('|'))}:${yearKey}`, force, () =>
          adapter.modelFacets(makes, years),
        ),
    });
  }

  /**
   * Expands a canonical make/model into a site's own names, given loaders for the site's make list
   * and the model list of its matched makes; every mapping is recorded in the alias table.
   * A missing make or model matches no names, which the search reads as "any".
   */
  async function resolveNames(
    source: AliasSource,
    query: { make?: string; model?: string },
    load: { makes: () => Promise<SiteName[]>; models: (makes: string[]) => Promise<SiteName[]> },
  ): Promise<MatchedNames> {
    const model = query.model?.trim();
    if (!query.make?.trim()) return { makes: [], models: [] };
    const make = await canonicalMakeName(query.make);
    const makeRows = await applyMakeFacets(source, await load.makes());
    const makes = makeRows.filter((m) => m.canonical && normalizeMake(m.canonical) === normalizeMake(make)).map((m) => m.external);
    if (makes.length === 0 || !model) return { makes, models: [] };

    const modelFacets = await load.models(makes);
    const models = await catalogModels(make);
    const modelRows = await applyModelFacets(source, make, modelFacets, models);

    // a model outside the catalog (user-made or typed, e.g. "C 63 AMG") also gets automatic matches
    // for this search only, so they are not stored against it
    const inCatalog = models.find((m) => normalizeText(m) === normalizeText(model));
    const target = inCatalog ?? model;
    const rows = inCatalog
      ? modelRows
      : await effective(source, 'model', make, mapModels(make, [...models, target], modelFacets.map((f) => f.name)));
    const matched = rows.filter((m) => m.canonical && normalizeText(m.canonical) === normalizeText(target)).map((m) => m.external);
    return { makes, models: [...new Set(matched)] };
  }

  /** All site names of a kind with their auto suggestion, manual assignment and status. */
  async function entries(filter: AliasEntryFilter): Promise<{ items: AliasEntry[]; total: number; counts: Record<AliasStatus, number> }> {
    const rows = await deps.aliases.list({
      kind: filter.kind,
      source: filter.source,
      ...(filter.kind === 'model' && filter.make ? { canonicalMake: filter.make } : {}),
    });
    const groups = new Map<string, VehicleAlias[]>();
    for (const r of rows) {
      const scope = r.kind === 'model' ? r.canonicalMake : '';
      const key = `${r.source}|${scope}|${r.externalName}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }

    const targetOf = (r: VehicleAlias) => (r.kind === 'make' ? r.canonicalMake : r.canonical);
    const all: AliasEntry[] = [...groups.values()].map((group) => {
      const first = group[0]!;
      const auto = group.filter((r) => r.origin === 'auto');
      const manual = group.filter((r) => r.origin === 'manual');
      const nonCar = auto.find((r) => r.match === 'non_car');
      const autoTargets = auto.filter((r) => r !== nonCar).map(targetOf).filter(Boolean);
      const manualTargets = manual.map(targetOf).filter(Boolean);
      const manualState: ManualState | null = manual.length
        ? manualTargets.length ? 'assigned' : manual.some((r) => r.match === 'unassigned') ? 'unassigned' : 'ignored'
        : null;
      const status: AliasStatus = manualState
        ? manualState === 'assigned' ? 'manual' : manualState
        : autoTargets.length ? 'auto' : nonCar ? 'non_car' : 'unassigned';
      const newest = group.reduce((a, b) => (b.lastSeenAt > a.lastSeenAt ? b : a));
      return {
        source: first.source,
        kind: first.kind,
        externalName: first.externalName,
        make: first.kind === 'model' ? first.canonicalMake : '',
        lotCount: auto[0]?.lotCount ?? manual[0]?.lotCount ?? null,
        lastSeenAt: newest.lastSeenAt.toISOString(),
        auto: { targets: autoTargets, match: (auto.find((r) => r.match)?.match ?? null) as AutoMatch | null, nonCarMake: nonCar?.canonical ?? null },
        manual: manualState ? { state: manualState, targets: manualTargets } : null,
        status,
      };
    });

    const q = filter.q ? normalizeText(filter.q) : '';
    const target = filter.target ? normalizeText(filter.target) : '';
    const matchesQuery = (e: AliasEntry) =>
      !q || [e.externalName, e.make, ...e.auto.targets, ...(e.manual?.targets ?? [])].some((s) => normalizeText(s).includes(q));
    const searched = all.filter(
      (e) => matchesQuery(e) && (!target || effectiveTargets(e).some((t) => normalizeText(t) === target)),
    );
    const counts = Object.fromEntries(ALIAS_STATUSES.map((s) => [s, searched.filter((e) => e.status === s).length])) as Record<
      AliasStatus,
      number
    >;
    const filtered = searched
      .filter((e) => !filter.status || e.status === filter.status)
      .sort((a, b) => (b.lotCount ?? 0) - (a.lotCount ?? 0) || a.externalName.localeCompare(b.externalName));
    return { items: filtered.slice(0, filter.limit ?? 500), total: filtered.length, counts };
  }

  /** Applies the user's decisions for site names. */
  async function assign(changes: (AliasKey & AliasChange)[]) {
    for (const change of changes) {
      if (change.action === 'reset') await deps.aliases.clearManual(change);
      else if (change.action === 'assign') {
        const targets = change.targets.map((t) => t.trim()).filter(Boolean);
        await deps.aliases.setManual(change, targets.length ? 'assigned' : 'unassigned', targets);
      } else await deps.aliases.setManual(change, change.action === 'ignore' ? 'ignored' : 'unassigned');
    }
    // cached searches were expanded with the old names
    if (changes.some((c) => !isCatalogMarketSource(c.source))) await deps.cache.removeByPrefix(LOT_SEARCH_CACHE_PREFIX);
    for (const site of new Set(changes.map((c) => c.source).filter(isCatalogMarketSource))) {
      await deps.cache.removeByPrefix(marketScanPrefix(site));
    }
  }

  /**
   * Our makes (catalog + user-made), or the models of a make, with the number of site names and
   * lots searched as each, for the column site names are dragged onto.
   */
  async function canonicalItems(filter: { kind: AliasKind; make?: string; source?: AliasSource }): Promise<CanonicalItem[]> {
    const make = filter.make ? await canonicalMakeName(filter.make) : '';
    if (filter.kind === 'model' && !make) return [];
    const names =
      filter.kind === 'make'
        ? await canonicalMakes()
        : filter.kind === 'body'
          ? await canonicalBodyStyles()
          : [...(await catalogModels(make)), ...(await deps.aliases.manualTargets('model', make))];
    const { items } = await entries({ kind: filter.kind, source: filter.source, make: filter.kind === 'model' ? make : undefined, limit: Infinity });

    const byKey = new Map<string, CanonicalItem>();
    const add = (name: string) => {
      const key = normalizeText(name);
      if (!byKey.has(key)) {
        const bySource = Object.fromEntries(ALIAS_SOURCES.map((s) => [s, 0])) as Record<AliasSource, number>;
        byKey.set(key, { name, siteNames: 0, bySource, lots: 0 });
      }
      return byKey.get(key)!;
    };
    for (const name of names) add(name);
    for (const e of items) {
      for (const t of effectiveTargets(e)) {
        const item = add(t);
        item.siteNames++;
        item.bySource[e.source]++;
        item.lots += e.lotCount ?? 0;
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  /** Makes that have site models recorded under them, with their unassigned model counts. */
  async function modelMakes(source?: AliasSource): Promise<{ name: string; unassigned: number }[]> {
    const { items } = await entries({ kind: 'model', source, limit: Infinity });
    const byMake = new Map<string, number>();
    for (const e of items) byMake.set(e.make, (byMake.get(e.make) ?? 0) + (e.status === 'unassigned' ? 1 : 0));
    return [...byMake]
      .map(([name, unassigned]) => ({ name, unassigned }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  /** Unassigned site names per kind across sites and makes, and per kind for each site. */
  async function unassignedCounts(): Promise<{ total: Record<AliasKind, number>; bySource: Record<AliasSource, Record<AliasKind, number>> }> {
    const kinds = ['make', 'model', 'body'] as const;
    const zero = () => ({ make: 0, model: 0, body: 0 });
    const total = zero();
    const bySource = Object.fromEntries(ALIAS_SOURCES.map((s) => [s, zero()])) as Record<AliasSource, Record<AliasKind, number>>;
    for (const kind of kinds) {
      const { items } = await entries({ kind, status: 'unassigned', limit: Infinity });
      total[kind] = items.length;
      for (const e of items) bySource[e.source][kind]++;
    }
    return { total, bySource };
  }

  return {
    resolve,
    resolveNames,
    resolveOptions,
    entries,
    assign,
    canonicalItems,
    modelMakes,
    unassignedCounts,
    applyMakeFacets,
    applyModelFacets,
    applyBodyFacets,
    storedExternalMakes,
    canonicalMakeName,
    allYears: ALL_YEARS,
  };
}

export type VehicleAliasService = ReturnType<typeof createVehicleAliasService>;
