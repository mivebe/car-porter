import type { Lot } from '@car-porter/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createAuctionRecordsRepository } from '../src/repositories/auction-records-repository.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createLotsRepository } from '../src/repositories/lots-repository.ts';
import { createSelectionsRepository } from '../src/repositories/selections-repository.ts';
import { createSettingsRepository } from '../src/repositories/settings-repository.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { bidfaxListingUrl, parseBidfaxListing } from '../src/sources/bidfax.ts';
import { mockBidfaxFetcher } from '../src/sources/mock-fetchers.ts';
import { createEstimateService, nextCoverage, pickBidfaxModel } from '../src/services/estimate-service.ts';

const lot: Lot = {
  id: 'iaai:45973338',
  source: 'iaai',
  lotNumber: '45973338',
  url: 'https://www.iaai.com/VehicleDetail/46472578~US',
  vin: '4T1B11HK7KU******',
  year: 2019,
  make: 'TOYOTA',
  model: 'CAMRY',
  trim: null,
  engine: '2.5L I-4 DI, DOHC, VVT, 203HP',
  fuel: 'Gasoline',
  transmission: 'Automatic',
  drive: null,
  odometerMiles: 148715,
  primaryDamage: 'Right Front',
  secondaryDamage: null,
  titleType: 'Salvage',
  location: 'Columbus',
  saleDate: null,
  currentBidUsdCents: null,
  buyNowUsdCents: null,
  acvUsdCents: null,
  imageUrls: [],
};

const P1 = bidfaxListingUrl('toyota', 'camry', 2019, 1);
const P2 = bidfaxListingUrl('toyota', 'camry', 2019, 2);
const P3 = bidfaxListingUrl('toyota', 'camry', 2019, 3);
const MAKE = 'https://en.bidfax.info/toyota/';

describe('pickBidfaxModel', () => {
  const models = [
    { slug: 'camry', name: 'Camry' },
    { slug: 'camry-hybrid', name: 'Camry hybrid' },
    { slug: 'c-hr', name: 'C-hr' },
  ];
  it('prefers exact matches, ignoring case and punctuation', () => {
    expect(pickBidfaxModel(models, 'CAMRY')?.slug).toBe('camry');
    expect(pickBidfaxModel(models, 'CAMRY HYBRID')?.slug).toBe('camry-hybrid');
    expect(pickBidfaxModel(models, 'CHR')?.slug).toBe('c-hr');
    expect(pickBidfaxModel(models, 'Supra')).toBeNull();
  });

  it('sends AMG performance models to the AMG catch-all', () => {
    const mercedes = [
      { slug: 'amg-gt', name: 'AMG' },
      { slug: 'c-class', name: 'C-class' },
    ];
    expect(pickBidfaxModel(mercedes, 'C 63 AMG')?.slug).toBe('amg-gt');
    expect(pickBidfaxModel(mercedes, 'C')?.slug).toBe('c-class');
  });
});

describe('nextCoverage', () => {
  it('merges coverage only when a scan runs into the covered range', () => {
    const covered = { newest: '2026-09-10', oldest: '2026-08-01', exhausted: true, limitedBy: null };
    expect(nextCoverage(covered, ['2026-09-15', '2026-09-09'], 'reached_known')).toEqual({ ...covered, newest: '2026-09-15' });
    expect(nextCoverage(null, ['2026-09-15', '2026-09-01'], 'max_pages')).toEqual({
      newest: '2026-09-15',
      oldest: '2026-09-01',
      exhausted: false,
      limitedBy: 'max_pages',
    });
    expect(nextCoverage({ ...covered, exhausted: false, limitedBy: 'max_matches' }, ['2026-09-15', '2026-07-01'], 'last_page')).toEqual({
      newest: '2026-09-15',
      oldest: '2026-07-01',
      exhausted: true,
      limitedBy: null,
    });
    expect(nextCoverage(null, [], 'no_results')).toEqual({ newest: null, oldest: null, exhausted: true, limitedBy: null });
  });
});

describe('estimate service', () => {
  let database: Database;
  let clock: Date;
  let fetcher: ReturnType<typeof vi.fn<(url: string) => Promise<string>>>;

  async function setup(fetchImpl: (url: string) => Promise<string> = mockBidfaxFetcher) {
    database = await openDatabase(':memory:');
    clock = new Date('2026-09-16T12:00:00Z');
    fetcher = vi.fn(fetchImpl);
    const cache = createCacheRepository(database.db, () => clock);
    const lots = createLotsRepository(database.db);
    await lots.upsertMany([lot]);
    return createEstimateService({
      fetchHtml: fetcher,
      cache,
      lots,
      records: createAuctionRecordsRepository(database.db),
      selections: createSelectionsRepository(database.db),
      settings: createSettingsRepository(database.db),
      now: () => clock,
    });
  }

  afterEach(() => database?.close());

  it('scans pages newest first until results run out (the hybrid sale does not match this petrol lot)', async () => {
    const service = await setup();
    const res = await service.run(lot.id);

    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([MAKE, P1, P2, P3]);
    expect(res.error).toBeUndefined();
    expect(res.searchUrl).toBe(P1);
    expect(res.scan).toMatchObject({ pagesScanned: 3, stopReason: 'no_results', newRecords: 20, fresh: true });
    expect(res.matches).toHaveLength(19);
    expect(res.matches.some((m) => /hybrid/i.test(m.record.trim ?? ''))).toBe(false);
    expect(res.matches.every((m) => m.record.year === 2019)).toBe(true);
    // fuel is never on bidfax cards → always reported as unknown, never a mismatch
    expect(res.matches[0]!.unknown).toContain('fuel');
    const dates = res.matches.map((m) => m.record.saleDate!);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('respects the trim of the lot', async () => {
    const service = await setup();
    await createLotsRepository(database.db).upsertMany([{ ...lot, trim: 'SE' }]);
    const res = await service.run(lot.id);
    expect(res.matches.length).toBeGreaterThan(0);
    expect(res.matches.every((m) => m.record.trim?.toLowerCase() === 'se')).toBe(true);
  });

  it('stops at maxMatches and maxPages from settings', async () => {
    const service = await setup();
    const settings = createSettingsRepository(database.db);
    await settings.update({ bidfax: { maxMatches: 5 } });
    let res = await service.run(lot.id);
    expect(res.scan).toMatchObject({ pagesScanned: 1, stopReason: 'max_matches' });
    expect(res.matches).toHaveLength(5);

    await settings.update({ bidfax: { maxMatches: 50, maxPages: 2 } });
    res = await service.run(lot.id, true);
    expect(res.scan).toMatchObject({ pagesScanned: 2, stopReason: 'max_pages' });

    await settings.update({ bidfax: { maxPages: 20 } });
    res = await service.run(lot.id, true);
    expect(res.scan).toMatchObject({ pagesScanned: 3, stopReason: 'no_results' });
    expect(fetcher.mock.calls.at(-1)![0]).toBe(P3);
  });

  it('reuses a scan younger than 24 h, rescans incrementally after, and fully when forced', async () => {
    const service = await setup();
    await service.run(lot.id);
    fetcher.mockClear();

    const cachedRes = await service.run(lot.id);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cachedRes.matches).toHaveLength(19);

    clock = new Date('2026-09-17T13:00:00Z');
    const incremental = await service.run(lot.id);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([P1]);
    expect(incremental.scan).toMatchObject({ pagesScanned: 1, stopReason: 'reached_known', newRecords: 0 });

    fetcher.mockClear();
    const forced = await service.run(lot.id, true);
    // forced: no incremental stop → scans until results run out
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([P1, P2, P3]);
    expect(forced.scan).toMatchObject({ stopReason: 'no_results', newRecords: 0 });
  });

  it('excludes sales outside the 12-month window', async () => {
    const service = await setup();
    clock = new Date('2027-10-01T00:00:00Z');
    const res = await service.run(lot.id);
    expect(res.scan).toMatchObject({ pagesScanned: 1, stopReason: 'older_than_window' });
    expect(res.matches).toHaveLength(0);
  });

  it('keeps partial results and reports the error when a page is blocked', async () => {
    let blockP2 = true;
    const service = await setup(async (url) => {
      if (url === P2 && blockP2) throw new SourceError('blocked', 'bidfax: Cloudflare challenge did not clear');
      return mockBidfaxFetcher(url);
    });
    const res = await service.run(lot.id);
    expect(res.error).toEqual({ code: 'blocked', message: 'bidfax: Cloudflare challenge did not clear' });
    expect(res.matches).toHaveLength(10);
    expect(res.scan).toBeNull(); // failed scans are not cached, so the next run retries

    const again = await service.get(lot.id);
    expect(again.matches).toHaveLength(10);

    // the retry must not stop at the page-1 records stored by the failed scan
    blockP2 = false;
    fetcher.mockClear();
    const retry = await service.run(lot.id);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([P1, P2, P3]);
    expect(retry.scan).toMatchObject({ stopReason: 'no_results' });
    expect(retry.matches).toHaveLength(19);
  });

  it('records stored by other paths (e.g. VIN history) do not stop a scan early', async () => {
    const service = await setup();
    const p1 = parseBidfaxListing(await mockBidfaxFetcher(P1), {
      makeSlug: 'toyota',
      modelSlug: 'camry',
      makeName: 'Toyota',
      modelName: 'Camry',
    });
    await createAuctionRecordsRepository(database.db).upsertMany(p1.records.slice(0, 1));

    const res = await service.run(lot.id);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([MAKE, P1, P2, P3]);
    expect(res.scan).toMatchObject({ stopReason: 'no_results', pagesScanned: 3 });
  });

  it("does not reuse another trim's match-limited scan when this lot still lacks matches", async () => {
    const service = await setup();
    await createSettingsRepository(database.db).update({ bidfax: { maxMatches: 3 } });
    const lots = createLotsRepository(database.db);
    await lots.upsertMany([{ ...lot, trim: 'SE' }, { ...lot, id: 'iaai:le', lotNumber: 'le', trim: 'LE' }]);

    const se = await service.run(lot.id);
    expect(se.scan).toMatchObject({ pagesScanned: 1, stopReason: 'max_matches' });
    expect(se.matches).toHaveLength(3);

    // page 1 has only two LE sales: continue past the covered page instead of reusing the scan
    fetcher.mockClear();
    const le = await service.run('iaai:le');
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([P1, P2]);
    expect(le.scan).toMatchObject({ pagesScanned: 2, stopReason: 'max_matches', newRecords: 10 });
    expect(le.matches).toHaveLength(3);
    expect(le.matches.every((m) => m.record.trim === 'Le')).toBe(true);

    // SE already has enough → the fresh scan is reused
    fetcher.mockClear();
    await service.run(lot.id);
    expect(fetcher).not.toHaveBeenCalled();
  });


  it('reports not_found for a model bidfax does not list', async () => {
    const service = await setup();
    await createLotsRepository(database.db).upsertMany([{ ...lot, model: 'NOT A MODEL' }]);
    const res = await service.run(lot.id);
    expect(res.error?.code).toBe('not_found');
    expect(res.matches).toEqual([]);
  });

  it('persists include/exclude choices', async () => {
    const service = await setup();
    const res = await service.run(lot.id);
    const id = res.matches[0]!.record.id;
    expect(await service.setIncluded(lot.id, id, false)).toEqual([id]);
    expect((await service.get(lot.id)).excludedIds).toEqual([id]);
    expect(await service.setIncluded(lot.id, id, true)).toEqual([]);
  });
});

describe('/api/lots/:id/estimate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    app = await buildApp({ mockSources: true });
    await app.inject({ method: 'GET', url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020' });
  });
  afterEach(async () => app.close());

  it('GET returns stored data only, POST scans, PUT toggles selection', async () => {
    const url = `/api/lots/${encodeURIComponent('iaai:45973338')}/estimate`;
    const before = await app.inject({ method: 'GET', url });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({ matches: [], scan: null });

    const run = await app.inject({ method: 'POST', url, payload: {} });
    expect(run.statusCode).toBe(200);
    const matches = run.json().matches as { record: { id: string; trim: string } }[];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.record.trim.toLowerCase() === 'se')).toBe(true);

    const toggle = await app.inject({
      method: 'PUT',
      url: `${url}/selection`,
      payload: { recordId: matches[0]!.record.id, included: false },
    });
    expect(toggle.json()).toEqual({ excludedIds: [matches[0]!.record.id] });
    expect((await app.inject({ method: 'GET', url })).json().excludedIds).toEqual([matches[0]!.record.id]);
  });

  it('404s for unknown lots and 400s for bad bodies', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/lots/copart%3Anope/estimate', payload: {} })).statusCode).toBe(404);
    const url = `/api/lots/${encodeURIComponent('iaai:45973338')}/estimate/selection`;
    expect((await app.inject({ method: 'PUT', url, payload: { included: 'no' } })).statusCode).toBe(400);
  });
});
