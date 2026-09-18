import {
  effectiveMarketSources,
  isCatalogMarketSource,
  MARKET_SOURCES,
  normalizeMake,
  normalizeText,
  type Lot,
  type MarketSource,
  type SourceErrorInfo,
} from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { MarketListingsRepository, StoredMarketListing } from '../repositories/market-listings-repository.ts';
import type { SelectionsRepository } from '../repositories/selections-repository.ts';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import { cached } from '../scraping/cached.ts';
import { notFound, type CatalogEntry, type MarketAdapter, type MarketScan } from '../sources/market-adapter.ts';
import { LotNotFoundError } from './lot-not-found.ts';
import type { VehicleAliasService } from './vehicle-alias-service.ts';

/** Listings are re-checked at most daily unless refreshed. */
export const MARKET_TTL_MS = 24 * 60 * 60 * 1000;

/** Cached searches of a site start with this; they are dropped when its aliases change. */
export const marketScanPrefix = (site: MarketSource) => `market:scan:${site}:`;

interface ScanPayload {
  listingIds: string[];
  /** Listings of the previous complete scan that are gone now. */
  removedIds: string[];
  pagesScanned: number;
  complete: boolean;
  searchUrl: string;
}

export interface MarketSiteResult {
  site: MarketSource;
  /** Used for this lot (its own choice or the settings default). */
  enabled: boolean;
  /** null = never checked. */
  checkedAt: string | null;
  fromCache: boolean;
  found: number | null;
  removed: number | null;
  pagesScanned: number | null;
  /** false = the page limit cut the search short. */
  complete: boolean | null;
  searchUrl: string | null;
  error?: SourceErrorInfo;
}

export interface MarketResponse {
  lotId: string;
  sites: MarketSiteResult[];
  /** Every listing the latest search of each site found; matching happens on the client. */
  listings: StoredMarketListing[];
  excludedIds: string[];
}

export function createMarketService(deps: {
  adapters: MarketAdapter[];
  aliases: Pick<VehicleAliasService, 'resolveNames'>;
  cache: CacheRepository;
  lots: LotsRepository;
  inputs: LotInputsRepository;
  listings: MarketListingsRepository;
  selections: SelectionsRepository;
  settings: SettingsRepository;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function load(lotId: string) {
    const found = await deps.lots.get(lotId);
    if (!found) throw new LotNotFoundError(lotId);
    const lot = found.lot;
    const [inputs, settings] = await Promise.all([deps.inputs.get(lotId), deps.settings.get()]);
    const enabled = new Set(effectiveMarketSources(inputs.marketSources, settings.market.enabledSources));
    // one search per site + make/model/exact year, shared by every lot of that model/year
    const key = (site: MarketSource) =>
      `${marketScanPrefix(site)}${normalizeMake(lot.make)}:${normalizeText(lot.model).replace(/\s/g, '')}:${lot.year}`;
    return { lot, enabled, settings, key };
  }

  async function respond(ctx: Awaited<ReturnType<typeof load>>, sites: MarketSiteResult[], payloads: (ScanPayload | null)[]) {
    const listings = await deps.listings.findByIds(payloads.flatMap((p) => p?.listingIds ?? []));
    return {
      lotId: ctx.lot.id,
      sites,
      // the search already chose the site models this lot's model is filed under, so each listing
      // counts as that model (a site's "C 63 AMG" for our "AMG C 63")
      listings: listings.map((l) => ({ ...l, model: ctx.lot.model })),
      excludedIds: await deps.selections.excludedIds(ctx.lot.id, 'market'),
    } satisfies MarketResponse;
  }

  const siteResult = (
    site: MarketSource,
    enabled: boolean,
    payload: ScanPayload | null,
    extra: { checkedAt: string | null; fromCache: boolean; error?: SourceErrorInfo },
  ): MarketSiteResult => ({
    site,
    enabled,
    checkedAt: extra.checkedAt,
    fromCache: extra.fromCache,
    found: payload?.listingIds.length ?? null,
    removed: payload?.removedIds.length ?? null,
    pagesScanned: payload?.pagesScanned ?? null,
    complete: payload?.complete ?? null,
    searchUrl: payload?.searchUrl ?? null,
    ...(extra.error ? { error: extra.error } : {}),
  });

  /**
   * Searches one site for the lot. Sites with their own make/model lists search every site model
   * the alias table maps to the lot's model ("C-Class" is "C 180", "C 200"... on mobile.bg).
   */
  async function searchSite(adapter: MarketAdapter, lot: Lot, maxPages: number): Promise<MarketScan> {
    const { site, catalog } = adapter;
    if (!catalog || !isCatalogMarketSource(site)) {
      const name = (value: string): CatalogEntry => ({ value, label: value });
      return adapter.scan({ make: name(lot.make), model: name(lot.model), year: lot.year }, { maxPages });
    }

    const makes = await catalog.makes();
    const models = new Map<string, { make: CatalogEntry; model: CatalogEntry }>();
    const matched = await deps.aliases.resolveNames(site, lot, {
      makes: async () => makes.map((m) => ({ name: m.label, count: null })),
      models: async (names) => {
        for (const make of makes.filter((m) => names.includes(m.label))) {
          for (const model of await catalog.models(make)) if (!models.has(model.label)) models.set(model.label, { make, model });
        }
        return [...models.keys()].map((name) => ({ name, count: null }));
      },
    });
    if (matched.makes.length === 0) notFound(site, `make "${lot.make}"`);
    const targets = matched.models.flatMap((name) => models.get(name) ?? []);
    if (targets.length === 0) notFound(site, `model "${lot.model}"`);

    const scans: MarketScan[] = [];
    for (const { make, model } of targets) scans.push(await adapter.scan({ make, model, year: lot.year }, { maxPages }));
    return {
      listings: scans.flatMap((s) => s.listings),
      pagesScanned: scans.reduce((sum, s) => sum + s.pagesScanned, 0),
      complete: scans.every((s) => s.complete),
      searchUrl: scans[0]!.searchUrl,
    };
  }

  /** Stored listings of the latest search per site (no network). */
  async function get(lotId: string): Promise<MarketResponse> {
    const ctx = await load(lotId);
    const entries = await Promise.all(MARKET_SOURCES.map((site) => deps.cache.get<ScanPayload>(ctx.key(site))));
    const sites = MARKET_SOURCES.map((site, i) =>
      siteResult(site, ctx.enabled.has(site), entries[i]?.payload ?? null, {
        checkedAt: entries[i]?.fetchedAt.toISOString() ?? null,
        fromCache: true,
      }),
    );
    return respond(ctx, sites, entries.map((e) => e?.payload ?? null));
  }

  /** Searches the lot's enabled marketplaces in parallel (each site has its own queue). */
  async function run(lotId: string, force = false): Promise<MarketResponse> {
    const ctx = await load(lotId);
    const { lot, settings } = ctx;
    const results = await Promise.all(
      MARKET_SOURCES.map(async (site) => {
        const adapter = deps.adapters.find((a) => a.site === site);
        if (!ctx.enabled.has(site) || !adapter) {
          const entry = await deps.cache.get<ScanPayload>(ctx.key(site));
          const payload = entry?.payload ?? null;
          return {
            payload,
            result: siteResult(site, false, payload, { checkedAt: entry?.fetchedAt.toISOString() ?? null, fromCache: true }),
          };
        }

        const previous = (await deps.cache.get<ScanPayload>(ctx.key(site)))?.payload ?? null;
        const scan = await cached<ScanPayload>(
          deps.cache,
          { key: ctx.key(site), source: site, ttlMs: MARKET_TTL_MS, force },
          async () => {
            const result = await searchSite(adapter, lot, settings.market.maxPages);
            const seenAt = now();
            const listingIds = [...new Set(result.listings.map((l) => l.id))];
            await deps.listings.upsertSeen(result.listings, seenAt);
            // only a complete scan proves that a listing is gone
            const removedIds = result.complete && previous ? previous.listingIds.filter((id) => !listingIds.includes(id)) : [];
            await deps.listings.markRemoved(removedIds, seenAt);
            return { listingIds, removedIds, pagesScanned: result.pagesScanned, complete: result.complete, searchUrl: result.searchUrl };
          },
        );
        if (!scan.ok) {
          return { payload: null, result: siteResult(site, true, null, { checkedAt: null, fromCache: false, error: scan.error }) };
        }
        return {
          payload: scan.data,
          result: siteResult(site, true, scan.data, {
            checkedAt: scan.fetchedAt.toISOString(),
            fromCache: scan.fromCache,
            ...(scan.error ? { error: scan.error } : {}),
          }),
        };
      }),
    );
    return respond(
      ctx,
      results.map((r) => r.result),
      results.map((r) => r.payload),
    );
  }

  async function setIncluded(lotId: string, listingId: string, included: boolean) {
    await deps.selections.set(lotId, 'market', listingId, included);
    return deps.selections.excludedIds(lotId, 'market');
  }

  return { get, run, setIncluded };
}

export type MarketService = ReturnType<typeof createMarketService>;
