import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError } from '../scraping/errors.ts';

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const TTL_MS = 12 * 60 * 60 * 1000;

export type TextFetcher = (url: string) => Promise<string>;

export interface EcbRate {
  /** ECB reference date, YYYY-MM-DD. */
  date: string;
  /** 1 EUR = eurToUsd USD, as published. */
  eurToUsd: number;
}

export function parseEcbDaily(xml: string): EcbRate {
  const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rate = xml.match(/<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1];
  const eurToUsd = Number(rate);
  if (!date || !rate || !Number.isFinite(eurToUsd) || eurToUsd <= 0) {
    throw new SourceError('parse_failed', 'ecb: USD rate not found');
  }
  return { date, eurToUsd };
}

export const httpTextFetcher: TextFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new SourceError('network', `HTTP ${res.status} for ${url}`);
  return res.text();
};

export interface FxResponse {
  /** Rate used by calculations. */
  usdToEur: number;
  source: 'ecb' | 'override';
  ecb: { usdToEur: number; date: string; fetchedAt: string; stale: boolean } | null;
  error?: { code: string; message: string };
}

export function createFxService(deps: { cache: CacheRepository; settings: SettingsRepository; fetchText: TextFetcher }) {
  async function get(force = false): Promise<FxResponse> {
    const result = await cached(deps.cache, { key: 'ecb:daily', source: 'ecb', ttlMs: TTL_MS, force }, async () =>
      parseEcbDaily(await deps.fetchText(ECB_DAILY_URL)),
    );
    const override = (await deps.settings.get()).fx.usdToEurOverride;

    const ecb = result.ok
      ? {
          usdToEur: 1 / result.data.eurToUsd,
          date: result.data.date,
          fetchedAt: result.fetchedAt.toISOString(),
          stale: result.stale,
        }
      : null;
    const error = result.error;

    if (override != null) return { usdToEur: override, source: 'override', ecb, ...(error ? { error } : {}) };
    if (!ecb) throw new SourceError(error!.code, `No USD→EUR rate available: ${error!.message}`);
    return { usdToEur: ecb.usdToEur, source: 'ecb', ecb, ...(error ? { error } : {}) };
  }

  return { get };
}

export type FxService = ReturnType<typeof createFxService>;
