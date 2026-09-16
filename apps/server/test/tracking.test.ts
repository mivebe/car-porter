import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';

const SE_2019 = 'iaai:45637680';
const LE_2020 = 'copart:65095026';
const enc = encodeURIComponent;

describe('/api/tracked', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  async function setup(options: AppOptions = {}) {
    app = await buildApp({ mockSources: true, ...options });
    // searching stores the lots
    const search = await app.inject({
      method: 'GET',
      url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020',
    });
    expect(search.statusCode).toBe(200);
  }
  afterEach(async () => app.close());

  const list = async () => (await app.inject({ method: 'GET', url: '/api/tracked' })).json();

  it('tracks lots newest first, idempotently, and untracks them', async () => {
    await setup();
    expect(await list()).toEqual({ lots: [], usdToEur: null });

    const first = await app.inject({ method: 'PUT', url: `/api/tracked/${enc(LE_2020)}` });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ lotId: LE_2020, trackedAt: expect.any(String) });
    await new Promise((r) => setTimeout(r, 5));
    await app.inject({ method: 'PUT', url: `/api/tracked/${enc(SE_2019)}` });
    const again = await app.inject({ method: 'PUT', url: `/api/tracked/${enc(LE_2020)}` });
    expect(again.json().trackedAt).toBe(first.json().trackedAt);

    expect((await list()).lots.map((r: { lot: { id: string } }) => r.lot.id)).toEqual([
      SE_2019,
      LE_2020,
    ]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/lots/${enc(LE_2020)}` })).json().trackedAt,
    ).toBe(first.json().trackedAt);

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/tracked/${enc(LE_2020)}` })).statusCode,
    ).toBe(204);
    expect((await list()).lots.map((r: { lot: { id: string } }) => r.lot.id)).toEqual([SE_2019]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/lots/${enc(LE_2020)}` })).json().trackedAt,
    ).toBeNull();
  });

  it('returns 404 for a lot that was never loaded', async () => {
    await setup();
    const res = await app.inject({ method: 'PUT', url: `/api/tracked/${enc('copart:1')}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'lot_not_found' });
  });

  it('recomputes estimate, landed cost, market average and verdict from stored data and inputs', async () => {
    await setup();
    await app.inject({ method: 'PUT', url: `/api/tracked/${enc(SE_2019)}` });
    await app.inject({ method: 'PUT', url: `/api/tracked/${enc(LE_2020)}` });

    await app.inject({ method: 'POST', url: `/api/lots/${enc(SE_2019)}/estimate`, payload: {} });
    await app.inject({ method: 'POST', url: `/api/lots/${enc(SE_2019)}/market`, payload: {} });

    const rows = (await list()).lots;
    const se = rows.find((r: { lot: { id: string } }) => r.lot.id === SE_2019);
    expect(se.estimate).toMatchObject({ count: 13 });
    expect(se.market).toMatchObject({ count: 7, average: 1_793_571 });
    expect(se.evaluation).toMatchObject({
      bidSource: 'estimate',
      bidUsdCents: se.estimate.average,
      cost: { totalEurCents: 992_392 },
      verdict: { status: 'worth', marginEurCents: 801_179, missing: [] },
    });

    const le = rows.find((r: { lot: { id: string } }) => r.lot.id === LE_2020);
    expect(le.evaluation.verdict).toEqual({
      status: 'insufficient',
      marginEurCents: null,
      missing: ['bid', 'marketAverage'],
    });

    // inputs and settings apply on the next read
    await app.inject({
      method: 'PATCH',
      url: `/api/lots/${enc(SE_2019)}/inputs`,
      payload: { repairEstimateEurCents: 600_000 },
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { verdict: { worthThresholdEur: 1000 } },
    });
    const updated = (await list()).lots.find((r: { lot: { id: string } }) => r.lot.id === SE_2019);
    expect(updated.evaluation.verdict).toMatchObject({ status: 'worth', marginEurCents: 201_179 });
  });

  it('reports a missing exchange rate instead of failing the list', async () => {
    await setup({
      overrides: {
        ecbFetcher: async () => {
          throw new SourceError('network', 'offline');
        },
      },
    });
    await app.inject({ method: 'PUT', url: `/api/tracked/${enc(SE_2019)}` });
    await app.inject({
      method: 'PATCH',
      url: `/api/lots/${enc(SE_2019)}/inputs`,
      payload: { bidOverrideUsdCents: 500_000 },
    });

    const response = await list();
    expect(response.usdToEur).toBeNull();
    expect(response.lots[0].evaluation).toMatchObject({
      cost: null,
      verdict: { status: 'insufficient', missing: ['fx', 'marketAverage'] },
    });
  });
});
