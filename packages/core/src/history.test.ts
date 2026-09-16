import { describe, expect, it } from 'vitest';
import { isLotHistoryRecord, mergeHistory, vinMatchesMask } from './history.ts';
import type { AuctionRecord, Lot } from './types.ts';

const VIN = '4T1B11HK0KU821110';

const record = (overrides: Partial<AuctionRecord>): AuctionRecord => ({
  id: 'bidfax:1',
  site: 'bidfax',
  url: 'https://bidfax.info/toyota/camry/1-x.html',
  auction: 'iaai',
  lotNumber: '46026832',
  vin: VIN,
  year: 2019,
  make: 'toyota',
  model: 'camry',
  trim: 'Se',
  engine: '2.5L',
  fuel: null,
  saleDate: '2026-09-15T00:00:00.000Z',
  finalPriceUsdCents: 540_000,
  odometerMiles: 78_003,
  damage: 'Left Rear',
  saleStatus: 'on_approval',
  location: 'Fontana (CA)',
  imageUrl: null,
  ...overrides,
});

const lot = { id: 'iaai:46026832', source: 'iaai', lotNumber: '46026832', vin: '4T1B11HK0KU******' } as Lot;

describe('vinMatchesMask', () => {
  it('compares only unmasked characters', () => {
    expect(vinMatchesMask('4T1B11HK0KU******', VIN)).toBe(true);
    expect(vinMatchesMask('4T1B11HK7KU******', VIN)).toBe(false);
    expect(vinMatchesMask(VIN.toLowerCase(), VIN)).toBe(true);
    expect(vinMatchesMask('4T1B11HK0KU', VIN)).toBe(false);
  });
});

describe('isLotHistoryRecord', () => {
  it('accepts the same VIN from any auction or lot', () => {
    expect(isLotHistoryRecord(lot, VIN, record({ auction: 'copart', lotNumber: '1' }))).toBe(true);
  });

  it('accepts a lot-number hit only from the same auction and a compatible VIN', () => {
    const other = record({ vin: '1FT8W3BT0BEB49246', auction: 'copart' });
    expect(isLotHistoryRecord(lot, null, record({}))).toBe(true);
    expect(isLotHistoryRecord(lot, null, other)).toBe(false);
    expect(isLotHistoryRecord(lot, null, { ...other, auction: 'iaai' })).toBe(false);
    expect(isLotHistoryRecord(lot, null, record({ vin: null }))).toBe(true);
    // a known full VIN rules out a different vehicle under the same lot number
    expect(isLotHistoryRecord(lot, '4T1B11HK0KU821111', record({}))).toBe(false);
  });
});

describe('mergeHistory', () => {
  it('dedups by auction + lot + date, prefers bidfax fields and final statuses, newest first', () => {
    const entries = mergeHistory([
      record({
        id: 'statvin:a',
        site: 'statvin',
        url: 'https://stat.vin/cars/x',
        saleStatus: 'not_sold',
        damage: null,
        finalPriceUsdCents: 540_000,
        imageUrl: 'https://cdn/photo.webp',
      }),
      record({}),
      record({
        id: 'statvin:b',
        site: 'statvin',
        saleDate: '2026-09-22T00:00:00.000Z',
        finalPriceUsdCents: null,
        saleStatus: 'upcoming',
      }),
    ]);

    expect(entries.map((e) => e.key)).toEqual(['iaai:46026832:2026-09-22', 'iaai:46026832:2026-09-15']);
    const [upcoming, sale] = entries;
    expect(upcoming).toMatchObject({ saleStatus: 'upcoming', finalPriceUsdCents: null });
    expect(sale).toMatchObject({
      saleStatus: 'not_sold',
      damage: 'Left Rear',
      imageUrl: 'https://cdn/photo.webp',
      finalPriceUsdCents: 540_000,
    });
    expect(sale!.sources.map((s) => s.site)).toEqual(['bidfax', 'statvin']);
  });
});
