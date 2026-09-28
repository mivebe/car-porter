import { readFileSync } from 'node:fs';
import { externalNamesFor, mapMakes, mapModels } from '@car-porter/core';
import { describe, expect, it } from 'vitest';
import { SourceError } from '../src/scraping/errors.ts';
import { buildCopartSearchBody, parseCopartFacets, parseCopartLot, parseCopartSearch } from '../src/sources/copart.ts';
import {
  buildIaaiSearchBody,
  parseIaaiFacets,
  parseIaaiSaleDate,
  parseIaaiSearch,
  parseIaaiTotal,
  parseMoney,
} from '../src/sources/iaai.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const filters = { makes: ['TOYOTA'], models: ['CAMRY', 'CAMARY'], yearFrom: 2018, yearTo: 2020 };

describe('copart', () => {
  it('builds the search API body with make/model/year filters and 0-based paging', () => {
    const body = buildCopartSearchBody(filters, 3);
    expect(body.filter).toEqual({
      VEHT: ['vehicle_type_code:VEHTYPE_V'],
      MAKE: ['lot_make_desc:"TOYOTA"'],
      MODL: ['lot_model_desc:"CAMRY"', 'lot_model_desc:"CAMARY"'],
      YEAR: ['lot_year:[2018 TO 2020]'],
    });
    expect(body).toMatchObject({ page: 2, size: 100, start: 200, query: ['*'] });
  });

  it('hands a trim word to the keyword search', () => {
    expect(buildCopartSearchBody({ ...filters, keyword: 'ZL1' }, 1).query).toEqual(['ZL1']);
  });

  it('filters by damage codes, condition codes on an OR key, and keys', () => {
    const { filter } = buildCopartSearchBody({ ...filters, damage: ['front', 'fire'], condition: 'starts', keys: true }, 1);
    expect(filter).toMatchObject({
      PRID: [
        'damage_type_code:DAMAGECODE_FR',
        'damage_type_code:DAMAGECODE_BN',
        'damage_type_code:DAMAGECODE_BE',
        'damage_type_code:DAMAGECODE_BI',
      ],
      SRCE: ['lot_condition_code:CERT-D', 'lot_condition_code:CERT-S'],
      KEYS: ['has_keys:YES'],
    });
    expect(buildCopartSearchBody({ ...filters, condition: 'runsDrives', keys: false }, 1).filter).toMatchObject({
      SRCE: ['lot_condition_code:CERT-D'],
      KEYS: ['has_keys:NO'],
    });
  });

  it('parses a real recorded search response', () => {
    const result = parseCopartSearch(fixture('copart/search-toyota-camry-2018-2020.json'), 1);
    expect(result.total).toBe(1661);
    expect(result.lots).toHaveLength(25);
    for (const lot of result.lots) {
      expect(lot.source).toBe('copart');
      expect(lot.id).toBe(`copart:${lot.lotNumber}`);
      expect(lot.make).toBe('TOYOTA');
      expect(lot.model).toBe('CAMRY');
      expect(lot.year).toBeGreaterThanOrEqual(2018);
      expect(lot.year).toBeLessThanOrEqual(2020);
      expect(lot.url).toMatch(/^https:\/\/www\.copart\.com\/lot\/\d+/);
    }
    const first = result.lots[0]!;
    expect(first).toMatchObject({
      lotNumber: '65095026',
      vin: '4T1C11AK2LU******',
      trim: 'LE',
      engine: '2.5L 4',
      fuel: 'GAS',
      transmission: 'AUTOMATIC',
      odometerMiles: 233120,
      location: 'TX - HOUSTON EAST',
    });
    expect(first.imageUrls[0]).toMatch(/_hrs\.jpg$/);
    expect(result.lots.some((l) => l.currentBidUsdCents !== null)).toBe(true);
    const tally = (values: unknown[]) => values.reduce<Record<string, number>>((a, v) => ({ ...a, [String(v)]: (a[String(v)] ?? 0) + 1 }), {});
    // CERT-D run and drive, CERT-S engine start; CERT-E enhanced and none say nothing
    expect(tally(result.lots.map((l) => l.condition))).toEqual({ runsDrives: 15, starts: 4, null: 6 });
    // YES / NO / EXEMPT
    expect(tally(result.lots.map((l) => l.keys))).toEqual({ true: 21, false: 3, null: 1 });
  });

  it('maps optional numbers: 0 / -1 become null, dates become ISO', () => {
    const lot = parseCopartLot({
      ln: 1, lcy: 2019, mkn: 'TOYOTA', lm: 'CAMRY', hb: 0, bnp: 0, la: -1, ad: 1789660800000, orr: 0,
    });
    expect(lot).toMatchObject({
      currentBidUsdCents: null,
      buyNowUsdCents: null,
      acvUsdCents: null,
      odometerMiles: null,
      saleDate: '2026-09-17T16:00:00.000Z',
    });
    expect(parseCopartLot({ ln: 'x' })).toBeNull();
  });

  it('detects block pages and bad payloads', () => {
    expect(() => parseCopartSearch('<html><iframe src="/_Incapsula_Resource?x"></iframe></html>', 1)).toThrow(
      expect.objectContaining({ code: 'blocked' }),
    );
    expect(() => parseCopartSearch('not json', 1)).toThrow(expect.objectContaining({ code: 'parse_failed' }));
    expect(() => parseCopartSearch('{"returnCode":0}', 1)).toThrow(SourceError);
  });
});

describe('iaai', () => {
  it('builds the search body with keyword + year range and 1-based paging', () => {
    const body = buildIaaiSearchBody(filters, 2);
    expect(body.Searches).toEqual([
      {
        Facets: [
          { Group: 'InventoryTypes', Value: 'Automobiles' },
          { Group: 'InventoryTypes', Value: 'SUVs' },
          { Group: 'InventoryTypes', Value: 'Vans' },
          { Group: 'InventoryTypes', Value: 'Pick-up Trucks' },
          { Group: 'InventoryTypes', Value: 'Light Trucks' },
          { Group: 'InventoryTypes', Value: 'Fleet Vehicles' },
          { Group: 'InventoryTypes', Value: 'Rental Vehicles' },
        ],
        FullSearch: null,
        LongRanges: null,
      },
      { Facets: [{ Group: 'Make', Value: 'TOYOTA' }], FullSearch: null, LongRanges: null },
      {
        Facets: [
          { Group: 'Model', Value: 'CAMRY' },
          { Group: 'Model', Value: 'CAMARY' },
        ],
        FullSearch: null,
        LongRanges: null,
      },
      { Facets: null, FullSearch: null, LongRanges: [{ From: 2018, Name: 'Year', To: 2020 }] },
    ]);
    expect(body).toMatchObject({ PageSize: 100, CurrentPage: 2 });
  });

  it('adds the marketplace facet and a trim keyword', () => {
    const body = buildIaaiSearchBody({ ...filters, keyword: '63', iaaiMarkets: ['ca', 'rb'] }, 1);
    expect(body.Searches.slice(3, 5)).toEqual([
      {
        Facets: [
          { Group: 'Market', Value: 'IAA Canada' },
          { Group: 'Market', Value: 'Ritchie Bros.' },
        ],
        FullSearch: null,
        LongRanges: null,
      },
      { Facets: null, FullSearch: '63', LongRanges: null },
    ]);
  });

  it('parses a real recorded results page', () => {
    const result = parseIaaiSearch(fixture('iaai/search-toyota-camry-2018-2020-p1.html'), 1);
    expect(result.total).toBe(1362);
    expect(result.lots).toHaveLength(30); // fixture keeps 30 vehicle rows (+ a non-vehicle template row)
    for (const lot of result.lots) {
      expect(lot.source).toBe('iaai');
      expect(lot.make).toBe('TOYOTA');
      expect(lot.model).toMatch(/CAMRY/);
      expect(lot.year).toBeGreaterThanOrEqual(2018);
      expect(lot.year).toBeLessThanOrEqual(2020);
      expect(lot.url).toMatch(/^https:\/\/www\.iaai\.com\/VehicleDetail\/\d+~US$/);
      expect(lot.saleDate === null || !Number.isNaN(Date.parse(lot.saleDate))).toBe(true);
    }
    const first = result.lots[0]!;
    expect(first).toMatchObject({
      lotNumber: '45973338',
      vin: '4T1B11HK7KU******',
      year: 2019,
      trim: 'SE',
      fuel: 'Gasoline',
      transmission: 'Automatic',
      odometerMiles: 148715,
      primaryDamage: 'Right Front',
      titleType: 'Salvage',
      acvUsdCents: 1_120_200,
      saleDate: '2026-09-16T13:30:00.000Z',
    });
    expect(first.engine).toMatch(/^2\.5L/);
    expect(first.imageUrls[0]).toMatch(/^https:\/\/vis\.iaai\.com\/resizer\?imageKeys=/);
    const count = (pick: (l: (typeof result.lots)[number]) => unknown, value: unknown) =>
      result.lots.filter((l) => pick(l) === value).length;
    // row badges "Run & Drive" / "Starts"; stationary rows have none
    expect([count((l) => l.condition, 'runsDrives'), count((l) => l.condition, 'starts'), count((l) => l.condition, null)]).toEqual([21, 2, 7]);
    // "Key Available" or blank for none
    expect([count((l) => l.keys, true), count((l) => l.keys, false)]).toEqual([26, 4]);
  });

  it('filters by damage names, start codes and keys', () => {
    const body = buildIaaiSearchBody({ ...filters, damage: ['front', 'rear'], condition: 'starts', keys: true }, 1);
    const groups = body.Searches.flatMap((s) => (s.Facets?.[0] ? [[s.Facets[0].Group, s.Facets.map((f) => f.Value)]] : []));
    expect(Object.fromEntries(groups)).toMatchObject({
      // "Front & Rear" once
      PrimaryDamageDesc: ['Front End', 'Front', 'Left Front', 'Right Front', 'Front & Rear', 'Rear', 'Left Rear', 'Right Rear'],
      StartsDesc: ['Run & Drive', 'Starts'],
      Key: ['Key Available'],
    });
    const none = buildIaaiSearchBody({ ...filters, keys: false }, 1).Searches.find((s) => s.Facets?.[0]?.Group === 'Key');
    expect(none?.Facets).toEqual([{ Group: 'Key', Value: '' }]);
  });

  it('parses page 2 and finds Buy Now prices on some rows', () => {
    const p1 = parseIaaiSearch(fixture('iaai/search-toyota-camry-2018-2020-p1.html'), 1);
    const p2 = parseIaaiSearch(fixture('iaai/search-toyota-camry-2018-2020-p2.html'), 2);
    expect(p2.lots.length).toBeGreaterThan(0);
    expect(new Set([...p1.lots, ...p2.lots].map((l) => l.id)).size).toBe(p1.lots.length + p2.lots.length);
    expect([...p1.lots, ...p2.lots].some((l) => l.buyNowUsdCents !== null)).toBe(true);
  });

  it('helpers: sale date timezone, money, totals', () => {
    expect(parseIaaiSaleDate('9/16/2026 8:30:00 AM +00:00', 'Wed Sep 16, 8:30am CDT')).toBe(
      '2026-09-16T13:30:00.000Z',
    );
    expect(parseIaaiSaleDate('12/1/2026 1:05:00 PM +00:00', 'Tue Dec 1, 1:05pm PST')).toBe(
      '2026-12-01T21:05:00.000Z',
    );
    expect(parseIaaiSaleDate(null, 'x')).toBeNull();
    expect(parseMoney('Buy Now $6,400 USD')).toBe(640_000);
    expect(parseMoney('n/a')).toBeNull();
    expect(parseIaaiTotal('"Group":"Year","Facets":[{"Count":2,"Value":"2019"},{"Count":3,"Value":"2020"}]')).toBe(5);
  });

  it('detects block pages and unrecognized HTML', () => {
    expect(() => parseIaaiSearch('<title>Just a moment...</title>', 1)).toThrow(
      expect.objectContaining({ code: 'blocked' }),
    );
    expect(() => parseIaaiSearch('<html><body>hello</body></html>', 1)).toThrow(
      expect.objectContaining({ code: 'parse_failed' }),
    );
  });
});

describe('site facets → canonical names (recorded 2026-09-17)', () => {
  const nhtsaMercedes = ['car', 'mpv', 'truck'].flatMap(
    (type) =>
      (JSON.parse(fixture(`nhtsa/models-mercedes-benz-${type}.json`)) as { Results: { Model_Name: string }[] }).Results.map(
        (r) => r.Model_Name,
      ),
  );

  it('reads Copart make/model facets in exact site spelling', () => {
    const text = fixture('copart/facets-mercedes-benz-2017.json');
    const makes = parseCopartFacets(text, 'MAKE');
    expect(makes).toContainEqual({ name: 'MERCEDES-BENZ', count: 761 });
    const models = parseCopartFacets(text, 'MODL');
    expect(models).toContainEqual({ name: 'GLC COUPE', count: 14 });
    expect(externalNamesFor(mapModels('Mercedes-Benz', nhtsaMercedes, models.map((m) => m.name)), 'C-Class')).toEqual(['C']);
  });

  it('reads IAAI make/model facets and maps every C-Class spelling', () => {
    const html = fixture('iaai/facets-mercedes.html');
    const makes = parseIaaiFacets(html, 'Make');
    expect(externalNamesFor(mapMakes(['Mercedes-Benz', 'Mercury'], makes.map((m) => m.name)), 'Mercedes-Benz')).toEqual([
      'MERCEDES',
      'MERCEDES BENZ',
      'MERCEDES-BENZ',
    ]);
    const models = parseIaaiFacets(html, 'Model').map((m) => m.name);
    const cClass = externalNamesFor(mapModels('Mercedes-Benz', nhtsaMercedes, models), 'C-Class');
    expect(cClass).toEqual(expect.arrayContaining(['AMG C 43', 'AMG C 63', 'C 300', 'C 63 AMG', 'C-CLASS', 'C300 4MATIC']));
    expect(cClass.filter((m) => /^(AMG )?(CLA|CLS|CLK|CLE|CL)\b/.test(m))).toEqual([]);
  });

  it('treats a page without facet groups as a parse failure', () => {
    expect(() => parseIaaiFacets('<html><body>nothing</body></html>', 'Make')).toThrow(SourceError);
  });
});
