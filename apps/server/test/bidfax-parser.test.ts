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
  parseBidfaxRecordUrl,
  parseBidfaxSearch,
  parseBidfaxTitle,
  trimFromRecordUrl,
} from '../src/sources/bidfax.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/bidfax/${name}`, import.meta.url), 'utf8');
const camry = { makeSlug: 'toyota', modelSlug: 'camry', makeName: 'Toyota', modelName: 'Camry' };

describe('bidfax helpers', () => {
  it('builds slugs and exact-year listing URLs', () => {
    expect(bidfaxSlug('Mercedes-Benz')).toBe('mercedes-benz');
    expect(bidfaxSlug('LAND ROVER')).toBe('land-rover');
    expect(bidfaxListingUrl('toyota', 'camry', 2019)).toBe(
      'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/',
    );
    expect(bidfaxListingUrl('toyota', 'camry', 2019, 3)).toBe(
      'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/page/3/',
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

  it('parses an en.bidfax.info page: English labels, models kept in the trim', () => {
    const amg = { makeSlug: 'mercedes-benz', modelSlug: 'amg-gt', makeName: 'MERCEDES-BENZ', modelName: 'AMG' };
    const { records } = parseBidfaxListing(fixture('en-mercedes-amg-2017-p2.html'), amg);
    expect(records.length).toBeGreaterThan(5);
    const c63 = records.find((r) => r.vin === 'WDDWK8HB7HF494445');
    expect(c63).toMatchObject({ model: 'amg-gt', trim: 'C 63 S', engine: '4.0L', year: 2017 });
    for (const r of records) {
      expect(r.lotNumber).toMatch(/^\d+$/);
      expect(r.saleDate).not.toBeNull();
      expect(r.odometerMiles).toBeGreaterThan(0);
      expect(r.trim).not.toBeNull();
    }
  });

  it('flags the 429 trap page and unknown markup', () => {
    const trap = fixture('rate-limit-429.html');
    expect(isRateLimitPage(trap)).toBe(true);
    expect(() => parseBidfaxListing(trap, camry)).toThrow(expect.objectContaining({ code: 'blocked' }));
    expect(() => parseBidfaxListing('<html><body>nothing</body></html>', camry)).toThrow(SourceError);
    expect(() => parseBidfaxModels('<html></html>', 'nope')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  it('flags a Cloudflare challenge page as blocked', () => {
    const challenge = '<html><head><title>Just a moment...</title></head><body></body></html>';
    expect(() => parseBidfaxListing(challenge, camry)).toThrow(expect.objectContaining({ code: 'blocked' }));
    expect(() => parseBidfaxSearch(challenge)).toThrow(expect.objectContaining({ code: 'blocked' }));
  });
});

describe('bidfax search (real recorded pages)', () => {
  it('parses a VIN search: make/model come from the card link', () => {
    expect(parseBidfaxSearch(fixture('search-vin-4t1b11hk0ku821110.html'))).toEqual([
      {
        id: 'bidfax:39201230',
        site: 'bidfax',
        url: 'https://bidfax.info/toyota/camry/39201230-toyota-camry-se-2019-white-25l-vin-4t1b11hk0ku821110.html',
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
        odometerMiles: 78_003,
        damage: 'Left Rear',
        saleStatus: 'on_approval',
        location: 'Fontana (CA)',
        imageUrl: 'https://bidfax.info/uploads/posts/2026-09/16/toyota-camry-2019-4t1b11hk0ku821110-img01.jpg',
      },
    ]);
  });

  it('parses a lot-number search that also hits another vehicle with the same lot number', () => {
    const records = parseBidfaxSearch(fixture('search-lot-46026832.html'));
    expect(records.map((r) => [r.auction, r.lotNumber, r.vin, r.make, r.model, r.trim])).toEqual([
      ['iaai', '46026832', '4T1B11HK0KU821110', 'toyota', 'camry', 'Se'],
      ['copart', '46026832', '1FT8W3BT0BEB49246', 'ford', 'f350', 'Super Duty'],
    ]);
  });

  it('returns no records for a search without results', () => {
    expect(parseBidfaxSearch(fixture('search-none.html'))).toEqual([]);
    expect(() => parseBidfaxSearch('<html><body>nothing</body></html>')).toThrow(expect.objectContaining({ code: 'parse_failed' }));
  });

  it('extracts slugs and ids from record URLs', () => {
    expect(parseBidfaxRecordUrl('https://bidfax.info/land-rover/range-rover-sport/123-x.html')).toEqual({
      makeSlug: 'land-rover',
      modelSlug: 'range-rover-sport',
      externalId: '123',
    });
    expect(parseBidfaxRecordUrl('https://bidfax.info/about.html')).toBeNull();
  });

  it('reads the trim from a record URL', () => {
    const url = (model: string, name: string) => `https://en.bidfax.info/mercedes-benz/${model}/39198711-${name}.html`;
    expect(trimFromRecordUrl(url('c-class', 'mercedes-benz-c-300-4matic-2017-white-20l-vin-55swf4kb2hu224039'))).toBe('C 300 4matic');
    expect(trimFromRecordUrl(url('amg-gt', 'mercedes-benz-g-63-amg-2017-black-55l-8-vin-wdcyc7dfxhx274112'))).toBe('G 63 Amg');
    expect(trimFromRecordUrl(url('c-class', 'mercedes-benz-c-class-2017-black-vin-wdc0g4jb9hv009372'))).toBeNull();
    expect(trimFromRecordUrl('https://bidfax.info/toyota/camry/1-toyota-camry-se-2019-white-25l-vin-x.html')).toBe('Se');
  });

  it('strips hyphenated slugs as spaced title prefixes', () => {
    expect(parseBidfaxTitle('Land Rover Range Rover Sport Hse 2018 Black 3.0L vin: SALWR2RV0JA000000', ['land-rover range-rover-sport', 'land rover range rover sport'])?.trim).toBe('Hse');
  });
});
