import { describe, expect, it } from 'vitest';
import { calculateCost, resolveBid } from './cost.ts';
import { convertCents, roundHalfUp, toCents } from './money.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

const base = {
  usdToEur: 0.9,
  feesReduced: false,
  includeSofiaToBg: true,
  cost: DEFAULT_SETTINGS.cost,
};

describe('money', () => {
  it('rounds half up despite float noise', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(2.4999999)).toBe(2);
    expect(roundHalfUp(-1.5)).toBe(-2);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.285)).toBe(29);
    expect(convertCents(816667, 0.9)).toBe(735000);
  });
});

describe('calculateCost — plan reference case (bid $5000, 1 USD = 0.90 €)', () => {
  it('full fees: 9800.00 €', () => {
    const r = calculateCost({ ...base, bidUsdCents: 500_000 });
    expect(r.feesUsdCents).toBe(200_000);
    expect(r.feesEffectivePercent).toBe(40);
    expect(r.feeParts.map((p) => p.usdCents)).toEqual([50_000, 100_000, 50_000]);
    expect(r.shippingUsaRotterdamUsdCents).toBe(250_000);
    expect(r.usdSubtotalCents).toBe(950_000);
    expect(r.usdSubtotalEurCents).toBe(855_000);
    expect(r.rotterdamSofiaEurCents).toBe(100_000);
    expect(r.sofiaToBgEurCents).toBe(25_000);
    expect(r.totalEurCents).toBe(980_000);
  });

  it('reduced fees (⅓ of 40%): 8600.00 €', () => {
    const r = calculateCost({ ...base, bidUsdCents: 500_000, feesReduced: true });
    expect(r.feesUsdCents).toBe(66_667);
    expect(r.feesEffectivePercent).toBeCloseTo(13.3333, 4);
    expect(r.feeParts.map((p) => p.usdCents)).toEqual([16_667, 33_333, 16_667]);
    expect(r.usdSubtotalCents).toBe(816_667);
    expect(r.usdSubtotalEurCents).toBe(735_000);
    expect(r.totalEurCents).toBe(860_000);
  });

  it('without the Sofia → BG leg: 9550.00 € / 8350.00 €', () => {
    expect(calculateCost({ ...base, bidUsdCents: 500_000, includeSofiaToBg: false }).totalEurCents).toBe(
      955_000,
    );
    expect(
      calculateCost({ ...base, bidUsdCents: 500_000, includeSofiaToBg: false, feesReduced: true })
        .totalEurCents,
    ).toBe(835_000);
  });
});

describe('calculateCost — general', () => {
  it('fee parts always sum to the fee total', () => {
    for (const bid of [1, 99, 12_345, 777_777, 1_000_001]) {
      for (const feesReduced of [false, true]) {
        const r = calculateCost({ ...base, bidUsdCents: bid, feesReduced });
        expect(r.feeParts.reduce((a, p) => a + p.usdCents, 0)).toBe(r.feesUsdCents);
      }
    }
  });

  it('uses edited settings', () => {
    const r = calculateCost({
      ...base,
      bidUsdCents: 1_000_000,
      usdToEur: 1,
      cost: {
        bidPercentages: [5, 5],
        reducedDivisor: 2,
        shippingUsaRotterdamUsd: 2000,
        rotterdamSofiaEur: 800,
        sofiaToBgEur: 100,
      },
      feesReduced: true,
    });
    // fees 10%/2 = 5% of 10000 = 500; (10000 + 500 + 2000) × 1 + 800 + 100 = 13400
    expect(r.feesUsdCents).toBe(50_000);
    expect(r.totalEurCents).toBe(1_340_000);
  });

  it('handles a zero bid', () => {
    expect(calculateCost({ ...base, bidUsdCents: 0 }).totalEurCents).toBe(
      convertCents(250_000, 0.9) + 125_000,
    );
  });

  it('rejects invalid bid or rate', () => {
    expect(() => calculateCost({ ...base, bidUsdCents: -1 })).toThrow(RangeError);
    expect(() => calculateCost({ ...base, bidUsdCents: 1, usdToEur: 0 })).toThrow(RangeError);
    expect(() => calculateCost({ ...base, bidUsdCents: Number.NaN })).toThrow(RangeError);
  });
});

describe('resolveBid', () => {
  const none = { overrideUsdCents: null, estimateUsdCents: null, buyNowUsdCents: null, currentBidUsdCents: null };

  it('prefers override → estimate → buy now → current bid', () => {
    expect(resolveBid({ overrideUsdCents: 1, estimateUsdCents: 2, buyNowUsdCents: 3, currentBidUsdCents: 4 })).toEqual({
      bidUsdCents: 1,
      source: 'override',
    });
    expect(resolveBid({ ...none, estimateUsdCents: 2, buyNowUsdCents: 3, currentBidUsdCents: 4 }).source).toBe(
      'estimate',
    );
    expect(resolveBid({ ...none, buyNowUsdCents: 3, currentBidUsdCents: 4 }).source).toBe('buyNow');
    expect(resolveBid({ ...none, currentBidUsdCents: 4 })).toEqual({ bidUsdCents: 4, source: 'currentBid' });
    expect(resolveBid(none)).toEqual({ bidUsdCents: null, source: 'none' });
  });

  it('treats a 0 override as a real value', () => {
    expect(resolveBid({ ...none, overrideUsdCents: 0, estimateUsdCents: 5 })).toEqual({
      bidUsdCents: 0,
      source: 'override',
    });
  });
});
