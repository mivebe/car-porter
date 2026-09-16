import { calculateCost, resolveBid, type BidSource, type CostBreakdown } from './cost.ts';
import type { LotInputs } from './lot-inputs.ts';
import type { Settings } from './settings.ts';
import type { Lot } from './types.ts';
import { computeVerdict, type Verdict, type VerdictMissing } from './verdict.ts';

export interface LotEvaluation {
  bidUsdCents: number | null;
  bidSource: BidSource;
  /** null until both a bid and an exchange rate are known. */
  cost: CostBreakdown | null;
  marketAverageEurCents: number | null;
  repairEurCents: number;
  verdict: Verdict;
}

/**
 * Everything the verdict needs, from stored data and current settings: bid (override → bidfax
 * average → Buy Now → current bid) → landed cost → margin against the BG market average.
 */
export function evaluateLot(input: {
  lot: Pick<Lot, 'buyNowUsdCents' | 'currentBidUsdCents'>;
  inputs: LotInputs;
  settings: Settings;
  /** null when no exchange rate is available. */
  usdToEur: number | null;
  /** Average of the included bidfax matches. */
  estimateUsdCents: number | null;
  /** Average of the included BG market listings. */
  marketAverageEurCents: number | null;
}): LotEvaluation {
  const { lot, inputs, settings, usdToEur, marketAverageEurCents } = input;
  const bid = resolveBid({
    overrideUsdCents: inputs.bidOverrideUsdCents,
    estimateUsdCents: input.estimateUsdCents,
    buyNowUsdCents: lot.buyNowUsdCents,
    currentBidUsdCents: lot.currentBidUsdCents,
  });
  const cost =
    bid.bidUsdCents != null && usdToEur != null
      ? calculateCost({
          bidUsdCents: bid.bidUsdCents,
          usdToEur,
          feesReduced: inputs.feesReduced,
          includeSofiaToBg: inputs.includeSofiaToBg,
          cost: settings.cost,
        })
      : null;
  const repairEurCents = inputs.repairEstimateEurCents;

  let verdict = computeVerdict({
    totalEurCents: cost?.totalEurCents ?? null,
    marketAverageEurCents,
    repairEurCents,
    worthThresholdEur: settings.verdict.worthThresholdEur,
  });
  if (bid.bidUsdCents != null && usdToEur == null) {
    // the bid is known; what's missing is the exchange rate
    const missing: VerdictMissing[] = ['fx', ...verdict.missing.filter((m) => m !== 'bid')];
    verdict = { ...verdict, missing };
  }

  return {
    bidUsdCents: bid.bidUsdCents,
    bidSource: bid.source,
    cost,
    marketAverageEurCents,
    repairEurCents,
    verdict,
  };
}
