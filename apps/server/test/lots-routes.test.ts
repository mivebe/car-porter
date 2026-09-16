import type { LotSearchFilters } from '@car-porter/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';
import type { AuctionSearchAdapter } from '../src/sources/auction-adapter.ts';
import { createMockAuctionAdapters } from '../src/sources/mock-fetchers.ts';

const url = (q: Record<string, string | number>) =>
  `/api/lots/search?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`;
const camry = { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020 };

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
    app = await buildApp({ overrides: { auctionAdapters: [copart!, iaai!] } });

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
      source: 'copart',
      search: async () => {
        throw new SourceError('blocked', 'copart: blocked by incapsula');
      },
    };
    app = await buildApp({ overrides: { auctionAdapters: [broken, iaai!] } });
    const res = await app.inject({ method: 'GET', url: url(camry) });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources[0]).toEqual({
      source: 'copart',
      ok: false,
      error: { code: 'blocked', message: 'copart: blocked by incapsula' },
    });
    expect(res.json().lots.every((l: { source: string }) => l.source === 'iaai')).toBe(true);
  });

  it('passes filters through and stores lots for later lookup', async () => {
    const seen: LotSearchFilters[] = [];
    const [copart] = createMockAuctionAdapters();
    const recording: AuctionSearchAdapter = {
      source: 'copart',
      search: (f, p) => {
        seen.push(f);
        return copart!.search(f, p);
      },
    };
    app = await buildApp({ overrides: { auctionAdapters: [recording] } });
    const res = await app.inject({ method: 'GET', url: url({ ...camry, yearFrom: 2019, yearTo: 2019 }) });
    expect(seen).toEqual([{ make: 'Toyota', model: 'Camry', yearFrom: 2019, yearTo: 2019 }]);
    const lots = res.json().lots as { id: string; year: number }[];
    expect(lots.length).toBeGreaterThan(0);
    expect(lots.every((l) => l.year === 2019)).toBe(true);

    const lookup = await app.inject({ method: 'GET', url: `/api/lots/${encodeURIComponent(lots[0]!.id)}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().lot.id).toBe(lots[0]!.id);
    expect((await app.inject({ method: 'GET', url: '/api/lots/copart:nope' })).statusCode).toBe(404);
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
