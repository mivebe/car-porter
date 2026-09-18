import {
  mapMakes,
  mapMakesByName,
  mapModels,
  normalizeMake,
  normalizeText,
  type AliasMapping,
  type AuctionSource,
  type LotSearchFilters,
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
import type { AuctionSearchAdapter, ExternalFacet, YearRange } from '../sources/auction-adapter.ts';
import type { CatalogService } from '../sources/nhtsa.ts';
import { LOT_SEARCH_CACHE_PREFIX } from './lot-search-service.ts';

export const ALIAS_FACETS_TTL_MS = 12 * 60 * 60 * 1000;

/** The site's own names a canonical search expanded to. Empty = the site has nothing under that name. */
export interface MatchedNames {
  makes: string[];
  models: string[];
}

/** non_car: automatically recognised as a motorcycle/trailer/bus make, so not waiting for assignment */
export type AliasStatus = 'unassigned' | 'auto' | 'non_car' | 'manual' | 'ignored';
export const ALIAS_STATUSES: AliasStatus[] = ['unassigned', 'auto', 'non_car', 'manual', 'ignored'];

/** One site name with its automatic suggestion and the user's assignment, if any. */
export interface AliasEntry {
  source: AuctionSource;
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
  bySource: Record<AuctionSource, number>;
  lots: number;
}

export interface AliasEntryFilter {
  kind: AliasKind;
  source?: AuctionSource;
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
  async function cachedFacets(source: AuctionSource, key: string, force: boolean, load: () => Promise<ExternalFacet[]>) {
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
  async function effective(source: AuctionSource, kind: AliasKind, make: string, computed: AliasMapping[]) {
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
  async function applyMakeFacets(source: AuctionSource, facets: ExternalFacet[]) {
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
  async function applyModelFacets(source: AuctionSource, make: string, facets: ExternalFacet[], models?: string[]) {
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

  /** Site make names currently tied to a canonical make, from stored rows (no site request). */
  async function storedExternalMakes(source: AuctionSource, make: string): Promise<string[]> {
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
    const years = { yearFrom: filters.yearFrom, yearTo: filters.yearTo };
    const yearKey = `${years.yearFrom}-${years.yearTo}`;
    const make = await canonicalMakeName(filters.make);

    const makeFacets = await cachedFacets(source, `makes:${yearKey}`, force, () => adapter.makeFacets(years));
    const makeRows = await applyMakeFacets(source, makeFacets);
    const makes = makeRows.filter((m) => m.canonical && normalizeMake(m.canonical) === normalizeMake(make)).map((m) => m.external);
    if (makes.length === 0) return { makes, models: [] };

    const modelFacets = await cachedFacets(source, `models:${normalizeText([...makes].sort().join('|'))}:${yearKey}`, force, () =>
      adapter.modelFacets(makes, years),
    );
    const models = await catalogModels(make);
    const modelRows = await applyModelFacets(source, make, modelFacets, models);

    // a model outside the catalog (user-made or typed, e.g. "C 63 AMG") also gets automatic matches
    // for this search only, so they are not stored against it
    const inCatalog = models.find((m) => normalizeText(m) === normalizeText(filters.model));
    const target = inCatalog ?? filters.model.trim();
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
    if (changes.length) await deps.cache.removeByPrefix(LOT_SEARCH_CACHE_PREFIX);
  }

  /**
   * Our makes (catalog + user-made), or the models of a make, with the number of site names and
   * lots searched as each, for the column site names are dragged onto.
   */
  async function canonicalItems(filter: { kind: AliasKind; make?: string; source?: AuctionSource }): Promise<CanonicalItem[]> {
    const make = filter.make ? await canonicalMakeName(filter.make) : '';
    if (filter.kind === 'model' && !make) return [];
    const names =
      filter.kind === 'make'
        ? await canonicalMakes()
        : [...(await catalogModels(make)), ...(await deps.aliases.manualTargets('model', make))];
    const { items } = await entries({ kind: filter.kind, source: filter.source, make: filter.kind === 'model' ? make : undefined, limit: Infinity });

    const byKey = new Map<string, CanonicalItem>();
    const add = (name: string) => {
      const key = normalizeText(name);
      if (!byKey.has(key)) byKey.set(key, { name, siteNames: 0, bySource: { copart: 0, iaai: 0 }, lots: 0 });
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
  async function modelMakes(source?: AuctionSource): Promise<{ name: string; unassigned: number }[]> {
    const { items } = await entries({ kind: 'model', source, limit: Infinity });
    const byMake = new Map<string, number>();
    for (const e of items) byMake.set(e.make, (byMake.get(e.make) ?? 0) + (e.status === 'unassigned' ? 1 : 0));
    return [...byMake]
      .map(([name, unassigned]) => ({ name, unassigned }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  /** Unassigned site names per kind, across sites and makes. */
  async function unassignedCounts(): Promise<Record<AliasKind, number>> {
    const [makes, models] = await Promise.all([entries({ kind: 'make', limit: 0 }), entries({ kind: 'model', limit: 0 })]);
    return { make: makes.counts.unassigned, model: models.counts.unassigned };
  }

  return {
    resolve,
    entries,
    assign,
    canonicalItems,
    modelMakes,
    unassignedCounts,
    applyMakeFacets,
    applyModelFacets,
    storedExternalMakes,
    canonicalMakeName,
    allYears: ALL_YEARS,
  };
}

export type VehicleAliasService = ReturnType<typeof createVehicleAliasService>;
