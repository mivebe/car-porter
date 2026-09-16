import { convertCents, roundHalfUp, sumCents, toCents } from './money.ts';
import type { Settings } from './settings.ts';

export interface CostInput {
  bidUsdCents: number;
  usdToEur: number;
  /** Use 1/reducedDivisor of the bid percentages. */
  feesReduced: boolean;
  /** Include the Sofia → anywhere in BG leg. */
  includeSofiaToBg: boolean;
  cost: Settings['cost'];
}

export interface FeePart {
  /** Configured percentage, e.g. 20. */
  percent: number;
  /** Percentage actually applied (divided when reduced). */
  effectivePercent: number;
  usdCents: number;
}

export interface CostBreakdown {
  bidUsdCents: number;
  feeParts: FeePart[];
  feesUsdCents: number;
  feesEffectivePercent: number;
  shippingUsaRotterdamUsdCents: number;
  /** bid + fees + shipping to Rotterdam */
  usdSubtotalCents: number;
  usdToEur: number;
  usdSubtotalEurCents: number;
  rotterdamSofiaEurCents: number;
  sofiaToBgEurCents: number;
  totalEurCents: number;
}

/**
 * total € = (bid + bid × Σ% [÷ divisor] + shipping USA→Rotterdam $) × USD→EUR
 *         + Rotterdam→Sofia € + (optional) Sofia→BG €
 */
export function calculateCost(input: CostInput): CostBreakdown {
  const { bidUsdCents, usdToEur, feesReduced, includeSofiaToBg, cost } = input;
  if (!Number.isFinite(bidUsdCents) || bidUsdCents < 0) throw new RangeError('bid must be >= 0');
  if (!Number.isFinite(usdToEur) || usdToEur <= 0) throw new RangeError('usdToEur must be > 0');

  const divisor = feesReduced ? cost.reducedDivisor : 1;
  const totalPercent = cost.bidPercentages.reduce((a, b) => a + b, 0);
  const feesUsdCents = roundHalfUp((bidUsdCents * totalPercent) / (100 * divisor));

  // Round each part, then give the rounding remainder to the last part so parts sum to the total.
  const feeParts: FeePart[] = cost.bidPercentages.map((percent) => ({
    percent,
    effectivePercent: percent / divisor,
    usdCents: roundHalfUp((bidUsdCents * percent) / (100 * divisor)),
  }));
  const last = feeParts.at(-1);
  if (last) last.usdCents += feesUsdCents - sumCents(feeParts.map((p) => p.usdCents));

  const shippingUsaRotterdamUsdCents = toCents(cost.shippingUsaRotterdamUsd);
  const usdSubtotalCents = bidUsdCents + feesUsdCents + shippingUsaRotterdamUsdCents;
  const usdSubtotalEurCents = convertCents(usdSubtotalCents, usdToEur);
  const rotterdamSofiaEurCents = toCents(cost.rotterdamSofiaEur);
  const sofiaToBgEurCents = includeSofiaToBg ? toCents(cost.sofiaToBgEur) : 0;

  return {
    bidUsdCents,
    feeParts,
    feesUsdCents,
    feesEffectivePercent: totalPercent / divisor,
    shippingUsaRotterdamUsdCents,
    usdSubtotalCents,
    usdToEur,
    usdSubtotalEurCents,
    rotterdamSofiaEurCents,
    sofiaToBgEurCents,
    totalEurCents: usdSubtotalEurCents + rotterdamSofiaEurCents + sofiaToBgEurCents,
  };
}

export type BidSource = 'override' | 'estimate' | 'buyNow' | 'currentBid' | 'none';

/** Picks the bid the calculation starts from: manual override → bidfax average → Buy Now → current bid. */
export function resolveBid(options: {
  overrideUsdCents: number | null;
  estimateUsdCents: number | null;
  buyNowUsdCents: number | null;
  currentBidUsdCents: number | null;
}): { bidUsdCents: number | null; source: BidSource } {
  if (options.overrideUsdCents != null) return { bidUsdCents: options.overrideUsdCents, source: 'override' };
  if (options.estimateUsdCents != null) return { bidUsdCents: options.estimateUsdCents, source: 'estimate' };
  if (options.buyNowUsdCents != null) return { bidUsdCents: options.buyNowUsdCents, source: 'buyNow' };
  if (options.currentBidUsdCents != null) {
    return { bidUsdCents: options.currentBidUsdCents, source: 'currentBid' };
  }
  return { bidUsdCents: null, source: 'none' };
}
