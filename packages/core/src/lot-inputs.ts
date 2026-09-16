import { z } from 'zod';
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
};
