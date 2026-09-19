import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ALIAS_SOURCES, type LotSearchFilters, type MarketYearSpan } from '@car-porter/core';

const now = sql`(unixepoch() * 1000)`;
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Single-row JSON document, resolved against defaults in @car-porter/core. */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  data: text('data', { mode: 'json' }).notNull(),
  updatedAt: timestamp('updated_at').notNull().default(now),
});

/** Copart / IAAI lots. id = `${source}:${lotNumber}`. */
export const lots = sqliteTable(
  'lots',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: ['copart', 'iaai'] }).notNull(),
    lotNumber: text('lot_number').notNull(),
    vin: text('vin'),
    year: integer('year'),
    make: text('make'),
    model: text('model'),
    data: text('data', { mode: 'json' }).notNull(),
    fetchedAt: timestamp('fetched_at').notNull().default(now),
  },
  (t) => [index('lots_vin_idx').on(t.vin)],
);

/** Per-lot user inputs; exists for any lot the user interacted with, tracked or not. */
export const lotInputs = sqliteTable('lot_inputs', {
  lotId: text('lot_id').primaryKey(),
  vinOverride: text('vin_override'),
  bidOverrideUsdCents: integer('bid_override_usd_cents'),
  repairEstimateEurCents: integer('repair_estimate_eur_cents').notNull().default(0),
  feesReduced: integer('fees_reduced', { mode: 'boolean' }).notNull().default(false),
  includeSofiaToBg: integer('include_sofia_to_bg', { mode: 'boolean' }).notNull().default(true),
  marketMatch: text('market_match', { mode: 'json' })
    // rows saved before the year span existed lack it
    .$type<{ mileage: boolean; transmission: boolean; fuel: boolean; yearSpan?: MarketYearSpan }>()
    .notNull()
    .default({ mileage: false, transmission: false, fuel: false }),
  /** null = marketplaces from settings */
  marketSources: text('market_sources', { mode: 'json' }).$type<Record<string, boolean>>(),
  updatedAt: timestamp('updated_at').notNull().default(now),
});

export const trackedLots = sqliteTable('tracked_lots', {
  lotId: text('lot_id').primaryKey(),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().default(now),
});

/**
 * Past auction sales (bidfax, stat.vin, ...). Sold results never change, so rows are kept
 * permanently and serve both price estimates and VIN/lot history.
 * id = `${site}:${externalId}`.
 */
export const auctionRecords = sqliteTable(
  'auction_records',
  {
    id: text('id').primaryKey(),
    site: text('site').notNull(),
    url: text('url').notNull(),
    auction: text('auction'),
    lotNumber: text('lot_number'),
    vin: text('vin'),
    year: integer('year'),
    make: text('make'),
    model: text('model'),
    trim: text('trim'),
    engine: text('engine'),
    fuel: text('fuel'),
    saleDate: timestamp('sale_date'),
    finalPriceUsdCents: integer('final_price_usd_cents'),
    odometerMiles: integer('odometer_miles'),
    damage: text('damage'),
    data: text('data', { mode: 'json' }).notNull(),
    firstSeenAt: timestamp('first_seen_at').notNull().default(now),
  },
  (t) => [
    index('auction_records_vin_idx').on(t.vin),
    index('auction_records_lot_idx').on(t.lotNumber),
    index('auction_records_mmy_idx').on(t.make, t.model, t.year),
  ],
);

/** Bulgarian marketplace listings. id = listing URL. */
export const marketListings = sqliteTable(
  'market_listings',
  {
    id: text('id').primaryKey(),
    site: text('site').notNull(),
    title: text('title'),
    year: integer('year'),
    make: text('make'),
    model: text('model'),
    trim: text('trim'),
    fuel: text('fuel'),
    transmission: text('transmission'),
    mileageKm: integer('mileage_km'),
    priceEurCents: integer('price_eur_cents'),
    data: text('data', { mode: 'json' }).notNull(),
    firstSeenAt: timestamp('first_seen_at').notNull().default(now),
    lastSeenAt: timestamp('last_seen_at').notNull().default(now),
    removedAt: timestamp('removed_at'),
  },
  (t) => [index('market_listings_mmy_idx').on(t.make, t.model, t.year)],
);

export const marketPriceSnapshots = sqliteTable(
  'market_price_snapshots',
  {
    listingId: text('listing_id').notNull(),
    priceEurCents: integer('price_eur_cents').notNull(),
    seenAt: timestamp('seen_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.seenAt] })],
);

/** Include/exclude choices for averages, per lot. */
export const selections = sqliteTable(
  'selections',
  {
    lotId: text('lot_id').notNull(),
    kind: text('kind', { enum: ['auction', 'market'] }).notNull(),
    itemId: text('item_id').notNull(),
    included: integer('included', { mode: 'boolean' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.lotId, t.kind, t.itemId] })],
);

/** Generic TTL cache for scrape/API results. */
export const scrapeCache = sqliteTable('scrape_cache', {
  key: text('key').primaryKey(),
  source: text('source').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  fetchedAt: timestamp('fetched_at').notNull(),
  expiresAt: timestamp('expires_at'),
});

/**
 * Conversion table between auction-site make/model names and our canonical catalog.
 * - make rows: `canonicalMake` = the make it maps to ('' if none), `canonical` = ''
 * - model rows: `canonicalMake` = the make whose model list it came from, `canonical` = the model
 *   it maps to ('' if none). One site model can map to several models (330I → 330i, 3 Series).
 * `origin` 'auto' rows are recomputed from the sites' search facets (`match` says how); 'manual'
 * rows are the user's assignments and replace all auto rows of the same site name. A manual row
 * mapping to '' means "ignored", or "unassigned by the user" when its `match` is 'unassigned'.
 * Auto rows are kept under manual ones so a reset can restore them.
 */
export const vehicleAliases = sqliteTable(
  'vehicle_aliases',
  {
    source: text('source', { enum: ALIAS_SOURCES }).notNull(),
    kind: text('kind', { enum: ['make', 'model', 'body'] }).notNull(),
    externalName: text('external_name').notNull(),
    canonicalMake: text('canonical_make').notNull(),
    canonical: text('canonical').notNull(),
    origin: text('origin', { enum: ['auto', 'manual'] }).notNull(),
    /** 'non_car': an NHTSA motorcycle/trailer/bus make, stored in `canonical` and never searched */
    match: text('match', { enum: ['exact', 'rule', 'fuzzy', 'non_car', 'unassigned'] }),
    lotCount: integer('lot_count'),
    lastSeenAt: timestamp('last_seen_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.kind, t.externalName, t.canonicalMake, t.canonical, t.origin] }),
    index('vehicle_aliases_canonical_idx').on(t.canonicalMake, t.canonical),
  ],
);

/** Searches the user ran, newest first; key = normalized filters, so repeating a search moves it to the top. */
export const recentSearches = sqliteTable('recent_searches', {
  key: text('key').primaryKey(),
  filters: text('filters', { mode: 'json' }).$type<LotSearchFilters>().notNull(),
  searchedAt: timestamp('searched_at').notNull().default(now),
});
