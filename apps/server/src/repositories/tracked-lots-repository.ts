import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { trackedLots } from '../db/schema.ts';

export function createTrackedLotsRepository(db: Db) {
  /** Newest first. */
  async function list(): Promise<{ lotId: string; createdAt: Date }[]> {
    return db
      .select({ lotId: trackedLots.lotId, createdAt: trackedLots.createdAt })
      .from(trackedLots)
      .orderBy(desc(trackedLots.createdAt), desc(trackedLots.lotId));
  }

  async function get(lotId: string): Promise<{ createdAt: Date } | null> {
    const row = await db.query.trackedLots.findFirst({ where: eq(trackedLots.lotId, lotId) });
    return row ? { createdAt: row.createdAt } : null;
  }

  /** Idempotent: tracking an already tracked lot keeps its original date. */
  async function add(lotId: string): Promise<{ createdAt: Date }> {
    await db.insert(trackedLots).values({ lotId, createdAt: new Date() }).onConflictDoNothing();
    return (await get(lotId))!;
  }

  async function remove(lotId: string) {
    await db.delete(trackedLots).where(eq(trackedLots.lotId, lotId));
  }

  return { list, get, add, remove };
}

export type TrackedLotsRepository = ReturnType<typeof createTrackedLotsRepository>;
