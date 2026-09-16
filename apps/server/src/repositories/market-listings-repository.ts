import { normalizeMake, type MarketListing } from '@car-porter/core';
import { desc, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { marketListings, marketPriceSnapshots } from '../db/schema.ts';

export interface StoredMarketListing extends MarketListing {
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last different price seen before the current one (a price drop or rise). */
  previousPriceEurCents: number | null;
}

/** BG marketplace listings by URL, with a price snapshot whenever the price changes. */
export function createMarketListingsRepository(db: Db) {
  async function upsertSeen(listings: MarketListing[], seenAt: Date) {
    if (listings.length === 0) return;
    const existing = new Map(
      (
        await db
          .select({ id: marketListings.id, priceEurCents: marketListings.priceEurCents })
          .from(marketListings)
          .where(inArray(marketListings.id, listings.map((l) => l.id)))
      ).map((r) => [r.id, r.priceEurCents]),
    );

    for (const listing of listings) {
      const values = {
        site: listing.site,
        title: listing.title,
        year: listing.year,
        make: listing.make ? normalizeMake(listing.make) : null,
        model: listing.model,
        trim: listing.trim,
        fuel: listing.fuel,
        transmission: listing.transmission,
        mileageKm: listing.mileageKm,
        priceEurCents: listing.priceEurCents,
        data: listing,
        lastSeenAt: seenAt,
        removedAt: null,
      };
      await db
        .insert(marketListings)
        .values({ id: listing.id, ...values, firstSeenAt: seenAt })
        .onConflictDoUpdate({ target: marketListings.id, set: values });

      const priceChanged = !existing.has(listing.id) || existing.get(listing.id) !== listing.priceEurCents;
      if (listing.priceEurCents != null && priceChanged) {
        await db
          .insert(marketPriceSnapshots)
          .values({ listingId: listing.id, priceEurCents: listing.priceEurCents, seenAt })
          .onConflictDoNothing();
      }
    }
  }

  async function markRemoved(ids: string[], at: Date) {
    if (ids.length === 0) return;
    await db.update(marketListings).set({ removedAt: at }).where(inArray(marketListings.id, ids));
  }

  async function findByIds(ids: string[]): Promise<StoredMarketListing[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(marketListings).where(inArray(marketListings.id, ids));
    const snapshots = await db
      .select()
      .from(marketPriceSnapshots)
      .where(inArray(marketPriceSnapshots.listingId, ids))
      .orderBy(desc(marketPriceSnapshots.seenAt));

    return rows.map((row) => {
      const listing = row.data as MarketListing;
      const previous = snapshots.find((s) => s.listingId === row.id && s.priceEurCents !== listing.priceEurCents);
      return {
        ...listing,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        previousPriceEurCents: previous?.priceEurCents ?? null,
      };
    });
  }

  return { upsertSeen, markRemoved, findByIds };
}

export type MarketListingsRepository = ReturnType<typeof createMarketListingsRepository>;
