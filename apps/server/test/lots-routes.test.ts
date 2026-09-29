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

    const aliases = await app.inject({ method: 'GET', url: '/api/aliases?kind=model&source=iaai&make=Mercedes-Benz' });
    const rows = aliases.json().items as { externalName: string; auto: { targets: string[]; match: string } }[];
    expect(rows.map((r) => [r.externalName, r.auto.targets, r.auto.match])).toEqual(
      expect.arrayContaining([
        ['C', ['C-Class'], 'exact'],
        ['AMG C 63', ['C-Class'], 'rule'],
        ['CLA', ['CLA-Class'], 'exact'],
      ]),
    );
    const makes = await app.inject({ method: 'GET', url: '/api/aliases?kind=make&source=copart' });
    expect(makes.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ externalName: 'MERCEDES BENZ', auto: { targets: ['Mercedes-Benz'], match: 'exact', nonCarMake: null }, lotCount: 6 }),
      ]),
    );
    expect(spy).toHaveBeenCalledTimes(1); // the C-Class search; G-Class has no site names
  });

  it('narrows by a trim word on the site and keeps only lots with every trim word', async () => {
    const seen: AuctionQuery[] = [];
    const [copart, iaai] = createMockAuctionAdapters();
    const recording = (adapter: AuctionSearchAdapter): AuctionSearchAdapter => ({
      ...adapter,
      search: async (f, p) => {
        seen.push(f);
        const page = await adapter.search(f, p);
        return { ...page, lots: page.lots.map((l, i) => ({ ...l, trim: i === 0 ? 'SE HYBRID' : 'LE' })) };
      },
    });
    app = await withAdapters([recording(copart!), recording(iaai!)]);
    const res = await app.inject({ method: 'GET', url: url({ ...camry, trim: 'Camry SE Hybrid', iaaiMarkets: 'ca,us' }) });
    expect(seen.map((q) => [q.keyword, q.iaaiMarkets])).toEqual([
      ['hybrid', undefined],
      ['hybrid', ['us', 'ca']],
    ]);
    const lots = res.json().lots as { trim: string }[];
    expect(lots.map((l) => l.trim)).toEqual(['SE HYBRID', 'SE HYBRID']);

    // a different trim or market set is a different cache entry; no markets = US only, all = no filter
    await app.inject({ method: 'GET', url: url({ ...camry, trim: 'LE', iaaiMarkets: 'us,ca' }) });
    await app.inject({ method: 'GET', url: url(camry) });
    await app.inject({ method: 'GET', url: url({ ...camry, iaaiMarkets: 'us' }) });
    expect(seen).toHaveLength(6);
    expect(seen.at(-1)?.iaaiMarkets).toEqual(['us']);
    // Copart has no markets, so only IAAI is searched again
    await app.inject({ method: 'GET', url: url({ ...camry, iaaiMarkets: 'rb,us,ca' }) });
    expect(seen).toHaveLength(7);
    expect(seen.at(-1)).not.toHaveProperty('iaaiMarkets');
  });

  it('filters by body style, transmission and engine in each site’s own values', async () => {
    const seen: AuctionQuery[] = [];
    const recording = (adapter: AuctionSearchAdapter): AuctionSearchAdapter => ({
      ...adapter,
      search: (f, p) => {
        seen.push(f);
        return adapter.search(f, p);
      },
    });
    app = await withAdapters(createMockAuctionAdapters().map(recording));
    const res = await app.inject({ method: 'GET', url: url({ ...camry, bodyStyle: 'sedan', transmission: 'automatic', engine: '3.5' }) });
    expect(seen.map(({ bodyStyles, transmission, engines }) => ({ bodyStyles, transmission, engines }))).toEqual([
      { bodyStyles: ['SEDAN'], transmission: 'automatic', engines: ['3.5L  6', '3.5L 6'] },
      { bodyStyles: ['Sedan', 'Sedan 4 Door', 'Sedan 4 Dr.'], transmission: 'automatic', engines: ['3.5 L'] },
    ]);
    const lots = res.json().lots as { engine: string }[];
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.every((l) => l.engine.startsWith('3.5'))).toBe(true);

    // no site value maps to Wagon: the sites are not searched
    const wagons = await app.inject({ method: 'GET', url: url({ ...camry, bodyStyle: 'Wagon' }) });
    expect(wagons.json().sources.map((s: { total: number }) => s.total)).toEqual([0, 0]);
    expect(seen).toHaveLength(2);

    // body names are aliases: moving Copart's SEDAN to Wagon changes what Wagon searches
    await app.inject({
      method: 'PUT',
      url: '/api/aliases/assignment',
      payload: { changes: [{ source: 'copart', kind: 'body', externalName: 'SEDAN', action: 'assign', targets: ['Wagon'] }] },
    });
    await app.inject({ method: 'GET', url: url({ ...camry, bodyStyle: 'Wagon' }) });
    expect(seen.at(-1)?.bodyStyles).toEqual(['SEDAN']);
    const bodies = (await app.inject({ method: 'GET', url: '/api/aliases/canonical?kind=body' })).json().items as { name: string; siteNames: number }[];
    expect(bodies.map((b) => b.name)).toEqual(['Convertible', 'Coupe', 'Hatchback', 'Pickup', 'Sedan', 'SUV', 'Van', 'Wagon']);
    expect(bodies.find((b) => b.name === 'Wagon')?.siteNames).toBe(1);
  });

  it('hands damage, condition and keys to each site, and caches them apart', async () => {
    const seen: AuctionQuery[] = [];
    const [copart] = createMockAuctionAdapters();
    app = await withAdapters([{ ...copart!, search: (f, p) => (seen.push(f), copart!.search(f, p)) }]);
    const all = (await app.inject({ method: 'GET', url: url(camry) })).json().lots.length as number;
    const res = await app.inject({ method: 'GET', url: url({ ...camry, damage: 'side,front', condition: 'runsDrives', keys: 1 }) });
    expect(seen.at(-1)).toMatchObject({ damage: ['front', 'side'], condition: 'runsDrives', keys: true });
    const lots = res.json().lots as { condition: string; keys: boolean }[];
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.length).toBeLessThan(all);
    expect(lots.every((l) => l.condition === 'runsDrives' && l.keys)).toBe(true);
    expect(seen[0]).not.toHaveProperty('keys');
    // keys=0: only lots without keys
    const none = (await app.inject({ method: 'GET', url: url({ ...camry, keys: 0 }) })).json().lots as { keys: boolean }[];
    expect(seen.at(-1)).toMatchObject({ keys: false });
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((l) => l.keys === false)).toBe(true);
  });

  it('searches every year when none are given, and from/to a single open end', async () => {
    const seen: AuctionQuery[] = [];
    const [copart] = createMockAuctionAdapters();
    app = await withAdapters([{ ...copart!, search: (f, p) => (seen.push(f), copart!.search(f, p)) }]);
    const next = new Date().getFullYear() + 1;
    await app.inject({ method: 'GET', url: url({ make: 'Toyota', model: 'Camry' }) });
    await app.inject({ method: 'GET', url: url({ make: 'Toyota', model: 'Camry', yearFrom: 2019 }) });
    await app.inject({ method: 'GET', url: url({ make: 'Toyota', model: 'Camry', yearTo: 2019 }) });
    expect(seen.map((q) => [q.yearFrom, q.yearTo])).toEqual([
      [1900, next],
      [2019, next],
      [1900, 2019],
    ]);
    const recent = (await app.inject({ method: 'GET', url: '/api/searches/recent' })).json().items as { filters: object }[];
    expect(recent.at(-1)?.filters).toEqual({ make: 'Toyota', model: 'Camry', iaaiMarkets: ['us'] });
  });

  it('searches every make without a make, and every model of a make without a model', async () => {
    const seen: AuctionQuery[] = [];
    const [copart] = createMockAuctionAdapters();
    app = await withAdapters([{ ...copart!, search: (f, p) => (seen.push(f), copart!.search(f, p)) }]);
    const all = await app.inject({ method: 'GET', url: url({ yearFrom: 2019, damage: 'front' }) });
    expect(all.statusCode).toBe(200);
    expect(seen.at(-1)).toMatchObject({ makes: [], models: [], yearFrom: 2019, damage: ['front'] });
    expect(all.json().sources[0]).toMatchObject({ ok: true, matched: { makes: [], models: [] } });

    await app.inject({ method: 'GET', url: url({ make: 'Toyota' }) });
    expect(seen.at(-1)).toMatchObject({ makes: ['TOYOTA', 'TOYO'], models: [] });

    // a make the site doesn't list finds nothing rather than every car
    const unknown = await app.inject({ method: 'GET', url: url({ make: 'Nosuchmake' }) });
    expect(unknown.json().sources[0]).toMatchObject({ ok: true, total: 0 });
    expect(seen).toHaveLength(2);

    const recent = (await app.inject({ method: 'GET', url: '/api/searches/recent' })).json().items as { filters: object }[];
    expect(recent.map((r) => r.filters)).toContainEqual({ yearFrom: 2019, iaaiMarkets: ['us'], damage: ['front'] });
  });

  it('validates the query', async () => {
    app = await buildApp({ mockSources: true });
    const bad = [
      { model: 'Camry', yearFrom: 2018, yearTo: 2020 },
      { ...camry, yearFrom: 2021, yearTo: 2020 },
      { ...camry, yearTo: 2999 },
      { ...camry, page: 0 },
      { ...camry, yearFrom: 'abc' },
      { ...camry, iaaiMarkets: 'us,mx' },
      { ...camry, trim: 'x'.repeat(41) },
      { ...camry, transmission: 'cvt' },
      { ...camry, engine: '6.2L' },
      { ...camry, engine: '123' },
      { ...camry, damage: 'front,dents' },
      { ...camry, condition: 'stationary' },
      { ...camry, keys: 'true' },
    ];
    for (const q of bad) {
      expect((await app.inject({ method: 'GET', url: url(q) })).statusCode, JSON.stringify(q)).toBe(400);
    }
  });
});
