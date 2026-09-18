import type { Lot, LotEvaluation, PriceSummary } from '@car-porter/core';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { TrackedLotsRepository } from '../repositories/tracked-lots-repository.ts';
import type { LotInsightsService } from './lot-insights-service.ts';
import { LotNotFoundError } from './lot-not-found.ts';

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
  insights: LotInsightsService;
}) {
  async function list(): Promise<TrackedLotsResponse> {
    const tracked = await deps.tracked.list();
    const { rows, usdToEur } = await deps.insights.forLots(tracked.map((t) => t.lotId));
    const trackedAt = new Map(tracked.map((t) => [t.lotId, t.createdAt.toISOString()]));
    return {
      lots: rows.map(({ lot, insights }) => ({
        lot,
        trackedAt: trackedAt.get(lot.id)!,
        estimate: insights.estimate,
        market: insights.market,
        evaluation: insights.evaluation,
      })),
      usdToEur,
    };
  }

  async function track(lotId: string) {
    if (!(await deps.lots.get(lotId))) throw new LotNotFoundError(lotId);
    const { createdAt } = await deps.tracked.add(lotId);
    return { lotId, trackedAt: createdAt.toISOString() };
  }

  return { list, track, untrack: deps.tracked.remove };
}

export type TrackingService = ReturnType<typeof createTrackingService>;
