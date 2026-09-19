import { describe, expect, it } from 'vitest';
import { effectiveMarketSources, summarizeMarket } from './market.ts';
import { DEFAULT_SETTINGS } from './settings.ts';
import type { Lot, MarketListing } from './types.ts';

const lot = {
  id: 'iaai:1',
  make: 'TOYOTA',
  model: 'CAMRY',
  year: 2019,
  trim: 'SE',
  fuel: 'Gasoline',
  transmission: 'Automatic',
  odometerMiles: 50_000,
} as Lot;

let n = 0;
const listing = (over: Partial<MarketListing>): MarketListing => {
  const id = `https://example.bg/${++n}`;
  return {
    id,
    site: 'mobileBg',
    url: id,
    title: 'Toyota Camry',
    year: 2019,
    make: 'toyota',
    model: 'camry',
    trim: null,
    fuel: 'Бензинов',
    transmission: 'Автоматична',
    mileageKm: 90_000,
    priceEurCents: 2_000_000,
    location: 'гр. София',
    imageUrl: null,
    importOffer: false,
    ...over,
  };
};

describe('effectiveMarketSources', () => {
  it('uses the lot choice over the settings defaults', () => {
    const defaults = DEFAULT_SETTINGS.market.enabledSources;
    expect(effectiveMarketSources(null, defaults)).toEqual(['mobileBg', 'carsBg']);
    expect(effectiveMarketSources({ carsBg: false, olxBg: true }, defaults)).toEqual(['mobileBg', 'olxBg']);
  });
});

describe('summarizeMarket', () => {
  const listings = [
    listing({ priceEurCents: 2_200_000 }),
    listing({ priceEurCents: 1_800_000 }),
    listing({ priceEurCents: 1_500_000, importOffer: true }),
    listing({ priceEurCents: 2_600_000, fuel: 'Хибриден' }),
    listing({ site: 'carsBg', priceEurCents: 2_000_000 }),
    listing({ site: 'carsBg', priceEurCents: null }),
    listing({ site: 'olxBg', priceEurCents: 900_000 }),
  ];
  const options = {
    sites: ['mobileBg', 'carsBg'] as const,
    toggles: { mileage: false, transmission: false, fuel: false, yearSpan: 0 },
    mileageRangeKm: 30_000,
    excludedIds: new Set<string>(),
  };

  it('groups matches by enabled site, cheapest first, with per-site and overall summaries', () => {
    const result = summarizeMarket(lot, listings, { ...options, sites: [...options.sites] });
    const [mobile, cars] = result.groups;
    expect(mobile!.matches.map((m) => m.listing.priceEurCents)).toEqual([1_800_000, 2_200_000, 2_600_000]);
    expect(mobile!.hidden).toBe(1); // the import offer
    expect(mobile!.summary).toMatchObject({ count: 3, average: 2_200_000, median: 2_200_000 });
    // a listing without a price is shown but not averaged
    expect(cars!.matches).toHaveLength(2);
    expect(cars!.summary).toMatchObject({ count: 1, average: 2_000_000 });
    // OLX is disabled for this lot
    expect(result.overall).toMatchObject({ count: 4, average: 2_150_000, median: 2_100_000 });
  });

  it('applies the fuel toggle and exclusions', () => {
    const hybrid = listings[3]!;
    const cheapest = listings[1]!;
    const result = summarizeMarket(lot, listings, {
      ...options,
      sites: ['mobileBg'],
      toggles: { mileage: false, transmission: false, fuel: true, yearSpan: 0 },
      excludedIds: new Set([cheapest.id]),
    });
    expect(result.groups[0]!.matches.map((m) => m.listing.id)).not.toContain(hybrid.id);
    expect(result.groups[0]!.hidden).toBe(2);
    expect(result.overall).toMatchObject({ count: 1, average: 2_200_000 });
  });
});
