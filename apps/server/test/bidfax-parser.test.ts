import { readFileSync } from 'node:fs';
import { matchAuctionRecord, type Lot } from '@car-porter/core';
import { describe, expect, it } from 'vitest';
import { SourceError } from '../src/scraping/errors.ts';
import {
  bidfaxListingUrl,
  bidfaxSlug,
  fuelFromTitle,
  isRateLimitPage,
  parseBidfaxDate,
  parseBidfaxListing,
  parseBidfaxModels,
  parseBidfaxTitle,
} from '../src/sources/bidfax.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bidfax/${name}`, import.meta.url), 'utf8');
const camry = { makeSlug: 'toyota', modelSlug: 'camry', makeName: 'Toyota', modelName: 'Camry' };

describe('bidfax helpers', () => {
  it('builds slugs and exact-year listing URLs', () => {
    expect(bidfaxSlug('Mercedes-Benz')).toBe('mercedes-benz');
    expect(bidfaxSlug('LAND ROVER')).toBe('land-rover');
    expect(bidfaxListingUrl('toyota', 'camry', 2019)).toBe(
      'https://bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/',
    );
    expect(bidfaxListingUrl('toyota', 'camry', 2019, 3)).toBe(
      'https://bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/page/3/',
    );
  });

  it('parses card titles', () => {
    expect(parseBidfaxTitle('Toyota Camry Se 2019 White 2.5L vin: 4T1B11HK0KU821110', 'Toyota Camry')).toEqual({
      year: 2019,
      trim: 'Se',
      color: 'White',
      engine: '2.5L',
      vin: '4T1B11HK0KU821110',
    });
    expect(parseBidfaxTitle('Toyota Camry Xse V6 2020 Dark Blue 3.5L vin: 4t1k61ak6lu000000', 'Toyota Camry')).toMatchObject({
      trim: 'Xse V6',
      color: 'Dark Blue',
      engine: '3.5L',
      vin: '4T1K61AK6LU000000',
    });
    expect(parseBidfaxTitle('Toyota Camry L 2019 White 2.5L 4 vin: 4T1B11HKXKU764995', 'Toyota Camry')).toEqual({
      year: 2019,
      trim: 'L',
      color: 'White',
      engine: '2.5L 4',
      vin: '4T1B11HKXKU764995',
    });
    expect(parseBidfaxTitle('Toyota Camry 2019 White vin: 4T1B11HK0KU821110', 'Toyota Camry')).toMatchObject({
      trim: null,
      engine: null,
    });
    expect(parseBidfaxTitle('garbage', 'Toyota Camry')).toBeNull();
  });

  it('derives fuel only from explicit title keywords', () => {
    expect(fuelFromTitle('Toyota Camry Hybrid Le 2019 White 2.5L')).toBe('Hybrid');
    expect(fuelFromTitle('Toyota Rav4 Prime Plug-in 2022 Red')).toBe('Plug-in Hybrid');
    expect(fuelFromTitle('Volkswagen Golf Tdi 2015 Blue 2.0L')).toBe('Diesel');
    expect(fuelFromTitle('Toyota Camry Le 2019 White 2.5L')).toBeNull();
  });

  it('a hybrid sale no longer matches a petrol lot with the same trim', () => {
    const [record] = parseBidfaxListing(
      `<div id="dle-content"><div class="thumbnail offer"><div class="price"><span class="prices">3550</span></div>
       <div class="caption"><a href="https://bidfax.info/toyota/camry/1-x.html"><h2>Toyota Camry Hybrid Le 2019 White 2.5L vin: 4T1B31HK0KU000000</h2></a>
       <p>Дата продажу: <span>15.09.2026</span></p></div></div></div>`,
      camry,
    ).records;
    expect(record).toMatchObject({ trim: 'Hybrid Le', fuel: 'Hybrid' });
    const lot = { make: 'TOYOTA', model: 'CAMRY', year: 2019, trim: 'LE', engine: '2.5L 4', fuel: 'GAS' } as Lot;
    expect(matchAuctionRecord(lot, record!).matches).toBe(false);
    expect(matchAuctionRecord({ ...lot, fuel: 'HYBRID ENGINE' }, record!).matches).toBe(true);
  });

  it('parses dates', () => {
    expect(parseBidfaxDate('15.09.2026')).toBe('2026-09-15T00:00:00.000Z');
    expect(parseBidfaxDate('n/a')).toBeNull();
  });
});

describe('bidfax parsers (real recorded pages)', () => {
  it('parses the model list of a make page', () => {
    const models = parseBidfaxModels(fixture('make-toyota.html'), 'toyota');
    expect(models).toContainEqual({ slug: 'camry', name: 'Camry' });
    expect(models).toContainEqual({ slug: 'c-hr', name: 'C-hr' });
    expect(models.length).toBeGreaterThan(20);
  });

  it('parses a 2019 Toyota Camry listing page (skipping ad placeholders)', () => {
    const { records, linkedPages } = parseBidfaxListing(fixture('toyota-camry-2019-p1.html'), camry);
    expect(records).toHaveLength(10);
    expect(linkedPages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 100]);
    expect(records[0]).toEqual({
      id: expect.stringMatching(/^bidfax:\d+$/),
      site: 'bidfax',
      url: expect.stringMatching(/^https:\/\/bidfax\.info\/toyota\/camry\/\d+-.+\.html$/),
      auction: 'iaai',
      lotNumber: '46026832',
      vin: '4T1B11HK0KU821110',
      year: 2019,
      make: 'toyota',
      model: 'camry',
      trim: 'Se',
      engine: '2.5L',
      fuel: null,
      saleDate: '2026-09-15T00:00:00.000Z',
      finalPriceUsdCents: 540_000,
      odometerMiles: 78003,
      damage: 'Left Rear',
      saleStatus: expect.stringMatching(/^(sold|on_approval)$/),
      location: 'Fontana (CA)',
      imageUrl: expect.stringMatching(/^https:\/\/bidfax\.info\/uploads\//),
    });
    for (const r of records) {
      expect(r.year).toBe(2019);
      expect(r.finalPriceUsdCents).toBeGreaterThan(0);
      expect(r.saleDate).not.toBeNull();
    }
    expect(new Set(records.map((r) => r.saleStatus))).toEqual(new Set(['sold', 'on_approval']));
  });

  it('parses page 2 with different records', () => {
    const p1 = parseBidfaxListing(fixture('toyota-camry-2019-p1.html'), camry).records.map((r) => r.id);
    const p2 = parseBidfaxListing(fixture('toyota-camry-2019-p2.html'), camry).records.map((r) => r.id);
    expect(p2.length).toBeGreaterThan(0);
    expect(p2.filter((id) => p1.includes(id))).toEqual([]);
  });

  it('flags the 429 trap page and unknown markup', () => {
    const trap = fixture('rate-limit-429.html');
    expect(isRateLimitPage(trap)).toBe(true);
    expect(() => parseBidfaxListing(trap, camry)).toThrow(expect.objectContaining({ code: 'blocked' }));
    expect(() => parseBidfaxListing('<html><body>nothing</body></html>', camry)).toThrow(SourceError);
    expect(() => parseBidfaxModels('<html></html>', 'nope')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });
});
