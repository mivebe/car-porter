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
import { LotNotFoundError } from './lot-not-found.ts';

export { LotNotFoundError } from './lot-not-found.ts';

const MODELS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCAN_TTL_MS = 24 * 60 * 60 * 1000;

export type ScanStopReason = 'no_results' | 'reached_known' | 'older_than_window' | 'max_matches' | 'max_pages' | 'last_page' | 'error';

export interface ScanInfo {
  scannedAt: string;
  pagesScanned: number;
  newRecords: number;
  stopReason: ScanStopReason;
}

/**
 * The sale-date range that completed scans covered without gaps, from the top of the listing
 * (newest) down. Only records inside it may stop a later scan early: records stored by other paths
 * (VIN history searches, a scan that failed midway) don't prove the pages below them were read.
 */
export interface ScanCoverage {
  newest: string | null;
  oldest: string | null;
  /** The listing was read to its end. */
  exhausted: boolean;
  /** The scan that reached `oldest` stopped at this limit rather than at the listing end. */
  limitedBy: 'max_pages' | 'max_matches' | null;
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

/** Best bidfax model for an auction model name: exact (ignoring punctuation) before prefix matches. */
export function pickBidfaxModel(models: BidfaxModelLink[], lotModel: string): BidfaxModelLink | null {
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    models.find((m) => compact(m.name) === compact(lotModel) || m.slug === bidfaxSlug(lotModel)) ??
    models.find((m) => modelMatches(m.name, lotModel)) ??
    null
  );
}

function windowStart(now: Date, months: number): string {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - months);
  return start.toISOString();
}

/**
 * Coverage after a successful scan. Pass `previous` only when the scan ran into the covered range,
 * i.e. when the two ranges are contiguous.
 */
export function nextCoverage(
  previous: ScanCoverage | null,
  scannedDates: string[],
  stopReason: ScanStopReason,
): ScanCoverage {
  const sorted = [...scannedDates].sort();
  const scannedOldest = sorted[0] ?? null;
  const reachedEnd = stopReason === 'no_results' || stopReason === 'last_page';
  const newest = [sorted.at(-1), previous?.newest].filter((d): d is string => d != null).sort().at(-1) ?? null;

  if (previous?.oldest && (scannedOldest == null || previous.oldest <= scannedOldest)) {
    // the scan stopped inside the covered range: everything below it is still covered
    return {
      newest,
      oldest: previous.oldest,
      exhausted: previous.exhausted || reachedEnd,
      limitedBy: reachedEnd ? null : previous.limitedBy,
    };
  }
  return {
    newest,
    oldest: scannedOldest,
    exhausted: reachedEnd,
    limitedBy: stopReason === 'max_pages' || stopReason === 'max_matches' ? stopReason : null,
  };
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
  const coverageKey = (makeSlug: string, modelSlug: string, year: number) =>
    `bidfax:coverage:${makeSlug}:${modelSlug}:${year}`;

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
   * Stops at: an empty page, a page reaching the covered range when the stored data is enough for
   * this lot (incremental; skipped when forced), a page entirely older than the time window, enough
   * matches, the page limit, or the last linked page. A scan younger than 24 h is reused unless
   * `force` — or unless it stopped at another lot's match limit while this lot still lacks matches
   * (scans are shared by every lot of the model/year; match counts depend on the lot's trim).
   */
  async function run(lotId: string, force = false): Promise<EstimateResponse> {
    const lot = await loadLot(lotId);
    let makeSlug: string | null = null;
    let modelSlug: string | null = null;
    try {
      const resolved = await resolveModel(lot, false);
      const mk = (makeSlug = resolved.makeSlug);
      const md = (modelSlug = resolved.model.slug);
      const key = scanKey(mk, md, lot.year);
      const { maxPages, maxMonths, maxMatches } = (await deps.settings.get()).bidfax;
      const stored = () => deps.records.findByModelYear('bidfax', mk, md, lot.year);
      const lotMatchCount = async () =>
        selectAuctionMatches(lot, await stored(), { now: now(), maxMonths, maxMatches }).length;

      const previous = await deps.cache.get<ScanInfo>(key);
      if (
        previous?.fresh &&
        !force &&
        (previous.payload.stopReason !== 'max_matches' || (await lotMatchCount()) >= maxMatches)
      ) {
        return build(lot, mk, md);
      }

      const coverage = (await deps.cache.get<ScanCoverage>(coverageKey(mk, md, lot.year)))?.payload ?? null;
      const known = new Set((await stored()).map((r) => r.id));
      const isCovered = (r: AuctionRecord) =>
        known.has(r.id) &&
        r.saleDate != null &&
        coverage?.newest != null &&
        coverage.oldest != null &&
        r.saleDate <= coverage.newest &&
        r.saleDate >= coverage.oldest;
      const coverageIsEnough = async () =>
        coverage != null &&
        (coverage.exhausted ||
          coverage.limitedBy === 'max_pages' ||
          (coverage.oldest != null && coverage.oldest < windowStart(now(), maxMonths)) ||
          (await lotMatchCount()) >= maxMatches);

      const context = { makeSlug: mk, modelSlug: md, makeName: lot.make, modelName: resolved.model.name };
      let page = 1;
      let pagesScanned = 0;
      let newRecords = 0;
      let touchedCoverage = false;
      const scannedDates: string[] = [];
      let stopReason: ScanStopReason = 'max_pages';
      let scanError: SourceErrorInfo | undefined;

      try {
        while (page <= maxPages) {
          const { records, linkedPages } = parseBidfaxListing(
            await deps.fetchHtml(bidfaxListingUrl(mk, md, lot.year, page)),
            context,
          );
          pagesScanned++;
          newRecords += records.filter((r) => !known.has(r.id)).length;
          scannedDates.push(...records.flatMap((r) => (r.saleDate ? [r.saleDate] : [])));
          await deps.records.upsertMany(records);

          if (records.length === 0) {
            stopReason = 'no_results';
            break;
          }
          if (!force && records.some(isCovered)) {
            touchedCoverage = true;
            if (await coverageIsEnough()) {
              stopReason = 'reached_known';
              break;
            }
          }
          if (records.every((r) => !isWithinMonths(r.saleDate, now(), maxMonths))) {
            stopReason = 'older_than_window';
            break;
          }
          if ((await lotMatchCount()) >= maxMatches) {
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

      if (scanError) {
        // the stored records may now have gaps, so later scans must not stop early on them
        await deps.cache.remove(coverageKey(mk, md, lot.year));
      } else {
        await deps.cache.set<ScanInfo>(key, 'bidfax', { scannedAt: now().toISOString(), pagesScanned, newRecords, stopReason }, SCAN_TTL_MS);
        await deps.cache.set<ScanCoverage>(
          coverageKey(mk, md, lot.year),
          'bidfax',
          nextCoverage(touchedCoverage ? coverage : null, scannedDates, stopReason),
          null,
        );
      }
      return build(lot, mk, md, scanError);
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
