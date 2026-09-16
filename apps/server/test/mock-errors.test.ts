import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

/** The error paths the mock sources simulate for E2E (see MOCK_ERROR_MODEL / MOCK_ERROR_YEAR). */
describe('mock sources: error paths', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const LOT_2018 = encodeURIComponent('iaai:45874574'); // 2018 Camry SE

  beforeEach(async () => {
    app = await buildApp({ mockSources: true });
  });
  afterEach(async () => app.close());

  it('Toyota Corolla search: Copart blocked, IAAI markup not recognized, no lots', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/lots/search?make=Toyota&model=Corolla&yearFrom=2018&yearTo=2020',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lots: [],
      sources: [
        { source: 'copart', ok: false, error: { code: 'blocked' } },
        { source: 'iaai', ok: false, error: { code: 'parse_failed' } },
      ],
    });
  });

  it('2018 Camry: bidfax blocked, mobile.bg not recognized while cars.bg still answers', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020',
    });

    const estimate = await app.inject({
      method: 'POST',
      url: `/api/lots/${LOT_2018}/estimate`,
      payload: {},
    });
    expect(estimate.json()).toMatchObject({ matches: [], error: { code: 'blocked' } });

    const market = (
      await app.inject({ method: 'POST', url: `/api/lots/${LOT_2018}/market`, payload: {} })
    ).json();
    const site = (name: string) => market.sites.find((s: { site: string }) => s.site === name);
    expect(site('mobileBg')).toMatchObject({ checkedAt: null, error: { code: 'parse_failed' } });
    expect(site('carsBg')).toMatchObject({ found: 0, checkedAt: expect.any(String) });
    expect(site('carsBg').error).toBeUndefined();
  });
});
