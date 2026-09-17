import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';
import type { AuctionQuery, AuctionSearchAdapter } from '../src/sources/auction-adapter.ts';
import { createMockAuctionAdapters, mockNhtsaFetcher } from '../src/sources/mock-fetchers.ts';

const url = (q: Record<string, string | number>) =>
  `/api/lots/search?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;
const camry = { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020 };
const withAdapters = (auctionAdapters: AuctionSearchAdapter[]) =>
  buildApp({ overrides: { auctionAdapters, nhtsaFetcher: mockNhtsaFetcher } });

describe('/api/lots/search', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  it('merges both sources with per-source totals (fixture adapters)', async () => {
    app = await buildApp({ mockSources: true });
    const res = await app.inject({ method: 'GET', url: url(camry) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page).toBe(1);
    expect(body.sources).toEqual([
      expect.objectContaining({ source: 'copart', ok: true, total: 1661, count: 25, hasMore: true, fromCache: false }),
      expect.objectContaining({ source: 'iaai', ok: true, total: 1362, count: 30, hasMore: true, fromCache: false }),
    ]);
    expect(body.lots).toHaveLength(55);
    expect(new Set(body.lots.map((l: { source: string }) => l.source))).toEqual(new Set(['copart', 'iaai']));
  });

  it('caches per source/filters/page and bypasses the cache on refresh', async () => {
    const [copart, iaai] = createMockAuctionAdapters();
    const spy = vi.spyOn(copart!, 'search');
    app = await withAdapters([copart!, iaai!]);

    await app.inject({ method: 'GET', url: url(camry) });
    const second = await app.inject({ method: 'GET', url: url({ ...camry, make: 'TOYOTA ' }) });
    expect(second.json().sources[0]).toMatchObject({ fromCache: true });
    expect(spy).toHaveBeenCalledTimes(1);

    await app.inject({ method: 'GET', url: url({ ...camry, refresh: 1 }) });
    expect(spy).toHaveBeenCalledTimes(2);

    await app.inject({ method: 'GET', url: url({ ...camry, page: 2 }) });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('reports a failing source without failing the whole search', async () => {
    const [, iaai] = createMockAuctionAdapters();
    const broken: AuctionSearchAdapter = {
      ...createMockAuctionAdapters()[0]!,
      search: async () => {
        throw new SourceError('blocked', 'copart: blocked by incapsula');
      },
    };
    app = await withAdapters([broken, iaai!]);
    const res = await app.inject({ method: 'GET', url: url(camry) });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources[0]).toEqual({
      source: 'copart',
      ok: false,
      error: { code: 'blocked', message: 'copart: blocked by incapsula' },
    });
    expect(res.json().lots.every((l: { source: string }) => l.source === 'iaai')).toBe(true);
  });

  it('searches with every site spelling of the canonical names and stores lots for later lookup', async () => {
    const seen: AuctionQuery[] = [];
    const [copart] = createMockAuctionAdapters();
    const recording: AuctionSearchAdapter = {
      ...copart!,
      search: (f, p) => {
        seen.push(f);
        return copart!.search(f, p);
      },
    };
    app = await withAdapters([recording]);
    const res = await app.inject({ method: 'GET', url: url({ ...camry, yearFrom: 2019, yearTo: 2019 }) });
    expect(seen).toEqual([{ makes: ['TOYOTA', 'TOYO'], models: ['CAMRY', 'CAMARY'], yearFrom: 2019, yearTo: 2019 }]);
    expect(res.json().sources[0].matched).toEqual({ makes: ['TOYOTA', 'TOYO'], models: ['CAMRY', 'CAMARY'] });
    const lots = res.json().lots as { id: string; year: number }[];
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.every((l) => l.year === 2019)).toBe(true);

    const lookup = await app.inject({ method: 'GET', url: `/api/lots/${encodeURIComponent(lots[0]!.id)}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().lot.id).toBe(lots[0]!.id);
    expect((await app.inject({ method: 'GET', url: '/api/lots/copart:nope' })).statusCode).toBe(404);
  });

  it('records the conversion table per site and skips the search when a site has no such model', async () => {
    const [copart, iaai] = createMockAuctionAdapters();
    const spy = vi.spyOn(copart!, 'search');
    app = await withAdapters([copart!, iaai!]);
    const res = await app.inject({ method: 'GET', url: url({ make: 'Mercedes-Benz', model: 'C-Class', yearFrom: 2017, yearTo: 2017 }) });
    expect(res.json().sources[0]).toMatchObject({
      ok: true,
      total: 0,
      matched: { makes: ['MERCEDES-BENZ', 'MERCEDES BENZ'], models: ['C', 'AMG C 63'] },
    });

    const none = await app.inject({ method: 'GET', url: url({ make: 'Mercedes-Benz', model: 'G-Class', yearFrom: 2017, yearTo: 2017 }) });
    expect(none.json().sources[0]).toMatchObject({ ok: true, total: 0, matched: { models: [] } });

    const aliases = await app.inject({ method: 'GET', url: '/api/catalog/aliases?source=iaai&make=Mercedes-Benz' });
    const rows = aliases.json().items as { kind: string; externalName: string; canonical: string; match: string }[];
    expect(rows.filter((r) => r.kind === 'model').map((r) => [r.externalName, r.canonical, r.match])).toEqual(
      expect.arrayContaining([
        ['C', 'C-Class', 'exact'],
        ['AMG C 63', 'C-Class', 'rule'],
        ['CLA', 'CLA-Class', 'exact'],
      ]),
    );
    const makes = await app.inject({ method: 'GET', url: '/api/catalog/aliases?source=copart&kind=make' });
    expect(makes.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ externalName: 'MERCEDES BENZ', canonicalMake: 'Mercedes-Benz', lotCount: 6 })]),
    );
    expect(spy).toHaveBeenCalledTimes(1); // the C-Class search; G-Class has no site names
  });

  it('validates the query', async () => {
    app = await buildApp({ mockSources: true });
    const bad = [
      { model: 'Camry', yearFrom: 2018, yearTo: 2020 },
      { ...camry, yearFrom: 2021, yearTo: 2020 },
      { ...camry, yearTo: 2999 },
      { ...camry, page: 0 },
      { ...camry, yearFrom: 'abc' },
    ];
    for (const q of bad) {
      expect((await app.inject({ method: 'GET', url: url(q) })).statusCode, JSON.stringify(q)).toBe(400);
    }
  });
});
