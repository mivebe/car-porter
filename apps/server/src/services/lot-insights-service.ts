import {
  effectiveMarketSources,
  evaluateLot,
  summarizeIncluded,
  summarizeMarket,
  type Lot,
  type LotEvaluation,
  type PriceSummary,
  type Settings,
} from '@car-porter/core';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import type { FxService } from '../sources/ecb.ts';
import type { EstimateService } from './estimate-service.ts';
import type { HistoryService } from './history-service.ts';
import type { MarketService } from './market-service.ts';

export interface LotInsights {
  lotId: string;
  /** Prior auction appearances of the vehicle; null until the history was checked. */
  historyCount: number | null;
  /** Included bidfax matches (USD). */
  estimate: PriceSummary | null;
  /** Included BG market listings of the lot's marketplaces (EUR). */
  market: PriceSummary | null;
  evaluation: LotEvaluation;
}

/** Estimate, history, cost and verdict per lot, recomputed from stored data (no scraping). */
export function createLotInsightsService(deps: {
  lots: LotsRepository;
  inputs: LotInputsRepository;
  settings: SettingsRepository;
  estimate: EstimateService;
  market: MarketService;
  history: HistoryService;
  fx: FxService;
}) {
  const usdToEur = () =>
    deps.fx.get().then(
      (r) => r.usdToEur,
      () => null,
    );

  async function one(lot: Lot, settings: Settings, rate: number | null): Promise<LotInsights> {
    const [inputs, estimate, market, history] = await Promise.all([
      deps.inputs.get(lot.id),
      deps.estimate.get(lot.id),
      deps.market.get(lot.id),
      deps.history.get(lot.id),
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
      lotId: lot.id,
      historyCount: history.checks.some((c) => c.checkedAt) ? history.entries.length : null,
      estimate: estimateSummary,
      market: marketSummary,
      evaluation: evaluateLot({
        lot,
        inputs,
        settings,
        usdToEur: rate,
        estimateUsdCents: estimateSummary?.average ?? null,
        marketAverageEurCents: marketSummary?.average ?? null,
      }),
    };
  }

  /** The stored lots among `lotIds` (unknown ids are skipped) with their insights, plus the rate used. */
  async function forLots(lotIds: string[]) {
    const found = await Promise.all(lotIds.map((id) => deps.lots.get(id)));
    const lots = found.flatMap((f) => (f ? [f.lot] : []));
    const [settings, rate] = await Promise.all([deps.settings.get(), lots.length ? usdToEur() : null]);
    const rows = await Promise.all(lots.map(async (lot) => ({ lot, insights: await one(lot, settings, rate) })));
    return { rows, usdToEur: rate };
  }

  return { forLots };
}

export type LotInsightsService = ReturnType<typeof createLotInsightsService>;
