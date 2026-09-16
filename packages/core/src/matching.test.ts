import { describe, expect, it } from 'vitest';
import {
  engineLiters,
  isWithinMonths,
  matchAuctionRecord,
  matchMarketListing,
  milesToKm,
  modelMatches,
  normalizeFuel,
  normalizeMake,
  normalizeTransmission,
  selectAuctionMatches,
  trimMatches,
} from './matching.ts';
import type { AuctionRecord, Lot, MarketListing } from './types.ts';

const lot: Lot = {
  id: 'copart:12345678',
  source: 'copart',
  lotNumber: '12345678',
  url: 'https://www.copart.com/lot/12345678',
  vin: '4T1B11HK5KU******',
  year: 2019,
  make: 'TOYOTA',
  model: 'CAMRY',
  trim: 'SE',
  engine: '2.5L 4',
  fuel: 'GAS',
  transmission: 'AUTOMATIC',
  drive: 'Front-wheel Drive',
  odometerMiles: 50_000,
  primaryDamage: 'FRONT END',
  secondaryDamage: null,
  titleType: 'SALVAGE',
  location: 'CA - SACRAMENTO',
  saleDate: '2026-09-20T17:00:00Z',
  currentBidUsdCents: 250_000,
  buyNowUsdCents: null,
  acvUsdCents: null,
  imageUrls: [],
};

const record = (over: Partial<AuctionRecord>): AuctionRecord => ({
  id: 'bidfax:1',
  site: 'bidfax',
  url: 'https://bidfax.info/toyota/camry/1.html',
  auction: 'copart',
  lotNumber: '1',
  vin: null,
  year: 2019,
  make: 'Toyota',
  model: 'Camry',
  trim: 'SE',
  engine: '2.5 L',
  fuel: 'Gasoline',
  saleDate: '2026-06-01T00:00:00Z',
  finalPriceUsdCents: 600_000,
  odometerMiles: 60_000,
  damage: 'Rear end',
  imageUrl: null,
  ...over,
});

const listing = (over: Partial<MarketListing>): MarketListing => ({
  id: 'https://www.mobile.bg/1',
  site: 'mobileBg',
  url: 'https://www.mobile.bg/1',
  title: 'Toyota Camry 2.5 SE',
  year: 2019,
  make: 'Toyota',
  model: 'Camry',
  trim: 'SE',
  fuel: 'Бензинов',
  transmission: 'Автоматична',
  mileageKm: 90_000,
  priceEurCents: 1_800_000,
  location: 'София',
  imageUrl: null,
  ...over,
});

describe('normalizers', () => {
  it('normalizes makes with aliases and punctuation', () => {
    expect(normalizeMake('MERCEDES-BENZ')).toBe('mercedes');
    expect(normalizeMake('Mercedes')).toBe('mercedes');
    expect(normalizeMake('VW')).toBe('volkswagen');
    expect(normalizeMake('Land Rover')).toBe(normalizeMake('LAND-ROVER'));
    expect(normalizeMake('Мерцедес')).toBe('mercedes');
  });

  it('matches model variants', () => {
    expect(modelMatches('CR-V', 'CRV')).toBe(true);
    expect(modelMatches('RAV 4', 'RAV4')).toBe(true);
    expect(modelMatches('Camry', 'CAMRY HYBRID')).toBe(true);
    expect(modelMatches('Model 3', 'Model S')).toBe(false);
    expect(modelMatches('Civic', 'Accord')).toBe(false);
  });

  it('matches trims by containment', () => {
    expect(trimMatches('SE', 'se awd')).toBe(true);
    expect(trimMatches('XLE', 'SE')).toBe(false);
    expect(trimMatches('Sport-Line', 'sportline')).toBe(true);
  });

  it('normalizes fuel in English and Bulgarian', () => {
    expect(normalizeFuel('GAS')).toBe('petrol');
    expect(normalizeFuel('Flexible Fuel')).toBe('petrol');
    expect(normalizeFuel('Бензинов')).toBe('petrol');
    expect(normalizeFuel('Дизелов')).toBe('diesel');
    expect(normalizeFuel('Hybrid Engine')).toBe('hybrid');
    expect(normalizeFuel('Plug-in Hybrid')).toBe('plugin_hybrid');
    expect(normalizeFuel('Електрически')).toBe('electric');
    expect(normalizeFuel('')).toBeNull();
    expect(normalizeFuel('???')).toBeNull();
  });

  it('normalizes transmission', () => {
    expect(normalizeTransmission('AUTOMATIC')).toBe('automatic');
    expect(normalizeTransmission('Автоматична')).toBe('automatic');
    expect(normalizeTransmission('Ръчна')).toBe('manual');
    expect(normalizeTransmission('MANUAL')).toBe('manual');
    expect(normalizeTransmission(null)).toBeNull();
  });

  it('extracts engine liters', () => {
    expect(engineLiters('2.5L 4')).toBe(2.5);
    expect(engineLiters('V6 3.5')).toBe(3.5);
    expect(engineLiters('2,0 л')).toBe(2);
    expect(engineLiters('1998 cc')).toBe(2);
    expect(engineLiters('I4')).toBeNull();
  });

  it('converts miles to km', () => {
    expect(milesToKm(50_000)).toBe(80_467);
  });
});

describe('matchAuctionRecord (bidfax)', () => {
  it('matches same make/model/year/trim/engine/fuel', () => {
    expect(matchAuctionRecord(lot, record({}))).toMatchObject({ matches: true, unknown: [] });
  });

  it('rejects different year, trim, engine or fuel', () => {
    expect(matchAuctionRecord(lot, record({ year: 2020 })).matches).toBe(false);
    expect(matchAuctionRecord(lot, record({ trim: 'XSE' })).matches).toBe(false);
    expect(matchAuctionRecord(lot, record({ engine: '3.5L V6' })).criteria.engine).toBe('mismatch');
    expect(matchAuctionRecord(lot, record({ fuel: 'Hybrid' })).matches).toBe(false);
  });

  it('keeps records with unknown trim/engine/fuel and reports them', () => {
    const r = matchAuctionRecord(lot, record({ trim: null, engine: null, fuel: '' }));
    expect(r.matches).toBe(true);
    expect(r.unknown).toEqual(['trim', 'engine', 'fuel']);
  });

  it('requires make/model/year to be known', () => {
    expect(matchAuctionRecord(lot, record({ year: null })).matches).toBe(false);
    expect(matchAuctionRecord(lot, record({ make: null })).matches).toBe(false);
  });
});

describe('selectAuctionMatches', () => {
  const now = new Date('2026-09-16T00:00:00Z');

  it('filters by match, price and 12-month window; newest first; capped', () => {
    const records = [
      record({ id: 'old', saleDate: '2025-09-01T00:00:00Z' }), // > 12 months
      record({ id: 'm1', saleDate: '2026-01-10T00:00:00Z' }),
      record({ id: 'm2', saleDate: '2026-08-10T00:00:00Z' }),
      record({ id: 'm3', saleDate: '2025-09-20T00:00:00Z' }), // within 12 months
      record({ id: 'noprice', finalPriceUsdCents: null }),
      record({ id: 'wrongyear', year: 2018 }),
    ];
    const result = selectAuctionMatches(lot, records, { now, maxMonths: 12, maxMatches: 20 });
    expect(result.map((r) => r.record.id)).toEqual(['m2', 'm1', 'm3']);
    expect(selectAuctionMatches(lot, records, { now, maxMonths: 12, maxMatches: 2 })).toHaveLength(2);
  });

  it('isWithinMonths rejects future and invalid dates', () => {
    expect(isWithinMonths('2026-10-01T00:00:00Z', now, 12)).toBe(false);
    expect(isWithinMonths('nope', now, 12)).toBe(false);
    expect(isWithinMonths(null, now, 12)).toBe(false);
  });
});

describe('matchMarketListing (BG)', () => {
  const off = { mileage: false, transmission: false, fuel: false };
  const on = { mileage: true, transmission: true, fuel: true };

  it('matches make/model/exact year/trim with toggles off', () => {
    expect(matchMarketListing(lot, listing({ mileageKm: 300_000, fuel: 'Дизелов' }), off, 30_000).matches).toBe(true);
    expect(matchMarketListing(lot, listing({ year: 2018 }), off, 30_000).matches).toBe(false);
    expect(matchMarketListing(lot, listing({ trim: 'XLE' }), off, 30_000).matches).toBe(false);
  });

  it('applies mileage range (lot miles → km) when toggled', () => {
    // lot 50 000 mi = 80 467 km
    expect(matchMarketListing(lot, listing({ mileageKm: 110_000 }), on, 30_000).matches).toBe(true);
    expect(matchMarketListing(lot, listing({ mileageKm: 111_000 }), on, 30_000).matches).toBe(false);
  });

  it('applies transmission and fuel when toggled', () => {
    expect(matchMarketListing(lot, listing({ transmission: 'Ръчна' }), on, 30_000).matches).toBe(false);
    expect(matchMarketListing(lot, listing({ fuel: 'Дизелов' }), on, 30_000).matches).toBe(false);
    expect(matchMarketListing(lot, listing({}), on, 30_000).matches).toBe(true);
  });
});
