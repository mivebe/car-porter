import {
  effectiveMarketSources,
  evaluateLot,
  summarizeIncluded,
  summarizeMarket,
  type Lot,
  type LotEvaluation,
  type PriceSummary,
} from '@car-porter/core';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import type { TrackedLotsRepository } from '../repositories/tracked-lots-repository.ts';
import type { FxService } from '../sources/ecb.ts';
import type { EstimateService } from './estimate-service.ts';
import { LotNotFoundError } from './lot-not-found.ts';
import type { MarketService } from './market-service.ts';

export interface TrackedLotRow {
  lot: Lot;
  trackedAt: string;
  /** Included bidfax matches (USD). */
  estimate: PriceSummary | null;
  /** Included BG market listings of the lot's marketplaces (EUR). */
  market: PriceSummary | null;
  evaluation: LotEvaluation;
}

export interface TrackedLotsResponse {
  lots: TrackedLotRow[];
  /** Rate used for every row; null when no rate is available. */
  usdToEur: number | null;
}

/** Tracked lots with their estimate, cost and verdict, recomputed from stored data (no scraping). */
export function createTrackingService(deps: {
  tracked: TrackedLotsRepository;
  lots: LotsRepository;
  inputs: LotInputsRepository;
  settings: SettingsRepository;
  estimate: EstimateService;
  market: MarketService;
  fx: FxService;
}) {
  async function list(): Promise<TrackedLotsResponse> {
    const [tracked, settings] = await Promise.all([deps.tracked.list(), deps.settings.get()]);
    const usdToEur = tracked.length
      ? await deps.fx.get().then(
          (r) => r.usdToEur,
          () => null,
        )
      : null;

    const rows = await Promise.all(
      tracked.map(async ({ lotId, createdAt }): Promise<TrackedLotRow | null> => {
        const found = await deps.lots.get(lotId);
        if (!found) return null;
        const lot = found.lot;
        const [inputs, estimate, market] = await Promise.all([
          deps.inputs.get(lotId),
          deps.estimate.get(lotId),
          deps.market.get(lotId),
        ]);
        const estimateSummary = summarizeIncluded(
          estimate.matches.map((m) => m.record),
          (r) => r.finalPriceUsdCents,
          new Set(estimate.excludedIds),
        );
        const marketSummary = summarizeMarket(lot, market.listings, {
          sites: effectiveMarketSources(inputs.marketSources, settings.market.enabledSources),
          toggles: inputs.marketMatch,
          mileageRangeKm: settings.market.mileageRangeKm,
          excludedIds: new Set(market.excludedIds),
        }).overall;
        return {
          lot,
          trackedAt: createdAt.toISOString(),
          estimate: estimateSummary,
          market: marketSummary,
          evaluation: evaluateLot({
            lot,
            inputs,
            settings,
            usdToEur,
            estimateUsdCents: estimateSummary?.average ?? null,
            marketAverageEurCents: marketSummary?.average ?? null,
          }),
        };
      }),
    );
    return { lots: rows.filter((r): r is TrackedLotRow => r !== null), usdToEur };
  }

  async function track(lotId: string) {
    if (!(await deps.lots.get(lotId))) throw new LotNotFoundError(lotId);
    const { createdAt } = await deps.tracked.add(lotId);
    return { lotId, trackedAt: createdAt.toISOString() };
  }

  return { list, track, untrack: deps.tracked.remove };
}

export type TrackingService = ReturnType<typeof createTrackingService>;
