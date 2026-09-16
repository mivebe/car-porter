import { z } from 'zod';

export const MARKET_SOURCES = ['mobileBg', 'carsBg', 'autoscout24', 'olxBg'] as const;
export type MarketSource = (typeof MARKET_SOURCES)[number];

const nonNegative = z.number().finite().nonnegative();

export const settingsSchema = z.object({
  cost: z.object({
    /** Percentages applied to the bid (displayed as separate parts, e.g. 10% + 20% + 10%). */
    bidPercentages: z.array(nonNegative).min(1),
    /** "Reduced" toggle divides the summed percentage by this. */
    reducedDivisor: z.number().finite().positive(),
    shippingUsaRotterdamUsd: nonNegative,
    rotterdamSofiaEur: nonNegative,
    sofiaToBgEur: nonNegative,
  }),
  verdict: z.object({
    worthThresholdEur: nonNegative,
  }),
  bidfax: z.object({
    maxMonths: z.number().int().positive(),
    maxMatches: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }),
  market: z.object({
    mileageRangeKm: nonNegative,
    enabledSources: z.record(z.enum(MARKET_SOURCES), z.boolean()),
  }),
  fx: z.object({
    /** Manual USD→EUR rate; null means use the live ECB rate. */
    usdToEurOverride: z.number().finite().positive().nullable(),
  }),
  scraping: z
    .object({
      minDelayMs: z.number().int().nonnegative(),
      maxDelayMs: z.number().int().nonnegative(),
    })
    .refine((s) => s.maxDelayMs >= s.minDelayMs, { message: 'maxDelayMs must be >= minDelayMs' }),
  ui: z.object({
    language: z.enum(['en', 'bg']),
    theme: z.enum(['dark', 'light']),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  cost: {
    bidPercentages: [10, 20, 10],
    reducedDivisor: 3,
    shippingUsaRotterdamUsd: 2500,
    rotterdamSofiaEur: 1000,
    sofiaToBgEur: 250,
  },
  verdict: { worthThresholdEur: 3000 },
  bidfax: { maxMonths: 12, maxMatches: 20, maxPages: 20 },
  market: {
    mileageRangeKm: 30_000,
    enabledSources: { mobileBg: true, carsBg: true, autoscout24: false, olxBg: false },
  },
  fx: { usdToEurOverride: null },
  scraping: { minDelayMs: 1500, maxDelayMs: 4000 },
  ui: { language: 'en', theme: 'dark' },
};

type DeepPartial<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type SettingsPatch = DeepPartial<Settings>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges `patch` onto `base`. Arrays and primitives are replaced, not merged. */
export function mergeSettings(base: Settings, patch: unknown): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? a : b;
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = merge(a[key], value);
    return out;
  };
  return merge(base, patch) as Settings;
}

/**
 * Resolves stored settings against defaults: unknown/invalid stored data falls back to defaults
 * so newly added settings always get a value.
 */
export function resolveSettings(stored: unknown): Settings {
  const merged = mergeSettings(DEFAULT_SETTINGS, isPlainObject(stored) ? stored : {});
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
