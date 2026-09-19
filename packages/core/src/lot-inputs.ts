import { z } from 'zod';
import { MARKET_SOURCES, MARKET_YEAR_SPANS } from './settings.ts';
import { normalizeVin } from './vin.ts';

const cents = z.number().int().nonnegative().max(1_000_000_000);

/** User inputs kept per lot (tracked or not). */
export const lotInputsSchema = z.object({
  /** VIN read from the photos; stored normalized, may be partial while typing. */
  vinOverride: z
    .string()
    .transform(normalizeVin)
    .pipe(z.string().max(17))
    .nullable(),
  bidOverrideUsdCents: cents.nullable(),
  repairEstimateEurCents: cents,
  feesReduced: z.boolean(),
  includeSofiaToBg: z.boolean(),
  /** Optional BG market match criteria (make/model/year/trim always apply). */
  marketMatch: z.object({
    mileage: z.boolean(),
    transmission: z.boolean(),
    fuel: z.boolean(),
    /** Years either side of the lot's year that are searched and matched (0 = exact year). */
    yearSpan: z.literal(MARKET_YEAR_SPANS).default(0),
  }),
  /** Marketplaces used for this lot; null = the defaults from settings. */
  marketSources: z.record(z.enum(MARKET_SOURCES), z.boolean()).nullable(),
});

export type LotInputs = z.infer<typeof lotInputsSchema>;

export const lotInputsPatchSchema = lotInputsSchema.partial();
export type LotInputsPatch = z.input<typeof lotInputsPatchSchema>;

export const DEFAULT_LOT_INPUTS: LotInputs = {
  vinOverride: null,
  bidOverrideUsdCents: null,
  repairEstimateEurCents: 0,
  feesReduced: false,
  includeSofiaToBg: true,
  marketMatch: { mileage: false, transmission: false, fuel: false, yearSpan: 0 },
  marketSources: null,
};
