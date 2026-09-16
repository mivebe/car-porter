import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, resolveSettings, settingsSchema } from './settings.ts';

describe('settings', () => {
  it('defaults are valid and match the agreed values', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.cost).toEqual({
      bidPercentages: [10, 20, 10],
      reducedDivisor: 3,
      shippingUsaRotterdamUsd: 2500,
      rotterdamSofiaEur: 1000,
      sofiaToBgEur: 250,
    });
    expect(DEFAULT_SETTINGS.verdict.worthThresholdEur).toBe(3000);
    expect(DEFAULT_SETTINGS.bidfax).toEqual({ maxMonths: 12, maxMatches: 20, maxPages: 20 });
    expect(DEFAULT_SETTINGS.ui).toEqual({ language: 'en', theme: 'dark' });
  });

  it('merges nested patches without dropping siblings', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { cost: { rotterdamSofiaEur: 1100 } });
    expect(merged.cost.rotterdamSofiaEur).toBe(1100);
    expect(merged.cost.shippingUsaRotterdamUsd).toBe(2500);
    expect(merged.verdict).toEqual(DEFAULT_SETTINGS.verdict);
  });

  it('replaces arrays instead of merging them', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { cost: { bidPercentages: [15] } });
    expect(merged.cost.bidPercentages).toEqual([15]);
  });

  it('fills missing keys from defaults when resolving stored settings', () => {
    const resolved = resolveSettings({ verdict: { worthThresholdEur: 5000 } });
    expect(resolved.verdict.worthThresholdEur).toBe(5000);
    expect(resolved.cost).toEqual(DEFAULT_SETTINGS.cost);
  });

  it('falls back to defaults for invalid stored data', () => {
    expect(resolveSettings({ verdict: { worthThresholdEur: -1 } })).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects scraping delays where max < min', () => {
    const bad = mergeSettings(DEFAULT_SETTINGS, { scraping: { minDelayMs: 5000, maxDelayMs: 1000 } });
    expect(settingsSchema.safeParse(bad).success).toBe(false);
  });
});
