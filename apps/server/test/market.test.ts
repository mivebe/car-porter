import type { Lot, MarketListing } from '@car-porter/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createLotInputsRepository } from '../src/repositories/lot-inputs-repository.ts';
import { createLotsRepository } from '../src/repositories/lots-repository.ts';
import { createMarketListingsRepository } from '../src/repositories/market-listings-repository.ts';
import { createSelectionsRepository } from '../src/repositories/selections-repository.ts';
import { createSettingsRepository } from '../src/repositories/settings-repository.ts';
import { createVehicleAliasesRepository } from '../src/repositories/vehicle-aliases-repository.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { createMarketService } from '../src/services/market-service.ts';
import { createVehicleAliasService } from '../src/services/vehicle-alias-service.ts';
import { createAutoscout24Adapter } from '../src/sources/autoscout24.ts';
import { createCarsBgAdapter } from '../src/sources/carsbg.ts';
import type { MarketAdapter, MarketScan } from '../src/sources/market-adapter.ts';
import { createMobileBgAdapter } from '../src/sources/mobilebg.ts';
import { createMockMarketFetchers, mockNhtsaFetcher } from '../src/sources/mock-fetchers.ts';
import { createCatalogService } from '../src/sources/nhtsa.ts';
import { createOlxAdapter } from '../src/sources/olxbg.ts';

const lot = {
  id: 'iaai:1',
  source: 'iaai',
  lotNumber: '1',
  make: 'TOYOTA',
  model: 'CAMRY',
  year: 2019,
  trim: 'SE',
  vin: null,
  imageUrls: [],
} as unknown as Lot;

const listing = (id: string, priceEurCents: number | null): MarketListing => ({
  id,
  site: 'mobileBg',
  url: id,
  title: 'Toyota Camry',
  year: 2019,
  make: 'toyota',
  model: 'camry',
  trim: null,
  fuel: null,
  transmission: null,
  mileageKm: null,
  priceEurCents,
  location: null,
  imageUrl: null,
  importOffer: false,
});

describe('market service', () => {
  let database: Database;
  let clock: Date;

  async function setup(adapters?: MarketAdapter[], lots_: Lot[] = []) {
    database = await openDatabase(':memory:');
    clock = new Date('2026-09-16T12:00:00Z');
    const cache = createCacheRepository(database.db, () => clock);
    const fetchers = createMockMarketFetchers();
    const lots = createLotsRepository(database.db);
    await lots.upsertMany([lot, ...lots_]);
    const aliases = createVehicleAliasService({
      catalog: createCatalogService(cache, mockNhtsaFetcher),
      cache,
      aliases: createVehicleAliasesRepository(database.db),
    });
    const inputs = createLotInputsRepository(database.db);
    const service = createMarketService({
      adapters: adapters ?? [
        createMobileBgAdapter(fetchers.mobileBg, cache),
        createCarsBgAdapter(fetchers.carsBg, cache),
        createAutoscout24Adapter(fetchers.autoscout24),
        createOlxAdapter(fetchers.olxBg, cache),
      ],
      aliases,
      cache,
      lots,
      inputs,
      listings: createMarketListingsRepository(database.db),
      selections: createSelectionsRepository(database.db),
      settings: createSettingsRepository(database.db),
      now: () => clock,
    });
    return { service, inputs, aliases };
  }

  afterEach(() => database?.close());

  it('searches the default marketplaces (mobile.bg, cars.bg) and returns their listings', async () => {
    const { service } = await setup();
    const before = await service.get(lot.id);
    expect(before.listings).toEqual([]);
    expect(before.sites.map((s) => [s.site, s.enabled, s.checkedAt])).toEqual([
      ['mobileBg', true, null],
      ['carsBg', true, null],
      ['autoscout24', false, null],
      ['olxBg', false, null],
    ]);

    const res = await service.run(lot.id);
    expect(res.sites.map((s) => [s.site, s.found, s.complete, s.error?.code])).toEqual([
      ['mobileBg', 9, true, undefined],
      ['carsBg', 3, true, undefined],
      ['autoscout24', null, null, undefined],
      ['olxBg', null, null, undefined],
    ]);
    expect(res.sites[0]).toMatchObject({
      checkedAt: clock.toISOString(),
      fromCache: false,
      searchUrl: 'https://www.mobile.bg/obiavi/avtomobili-dzhipove/toyota/camry/ot-2019/do-2019',
    });
    expect(res.listings).toHaveLength(12);
    expect(res.listings[0]).toMatchObject({ firstSeenAt: clock.toISOString(), previousPriceEurCents: null });

    // stored: GET returns the same listings without searching
    expect((await service.get(lot.id)).listings).toHaveLength(12);
  });

  it('searches every site model the lot model maps to, and counts their listings as the lot model', async () => {
    const entry = (value: string, label: string) => ({ value, label });
    const scan = vi.fn(async ({ model }: { model: { value: string } }) => ({
      listings: [{ ...listing(`https://www.mobile.bg/${model.value}`, 5_000_000), model: model.value }],
      pagesScanned: 1,
      complete: true,
      searchUrl: `https://www.mobile.bg/${model.value}`,
    }));
    const mobileBg: MarketAdapter = {
      site: 'mobileBg',
      catalog: {
        makes: async () => [entry('toyota', 'Toyota'), entry('mercedes-benz', 'Mercedes-Benz')],
        models: async () => [entry('c-200', 'C 200'), entry('c-43-amg', 'C 43 AMG'), entry('c-63-amg', 'C 63 AMG'), entry('cla-45-amg', 'CLA 45 AMG')],
      },
      scan,
    };
    const c63 = { ...lot, id: 'iaai:2', lotNumber: '2', make: 'MERCEDES-BENZ', model: 'AMG C 63', year: 2017 };
    const cClass = { ...c63, id: 'iaai:3', lotNumber: '3', model: 'C-CLASS' };
    const sprinter = { ...c63, id: 'iaai:4', lotNumber: '4', model: 'SPRINTER' };
    const { service, aliases } = await setup([mobileBg], [c63, cClass, sprinter]);

    const res = await service.run(c63.id);
    expect(scan.mock.calls.map(([q]) => q.model.value)).toEqual(['c-63-amg']);
    expect(res.listings).toEqual([expect.objectContaining({ site: 'mobileBg', model: 'AMG C 63' })]);

    scan.mockClear();
    await service.run(cClass.id);
    expect(scan.mock.calls.map(([q]) => q.model.value)).toEqual(['c-200', 'c-43-amg', 'c-63-amg']);

    // a manual alias counts too, and drops the cached search of that site
    await aliases.assign([{ source: 'mobileBg', kind: 'model', externalName: 'C 43 AMG', make: 'Mercedes-Benz', action: 'assign', targets: ['AMG C 63'] }]);
    scan.mockClear();
    await service.run(c63.id);
    expect(scan.mock.calls.map(([q]) => q.model.value).sort()).toEqual(['c-43-amg', 'c-63-amg']);

    // no site model maps to it
    expect((await service.run(sprinter.id)).sites[0]).toMatchObject({ error: { code: 'not_found' } });
  });

  it('uses the lot’s own marketplace choice', async () => {
    const { service, inputs } = await setup();
    await inputs.update(lot.id, { marketSources: { mobileBg: false, carsBg: false, autoscout24: true, olxBg: true } });
    const res = await service.run(lot.id);
    expect(res.sites.map((s) => [s.site, s.enabled, s.found])).toEqual([
      ['mobileBg', false, null],
      ['carsBg', false, null],
      ['autoscout24', true, 26],
      ['olxBg', true, 0],
    ]);
    expect(res.listings.every((l) => l.site === 'autoscout24')).toBe(true);
  });

  it('reuses a search younger than 24 h, tracks price changes and removed listings on refresh', async () => {
    let scan: MarketScan = {
      listings: [listing('a', 1_000_000), listing('b', 1_200_000)],
      pagesScanned: 1,
      complete: true,
      searchUrl: 'https://www.mobile.bg/x',
    };
    const adapter = { site: 'mobileBg' as const, scan: vi.fn(async () => scan) };
    const { service } = await setup([adapter]);
    await service.run(lot.id);

    clock = new Date('2026-09-16T20:00:00Z');
    expect((await service.run(lot.id)).sites[0]).toMatchObject({ fromCache: true, found: 2 });
    expect(adapter.scan).toHaveBeenCalledTimes(1);

    scan = { ...scan, listings: [listing('a', 950_000)] };
    const refreshed = await service.run(lot.id, true);
    expect(adapter.scan).toHaveBeenCalledTimes(2);
    expect(refreshed.sites[0]).toMatchObject({ found: 1, removed: 1, fromCache: false });
    expect(refreshed.listings).toEqual([
      expect.objectContaining({
        id: 'a',
        priceEurCents: 950_000,
        previousPriceEurCents: 1_000_000,
        firstSeenAt: '2026-09-16T12:00:00.000Z',
        lastSeenAt: '2026-09-16T20:00:00.000Z',
      }),
    ]);

    // an incomplete scan (page limit) can't tell that a listing is gone
    scan = { ...scan, listings: [], complete: false };
    expect((await service.run(lot.id, true)).sites[0]).toMatchObject({ found: 0, removed: 0 });
  });

  it('reports per-site errors, keeping the previous search when a refresh fails', async () => {
    let fail = false;
    const flaky: MarketAdapter = {
      site: 'mobileBg',
      scan: async () => {
        if (fail) throw new SourceError('blocked', 'mobileBg: blocked');
        return { listings: [listing('a', 1_000_000)], pagesScanned: 1, complete: true, searchUrl: 'https://www.mobile.bg/x' };
      },
    };
    const failing: MarketAdapter = {
      site: 'carsBg',
      scan: async () => {
        throw new SourceError('not_found', 'carsBg: model "CAMRY" not listed');
      },
    };
    const { service } = await setup([flaky, failing]);
    const res = await service.run(lot.id);
    expect(res.sites[1]).toMatchObject({ site: 'carsBg', checkedAt: null, error: { code: 'not_found' } });
    expect(res.listings.map((l) => l.id)).toEqual(['a']);

    fail = true;
    const stale = await service.run(lot.id, true);
    expect(stale.sites[0]).toMatchObject({ found: 1, fromCache: true, error: { code: 'blocked' } });
    expect(stale.listings.map((l) => l.id)).toEqual(['a']);
  });

  it('persists include/exclude choices', async () => {
    const { service } = await setup();
    const { listings } = await service.run(lot.id);
    const id = listings[0]!.id;
    expect(await service.setIncluded(lot.id, id, false)).toEqual([id]);
    expect((await service.get(lot.id)).excludedIds).toEqual([id]);
  });
});

describe('/api/lots/:id/market', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    app = await buildApp({ mockSources: true });
    await app.inject({ method: 'GET', url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020' });
  });
  afterEach(async () => app.close());

  const url = `/api/lots/${encodeURIComponent('iaai:45973338')}/market`;

  it('GET reads stored listings, POST searches, PUT toggles a listing', async () => {
    expect((await app.inject({ method: 'GET', url })).json()).toMatchObject({ listings: [], excludedIds: [] });
    const run = await app.inject({ method: 'POST', url, payload: {} });
    expect(run.statusCode).toBe(200);
    const listings = run.json().listings as { id: string }[];
    expect(listings).toHaveLength(12);

    const toggle = await app.inject({ method: 'PUT', url: `${url}/selection`, payload: { listingId: listings[0]!.id, included: false } });
    expect(toggle.json()).toEqual({ excludedIds: [listings[0]!.id] });
  });

  it('stores the lot’s match toggles and marketplace choice as lot inputs', async () => {
    const inputsUrl = `/api/lots/${encodeURIComponent('iaai:45973338')}/inputs`;
    const patch = {
      marketMatch: { mileage: true, transmission: false, fuel: true },
      marketSources: { mobileBg: true, carsBg: false, autoscout24: true, olxBg: false },
    };
    expect((await app.inject({ method: 'PATCH', url: inputsUrl, payload: patch })).json()).toMatchObject(patch);
    expect((await app.inject({ method: 'GET', url: inputsUrl })).json()).toMatchObject(patch);
    expect((await app.inject({ method: 'POST', url, payload: {} })).json().sites.map((s: { enabled: boolean }) => s.enabled)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('404s for unknown lots and 400s for bad bodies', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/lots/copart%3Anope/market' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `${url}/selection`, payload: { included: true } })).statusCode).toBe(400);
  });
});
