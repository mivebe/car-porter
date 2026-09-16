import type { Lot } from '@car-porter/core';
import { describe, expect, it } from 'vitest';
import { sortAndFilterLots, uniqueLots } from './sort-lots';

const lot = (over: Partial<Lot>): Lot => ({
  id: 'x',
  source: 'copart',
  lotNumber: '1',
  url: '',
  vin: null,
  year: 2019,
  make: 'TOYOTA',
  model: 'CAMRY',
  trim: null,
  engine: null,
  fuel: null,
  transmission: null,
  drive: null,
  odometerMiles: null,
  primaryDamage: null,
  secondaryDamage: null,
  titleType: null,
  location: null,
  saleDate: null,
  currentBidUsdCents: null,
  buyNowUsdCents: null,
  acvUsdCents: null,
  imageUrls: [],
  ...over,
});

const lots = [
  lot({ id: 'a', source: 'copart', saleDate: null, currentBidUsdCents: 50_000, year: 2018, odometerMiles: 90_000 }),
  lot({ id: 'b', source: 'iaai', saleDate: '2026-09-20T10:00:00Z', buyNowUsdCents: 30_000, year: 2020 }),
  lot({ id: 'c', source: 'copart', saleDate: '2026-09-18T10:00:00Z', year: 2019, odometerMiles: 10_000 }),
];
const ids = (l: Lot[]) => l.map((x) => x.id);

describe('sortAndFilterLots', () => {
  it('sorts by sale date with unknown dates last', () => {
    expect(ids(sortAndFilterLots(lots, 'saleDate', 'all'))).toEqual(['c', 'b', 'a']);
  });

  it('sorts by price (bid, else buy now) with missing last', () => {
    expect(ids(sortAndFilterLots(lots, 'price', 'all'))).toEqual(['b', 'a', 'c']);
  });

  it('sorts by year desc and odometer asc', () => {
    expect(ids(sortAndFilterLots(lots, 'yearDesc', 'all'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortAndFilterLots(lots, 'odometer', 'all'))).toEqual(['c', 'a', 'b']);
  });

  it('filters by source', () => {
    expect(ids(sortAndFilterLots(lots, 'saleDate', 'iaai'))).toEqual(['b']);
    expect(ids(sortAndFilterLots(lots, 'saleDate', 'copart'))).toEqual(['c', 'a']);
  });

  it('dedupes lots across pages keeping first occurrence', () => {
    expect(ids(uniqueLots([[lots[0]!, lots[1]!], [lots[1]!, lots[2]!]]))).toEqual(['a', 'b', 'c']);
  });
});
