import type { Lot } from '@car-porter/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createAuctionRecordsRepository } from '../src/repositories/auction-records-repository.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createLotInputsRepository } from '../src/repositories/lot-inputs-repository.ts';
import { createLotsRepository } from '../src/repositories/lots-repository.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { createHistoryService } from '../src/services/history-service.ts';
import { MOCK_HISTORY_VIN, mockBidfaxSearcher, mockStatVinFetcher } from '../src/sources/mock-fetchers.ts';
import { statVinUrl } from '../src/sources/statvin.ts';

const lot: Lot = {
  id: 'iaai:46026832',
  source: 'iaai',
  lotNumber: '46026832',
  url: 'https://www.iaai.com/VehicleDetail/1~US',
  vin: '4T1B11HK0KU******',
  year: 2019,
  make: 'TOYOTA',
  model: 'CAMRY',
  trim: 'SE',
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
};

describe('history service', () => {
  let database: Database;
  let clock: Date;
  let searchBidfax: ReturnType<typeof vi.fn<(query: string) => Promise<string>>>;
  let fetchStatVin: ReturnType<typeof vi.fn<(url: string) => Promise<string>>>;

  async function setup(overrides: { statVin?: (url: string) => Promise<string>; lot?: Partial<Lot> } = {}) {
    database = await openDatabase(':memory:');
    clock = new Date('2026-09-16T12:00:00Z');
    searchBidfax = vi.fn(mockBidfaxSearcher);
    fetchStatVin = vi.fn(overrides.statVin ?? mockStatVinFetcher);
    const lots = createLotsRepository(database.db);
    await lots.upsertMany([{ ...lot, ...overrides.lot }]);
    const inputs = createLotInputsRepository(database.db);
    const service = createHistoryService({
      searchBidfax,
      fetchStatVin,
      cache: createCacheRepository(database.db, () => clock),
      lots,
      inputs,
      records: createAuctionRecordsRepository(database.db),
    });
    return { service, inputs };
  }

  afterEach(() => database?.close());

  it('without a full VIN searches bidfax by lot number and drops the other auction’s vehicle', async () => {
    const { service } = await setup();
    const res = await service.run(lot.id);

    expect(searchBidfax.mock.calls).toEqual([['46026832']]);
    expect(fetchStatVin).not.toHaveBeenCalled();
    expect(res).toMatchObject({ vin: null, vinSource: null, lotNumber: '46026832' });
    expect(res.checks).toEqual([
      { site: 'bidfax', query: 'lot', value: '46026832', checkedAt: clock.toISOString(), fromCache: false, found: 1 },
    ]);
    // the Copart Ford F350 under the same lot number is not this vehicle
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]).toMatchObject({
      key: 'iaai:46026832:2026-09-15',
      vin: MOCK_HISTORY_VIN,
      finalPriceUsdCents: 540_000,
      saleStatus: 'on_approval',
      damage: 'Left Rear',
    });
  });

  it('a lot-number hit whose VIN contradicts the masked lot VIN is not history', async () => {
    const { service } = await setup({ lot: { vin: '4T1B11HK7KU******' } });
    const res = await service.run(lot.id);
    expect(res.entries).toEqual([]);
    expect(res.checks[0]).toMatchObject({ found: 0 });
  });

  it('uses a pasted VIN: bidfax + stat.vin by VIN, merged by auction, lot and date', async () => {
    const { service, inputs } = await setup();
    await inputs.update(lot.id, { vinOverride: MOCK_HISTORY_VIN.toLowerCase() });
    const res = await service.run(lot.id);

    expect(searchBidfax.mock.calls).toEqual([[MOCK_HISTORY_VIN], ['46026832']]);
    expect(fetchStatVin.mock.calls).toEqual([[statVinUrl(MOCK_HISTORY_VIN)]]);
    expect(res).toMatchObject({ vin: MOCK_HISTORY_VIN, vinSource: 'override' });
    expect(res.checks.map((c) => [c.site, c.query, c.found])).toEqual([
      ['bidfax', 'vin', 1],
      ['statvin', 'vin', 2],
      ['bidfax', 'lot', 1],
    ]);

    expect(res.entries.map((e) => e.key)).toEqual(['iaai:46026832:2026-09-22', 'iaai:46026832:2026-09-15']);
    const [upcoming, sale] = res.entries;
    expect(upcoming).toMatchObject({ saleStatus: 'upcoming', finalPriceUsdCents: null });
    expect(upcoming!.sources.map((s) => s.site)).toEqual(['statvin']);
    // bidfax fields win, the final "not sold" status beats "on approval"
    expect(sale).toMatchObject({ saleStatus: 'not_sold', damage: 'Left Rear', finalPriceUsdCents: 540_000 });
    expect(sale!.sources.map((s) => s.site)).toEqual(['bidfax', 'statvin']);
  });

  it('reuses checks younger than 24 h, refreshes when forced, and keeps entries permanently', async () => {
    const { service, inputs } = await setup();
    await inputs.update(lot.id, { vinOverride: MOCK_HISTORY_VIN });
    await service.run(lot.id);
    searchBidfax.mockClear();
    fetchStatVin.mockClear();

    clock = new Date('2026-09-16T18:00:00Z');
    const reused = await service.run(lot.id);
    expect(searchBidfax).not.toHaveBeenCalled();
    expect(fetchStatVin).not.toHaveBeenCalled();
    expect(reused.checks.every((c) => c.fromCache && c.checkedAt === '2026-09-16T12:00:00.000Z')).toBe(true);

    const stored = await service.get(lot.id);
    expect(stored.entries).toHaveLength(2);
    expect(stored.checks.map((c) => c.found)).toEqual([1, 2, 1]);

    const forced = await service.run(lot.id, true);
    expect(searchBidfax).toHaveBeenCalledTimes(2);
    expect(fetchStatVin).toHaveBeenCalledTimes(1);
    expect(forced.checks.every((c) => !c.fromCache && c.checkedAt === clock.toISOString())).toBe(true);
  });

  it('reports a failing site per check and still shows what the others found', async () => {
    const { service, inputs } = await setup({
      statVin: async () => {
        throw new SourceError('blocked', 'statvin: Cloudflare challenge did not clear');
      },
    });
    await inputs.update(lot.id, { vinOverride: MOCK_HISTORY_VIN });
    const res = await service.run(lot.id);

    expect(res.checks[1]).toEqual({
      site: 'statvin',
      query: 'vin',
      value: MOCK_HISTORY_VIN,
      checkedAt: null,
      fromCache: false,
      found: null,
      error: { code: 'blocked', message: 'statvin: Cloudflare challenge did not clear' },
    });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0]!.sources.map((s) => s.site)).toEqual(['bidfax']);

    // failed checks are not cached: GET shows them as never checked
    expect((await service.get(lot.id)).checks[1]).toMatchObject({ checkedAt: null, found: null });
  });
});

describe('/api/lots/:id/history', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    app = await buildApp({ mockSources: true });
    await app.inject({ method: 'GET', url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020' });
  });
  afterEach(async () => app.close());

  const url = `/api/lots/${encodeURIComponent('iaai:45973338')}/history`;

  it('GET reads stored history only; POST checks and follows the pasted VIN', async () => {
    const before = await app.inject({ method: 'GET', url });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ vin: null, entries: [], checks: [{ site: 'bidfax', query: 'lot', checkedAt: null }] });

    const byLot = await app.inject({ method: 'POST', url, payload: {} });
    expect(byLot.json()).toMatchObject({ entries: [], checks: [{ found: 0 }] });

    await app.inject({
      method: 'PATCH',
      url: `/api/lots/${encodeURIComponent('iaai:45973338')}/inputs`,
      payload: { vinOverride: MOCK_HISTORY_VIN },
    });
    const byVin = await app.inject({ method: 'POST', url, payload: { refresh: true } });
    expect(byVin.statusCode).toBe(200);
    expect(byVin.json()).toMatchObject({ vin: MOCK_HISTORY_VIN, vinSource: 'override' });
    expect(byVin.json().entries).toHaveLength(2);
  });

  it('404s for unknown lots and 400s for bad bodies', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/lots/copart%3Anope/history' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, payload: { refresh: 'yes' } })).statusCode).toBe(400);
  });
});
