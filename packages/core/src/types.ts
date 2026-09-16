import type { MarketSource } from './settings.ts';

/**
 * Money is always integer cents with the currency in the field name
 * (e.g. `currentBidUsdCents`). Dates are ISO-8601 strings on the wire.
 */

export const AUCTION_SOURCES = ['copart', 'iaai'] as const;
export type AuctionSource = (typeof AUCTION_SOURCES)[number];

/** A live lot on Copart / IAAI. */
export interface Lot {
  /** `${source}:${lotNumber}` */
  id: string;
  source: AuctionSource;
  lotNumber: string;
  url: string;
  /** May be partially masked (e.g. `1HGCM8263A******`). */
  vin: string | null;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  engine: string | null;
  fuel: string | null;
  transmission: string | null;
  drive: string | null;
  odometerMiles: number | null;
  primaryDamage: string | null;
  secondaryDamage: string | null;
  titleType: string | null;
  location: string | null;
  saleDate: string | null;
  currentBidUsdCents: number | null;
  buyNowUsdCents: number | null;
  /** Actual cash value reported by the auction (pre-damage estimate). */
  acvUsdCents: number | null;
  imageUrls: string[];
}

export interface LotSearchPage {
  lots: Lot[];
  total: number;
  page: number;
  pageSize: number;
}

export const SALE_STATUSES = ['sold', 'on_approval', 'not_sold', 'upcoming'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** A past (sold) auction appearance, from bidfax / stat.vin etc. */
export interface AuctionRecord {
  /** `${site}:${externalId}` */
  id: string;
  site: string;
  url: string;
  auction: string | null;
  lotNumber: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine: string | null;
  fuel: string | null;
  saleDate: string | null;
  finalPriceUsdCents: number | null;
  odometerMiles: number | null;
  damage: string | null;
  /**
   * 'on_approval' = the seller had not yet accepted the high bid when the page was captured;
   * 'upcoming' = listed for a future sale (no final bid yet).
   */
  saleStatus: SaleStatus | null;
  location: string | null;
  imageUrl: string | null;
}

/** A Bulgarian marketplace listing. */
export interface MarketListing {
  /** Listing URL. */
  id: string;
  site: MarketSource;
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  fuel: string | null;
  transmission: string | null;
  mileageKm: number | null;
  priceEurCents: number | null;
  location: string | null;
  imageUrl: string | null;
  /** Offered for import: the car is still abroad (e.g. mobile.bg "Намира се в САЩ"), not a BG market price. */
  importOffer: boolean;
}

export interface LotSearchFilters {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
}
