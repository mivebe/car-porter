import {
  isWithinMonths,
  modelMatches,
  selectAuctionMatches,
  type AuctionCriterion,
  type AuctionRecord,
  type CriterionResult,
  type Lot,
  type SourceErrorInfo,
} from '@car-porter/core';
import type { AuctionRecordsRepository } from '../repositories/auction-records-repository.ts';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { SelectionsRepository } from '../repositories/selections-repository.ts';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError, toSourceErrorInfo } from '../scraping/errors.ts';
import { BIDFAX_ORIGIN, type HtmlFetcher } from '../sources/bidfax-client.ts';
import {
  bidfaxListingUrl,
  bidfaxSlug,
  parseBidfaxListing,
  parseBidfaxModels,
  type BidfaxModelLink,
} from '../sources/bidfax.ts';

const MODELS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCAN_TTL_MS = 24 * 60 * 60 * 1000;

export type ScanStopReason = 'no_results' | 'reached_known' | 'older_than_window' | 'max_matches' | 'max_pages' | 'last_page' | 'error';

export interface ScanInfo {
  scannedAt: string;
  pagesScanned: number;
  newRecords: number;
  stopReason: ScanStopReason;
}

export interface EstimateMatch {
  record: AuctionRecord;
  criteria: Record<AuctionCriterion, CriterionResult>;
  unknown: AuctionCriterion[];
}

export interface EstimateResponse {
  lotId: string;
  /** Link to the bidfax listing the scan used, for opening it directly. */
  searchUrl: string | null;
  matches: EstimateMatch[];
  excludedIds: string[];
  scan: (ScanInfo & { fresh: boolean }) | null;
  error?: SourceErrorInfo;
}

export class LotNotFoundError extends Error {}

/** Best bidfax model for an auction model name: exact (ignoring punctuation) before prefix matches. */
export function pickBidfaxModel(models: BidfaxModelLink[], lotModel: string): BidfaxModelLink | null {
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    models.find((m) => compact(m.name) === compact(lotModel) || m.slug === bidfaxSlug(lotModel)) ??
    models.find((m) => modelMatches(m.name, lotModel)) ??
    null
  );
}

export function createEstimateService(deps: {
  fetchHtml: HtmlFetcher;
  cache: CacheRepository;
  lots: LotsRepository;
  records: AuctionRecordsRepository;
  selections: SelectionsRepository;
  settings: SettingsRepository;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function resolveModel(lot: Lot, force: boolean) {
    const makeSlug = bidfaxSlug(lot.make);
    const models = await cached(
      deps.cache,
      { key: `bidfax:models:${makeSlug}`, source: 'bidfax', ttlMs: MODELS_TTL_MS, force },
      async () => parseBidfaxModels(await deps.fetchHtml(`${BIDFAX_ORIGIN}/${makeSlug}/`), makeSlug),
    );
    if (!models.ok) throw new SourceError(models.error.code, models.error.message);
    const model = pickBidfaxModel(models.data, lot.model);
    if (!model) throw new SourceError('not_found', `bidfax: no model matching "${lot.model}" for ${lot.make}`);
    return { makeSlug, model };
  }

  const scanKey = (makeSlug: string, modelSlug: string, year: number) => `bidfax:scan:${makeSlug}:${modelSlug}:${year}`;

  async function build(lot: Lot, makeSlug: string | null, modelSlug: string | null, error?: SourceErrorInfo) {
    const { maxMonths, maxMatches } = (await deps.settings.get()).bidfax;
    const records = makeSlug && modelSlug ? await deps.records.findByModelYear('bidfax', makeSlug, modelSlug, lot.year) : [];
    const scan = makeSlug && modelSlug ? await deps.cache.get<ScanInfo>(scanKey(makeSlug, modelSlug, lot.year)) : null;
    const response: EstimateResponse = {
      lotId: lot.id,
      searchUrl: makeSlug && modelSlug ? bidfaxListingUrl(makeSlug, modelSlug, lot.year) : null,
      matches: selectAuctionMatches(lot, records, { now: now(), maxMonths, maxMatches }).map(({ record, match }) => ({
        record,
        criteria: match.criteria,
        unknown: match.unknown,
      })),
      excludedIds: await deps.selections.excludedIds(lot.id, 'auction'),
      scan: scan ? { ...scan.payload, fresh: scan.fresh } : null,
      ...(error ? { error } : {}),
    };
    return response;
  }

  async function loadLot(lotId: string) {
    const found = await deps.lots.get(lotId);
    if (!found) throw new LotNotFoundError(lotId);
    return found.lot;
  }

  /** Stored matches only (no network). */
  async function get(lotId: string): Promise<EstimateResponse> {
    const lot = await loadLot(lotId);
    const makeSlug = bidfaxSlug(lot.make);
    const models = await deps.cache.get<BidfaxModelLink[]>(`bidfax:models:${makeSlug}`);
    const model = models ? pickBidfaxModel(models.payload, lot.model) : null;
    return build(lot, model ? makeSlug : null, model?.slug ?? null);
  }

  /**
   * Scans bidfax newest-first for the lot's make/model/exact year and stores every record.
   * Stops at: an empty page, a page containing an already-stored sale (incremental; skipped when
   * forced), a page entirely older than the time window, enough matches, the page limit, or the
   * last linked page. A scan younger than 24 h is reused unless `force`.
   */
  async function run(lotId: string, force = false): Promise<EstimateResponse> {
    const lot = await loadLot(lotId);
    let makeSlug: string | null = null;
    let modelSlug: string | null = null;
    try {
      const resolved = await resolveModel(lot, false);
      makeSlug = resolved.makeSlug;
      modelSlug = resolved.model.slug;
      const key = scanKey(makeSlug, modelSlug, lot.year);
      const previous = await deps.cache.get<ScanInfo>(key);
      if (previous?.fresh && !force) return build(lot, makeSlug, modelSlug);

      const { maxPages, maxMonths, maxMatches } = (await deps.settings.get()).bidfax;
      const context = { makeSlug, modelSlug, makeName: lot.make, modelName: resolved.model.name };
      const known = new Set((await deps.records.findByModelYear('bidfax', makeSlug, modelSlug, lot.year)).map((r) => r.id));

      let page = 1;
      let pagesScanned = 0;
      let newRecords = 0;
      let stopReason: ScanStopReason = 'max_pages';
      let scanError: SourceErrorInfo | undefined;

      try {
        while (page <= maxPages) {
          const { records, linkedPages } = parseBidfaxListing(
            await deps.fetchHtml(bidfaxListingUrl(makeSlug, modelSlug, lot.year, page)),
            context,
          );
          pagesScanned++;
          newRecords += records.filter((r) => !known.has(r.id)).length;
          await deps.records.upsertMany(records);

          if (records.length === 0) {
            stopReason = 'no_results';
            break;
          }
          if (!force && records.some((r) => known.has(r.id))) {
            stopReason = 'reached_known';
            break;
          }
          if (records.every((r) => !isWithinMonths(r.saleDate, now(), maxMonths))) {
            stopReason = 'older_than_window';
            break;
          }
          const stored = await deps.records.findByModelYear('bidfax', makeSlug, modelSlug, lot.year);
          if (selectAuctionMatches(lot, stored, { now: now(), maxMonths, maxMatches }).length >= maxMatches) {
            stopReason = 'max_matches';
            break;
          }
          if (!linkedPages.includes(page + 1)) {
            stopReason = 'last_page';
            break;
          }
          page++;
        }
      } catch (err) {
        // keep what was stored so far; report the error alongside the partial result
        stopReason = 'error';
        scanError = toSourceErrorInfo(err);
      }

      if (!scanError) {
        await deps.cache.set<ScanInfo>(key, 'bidfax', { scannedAt: now().toISOString(), pagesScanned, newRecords, stopReason }, SCAN_TTL_MS);
      }
      return build(lot, makeSlug, modelSlug, scanError);
    } catch (err) {
      return build(lot, makeSlug, modelSlug, toSourceErrorInfo(err));
    }
  }

  async function setIncluded(lotId: string, recordId: string, included: boolean) {
    await deps.selections.set(lotId, 'auction', recordId, included);
    return deps.selections.excludedIds(lotId, 'auction');
  }

  return { get, run, setIncluded };
}

export type EstimateService = ReturnType<typeof createEstimateService>;
