import { DEFAULT_LOT_INPUTS, type LotInputs } from '@car-porter/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { lotInputs } from '../db/schema.ts';

export function createLotInputsRepository(db: Db) {
  async function get(lotId: string): Promise<LotInputs> {
    const row = await db.query.lotInputs.findFirst({ where: eq(lotInputs.lotId, lotId) });
    if (!row) return DEFAULT_LOT_INPUTS;
    return {
      vinOverride: row.vinOverride,
      bidOverrideUsdCents: row.bidOverrideUsdCents,
      repairEstimateEurCents: row.repairEstimateEurCents,
      feesReduced: row.feesReduced,
      includeSofiaToBg: row.includeSofiaToBg,
      // pick the known keys: older rows may still carry the removed fuel toggle
      marketMatch: {
        trim: row.marketMatch.trim ?? DEFAULT_LOT_INPUTS.marketMatch.trim,
        mileage: row.marketMatch.mileage,
        transmission: row.marketMatch.transmission,
        yearSpan: row.marketMatch.yearSpan ?? DEFAULT_LOT_INPUTS.marketMatch.yearSpan,
      },
      marketSources: row.marketSources,
    };
  }

  async function update(lotId: string, patch: Partial<LotInputs>): Promise<LotInputs> {
    const next: LotInputs = { ...(await get(lotId)), ...patch };
    const values = { ...next, vinOverride: next.vinOverride || null, updatedAt: new Date() };
    await db
      .insert(lotInputs)
      .values({ lotId, ...values })
      .onConflictDoUpdate({ target: lotInputs.lotId, set: values });
    return { ...next, vinOverride: values.vinOverride };
  }

  return { get, update };
}

export type LotInputsRepository = ReturnType<typeof createLotInputsRepository>;
