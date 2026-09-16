import { DEFAULT_LOT_INPUTS } from '@car-porter/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

describe('/api/lots/:id/inputs', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const url = '/api/lots/copart%3A123/inputs';

  beforeEach(async () => {
    app = await buildApp({ mockSources: true });
  });
  afterEach(async () => app.close());

  it('returns defaults for a lot without inputs', async () => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_LOT_INPUTS);
  });

  it('patches and persists values, normalizing the VIN', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url,
      payload: { vinOverride: ' 1hgcm82633a004352 ', repairEstimateEurCents: 150_000, feesReduced: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...DEFAULT_LOT_INPUTS,
      vinOverride: '1HGCM82633A004352',
      repairEstimateEurCents: 150_000,
      feesReduced: true,
    });

    await app.inject({ method: 'PATCH', url, payload: { bidOverrideUsdCents: 500_000, includeSofiaToBg: false } });
    const after = (await app.inject({ method: 'GET', url })).json();
    expect(after).toMatchObject({
      vinOverride: '1HGCM82633A004352',
      bidOverrideUsdCents: 500_000,
      includeSofiaToBg: false,
      feesReduced: true,
    });

    // clearing
    await app.inject({ method: 'PATCH', url, payload: { vinOverride: '', bidOverrideUsdCents: null } });
    expect((await app.inject({ method: 'GET', url })).json()).toMatchObject({ vinOverride: null, bidOverrideUsdCents: null });
  });

  it('keeps inputs separate per lot', async () => {
    await app.inject({ method: 'PATCH', url, payload: { repairEstimateEurCents: 1 } });
    const other = (await app.inject({ method: 'GET', url: '/api/lots/iaai%3A9/inputs' })).json();
    expect(other.repairEstimateEurCents).toBe(0);
  });

  it('rejects invalid values', async () => {
    for (const payload of [
      { repairEstimateEurCents: -1 },
      { bidOverrideUsdCents: 1.5 },
      { feesReduced: 'yes' },
      { vinOverride: 'X'.repeat(18) },
    ]) {
      expect((await app.inject({ method: 'PATCH', url, payload })).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});
