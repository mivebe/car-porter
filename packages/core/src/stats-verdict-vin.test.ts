import { describe, expect, it } from 'vitest';
import { summarizeIncluded, summarizePrices } from './stats.ts';
import { computeVerdict } from './verdict.ts';
import { checkVin, effectiveVin } from './vin.ts';

describe('summarizePrices', () => {
  it('returns null for no values', () => {
    expect(summarizePrices([])).toBeNull();
  });

  it('computes average, median, min, max (odd count)', () => {
    expect(summarizePrices([300, 100, 200])).toEqual({ count: 3, average: 200, median: 200, min: 100, max: 300 });
  });

  it('median of even count is the mean of the middle pair, rounded', () => {
    expect(summarizePrices([100, 200, 301, 1000])).toMatchObject({ median: 251, average: 400 });
  });

  it('ignores non-finite values', () => {
    expect(summarizePrices([Number.NaN, 100])).toMatchObject({ count: 1, average: 100 });
  });
});

describe('summarizeIncluded', () => {
  const items = [
    { id: 'a', price: 500_000 },
    { id: 'b', price: 600_000 },
    { id: 'c', price: null },
    { id: 'd', price: 1_500_000 }, // outlier
  ];

  it('includes everything by default and skips missing prices', () => {
    expect(summarizeIncluded(items, (i) => i.price, new Set())).toMatchObject({ count: 3, average: 866_667 });
  });

  it('recalculates when items are excluded', () => {
    expect(summarizeIncluded(items, (i) => i.price, new Set(['d']))).toMatchObject({
      count: 2,
      average: 550_000,
      median: 550_000,
    });
  });

  it('returns null when everything is excluded', () => {
    expect(summarizeIncluded(items, (i) => i.price, new Set(['a', 'b', 'd']))).toBeNull();
  });
});

describe('computeVerdict — plan reference cases', () => {
  const total = 980_000; // 9800 € (full fees reference)
  const threshold = 3000;

  it('BG average 13 000 €, repair 0 → margin 3200 € → worth', () => {
    expect(
      computeVerdict({ totalEurCents: total, marketAverageEurCents: 1_300_000, repairEurCents: 0, worthThresholdEur: threshold }),
    ).toEqual({ status: 'worth', marginEurCents: 320_000, missing: [] });
  });

  it('repair 500 € → margin 2700 € → borderline', () => {
    expect(
      computeVerdict({ totalEurCents: total, marketAverageEurCents: 1_300_000, repairEurCents: 50_000, worthThresholdEur: threshold }),
    ).toMatchObject({ status: 'borderline', marginEurCents: 270_000 });
  });

  it('boundaries: exactly threshold → worth, exactly 0 → borderline, negative → not worth', () => {
    const v = (avg: number) =>
      computeVerdict({ totalEurCents: 1_000_000, marketAverageEurCents: avg, repairEurCents: 0, worthThresholdEur: threshold }).status;
    expect(v(1_300_000)).toBe('worth');
    expect(v(1_299_999)).toBe('borderline');
    expect(v(1_000_000)).toBe('borderline');
    expect(v(999_999)).toBe('not_worth');
  });

  it('reports missing inputs as insufficient', () => {
    expect(
      computeVerdict({ totalEurCents: null, marketAverageEurCents: null, repairEurCents: 0, worthThresholdEur: threshold }),
    ).toEqual({ status: 'insufficient', marginEurCents: null, missing: ['bid', 'marketAverage'] });
    expect(
      computeVerdict({ totalEurCents: 1, marketAverageEurCents: null, repairEurCents: 0, worthThresholdEur: threshold }).missing,
    ).toEqual(['marketAverage']);
  });
});

describe('VIN', () => {
  it('accepts a valid VIN with a correct check digit', () => {
    expect(checkVin('1M8GDM9AXKP042788')).toEqual({
      normalized: '1M8GDM9AXKP042788',
      valid: true,
      masked: false,
      checkDigitValid: true,
    });
    expect(checkVin(' 1hgcm82633a004352 ')).toMatchObject({ valid: true, checkDigitValid: true });
  });

  it('flags a wrong check digit without rejecting the VIN', () => {
    expect(checkVin('1M8GDM9A1KP042788')).toMatchObject({ valid: true, checkDigitValid: false });
  });

  it('rejects wrong length, forbidden letters and masked VINs', () => {
    expect(checkVin('1M8GDM9AXKP04278').valid).toBe(false);
    expect(checkVin('1M8GDM9AXKP04278O').valid).toBe(false); // O not allowed
    expect(checkVin('1HGCM82633A******')).toMatchObject({ valid: false, masked: true, checkDigitValid: null });
  });

  it('prefers a valid pasted VIN over the lot VIN', () => {
    expect(effectiveVin('1HGCM82633A******', '1hgcm82633a004352')).toBe('1HGCM82633A004352');
    expect(effectiveVin('1M8GDM9AXKP042788', 'bad')).toBe('1M8GDM9AXKP042788');
    expect(effectiveVin('1HGCM82633A******', null)).toBeNull();
  });
});
