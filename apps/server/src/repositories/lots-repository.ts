import type { Lot } from '@car-porter/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { lots } from '../db/schema.ts';

export function createLotsRepository(db: Db) {
  async function upsertMany(items: Lot[]) {
    if (items.length === 0) return;
    const now = new Date();
    await db
      .insert(lots)
      .values(
        items.map((lot) => ({
          id: lot.id,
          source: lot.source,
          lotNumber: lot.lotNumber,
          vin: lot.vin,
          year: lot.year,
          make: lot.make,
          model: lot.model,
          data: lot,
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: lots.id,
        set: {
          vin: sql`excluded.vin`,
          year: sql`excluded.year`,
          make: sql`excluded.make`,
          model: sql`excluded.model`,
          data: sql`excluded.data`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  async function get(id: string): Promise<{ lot: Lot; fetchedAt: Date } | null> {
    const row = await db.query.lots.findFirst({ where: eq(lots.id, id) });
    return row ? { lot: row.data as Lot, fetchedAt: row.fetchedAt } : null;
  }

  return { upsertMany, get };
}

export type LotsRepository = ReturnType<typeof createLotsRepository>;
