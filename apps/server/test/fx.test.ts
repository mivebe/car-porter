import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { parseEcbDaily } from '../src/sources/ecb.ts';
import { mockEcbFetcher } from '../src/sources/mock-fetchers.ts';

const xml = readFileSync(new URL('./fixtures/ecb/eurofxref-daily.xml', import.meta.url), 'utf8');

describe('parseEcbDaily', () => {
  it('reads the USD rate and date from the real feed', () => {
    expect(parseEcbDaily(xml)).toEqual({ date: '2026-09-15', eurToUsd: 1.1539 });
  });

  it('fails with parse_failed when USD is missing', () => {
    expect(() => parseEcbDaily('<Cube time="2026-01-01"></Cube>')).toThrow(
      expect.objectContaining({ code: 'parse_failed' }),
    );
  });
});

describe('/api/fx', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  it('returns the inverted ECB rate and caches the feed', async () => {
    const fetcher = vi.fn(mockEcbFetcher);
    app = await buildApp({ overrides: { ecbFetcher: fetcher } });
    const res = await app.inject({ method: 'GET', url: '/api/fx' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('ecb');
    expect(body.usdToEur).toBeCloseTo(1 / 1.1539, 10);
    expect(body.ecb).toMatchObject({ date: '2026-09-15', stale: false });

    await app.inject({ method: 'GET', url: '/api/fx' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await app.inject({ method: 'GET', url: '/api/fx?refresh=1' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the manual override from settings but still reports the ECB rate', async () => {
    app = await buildApp({ overrides: { ecbFetcher: mockEcbFetcher } });
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { fx: { usdToEurOverride: 0.9 } } });
    const body = (await app.inject({ method: 'GET', url: '/api/fx' })).json();
    expect(body).toMatchObject({ usdToEur: 0.9, source: 'override', ecb: { date: '2026-09-15' } });
  });

  it('works with an override even when ECB is unreachable', async () => {
    app = await buildApp({
      overrides: {
        ecbFetcher: async () => {
          throw new SourceError('network', 'offline');
        },
      },
    });
    expect((await app.inject({ method: 'GET', url: '/api/fx' })).statusCode).toBe(502);
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { fx: { usdToEurOverride: 0.88 } } });
    const res = await app.inject({ method: 'GET', url: '/api/fx' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ usdToEur: 0.88, source: 'override', ecb: null, error: { code: 'network' } });
  });
});
