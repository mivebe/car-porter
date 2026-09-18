import { DEFAULT_SETTINGS } from '@car-porter/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

describe('/api/settings', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET returns defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_SETTINGS);
  });

  it('PATCH merges and persists', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { verdict: { worthThresholdEur: 2500 }, ui: { language: 'bg' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict.worthThresholdEur).toBe(2500);

    const after = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(after.json().ui).toEqual({ language: 'bg', theme: 'dark', palette: 'champagne', lotColumns: [] });
    expect(after.json().cost).toEqual(DEFAULT_SETTINGS.cost);
  });

  it('concurrent PATCHes of different keys are all kept', async () => {
    await Promise.all([
      app.inject({ method: 'PATCH', url: '/api/settings', payload: { ui: { theme: 'light' } } }),
      app.inject({ method: 'PATCH', url: '/api/settings', payload: { ui: { language: 'bg' } } }),
      app.inject({ method: 'PATCH', url: '/api/settings', payload: { verdict: { worthThresholdEur: 1 } } }),
    ]);
    const after = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(after.ui).toEqual({ language: 'bg', theme: 'light', palette: 'champagne', lotColumns: [] });
    expect(after.verdict.worthThresholdEur).toBe(1);
  });

  it('PATCH replaces the lot columns list', async () => {
    const patch = (lotColumns: unknown) =>
      app.inject({ method: 'PATCH', url: '/api/settings', payload: { ui: { lotColumns } } });
    await patch([
      { id: 'price', visible: true },
      { id: 'odometer', visible: false },
    ]);
    const res = await patch([{ id: 'odometer', visible: true }]);
    expect(res.json().ui.lotColumns).toEqual([{ id: 'odometer', visible: true }]);
    expect((await patch([{ id: 'odometer' }])).statusCode).toBe(400);
  });

  it('PATCH with invalid values returns 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { ui: { theme: 'purple' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_settings');
  });
});
