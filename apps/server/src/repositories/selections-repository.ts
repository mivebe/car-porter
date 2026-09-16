import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { selections } from '../db/schema.ts';

export type SelectionKind = 'auction' | 'market';

/** Per-lot include/exclude choices for averages. Items are included unless stored as excluded. */
export function createSelectionsRepository(db: Db) {
  async function excludedIds(lotId: string, kind: SelectionKind): Promise<string[]> {
    const rows = await db
      .select({ itemId: selections.itemId })
      .from(selections)
      .where(and(eq(selections.lotId, lotId), eq(selections.kind, kind), eq(selections.included, false)));
    return rows.map((r) => r.itemId);
  }

  async function set(lotId: string, kind: SelectionKind, itemId: string, included: boolean) {
    await db
      .insert(selections)
      .values({ lotId, kind, itemId, included })
      .onConflictDoUpdate({ target: [selections.lotId, selections.kind, selections.itemId], set: { included } });
  }

  return { excludedIds, set };
}

export type SelectionsRepository = ReturnType<typeof createSelectionsRepository>;
