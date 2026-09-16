import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStatVinHistory, parseStatVinMoney, statVinUrl } from '../src/sources/statvin.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/statvin/${name}`, import.meta.url), 'utf8');
const PAGE = 'https://stat.vin/cars/4t1b11hk0ku821110-toyota-camry-2019-se-white-25l-i-4-di';

describe('stat.vin parser (real recorded pages)', () => {
  it('builds VIN URLs and parses money', () => {
    expect(statVinUrl(' 4t1b11hk0ku821110 ')).toBe('https://stat.vin/cars/4T1B11HK0KU821110');
    expect(parseStatVinMoney('$5 400.00')).toBe(540_000);
    expect(parseStatVinMoney('$19,116')).toBe(1_911_600);
    expect(parseStatVinMoney('$0.00')).toBeNull();
    expect(parseStatVinMoney('N/A')).toBeNull();
  });

  it('parses every sales-history row with the vehicle data of the page', () => {
    const records = parseStatVinHistory(fixture('vin-4t1b11hk0ku821110.html'));
    expect(records).toHaveLength(2);
    const shared = {
      site: 'statvin',
      url: PAGE,
      auction: 'iaai',
      lotNumber: '46026832',
      vin: '4T1B11HK0KU821110',
      year: 2019,
      make: 'TOYOTA',
      model: 'CAMRY',
      trim: null,
      engine: '2.5L I-4 DI, DOHC, VVT, regular , 203HP',
      fuel: 'Gasoline',
      odometerMiles: 78_003,
      damage: 'Rear End',
      location: 'Fontana (CA)',
    };
    expect(records[0]).toEqual({
      ...shared,
      id: 'statvin:4T1B11HK0KU821110:iaai:46026832:2026-09-22',
      saleDate: '2026-09-22T00:00:00.000Z',
      finalPriceUsdCents: null,
      saleStatus: 'upcoming',
      imageUrl: expect.stringMatching(/^https:\/\/cdn\d*\.stat\.vin\/.+\/46026832\/photo\/photo_1\.webp$/),
    });
    expect(records[1]).toMatchObject({
      ...shared,
      saleDate: '2026-09-15T00:00:00.000Z',
      finalPriceUsdCents: 540_000,
      saleStatus: 'not_sold',
    });
  });

  it('returns nothing for an unknown VIN (redirected to the VIN decoder)', () => {
    expect(parseStatVinHistory(fixture('vin-not-found.html'))).toEqual([]);
  });

  it('flags challenge pages and vehicle pages without a history table', () => {
    expect(() => parseStatVinHistory('<html><head><title>Just a moment...</title></head></html>')).toThrow(
      expect.objectContaining({ code: 'blocked' }),
    );
    const noTable = '<html><script type="application/ld+json">{"@type":"Vehicle","vehicleIdentificationNumber":"X"}</script></html>';
    expect(() => parseStatVinHistory(noTable)).toThrow(expect.objectContaining({ code: 'parse_failed' }));
  });
});
