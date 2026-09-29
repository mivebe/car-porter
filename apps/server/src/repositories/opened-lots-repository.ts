import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { openedLots } from '../db/schema.ts';

export function createOpenedLotsRepository(db: Db) {
  /** Upserts with the latest open time. */
  async function add(lotId: string): Promise<{ openedAt: Date }> {
    const openedAt = new Date();
    await db.insert(openedLots).values({ lotId, openedAt }).onConflictDoUpdate({ target: openedLots.lotId, set: { openedAt } });
    return { openedAt };
  }

  /** The given lots that were opened. */
  async function among(lotIds: string[]): Promise<string[]> {
    if (lotIds.length === 0) return [];
    const rows = await db.select({ lotId: openedLots.lotId }).from(openedLots).where(inArray(openedLots.lotId, lotIds));
    return rows.map((r) => r.lotId);
  }

  return { add, among };
}

export type OpenedLotsRepository = ReturnType<typeof createOpenedLotsRepository>;
