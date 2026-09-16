import { describe, expect, it } from 'vitest';
import { evaluateLot } from './evaluate.ts';
import { DEFAULT_LOT_INPUTS } from './lot-inputs.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const lot = { buyNowUsdCents: null, currentBidUsdCents: null };
const base = {
  lot,
  inputs: DEFAULT_LOT_INPUTS,
  settings: DEFAULT_SETTINGS,
  usdToEur: 0.9,
  estimateUsdCents: 500_000,
  marketAverageEurCents: 1_300_000,
};

describe('evaluateLot', () => {
  it('plan reference: bid 5000 $, FX 0.90, BG average 13 000 € → 9800 € total, margin 3200 € → worth', () => {
    const result = evaluateLot(base);
    expect(result.bidSource).toBe('estimate');
    expect(result.cost?.totalEurCents).toBe(980_000);
    expect(result.verdict).toEqual({ status: 'worth', marginEurCents: 320_000, missing: [] });
  });

  it('applies the lot inputs: reduced fees, no Sofia → BG leg, repair estimate', () => {
    const reduced = evaluateLot({ ...base, inputs: { ...DEFAULT_LOT_INPUTS, feesReduced: true } });
    expect(reduced.cost?.totalEurCents).toBe(860_000);
    expect(reduced.verdict.marginEurCents).toBe(440_000);

    const repaired = evaluateLot({
      ...base,
      inputs: { ...DEFAULT_LOT_INPUTS, repairEstimateEurCents: 50_000 },
    });
    expect(repaired.repairEurCents).toBe(50_000);
    expect(repaired.verdict).toMatchObject({ status: 'borderline', marginEurCents: 270_000 });

    const noLeg = evaluateLot({
      ...base,
      inputs: { ...DEFAULT_LOT_INPUTS, includeSofiaToBg: false },
    });
    expect(noLeg.cost?.totalEurCents).toBe(955_000);
  });

  it('uses the threshold from settings', () => {
    const settings = { ...DEFAULT_SETTINGS, verdict: { worthThresholdEur: 4000 } };
    expect(evaluateLot({ ...base, settings }).verdict.status).toBe('borderline');
  });

  it('prefers a manual bid, then falls back to Buy Now and the current bid', () => {
    const override = evaluateLot({
      ...base,
      inputs: { ...DEFAULT_LOT_INPUTS, bidOverrideUsdCents: 100_000 },
    });
    expect(override).toMatchObject({ bidUsdCents: 100_000, bidSource: 'override' });

    const buyNow = evaluateLot({
      ...base,
      estimateUsdCents: null,
      lot: { buyNowUsdCents: 700_000, currentBidUsdCents: 1 },
    });
    expect(buyNow).toMatchObject({ bidUsdCents: 700_000, bidSource: 'buyNow' });
  });

  it('reports what is missing', () => {
    expect(
      evaluateLot({ ...base, estimateUsdCents: null, marketAverageEurCents: null }).verdict,
    ).toEqual({
      status: 'insufficient',
      marginEurCents: null,
      missing: ['bid', 'marketAverage'],
    });
    const noFx = evaluateLot({ ...base, usdToEur: null });
    expect(noFx.cost).toBeNull();
    expect(noFx.verdict).toEqual({ status: 'insufficient', marginEurCents: null, missing: ['fx'] });
    expect(
      evaluateLot({ ...base, usdToEur: null, estimateUsdCents: null }).verdict.missing,
    ).toEqual(['bid']);
  });
});
