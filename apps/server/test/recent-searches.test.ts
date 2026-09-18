import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { RECENT_SEARCHES_LIMIT } from '../src/repositories/recent-searches-repository.ts';

describe('/api/searches/recent', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  afterEach(async () => app.close());

  const search = (query: string) => app.inject({ method: 'GET', url: `/api/lots/search?${query}` });
  const list = async () => (await app.inject({ method: 'GET', url: '/api/searches/recent' })).json().items;
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('records page-1 searches newest first, merging repeats', async () => {
    app = await buildApp({ mockSources: true });
    await search('make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await tick();
    await search('make=Toyota&model=RAV4&yearFrom=2019&yearTo=2019&iaaiMarkets=ca,us&transmission=automatic&engine=2');
    await tick();
    await search('make=toyota&model=camry&yearFrom=2018&yearTo=2020');
    await search('make=Toyota&model=Corolla&yearFrom=2018&yearTo=2020&page=2');

    const items = await list();
    expect(items.map((s: { filters: { model: string } }) => s.filters.model)).toEqual(['camry', 'RAV4']);
    expect(items[1]).toMatchObject({
      filters: { yearFrom: 2019, yearTo: 2019, iaaiMarkets: ['ca', 'us'], transmission: 'automatic', engine: '2.0' },
      searchedAt: expect.any(String),
    });
  });

  it('keeps only the newest searches', async () => {
    app = await buildApp({ mockSources: true });
    for (let year = 2000; year <= 2000 + RECENT_SEARCHES_LIMIT; year++) {
      await search(`make=Toyota&model=Camry&yearFrom=${year}&yearTo=${year}`);
      await tick();
    }
    const items = await list();
    expect(items).toHaveLength(RECENT_SEARCHES_LIMIT);
    expect(items.at(-1).filters.yearFrom).toBe(2001);
  });

  it('removes one search or all of them', async () => {
    app = await buildApp({ mockSources: true });
    await search('make=Toyota&model=Camry&yearFrom=2018&yearTo=2020');
    await tick();
    await search('make=Toyota&model=RAV4&yearFrom=2019&yearTo=2019');
    const [rav4] = await list();
    const del = await app.inject({ method: 'DELETE', url: `/api/searches/recent/${encodeURIComponent(rav4.key)}` });
    expect(del.statusCode).toBe(204);
    expect((await list()).map((s: { filters: { model: string } }) => s.filters.model)).toEqual(['Camry']);
    expect((await app.inject({ method: 'DELETE', url: '/api/searches/recent' })).statusCode).toBe(204);
    expect(await list()).toEqual([]);
  });
});
