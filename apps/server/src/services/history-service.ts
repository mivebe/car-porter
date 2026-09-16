import {
  checkVin,
  effectiveVin,
  isLotHistoryRecord,
  mergeHistory,
  type AuctionRecord,
  type HistoryEntry,
  type SourceErrorInfo,
} from '@car-porter/core';
import type { AuctionRecordsRepository } from '../repositories/auction-records-repository.ts';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import { cached } from '../scraping/cached.ts';
import type { HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { BidfaxSearcher } from '../sources/bidfax-client.ts';
import { parseBidfaxSearch } from '../sources/bidfax.ts';
import { parseStatVinHistory, statVinUrl } from '../sources/statvin.ts';
import { LotNotFoundError } from './lot-not-found.ts';

/** A repeated check within this window reuses the previous one (the refresh button bypasses it). */
export const HISTORY_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

export type HistorySite = 'bidfax' | 'statvin';
export type HistoryQuery = 'vin' | 'lot';

export interface HistoryCheck {
  site: HistorySite;
  query: HistoryQuery;
  value: string;
  /** null = never checked. */
  checkedAt: string | null;
  fromCache: boolean;
  /** Appearances of this vehicle the site returned. */
  found: number | null;
  error?: SourceErrorInfo;
}

export interface HistoryResponse {
  lotId: string;
  /** VIN the history is searched by: a valid pasted VIN wins over the lot's own. */
  vin: string | null;
  vinSource: 'override' | 'lot' | null;
  lotNumber: string;
  entries: HistoryEntry[];
  checks: HistoryCheck[];
}

interface CheckPayload {
  found: number;
}

interface PlannedCheck {
  site: HistorySite;
  query: HistoryQuery;
  value: string;
  load: () => Promise<AuctionRecord[]>;
}

/**
 * Prior auction appearances of a lot's vehicle: bidfax site search by VIN and by lot number, and
 * stat.vin by VIN (it has no lot-number lookup). Records are stored permanently, so re-checks
 * only add appearances; entries are merged across sites by (auction, lot, date).
 */
export function createHistoryService(deps: {
  searchBidfax: BidfaxSearcher;
  fetchStatVin: HtmlFetcher;
  cache: CacheRepository;
  lots: LotsRepository;
  inputs: LotInputsRepository;
  records: AuctionRecordsRepository;
}) {
  async function load(lotId: string) {
    const found = await deps.lots.get(lotId);
    if (!found) throw new LotNotFoundError(lotId);
    const lot = found.lot;
    const { vinOverride } = await deps.inputs.get(lotId);
    const vin = effectiveVin(lot.vin, vinOverride);
    const vinSource = !vin ? null : vinOverride && checkVin(vinOverride).valid ? 'override' : 'lot';

    const planned: PlannedCheck[] = [];
    if (vin) {
      planned.push({ site: 'bidfax', query: 'vin', value: vin, load: async () => parseBidfaxSearch(await deps.searchBidfax(vin)) });
      planned.push({
        site: 'statvin',
        query: 'vin',
        value: vin,
        load: async () => parseStatVinHistory(await deps.fetchStatVin(statVinUrl(vin))),
      });
    }
    planned.push({
      site: 'bidfax',
      query: 'lot',
      value: lot.lotNumber,
      load: async () => parseBidfaxSearch(await deps.searchBidfax(lot.lotNumber)),
    });
    return { lot, vin, vinSource, planned } as const;
  }

  const checkKey = (c: Pick<PlannedCheck, 'site' | 'query' | 'value'>) => `history:${c.site}:${c.query}:${c.value}`;

  async function respond(ctx: Awaited<ReturnType<typeof load>>, checks: HistoryCheck[]): Promise<HistoryResponse> {
    const { lot, vin, vinSource } = ctx;
    const records = (await deps.records.findByVinOrLot(vin, lot.lotNumber)).filter((r) => isLotHistoryRecord(lot, vin, r));
    return { lotId: lot.id, vin, vinSource, lotNumber: lot.lotNumber, entries: mergeHistory(records), checks };
  }

  /** Stored history and the last time each check ran (no network). */
  async function get(lotId: string): Promise<HistoryResponse> {
    const ctx = await load(lotId);
    const checks = await Promise.all(
      ctx.planned.map(async ({ site, query, value }): Promise<HistoryCheck> => {
        const entry = await deps.cache.get<CheckPayload>(checkKey({ site, query, value }));
        return {
          site,
          query,
          value,
          checkedAt: entry?.fetchedAt.toISOString() ?? null,
          fromCache: true,
          found: entry?.payload.found ?? null,
        };
      }),
    );
    return respond(ctx, checks);
  }

  /** Runs every check (sites in parallel, each site's own queue serializes its requests). */
  async function run(lotId: string, force = false): Promise<HistoryResponse> {
    const ctx = await load(lotId);
    const checks = await Promise.all(
      ctx.planned.map(async (check): Promise<HistoryCheck> => {
        const result = await cached<CheckPayload>(
          deps.cache,
          { key: checkKey(check), source: check.site, ttlMs: HISTORY_CHECK_TTL_MS, force },
          async () => {
            const records = await check.load();
            await deps.records.upsertMany(records);
            return { found: records.filter((r) => isLotHistoryRecord(ctx.lot, ctx.vin, r)).length };
          },
        );
        const base = { site: check.site, query: check.query, value: check.value };
        if (!result.ok) return { ...base, checkedAt: null, fromCache: false, found: null, error: result.error };
        return {
          ...base,
          checkedAt: result.fetchedAt.toISOString(),
          fromCache: result.fromCache,
          found: result.data.found,
          ...(result.error ? { error: result.error } : {}),
        };
      }),
    );
    return respond(ctx, checks);
  }

  return { get, run };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
