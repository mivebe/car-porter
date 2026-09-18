import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const SE_2019 = 'iaai:45637680';
const LE_2020 = 'copart:65095026';
const enc = encodeURIComponent;

describe('POST /api/lots/insights', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  afterEach(async () => app.close());

  async function setup() {
    app = await buildApp({ mockSources: true });
    await app.inject({
      method: 'GET',
      url: '/api/lots/search?make=Toyota&model=Camry&yearFrom=2018&yearTo=2020',
    });
  }
  const insights = async (lotIds: string[]) =>
    app.inject({ method: 'POST', url: '/api/lots/insights', payload: { lotIds } });

  it('returns stored insights for known lots, skipping unknown ids', async () => {
    await setup();
    const before = (await insights([SE_2019, 'copart:1', LE_2020])).json();
    expect(before.items.map((i: { lotId: string }) => i.lotId)).toEqual([SE_2019, LE_2020]);
    expect(before.items[0]).toMatchObject({ historyCount: null, estimate: null, market: null });

    await app.inject({ method: 'POST', url: `/api/lots/${enc(SE_2019)}/estimate`, payload: {} });
    await app.inject({ method: 'POST', url: `/api/lots/${enc(SE_2019)}/history`, payload: {} });
    const history = (
      await app.inject({ method: 'GET', url: `/api/lots/${enc(SE_2019)}/history` })
    ).json();

    const [se] = (await insights([SE_2019])).json().items;
    expect(se.estimate).toMatchObject({ count: 13 });
    expect(se.historyCount).toBe(history.entries.length);
    expect(se.evaluation).toMatchObject({
      bidSource: 'estimate',
      cost: { totalEurCents: 992_392 },
    });
  });

  it('rejects a malformed body', async () => {
    await setup();
    expect((await insights('x' as unknown as string[])).statusCode).toBe(400);
  });
});
