import type { AuctionRecord } from '@car-porter/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { auctionRecords } from '../db/schema.ts';

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);

/**
 * Past auction sales. Kept permanently (a sold result never changes); an upsert only refreshes
 * price/status for records first captured "on approval".
 */
export function createAuctionRecordsRepository(db: Db) {
  async function upsertMany(records: AuctionRecord[]) {
    if (records.length === 0) return;
    await db
      .insert(auctionRecords)
      .values(
        records.map((r) => ({
          id: r.id,
          site: r.site,
          url: r.url,
          auction: r.auction,
          lotNumber: r.lotNumber,
          vin: r.vin,
          year: r.year,
          make: r.make,
          model: r.model,
          trim: r.trim,
          engine: r.engine,
          fuel: r.fuel,
          saleDate: toDate(r.saleDate),
          finalPriceUsdCents: r.finalPriceUsdCents,
          odometerMiles: r.odometerMiles,
          damage: r.damage,
          data: r,
        })),
      )
      .onConflictDoUpdate({
        target: auctionRecords.id,
        set: {
          finalPriceUsdCents: sql`excluded.final_price_usd_cents`,
          saleDate: sql`excluded.sale_date`,
          data: sql`excluded.data`,
        },
      });
  }

  async function findByModelYear(site: string, make: string, model: string, year: number): Promise<AuctionRecord[]> {
    const rows = await db
      .select({ data: auctionRecords.data })
      .from(auctionRecords)
      .where(
        and(
          eq(auctionRecords.site, site),
          eq(auctionRecords.make, make),
          eq(auctionRecords.model, model),
          eq(auctionRecords.year, year),
        ),
      );
    return rows.map((r) => r.data as AuctionRecord);
  }

  return { upsertMany, findByModelYear };
}

export type AuctionRecordsRepository = ReturnType<typeof createAuctionRecordsRepository>;
